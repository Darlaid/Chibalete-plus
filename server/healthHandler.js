/**
 * healthHandler.js — endpoint público GET /api/health
 *
 * Sprint 022 Fase 2B.4 — enriquecimiento del health endpoint que ya
 * existía como `{ status: 'ok' }` mínimo. El nuevo contrato agrega
 * campos operacionales útiles para:
 *
 *   - Identificar qué instancia respondió (chibalete_api_1 vs api_2 en
 *     deploy staggered) → campo `instance`.
 *   - Confirmar que el deploy corrió la versión esperada → `version`/`commit`.
 *   - Detectar restart loops → `uptime` cayendo a 0 frecuentemente.
 *   - Logs centralizados con timestamps consistentes → `timestamp`.
 *
 * Contrato:
 *   {
 *     status:    "ok",                        // siempre, fijo
 *     service:   "chibalete-api",             // identificador del servicio
 *     instance:  string,                      // HOSTNAME del container/proceso
 *     uptime:    number,                      // segundos desde process start
 *     timestamp: string,                      // ISO 8601 al momento del request
 *     version:   string,                      // release_tag o package.json
 *     commit:    string | null,               // git_sha si existe
 *     deployed_at: string | null,             // ISO 8601 del último deploy o null
 *   }
 *
 * Sprint 022 Fase 2B.7 — fuente canónica `server/.deploy-info` (D2):
 *   Archivo JSON generado por `scripts/deploy-backend.sh`, leído UNA VEZ
 *   al startup. Su presencia indica que esta instancia fue desplegada por
 *   el flujo canónico Sprint 022. Su ausencia es legítima en dev local o
 *   en una imagen api recién recreada antes del primer deploy backend.
 *
 *   Formato esperado:
 *     {
 *       "release_tag": "rel-2026-05-07-membership-fix",
 *       "git_sha":     "abc1234deadbeef...",
 *       "deployed_at": "2026-05-07T23:14:55Z"
 *     }
 *
 *   Precedencia (más fuerte → más débil):
 *     version:     deploy-info.release_tag  →  CHIBALETE_RELEASE  →  package.json  →  "unknown"
 *     commit:      deploy-info.git_sha      →  GIT_SHA env        →  null
 *     deployed_at: deploy-info.deployed_at  →  null
 *
 * Garantías operacionales:
 *   - SIN auth (uso por monitores externos y healthcheck del edge)
 *   - SIN tocar data/, data-critical/, uploads/
 *   - SIN adquirir locks de archivo
 *   - SIN llamar validateMembershipIntegrity (peligroso por costo de IO)
 *   - Tiempo de respuesta esperado < 5ms
 *   - Excluido del rate limit global (server.js:159)
 *   - Backwards-compatible: cualquier consumer que lea solo `body.status`
 *     sigue funcionando.
 *   - Tolerante a corrupción de .deploy-info: cualquier error → fallback,
 *     NUNCA romper /api/health.
 *
 * Performance:
 *   `version`, `commit`, `instance`, `service` y `deployed_at` se resuelven
 *   UNA SOLA VEZ al startup vía `getHealthDefaults()` y se reusan en cada
 *   request. Solo `uptime` y `timestamp` se computan por request.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/**
 * Lee y parsea server/.deploy-info de forma defensiva.
 * Devuelve `null` si el archivo no existe, está vacío, no es JSON válido,
 * o no tiene el shape mínimo esperado. JAMÁS lanza excepción.
 *
 * Casos cubiertos:
 *   - archivo no existe → null (caso normal en dev local / imagen virgen)
 *   - archivo vacío → null
 *   - JSON inválido → null
 *   - JSON válido pero no objeto → null
 *   - JSON válido sin campos → objeto con campos null
 *
 * @returns {{release_tag: string|null, git_sha: string|null, deployed_at: string|null} | null}
 */
function readDeployInfo() {
    try {
        const infoPath = path.resolve(__dirname, '.deploy-info');
        const raw = readFileSync(infoPath, 'utf8');
        if (!raw || raw.trim() === '') return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        // Coerce a string|null cada campo, sin asumir presencia.
        const coerce = (v) => (typeof v === 'string' && v.length > 0) ? v : null;
        return {
            release_tag: coerce(parsed.release_tag),
            git_sha:     coerce(parsed.git_sha),
            deployed_at: coerce(parsed.deployed_at),
        };
    } catch {
        return null;
    }
}

/**
 * Resuelve los valores estáticos (no cambian durante la vida del proceso).
 * Diseñado para llamarse una sola vez al startup. Robusto a fallos:
 * cualquier read/parse error devuelve fallback 'unknown' o null.
 */
export function getHealthDefaults() {
    // service: constante del servicio en el ecosistema Chibalete+.
    const service = 'chibalete-api';

    // instance: HOSTNAME del container o proceso. En Docker, cada container
    // tiene HOSTNAME único (ej. "chibalete_api_1"). En dev local típicamente
    // es el hostname de la máquina.
    const instance = process.env.HOSTNAME || 'unknown';

    // .deploy-info: fuente canónica D2 del Sprint 022 Fase 2B.7. Si está
    // presente, sus valores prevalecen sobre env vars y package.json.
    const deployInfo = readDeployInfo();

    // version: prioridad deploy-info.release_tag → CHIBALETE_RELEASE →
    // package.json → 'unknown'.
    let version = deployInfo?.release_tag || process.env.CHIBALETE_RELEASE || null;
    if (!version) {
        try {
            const pkgPath = path.resolve(__dirname, '..', 'package.json');
            const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
            version = pkg.version || null;
        } catch {
            version = null;
        }
    }
    if (!version) version = 'unknown';

    // commit: SHA del git. NO se intenta ejecutar `git rev-parse` desde
    // dentro del container (puede no tener git instalado y agregaría I/O).
    // Prioridad: deploy-info.git_sha → env GIT_SHA → null.
    // Tratamos string vacía como null (operador `||` ya lo hace).
    const commit = deployInfo?.git_sha || process.env.GIT_SHA || null;

    // deployed_at: ISO 8601 del último deploy registrado en .deploy-info.
    // Sin .deploy-info → null. (No hay fallback de env, es exclusivo de
    // .deploy-info para mantener semántica clara: "última vez que el flujo
    // canónico de deploy escribió aquí".)
    const deployed_at = deployInfo?.deployed_at || null;

    return { service, instance, version, commit, deployed_at };
}

/**
 * Construye el payload del health response.
 *
 * @param {object} defaults  Resultado de getHealthDefaults() (computado una vez)
 * @param {Date}   [now]     Timestamp actual (inyectable para tests)
 * @returns {{status: 'ok', service: string, instance: string, uptime: number,
 *            timestamp: string, version: string, commit: string|null}}
 */
export function buildHealthPayload(defaults, now = new Date()) {
    return {
        status:      'ok',
        service:     defaults.service,
        instance:    defaults.instance,
        uptime:      Math.floor(process.uptime()),
        timestamp:   now.toISOString(),
        version:     defaults.version,
        commit:      defaults.commit,
        deployed_at: defaults.deployed_at ?? null,
    };
}
