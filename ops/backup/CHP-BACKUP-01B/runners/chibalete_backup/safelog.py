"""Logging estructurado con redaccion obligatoria de secretos.

Regla vinculante (BACKUP_01B_DESIGN.md §4): el runner NUNCA imprime
credenciales ni la passphrase. Todo valor sensible conocido se registra aqui y
se sustituye por `[REDACTED]` antes de emitir cualquier linea.
"""

import json
import re
import sys
import time

_SECRETS: set[str] = set()

# Patrones defensivos: aunque un valor no se haya registrado, estas formas
# nunca deben salir por stdout/stderr.
_PATTERNS = [
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"\b005[0-9a-zA-Z]{22,}\b"),  # keyID de Backblaze B2
    re.compile(r"(?i)(aws_secret_access_key|aws_access_key_id|restic_password)\s*=\s*\S+"),
]

REDACTED = "[REDACTED]"


def register_secret(value: str | None) -> None:
    """Registra un valor que jamas debe aparecer en la salida."""
    if value and len(value) >= 4:
        _SECRETS.add(value)


def reset_secrets() -> None:
    _SECRETS.clear()


def scrub(text: str) -> str:
    """Elimina de `text` cualquier secreto registrado o con forma conocida."""
    out = text
    # Los mas largos primero: evita que un prefijo comun deje colas visibles.
    for secret in sorted(_SECRETS, key=len, reverse=True):
        if secret in out:
            out = out.replace(secret, REDACTED)
    for pattern in _PATTERNS:
        out = pattern.sub(REDACTED, out)
    return out


class SafeLogger:
    """Emite JSON de una linea por evento, siempre depurado."""

    def __init__(self, run_id: str, component: str, stream=None) -> None:
        self.run_id = run_id
        self.component = component
        self._stream = stream if stream is not None else sys.stdout

    def _emit(self, level: str, event: str, **fields) -> None:
        record = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "level": level,
            "run_id": self.run_id,
            "component": self.component,
            "event": event,
        }
        record.update(fields)
        line = json.dumps(record, sort_keys=True, ensure_ascii=True)
        self._stream.write(scrub(line) + "\n")
        self._stream.flush()

    def info(self, event: str, **fields) -> None:
        self._emit("info", event, **fields)

    def warn(self, event: str, **fields) -> None:
        self._emit("warn", event, **fields)

    def error(self, event: str, **fields) -> None:
        self._emit("error", event, **fields)
