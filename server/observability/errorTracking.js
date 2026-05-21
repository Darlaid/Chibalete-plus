/**
 * errorTracking.js — P2-D captura de errores vía SDK @sentry/node (MIT,
 * NO el server Sentry FSL). DSN apunta a GlitchTip self-host (MIT) cuando
 * exista. INERTE sin DSN: noop total, cero overhead, cero red.
 *
 * NOTA OPERACIONAL HONESTA: el SERVIDOR GlitchTip requiere Postgres + Redis
 * + worker Celery — eso viola la restricción P2 "no Redis/queues todavía".
 * Por eso P2 entrega la CAPA SDK lista (DSN-configurable, default off) y
 * DEFIERE levantar el stack GlitchTip a P3 (track de infra aparte). El SDK
 * @sentry/node es además compatible con cualquier ingest Sentry-protocol.
 *
 * Env: SENTRY_DSN | GLITCHTIP_DSN  (vacío = deshabilitado)
 *      ERROR_TRACKING_SAMPLE (default 1.0 errores, 0.0 perf)
 */
import * as Sentry from '@sentry/node';

const DSN = process.env.SENTRY_DSN || process.env.GLITCHTIP_DSN || '';
export const ERROR_TRACKING_ENABLED = DSN.length > 0;

export function initErrorTracking() {
    if (!ERROR_TRACKING_ENABLED) {
        // eslint-disable-next-line no-console
        console.log('[error-tracking] disabled (no DSN) — inerte');
        return false;
    }
    try {
        Sentry.init({
            dsn: DSN,
            environment: process.env.NODE_ENV || 'development',
            release: process.env.CHIBALETE_RELEASE || undefined,
            serverName: process.env.HOSTNAME || 'local',
            // Errores: 100% por defecto. Performance/tracing: 0 (lo cubre OTel;
            // no duplicar ni inflar costo).
            sampleRate: Number.parseFloat(process.env.ERROR_TRACKING_SAMPLE ?? '1.0'),
            tracesSampleRate: 0,
            // No PII por defecto.
            sendDefaultPii: false,
            beforeSend(event) {
                // Defensa anti-secreto: scrub headers sensibles si llegaran.
                if (event.request?.headers) {
                    for (const h of ['authorization', 'cookie', 'x-admin-secret']) {
                        if (event.request.headers[h]) event.request.headers[h] = '[REDACTED]';
                    }
                }
                return event;
            },
        });
        // eslint-disable-next-line no-console
        console.log('[error-tracking] ON (DSN set)');
        return true;
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error(`[error-tracking] init failed, continuing without it: ${e.message}`);
        return false;
    }
}

/** Wirear DESPUÉS de definir las rutas. Noop sin DSN. @sentry/node v8 API. */
export function instrumentExpressErrors(app) {
    if (!ERROR_TRACKING_ENABLED) return;
    try { Sentry.setupExpressErrorHandler(app); } catch { /* noop defensivo */ }
}

export { Sentry };
