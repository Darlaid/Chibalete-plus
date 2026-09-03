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
import hashlib
import os
import sys
import tempfile

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
from chibalete_backup.stores import (  # noqa: E402
    DEFAULT_BASE_DIR,
    DEFAULT_WORK_DIR,
    TOPOLOGY_STAGING_DIR,
    resolve_topology,
)

BACKUP_TYPE = "structured"
TAG = "structured"

# Tamano de bloque de la copia byte a byte de los archivos de topologia.
_TOPOLOGY_CHUNK = 1024 * 1024

# CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B: metodo de captura declarado en el
# manifiesto. Distinto de los de SQLite/JSON porque aqui no hay parseo ni
# validacion semantica: se preservan los bytes tal cual.
TOPOLOGY_CAPTURE_METHOD = "file_copy"


def capture_topology(source_path: str, dest_path: str, logger) -> dict:
    """Copia byte a byte un archivo de topologia. Devuelve solo metadata.

    Misma disciplina que `capture_json`: temporal en el MISMO filesystem del
    destino + `rename(2)`, y el sha256 se calcula sobre la COPIA, no sobre la
    fuente, para que el manifiesto describa lo que de verdad viaja al snapshot.

    NO se parsea el YAML ni se registra ninguna clave o valor: estos archivos
    declaran variables de entorno por nombre y el runner no debe leerlas.
    """
    dest_dir = os.path.dirname(dest_path)
    os.makedirs(dest_dir, exist_ok=True)

    tmp_fd, tmp_path = tempfile.mkstemp(dir=dest_dir, prefix=".partial-")
    try:
        with open(source_path, "rb") as src, os.fdopen(tmp_fd, "wb") as dst:
            while True:
                chunk = src.read(_TOPOLOGY_CHUNK)
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

    size = os.path.getsize(dest_path)
    digest = hashlib.sha256()
    with open(dest_path, "rb") as handle:
        while True:
            chunk = handle.read(_TOPOLOGY_CHUNK)
            if not chunk:
                break
            digest.update(chunk)
    sha256 = digest.hexdigest()

    # El log nombra el archivo y su metadata tecnica, nunca su contenido.
    logger.info(
        "topology_captured",
        file=os.path.basename(dest_path),
        bytes=size,
        capture_method=TOPOLOGY_CAPTURE_METHOD,
        integrity_result="ok",
    )

    return {
        "bytes": size,
        "sha256": sha256,
        "capture_method": TOPOLOGY_CAPTURE_METHOD,
        "integrity_result": "ok",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Backup estructurado de Chibalete+ (SQLite + JSON)")
    parser.add_argument("--config-dir", default=DEFAULT_CONFIG_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--base-dir", default=DEFAULT_BASE_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--work-dir", default=DEFAULT_WORK_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--lock-path", default=DEFAULT_LOCK_PATH, help=argparse.SUPPRESS)
    # Solo para ejercitar el runner con un directorio sintetico en las pruebas.
    # La unit systemd NO lo pasa: en produccion rige la constante TOPOLOGY_DIR.
    parser.add_argument("--topology-dir", default=None, help=argparse.SUPPRESS)
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
    # CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B: se resuelve ANTES del lock y
    # antes de tocar el repositorio. Ambos archivos son obligatorios, asi que
    # la ausencia de cualquiera aborta aqui, de forma visible y sin efectos.
    topology = resolve_topology(args.topology_dir)
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

            # CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B: la topologia Compose
            # efectiva. Va en su propia carpeta del staging para que el restore
            # pueda pedir exactamente estos dos archivos sin arrastrar stores.
            # Su tamano (unos pocos KB) queda absorbido por MANIFEST_RESERVE_BYTES
            # del preflight, que reserva 256 KB.
            topology_dir_staged = os.path.join(staging.path, TOPOLOGY_STAGING_DIR)
            os.makedirs(topology_dir_staged, exist_ok=True)
            for topology_file, source_path in topology:
                dest = os.path.join(topology_dir_staged, topology_file.name)
                capture = capture_topology(source_path, dest, log)
                manifest.add_store(
                    f"{TOPOLOGY_STAGING_DIR}/{topology_file.name}",
                    kind="topology",
                    category="CFG",
                    capture=capture,
                )

            # CHP-BACKUP-MOOK-STORE-COVERAGE-01: deja constancia de los stores
            # OPCIONALES que no existian. Un manifiesto sin esta anotacion no
            # permite distinguir «aun no se ha creado» de «se perdio».
            for kind in ("sqlite", "json"):
                for store in sources["absent"][kind]:
                    manifest.add_absent(store.logical_path, kind=kind, category=store.category)
                    log.info("store_absent_optional", store=store.logical_path, kind=kind)

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
