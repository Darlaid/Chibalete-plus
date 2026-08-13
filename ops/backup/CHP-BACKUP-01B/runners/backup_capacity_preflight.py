#!/usr/bin/env python3
"""Runner D — capacity preflight de B2/restic (CHP-BACKUP-CAPACITY-01B).

Responde ANTES de un gate de deploy/migracion, con coste remoto acotado:

    GREEN   repositorio legible y presupuesto dentro de margen (o sin declarar)
    YELLOW  transitorio (red, lock) o reserva de emergencia invadida
    RED     cap Class B, credencial, bucket, repositorio o config: gate cerrado

Coste remoto MAXIMO por invocacion:
    camino sano   -> 1 GET  (restic cat config)
    camino fallo  -> 1 GET + 1 LIST firmado (ListObjectsV2, Class C en B2)

Jamas ejecuta snapshots, stats, check, restore ni backup. La allowlist del
wrapper (chibalete_backup/restic.py) sigue vigente por debajo.

Salida: JSON sanitizado en stdout. Exit code: 0=GREEN, 1=YELLOW, 2=RED.

Uso:
    backup_capacity_preflight.py [--status-path P] [--no-status] [--json]
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from chibalete_backup.capacity import (  # noqa: E402
    DEFAULT_STATUS_PATH,
    PREFLIGHT_GET_COST,
    PREFLIGHT_LIST_COST,
    BudgetVerdict,
    Classification,
    GateVerdict,
    RepositoryVerdict,
    build_preflight_report,
    classify_repository,
    evaluate_budget,
    gate_verdict,
    load_status,
    record_activity,
    write_status,
)
from chibalete_backup.config import DEFAULT_CONFIG_DIR, load_config  # noqa: E402
from chibalete_backup.errors import BackupError, ConfigError, LockBusy  # noqa: E402
from chibalete_backup.locking import DEFAULT_LOCK_PATH, SharedLock  # noqa: E402
from chibalete_backup.restic import Restic  # noqa: E402
from chibalete_backup.s3_preflight import (  # noqa: E402
    parse_target,
    probe_approved_prefix,
)
from chibalete_backup.safelog import SafeLogger  # noqa: E402
from chibalete_backup.manifest import new_run_id  # noqa: E402

EXIT_BY_VERDICT = {GateVerdict.GREEN: 0, GateVerdict.YELLOW: 1, GateVerdict.RED: 2}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Capacity preflight B2/restic")
    parser.add_argument("--config-dir", default=DEFAULT_CONFIG_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--lock-path", default=DEFAULT_LOCK_PATH, help=argparse.SUPPRESS)
    parser.add_argument("--status-path", default=DEFAULT_STATUS_PATH,
                        help="ruta de status.json (contabilidad local estimada)")
    parser.add_argument("--no-status", action="store_true",
                        help="no leer ni escribir status.json")
    return parser


def probe(config, log):
    """Sonda remota acotada. Devuelve (repo, classification, hint, ops_usadas)."""
    restic = Restic(config, log)
    proc = restic.run(["cat", "config"], check=False)
    ops = PREFLIGHT_GET_COST
    if proc.returncode == 0:
        repo, cls, hint = classify_repository(0, None, None)
        return repo, cls, hint, ops

    # Solo en el camino de fallo se gasta el LIST (Class C) para discriminar.
    list_state, list_count = None, None
    try:
        target = parse_target(config.restic_env())
        result = probe_approved_prefix(target)
        log.info("s3_preflight", **result.as_log_fields())
        list_state, list_count = result.state, result.object_count
        ops += PREFLIGHT_LIST_COST
    except ConfigError as exc:
        log.error("preflight_config_error", detail=str(exc))
        return RepositoryVerdict.RED, Classification.CONFIG_ERROR, "config", ops

    repo, cls, hint = classify_repository(proc.returncode, proc.stderr,
                                          list_state, list_count)
    return repo, cls, hint, ops


def run(args) -> int:
    run_id = new_run_id("capacity")
    log = SafeLogger(run_id, "capacity")

    # CONFIG_ERROR es fail-closed: sin contrato valido no hay gate.
    try:
        config = load_config(args.config_dir)
        budget, reserve = config.validate_budget()
    except ConfigError as exc:
        log.error("preflight_config_error", detail=str(exc))
        report = build_preflight_report(
            repo=RepositoryVerdict.UNKNOWN, classification=Classification.CONFIG_ERROR,
            hint="config", budget_verdict=BudgetVerdict.UNKNOWN,
            budget_reason="config_invalid", verdict=GateVerdict.RED,
            budget=None, reserve=None, estimated_today=0, remote_ops_used=0)
        print(json.dumps(report, sort_keys=True))
        return EXIT_BY_VERDICT[GateVerdict.RED]

    status = {} if args.no_status else load_status(args.status_path)

    # LOCK ocupado = otro job de backup en curso: transitorio, sin gastar red.
    try:
        with SharedLock(args.lock_path):
            repo, cls, hint, ops = probe(config, log)
    except LockBusy:
        repo, cls, hint, ops = (RepositoryVerdict.UNKNOWN, Classification.LOCK,
                                "lock_busy", 0)

    estimated_today = int(status.get("estimated_class_b_cost_today") or 0) + ops
    budget_verdict, budget_reason = evaluate_budget(budget, reserve, estimated_today)
    if budget_verdict in (BudgetVerdict.YELLOW, BudgetVerdict.RED) \
            and cls is Classification.HEALTHY:
        cls = Classification.BUDGET_PRESSURE

    verdict = gate_verdict(repo, cls, budget_verdict)
    report = build_preflight_report(
        repo=repo, classification=cls, hint=hint,
        budget_verdict=budget_verdict, budget_reason=budget_reason,
        verdict=verdict, budget=budget, reserve=reserve,
        estimated_today=estimated_today, remote_ops_used=ops)
    log.info("capacity_preflight", **{k: v for k, v in report.items()
                                      if k != "component"})

    if not args.no_status:
        updated = record_activity(
            status, runs=0,
            quota_blocks=1 if cls is Classification.CLASS_B_CAP else 0,
            estimated_cost=ops)
        updated["repository_state"] = repo.value
        updated["budget_state"] = budget_verdict.value
        updated["config_budget"] = budget
        updated["config_reserve"] = reserve
        if repo is RepositoryVerdict.GREEN:
            updated["last_authenticated_repo_read"] = updated["generated_at"]
        # Un status.json previo puede traer claves ajenas al schema (versiones
        # futuras, edicion manual): se filtra al contrato antes de escribir.
        from chibalete_backup.capacity import STATUS_FIELDS
        allowed = {k: v for k, v in updated.items() if k in STATUS_FIELDS}
        try:
            write_status(args.status_path, allowed)
        except (OSError, ValueError) as exc:
            log.warn("status_write_failed", detail=str(exc))

    print(json.dumps(report, sort_keys=True))
    return EXIT_BY_VERDICT[verdict]


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return run(args)
    except BackupError as exc:
        SafeLogger("-", "capacity", stream=sys.stderr).error(
            "run_failed", error_type=type(exc).__name__, message=str(exc))
        return EXIT_BY_VERDICT[GateVerdict.RED]
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
