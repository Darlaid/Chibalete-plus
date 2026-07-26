"""Preflight comun: espacio, inodos, herramientas y rutas (design §7).

Prohibiciones estructurales:
  - NO se usa una cifra fija como unica validacion: el requerimiento se calcula
    en ejecucion a partir de los tamanos reales;
  - NO se copian uploads al staging (van directo a restic por stream);
  - NO se crea tarball global;
  - NO se inicia el staging si falta espacio o inodos.
"""

import os
import shutil

from .errors import InsufficientStagingSpace, PreflightError, SourceMissingError
from .stores import (
    JSON_STORES,
    SQLITE_STORES,
    SQLITE_SIDECAR_SUFFIXES,
    UPLOADS_SOURCES,
)

REQUIRED_TOOLS = ("restic",)

# Margenes proporcionales, NO cifras absolutas.
SQLITE_COPY_MARGIN_RATIO = 1.15  # la copia online puede superar a la fuente
RESTIC_CACHE_RATIO = 0.10  # cache temporal estimada sobre el staging
SAFETY_MARGIN_RATIO = 0.20  # margen de seguridad del filesystem
MANIFEST_RESERVE_BYTES = 256 * 1024  # manifiesto + temporales de escritura
INODE_SAFETY_FACTOR = 3  # por store: copia + temporal + rename


def check_tools() -> dict:
    found = {}
    for tool in REQUIRED_TOOLS:
        path = shutil.which(tool)
        if not path:
            raise PreflightError(f"herramienta obligatoria ausente en PATH: {tool}")
        found[tool] = path
    return found


def _size_if_exists(path: str) -> int:
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def assert_store_inventory_sane() -> None:
    """Valida el inventario declarativo ANTES de tocar el filesystem.

    Dos invariantes que, de romperse, causarian perdida silenciosa de datos:

      - `logical_path` duplicado: el mismo store se respaldaria dos veces y el
        manifiesto quedaria ambiguo;
      - `basename` duplicado: el staging nombra cada copia con
        `basename(logical_path)`, asi que dos rutas distintas con el mismo
        nombre de archivo se PISARIAN en el staging y una de las dos se
        perderia sin error.
    """
    for kind, inventory in (("SQLite", SQLITE_STORES), ("JSON", JSON_STORES)):
        seen_paths: dict[str, int] = {}
        seen_names: dict[str, str] = {}
        for store in inventory:
            if store.logical_path in seen_paths:
                raise PreflightError(
                    f"inventario {kind} invalido: logical_path duplicado "
                    f"{store.logical_path!r}"
                )
            seen_paths[store.logical_path] = 1
            name = os.path.basename(store.logical_path)
            if name in seen_names:
                raise PreflightError(
                    f"inventario {kind} invalido: dos stores comparten el nombre "
                    f"de archivo {name!r} ({seen_names[name]} y {store.logical_path}); "
                    "se pisarian en el staging"
                )
            seen_names[name] = store.logical_path


def _resolve_safe(base_dir: str, logical_path: str, what: str) -> str | None:
    """Devuelve la ruta fuente validada, o None si no existe.

    Fail-closed ante todo lo que no sea un archivo regular contenido en la base:
    symlinks, dispositivos, FIFOs y rutas que escapen del arbol aprobado.
    """
    if os.path.isabs(logical_path):
        raise PreflightError(f"{what} declara una ruta absoluta: {logical_path}")

    base_real = os.path.realpath(base_dir)
    path = os.path.join(base_dir, logical_path)

    if not os.path.lexists(path):
        return None

    if os.path.islink(path):
        raise PreflightError(f"{what} es un symlink; se exige archivo regular: {logical_path}")

    real = os.path.realpath(path)
    if real != base_real and not real.startswith(base_real + os.sep):
        raise PreflightError(f"{what} escapa del arbol de origen aprobado: {logical_path}")

    if not os.path.isfile(path):
        raise PreflightError(f"{what} no es un archivo regular: {logical_path}")

    return path


def resolve_sources(base_dir: str) -> dict:
    """Resuelve rutas fuente y verifica las obligatorias."""
    assert_store_inventory_sane()

    sqlite_paths = []
    for store in SQLITE_STORES:
        path = _resolve_safe(base_dir, store.logical_path, "base SQLite")
        if path is None and store.required:
            raise SourceMissingError(f"base SQLite obligatoria ausente: {store.logical_path}")
        if path is not None:
            sqlite_paths.append((store, path))

    json_paths = []
    for store in JSON_STORES:
        path = _resolve_safe(base_dir, store.logical_path, "store JSON")
        if path is None and store.required:
            raise SourceMissingError(f"store JSON obligatorio ausente: {store.logical_path}")
        if path is not None:
            json_paths.append((store, path))

    uploads_paths = []
    for source in UPLOADS_SOURCES:
        path = os.path.join(base_dir, source.logical_path)
        exists = os.path.isdir(path)
        if not exists and source.required:
            raise SourceMissingError(f"ruta de uploads obligatoria ausente: {source.logical_path}")
        if exists:
            uploads_paths.append((source, path))

    return {"sqlite": sqlite_paths, "json": json_paths, "uploads": uploads_paths}


def estimate_staging(sources: dict) -> dict:
    """Calcula dinamicamente el staging previsto. Uploads NO suman: van directo."""
    sqlite_bytes = 0
    sidecar_bytes = 0
    for _store, path in sources["sqlite"]:
        sqlite_bytes += _size_if_exists(path)
        for suffix in SQLITE_SIDECAR_SUFFIXES:
            sidecar_bytes += _size_if_exists(path + suffix)

    json_bytes = sum(_size_if_exists(path) for _store, path in sources["json"])

    # La copia online integra el WAL: se dimensiona sobre base + sidecars.
    sqlite_copy_bytes = int((sqlite_bytes + sidecar_bytes) * SQLITE_COPY_MARGIN_RATIO)
    staging_bytes = sqlite_copy_bytes + json_bytes + MANIFEST_RESERVE_BYTES
    cache_bytes = int(staging_bytes * RESTIC_CACHE_RATIO)
    safety_bytes = int((staging_bytes + cache_bytes) * SAFETY_MARGIN_RATIO)
    required_bytes = staging_bytes + cache_bytes + safety_bytes

    file_count = len(sources["sqlite"]) + len(sources["json"])
    required_inodes = (file_count + 2) * INODE_SAFETY_FACTOR

    return {
        "sqlite_bytes": sqlite_bytes,
        "sqlite_sidecar_bytes": sidecar_bytes,
        "sqlite_copy_bytes": sqlite_copy_bytes,
        "json_bytes": json_bytes,
        "manifest_reserve_bytes": MANIFEST_RESERVE_BYTES,
        "restic_cache_bytes": cache_bytes,
        "safety_margin_bytes": safety_bytes,
        "staging_bytes": staging_bytes,
        "required_bytes": required_bytes,
        "required_inodes": required_inodes,
        "uploads_staged_bytes": 0,  # invariante: uploads nunca se copian
    }


def check_capacity(work_dir: str, estimate: dict, logger) -> dict:
    """Comprueba espacio libre e inodos ANTES de crear nada en staging."""
    os.makedirs(work_dir, exist_ok=True)
    st = os.statvfs(work_dir)
    free_bytes = st.f_bavail * st.f_frsize
    free_inodes = st.f_favail

    logger.info(
        "capacity_check",
        required_bytes=estimate["required_bytes"],
        free_bytes=free_bytes,
        required_inodes=estimate["required_inodes"],
        free_inodes=free_inodes,
    )

    if free_bytes < estimate["required_bytes"]:
        raise InsufficientStagingSpace(
            f"espacio insuficiente en staging: se requieren {estimate['required_bytes']} bytes, "
            f"hay {free_bytes} libres"
        )
    # f_files == 0 => el filesystem no reporta inodos; no se puede afirmar margen.
    if st.f_files and free_inodes < estimate["required_inodes"]:
        raise InsufficientStagingSpace(
            f"inodos insuficientes en staging: se requieren {estimate['required_inodes']}, "
            f"hay {free_inodes} libres"
        )
    return {"free_bytes": free_bytes, "free_inodes": free_inodes}


def uploads_aggregate(paths: list[str]) -> dict:
    """Cuenta agregada de uploads. NO abre archivos ni registra nombres."""
    file_count = 0
    total_bytes = 0
    for root_path in paths:
        for dirpath, _dirnames, filenames in os.walk(root_path):
            for name in filenames:
                full = os.path.join(dirpath, name)
                try:
                    if os.path.islink(full):
                        continue
                    total_bytes += os.path.getsize(full)
                    file_count += 1
                except OSError:
                    continue
    return {"file_count": file_count, "total_bytes": total_bytes}
