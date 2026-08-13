"""Evaluacion LOCAL de recovery points para gates de deploy.

CHP-BACKUP-CAPACITY-01B F12-F14. Objetivo: evitar backups redundantes creados
solo por procedimiento, SIN permitir jamas una mutacion productiva sin un
recovery point valido. Toda la evaluacion es local (manifiestos + stores en
disco): CERO operaciones remotas contra B2.

Clases de store (F14) — DERIVADAS del inventario declarativo de stores.py, sin
reclasificar nada:

  CRITICAL_CANONICAL  categoria CANON o CFG sin flag reconstructible: su
                      perdida no se puede regenerar desde otra fuente.
  RECONSTRUCTIBLE     categoria PROJ o flag reconstructible=True (p. ej.
                      identity.db, que se regenera con el backfill/espejo
                      desde los stores canonicos JSON... NOTA: identity.db
                      esta declarada CANON reconstructible=False en stores.py
                      y por tanto se trata como CRITICAL_CANONICAL; la
                      derivacion respeta stores.py, no esta unidad).
  CONTENT             uploads (fuera del manifiesto structured).

Fingerprints (F14, sin coste excesivo):
  - stores JSON: sha256 del fichero actual comparado con el sha256 que el
    manifiesto registro en la captura (capture_json copia bytes crudos: son
    comparables 1:1);
  - stores SQLite: el sha del manifiesto corresponde a la CAPTURA Online
    Backup API, no al fichero vivo (WAL): se usa mtime del fichero y sus
    sidecars -wal/-shm contra el timestamp del manifiesto, como proxy
    conservador de «cambio desde la captura».

Regla NO NEGOCIABLE (F13): un snapshot PRE-mutacion jamas vale como recovery
point POST-mutacion. `evaluate_postapply_recovery_point` la aplica de forma
estructural: cualquier manifiesto anterior o igual al instante de la mutacion
=> NEW_BACKUP_REQUIRED.
"""

import glob
import hashlib
import json
import os
import time

from .stores import (
    JSON_STORES,
    SQLITE_STORES,
    SQLITE_SIDECAR_SUFFIXES,
)

REUSE = "REUSE"
NEW_BACKUP_REQUIRED = "NEW_BACKUP_REQUIRED"
INVALID_RECOVERY_POINT = "INVALID_RECOVERY_POINT"

CLASS_CRITICAL_CANONICAL = "CRITICAL_CANONICAL"
CLASS_RECONSTRUCTIBLE = "RECONSTRUCTIBLE"
CLASS_CONTENT = "CONTENT"

# Numero de stores que el manifiesto structured debe declarar (25 desde
# CHP-BACKUP-01D-R2). Si el inventario crece, este valor se actualiza JUNTO a
# stores.py — el test estructural de scope los mantiene acoplados.
EXPECTED_STRUCTURED_STORES = len(SQLITE_STORES) + len(JSON_STORES)

DEFAULT_MAX_AGE_SECONDS = 3600  # umbral configurable por el llamador


def store_class(category: str, reconstructible: bool = False) -> str:
    """Clase de proteccion derivada del inventario. No reclasifica nada."""
    if reconstructible or category == "PROJ":
        return CLASS_RECONSTRUCTIBLE
    return CLASS_CRITICAL_CANONICAL


def _sha256_file(path: str) -> str | None:
    try:
        digest = hashlib.sha256()
        with open(path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


def _parse_manifest_ts(value: str | None) -> float | None:
    if not value:
        return None
    try:
        cleaned = value.replace("Z", "")
        parsed = time.strptime(cleaned, "%Y-%m-%dT%H:%M:%S")
        return float(__import__("calendar").timegm(parsed))
    except (ValueError, OverflowError):
        return None


def latest_structured_manifest(manifests_dir: str) -> tuple[str | None, dict | None]:
    """Manifiesto structured mas reciente por timestamp interno. Local puro."""
    best_path, best, best_ts = None, None, -1.0
    for path in glob.glob(os.path.join(manifests_dir, "structured-*.json")):
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (OSError, json.JSONDecodeError):
            continue
        ts = _parse_manifest_ts(payload.get("timestamp_utc"))
        if ts is not None and ts > best_ts:
            best_path, best, best_ts = path, payload, ts
    return best_path, best


def _validate_manifest_shape(manifest: dict, reasons: list[str]) -> bool:
    ok = True
    if manifest.get("result") != "ok":
        reasons.append("manifest_result_not_ok")
        ok = False
    if manifest.get("warnings"):
        reasons.append("manifest_has_warnings")
        ok = False
    stores = manifest.get("stores")
    if not isinstance(stores, list) or len(stores) != EXPECTED_STRUCTURED_STORES:
        reasons.append(
            f"store_count_{len(stores) if isinstance(stores, list) else 'invalid'}"
            f"_expected_{EXPECTED_STRUCTURED_STORES}")
        ok = False
    else:
        paths = {s.get("logical_path") for s in stores}
        if "identity/identity.db" not in paths:
            reasons.append("identity_db_missing_from_manifest")
            ok = False
    return ok


def _fingerprints_stable(manifest: dict, base_dir: str, manifest_ts: float,
                         reasons: list[str]) -> bool:
    """Compara los stores CRITICOS actuales contra la captura del manifiesto."""
    by_path = {s.get("logical_path"): s for s in manifest.get("stores", [])}
    stable = True

    for store in JSON_STORES:
        if store_class(store.category) != CLASS_CRITICAL_CANONICAL:
            continue
        entry = by_path.get(store.logical_path)
        current = os.path.join(base_dir, store.logical_path)
        if entry is None or not os.path.exists(current):
            if store.required:
                reasons.append(f"critical_store_unresolvable:{store.logical_path}")
                stable = False
            continue
        if _sha256_file(current) != entry.get("sha256"):
            reasons.append(f"critical_store_changed:{store.logical_path}")
            stable = False

    for store in SQLITE_STORES:
        if store_class(store.category, store.reconstructible) != CLASS_CRITICAL_CANONICAL:
            continue
        current = os.path.join(base_dir, store.logical_path)
        if not os.path.exists(current):
            if store.required:
                reasons.append(f"critical_store_unresolvable:{store.logical_path}")
                stable = False
            continue
        candidates = [current] + [current + sfx for sfx in SQLITE_SIDECAR_SUFFIXES]
        newest = max((os.stat(p).st_mtime for p in candidates if os.path.exists(p)),
                     default=0.0)
        if newest > manifest_ts:
            reasons.append(f"critical_store_changed:{store.logical_path}")
            stable = False

    return stable


def evaluate_predeploy_recovery_point(
        manifests_dir: str, base_dir: str, *, now: float | None = None,
        max_age_seconds: int = DEFAULT_MAX_AGE_SECONDS,
        quota_block_after_ts: float | None = None) -> dict:
    """¿Sirve el ultimo backup structured como recovery point de PRE-deploy?

    Local puro: manifiestos + stores en disco. Devuelve verdict + reasons.
    Fail-closed: cualquier cosa no demostrable => NEW_BACKUP_REQUIRED (o
    INVALID_RECOVERY_POINT si el manifiesto mismo no es apto).
    """
    now = time.time() if now is None else now
    reasons: list[str] = []
    path, manifest = latest_structured_manifest(manifests_dir)
    if manifest is None:
        return {"verdict": NEW_BACKUP_REQUIRED, "reasons": ["no_structured_manifest"],
                "manifest_path": None, "age_seconds": None}

    manifest_ts = _parse_manifest_ts(manifest.get("timestamp_utc"))
    if manifest_ts is None:
        return {"verdict": INVALID_RECOVERY_POINT, "reasons": ["manifest_timestamp_unparseable"],
                "manifest_path": path, "age_seconds": None}

    if not _validate_manifest_shape(manifest, reasons):
        return {"verdict": INVALID_RECOVERY_POINT, "reasons": reasons,
                "manifest_path": path, "age_seconds": round(now - manifest_ts, 1)}

    age = now - manifest_ts
    if age > max_age_seconds:
        reasons.append(f"age_{int(age)}s_exceeds_{max_age_seconds}s")
    if age < 0:
        reasons.append("manifest_timestamp_in_future")

    if quota_block_after_ts is not None and quota_block_after_ts > manifest_ts:
        # Un bloqueo de cuota POSTERIOR al snapshot: no se puede afirmar que el
        # snapshot subio completo ni que el repo sea legible; backup nuevo.
        reasons.append("quota_block_after_snapshot")

    _fingerprints_stable(manifest, base_dir, manifest_ts, reasons)

    verdict = REUSE if not reasons else NEW_BACKUP_REQUIRED
    return {"verdict": verdict, "reasons": reasons, "manifest_path": path,
            "age_seconds": round(age, 1), "run_id": manifest.get("run_id")}


def evaluate_postapply_recovery_point(manifests_dir: str, *,
                                      mutation_at_ts: float) -> dict:
    """Gate POST-mutacion: exige un recovery point POSTERIOR a la mutacion.

    POST_MUTATION_REQUIRES_POST_STATE_RECOVERY_POINT — no negociable: ningun
    manifiesto anterior o igual al instante de la mutacion puede validar el
    estado posterior, aunque sus fingerprints parecieran coincidir.
    """
    path, manifest = latest_structured_manifest(manifests_dir)
    if manifest is None:
        return {"verdict": NEW_BACKUP_REQUIRED, "reasons": ["no_structured_manifest"],
                "manifest_path": None}
    manifest_ts = _parse_manifest_ts(manifest.get("timestamp_utc"))
    if manifest_ts is None or manifest_ts <= mutation_at_ts:
        return {"verdict": NEW_BACKUP_REQUIRED,
                "reasons": ["pre_mutation_recovery_point_cannot_cover_post_state"],
                "manifest_path": path}
    reasons: list[str] = []
    if not _validate_manifest_shape(manifest, reasons):
        return {"verdict": INVALID_RECOVERY_POINT, "reasons": reasons, "manifest_path": path}
    return {"verdict": REUSE, "reasons": [], "manifest_path": path,
            "run_id": manifest.get("run_id")}
