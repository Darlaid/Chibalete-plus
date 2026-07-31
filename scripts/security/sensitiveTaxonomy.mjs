/**
 * CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B — Taxonomía de nombres sensibles.
 *
 * ADVERTENCIA DE DISEÑO — leer antes de tocar este archivo:
 *
 *   Esta taxonomía es la SEGUNDA línea de defensa, nunca la primera.
 *
 *   La protección principal es la allowlist de salida de `evidenceContract.mjs`:
 *   la evidencia se construye seleccionando campos permitidos, no copiando el
 *   objeto completo y borrando después lo que parezca peligroso. Un nombre de
 *   variable que nadie previó (`CHIB_XYZ`) no se filtra porque la taxonomía lo
 *   reconozca, sino porque el proyector nunca lo copia.
 *
 *   Esta lista existe para los formatos en los que NO hay allowlist posible
 *   (un `.env` arbitrario, un JSON de terceros) y para reforzar los que sí.
 *
 * Contexto de la unidad: la rotación CHP-SEC-AI-PROVIDER-KEYS-ROTATE-01A
 * encontró 17 artefactos históricos con credenciales porque un runbook copiaba
 * `.env` entero, y porque `docker inspect` crudo se persistía en snapshots.
 */

/**
 * Fragmentos que, presentes en el NOMBRE de una variable/campo, obligan a
 * tratar su valor como secreto. Comparación case-insensitive y sobre el nombre
 * normalizado (guiones y puntos → guion bajo), para que `x-admin-secret`,
 * `X_ADMIN_SECRET` y `adminSecret` caigan igual.
 */
export const SENSITIVE_NAME_TOKENS = Object.freeze([
    'SECRET',
    'TOKEN',
    'KEY',
    'PASSWORD',
    'PASSWD',
    'PASSPHRASE',
    'CREDENTIAL',
    'AUTH',
    'COOKIE',
    'SESSION',
    'BEARER',
    'PRIVATE',
    'SIGNING',
    'SIGNATURE',
    'API_KEY',
    'APIKEY',
    'DATABASE_URL',
    'DSN',
    'CONNECTION_STRING',
    'CONNECTIONSTRING',
    'ACCESS_KEY',
    'SALT',
    'PIN',
    'OTP',
]);

/**
 * Nombres EXACTOS que contienen un fragmento sensible por casualidad y cuyo
 * valor no es secreto.
 *
 * Regla de mantenimiento: solo nombres exactos, jamás prefijos ni comodines.
 * Una entrada con comodín convertiría la allowlist en un agujero (`*_KEY`
 * dejaría pasar `OPENAI_API_KEY`).
 *
 * Los sufijos `_FILE` / `_PATH` describen la RUTA de un secreto, no el secreto:
 * son el patrón file-only que ya usa ADMIN_SECRET en producción, y publicarlos
 * es deseable (documentan dónde vive el material sin exponerlo).
 */
export const NON_SENSITIVE_NAME_ALLOWLIST = Object.freeze([
    'ADMIN_SECRET_FILE',
    'ADMIN_SECRET_PATH',
    'RESTIC_PASSWORD_FILE',
    'MAX_TOKENS',
    'TOKEN_LIMIT',
    'TOKEN_BUDGET',
    'SESSION_TIMEOUT_MS',
    'SESSION_TTL_MS',
    'AUTHOR',
    'AUTHORS',
    'KEYWORDS',
    'SORT_KEY',
    'KEY_ORDER',
    'PUBLIC_KEY_ALGORITHM',
    'AUTHORIZED_ORIGINS',
]);

const ALLOWLIST = new Set(NON_SENSITIVE_NAME_ALLOWLIST.map((n) => n.toUpperCase()));

/**
 * Normaliza un nombre para comparar: mayúsculas, y cualquier separador
 * (guion, punto, espacio, dos puntos) pasa a guion bajo. `camelCase` se separa
 * también, de modo que `adminSecret` → `ADMIN_SECRET`.
 */
export const normalizeName = (name) =>
    String(name ?? '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[-.\s:/]+/g, '_')
        .toUpperCase();

/**
 * ¿El valor asociado a este nombre debe considerarse secreto?
 *
 * @param {string} name  nombre de variable, clave JSON o cabecera
 * @returns {boolean}
 */
export const isSensitiveName = (name) => {
    const norm = normalizeName(name);
    if (!norm) return false;
    if (ALLOWLIST.has(norm)) return false;
    return SENSITIVE_NAME_TOKENS.some((tok) => norm.includes(tok));
};

/**
 * Motivo legible de la decisión — para explicar en la evidencia por qué un
 * campo fue redactado, sin exponer su valor.
 */
export const sensitiveReason = (name) => {
    const norm = normalizeName(name);
    if (ALLOWLIST.has(norm)) return 'allowlisted';
    const hit = SENSITIVE_NAME_TOKENS.find((tok) => norm.includes(tok));
    return hit ? `name-contains:${hit}` : 'not-sensitive';
};

export const REDACTED = '[REDACTED]';
