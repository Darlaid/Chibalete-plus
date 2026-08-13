"""Capacity preflight y contabilidad local de presupuesto Class B.

CHP-BACKUP-CAPACITY-01B. Motivo (diagnostico 01A): cuatro gates productivos se
bloquearon contra el cap diario Class B de B2 y el runner clasificaba la firma
del cap como `config_absent` (la aguja de config-ausente se evaluaba antes que
la de acceso-denegado sobre el stderr «unable to open config file: Stat:
Access Denied»). Este modulo:

  1. clasifica el estado del repositorio con COSTE REMOTO ACOTADO:
     camino sano = 1 GET (`cat config`); camino de fallo = +1 LIST firmado;
     jamas snapshots exhaustivos, stats, check, restore ni backup;
  2. separa REPOSITORY_ACCESS de ESTIMATED_BUDGET: un repo accesible con
     presupuesto sin declarar es `repository=GREEN, budget=UNKNOWN`, nunca un
     RED inventado;
  3. contabiliza consumo ESTIMADO (cost_source=estimated, jamas presentado
     como consumo real de la consola B2) contra un presupuesto opcional;
  4. escribe `status.json` de forma atomica, 0600, sin secretos ni PII.

Fail-safe: para un GATE DE MUTACION cualquier estado no demostrado se trata
como bloqueante (RED); para observacion, los estados se reportan tal cual.
"""

import enum
import json
import os
import tempfile
import time

from .errors import ConfigError
from .s3_preflight import RemoteState

STATUS_SCHEMA_VERSION = "capacity-status/1"

# Ubicacion productiva PROPUESTA (se crea en el deploy de 01B, no antes).
DEFAULT_STATUS_PATH = "/var/backups/chibalete-backup/status.json"

# Coste Class B estimado de las operaciones del PROPIO preflight.
PREFLIGHT_GET_COST = 1      # restic cat config -> 1 GET del objeto config
PREFLIGHT_LIST_COST = 0     # ListObjectsV2 es Class C en B2: no consume Class B


class RepositoryVerdict(str, enum.Enum):
    GREEN = "GREEN"
    RED = "RED"
    UNKNOWN = "UNKNOWN"


class BudgetVerdict(str, enum.Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"
    UNKNOWN = "UNKNOWN"


class GateVerdict(str, enum.Enum):
    GREEN = "GREEN"
    YELLOW = "YELLOW"
    RED = "RED"


class Classification(str, enum.Enum):
    HEALTHY = "HEALTHY"
    AUTH_FAILURE = "AUTH_FAILURE"
    CLASS_B_CAP = "CLASS_B_CAP"
    NETWORK = "NETWORK"
    BUCKET_FAILURE = "BUCKET_FAILURE"
    REPOSITORY_FAILURE = "REPOSITORY_FAILURE"
    LOCK = "LOCK"
    CONFIG_ERROR = "CONFIG_ERROR"
    BUDGET_PRESSURE = "BUDGET_PRESSURE"
    UNKNOWN = "UNKNOWN"


# ---------------------------------------------------------------------------
# Clasificacion del stderr de `restic cat config` — ORDEN CORREGIDO
# ---------------------------------------------------------------------------
#
# La firma real del cap Class B observada en produccion (4 veces) es:
#
#   Fatal: unable to open config file: Stat: Access Denied.
#
# Contiene A LA VEZ «unable to open config» y «access denied». El clasificador
# historico (`classify_restic_stderr`) evalua config-ausente antes que
# acceso-denegado y por eso etiquetaba el cap como `config_absent`. Aqui las
# agujas de DENEGACION se evaluan PRIMERO: una denegacion explicita es mas
# especifica que la imposibilidad de abrir el objeto.

_DENIED_NEEDLES = ("access denied", "accessdenied", "invalidaccesskeyid",
                   "signaturedoesnotmatch", "unauthorized", "403")
_CONFIG_ABSENT_NEEDLES = ("config does not exist", "unable to open config",
                          "no such file", "repository does not exist",
                          "is not a repository")
_NETWORK_NEEDLES = ("no such host", "connection refused", "i/o timeout", "dial tcp",
                    "tls:", "certificate", "timeout", "temporary failure")
_CORRUPT_NEEDLES = ("wrong password", "invalid password", "decrypt",
                    "ciphertext verification failed", "invalid data returned",
                    "unexpected content", "corrupt")


def classify_cat_config_stderr(stderr: str | None) -> str:
    """Etiqueta sanitizada del fallo de `cat config`, con la denegacion primero.

    Devuelve: denied | config_absent | network | corrupt_or_password |
    no_output | unclassified. Nunca devuelve texto del stderr crudo.
    """
    text = (stderr or "").lower()
    if not text.strip():
        return "no_output"
    for needle in _DENIED_NEEDLES:
        if needle in text:
            return "denied"
    for needle in _NETWORK_NEEDLES:
        if needle in text:
            return "network"
    for needle in _CORRUPT_NEEDLES:
        if needle in text:
            return "corrupt_or_password"
    for needle in _CONFIG_ABSENT_NEEDLES:
        if needle in text:
            return "config_absent"
    return "unclassified"


def classify_repository(cat_rc: int, cat_stderr: str | None,
                        list_state: RemoteState | None,
                        list_object_count: int | None = None):
    """Combina el GET de `cat config` con la evidencia del LIST firmado.

    Regla central (aprendida en produccion): LIST=200 NO es prueba suficiente
    de nada por si solo. La discriminacion decisiva del cap Class B es:
    denegacion en el GET de contenido MIENTRAS el listado autenticado funciona
    y muestra objetos del repositorio.

    @returns (RepositoryVerdict, Classification, hint)
    """
    if cat_rc == 0:
        return RepositoryVerdict.GREEN, Classification.HEALTHY, "ok"

    hint = classify_cat_config_stderr(cat_stderr)

    if hint == "network" and list_state in (None, RemoteState.NETWORK_OR_TLS_ERROR):
        return RepositoryVerdict.UNKNOWN, Classification.NETWORK, hint
    if list_state is None:
        # cat fallo y no hay evidencia de LIST: no se puede afirmar nada.
        return RepositoryVerdict.UNKNOWN, Classification.UNKNOWN, hint

    if list_state is RemoteState.NETWORK_OR_TLS_ERROR:
        return RepositoryVerdict.UNKNOWN, Classification.NETWORK, hint
    if list_state is RemoteState.ACCESS_DENIED:
        # Ni listar ni leer: credencial invalida/revocada (el cap Class B jamas
        # bloquea el LIST, que es Class C).
        return RepositoryVerdict.RED, Classification.AUTH_FAILURE, hint
    if list_state is RemoteState.BUCKET_NOT_FOUND:
        return RepositoryVerdict.RED, Classification.BUCKET_FAILURE, hint
    if list_state is RemoteState.ENDPOINT_OR_REGION_MISMATCH:
        return RepositoryVerdict.RED, Classification.CONFIG_ERROR, hint

    if list_state is RemoteState.FOREIGN_OBJECTS_PRESENT:
        # Hay objetos bajo el prefijo (el repo esta ahi) pero el GET fallo.
        if hint in ("denied", "config_absent"):
            # La firma del cap incluye «Access Denied»; algunos transportes la
            # resumen como imposibilidad de abrir config. Con LIST 200+objetos
            # ambas formas son el mismo hecho: contenido ilegible por cuota.
            # `denied` es evidencia directa; `config_absent` con objetos
            # presentes se trata igual SOLO si el stderr menciono denegacion
            # (ya cubierto por el orden) — un config genuinamente ausente cae
            # en REPOSITORY_FAILURE mas abajo.
            if hint == "denied":
                return RepositoryVerdict.RED, Classification.CLASS_B_CAP, hint
            return RepositoryVerdict.RED, Classification.REPOSITORY_FAILURE, hint
        if hint == "corrupt_or_password":
            return RepositoryVerdict.RED, Classification.REPOSITORY_FAILURE, hint
        return RepositoryVerdict.UNKNOWN, Classification.UNKNOWN, hint

    if list_state is RemoteState.EMPTY_APPROVED_PREFIX:
        # El prefijo esta VACIO y el repo deberia existir: fallo de repositorio
        # (perdida/borrado), jamas «inicializable» desde aqui.
        return RepositoryVerdict.RED, Classification.REPOSITORY_FAILURE, hint

    return RepositoryVerdict.UNKNOWN, Classification.UNKNOWN, hint


# ---------------------------------------------------------------------------
# Presupuesto (siempre ESTIMADO — cost_source=estimated)
# ---------------------------------------------------------------------------

def evaluate_budget(budget: int | None, reserve: int | None,
                    estimated_today: int) -> tuple[BudgetVerdict, str]:
    """Estado del presupuesto. Sin declarar => UNKNOWN (no bloquea).

    Con presupuesto declarado:
      estimado >= budget            -> RED   (presion demostrada por estimacion)
      estimado >= budget - reserve  -> YELLOW (la reserva de emergencia esta
                                               siendo invadida)
      resto                         -> GREEN
    """
    if budget is None:
        return BudgetVerdict.UNKNOWN, "budget_not_configured"
    if estimated_today >= budget:
        return BudgetVerdict.RED, "estimated_over_budget"
    if estimated_today >= budget - (reserve or 0):
        return BudgetVerdict.YELLOW, "estimated_into_reserve"
    return BudgetVerdict.GREEN, "estimated_within_budget"


def gate_verdict(repo: RepositoryVerdict, classification: Classification,
                 budget: BudgetVerdict) -> GateVerdict:
    """Veredicto para GATES DE MUTACION. Fail-closed ante lo no demostrado.

    - repo GREEN + budget GREEN/UNKNOWN -> GREEN (F6: budget sin declarar no
      inventa un RED);
    - repo GREEN + budget YELLOW       -> YELLOW;
    - NETWORK / LOCK                   -> YELLOW (transitorio, reintentable);
    - todo lo demas (cap, auth, bucket, repo, config, budget RED, UNKNOWN)
      -> RED.
    """
    if classification in (Classification.NETWORK, Classification.LOCK):
        return GateVerdict.YELLOW
    if repo is RepositoryVerdict.GREEN:
        if budget in (BudgetVerdict.GREEN, BudgetVerdict.UNKNOWN):
            return GateVerdict.GREEN
        if budget is BudgetVerdict.YELLOW:
            return GateVerdict.YELLOW
        return GateVerdict.RED
    return GateVerdict.RED


# ---------------------------------------------------------------------------
# status.json — escritura atomica, sin secretos, contabilidad honesta
# ---------------------------------------------------------------------------

STATUS_FIELDS = (
    "schema_version", "generated_at", "last_structured_success",
    "last_uploads_success", "last_verify_success", "last_snapshot_short",
    "last_duration_seconds", "runs_today", "quota_blocks_today",
    "last_authenticated_repo_read", "next_timer", "repository_state",
    "budget_state", "estimated_class_b_cost_today", "cost_source",
    "config_budget", "config_reserve",
)


def _utc_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _utc_day(ts: str | None) -> str | None:
    return ts[:10] if isinstance(ts, str) and len(ts) >= 10 else None


def load_status(path: str) -> dict:
    """Lee el status previo. Ilegible/ausente => estado vacio (no lanza)."""
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_status(path: str, status: dict) -> str:
    """Escritura atomica (temp + os.replace) con modo 0600.

    Rechaza claves fuera del schema: el status es un contrato, no un cajon.
    """
    unknown = set(status) - set(STATUS_FIELDS)
    if unknown:
        raise ValueError(f"claves fuera del schema de status: {sorted(unknown)}")
    payload = {"schema_version": STATUS_SCHEMA_VERSION, **status}
    payload.setdefault("generated_at", _utc_now())
    payload.setdefault("cost_source", "estimated")
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".status-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, indent=1, sort_keys=True, ensure_ascii=True) + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return path


def rollover_daily_counters(previous: dict, now_utc: str | None = None) -> dict:
    """Reinicia contadores diarios si cambio el dia UTC. Devuelve copia."""
    now_utc = now_utc or _utc_now()
    out = dict(previous)
    if _utc_day(previous.get("generated_at")) != _utc_day(now_utc):
        out["runs_today"] = 0
        out["quota_blocks_today"] = 0
        out["estimated_class_b_cost_today"] = 0
    return out


def record_activity(previous: dict, *, runs: int = 0, quota_blocks: int = 0,
                    estimated_cost: int = 0, now_utc: str | None = None) -> dict:
    """Acumula actividad en los contadores diarios (siempre ESTIMADO)."""
    now_utc = now_utc or _utc_now()
    out = rollover_daily_counters(previous, now_utc)
    out["runs_today"] = int(out.get("runs_today") or 0) + runs
    out["quota_blocks_today"] = int(out.get("quota_blocks_today") or 0) + quota_blocks
    out["estimated_class_b_cost_today"] = (
        int(out.get("estimated_class_b_cost_today") or 0) + estimated_cost)
    out["generated_at"] = now_utc
    out["cost_source"] = "estimated"
    return out


def build_preflight_report(*, repo: RepositoryVerdict, classification: Classification,
                           hint: str, budget_verdict: BudgetVerdict, budget_reason: str,
                           verdict: GateVerdict, budget: int | None, reserve: int | None,
                           estimated_today: int, remote_ops_used: int) -> dict:
    """Reporte sanitizado del preflight (apto para journal y para el gate)."""
    return {
        "component": "capacity-preflight",
        "repository_state": repo.value,
        "classification": classification.value,
        "hint": hint,
        "budget_state": budget_verdict.value,
        "budget_reason": budget_reason,
        "verdict": verdict.value,
        "config_budget": budget,
        "config_reserve": reserve,
        "estimated_class_b_cost_today": estimated_today,
        "cost_source": "estimated",
        "remote_ops_used": remote_ops_used,
    }
