/**
 * operationalAdminAuth.js — CHP-STATS-LEGACY-PERF-OBS-01A-R2.
 *
 * Middleware ESTRECHO para rutas puramente operacionales: solo autoriza con el
 * ADMIN_SECRET canónico file-only. Nada más.
 *
 * ── Por qué existe, y por qué no se reutiliza `requireAdminAccess` ──────────
 *
 * `requireAdminAccess` desvía TODOS los GET a `allowAuthenticatedGetOrReject`,
 * que concede paso a cualquier principal autenticado. Verificado con dobles
 * sintéticos sobre la factoría real:
 *
 *   GET sin cabeceras                → 401
 *   GET con x-user-id de lector      → 200   ←
 *   GET con x-user-id de mediador    → 200   ←
 *   GET con x-user-id de administrador → 200
 *
 * Eso es una decisión deliberada del fix P0 de 2026-05 —cerró el bypass
 * ANÓNIMO y conservó el acceso autenticado sin rol para no romper el preflight
 * de acceso que usa todo visor— y esta unidad NO la toca. Pero significa que un
 * GET protegido con ese middleware es legible por una cuenta de estudiante, y
 * la telemetría operacional del proceso no debe estarlo.
 *
 * De ahí este middleware: no mira `x-user-id`, ni roles, ni cookies, ni query,
 * ni body. Solo el archivo canónico.
 *
 * ── Diferencia con `headerMatchesAdminSecret` ───────────────────────────────
 *
 * Se reutiliza el MISMO lector file-only (`readAdminSecret`), que es la parte
 * sensible y auditada. Lo que no se reutiliza es su comparación `===`: el
 * gateway compartido documenta que SEC-08 (tiempo constante) quedó fuera de su
 * alcance, y modificarlo afectaría a todos sus consumidores. Aquí se compara
 * sobre digests SHA-256 con `timingSafeEqual`, que además evita filtrar la
 * longitud del secreto por el propio error de `timingSafeEqual`.
 *
 * Fail-closed en todo: archivo ausente, con permisos incorrectos, symlink,
 * vacío o cabecera ausente producen la MISMA respuesta 401 sin detalle.
 */
import crypto from 'node:crypto';
import { readAdminSecret } from './adminSecret.js';

/** Cabecera administrativa ya establecida en el sistema. No se admite otra. */
export const OPERATIONAL_ADMIN_HEADER = 'x-admin-secret';

/**
 * Respuesta única de rechazo. No distingue ausencia de cabecera, secreto
 * incorrecto ni archivo canónico inválido: cualquier detalle sería un oráculo.
 */
const DENY_BODY = Object.freeze({ error: 'No autorizado' });

/**
 * Comparación en tiempo constante sobre digests de longitud fija.
 *
 * Comparar los valores en crudo con `timingSafeEqual` obligaría a que midan lo
 * mismo —y lanzar por longitud distinta ya filtra la longitud del secreto—.
 * Hasheando ambos lados, la comparación siempre opera sobre 32 bytes.
 */
export function secretsMatch(presented, expected) {
    if (typeof presented !== 'string' || typeof expected !== 'string') return false;
    if (presented.length === 0 || expected.length === 0) return false;
    const a = crypto.createHash('sha256').update(presented, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(a, b);
}

/**
 * Extrae el candidato de la cabecera administrativa.
 * Rechaza ausente, vacío, array y cualquier tipo inesperado.
 */
export function candidateSecret(req) {
    const raw = req?.headers?.[OPERATIONAL_ADMIN_HEADER];
    if (typeof raw !== 'string' || raw.length === 0) return null;
    return raw;
}

/**
 * Factoría del middleware. El lector se inyecta SOLO para poder ejercitar el
 * middleware en pruebas sin un archivo real; el default es el lector canónico
 * file-only y no es configurable desde el entorno ni desde la request.
 *
 * @param {{ readSecret?: () => Promise<string>, log?: (msg: string, level?: string) => void }} deps
 */
export function createOperationalAdminSecretGuard({ readSecret = readAdminSecret, log = () => {} } = {}) {
    return async function requireOperationalAdminSecret(req, res, next) {
        const presented = candidateSecret(req);

        // Sin candidato no se toca el disco: mismo criterio que el gateway
        // existente, para no convertir la ruta en un probe del filesystem.
        if (presented === null) {
            log(`[OPS_AUTH_REJECT] path=${req?.path ?? '?'} reason=no_candidate`, 'WARN');
            return res.status(401).json(DENY_BODY);
        }

        let expected;
        try {
            expected = await readSecret();
        } catch {
            // Archivo ausente, inseguro o inválido → credencial inválida.
            // No se distingue del secreto incorrecto ni se registra la causa.
            log(`[OPS_AUTH_REJECT] path=${req?.path ?? '?'} reason=unavailable`, 'WARN');
            return res.status(401).json(DENY_BODY);
        }

        if (!secretsMatch(presented, expected)) {
            log(`[OPS_AUTH_REJECT] path=${req?.path ?? '?'} reason=mismatch`, 'WARN');
            return res.status(401).json(DENY_BODY);
        }

        return next();
    };
}
