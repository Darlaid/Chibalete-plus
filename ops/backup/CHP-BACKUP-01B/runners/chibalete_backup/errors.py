"""Errores tipados con codigos de salida estables para systemd."""


class BackupError(Exception):
    """Base de todos los errores del motor de backup."""

    exit_code = 1
    stop_condition = None


class ConfigError(BackupError):
    exit_code = 10
    stop_condition = "STOP — BACKUP-01B SECRETS FILE PERMISSIONS UNSAFE"


class PreflightError(BackupError):
    exit_code = 11


class InsufficientStagingSpace(PreflightError):
    exit_code = 12
    stop_condition = "STOP — BACKUP-01B INSUFFICIENT STAGING SPACE"


class LockBusy(BackupError):
    exit_code = 13


class SqliteCaptureError(BackupError):
    exit_code = 14
    stop_condition = "STOP — BACKUP-01B SQLITE CONSISTENCY NOT PROVEN"


class JsonInvalidError(BackupError):
    exit_code = 15


class ResticError(BackupError):
    exit_code = 16


class DestructiveCommandRejected(BackupError):
    """Se intento invocar un subcomando fuera de la allowlist no destructiva."""

    exit_code = 17
    stop_condition = "STOP — BACKUP-01B-1 DESTRUCTIVE COMMAND DETECTED"


class RepositoryUnknownError(PreflightError):
    exit_code = 18
    stop_condition = "STOP — BACKUP-01B REMOTE DESTINATION NOT EMPTY"


class SourceMissingError(PreflightError):
    exit_code = 19
