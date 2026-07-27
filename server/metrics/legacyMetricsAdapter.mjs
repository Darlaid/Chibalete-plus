/**
 * legacyMetricsAdapter.mjs — CHP-API-METRICS-01A.
 *
 * Puente entre las rutas legacy de métricas y el motor canónico, **detrás de un
 * feature flag cuyo default es `legacy`**. En esta unidad el comportamiento
 * productivo NO cambia: con el default, este módulo no interviene.
 *
 *   METRICS_ENGINE=legacy     (default) → la ruta legacy responde como siempre
 *   METRICS_ENGINE=shadow                → responde legacy y registra SOLO
 *                                          diferencias agregadas sanitizadas
 *   METRICS_ENGINE=canonical             → responde el motor nuevo, con la
 *                                          respuesta legacy marcada deprecada
 *
 * El slug (`villas-de-aranjuez`) se admite ÚNICAMENTE como compatibilidad de
 * entrada: se resuelve a `organizationId` y a partir de ahí todo —autorización
 * y joins— usa el id. El slug nunca autoriza y nunca participa en un join.
 */
import { metricsEngineMode, compareShadow } from './metricsRouterV2.mjs';

/** Slug estable a partir del nombre visible. Solo para resolver la ENTRADA. */
export function schoolNameToSlug(name) {
    return String(name ?? '')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Resuelve un identificador de entrada (organizationId, slug o nombre) al
 * `organizationId` canónico. Devuelve null si no resuelve de forma inequívoca.
 *
 * Reglas:
 *   · si coincide con un `schools_db.id` → se usa tal cual (camino canónico);
 *   · si no, se busca por nombre exacto o por slug del nombre en el REGISTRO
 *     institucional, nunca en el texto libre de los grupos;
 *   · más de una coincidencia → null (ambiguo, jamás se toma la primera).
 */
export function resolveOrganizationInput(input, schools) {
    const raw = String(input ?? '').trim();
    if (!raw) return { organizationId: null, via: null };

    const list = Array.isArray(schools) ? schools : [];
    if (list.some(s => s?.id === raw)) return { organizationId: raw, via: 'organizationId' };

    const needle = raw.toLowerCase();
    const byName = list.filter(s => String(s?.name ?? '').trim().toLowerCase() === needle);
    if (byName.length === 1) return { organizationId: byName[0].id, via: 'name_compat' };
    if (byName.length > 1)   return { organizationId: null, via: 'ambiguous_name' };

    const bySlug = list.filter(s => schoolNameToSlug(s?.name) === needle);
    if (bySlug.length === 1) return { organizationId: bySlug[0].id, via: 'slug_compat' };
    if (bySlug.length > 1)   return { organizationId: null, via: 'ambiguous_slug' };

    return { organizationId: null, via: null };
}

/** Cabeceras de deprecación (RFC 8594) para las respuestas legacy. */
export function deprecationHeaders({ successor }) {
    return {
        Deprecation: 'true',
        Link: `<${successor}>; rel="successor-version"`,
        Warning: '299 - "Endpoint legacy de métricas: migrar a /api/v2/metrics"',
    };
}

/**
 * Envuelve un handler legacy. Con el default (`legacy`) devuelve el handler
 * intacto: cero cambio de comportamiento productivo.
 *
 * @param {object} p
 * @param {function} p.legacyHandler        (req,res) => Promise|void
 * @param {function} p.canonicalHandler     (req,res) => Promise<object>  devuelve el sobre
 * @param {function} [p.captureLegacy]      (req) => Promise<object>  para el modo shadow
 * @param {string}   p.successor            ruta v2 equivalente
 * @param {function} [p.log]
 * @param {function} [p.mode]               inyectable en tests
 */
export function wrapLegacyMetrics({ legacyHandler, canonicalHandler, captureLegacy,
                                    successor, log = () => {}, mode = metricsEngineMode }) {
    return async function handler(req, res) {
        const engine = mode();

        if (engine === 'legacy') return legacyHandler(req, res);

        if (engine === 'canonical') {
            for (const [k, v] of Object.entries(deprecationHeaders({ successor }))) res.set(k, v);
            return canonicalHandler(req, res);
        }

        // shadow: responde legacy, calcula canónico y registra solo agregados.
        let canonical = null, engineError = null;
        try {
            canonical = captureLegacy ? await canonicalHandler(req, { capture: true }) : null;
        } catch (e) {
            engineError = e?.code || e?.message || 'unknown';
        }
        try {
            const legacy = captureLegacy ? await captureLegacy(req) : null;
            if (legacy && canonical) {
                const diff = compareShadow({ endpoint: req.route?.path ?? 'legacy', legacy, canonical });
                log(`[metrics-shadow] ${JSON.stringify({ ...diff, engineError })}`, 'INFO');
            } else if (engineError) {
                log(`[metrics-shadow] ${JSON.stringify({ endpoint: req.route?.path ?? 'legacy', engineError })}`, 'WARN');
            }
        } catch (e) {
            log(`[metrics-shadow] comparación fallida: ${e?.code ?? 'error'}`, 'WARN');
        }
        return legacyHandler(req, res);
    };
}
