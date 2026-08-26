#!/usr/bin/env python3
"""Suite de CHP-BACKUP-CAPACITY-01B (stdlib puro, sin restic ni red).

Cubre: clasificacion del preflight (incluida la firma Class-B real observada
en produccion), separacion repository/budget, validacion de presupuesto,
status.json atomico y honesto, reutilizacion de recovery points, regla
post-mutacion, guard de scope protegido y guard anti-destructivo.

La cache bajo systemd real (persistencia/reuso/reconstruccion) y la
serializacion por lock con procesos reales se validan en el harness Linux
(`tests/capacity_harness.sh`), que exige systemd y restic: no aqui.

    python3 ops/backup/CHP-BACKUP-01B/tests/test_capacity.py
"""

import calendar
import hashlib
import json
import os
import re
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT_DIR = os.path.dirname(HERE)
RUNNERS_DIR = os.path.join(UNIT_DIR, "runners")
sys.path.insert(0, RUNNERS_DIR)

from chibalete_backup.capacity import (  # noqa: E402
    BudgetVerdict,
    Classification,
    GateVerdict,
    RepositoryVerdict,
    STATUS_FIELDS,
    classify_cat_config_stderr,
    classify_repository,
    evaluate_budget,
    gate_verdict,
    load_status,
    record_activity,
    rollover_daily_counters,
    write_status,
)
from chibalete_backup.config import BackupConfig, OPTIONAL_VARS  # noqa: E402
from chibalete_backup.errors import ConfigError  # noqa: E402
from chibalete_backup.recovery_point import (  # noqa: E402
    CLASS_CRITICAL_CANONICAL,
    CLASS_RECONSTRUCTIBLE,
    EXPECTED_STRUCTURED_STORES,
    INVALID_RECOVERY_POINT,
    NEW_BACKUP_REQUIRED,
    REUSE,
    evaluate_postapply_recovery_point,
    evaluate_predeploy_recovery_point,
    store_class,
)
from chibalete_backup.s3_preflight import RemoteState  # noqa: E402
from chibalete_backup.stores import (  # noqa: E402
    EXCLUDED_NAME_PATTERNS,
    JSON_STORES,
    SQLITE_STORES,
    UPLOADS_SOURCES,
)

PASS = 0
FAIL = 0


def ok(label, cond, hint=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label} {hint}")


# La firma REAL del cap Class B, tal cual la registro produccion 4 veces.
REAL_CAP_STDERR = (
    "Fatal: unable to open config file: Stat: Access Denied.\n"
    "Is there a repository at the following location?\n"
)


def test_stderr_classifier():
    print("\n[1] clasificador de stderr: la DENEGACION va primero")
    ok("firma real del cap -> denied (no config_absent)",
       classify_cat_config_stderr(REAL_CAP_STDERR) == "denied")
    ok("config genuinamente ausente -> config_absent",
       classify_cat_config_stderr("Fatal: config does not exist") == "config_absent")
    ok("timeout -> network",
       classify_cat_config_stderr("dial tcp: i/o timeout") == "network")
    ok("passphrase incorrecta -> corrupt_or_password",
       classify_cat_config_stderr("wrong password or no key found") == "corrupt_or_password")
    ok("stderr vacio -> no_output", classify_cat_config_stderr("") == "no_output")
    ok("texto ajeno -> unclassified", classify_cat_config_stderr("algo raro") == "unclassified")


def test_repository_classification():
    print("\n[2] clasificacion combinada GET+LIST (fixtures F8)")
    # 1. GET OK -> healthy sin necesitar LIST.
    repo, cls, _ = classify_repository(0, None, None)
    ok("cat rc=0 -> GREEN/HEALTHY", repo is RepositoryVerdict.GREEN and cls is Classification.HEALTHY)

    # 3. El caso Class-B real: GET denegado + LIST 200 con objetos.
    repo, cls, hint = classify_repository(1, REAL_CAP_STDERR,
                                          RemoteState.FOREIGN_OBJECTS_PRESENT, 2)
    ok("GET AccessDenied + LIST 200 objetos -> CLASS_B_CAP RED",
       repo is RepositoryVerdict.RED and cls is Classification.CLASS_B_CAP,
       f"cls={cls} hint={hint}")

    # 2. LIST 403 -> credencial invalida (el cap jamas bloquea LIST).
    repo, cls, _ = classify_repository(1, REAL_CAP_STDERR, RemoteState.ACCESS_DENIED)
    ok("LIST denegado -> AUTH_FAILURE RED",
       repo is RepositoryVerdict.RED and cls is Classification.AUTH_FAILURE)

    repo, cls, _ = classify_repository(1, "Fatal: x", RemoteState.BUCKET_NOT_FOUND)
    ok("bucket inexistente -> BUCKET_FAILURE RED",
       repo is RepositoryVerdict.RED and cls is Classification.BUCKET_FAILURE)

    # 4. Red caida en ambas sondas -> transitorio, sin inventar RED.
    repo, cls, _ = classify_repository(1, "dial tcp: i/o timeout",
                                       RemoteState.NETWORK_OR_TLS_ERROR)
    ok("red -> NETWORK UNKNOWN (no RED de repo)",
       repo is RepositoryVerdict.UNKNOWN and cls is Classification.NETWORK)

    # 5. Config object ausente de verdad con repo poblado -> fallo de repo.
    repo, cls, _ = classify_repository(1, "Fatal: config does not exist",
                                       RemoteState.FOREIGN_OBJECTS_PRESENT, 2)
    ok("config ausente con objetos presentes -> REPOSITORY_FAILURE",
       repo is RepositoryVerdict.RED and cls is Classification.REPOSITORY_FAILURE)

    # 6. Prefijo vacio donde deberia existir el repo.
    repo, cls, _ = classify_repository(1, "Fatal: config does not exist",
                                       RemoteState.EMPTY_APPROVED_PREFIX, 0)
    ok("prefijo vacio -> REPOSITORY_FAILURE (jamas inicializable desde aqui)",
       repo is RepositoryVerdict.RED and cls is Classification.REPOSITORY_FAILURE)

    # Passphrase/corrupcion con objetos presentes.
    repo, cls, _ = classify_repository(1, "wrong password or no key found",
                                       RemoteState.FOREIGN_OBJECTS_PRESENT, 2)
    ok("passphrase/corrupcion -> REPOSITORY_FAILURE",
       repo is RepositoryVerdict.RED and cls is Classification.REPOSITORY_FAILURE)

    # 8. Respuesta ininteligible -> UNKNOWN (que el gate cierra), no un invento.
    repo, cls, _ = classify_repository(1, "???", RemoteState.UNKNOWN_REMOTE_STATE)
    ok("evidencia ininteligible -> UNKNOWN",
       repo is RepositoryVerdict.UNKNOWN and cls is Classification.UNKNOWN)

    repo, cls, _ = classify_repository(1, "Fatal: x", None)
    ok("cat fallo sin LIST -> UNKNOWN", repo is RepositoryVerdict.UNKNOWN)


def test_budget_and_gate():
    print("\n[3] presupuesto: UNKNOWN honesto, thresholds, fail-closed")
    v, r = evaluate_budget(None, None, 500)
    ok("sin presupuesto -> UNKNOWN", v is BudgetVerdict.UNKNOWN and r == "budget_not_configured")
    ok("dentro -> GREEN", evaluate_budget(5000, 2000, 100)[0] is BudgetVerdict.GREEN)
    ok("invade reserva -> YELLOW", evaluate_budget(5000, 2000, 3500)[0] is BudgetVerdict.YELLOW)
    ok("sobre budget -> RED", evaluate_budget(5000, 2000, 5000)[0] is BudgetVerdict.RED)

    ok("repo GREEN + budget UNKNOWN -> gate GREEN (F6)",
       gate_verdict(RepositoryVerdict.GREEN, Classification.HEALTHY,
                    BudgetVerdict.UNKNOWN) is GateVerdict.GREEN)
    ok("repo GREEN + budget YELLOW -> gate YELLOW",
       gate_verdict(RepositoryVerdict.GREEN, Classification.BUDGET_PRESSURE,
                    BudgetVerdict.YELLOW) is GateVerdict.YELLOW)
    ok("CLASS_B_CAP -> gate RED",
       gate_verdict(RepositoryVerdict.RED, Classification.CLASS_B_CAP,
                    BudgetVerdict.UNKNOWN) is GateVerdict.RED)
    ok("NETWORK -> gate YELLOW (transitorio)",
       gate_verdict(RepositoryVerdict.UNKNOWN, Classification.NETWORK,
                    BudgetVerdict.UNKNOWN) is GateVerdict.YELLOW)
    ok("LOCK -> gate YELLOW",
       gate_verdict(RepositoryVerdict.UNKNOWN, Classification.LOCK,
                    BudgetVerdict.UNKNOWN) is GateVerdict.YELLOW)
    ok("UNKNOWN -> gate RED (fail-closed para mutacion)",
       gate_verdict(RepositoryVerdict.UNKNOWN, Classification.UNKNOWN,
                    BudgetVerdict.UNKNOWN) is GateVerdict.RED)

    print("\n[4] validacion de configuracion de presupuesto")
    def cfg(values):
        return BackupConfig("/fixture", values)
    ok("nuevas claves declaradas como OPTIONAL_VARS",
       "B2_DAILY_OPERATION_BUDGET" in OPTIONAL_VARS and "B2_EMERGENCY_RESERVE" in OPTIONAL_VARS)
    ok("sin declarar -> (None, None)", cfg({}).validate_budget() == (None, None))
    ok("valido -> (5000, 2000)",
       cfg({"B2_DAILY_OPERATION_BUDGET": "5000",
            "B2_EMERGENCY_RESERVE": "2000"}).validate_budget() == (5000, 2000))
    for bad, label in [
        ({"B2_DAILY_OPERATION_BUDGET": "5000"}, "solo budget -> error"),
        ({"B2_EMERGENCY_RESERVE": "10"}, "solo reserve -> error"),
        ({"B2_DAILY_OPERATION_BUDGET": "abc", "B2_EMERGENCY_RESERVE": "1"}, "no numerico -> error"),
        ({"B2_DAILY_OPERATION_BUDGET": "0", "B2_EMERGENCY_RESERVE": "0"}, "budget 0 -> error"),
        ({"B2_DAILY_OPERATION_BUDGET": "100", "B2_EMERGENCY_RESERVE": "-1"}, "reserve negativa -> error"),
        ({"B2_DAILY_OPERATION_BUDGET": "100", "B2_EMERGENCY_RESERVE": "100"}, "reserve >= budget -> error"),
    ]:
        try:
            cfg(bad).validate_budget()
            ok(label, False, "no lanzo ConfigError")
        except ConfigError:
            ok(label, True)


def test_status():
    print("\n[5] status.json: atomico, 0600, honesto, con rollover diario")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "sub", "status.json")
        write_status(path, {"runs_today": 1, "estimated_class_b_cost_today": 7})
        data = load_status(path)
        ok("escritura+lectura", data.get("runs_today") == 1)
        ok("schema_version presente", data.get("schema_version", "").startswith("capacity-status/"))
        ok("cost_source=estimated SIEMPRE (F10)", data.get("cost_source") == "estimated")
        if os.name == "posix":
            ok("modo 0600", (os.stat(path).st_mode & 0o777) == 0o600)
        ok("sin residuo temporal", not [f for f in os.listdir(os.path.dirname(path))
                                        if f.startswith(".status-")])
        try:
            write_status(path, {"clave_pirata": 1})
            ok("clave fuera de schema -> rechazada", False)
        except ValueError:
            ok("clave fuera de schema -> rechazada", True)

        prev = {"generated_at": "2026-08-12T23:59:00Z", "runs_today": 9,
                "quota_blocks_today": 2, "estimated_class_b_cost_today": 4000}
        rolled = rollover_daily_counters(prev, "2026-08-13T00:05:00Z")
        ok("rollover diario reinicia contadores",
           rolled["runs_today"] == 0 and rolled["quota_blocks_today"] == 0
           and rolled["estimated_class_b_cost_today"] == 0)
        same = rollover_daily_counters(prev, "2026-08-12T23:59:30Z")
        ok("mismo dia conserva contadores", same["runs_today"] == 9)

        acc = record_activity(prev, runs=1, quota_blocks=1, estimated_cost=300,
                              now_utc="2026-08-12T23:59:40Z")
        ok("record_activity acumula", acc["runs_today"] == 10
           and acc["quota_blocks_today"] == 3
           and acc["estimated_class_b_cost_today"] == 4300)
        ok("estimated jamas se disfraza de real", acc["cost_source"] == "estimated")
        ok("status corrupto -> {} sin lanzar", load_status(os.path.join(tmp, "no.json")) == {})


def _iso(ts):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))


def _build_fixture(tmp, manifest_ts):
    """Arbol base + manifiesto coherente con stores.py (sha reales en JSON)."""
    base = os.path.join(tmp, "base")
    manifests = os.path.join(tmp, "manifests")
    os.makedirs(manifests, exist_ok=True)
    stores_entries = []
    for store in JSON_STORES:
        p = os.path.join(base, store.logical_path)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        content = json.dumps([{"id": f"fx-{store.logical_path}"}]).encode()
        with open(p, "wb") as fh:
            fh.write(content)
        os.utime(p, (manifest_ts - 60, manifest_ts - 60))
        stores_entries.append({
            "logical_path": store.logical_path, "kind": "json",
            "category": store.category, "bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
            "capture_method": "raw_copy", "integrity_result": "ok"})
    for store in SQLITE_STORES:
        p = os.path.join(base, store.logical_path)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as fh:
            fh.write(b"sqlite-fixture")
        os.utime(p, (manifest_ts - 60, manifest_ts - 60))
        stores_entries.append({
            "logical_path": store.logical_path, "kind": "sqlite",
            "category": store.category, "bytes": 14,
            "sha256": "0" * 64, "capture_method": "sqlite_backup_api",
            "integrity_result": "ok"})
    manifest = {"schema_version": "x", "run_id": "structured-fx-1",
                "timestamp_utc": _iso(manifest_ts), "backup_type": "structured",
                "stores": stores_entries, "warnings": [], "result": "ok"}
    mpath = os.path.join(manifests, "structured-fx-1.json")
    with open(mpath, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)
    return base, manifests, mpath, manifest


def test_recovery_point():
    print("\n[6] recovery point: REUSE solo con TODAS las condiciones")
    now = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        base, manifests, mpath, manifest = _build_fixture(tmp, now - 600)

        r = evaluate_predeploy_recovery_point(manifests, base, now=now,
                                              max_age_seconds=3600)
        ok("snapshot fresco + stores intactos -> REUSE", r["verdict"] == REUSE,
           json.dumps(r["reasons"]))

        r = evaluate_predeploy_recovery_point(manifests, base, now=now,
                                              max_age_seconds=300)
        ok("snapshot expirado -> NEW_BACKUP_REQUIRED",
           r["verdict"] == NEW_BACKUP_REQUIRED and any("age_" in x for x in r["reasons"]))

        # Store critico JSON cambiado.
        target = os.path.join(base, "data/access_db.json")
        with open(target, "wb") as fh:
            fh.write(b"[{\"id\":\"changed\"}]")
        r = evaluate_predeploy_recovery_point(manifests, base, now=now,
                                              max_age_seconds=3600)
        ok("store canonico JSON cambiado -> NEW_BACKUP_REQUIRED",
           r["verdict"] == NEW_BACKUP_REQUIRED
           and any("critical_store_changed:data/access_db.json" in x for x in r["reasons"]))

        # Restaurar y tocar solo un SQLite critico (mtime posterior).
        base2, manifests2, _, _ = _build_fixture(os.path.join(tmp, "b2"), now - 600)
        sq = os.path.join(base2, "data/progress.db")
        os.utime(sq, (now - 10, now - 10))
        r = evaluate_predeploy_recovery_point(manifests2, base2, now=now,
                                              max_age_seconds=3600)
        ok("SQLite critico con mtime posterior -> NEW_BACKUP_REQUIRED",
           r["verdict"] == NEW_BACKUP_REQUIRED
           and any("critical_store_changed:data/progress.db" in x for x in r["reasons"]))

        # Quota block posterior al snapshot.
        base3, manifests3, _, _ = _build_fixture(os.path.join(tmp, "b3"), now - 600)
        r = evaluate_predeploy_recovery_point(manifests3, base3, now=now,
                                              max_age_seconds=3600,
                                              quota_block_after_ts=now - 60)
        ok("quota block posterior -> NEW_BACKUP_REQUIRED",
           r["verdict"] == NEW_BACKUP_REQUIRED
           and "quota_block_after_snapshot" in r["reasons"])

        # Manifiesto invalido: sin identity.db.
        base4, manifests4, mpath4, man4 = _build_fixture(os.path.join(tmp, "b4"), now - 600)
        man4["stores"] = [s for s in man4["stores"]
                          if s["logical_path"] != "identity/identity.db"]
        man4["stores"].append({"logical_path": "data/fake.json", "kind": "json",
                               "category": "CFG", "bytes": 1, "sha256": "0" * 64,
                               "capture_method": "raw_copy", "integrity_result": "ok"})
        with open(mpath4, "w", encoding="utf-8") as fh:
            json.dump(man4, fh)
        r = evaluate_predeploy_recovery_point(manifests4, base4, now=now)
        ok("sin identity.db -> INVALID_RECOVERY_POINT",
           r["verdict"] == INVALID_RECOVERY_POINT
           and "identity_db_missing_from_manifest" in r["reasons"])

        # Manifiesto con warnings.
        base5, manifests5, mpath5, man5 = _build_fixture(os.path.join(tmp, "b5"), now - 600)
        man5["warnings"] = ["algo"]
        with open(mpath5, "w", encoding="utf-8") as fh:
            json.dump(man5, fh)
        r = evaluate_predeploy_recovery_point(manifests5, base5, now=now)
        ok("warnings -> INVALID_RECOVERY_POINT",
           r["verdict"] == INVALID_RECOVERY_POINT and "manifest_has_warnings" in r["reasons"])

        ok("sin manifiestos -> NEW_BACKUP_REQUIRED",
           evaluate_predeploy_recovery_point(os.path.join(tmp, "vacio"), base,
                                             now=now)["verdict"] == NEW_BACKUP_REQUIRED)

    print("\n[7] POST-MUTACION: regla no negociable")
    now = time.time()
    with tempfile.TemporaryDirectory() as tmp:
        base, manifests, _, _ = _build_fixture(tmp, now - 600)
        r = evaluate_postapply_recovery_point(manifests, mutation_at_ts=now - 60)
        ok("PRE snapshot valido + mutacion posterior -> NEW_BACKUP_REQUIRED "
           "(POST_MUTATION_REQUIRES_POST_STATE_RECOVERY_POINT=true)",
           r["verdict"] == NEW_BACKUP_REQUIRED
           and "pre_mutation_recovery_point_cannot_cover_post_state" in r["reasons"])
        r = evaluate_postapply_recovery_point(manifests, mutation_at_ts=now - 3600)
        ok("snapshot POSTERIOR a la mutacion -> REUSE", r["verdict"] == REUSE)


def test_protected_scope():
    print("\n[8] guard de scope protegido (F15)")
    total = len(SQLITE_STORES) + len(JSON_STORES)
    # 26 = los 25 historicos + data/mook_db.json
    # (CHP-BACKUP-MOOK-STORE-COVERAGE-01). Este ratchet existe para que ampliar
    # o REDUCIR el scope protegido sea siempre una decision consciente: subirlo
    # sin anadir el store correspondiente a la lista `must` de abajo dejaria el
    # guard contando cajas vacias.
    ok("PROTECTED_DATA_SCOPE_UNCHANGED: 26 stores structured",
       total == 26 and EXPECTED_STRUCTURED_STORES == 26, f"total={total}")
    paths = {s.logical_path for s in SQLITE_STORES} | {s.logical_path for s in JSON_STORES}
    for must in ("data-critical/usuarios_colegios_oro.json", "data/groups_db.json",
                 "data/access_db.json", "data/content.json", "identity/identity.db",
                 "data-critical/events.db", "data/progress.db", "data/mook_db.json"):
        ok(f"cubierto: {must}", must in paths)
    ok("data/ y data-critical/ presentes en el scope",
       any(p.startswith("data/") for p in paths)
       and any(p.startswith("data-critical/") for p in paths))
    ok("uploads (libros/textos/audios/imagenes/PDF) cubiertos por su fuente",
       any(u.logical_path == "public/uploads" for u in UPLOADS_SOURCES))
    ok("las exclusiones no vetan directorios protegidos",
       not any(pat.strip("*").strip(".") in ("data", "data-critical", "uploads")
               for pat in EXCLUDED_NAME_PATTERNS))
    ok("clases derivadas sin reclasificar: CANON no reconstruible = CRITICAL",
       store_class("CANON", False) == CLASS_CRITICAL_CANONICAL
       and store_class("CFG", False) == CLASS_CRITICAL_CANONICAL
       and store_class("PROJ", False) == CLASS_RECONSTRUCTIBLE
       and store_class("CANON", True) == CLASS_RECONSTRUCTIBLE)


def test_destructive_and_secret_guard():
    print("\n[9] guard anti-destructivo y de secretos sobre el delta (F16)")
    new_files = [
        os.path.join(RUNNERS_DIR, "chibalete_backup", "capacity.py"),
        os.path.join(RUNNERS_DIR, "chibalete_backup", "recovery_point.py"),
        os.path.join(RUNNERS_DIR, "backup_capacity_preflight.py"),
        os.path.join(HERE, "test_capacity.py"),
    ]
    destructive = re.compile(
        r'\.run\(\s*\[\s*"(forget|prune|rm|remove|delete|init|unlock|repair|rewrite)"')
    heavy = re.compile(r'\.run\(\s*\[\s*"(snapshots|stats|check|backup|restore)"')
    secrets_re = re.compile(r'AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY')
    for path in new_files:
        src = open(path, "r", encoding="utf-8").read()
        name = os.path.basename(path)
        ok(f"{name}: sin subcomandos destructivos ni init", not destructive.search(src))
        ok(f"{name}: sin operaciones remotas caras (snapshots/stats/check/backup)",
           not heavy.search(src))
        ok(f"{name}: sin credenciales embebidas", not secrets_re.search(src))
    pre = open(new_files[2], "r", encoding="utf-8").read()
    ok("el preflight solo invoca restic con [\"cat\", \"config\"]",
       pre.count('.run([') == 1 and '["cat", "config"]' in pre)
    dropin_dir = os.path.join(UNIT_DIR, "systemd", "dropins")
    dropins = []
    for root, _dirs, files in os.walk(dropin_dir):
        dropins += [os.path.join(root, f) for f in files]
    ok("3 drop-ins de cache preparados", len(dropins) == 3, str(dropins))
    for d in dropins:
        src = open(d, "r", encoding="utf-8").read()
        ok(f"{os.path.basename(os.path.dirname(d))}: CacheDirectory + RESTIC_CACHE_DIR",
           "CacheDirectory=chibalete-backup/restic" in src
           and "Environment=RESTIC_CACHE_DIR=/var/cache/chibalete-backup/restic" in src
           and "CacheDirectoryMode=0700" in src)
    ok("STATUS_FIELDS cubre el contrato F9",
       {"schema_version", "generated_at", "runs_today", "quota_blocks_today",
        "repository_state", "budget_state", "estimated_class_b_cost_today",
        "cost_source", "config_budget", "config_reserve",
        "last_authenticated_repo_read", "next_timer",
        "last_structured_success", "last_uploads_success", "last_verify_success",
        "last_snapshot_short", "last_duration_seconds"} <= set(STATUS_FIELDS))


def test_lock_serialization():
    print("\n[10] lock compartido (solo POSIX; el harness lo prueba con procesos)")
    if os.name != "posix":
        print("  SKIP  plataforma sin fcntl")
        return
    from chibalete_backup.locking import SharedLock  # noqa: PLC0415
    from chibalete_backup.errors import LockBusy  # noqa: PLC0415
    with tempfile.TemporaryDirectory() as tmp:
        lock_path = os.path.join(tmp, "lock")
        with SharedLock(lock_path):
            try:
                with SharedLock(lock_path):
                    ok("segundo tomador rechazado", False)
            except LockBusy:
                ok("BACKUP_LOCK_SHARED=true: segundo tomador -> LockBusy", True)
        with SharedLock(lock_path):
            ok("liberado tras salir del contexto", True)


def main() -> int:
    test_stderr_classifier()
    test_repository_classification()
    test_budget_and_gate()
    test_status()
    test_recovery_point()
    test_protected_scope()
    test_destructive_and_secret_guard()
    test_lock_serialization()
    print(f"\nRESULT: pass={PASS} fail={FAIL}")
    return 1 if FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
