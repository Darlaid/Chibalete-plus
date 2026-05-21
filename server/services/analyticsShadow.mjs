/**
 * analyticsShadow.mjs — Phase-1 SHADOW formal hacia events.db (canon).
 *
 * Convive con el dual-write Fase-0 ya implementado en server.js
 * (`dualWriteAnalyticsEventsToBackbone`). NO lo reemplaza. Ofrece:
 *
 *   1. recordCanonicalEvent(env, log) — única entrada NUEVA validada por
 *      eventRegistry → insertEvent. Recovery-first: si validación falla
 *      NO se pierde el evento; se inserta marcado `__validation_failed`
 *      para auditoría → la historia pedagógica nunca se cae silenciosamente.
 *   2. consistencyCheck() — divergencia eventId-a-eventId entre
 *      analytics_db.json (cola) y events.db (canon) → criterio operacional
 *      de cutover (FASE 3) y señal del healthcheck.
 *   3. throughput(min) + divergenceReport() — alimentan /api/health/analytics.
 *
 * NUNCA lanza al caller; usar try/catch internos + métricas.
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as eventsService from '../eventsService.js';

// Inyectable solo para tests: permite mockear insertEvent sin tocar la DB.
let _insertOverride = null;
export function setInserterForTest(fn) { _insertOverride = (typeof fn === 'function') ? fn : null; }
import { validateEvent, describeEvent } from '../analytics/eventRegistry.js';
import {
    eventsRecorded, eventValidationFailures, payloadSchemaVersion,
    unsupportedEventTypes,
} from '../observability/metrics.js';

const __dirname     = path.dirname(fileURLToPath(import.meta.url));
const ANALYTICS_DB  = path.resolve(__dirname, '..', '..', 'data', 'analytics_db.json');

/**
 * Inserta un evento CANÓNICO en events.db. NUNCA pierde el evento.
 * @param {object} env  envelope { eventId, event, mode, userId, contentId?,
 *                                  sessionId, clientTs?, payload?, version? }
 * @param {(msg:string,type?:string)=>void} [log]
 * @returns {{ ok:boolean, inserted:boolean, validated:boolean, code?:string,
 *             issues?:any[] }}
 */
export function recordCanonicalEvent(env, log = () => {}) {
    const out = { ok: false, inserted: false, validated: false };
    if (!env || typeof env !== 'object') {
        return { ...out, code: 'envelope_missing' };
    }
    const v = validateEvent(env.event, env.payload, env.version);
    out.validated = v.ok;
    out.code = v.ok ? undefined : v.code;
    out.issues = v.ok ? undefined : v.issues;

    // Recovery-first: si la validación falla NO descartamos. Insertamos con
    // marca de auditoría → el evento queda en el log canónico, la métrica
    // `event_validation_failures_total` lo cuenta para reparación posterior.
    const payloadOut = v.ok ? v.payload : { ...env.payload, __validation_failed: v.code, __issues: v.issues };
    // FIX PASO 2 — alinear con la firma de eventsService.insertEvent (camelCase).
    // Previo (snake_case) generaba inserts silenciosos vacíos por UNIQUE NOT NULL
    // sobre event_id=null. Recovery-first se mantiene: el payload con marker
    // sigue persistiendo.
    const row = {
        eventId:          env.eventId,
        schemaVersion:    v.ok ? v.version : (env.version || 0),
        event:            String(env.event || 'unknown'),
        mode:             String(env.mode || 'unknown'),
        userId:           String(env.userId || ''),
        contentId:        env.contentId ?? null,
        sessionId:        String(env.sessionId || ''),
        clientTs:         Number.isFinite(env.clientTs) ? env.clientTs : Date.now(),
        elapsedMs:        env.elapsedMs ?? null,
        progressFraction: env.progressFraction ?? null,
        payload:          payloadOut ?? null,
    };
    try {
        (_insertOverride ?? eventsService.insertEvent)(row);
        out.inserted = true;
        out.ok = true;
        // Métricas (cardinalidad acotada: event ∈ registry, mode ∈ enum chico).
        try {
            eventsRecorded.labels(row.event, row.mode).inc();
            payloadSchemaVersion.labels(row.event, String(row.schemaVersion)).inc();
            if (!v.ok) eventValidationFailures.labels(v.code).inc();
            if (v.code === 'unknown_event') unsupportedEventTypes.inc();
        } catch { /* métricas jamás rompen el ingest */ }
    } catch (e) {
        // Idempotencia: events.db tiene UNIQUE(event_id) → re-insertar el
        // mismo evento NO es error real, es duplicado tolerado (al-most-once
        // contra at-least-once del cliente). Marcamos `duplicate:true` y NO
        // contamos métrica (sería doble-conteo). Cualquier otro error es real.
        const msg = String(e?.message || e);
        if (/UNIQUE constraint failed.*event_id/i.test(msg)) {
            out.ok = true; out.inserted = false; out.duplicate = true;
        } else {
            log(`[analyticsShadow] insertEvent failed: ${msg}`, 'ERROR');
        }
    }
    return out;
}

/**
 * Compara los últimos N eventos del JSON legacy contra el canon events.db
 * por eventId. Esto NO es full re-sync (analytics_db.json crece sin clave
 * primaria estable); es una **muestra de cola** que detecta divergencias
 * suficientemente rápido para señalar drift / pérdida sin escanear todo.
 * @param {{ sample?: number, minIngestedMs?: number }} [opts]
 */
export function consistencyCheck(opts = {}) {
    const sample = Math.max(10, Math.min(2000, opts.sample ?? 200));
    let legacy = [];
    try {
        if (fs.existsSync(ANALYTICS_DB)) {
            const raw = fs.readFileSync(ANALYTICS_DB, 'utf8');
            legacy = JSON.parse(raw);
            if (!Array.isArray(legacy)) legacy = [];
        }
    } catch { legacy = []; }
    const tail = legacy.slice(-sample).filter(e => e && e.eventId);
    const ids = tail.map(e => e.eventId);

    // events.db expone insertEvent + getEventsSince; usamos consulta directa
    // por id vía un prepared lookup ligero. eventsService no exporta uno por
    // id "many", así que recorremos con getEventById si existe; si no, una
    // consulta SQL minimal vía un getter. Cae a "best-effort" si no aplica.
    let foundIds = new Set();
    try {
        const cnt = (eventsService.getEventCount?.() ?? 0);
        if (cnt > 0 && typeof eventsService._dbForTests !== 'undefined') {
            // (dejado para acceso directo en tests; en runtime usamos
            // best-effort vía getEventsSince con filtro por user/content)
        }
    } catch { /* noop */ }

    // Best-effort cross-check: si tenemos getEventsSince usamos una ventana
    // generosa para incluir la cola; comparamos por event_id contra el set.
    try {
        const since = Math.max(0, Date.now() - (opts.minIngestedMs ?? 24 * 3600 * 1000));
        const recent = eventsService.getEventsSince({ sinceTs: since, limit: Math.max(sample * 4, 1000) }) || [];
        for (const r of recent) {
            const id = r.event_id ?? r.eventId;
            if (id) foundIds.add(id);
        }
    } catch { /* sin getEventsSince utilizable: skip */ }

    const missing = ids.filter(id => !foundIds.has(id));
    const ok = ids.length === 0 || missing.length === 0;
    return {
        ok,
        legacyTailSampled: tail.length,
        canonFoundOfSample: ids.length - missing.length,
        missingCount: missing.length,
        missingSample: missing.slice(0, 10),
    };
}

/** Resumen para /api/health/analytics. */
export function divergenceReport() {
    let canonCount = 0; try { canonCount = eventsService.getEventCount(); } catch {}
    const c = consistencyCheck({ sample: 100 });
    return { canon_count: canonCount, ...c };
}

/**
 * Solo-tests: arma la fila que se insertaría (sin tocar DB) → permite
 * verificar el contrato recovery-first (`__validation_failed`, schema_version,
 * payload migration) sin efectos colaterales.
 */
export function __buildRowForTest(env) {
    const v = validateEvent(env.event, env.payload, env.version);
    const payloadOut = v.ok ? v.payload
        : { ...env.payload, __validation_failed: v.code, __issues: v.issues };
    // Mismo shape camelCase que se entrega a eventsService.insertEvent.
    return {
        validated: v.ok, code: v.ok ? null : v.code,
        row: {
            eventId:       env.eventId,
            schemaVersion: v.ok ? v.version : (env.version || 0),
            event:         String(env.event || 'unknown'),
            mode:          String(env.mode || 'unknown'),
            userId:        String(env.userId || ''),
            contentId:     env.contentId ?? null,
            sessionId:     String(env.sessionId || ''),
            clientTs:      Number.isFinite(env.clientTs) ? env.clientTs : 0,
            payload:       payloadOut ?? null,
            // Compat con tests PASO 1 que inspeccionan snake_case:
            schema_version: v.ok ? v.version : (env.version || 0),
            payload_json:   JSON.stringify(payloadOut ?? null),
        },
    };
}

/** Throughput aproximado para healthcheck. */
export function throughput(minutes = 5) {
    try {
        const since = Date.now() - minutes * 60_000;
        const recent = eventsService.getEventsSince({ sinceTs: since, limit: 50_000 }) || [];
        return { window_minutes: minutes, events: recent.length,
                 per_minute: Math.round(recent.length / Math.max(1, minutes)) };
    } catch (e) {
        return { window_minutes: minutes, events: null, error: e.message };
    }
}
