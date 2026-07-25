#!/usr/bin/env python3
"""Runner C — verificacion NO destructiva del repositorio.

Cadencia objetivo: semanal (DEST_DECISION.md decision 4).

Operaciones permitidas y unicas implementadas:
  - restic snapshots
  - restic check
  - lectura y validacion de los manifiestos locales
  - comprobacion agregada de la edad del ultimo backup (RPO)

Prohibido y ausente por construccion: forget, prune, remove, eliminacion de
snapshots o cualquier retencion destructiva (ver chibalete_backup/restic.py).
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chibalete_backup import MANIFEST_SCHEMA_VERSION  # noqa: E402
from chibalete_backup.config import DEFAULT_CONFIG_DIR, load_config  # noqa: E402
from chibalete_backup.errors import BackupError  # noqa: E402
from chibalete_backup.locking import (  # noqa: E402
    DEFAULT_LOCK_PATH,
    SharedLock,
    install_signal_handlers,
)
from chibalete_backup.manifest import audit_manifest, new_run_id  # noqa: E402
from chibalete_backup.preflight import check_tools  # noqa: E402
from chibalete_backup.restic import Restic  # noqa: E402
from chibalete_backup.safelog import SafeLogger  # noqa: E402
from chibalete_backup.stores import DEFAULT_WORK_DIR  # noqa: E402

BACKUP_TYPE = "verify"

# RPO objetivo (DEST_DECISION.md decision 6), a validar realmente en 01C.
RPO_SECONDS = {"structured": 6 * 3600, "uploads": 24 * 3600}

EXIT_RPO_BREACH = 21
EXIT_MANIFEST_INVALID = 22


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Verificacion no destructiva del repositorio restic")
    parser.add_argument("--config-dir", default=DEFAULT_CONFIG_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--work-dir", default=DEFAULT_WORK_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--lock-path", default=DEFAULT_LOCK_PATH, help=argparse.SUPPRESS)
    parser.add_argument(
        "--read-data-subset",
        default=None,
        help="Subconjunto a releer para detectar bit-rot, p. ej. 1%%",
    )
    return parser


def _parse_snapshot_time(value: str) -> float | None:
    if not value:
        return None
    cleaned = value.split(".")[0].replace("Z", "")
    for fmt in ("%Y-%m-%dT%H:%M:%S",):
        try:
            return time.mktime(time.strptime(cleaned, fmt))
        except ValueError:
            continue
    return None


def verify_manifests(work_dir: str, log) -> tuple[int, list[str]]:
    """Lee y valida los manifiestos locales. No imprime su contenido."""
    manifests_dir = os.path.join(work_dir, "manifests")
    problems: list[str] = []
    checked = 0
    if not os.path.isdir(manifests_dir):
        return 0, problems
    for name in sorted(os.listdir(manifests_dir)):
        if not name.endswith(".json"):
            continue
        path = os.path.join(manifests_dir, name)
        try:
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except (json.JSONDecodeError, OSError) as exc:
            problems.append(f"manifiesto ilegible: {name} ({type(exc).__name__})")
            continue
        checked += 1
        if payload.get("schema_version") != MANIFEST_SCHEMA_VERSION:
            problems.append(f"schema_version inesperada en {name}")
        for required in ("run_id", "timestamp_utc", "backup_type", "result", "stores"):
            if required not in payload:
                problems.append(f"campo obligatorio ausente en {name}: {required}")
        leaks = audit_manifest(payload)
        if leaks:
            problems.append(f"manifiesto con contenido prohibido: {name}")
    log.info("manifests_verified", checked=checked, problems=len(problems))
    return checked, problems


def run(args) -> int:
    run_id = new_run_id(BACKUP_TYPE)
    log = SafeLogger(run_id, BACKUP_TYPE)

    config = load_config(args.config_dir)
    log.info("config_loaded", **config.redacted_summary())
    check_tools()

    exit_code = 0
    with SharedLock(args.lock_path):
        restic = Restic(config, log)

        snapshots = restic.snapshots()
        log.info("snapshots_listed", count=len(snapshots))
        if not snapshots:
            log.error("no_snapshots", detail="el repositorio no contiene snapshots")
            return EXIT_RPO_BREACH

        restic.check(read_data_subset=args.read_data_subset)
        log.info("restic_check", result="ok", read_data_subset=args.read_data_subset or "none")

        now = time.time()
        for backup_type, rpo in RPO_SECONDS.items():
            tagged = [s for s in snapshots if backup_type in (s.get("tags") or [])]
            if not tagged:
                log.warn("rpo_no_snapshot", backup_type=backup_type)
                exit_code = EXIT_RPO_BREACH
                continue
            newest = max(
                (_parse_snapshot_time(s.get("time", "")) or 0.0) for s in tagged
            )
            age = now - newest if newest else None
            if age is None:
                log.warn("rpo_unparseable_time", backup_type=backup_type)
                continue
            log.info(
                "rpo_check",
                backup_type=backup_type,
                age_seconds=int(age),
                rpo_seconds=rpo,
                within_rpo=bool(age <= rpo),
            )
            if age > rpo:
                log.warn("rpo_breach", backup_type=backup_type, age_seconds=int(age))
                exit_code = EXIT_RPO_BREACH

        checked, problems = verify_manifests(args.work_dir, log)
        if problems:
            for problem in problems:
                log.error("manifest_problem", detail=problem)
            exit_code = EXIT_MANIFEST_INVALID

    log.info("run_complete", result="ok" if exit_code == 0 else "warn", exit_code=exit_code)
    return exit_code


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    install_signal_handlers()
    try:
        return run(args)
    except BackupError as exc:
        SafeLogger("-", BACKUP_TYPE, stream=sys.stderr).error(
            "run_failed", error_type=type(exc).__name__, message=str(exc)
        )
        if exc.stop_condition:
            print(exc.stop_condition, file=sys.stderr)
        return exc.exit_code
    except KeyboardInterrupt:
        SafeLogger("-", BACKUP_TYPE, stream=sys.stderr).error("run_interrupted")
        return 130


if __name__ == "__main__":
    sys.exit(main())
