/**
 * eventTransport.mjs — CHP-STATS-INSTRUMENTATION-01A.
 *
 * Capa COMPARTIDA y MÍNIMA de transporte de eventos. Framework-agnóstica y
 * node-testable (storage/fetch/generateId/now inyectables). Extrae SOLO el
 * transporte genérico del patrón probado de `hooks/useA11yAnalytics.ts` (cola
 * offline UX-3B); NO incluye semántica de lectura (sesión, heartbeat, observer,
 * nombres de evento, elapsedMs, completion) — eso vive en cada emisor.
 *
 * Garantías (contrato 01A):
 *   - eventId se crea UNA vez, en el momento del hecho (createEvent);
 *   - occurredAt se crea UNA vez, en el momento del hecho;
 *   - un retry reenvía el MISMO evento (mismo eventId y occurredAt);
 *   - cola durable en localStorage: sobrevive pérdida de red, reload y
 *     cierre/reapertura;
 *   - CERO silent drop: todo descarte (overflow, quota, payload grande, 4xx
 *     permanente) emite telemetría acotada explícita;
 *   - payload bounded ≤ 4KB (compatible con el contrato canónico 9fbe7e0);
 *   - el transporte NO define identidad: no envía x-user-id ni actorId
 *     autoafirmado; usa la cookie de sesión (credentials same-origin). La
 *     autoridad del actor la resuelve la normalización server-side futura.
 *
 * Clasificación de fallos:
 *   - network error / 5xx / 429  → RETRYABLE (el evento permanece en cola);
 *   - 4xx permanente (400/401/403/404/422/…) → TERMINAL (se retira de la cola
 *     con telemetría PERMANENT_FAILURE; un poison-pill no debe reintentarse
 *     para siempre);
 *   - 2xx (incluye respuesta idempotente/duplicate) → SUCCESS (se retira).
 *
 * DORMANT en 01A: este módulo NO es importado por ningún lector. La migración
 * de emisores reales (Texto/PDF/Álbum) es CHP-STATS-INSTRUMENTATION-01B.
 */

// ── ULID (espejo de utils/clientUlid.ts & server/ulid.js) ────────────────────
// 26 chars Crockford Base32 (10 time + 16 random). Mismo formato/regex que el
// backend, por lo que los IDs son estructuralmente indistinguibles. Inyectable
// vía opts.generateId para que el hook de navegador (01B) reutilice clientUlid.
const ULID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function encodeTime(ms) {
    const safeMs = Number.isFinite(ms) && ms >= 0 ? Math.floor(ms) : 0;
    let n = BigInt(safeMs);
    const out = new Array(10);
    for (let i = 9; i >= 0; i--) { out[i] = ULID_ALPHABET[Number(n & 31n)]; n >>= 5n; }
    return out.join('');
}
function randomBytes10() {
    const bytes = new Uint8Array(10);
    const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
    if (c && typeof c.getRandomValues === 'function') { c.getRandomValues(bytes); return bytes; }
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return bytes;
}
function encodeRandom() {
    const bytes = randomBytes10();
    let acc = 0n;
    for (let i = 0; i < bytes.length; i++) acc = (acc << 8n) | BigInt(bytes[i]);
    const out = new Array(16);
    for (let i = 15; i >= 0; i--) { out[i] = ULID_ALPHABET[Number(acc & 31n)]; acc >>= 5n; }
    return out.join('');
}
function defaultUlid(ms) { return encodeTime(ms) + encodeRandom(); }

// ── Constantes del contrato ──────────────────────────────────────────────────
export const SCHEMA_VERSION     = 1;
export const DEFAULT_ENDPOINT   = '/api/v1/events';
export const DEFAULT_STORAGE_KEY = 'chp_event_transport_queue';
export const DEFAULT_MAX_QUEUE  = 200;
export const MAX_PAYLOAD_BYTES  = 4096; // igual que el contrato canónico 9fbe7e0

/** Clases de telemetría acotada (explícita, nunca silent). */
export const TELEMETRY = Object.freeze({
    OVERFLOW:          'queue_overflow',
    PAYLOAD_TOO_LARGE: 'payload_too_large',
    PERMANENT_FAILURE: 'permanent_failure',
    TRANSPORT_FAILURE: 'transport_failure',
    STORAGE_ERROR:     'storage_error',
});

/** Campos internos del transporte que NUNCA viajan en el body al servidor. */
const TRANSPORT_INTERNAL_KEYS = ['_scope', 'attempts'];

/**
 * Clasifica una respuesta de transporte.
 * @returns {'success'|'retryable'|'permanent'}
 */
export function classifyResponse({ ok = false, status = 0, networkError = false } = {}) {
    if (networkError) return 'retryable';
    if (ok) return 'success';
    if (status === 429) return 'retryable';
    if (status >= 500) return 'retryable';
    if (status >= 400) return 'permanent';
    return 'retryable'; // desconocido → seguro: conservar el evento
}

function byteLength(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return Buffer.byteLength(str, 'utf8');
}

/** Proyecta un evento en cola al envelope de red (sin campos internos). */
function toWire(evt) {
    const out = {};
    for (const k of Object.keys(evt)) {
        if (!TRANSPORT_INTERNAL_KEYS.includes(k)) out[k] = evt[k];
    }
    return out;
}

/**
 * Crea un transporte de eventos durable.
 *
 * @param {object} [opts]
 * @param {string} [opts.endpoint]
 * @param {string} [opts.storageKey]
 * @param {number} [opts.maxQueue]
 * @param {Storage} [opts.storage]   localStorage-like (getItem/setItem/removeItem)
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(url:string, body:string)=>boolean} [opts.sendBeacon]
 * @param {()=>number} [opts.now]
 * @param {(ms:number)=>string} [opts.generateId]  default = ULID espejo
 * @param {(ev:object)=>void} [opts.onTelemetry]   sink acotado (no silent drop)
 */
export function createEventTransport(opts = {}) {
    const endpoint    = opts.endpoint ?? DEFAULT_ENDPOINT;
    const storageKey  = opts.storageKey ?? DEFAULT_STORAGE_KEY;
    const maxQueue    = opts.maxQueue ?? DEFAULT_MAX_QUEUE;
    const storage     = opts.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    const fetchImpl   = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    const sendBeacon  = opts.sendBeacon ?? null;
    const now         = opts.now ?? (() => Date.now());
    const generateId  = opts.generateId ?? defaultUlid;
    const onTelemetry = typeof opts.onTelemetry === 'function' ? opts.onTelemetry : () => {};

    function telemetry(kind, detail) {
        try { onTelemetry({ kind, ...detail }); } catch { /* la telemetría nunca rompe el transporte */ }
    }

    function loadQueue() {
        if (!storage) return [];
        try {
            const raw = storage.getItem(storageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            // Guard de shape: eventId ULID + occurredAt numérico + type string.
            return parsed.filter(e =>
                !!e && typeof e === 'object'
                && typeof e.eventId === 'string' && ULID_RE.test(e.eventId)
                && Number.isFinite(e.occurredAt)
                && typeof e.type === 'string');
        } catch {
            return [];
        }
    }

    function saveQueue(events) {
        if (!storage) return events;
        let capped = events;
        if (events.length > maxQueue) {
            const dropped = events.length - maxQueue;
            capped = events.slice(dropped); // drop-oldest
            telemetry(TELEMETRY.OVERFLOW, { dropped, kept: capped.length, cap: maxQueue });
        }
        try {
            if (capped.length === 0) storage.removeItem(storageKey);
            else storage.setItem(storageKey, JSON.stringify(capped));
        } catch (e) {
            // QuotaExceededError u otro fallo: explícito, NO silent.
            telemetry(TELEMETRY.STORAGE_ERROR, { message: String(e && e.message || e) });
        }
        return capped;
    }

    /**
     * Crea el evento fijando eventId y occurredAt UNA sola vez. Si el caller ya
     * trae un eventId ULID válido (p.ej. re-hidratación), se respeta.
     */
    function createEvent(input = {}) {
        const eventId = (typeof input.eventId === 'string' && ULID_RE.test(input.eventId))
            ? input.eventId
            : generateId(now());
        const occurredAt = Number.isFinite(input.occurredAt) ? input.occurredAt : now();
        const evt = {
            eventId,
            schemaVersion: SCHEMA_VERSION,
            occurredAt,
            type: String(input.type ?? ''),
            mode: input.mode ?? null,
            contentId: input.contentId ?? null,
            interactionSessionId: input.interactionSessionId ?? null,
        };
        if (input.payload && typeof input.payload === 'object' && Object.keys(input.payload).length > 0) {
            evt.payload = input.payload;
        }
        return evt;
    }

    function payloadBytes(evt) {
        return evt && evt.payload ? byteLength(JSON.stringify(evt.payload)) : 0;
    }

    /**
     * Persiste un evento en la cola durable. Idempotente por eventId (no
     * duplica). Rechaza (explícito) si el payload excede el límite.
     * @param {object} evt  evento de createEvent
     * @param {object} [meta] {scope?} partición local multi-usuario (NO viaja al server)
     * @returns {{ok:boolean, reason?:string, deduped?:boolean}}
     */
    function enqueue(evt, meta = {}) {
        if (!evt || typeof evt.eventId !== 'string' || !ULID_RE.test(evt.eventId)) {
            return { ok: false, reason: 'invalid_event' };
        }
        const bytes = payloadBytes(evt);
        if (bytes > MAX_PAYLOAD_BYTES) {
            telemetry(TELEMETRY.PAYLOAD_TOO_LARGE, { eventId: evt.eventId, bytes, cap: MAX_PAYLOAD_BYTES });
            return { ok: false, reason: 'payload_too_large' };
        }
        const q = loadQueue();
        if (q.some(e => e.eventId === evt.eventId)) return { ok: true, deduped: true };
        const stored = { ...evt };
        if (meta.scope != null) stored._scope = meta.scope;
        saveQueue([...q, stored]);
        return { ok: true };
    }

    /** Conveniencia: createEvent + enqueue. */
    function emit(input, meta) {
        const evt = createEvent(input);
        const r = enqueue(evt, meta);
        return { event: evt, result: r };
    }

    /**
     * Envía los eventos en cola (o los de un `scope`). Persiste antes de enviar,
     * y sólo retira de la cola tras confirmación. Reenvía el MISMO evento
     * (mismo eventId/occurredAt); nunca regenera identidad.
     * @param {object} [o] {scope?, useBeacon?}
     * @returns {Promise<{sent:number, outcome:string, status?:number|null}>}
     */
    async function flush(o = {}) {
        const { scope, useBeacon = false } = o;
        const all = loadQueue();
        const selected = scope != null ? all.filter(e => e._scope === scope) : all;
        const rest     = scope != null ? all.filter(e => e._scope !== scope) : [];
        if (selected.length === 0) return { sent: 0, outcome: 'empty' };

        // Persist-before-send con attempts++ (durabilidad si la pestaña muere mid-send).
        const attempted = selected.map(e => ({ ...e, attempts: (e.attempts || 0) + 1 }));
        saveQueue([...rest, ...attempted]);

        const wire = attempted.map(toWire);
        const body = JSON.stringify({ events: wire });
        const sentIds = new Set(wire.map(e => e.eventId));

        // Cierre de pestaña: sendBeacon no confirma → dejamos los eventos en cola
        // (el server deduplica por eventId). No es silent drop: permanecen.
        if (useBeacon && sendBeacon) {
            let ok = false;
            try { ok = !!sendBeacon(endpoint, body); } catch { ok = false; }
            return { sent: wire.length, outcome: ok ? 'beacon_sent' : 'beacon_failed' };
        }

        if (!fetchImpl) {
            telemetry(TELEMETRY.TRANSPORT_FAILURE, { reason: 'no_fetch', retryable: true });
            return { sent: wire.length, outcome: 'retryable', status: null };
        }

        let res = null, networkError = false;
        try {
            res = await fetchImpl(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }, // sin x-user-id: identidad = cookie
                body,
                keepalive: true,
                credentials: 'same-origin',
            });
        } catch (e) {
            networkError = true;
            telemetry(TELEMETRY.TRANSPORT_FAILURE, { message: String(e && e.message || e), retryable: true });
        }

        const cls = classifyResponse({ ok: !!(res && res.ok), status: res ? res.status : 0, networkError });

        if (cls === 'success') {
            // Reload por si se encolaron eventos nuevos durante el fetch async.
            const cur = loadQueue();
            saveQueue(cur.filter(e => !sentIds.has(e.eventId)));
            return { sent: wire.length, outcome: 'success', status: res ? res.status : 200 };
        }
        if (cls === 'permanent') {
            const cur = loadQueue();
            saveQueue(cur.filter(e => !sentIds.has(e.eventId)));
            telemetry(TELEMETRY.PERMANENT_FAILURE, {
                status: res ? res.status : null,
                count: wire.length,
                eventIds: wire.map(e => e.eventId).slice(0, 20),
            });
            return { sent: wire.length, outcome: 'permanent_failure', status: res ? res.status : null };
        }
        // retryable: los eventos ya están persistidos (attempts++). No silent drop.
        telemetry(TELEMETRY.TRANSPORT_FAILURE, { status: res ? res.status : null, retryable: true });
        return { sent: wire.length, outcome: 'retryable', status: res ? res.status : null };
    }

    /** Reintenta la cola (alias semántico de flush sin eventos nuevos). */
    function retryQueued(o = {}) { return flush(o); }

    /** Nº de eventos en cola (para tests/telemetría). */
    function queueSize(scope) {
        const q = loadQueue();
        return scope != null ? q.filter(e => e._scope === scope).length : q.length;
    }

    return { createEvent, enqueue, emit, flush, retryQueued, queueSize, loadQueue, toWire, classifyResponse, endpoint, storageKey, maxQueue };
}

export { defaultUlid as _ulidMirror };
