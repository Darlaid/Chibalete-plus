"""Envoltorio de restic con allowlist NO destructiva (BACKUP_01B_DESIGN.md §5.1).

En CHP-BACKUP-01B esta terminantemente prohibido ejecutar, incluso en dry-run:
`forget`, `prune`, eliminacion de snapshots o cualquier retencion destructiva.
La prohibicion se implementa aqui, en el unico punto por el que pasa restic:
todo subcomando fuera de la allowlist es rechazado ANTES de invocar el binario.
"""

import json
import os
import subprocess

from .errors import DestructiveCommandRejected, ResticError, RepositoryUnknownError

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
    def __init__(self, config, logger, timeout: int = 3600) -> None:
        self._config = config
        self._log = logger
        self._timeout = timeout

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

    def repository_state(self) -> str:
        """Clasifica el destino: 'repository' | 'empty' | 'unknown'.

        'unknown' = existe contenido que no es un repositorio restic legible.
        Nunca se inicializa encima de contenido ambiguo (design §3.1).
        """
        proc = self.run(["cat", "config"], check=False)
        if proc.returncode == 0:
            return "repository"
        repo = self._config.repository
        if repo.startswith("s3:") or ":" in repo.split("/")[0]:
            # Backend remoto: sin repo legible no podemos afirmar que este vacio.
            return "unknown"
        if not os.path.exists(repo):
            return "empty"
        try:
            entries = os.listdir(repo)
        except OSError:
            return "unknown"
        return "empty" if not entries else "unknown"

    def ensure_repository(self, allow_init: bool = True) -> str:
        state = self.repository_state()
        if state == "repository":
            self._log.info("repository_state", state="existing")
            return "existing"
        if state == "empty":
            if not allow_init:
                raise RepositoryUnknownError("repositorio inexistente y init no autorizado")
            self.run(["init"])
            self._log.info("repository_state", state="initialized")
            return "initialized"
        raise RepositoryUnknownError(
            "el destino no esta vacio y no es un repositorio restic identificable; "
            "no se inicializa encima de contenido ambiguo"
        )

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
