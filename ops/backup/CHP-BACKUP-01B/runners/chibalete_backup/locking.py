"""Lock compartido y limpieza segura (BACKUP_01B_DESIGN.md §7, §10).

Un unico lock para los tres runners (structured / uploads / verify): nunca
deben solaparse. Se libera tras exito, error o interrupcion.
"""

import errno
import fcntl
import os
import shutil
import signal
import tempfile

from .errors import LockBusy


def install_signal_handlers() -> None:
    """Convierte SIGTERM/SIGINT en KeyboardInterrupt.

    Sin esto, un SIGTERM (el que envia systemd al vencer TimeoutStartSec)
    termina el proceso sin ejecutar los bloques `finally`: el staging quedaria
    huerfano y el lock tomado hasta que el kernel cerrara el descriptor.
    """

    def _raise(signum, _frame):
        raise KeyboardInterrupt(f"senal {signum}")

    signal.signal(signal.SIGTERM, _raise)
    signal.signal(signal.SIGINT, _raise)

# Vive bajo RuntimeDirectory=chibalete-backup, el unico punto de /run que las
# units dejan escribible con ProtectSystem=strict.
DEFAULT_LOCK_PATH = "/run/chibalete-backup/lock"


class SharedLock:
    """flock exclusivo no bloqueante sobre un unico archivo compartido."""

    def __init__(self, lock_path: str = DEFAULT_LOCK_PATH) -> None:
        self.lock_path = lock_path
        self._fd: int | None = None

    def __enter__(self) -> "SharedLock":
        parent = os.path.dirname(self.lock_path) or "."
        os.makedirs(parent, exist_ok=True)
        self._fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(self._fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            os.close(self._fd)
            self._fd = None
            if exc.errno in (errno.EACCES, errno.EAGAIN):
                raise LockBusy(
                    "otra ejecucion de backup ya tiene el lock; se aborta limpio"
                ) from exc
            raise
        os.ftruncate(self._fd, 0)
        os.write(self._fd, f"{os.getpid()}\n".encode("ascii"))
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        # Se libera igualmente ante excepcion o senal: nunca queda tomado.
        if self._fd is not None:
            try:
                fcntl.flock(self._fd, fcntl.LOCK_UN)
            finally:
                os.close(self._fd)
                self._fd = None
        return False


class StagingArea:
    """Directorio temporal propio del runner, con limpieza acotada.

    Solo borra lo que ella misma creo. Nunca toca datos fuente, repositorios ni
    snapshots. Si la limpieza falla, no oculta el error original.
    """

    def __init__(self, work_dir: str, prefix: str = "staging-") -> None:
        self.work_dir = work_dir
        self.prefix = prefix
        self.path: str | None = None
        self.cleanup_error: Exception | None = None

    def __enter__(self) -> "StagingArea":
        os.makedirs(self.work_dir, exist_ok=True)
        self.path = tempfile.mkdtemp(prefix=self.prefix, dir=self.work_dir)
        os.chmod(self.path, 0o700)
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        if self.path is None:
            return False
        try:
            shutil.rmtree(self.path)
        except OSError as cleanup_exc:
            self.cleanup_error = cleanup_exc
            # Si ya veniamos con un error, ese es el que debe propagarse: la
            # limpieza fallida se registra pero no enmascara la causa raiz.
            if exc_type is None:
                raise
        finally:
            self.path = None
        return False
