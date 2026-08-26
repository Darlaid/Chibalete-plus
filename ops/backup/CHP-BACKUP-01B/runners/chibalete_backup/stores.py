"""Inventario declarativo de stores (fuente: CHP-BACKUP-01A/BACKUP_INVENTORY.md).

Anadir un store nuevo (p. ej. identity.db cuando `identity_sqlite` pase a
`enabled`) es solo anadir una entrada aqui. Los runners no llevan rutas
hardcodeadas.
"""

from dataclasses import dataclass, field

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
