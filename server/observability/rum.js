/**
 * rum.js — P2-F observabilidad del RUNTIME inmersivo (V1/V2) vía beacon.
 *
 * El runtime ya emite FINAL_ / VISUAL_ / __pbDiag en el cliente. Acá NO se
 * re-instrumenta: se ofrece UN ingest acotado, validado (zod), sampleado y
 * con labels ENUMERABLES (cardinalidad fija) que mapea a contadores Prom.
 * Gated por METRICS_ENABLED. Sin DSN/Redis/cola: directo a prom-client.
 *
 * Contrato cliente (beacon `navigator.sendBeacon('/api/rum', json)` — UNA
 * llamada al cerrar sesión / al detectar evento; NO por frame):
 *   { runtime:'v1'|'v2', mode:string, event:'drift'|'audio_recovery'
 *     |'stall'|'va_delta'|'session_end', value?:number }
 */
import { z } from 'zod';
import {
    METRICS_ENABLED, immersiveDrift, immersiveAudioRecovery, immersiveStall,
    immersiveVaDelta, immersiveSessions, runtimeCrash,
} from './metrics.js';

const RUNTIME = ['v1', 'v2'];
const MODES = ['perChunkNoAnchors', 'perChunkWithAnchors', 'perSentence', 'ttsDynamic', 'other'];
const EVENTS = ['drift', 'audio_recovery', 'stall', 'va_delta', 'session_end', 'crash'];

const rumSchema = z.object({
    runtime: z.enum(RUNTIME),
    mode: z.string().transform(m => (MODES.includes(m) ? m : 'other')),
    event: z.enum(EVENTS),
    value: z.number().finite().optional(),
}).strip();

const SAMPLE = Number.parseFloat(process.env.RUM_SAMPLE ?? '1.0');

export function registerRumRoute(app) {
    app.post('/api/rum', (req, res) => {
        // Inerte si métricas off: 204 silencioso (el beacon no espera body).
        if (!METRICS_ENABLED) return res.status(204).end();
        if (Math.random() > SAMPLE) return res.status(204).end();
        const parsed = rumSchema.safeParse(req.body);
        if (!parsed.success) return res.status(204).end(); // beacon: nunca 4xx ruidoso
        const { runtime, mode, event, value } = parsed.data;
        try {
            switch (event) {
                case 'drift':          immersiveDrift.labels(runtime, mode).inc(); break;
                case 'audio_recovery': immersiveAudioRecovery.labels(runtime).inc(); break;
                case 'stall':          immersiveStall.labels(runtime, 'stall').inc(); break;
                case 'va_delta':       if (typeof value === 'number') immersiveVaDelta.labels(runtime).observe(value); break;
                case 'session_end':    immersiveSessions.labels(runtime).dec(); break;
                case 'crash':          runtimeCrash.labels(runtime).inc(); break;
            }
        } catch { /* métrica jamás rompe el ingest */ }
        return res.status(204).end();
    });
}
