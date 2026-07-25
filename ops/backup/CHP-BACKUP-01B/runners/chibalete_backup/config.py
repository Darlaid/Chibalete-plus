"""Contrato de configuracion y secretos (BACKUP_01B_DESIGN.md §4).

Dos archivos separados, ambos root:root 0400:

  /etc/chibalete-backup/backup.env         -> contrato S3-compatible (SIN passphrase)
  /etc/chibalete-backup/restic-password    -> SOLO la passphrase

Reglas fail-closed implementadas aqui:
  - no se lee ningun .env del proyecto;
  - no hay fallbacks: si falta algo, se aborta;
  - la passphrase nunca se pasa por argumento ni se imprime;
  - RESTIC_PASSWORD_FILE debe apuntar exactamente a <config_dir>/restic-password;
  - propietario, grupo y modo se validan antes de leer el contenido.
"""

import os
import stat

from .errors import ConfigError
from .safelog import register_secret

DEFAULT_CONFIG_DIR = "/etc/chibalete-backup"
ENV_FILENAME = "backup.env"
PASSWORD_FILENAME = "restic-password"

REQUIRED_VARS = (
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_DEFAULT_REGION",
    "RESTIC_REPOSITORY",
    "RESTIC_PASSWORD_FILE",
)

# Unicas claves aceptadas. Cualquier otra aborta: impide, por ejemplo, colar
# RESTIC_PASSWORD dentro de backup.env (la passphrase va en su propio archivo).
OPTIONAL_VARS = ("RESTIC_CACHE_DIR",)
ALLOWED_VARS = frozenset(REQUIRED_VARS + OPTIONAL_VARS)

# Claves prohibidas de forma explicita, para dar un error claro.
FORBIDDEN_VARS = frozenset({"RESTIC_PASSWORD", "B2_ACCOUNT_ID", "B2_ACCOUNT_KEY"})

REQUIRED_MODE = 0o400
REQUIRED_UID = 0
REQUIRED_GID = 0

# Valores de plantilla: si aparecen tal cual, la config no fue completada.
PLACEHOLDER_VALUES = frozenset({"", "CHANGEME", "REPLACE_ME", "<REDACTED>", "TODO"})


class BackupConfig:
    """Configuracion validada. No expone los secretos en su repr()."""

    def __init__(self, config_dir: str, values: dict[str, str]) -> None:
        self.config_dir = config_dir
        self._values = values

    @property
    def repository(self) -> str:
        return self._values["RESTIC_REPOSITORY"]

    @property
    def password_file(self) -> str:
        return self._values["RESTIC_PASSWORD_FILE"]

    @property
    def cache_dir(self) -> str | None:
        return self._values.get("RESTIC_CACHE_DIR")

    def restic_env(self) -> dict[str, str]:
        """Entorno minimo para restic. La passphrase va por archivo, no por valor."""
        env = {
            "PATH": os.environ.get("PATH", "/usr/sbin:/usr/bin:/sbin:/bin"),
            "HOME": os.environ.get("HOME", "/root"),
            "AWS_ACCESS_KEY_ID": self._values["AWS_ACCESS_KEY_ID"],
            "AWS_SECRET_ACCESS_KEY": self._values["AWS_SECRET_ACCESS_KEY"],
            "AWS_DEFAULT_REGION": self._values["AWS_DEFAULT_REGION"],
            "RESTIC_REPOSITORY": self._values["RESTIC_REPOSITORY"],
            "RESTIC_PASSWORD_FILE": self._values["RESTIC_PASSWORD_FILE"],
        }
        if self.cache_dir:
            env["RESTIC_CACHE_DIR"] = self.cache_dir
        return env

    def redacted_summary(self) -> dict[str, str]:
        """Resumen apto para logs: ni un solo valor sensible."""
        return {
            "config_dir": self.config_dir,
            "repository_scheme": self.repository.split(":", 1)[0],
            "region_set": "yes" if self._values["AWS_DEFAULT_REGION"] else "no",
            "password_file_mode": "0400",
        }

    def __repr__(self) -> str:  # pragma: no cover - defensivo
        return f"<BackupConfig config_dir={self.config_dir!r} values=[REDACTED]>"


def _check_secure_file(path: str, what: str) -> os.stat_result:
    if not os.path.exists(path):
        raise ConfigError(f"{what} ausente: {path}")
    if os.path.islink(path):
        raise ConfigError(f"{what} es un symlink; se exige archivo regular: {path}")
    st = os.stat(path)
    if not stat.S_ISREG(st.st_mode):
        raise ConfigError(f"{what} no es un archivo regular: {path}")
    mode = stat.S_IMODE(st.st_mode)
    if mode != REQUIRED_MODE:
        raise ConfigError(
            f"{what} con permisos inseguros: {oct(mode)} (se exige {oct(REQUIRED_MODE)}): {path}"
        )
    if st.st_uid != REQUIRED_UID or st.st_gid != REQUIRED_GID:
        raise ConfigError(
            f"{what} con propietario incorrecto: uid={st.st_uid} gid={st.st_gid} "
            f"(se exige root:root): {path}"
        )
    return st


def _parse_env_file(path: str) -> dict[str, str]:
    """Parser KEY=VALUE estricto. No ejecuta shell ni interpola nada."""
    values: dict[str, str] = {}
    with open(path, "r", encoding="utf-8") as handle:
        for lineno, raw in enumerate(handle, start=1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export "):].strip()
            if "=" not in line:
                raise ConfigError(f"linea {lineno} invalida en backup.env (se espera KEY=VALUE)")
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key in FORBIDDEN_VARS:
                raise ConfigError(
                    f"clave prohibida en backup.env: {key} "
                    "(la passphrase va en restic-password; B2 se usa via contrato S3)"
                )
            if key not in ALLOWED_VARS:
                raise ConfigError(f"clave no permitida en backup.env: {key}")
            if key in values:
                raise ConfigError(f"clave duplicada en backup.env: {key}")
            values[key] = value
    return values


def load_config(config_dir: str = DEFAULT_CONFIG_DIR) -> BackupConfig:
    """Carga y valida la configuracion. Falla cerrado ante cualquier anomalia.

    `config_dir` existe para poder ejercitar el contrato con rutas sinteticas en
    las pruebas. Las units systemd NUNCA lo pasan: usan el valor por defecto.
    """
    env_path = os.path.join(config_dir, ENV_FILENAME)
    password_path = os.path.join(config_dir, PASSWORD_FILENAME)

    _check_secure_file(env_path, "backup.env")
    values = _parse_env_file(env_path)

    missing = [name for name in REQUIRED_VARS if name not in values]
    if missing:
        raise ConfigError(f"variables obligatorias ausentes en backup.env: {', '.join(sorted(missing))}")

    empty = [name for name in REQUIRED_VARS if values[name] in PLACEHOLDER_VALUES]
    if empty:
        raise ConfigError(
            f"variables sin valor efectivo en backup.env: {', '.join(sorted(empty))}"
        )

    # La ruta de la passphrase debe ser exactamente la prevista: sin desvios.
    declared = values["RESTIC_PASSWORD_FILE"]
    if os.path.normpath(declared) != os.path.normpath(password_path):
        raise ConfigError(
            "RESTIC_PASSWORD_FILE no apunta a la ruta prevista "
            f"(se esperaba {password_path})"
        )

    _check_secure_file(password_path, "restic-password")
    with open(password_path, "rb") as handle:
        passphrase = handle.read()
    if not passphrase.strip():
        raise ConfigError("restic-password esta vacio")

    # Registrar todo lo sensible para que el scrubber lo elimine de los logs.
    register_secret(values["AWS_ACCESS_KEY_ID"])
    register_secret(values["AWS_SECRET_ACCESS_KEY"])
    register_secret(passphrase.decode("utf-8", errors="replace").strip())
    del passphrase

    return BackupConfig(config_dir, values)
