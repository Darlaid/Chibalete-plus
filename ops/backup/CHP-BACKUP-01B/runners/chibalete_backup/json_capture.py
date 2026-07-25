"""Captura de JSON canonicos con validacion previa (BACKUP_01B_DESIGN.md §3.2, §8).

Contrato:
  - copia atomica a staging (escritura a temporal + os.replace);
  - valida que la COPIA parsea antes de aceptarla;
  - un JSON invalido aborta ANTES de invocar restic;
  - solo se emiten conteos si el store declara un adaptador explicito;
  - los stores leo_* no llevan adaptador: se valida parseabilidad y nada mas;
  - jamas se registra contenido, claves ni valores.
"""

import hashlib
import json
import os
import tempfile

from .errors import JsonInvalidError
from .stores import count_adapter

CAPTURE_METHOD = "atomic_copy_validated"
_HASH_CHUNK = 1024 * 1024


def _sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_HASH_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def capture_json(store, source_path: str, dest_path: str, logger) -> dict:
    """Copia y valida un store JSON. Devuelve solo metadata tecnica."""
    if not os.path.exists(source_path):
        raise JsonInvalidError(f"store JSON ausente: {store.logical_path}")

    dest_dir = os.path.dirname(dest_path)
    os.makedirs(dest_dir, exist_ok=True)

    # Copia atomica: temporal en el MISMO filesystem + rename(2).
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dest_dir, prefix=".partial-")
    try:
        with open(source_path, "rb") as src, os.fdopen(tmp_fd, "wb") as dst:
            while True:
                chunk = src.read(_HASH_CHUNK)
                if not chunk:
                    break
                dst.write(chunk)
            dst.flush()
            os.fsync(dst.fileno())
        os.replace(tmp_path, dest_path)
        tmp_path = None
    finally:
        if tmp_path is not None and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # Validacion sobre la COPIA, no sobre la fuente.
    try:
        with open(dest_path, "rb") as handle:
            parsed = json.load(handle)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
        _discard(dest_path)
        # El mensaje nombra el store, nunca el fragmento de contenido invalido.
        raise JsonInvalidError(
            f"JSON invalido en {store.logical_path}: no parseable (linea {getattr(exc, 'lineno', '?')})"
        ) from exc

    aggregate = None
    adapter = count_adapter(store.count_adapter)
    if adapter is not None:
        aggregate = adapter(parsed)
    # `parsed` se descarta de inmediato: nunca se registra ni se propaga.
    del parsed

    size = os.path.getsize(dest_path)
    digest = _sha256(dest_path)

    fields = {
        "store": store.logical_path,
        "bytes": size,
        "capture_method": CAPTURE_METHOD,
        "integrity_result": "ok",
        "sensitivity": store.sensitivity,
    }
    if aggregate is not None:
        fields["aggregate_count"] = aggregate
    logger.info("json_captured", **fields)

    return {
        "bytes": size,
        "sha256": digest,
        "capture_method": CAPTURE_METHOD,
        "integrity_result": "ok",
        "aggregate_count": aggregate,
    }


def _discard(path: str) -> None:
    try:
        if os.path.exists(path):
            os.unlink(path)
    except OSError:
        pass
