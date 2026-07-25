#!/usr/bin/env python3
"""Runner B — backup incremental de uploads, DIRECTO a restic.

Cadencia objetivo: diaria (DEST_DECISION.md decision 4).

Invariantes vinculantes (decision 8):
  - los uploads NO se copian al staging local;
  - no se crea tarball;
  - no se abre ni se registra el contenido de ningun archivo;
  - solo se registran cantidad y volumen AGREGADOS.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chibalete_backup.config import DEFAULT_CONFIG_DIR, load_config  # noqa: E402
from chibalete_backup.errors import BackupError  # noqa: E402
from chibalete_backup.locking import (  # noqa: E402
    DEFAULT_LOCK_PATH,
    SharedLock,
    StagingArea,
    install_signal_handlers,
)
from chibalete_backup.manifest import ManifestBuilder, new_run_id, write_manifest  # noqa: E402
from chibalete_backup.preflight import (  # noqa: E402
    check_capacity,
    check_tools,
    estimate_staging,
    resolve_sources,
    uploads_aggregate,
)
from chibalete_backup.restic import Restic  # noqa: E402
from chibalete_backup.safelog import SafeLogger  # noqa: E402
from chibalete_backup.stores import DEFAULT_BASE_DIR, DEFAULT_WORK_DIR  # noqa: E402

BACKUP_TYPE = "uploads"
TAG = "uploads"
MANIFEST_TAG = "uploads-manifest"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backup incremental de uploads de Chibalete+")
    parser.add_argument("--config-dir", default=DEFAULT_CONFIG_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--base-dir", default=DEFAULT_BASE_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--work-dir", default=DEFAULT_WORK_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--lock-path", default=DEFAULT_LOCK_PATH, help=argparse.SUPPRESS)
    return parser


def run(args) -> int:
    run_id = new_run_id(BACKUP_TYPE)
    log = SafeLogger(run_id, BACKUP_TYPE)
    manifest = ManifestBuilder(run_id, BACKUP_TYPE)

    config = load_config(args.config_dir)
    log.info("config_loaded", **config.redacted_summary())
    check_tools()

    sources = resolve_sources(args.base_dir)
    upload_paths = [path for _source, path in sources["uploads"]]

    # El staging de esta ejecucion solo alberga el manifiesto: los uploads
    # jamas se copian. Se comprueba explicitamente como invariante.
    estimate = estimate_staging(sources)
    assert estimate["uploads_staged_bytes"] == 0, "los uploads no deben pasar por staging"
    log.info("staging_estimate", staged_uploads_bytes=0, manifest_only=True)

    with SharedLock(args.lock_path):
        check_capacity(args.work_dir, estimate, log)
        restic = Restic(config, log)
        state = restic.ensure_repository()
        log.info("repository_ready", state=state)

        aggregate = uploads_aggregate(upload_paths)
        log.info(
            "uploads_scanned",
            uploads_file_count=aggregate["file_count"],
            uploads_total_bytes=aggregate["total_bytes"],
        )

        # Backup DIRECTO de la ruta fuente: incremental y deduplicado por restic.
        summary = restic.backup(upload_paths, tags=[TAG, run_id])
        log.info(
            "restic_backup_done",
            snapshot_id=summary.get("snapshot_id", "")[:8],
            files_new=summary.get("files_new"),
            files_changed=summary.get("files_changed"),
            files_unmodified=summary.get("files_unmodified"),
            data_added=summary.get("data_added"),
            total_bytes_processed=summary.get("total_bytes_processed"),
        )

        manifest.set_uploads(aggregate["file_count"], aggregate["total_bytes"])
        payload = manifest.build("ok")

        with StagingArea(args.work_dir, prefix="uploads-manifest-") as staging:
            manifest_path = os.path.join(staging.path, "manifest.json")
            write_manifest(payload, manifest_path)
            restic.backup([manifest_path], tags=[MANIFEST_TAG, run_id])

        local_copy = os.path.join(args.work_dir, "manifests", f"{run_id}.json")
        write_manifest(payload, local_copy)
        log.info("manifest_written", result=payload["result"])

    log.info("run_complete", result="ok")
    return 0


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
