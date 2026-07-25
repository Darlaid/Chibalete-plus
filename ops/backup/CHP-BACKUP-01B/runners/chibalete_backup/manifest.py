"""Manifiesto versionado por ejecucion, sin PII ni secretos (design §9).

Contenido permitido: rutas LOGICAS, bytes, sha256, metodo de captura,
resultado de integridad, conteos AGREGADOS (solo si el store declara
adaptador), y totales agregados de uploads.

Contenido prohibido: nombres de usuario, contenido de eventos o JSON, valores
de variables, credenciales, tokens, claves, passphrases, rutas internas
innecesarias.
"""

import json
import os
import secrets
import time

from . import MANIFEST_SCHEMA_VERSION, RUNNER_VERSION
from .safelog import scrub
from .stores import LOGICAL_HOST

# Claves que jamas deben aparecer en un manifiesto. Se auditan antes de escribir.
FORBIDDEN_KEYS = frozenset({
    "aws_access_key_id",
    "aws_secret_access_key",
    "restic_password",
    "restic_password_file",
    "restic_repository",
    "password",
    "passphrase",
    "secret",
    "token",
    "credential",
    "username",
    "user_name",
    "email",
    "content",
    "rows",
    "records",
})


def new_run_id(prefix: str) -> str:
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    return f"{prefix}-{stamp}-{secrets.token_hex(4)}"


class ManifestBuilder:
    def __init__(self, run_id: str, backup_type: str) -> None:
        self.run_id = run_id
        self.backup_type = backup_type
        self._started = time.time()
        self._stores: list[dict] = []
        self._warnings: list[str] = []
        self._uploads = {"uploads_file_count": 0, "uploads_total_bytes": 0}

    def add_store(self, logical_path: str, kind: str, category: str, capture: dict, **labels) -> None:
        entry = {
            "logical_path": logical_path,
            "kind": kind,
            "category": category,
            "bytes": capture["bytes"],
            "sha256": capture["sha256"],
            "capture_method": capture["capture_method"],
            "integrity_result": capture["integrity_result"],
        }
        aggregate = capture.get("aggregate_count")
        if aggregate is not None:
            entry["aggregate_count"] = aggregate
        entry.update(labels)
        self._stores.append(entry)

    def set_uploads(self, file_count: int, total_bytes: int) -> None:
        self._uploads = {
            "uploads_file_count": int(file_count),
            "uploads_total_bytes": int(total_bytes),
        }

    def warn(self, message: str) -> None:
        self._warnings.append(scrub(message))

    def build(self, result: str) -> dict:
        return {
            "schema_version": MANIFEST_SCHEMA_VERSION,
            "run_id": self.run_id,
            "timestamp_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "backup_type": self.backup_type,
            "logical_host": LOGICAL_HOST,
            "runner_version": RUNNER_VERSION,
            "stores": self._stores,
            "uploads_file_count": self._uploads["uploads_file_count"],
            "uploads_total_bytes": self._uploads["uploads_total_bytes"],
            "duration_seconds": round(time.time() - self._started, 3),
            "warnings": self._warnings,
            "result": result,
        }


def audit_manifest(manifest: dict) -> list[str]:
    """Devuelve las violaciones encontradas. Vacio => apto para escribir."""
    problems: list[str] = []

    def walk(node, path: str) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key.lower() in FORBIDDEN_KEYS:
                    problems.append(f"clave prohibida en manifiesto: {path}.{key}")
                walk(value, f"{path}.{key}")
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, f"{path}[{index}]")
        elif isinstance(node, str):
            if node != scrub(node):
                problems.append(f"posible secreto en manifiesto: {path}")

    walk(manifest, "$")
    return problems


def write_manifest(manifest: dict, dest_path: str) -> str:
    """Escribe el manifiesto tras auditarlo. Modo 0400."""
    problems = audit_manifest(manifest)
    if problems:
        raise ValueError("; ".join(problems))
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    payload = json.dumps(manifest, indent=2, sort_keys=True, ensure_ascii=True)
    with open(dest_path, "w", encoding="utf-8") as handle:
        handle.write(payload + "\n")
    os.chmod(dest_path, 0o400)
    return dest_path
