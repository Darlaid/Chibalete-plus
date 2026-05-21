/**
 * validate.js — P0.4 validación estructural centralizada (zod).
 *
 * Patrón único reutilizable. NO migra endpoints: se aplica incrementalmente
 * empezando por los sensibles (auth, uploads). Quirúrgico y reversible:
 * quitar el `validate(...)` de una ruta la deja exactamente como estaba.
 *
 * Uso:
 *   import { validate } from './middleware/validate.js';
 *   import { loginSchema } from './schemas/auth.schema.js';
 *   app.post('/api/auth/login', loginLimiter, validate({ body: loginSchema }), handler);
 *
 * Diseño defensivo:
 *   - Express 5: req.query/req.params son getters de solo-lectura → NO se
 *     reasignan. El resultado validado/saneado se expone en `req.validated`
 *     y SOLO `req.body` (writable en Express 4 y 5) se sobrescribe con el
 *     valor parseado (trim/coerce aplicados).
 *   - 400 con error genérico estructurado: NO filtra stack ni internals.
 *   - Nunca lanza: cualquier excepción inesperada → 400 controlado.
 */

/**
 * @param {{ body?: import('zod').ZodTypeAny, params?: import('zod').ZodTypeAny, query?: import('zod').ZodTypeAny }} schemas
 */
export function validate(schemas = {}) {
    return (req, res, next) => {
        try {
            const errors = [];
            const out = {};

            for (const part of ['body', 'params', 'query']) {
                const schema = schemas[part];
                if (!schema) continue;
                const result = schema.safeParse(req[part]);
                if (!result.success) {
                    for (const issue of result.error.issues) {
                        errors.push({
                            in: part,
                            path: issue.path.join('.') || '(root)',
                            message: issue.message,
                        });
                    }
                } else {
                    out[part] = result.data;
                }
            }

            if (errors.length > 0) {
                return res.status(400).json({
                    error: 'Solicitud inválida',
                    // Detalle acotado y seguro (campo + motivo, sin valores ni stack).
                    details: errors.slice(0, 20),
                });
            }

            // Exponer lo validado/saneado sin romper getters de Express 5.
            req.validated = out;
            if (out.body !== undefined) req.body = out.body; // writable en Express 4/5

            return next();
        } catch (e) {
            // Defensa: una falla del propio validador NUNCA debe 500-ear ni
            // dejar pasar payloads sin validar.
            return res.status(400).json({ error: 'Solicitud inválida' });
        }
    };
}
