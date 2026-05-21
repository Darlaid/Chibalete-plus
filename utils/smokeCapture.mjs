/**
 * smokeCapture.mjs — Runner operacional para smokes A–G (M-5.4.2).
 *
 * NO es código de producción ni de runtime. Es un instrumento de validación
 * que se activa por consola durante una sesión de smoke real, captura logs
 * relevantes + snapshots periódicos + memoria, y emite un JSON estructurado
 * listo para pegar en `docs/M5.4-operational-findings.md`.
 *
 * Restricciones:
 *   - Solo se monta cuando los `window.__pb*` ya están expuestos (dev/flag).
 *   - Restaura console.warn / console.error / console.log al terminar.
 *   - NO toca el runtime ni el watchdog ni el visor — leech-only.
 *   - NO captura datos del usuario (no lee localStorage, no toca cookies).
 *
 * Uso (desde DevTools console):
 *
 *   __pbSmokeCapture.start({ smoke: 'A', operator: 'nico', notes: 'Alicia 15min' });
 *   // ... operador interactúa con el visor durante el smoke ...
 *   __pbSmokeCapture.note('vi un pequeño hiccup al minuto 7');
 *   // ... más interacción ...
 *   const result = __pbSmokeCapture.stop();
 *   copy(JSON.stringify(result, null, 2));   // → portapapeles → pegar en findings
 *
 * Cuando ya hay una corrida en curso, start() la cancela primero (warning).
 *
 * ──────────────────────────────────────────────────────────────────────────
 */

const MAX_WARNING_TIMELINE = 500;
const MAX_NOTES            = 200;

/** Tags clasificados como CRITICAL en el wire-up. Mantener sincronizado con
 *  pages/VisorInmersivo.tsx (SEVERITY map del watchdog wiring). */
const CRITICAL_TAGS = new Set([
    'WATCHDOG_DUPLICATE_OWNERSHIP',
    'WATCHDOG_DESYNC_WARNING',
    'WATCHDOG_HARD_RESYNC_CASCADE',
    'WATCHDOG_DIAGNOSTICS_THREW',
    'WATCHDOG_CRITICAL_WARNING',
    'OWNERSHIP_VIOLATION',
    'AUDIO_SPLIT_BRAIN',
    'FATAL_MISMATCH',
]);

const RECOVERABLE_TAGS = new Set([
    'WATCHDOG_STALLED_AUDIO',
    'WATCHDOG_STALLED_VISUAL',
    'WATCHDOG_TIMER_LEAK',
    'WATCHDOG_CACHE_RUNAWAY',
    'WATCHDOG_RECOVERABLE_WARNING',
    'MEMORY_PRESSURE_WARNING',
    'MEMORY_GROWTH_WARNING',
    'CACHE_GROWTH_WARNING',
    'PB_HARD_RESYNC',
]);

/** Extrae el tag `[TAG_NAME]` del primer argumento de un console call. */
function extractTag(args) {
    if (!args || args.length === 0) return null;
    const first = args[0];
    if (typeof first !== 'string') return null;
    const m = first.match(/^\s*\[([A-Z][A-Z0-9_]+)\]/);
    return m ? m[1] : null;
}

function severityOf(tag) {
    if (!tag) return 'info';
    if (CRITICAL_TAGS.has(tag))    return 'critical';
    if (RECOVERABLE_TAGS.has(tag)) return 'recoverable';
    return 'info';
}

function isoNow() { return new Date().toISOString(); }

/**
 * Crea una instancia de smoke capture. La factory permite testearla en node
 * inyectando un `consoleRef` mock.
 *
 * @param {object} [opts]
 * @param {Console} [opts.consoleRef]  default: globalThis.console
 * @param {() => any} [opts.diagFn]    default: window.__pbDiag
 * @param {() => any} [opts.memFn]     default: window.__pbMemory
 * @param {() => any} [opts.wdFn]      default: window.__pbWatchdog
 * @returns {SmokeCaptureApi}
 */
export function createSmokeCapture(opts = {}) {
    const consoleRef = opts.consoleRef
        || (typeof globalThis !== 'undefined' && globalThis.console)
        || /** @type {Console} */ ({});
    const diagFn = opts.diagFn || ((typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).__pbDiag)
        ? () => /** @type {any} */ (globalThis).__pbDiag() : null);
    const memFn  = opts.memFn  || ((typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).__pbMemory)
        ? () => /** @type {any} */ (globalThis).__pbMemory() : null);
    const wdFn   = opts.wdFn   || ((typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).__pbWatchdog)
        ? () => /** @type {any} */ (globalThis).__pbWatchdog() : null);

    /** @type {SmokeRun|null} */
    let run = null;

    function _intercept(level, originalFn, ...args) {
        try {
            const tag = extractTag(args);
            if (tag && run && run.active) {
                run.eventCounts[tag] = (run.eventCounts[tag] || 0) + 1;
                const sev = severityOf(tag);
                if (sev !== 'info') {
                    const entry = {
                        at:       isoNow(),
                        tag,
                        severity: sev,
                        level,
                        // Solo serializamos args[1] (el data object) si es plano.
                        data:     _safeData(args[1]),
                    };
                    if (run.warningTimeline.length < MAX_WARNING_TIMELINE) {
                        run.warningTimeline.push(entry);
                    } else if (run.warningTimelineOverflow === false) {
                        run.warningTimelineOverflow = true;
                    }
                    if (sev === 'critical') run.criticalCount += 1;
                    if (sev === 'recoverable') run.recoverableCount += 1;
                }
            }
        } catch { /* defensivo */ }
        // Siempre delegar al original — NO suprimir output del operador.
        try { originalFn.apply(consoleRef, args); } catch { /* */ }
    }

    function _safeData(obj) {
        if (!obj || typeof obj !== 'object') return obj === undefined ? null : obj;
        try {
            // Round-trip JSON: evita Error objects, DOM nodes, circulares.
            return JSON.parse(JSON.stringify(obj));
        } catch {
            return { _unserializable: true };
        }
    }

    function _snapshotTick() {
        if (!run || !run.active) return;
        const at = isoNow();
        if (diagFn) {
            try {
                const diag = diagFn();
                if (diag && typeof diag === 'object') {
                    run.snapshots.push({ at, diag: _safeData(diag) });
                }
            } catch (err) {
                run.snapshotErrors += 1;
            }
        }
        if (memFn) {
            try {
                const mem = memFn();
                if (mem && typeof mem === 'object') {
                    run.memorySnapshots.push({ at, mem: _safeData(mem) });
                }
            } catch (err) {
                run.snapshotErrors += 1;
            }
        }
    }

    function start(config = {}) {
        if (run && run.active) {
            consoleRef.warn('[__pbSmokeCapture] una corrida ya está activa — stop() la corrida anterior primero. Cancelando.');
            stop({ silent: true });
        }
        const snapshotIntervalMs = config.snapshotIntervalMs ?? 60_000;
        const startSnap = diagFn ? _safeData((() => { try { return diagFn(); } catch { return null; } })()) : null;
        const startMem  = memFn  ? _safeData((() => { try { return memFn();  } catch { return null; } })()) : null;
        run = {
            active:                true,
            header: {
                smoke:           config.smoke    || 'UNKNOWN',
                operator:        config.operator || null,
                build:           config.build    || null,
                notes:           config.notes    || null,
                startTime:       isoNow(),
                endTime:         null,
                durationMs:      0,
                snapshotIntervalMs,
            },
            eventCounts:           Object.create(null),
            warningTimeline:       [],
            warningTimelineOverflow: false,
            criticalCount:         0,
            recoverableCount:      0,
            snapshots:             startSnap ? [{ at: isoNow(), diag: startSnap, marker: 'start' }] : [],
            memorySnapshots:       startMem  ? [{ at: isoNow(), mem:  startMem,  marker: 'start' }] : [],
            notes:                 [],
            startTimestampMs:      Date.now(),
            snapshotErrors:        0,
            intervalHandle:        null,
            // Guardamos la referencia EXACTA — al restaurar volvemos al function
            // identity original (importante para tests y para no romper devtools).
            // El intercept usa `.apply(consoleRef, ...)` para preservar `this`.
            _origWarn:             consoleRef.warn  || null,
            _origError:            consoleRef.error || null,
            _origLog:              consoleRef.log   || null,
        };

        // Interceptar (no reemplazar) console.warn / console.error / console.log.
        if (run._origWarn)  consoleRef.warn  = (...a) => _intercept('warn',  run._origWarn,  ...a);
        if (run._origError) consoleRef.error = (...a) => _intercept('error', run._origError, ...a);
        if (run._origLog)   consoleRef.log   = (...a) => _intercept('log',   run._origLog,   ...a);

        // Snapshot interval — usar Date.now() para detectar throttling también.
        if (typeof setInterval === 'function') {
            run.intervalHandle = setInterval(_snapshotTick, snapshotIntervalMs);
        }

        const banner = `[__pbSmokeCapture] STARTED smoke=${run.header.smoke} operator=${run.header.operator || '—'} interval=${snapshotIntervalMs}ms`;
        if (run._origWarn) run._origWarn(banner);
        return run.header;
    }

    function note(text) {
        if (!run || !run.active) {
            consoleRef.warn('[__pbSmokeCapture] no hay corrida activa. note() ignorado.');
            return null;
        }
        if (run.notes.length >= MAX_NOTES) {
            consoleRef.warn('[__pbSmokeCapture] cap de notas alcanzado, descartando.');
            return null;
        }
        const entry = { at: isoNow(), text: String(text || '') };
        run.notes.push(entry);
        return entry;
    }

    function snapshot(marker) {
        if (!run || !run.active) {
            consoleRef.warn('[__pbSmokeCapture] no hay corrida activa. snapshot() ignorado.');
            return null;
        }
        const at = isoNow();
        let diag = null, mem = null;
        if (diagFn) { try { diag = _safeData(diagFn()); } catch { /* */ } }
        if (memFn)  { try { mem  = _safeData(memFn());  } catch { /* */ } }
        const entry = { at, marker: marker || 'manual', diag, mem };
        if (diag) run.snapshots.push({ at, diag, marker: marker || 'manual' });
        if (mem)  run.memorySnapshots.push({ at, mem,  marker: marker || 'manual' });
        return entry;
    }

    function status() {
        if (!run) return { active: false };
        return {
            active:            run.active,
            smoke:             run.header.smoke,
            operator:          run.header.operator,
            elapsedMs:         Date.now() - run.startTimestampMs,
            snapshots:         run.snapshots.length,
            memorySnapshots:   run.memorySnapshots.length,
            warningTimeline:   run.warningTimeline.length,
            warningTimelineOverflow: run.warningTimelineOverflow,
            criticalCount:     run.criticalCount,
            recoverableCount:  run.recoverableCount,
            distinctEvents:    Object.keys(run.eventCounts).length,
            snapshotErrors:    run.snapshotErrors,
            notes:             run.notes.length,
        };
    }

    function stop(stopOpts = {}) {
        if (!run || !run.active) {
            if (!stopOpts.silent) consoleRef.warn('[__pbSmokeCapture] no hay corrida activa.');
            return null;
        }

        // Restaurar console.* originales.
        if (run._origWarn)  consoleRef.warn  = run._origWarn;
        if (run._origError) consoleRef.error = run._origError;
        if (run._origLog)   consoleRef.log   = run._origLog;

        // Detener interval.
        if (run.intervalHandle != null) {
            try { clearInterval(run.intervalHandle); } catch { /* */ }
            run.intervalHandle = null;
        }

        // Snapshot final.
        const at = isoNow();
        const endTs = Date.now();
        run.header.endTime = at;
        run.header.durationMs = endTs - run.startTimestampMs;

        if (diagFn) {
            try {
                const diag = _safeData(diagFn());
                if (diag) run.snapshots.push({ at, diag, marker: 'stop' });
            } catch { run.snapshotErrors += 1; }
        }
        if (memFn) {
            try {
                const mem = _safeData(memFn());
                if (mem) run.memorySnapshots.push({ at, mem, marker: 'stop' });
            } catch { run.snapshotErrors += 1; }
        }

        const watchdogFinal = wdFn ? (() => { try { return _safeData(wdFn()); } catch { return null; } })() : null;
        const finalDiag     = run.snapshots.length > 0
            ? run.snapshots[run.snapshots.length - 1].diag : null;
        const startDiag     = run.snapshots.length > 0
            ? run.snapshots[0].diag : null;
        const finalMem      = run.memorySnapshots.length > 0
            ? run.memorySnapshots[run.memorySnapshots.length - 1].mem : null;
        const startMem      = run.memorySnapshots.length > 0
            ? run.memorySnapshots[0].mem : null;

        const deltas = computeDeltas(startDiag, finalDiag, startMem, finalMem, run.header.durationMs);
        const verdictHints = computeVerdictHints(run, finalDiag, deltas);

        const result = {
            header:                run.header,
            eventCounts:           { ...run.eventCounts },
            warningCounts: {
                critical:    run.criticalCount,
                recoverable: run.recoverableCount,
            },
            warningTimeline:       run.warningTimeline.slice(),
            warningTimelineOverflow: run.warningTimelineOverflow,
            snapshots:             run.snapshots.slice(),
            memorySnapshots:       run.memorySnapshots.slice(),
            notes:                 run.notes.slice(),
            snapshotErrors:        run.snapshotErrors,
            finalDiagnostics:      finalDiag,
            watchdogFinal,
            deltas,
            verdictHints,
        };

        run.active = false;

        if (run._origWarn) run._origWarn(`[__pbSmokeCapture] STOPPED smoke=${result.header.smoke} duration=${result.header.durationMs}ms critical=${result.warningCounts.critical} recoverable=${result.warningCounts.recoverable}`);
        return result;
    }

    return /** @type {SmokeCaptureApi} */ ({
        start, stop, note, snapshot, status,
    });
}

function computeDeltas(startDiag, finalDiag, startMem, finalMem, durationMs) {
    const num = (v) => (typeof v === 'number' ? v : 0);
    if (!finalDiag) return null;
    const cm0 = (startDiag && startDiag.cacheMetrics) || {};
    const cm1 = (finalDiag && finalDiag.cacheMetrics) || {};
    const ot0 = (startDiag && startDiag.ownershipTokens) || {};
    const ot1 = (finalDiag && finalDiag.ownershipTokens) || {};

    const heapStart = startMem && typeof startMem.heapUsed === 'number' ? startMem.heapUsed : null;
    const heapEnd   = finalMem && typeof finalMem.heapUsed === 'number' ? finalMem.heapUsed : null;
    const heapGrowthBytes = (heapStart != null && heapEnd != null) ? heapEnd - heapStart : null;

    return {
        cacheCreatedDelta:         num(cm1.created)  - num(cm0.created),
        cacheReusedDelta:          num(cm1.reused)   - num(cm0.reused),
        cacheEvictedDelta:         num(cm1.evicted)  - num(cm0.evicted),
        cacheRevokedDelta:         num(cm1.revoked)  - num(cm0.revoked),
        cacheNetGrowth:            (num(cm1.created) - num(cm0.created)) - (num(cm1.evicted) - num(cm0.evicted)),
        cacheFinalSize:            num(finalDiag.cacheEntries?.audioCache),
        hardResyncDelta:           num(finalDiag.hardResyncCount) - num(startDiag && startDiag.hardResyncCount),
        executorSpawnDelta:        num(ot1.executorSpawnCount) - num(ot0.executorSpawnCount),
        ownershipViolationDelta:   num(ot1.ownershipViolationCount) - num(ot0.ownershipViolationCount),
        contentSessionDelta:       num(ot1.contentSession) - num(ot0.contentSession),
        heapGrowthBytes,
        heapGrowthMB:              heapGrowthBytes != null ? Math.round(heapGrowthBytes / 1024 / 1024) : null,
        durationMs:                durationMs,
    };
}

function computeVerdictHints(run, finalDiag, deltas) {
    if (!finalDiag || !deltas) {
        return { incomplete: true, reason: 'no_final_diagnostics' };
    }
    const isOwnershipClean   = (deltas.ownershipViolationDelta === 0);
    const isCacheStable      = (deltas.cacheFinalSize < 80);
    const hasCriticalEvents  = (run.criticalCount > 0);
    const hardResyncCapBroken = (deltas.hardResyncDelta > 2);
    const heapOK             = (deltas.heapGrowthMB == null || deltas.heapGrowthMB < 30);
    return {
        isOwnershipClean,
        isCacheStable,
        hasCriticalEvents,
        hardResyncCapBroken,
        heapOK,
        passes: isOwnershipClean
             && isCacheStable
             && !hasCriticalEvents
             && !hardResyncCapBroken
             && heapOK,
    };
}

/**
 * @typedef {object} SmokeCaptureApi
 * @property {(config?: {smoke?: string, operator?: string, build?: string, notes?: string, snapshotIntervalMs?: number}) => object} start
 * @property {(opts?: {silent?: boolean}) => object|null} stop
 * @property {(text: string) => object|null} note
 * @property {(marker?: string) => object|null} snapshot
 * @property {() => object} status
 *
 * @typedef {object} SmokeRun
 * @property {boolean} active
 * @property {object}  header
 * @property {Record<string, number>} eventCounts
 * @property {Array<object>} warningTimeline
 * @property {boolean} warningTimelineOverflow
 * @property {number}  criticalCount
 * @property {number}  recoverableCount
 * @property {Array<object>} snapshots
 * @property {Array<object>} memorySnapshots
 * @property {Array<object>} notes
 * @property {number}  startTimestampMs
 * @property {number}  snapshotErrors
 * @property {any}     intervalHandle
 * @property {Function|null} _origWarn
 * @property {Function|null} _origError
 * @property {Function|null} _origLog
 */
