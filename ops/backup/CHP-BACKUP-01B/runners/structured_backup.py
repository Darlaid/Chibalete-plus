#!/usr/bin/env python3
"""Runner A — backup estructurado: SQLite + JSON canonicos + manifiesto.

Cadencia objetivo: cada 6 h (DEST_DECISION.md decision 4).
No destructivo: solo `init`, `backup`, `cat config`. Cero forget/prune.

Uso en produccion (lo que ejecuta la unit systemd):

    structured_backup.py

Provision (UNA sola vez, manual, nunca desde un timer):

    structured_backup.py --initialize-empty-repository

Ese flag es la autorizacion de primer `restic init`. Sin el, NINGUN destino
vacio se inicializa —ni un prefijo S3 aprobado ni una ruta de filesystem—. No se
persiste en ningun sitio ni se lee del entorno: la segunda ejecucion vuelve a
encontrar el repositorio ya existente y no reinicializa.

Los flags --config-dir/--base-dir/--work-dir/--lock-path existen para
ejercitar el runner con rutas sinteticas en las pruebas. Las units NO los pasan.
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chibalete_backup.config import DEFAULT_CONFIG_DIR, load_config  # noqa: E402
from chibalete_backup.errors import BackupError  # noqa: E402
from chibalete_backup.json_capture import capture_json  # noqa: E402
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
)
from chibalete_backup.restic import Restic  # noqa: E402
from chibalete_backup.safelog import SafeLogger  # noqa: E402
from chibalete_backup.sqlite_capture import capture_sqlite  # noqa: E402
from chibalete_backup.stores import DEFAULT_BASE_DIR, DEFAULT_WORK_DIR  # noqa: E402

BACKUP_TYPE = "structured"
TAG = "structured"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backup estructurado de Chibalete+ (SQLite + JSON)")
    parser.add_argument("--config-dir", default=DEFAULT_CONFIG_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--base-dir", default=DEFAULT_BASE_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--work-dir", default=DEFAULT_WORK_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--lock-path", default=DEFAULT_LOCK_PATH, help=argparse.SUPPRESS)
    parser.add_argument(
        "--initialize-empty-repository",
        action="store_true",
        help=(
            "AUTORIZACION MANUAL DE PROVISION: permite exactamente un "
            "`restic init` si —y solo si— el destino esta demostrablemente "
            "vacio (para S3, mediante el preflight firmado del prefijo "
            "aprobado). NUNCA debe aparecer en un timer."
        ),
    )
    return parser


def run(args) -> int:
    run_id = new_run_id(BACKUP_TYPE)
    log = SafeLogger(run_id, BACKUP_TYPE)
    manifest = ManifestBuilder(run_id, BACKUP_TYPE)

    config = load_config(args.config_dir)
    log.info("config_loaded", **config.redacted_summary())
    check_tools()

    sources = resolve_sources(args.base_dir)
    estimate = estimate_staging(sources)
    log.info("staging_estimate", **estimate)

    with SharedLock(args.lock_path):
        check_capacity(args.work_dir, estimate, log)
        restic = Restic(config, log)
        state = restic.ensure_repository(
            initialize_empty_repository=args.initialize_empty_repository
        )
        log.info("repository_ready", state=state)

        with StagingArea(args.work_dir) as staging:
            sqlite_dir = os.path.join(staging.path, "sqlite")
            json_dir = os.path.join(staging.path, "json")
            os.makedirs(sqlite_dir, exist_ok=True)
            os.makedirs(json_dir, exist_ok=True)

            for store, source_path in sources["sqlite"]:
                dest = os.path.join(sqlite_dir, os.path.basename(store.logical_path))
                capture = capture_sqlite(source_path, dest, log)
                manifest.add_store(
                    store.logical_path,
                    kind="sqlite",
                    category=store.category,
                    capture=capture,
                    reconstructible=store.reconstructible,
                )

            for store, source_path in sources["json"]:
                dest = os.path.join(json_dir, os.path.basename(store.logical_path))
                capture = capture_json(store, source_path, dest, log)
                manifest.add_store(
                    store.logical_path,
                    kind="json",
                    category=store.category,
                    capture=capture,
                    sensitivity=store.sensitivity,
                    retention_status=store.retention_status,
                )

            payload = manifest.build("ok")
            manifest_path = os.path.join(staging.path, "manifest.json")
            write_manifest(payload, manifest_path)

            summary = restic.backup([staging.path], tags=[TAG, run_id])
            log.info(
                "restic_backup_done",
                snapshot_id=summary.get("snapshot_id", "")[:8],
                files_new=summary.get("files_new"),
                files_changed=summary.get("files_changed"),
                data_added=summary.get("data_added"),
                total_bytes_processed=summary.get("total_bytes_processed"),
            )

            # Copia local del manifiesto (0400) para verificacion rapida.
            local_copy = os.path.join(args.work_dir, "manifests", f"{run_id}.json")
            write_manifest(payload, local_copy)
            log.info("manifest_written", stores=len(payload["stores"]), result=payload["result"])

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
