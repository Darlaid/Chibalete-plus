"""Envoltorio de restic con allowlist NO destructiva (BACKUP_01B_DESIGN.md §5.1).

En CHP-BACKUP-01B esta terminantemente prohibido ejecutar, incluso en dry-run:
`forget`, `prune`, eliminacion de snapshots o cualquier retencion destructiva.
La prohibicion se implementa aqui, en el unico punto por el que pasa restic:
todo subcomando fuera de la allowlist es rechazado ANTES de invocar el binario.
"""

import json
import os
import subprocess

from .errors import (
    ConfigError,
    DestructiveCommandRejected,
    OverbroadCredentialError,
    RepositoryInitNotAuthorized,
    RepositoryUnknownError,
    ResticError,
    S3PreflightError,
)
from .s3_preflight import (
    CONTRADICTS_EMPTY,
    RemoteState,
    ScopeVerdict,
    classify_restic_stderr,
    is_remote_s3,
    parse_target,
    probe_approved_prefix,
    probe_scope_restriction,
)

# Destinos vacios: inicializables SOLO con autorizacion manual de provision.
# La regla es identica para S3 y para filesystem (CHP-BACKUP-01B-1-R3A).
EMPTY_INITIALIZABLE_STATES = frozenset({
    RemoteState.EMPTY_APPROVED_PREFIX,
    RemoteState.EMPTY_LOCAL_DIRECTORY,
})

# Estados que bloquean por evidencia de fallo remoto (no por contenido ajeno).
_S3_BLOCKING_MESSAGES = {
    RemoteState.ACCESS_DENIED:
        "el preflight S3 recibio una denegacion de acceso: la credencial no "
        "puede listar el prefijo aprobado",
    RemoteState.BUCKET_NOT_FOUND:
        "el bucket declarado en RESTIC_REPOSITORY no existe o no es visible "
        "para la credencial",
    RemoteState.ENDPOINT_OR_REGION_MISMATCH:
        "el endpoint o la region no corresponden al bucket declarado",
    RemoteState.NETWORK_OR_TLS_ERROR:
        "el preflight S3 no pudo completarse por un fallo de red o TLS",
    RemoteState.UNKNOWN_REMOTE_STATE:
        "el estado del destino remoto no pudo determinarse de forma inequivoca",
}

# Unicos subcomandos permitidos en 01B. `forget` NO esta, ni con --dry-run:
# habilitarlo requiere 01C GREEN y una unidad posterior explicita.
ALLOWED_SUBCOMMANDS = frozenset({
    "version",
    "init",
    "backup",
    "snapshots",
    "check",
    "cat",
    "stats",
})

# Rechazo explicito, para que el error sea inequivoco en vez de "no permitido".
DESTRUCTIVE_SUBCOMMANDS = frozenset({
    "forget",
    "prune",
    "rm",
    "remove",
    "delete",
    "unlock",
    "repair",
    "rewrite",
    "migrate",
    "recover",
})

DESTRUCTIVE_FLAGS = frozenset({"--prune", "--repack-uncompressed", "--forget"})


class Restic:
    def __init__(self, config, logger, timeout: int = 3600,
                 s3_timeout: float | None = None) -> None:
        self._config = config
        self._log = logger
        self._timeout = timeout
        self._s3_timeout = s3_timeout
        self._s3_target = None       # cacheado tras el primer preflight
        self._config_detail = ""     # motivo de INVALID_LOCAL_CONFIGURATION

    def _guard(self, args: list[str]) -> None:
        if not args:
            raise DestructiveCommandRejected("invocacion de restic sin subcomando")
        subcommand = args[0]
        if subcommand in DESTRUCTIVE_SUBCOMMANDS:
            raise DestructiveCommandRejected(
                f"subcomando destructivo rechazado en CHP-BACKUP-01B: restic {subcommand}"
            )
        if subcommand not in ALLOWED_SUBCOMMANDS:
            raise DestructiveCommandRejected(
                f"subcomando fuera de la allowlist no destructiva: restic {subcommand}"
            )
        for arg in args[1:]:
            if arg in DESTRUCTIVE_FLAGS:
                raise DestructiveCommandRejected(f"flag destructiva rechazada: {arg}")

    def run(self, args: list[str], check: bool = True) -> subprocess.CompletedProcess:
        """Ejecuta restic con entorno minimo. Nunca pasa la passphrase por CLI."""
        self._guard(args)
        env = self._config.restic_env()
        # Se registra el subcomando, jamas credenciales ni passphrase.
        self._log.info("restic_exec", subcommand=args[0], argc=len(args))
        try:
            proc = subprocess.run(
                ["restic", *args],
                env=env,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise ResticError("binario restic no encontrado en PATH") from exc
        except subprocess.TimeoutExpired as exc:
            raise ResticError(f"restic {args[0]} excedio el timeout de {self._timeout}s") from exc
        if check and proc.returncode != 0:
            raise ResticError(
                f"restic {args[0]} fallo (rc={proc.returncode}): "
                f"{_first_line(proc.stderr) or _first_line(proc.stdout)}"
            )
        return proc

    # --- Operaciones concretas ------------------------------------------------

    def version(self) -> str:
        return self.run(["version"]).stdout.strip()

    # --- Clasificacion del destino -------------------------------------------

    def _s3_kwargs(self) -> dict:
        return {} if self._s3_timeout is None else {"timeout": self._s3_timeout}

    def _remote_state(self, hint: str) -> RemoteState:
        """Estado del destino S3, con evidencia positiva de listado firmado.

        `hint` es la etiqueta sanitizada del stderr de `restic cat config`: se
        usa solo para CONTRADECIR un listado vacio, nunca para producirlo.
        """
        try:
            self._s3_target = parse_target(self._config.restic_env())
        except ConfigError as exc:
            self._config_detail = str(exc)
            return RemoteState.INVALID_LOCAL_CONFIGURATION

        result = probe_approved_prefix(self._s3_target, **self._s3_kwargs())
        self._log.info("s3_preflight", **result.as_log_fields(), restic_hint=hint)
        if result.state is RemoteState.EMPTY_APPROVED_PREFIX and hint in CONTRADICTS_EMPTY:
            # Cero objetos + restic afirmando passphrase incorrecta o repo
            # danado es incoherente: no se inicializa sobre una contradiccion.
            self._log.warn("s3_preflight_contradiction", restic_hint=hint)
            return RemoteState.UNKNOWN_REMOTE_STATE
        return result.state

    def repository_state(self) -> RemoteState:
        """Clasifica el destino segun el contrato de `RemoteState`.

        `EXISTING_REPOSITORY` es lo unico que `restic cat config` puede afirmar
        por si solo. `EMPTY_APPROVED_PREFIX` procede EXCLUSIVAMENTE del
        preflight S3 autenticado. Nunca se inicializa sobre contenido ambiguo
        (design §3.1).
        """
        proc = self.run(["cat", "config"], check=False)
        if proc.returncode == 0:
            return RemoteState.EXISTING_REPOSITORY

        hint = classify_restic_stderr(proc.stderr)
        self._log.info("restic_cat_config_failed", rc=proc.returncode, hint=hint)

        repo = self._config.repository
        if is_remote_s3(repo):
            return self._remote_state(hint)
        if ":" in repo.split("/")[0]:
            # Otro backend remoto (rest:, sftp:, b2:...): sin preflight propio
            # no hay forma de afirmar que este vacio.
            return RemoteState.UNKNOWN_REMOTE_STATE

        # Backend de filesystem: solo toolchain de pruebas y desarrollo. En
        # produccion RESTIC_REPOSITORY es `s3:` (config/backup.env.example).
        if not os.path.exists(repo):
            return RemoteState.EMPTY_LOCAL_DIRECTORY
        try:
            entries = os.listdir(repo)
        except OSError:
            return RemoteState.UNKNOWN_REMOTE_STATE
        return RemoteState.EMPTY_LOCAL_DIRECTORY if not entries else RemoteState.FOREIGN_OBJECTS_PRESENT

    # --- Primer init, con autorizacion manual de un solo uso ------------------

    def ensure_repository(self, initialize_empty_repository: bool = False) -> str:
        """Deja el repositorio listo, o bloquea.

        `initialize_empty_repository` es la autorizacion manual de provision.
        Es False por defecto y se exige POR IGUAL para cualquier backend —S3 o
        filesystem—: ni los timers ni los runners ordinarios pueden inicializar
        un repositorio. La autorizacion no se persiste en ningun sitio, de modo
        que una segunda ejecucion es idempotente.
        """
        state = self.repository_state()
        self._log.info("repository_state", state=state.value)

        if state is RemoteState.EXISTING_REPOSITORY:
            return "existing"

        if state in EMPTY_INITIALIZABLE_STATES:
            if not initialize_empty_repository:
                raise RepositoryInitNotAuthorized(
                    "el destino esta vacio: la primera inicializacion requiere "
                    "autorizacion manual de provision "
                    "(--initialize-empty-repository); ni los timers ni los "
                    "runners ordinarios la tienen"
                )
            return self._initialize_empty_destination(state)

        if state is RemoteState.FOREIGN_OBJECTS_PRESENT:
            raise RepositoryUnknownError(
                "el destino no esta vacio y no es un repositorio restic identificable; "
                "no se inicializa encima de contenido ambiguo"
            )

        if state is RemoteState.INVALID_LOCAL_CONFIGURATION:
            raise ConfigError(f"configuracion de destino invalida: {self._config_detail}")

        raise S3PreflightError(_S3_BLOCKING_MESSAGES.get(state, "destino no utilizable"))

    def _initialize_empty_destination(self, state) -> str:
        """Ejecuta exactamente un `restic init` sobre un destino vacio autorizado.

        Ademas de la autorizacion manual, un destino S3 exige demostrar que la
        credencial NO puede listar fuera del prefijo aprobado.
        """
        if state is RemoteState.EMPTY_APPROVED_PREFIX:
            verdict = probe_scope_restriction(self._s3_target, **self._s3_kwargs())
            self._log.info("s3_key_scope", verdict=verdict.value)
            if verdict is not ScopeVerdict.RESTRICTED:
                raise OverbroadCredentialError(
                    "la credencial puede listar fuera del prefijo aprobado, o su "
                    f"alcance no pudo demostrarse ({verdict.value}); no se inicializa"
                )

        self._log.info("repository_init_authorized", destination=state.value)
        self.run(["init"])

        # Verificacion posterior obligatoria: el destino debe quedar legible.
        confirmed = self.repository_state()
        if confirmed is not RemoteState.EXISTING_REPOSITORY:
            raise ResticError(
                "tras `restic init` el destino no se lee como repositorio "
                f"(estado={confirmed.value})"
            )
        self._log.info("repository_state", state="initialized")
        return "initialized"

    def backup(self, paths: list[str], tags: list[str], extra: list[str] | None = None) -> dict:
        args = ["backup", "--json"]
        for tag in tags:
            args += ["--tag", tag]
        if extra:
            args += extra
        args += paths
        proc = self.run(args)
        return _parse_backup_summary(proc.stdout)

    def snapshots(self, tag: str | None = None) -> list[dict]:
        args = ["snapshots", "--json"]
        if tag:
            args += ["--tag", tag]
        proc = self.run(args)
        try:
            return json.loads(proc.stdout or "[]")
        except json.JSONDecodeError as exc:
            raise ResticError("salida de `restic snapshots --json` ilegible") from exc

    def check(self, read_data_subset: str | None = None) -> bool:
        args = ["check"]
        if read_data_subset:
            args += ["--read-data-subset", read_data_subset]
        self.run(args)
        return True


def _first_line(text: str | None) -> str:
    if not text:
        return ""
    return text.strip().splitlines()[0] if text.strip() else ""


def _parse_backup_summary(stdout: str) -> dict:
    """Extrae el evento `summary` de la salida --json de `restic backup`."""
    summary: dict = {}
    for line in (stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if event.get("message_type") == "summary":
            summary = event
    if not summary:
        raise ResticError("`restic backup --json` no emitio evento summary")
    return summary
