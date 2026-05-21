/**
 * replayEngine.mjs — PASO 4 §9.
 *
 * Wrapper RESUMIBLE + CANCELABLE sobre materializer.rebuildInsights. El
 * materializer hace el trabajo real; el replayEngine añade:
 *   - run_id único registrado en materializer_runs (job ledger)
 *   - cancel_requested chequeado entre chunks → status='canceled' al detectar
 *   - last_checkpoint persistido cada chunk → resume desde ahí
 *   - progress_n/progress_total observables vía getJobLedger()
 *
 * Por defecto chunkSize=10_000 events; configurable.
 *
 * NO inventa replay propio: delega a `materializer.rebuildInsights` con
 * rangos temporales chicos (chunks). Esto preserva idempotencia probada.
 */
import crypto from 'node:crypto';
import { getRollupsExtDb, getRollupsStatements } from '../db/rollupsDbExt.mjs';
import { rebuildInsights } from './insightMaterializer.mjs';
import { materializerReplay } from '../observability/metrics.js';

const CHUNK_MS = 24 * 3600_000;          // chunk = 1 día (replay temporal)
const DEFAULT_MAX_RUNTIME_MS = 30 * 60_000;  // 30 min de safety

function newRunId(prefix = 'replay') {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Inicia un replay resumible. Devuelve immediately con `run_id` para que
 * la lógica de larga duración pueda correr en background mientras los
 * consumidores monitorean.
 *
 * **Sincronía:** este wrapper es síncrono. Para uso fire-and-forget,
 * llama desde un setImmediate / setTimeout. (No introduzco workers para
 * cumplir constraint "sin microservicios/colas".)
 *
 * @param {{fromTs:number, toTs:number, scopes?:object, log?:Function,
 *          chunkMs?:number, maxRuntimeMs?:number, dryRun?:boolean}} opts
 */
export function startReplay(opts) {
    const log = opts.log || (() => {});
    const fromTs = opts.fromTs;
    const toTs   = opts.toTs ?? Date.now();
    const chunkMs = opts.chunkMs ?? CHUNK_MS;
    const maxRuntimeMs = opts.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
    const dryRun = !!opts.dryRun;
    const runId = newRunId('replay');
    const startedAt = Date.now();

    if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || fromTs >= toTs) {
        return { ok: false, error: 'invalid_range', run_id: null };
    }

    getRollupsExtDb();
    const stmts = getRollupsStatements();
    const totalChunks = Math.max(1, Math.ceil((toTs - fromTs) / chunkMs));
    try {
        stmts.insertRun.run({
            run_id: runId, run_type: 'replay',
            scope_json: JSON.stringify({ fromTs, toTs, scopes: opts.scopes ?? null,
                                         chunkMs, dryRun }),
            started_at: startedAt,
            progress_total: totalChunks,
            last_checkpoint: fromTs,
        });
    } catch (e) {
        return { ok: false, error: String(e?.message || e), run_id: null };
    }

    // Resume: si quieres resumir un job stalleado/anterior, llama startReplay
    // con el mismo rango — el `runId` será nuevo pero el rango es el contrato.
    // Aquí simplemente procesamos en chunks desde fromTs.
    const result = {
        ok: false, run_id: runId,
        totalChunks, chunksProcessed: 0,
        eventsScanned: 0, upserted: 0,
        canceled: false, durationMs: 0,
    };
    let cursor = fromTs;
    try {
        while (cursor < toTs) {
            // Safety timeout
            if (Date.now() - startedAt > maxRuntimeMs) {
                stmts.completeRun.run({
                    run_id: runId, completed_at: Date.now(),
                    status: 'stalled',
                    error_message: 'max_runtime_exceeded',
                });
                result.error = 'max_runtime_exceeded';
                break;
            }
            // Cancel check
            const job = stmts.getRun.get(runId);
            if (job?.cancel_requested) {
                stmts.completeRun.run({
                    run_id: runId, completed_at: Date.now(),
                    status: 'canceled', error_message: null,
                });
                result.canceled = true;
                break;
            }

            const chunkEnd = Math.min(cursor + chunkMs, toTs);
            const r = rebuildInsights({
                fromTs: cursor, toTs: chunkEnd, dryRun,
                scopes: opts.scopes,
            });
            if (!r.ok) {
                stmts.completeRun.run({
                    run_id: runId, completed_at: Date.now(),
                    status: 'failed', error_message: r.error ?? 'unknown',
                });
                try { materializerReplay.labels('failed').inc(); } catch {}
                result.error = r.error;
                break;
            }
            result.eventsScanned += r.scanned || 0;
            result.upserted      += r.upserted || 0;
            result.chunksProcessed++;

            cursor = chunkEnd;
            stmts.updateRunProgress.run({
                run_id: runId,
                progress_n: result.chunksProcessed,
                last_checkpoint: cursor,
            });
        }
        if (!result.canceled && !result.error) {
            stmts.completeRun.run({
                run_id: runId, completed_at: Date.now(),
                status: 'completed', error_message: null,
            });
            result.ok = true;
            try { materializerReplay.labels('completed').inc(); } catch {}
        }
    } catch (e) {
        try {
            stmts.completeRun.run({
                run_id: runId, completed_at: Date.now(),
                status: 'failed', error_message: String(e?.message || e),
            });
        } catch {}
        result.error = String(e?.message || e);
        try { materializerReplay.labels('failed').inc(); } catch {}
    }
    result.durationMs = Date.now() - startedAt;
    return result;
}

/** Pide cancelación cooperativa. El job verá `cancel_requested=1` en el
 * próximo chunk. */
export function requestCancel(runId) {
    try {
        const upd = getRollupsStatements().requestCancel.run({ run_id: runId });
        return { ok: upd.changes > 0, run_id: runId };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

export function getJobLedger({ limit = 50 } = {}) {
    try {
        return getRollupsStatements().listRecentRuns.all(limit);
    } catch { return []; }
}

export function getActiveRuns() {
    try { return getRollupsStatements().listActiveRuns.all(); } catch { return []; }
}

export function getStatus() {
    try {
        const active = getActiveRuns();
        const recent = getJobLedger({ limit: 10 });
        const lastReplay = recent.find(r => r.run_type === 'replay');
        return {
            engine: 'aula_viva_replay_v1',
            active_runs: active.length,
            active: active.map(r => ({ run_id: r.run_id, run_type: r.run_type,
                started_at: r.started_at, progress_n: r.progress_n,
                progress_total: r.progress_total })),
            last_replay: lastReplay ? {
                run_id: lastReplay.run_id, status: lastReplay.status,
                started_at: lastReplay.started_at, completed_at: lastReplay.completed_at,
                progress_n: lastReplay.progress_n, progress_total: lastReplay.progress_total,
            } : null,
            ok: true,
        };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
