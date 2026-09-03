"""Inventario declarativo de stores (fuente: CHP-BACKUP-01A/BACKUP_INVENTORY.md).

Anadir un store nuevo (p. ej. identity.db cuando `identity_sqlite` pase a
`enabled`) es solo anadir una entrada aqui. Los runners no llevan rutas
hardcodeadas.
"""

import os
from dataclasses import dataclass, field

from .errors import PreflightError, SourceMissingError

# Base productiva. Los mounts host->contenedor del inventario §1 cuelgan de aqui.
DEFAULT_BASE_DIR = "/var/www/chibalete"

# Area de trabajo del runner: NUNCA dentro de /var/www/chibalete (design §7).
DEFAULT_WORK_DIR = "/var/backups/chibalete-backup"

# Identificador logico del host en los manifiestos. Deliberadamente logico:
# no se emite el hostname real ni ningun dato de infraestructura innecesario.
LOGICAL_HOST = "chibalete-prod"

SENSITIVITY_STANDARD = "standard"
SENSITIVITY_MINORS = "minors"

RETENTION_STANDARD = "standard"
RETENTION_NEEDS_LEGAL_REVIEW = "NEEDS_LEGAL_REVIEW"


@dataclass(frozen=True)
class SqliteStore:
    logical_path: str  # ruta logica, relativa a la base: nunca absoluta interna
    category: str  # CANON | PROJ
    reconstructible: bool
    required: bool = True  # False => ausencia tolerada (store futuro)


@dataclass(frozen=True)
class JsonStore:
    logical_path: str
    category: str  # CANON | CFG | PROJ
    # Adaptador de conteo AGREGADO. None => no se emite ningun conteo.
    # Regla §8 del diseno: los stores leo_* no llevan adaptador.
    count_adapter: str | None = None
    sensitivity: str = SENSITIVITY_STANDARD
    retention_status: str = RETENTION_STANDARD
    required: bool = True


@dataclass(frozen=True)
class UploadsSource:
    logical_path: str
    required: bool = True


# --- SQLite (inventario §2.1) -------------------------------------------------
SQLITE_STORES: tuple[SqliteStore, ...] = (
    SqliteStore("data-critical/events.db", "CANON", reconstructible=False),
    SqliteStore("data/progress.db", "CANON", reconstructible=False),
    SqliteStore("data/offline_assignments.db", "CANON", reconstructible=False),
    SqliteStore("data-critical/insights.db", "PROJ", reconstructible=True),
    # CHP-IDDB-02B-B-R1: identity.db vive en su propio directorio dedicado
    # (`identity/`), no bajo data-critical. La ruta la fija el contrato de
    # CHP-IDDB-02B-PATH-01 y la declara IDENTITY_DB en el compose.
    SqliteStore("identity/identity.db", "CANON", reconstructible=False, required=False),
)

# --- JSON canonicos (inventario §2.2) ----------------------------------------
JSON_STORES: tuple[JsonStore, ...] = (
    JsonStore("data-critical/usuarios_colegios_oro.json", "CANON", count_adapter="root_len"),
    JsonStore("data/groups_db.json", "CANON", count_adapter="root_len"),
    JsonStore("data/access_db.json", "CANON", count_adapter="root_len"),
    JsonStore("data/schools_db.json", "CFG", count_adapter="root_len"),
    JsonStore("data/sections.json", "CFG", count_adapter="root_len"),
    JsonStore("data/school_configs.json", "CFG", count_adapter="root_len"),
    JsonStore("data/content.json", "CANON", count_adapter="root_len"),
    JsonStore("data/content_db.json", "CANON", count_adapter="root_len"),
    JsonStore("data/user_audit_log.json", "CANON", count_adapter="root_len"),
    JsonStore("data/analytics_db.json", "PROJ", count_adapter="root_len"),
    # leo_*: incluidos y cifrados por restic, SIN adaptador de conteo y
    # etiquetados para revision legal (design §8).
    JsonStore(
        "data/leo_memory_db.json",
        "CANON",
        count_adapter=None,
        sensitivity=SENSITIVITY_MINORS,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
    ),
    JsonStore(
        "data/leo_evidence_db.json",
        "CANON",
        count_adapter=None,
        sensitivity=SENSITIVITY_MINORS,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
    ),
    JsonStore(
        "data/leo_interactions_db.json",
        "CANON",
        count_adapter=None,
        sensitivity=SENSITIVITY_MINORS,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
    ),
    # --- Omitidos hasta CHP-BACKUP-01D (VPS-STORAGE-AUDIT-01) -----------------
    # Los siete archivos siguientes existen en produccion y son leidos por el
    # servidor, pero quedaron fuera del inventario original. Se anaden como
    # stores INDEPENDIENTES: ninguno sustituye, fusiona ni canoniza a otro.
    #
    # En particular `data/users_db.json` NO reemplaza a
    # `data-critical/usuarios_colegios_oro.json` (la fuente que resuelve
    # USERS_DB): son dos archivos distintos con censos distintos y ambos se
    # respaldan por separado. Resolver esa divergencia es otra unidad.
    JsonStore("data/users_db.json", "CANON", count_adapter="root_len"),
    JsonStore("data/progress_db.json", "CANON", count_adapter="root_len"),
    JsonStore("data/lu_config.json", "CFG", count_adapter="root_len"),
    # Potencialmente asociados a menores: sin adaptador de conteo y marcados
    # para revision legal, igual que los stores leo_* (design §8).
    JsonStore(
        "data/leo_profile_db.json",
        "CANON",
        count_adapter=None,
        sensitivity=SENSITIVITY_MINORS,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
    ),
    JsonStore(
        "data/interventions_db.json",
        "CANON",
        count_adapter=None,
        sensitivity=SENSITIVITY_MINORS,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
    ),
    JsonStore(
        "data/submissions_db.json",
        "CANON",
        count_adapter=None,
        sensitivity=SENSITIVITY_MINORS,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
    ),
    # Copia historica de identidad: se respalda tal cual, sin conteo (no aporta
    # nada contar un volcado congelado) y marcada para revision legal porque su
    # retencion no tiene dueno definido. `required=False`: si algun dia se
    # retira de produccion, su ausencia NO debe romper el backup.
    JsonStore(
        "data/users_db.backup.1773870779.json",
        "CANON",
        count_adapter=None,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
        required=False,
    ),
    # --- CHP-BACKUP-MOOK-STORE-COVERAGE-01 ------------------------------------
    # Store canonico del MOOK: `experiences`, `versions`, `runs` y `evidence`.
    # Quedo fuera del inventario original porque el MOOK no existia cuando se
    # redacto (CHP-BACKUP-01A), no por una decision de exclusion.
    #
    # SIN adaptador de conteo a proposito: la raiz es un OBJETO de 4 claves
    # fijas, asi que `root_len` emitiria siempre 4 —un numero constante que no
    # dice nada sobre cuantas experiencias o evidencias hay y que se leeria como
    # un conteo real en el manifiesto—. Vale mas no emitir conteo que emitir uno
    # enganoso; `bytes` y `sha256` ya detectan truncamiento.
    #
    # `runs` y `evidence` acumulan trabajo de participantes menores de edad, de
    # modo que se clasifica igual que los stores leo_* y `submissions_db.json`:
    # sensibilidad `minors` y retencion pendiente de revision legal (design §8).
    #
    # `required=False`: un entorno donde el MOOK aun no se ha usado no tiene el
    # archivo, y esa ausencia NO debe tumbar el backup de los demas stores. Se
    # registra explicitamente en `stores_absent` del manifiesto para que
    # «ausente porque todavia no existe» no se confunda con «se perdio». Cuando
    # el archivo existe, su respaldo es obligatorio: un error de lectura o un
    # JSON invalido abortan la ejecucion antes de invocar restic.
    JsonStore(
        "data/mook_db.json",
        "CANON",
        count_adapter=None,
        sensitivity=SENSITIVITY_MINORS,
        retention_status=RETENTION_NEEDS_LEGAL_REVIEW,
        required=False,
    ),
)

# --- Uploads (inventario §1 mounts; §2.3) ------------------------------------
# El mount host autoritativo es /var/www/chibalete/public/uploads -> /app/public/uploads.
UPLOADS_SOURCES: tuple[UploadsSource, ...] = (
    UploadsSource("public/uploads"),
)

# --- Topologia Compose efectiva (CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B) ---
#
# Que problema resuelve: hasta 01A el backup canonico no respaldaba NINGUN
# archivo Compose. El que gobierna que imagenes corren en produccion es
# `docker-compose.override.yml` —`docker compose` mergea base + override—, y no
# existia en ningun snapshot, ni offsite ni local. Perdido el host, los datos
# volvian desde restic pero la topologia efectiva habia que reconstruirla a
# mano contra una base que declara tags de hace meses.
#
# Por que NO es un mecanismo generico: el directorio es una constante y solo se
# aceptan estos dos nombres exactos. No hay glob, no se recorre el padre y no se
# admite ninguna otra ruta absoluta. `/opt/chibaleteplus` contiene ademas `.env`
# y decenas de copias ad-hoc (`*.bak-*`, `*.pre-*`) que NUNCA deben entrar.
TOPOLOGY_DIR = "/opt/chibaleteplus"

# Subcarpeta del staging donde aterrizan. Nombre inequivoco: ni `sqlite/` ni
# `json/` deben poder confundirse con esto al restaurar.
TOPOLOGY_STAGING_DIR = "topology"


@dataclass(frozen=True)
class TopologyFile:
    # Nombre exacto del archivo, SIN separadores: nunca una ruta.
    name: str
    # Ambos son obligatorios: un backup sin la topologia efectiva no cumple su
    # proposito, asi que la ausencia debe fallar de forma visible, no anotarse
    # como `absent_optional`.
    required: bool = True


TOPOLOGY_FILES: tuple[TopologyFile, ...] = (
    TopologyFile("docker-compose.yml"),
    TopologyFile("docker-compose.override.yml"),
)

# Sufijos que acompanan a una base SQLite en WAL y cuentan para el espacio.
SQLITE_SIDECAR_SUFFIXES = ("-wal", "-shm")

# Exclusiones del backup ordinario (design §3.4). Nunca entran al staging.
EXCLUDED_NAME_PATTERNS = (
    "*.bak.*",
    "*.pre-*",
    "*.corrupt.*",
    "server.old-*",
    "node_modules",
    ".claude",
    ".env",
)


def _assert_topology_name_declared(name: str) -> None:
    """El nombre debe estar en el inventario fijo. Defensa en profundidad.

    Aunque el unico llamador itera sobre TOPOLOGY_FILES, esta comprobacion
    impide que un futuro atajo pase un nombre arbitrario y convierta esto en el
    mecanismo generico que deliberadamente no es.
    """
    if name not in {tf.name for tf in TOPOLOGY_FILES}:
        raise PreflightError(f"archivo de topologia no declarado: {name!r}")


def resolve_topology_file(topology_file: TopologyFile, topology_dir: str | None = None) -> str:
    """Devuelve la ruta validada de un archivo de topologia.

    Fail-closed ante todo lo que no sea un archivo regular contenido
    DIRECTAMENTE en `topology_dir`: nombres con separadores, `..`, symlinks,
    dispositivos, y cualquier nombre alcanzado por EXCLUDED_NAME_PATTERNS
    (`.env`, `*.bak.*`, `*.pre-*`, ...).

    Nunca devuelve None: si el archivo es obligatorio y falta, revienta. Ambos
    lo son, asi que en la practica la ausencia SIEMPRE aborta el backup.
    """
    base_dir = TOPOLOGY_DIR if topology_dir is None else topology_dir
    name = topology_file.name

    _assert_topology_name_declared(name)

    # El nombre es un nombre, no una ruta: ni separadores, ni `..`, ni absoluto.
    if name != os.path.basename(name) or os.path.isabs(name) or os.sep in name:
        raise PreflightError(f"nombre de topologia invalido: {name!r}")
    if "/" in name or name in (".", ".."):
        raise PreflightError(f"nombre de topologia invalido: {name!r}")

    # Las exclusiones del backup ordinario tambien rigen aqui.
    if _matches_excluded(name):
        raise PreflightError(f"nombre de topologia excluido por politica: {name!r}")

    path = os.path.join(base_dir, name)

    if not os.path.lexists(path):
        if topology_file.required:
            raise SourceMissingError(f"archivo de topologia obligatorio ausente: {name}")
        return ""

    if os.path.islink(path):
        raise PreflightError(f"archivo de topologia es un symlink; se exige regular: {name}")
    if not os.path.isfile(path):
        raise PreflightError(f"archivo de topologia no es un archivo regular: {name}")

    # No basta con no ser symlink: el destino real debe colgar directamente del
    # directorio de topologia aprobado.
    base_real = os.path.realpath(base_dir)
    real = os.path.realpath(path)
    if os.path.dirname(real) != base_real:
        raise PreflightError(f"archivo de topologia escapa del directorio aprobado: {name}")

    return path


def resolve_topology(topology_dir: str | None = None) -> list[tuple[TopologyFile, str]]:
    """Resuelve los dos archivos de topologia. Cualquier fallo aborta."""
    resolved: list[tuple[TopologyFile, str]] = []
    for topology_file in TOPOLOGY_FILES:
        path = resolve_topology_file(topology_file, topology_dir)
        if path:
            resolved.append((topology_file, path))
    return resolved


def _matches_excluded(name: str) -> bool:
    from fnmatch import fnmatch

    return any(fnmatch(name, pattern) for pattern in EXCLUDED_NAME_PATTERNS)


def count_adapter(name: str | None):
    """Devuelve el adaptador de conteo AGREGADO, o None si no hay ninguno.

    Los adaptadores solo devuelven cardinalidades. Nunca devuelven valores,
    claves de usuario ni fragmentos de contenido.
    """
    if name is None:
        return None
    if name == "root_len":
        def _root_len(parsed):
            if isinstance(parsed, (list, dict, str)):
                return len(parsed)
            return None
        return _root_len
    raise ValueError(f"adaptador de conteo desconocido: {name}")
