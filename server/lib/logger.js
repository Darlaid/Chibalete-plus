/**
 * logger.js — P0.6 logging mínimo serio (pino + pino-http).
 *
 * INCREMENTAL: NO reescribe server.js ni los ~cientos de callsites de `log()`.
 * Solo agrega UNA capa de access-log estructurado con request-id + redaction.
 * El `log(msg,type)` legacy de server.js se mantiene tal cual (ya timestamp +
 * stdout = Docker-friendly). Rollback = quitar la línea `app.use(httpLogger)`.
 *
 * - request-id: toma `x-request-id` entrante o genera UUID (crypto nativo).
 * - structured JSON a stdout → `docker logs` / agregador lo parsea.
 * - redaction: nunca loguea Authorization / x-admin-secret / cookies /
 *   password / claves Gemini/OpenAI/ADMIN_SECRET.
 * - /api/health excluido del access-log (evita ruido del healthcheck).
 */
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';

const IS_PROD = process.env.NODE_ENV?.trim() === 'production';

export const logger = pino({
    level: process.env.LOG_LEVEL || (IS_PROD ? 'info' : 'debug'),
    base: { svc: 'chibalete-api', pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
        paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-admin-secret"]',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.token',
            '*.GEMINI_API_KEY',
            '*.OPENAI_API_KEY',
            '*.ADMIN_SECRET',
            'GEMINI_API_KEY',
            'OPENAI_API_KEY',
            'ADMIN_SECRET',
        ],
        censor: '[REDACTED]',
    },
});

export const httpLogger = pinoHttp({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id = (typeof incoming === 'string' && incoming.length <= 200)
            ? incoming
            : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
    },
    // No spamear el access-log con el healthcheck del container.
    autoLogging: {
        ignore: (req) => req.url === '/api/health' || req.url === '/health',
    },
    customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
    },
    // Solo metadatos seguros del request/response (nada de body por defecto).
    serializers: {
        req: (req) => ({
            id: req.id,
            method: req.method,
            url: req.url,
            userId: req.headers?.['x-user-id'] || null,
        }),
        res: (res) => ({ statusCode: res.statusCode }),
    },
});
