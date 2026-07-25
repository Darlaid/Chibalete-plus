"""Captura consistente de SQLite mediante Online Backup API.

Metodo obligatorio (DEST_DECISION.md decision 7, BACKUP_01B_DESIGN.md §6):
`sqlite3.Connection.backup()` sobre la fuente abierta en modo READ-ONLY.

Garantias que este modulo NO rompe sobre la base productiva:
  - no fuerza checkpoint;
  - no cambia journal_mode (la fuente permanece en WAL);
  - no ejecuta VACUUM (ni VACUUM INTO: es solo fallback futuro explicito);
  - no escribe una sola vez en la fuente.
"""

import hashlib
import os
import sqlite3

from .errors import SqliteCaptureError

CAPTURE_METHOD = "sqlite_online_backup_api"
_PAGES_PER_STEP = 200
_HASH_CHUNK = 1024 * 1024


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_HASH_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def capture_sqlite(source_path: str, dest_path: str, logger) -> dict:
    """Copia consistente de `source_path` en `dest_path`.

    Devuelve solo metadata tecnica: bytes, sha256, integridad, metodo.
    Nunca lee ni registra filas ni valores de la base.
    """
    if not os.path.exists(source_path):
        raise SqliteCaptureError(f"base SQLite ausente: {source_path}")

    source_uri = f"file:{source_path}?mode=ro"
    src = None
    dst = None
    try:
        # `immutable=0` implicito: se respeta el WAL vivo del escritor.
        src = sqlite3.connect(source_uri, uri=True, timeout=30.0)
        dst = sqlite3.connect(dest_path)
        src.backup(dst, pages=_PAGES_PER_STEP)
        dst.close()
        dst = None
    except sqlite3.Error as exc:
        _discard(dest_path)
        raise SqliteCaptureError(f"fallo la copia online de {os.path.basename(source_path)}: {exc}") from exc
    finally:
        for conn in (dst, src):
            if conn is not None:
                try:
                    conn.close()
                except sqlite3.Error:
                    pass

    integrity = _verify_copy(dest_path)
    if integrity != "ok":
        _discard(dest_path)
        raise SqliteCaptureError(
            f"integrity_check de la copia de {os.path.basename(source_path)} = {integrity}"
        )

    size = os.path.getsize(dest_path)
    digest = _sha256(dest_path)
    logger.info(
        "sqlite_captured",
        store=os.path.basename(source_path),
        bytes=size,
        capture_method=CAPTURE_METHOD,
        integrity_result=integrity,
    )
    return {
        "bytes": size,
        "sha256": digest,
        "capture_method": CAPTURE_METHOD,
        "integrity_result": integrity,
    }


def _verify_copy(path: str) -> str:
    """integrity_check sobre la COPIA (nunca sobre la fuente)."""
    conn = None
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        row = conn.execute("PRAGMA integrity_check").fetchone()
        return row[0] if row else "sin resultado"
    except sqlite3.DatabaseError as exc:
        return f"error: {exc}"
    finally:
        if conn is not None:
            try:
                conn.close()
            except sqlite3.Error:
                pass


def _discard(path: str) -> None:
    """Elimina una copia que no supero la verificacion."""
    try:
        if os.path.exists(path):
            os.unlink(path)
    except OSError:
        pass


def source_journal_mode(source_path: str) -> str | None:
    """Lee el journal_mode de la fuente en READ-ONLY (para evidencia/pruebas)."""
    try:
        conn = sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return None
    try:
        row = conn.execute("PRAGMA journal_mode").fetchone()
        return row[0] if row else None
    finally:
        conn.close()
