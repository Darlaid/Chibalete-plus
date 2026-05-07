/**
 * healthEndpoint.test.js — Sprint 022 Fase 2B.4
 *
 * Cubre el contrato del endpoint `GET /api/health` enriquecido.
 *
 * Patrón: igual que el resto de la suite (groupMembershipService, etc.) —
 * NO levanta Express, importa la función pura `buildHealthPayload` y
 * `getHealthDefaults` directamente y verifica el shape resultante.
 *
 * Garantías testeadas:
 *   - status === 'ok'
 *   - service === 'chibalete-api'
 *   - uptime es number entero >= 0
 *   - timestamp es ISO 8601 parseable
 *   - version y commit respetan precedencia (env > package.json > 'unknown' / null)
 *   - instance refleja HOSTNAME o 'unknown'
 *   - el helper es PURO: no hace I/O por request, no llama
 *     validateMembershipIntegrity, no requiere admin secret
 *
 * Cómo correr:
 *   node server/__test__/healthEndpoint.test.js
 */

import { buildHealthPayload, getHealthDefaults } from '../healthHandler.js';
import * as fsMod from 'node:fs';
import * as pathMod from 'node:path';
import * as urlMod from 'node:url';

const __testFilename = urlMod.fileURLToPath(import.meta.url);
const __testDirname  = pathMod.dirname(__testFilename);
const DEPLOY_INFO_PATH = pathMod.resolve(__testDirname, '..', '.deploy-info');

// Helper para escribir/borrar .deploy-info en el directorio server/ del repo.
// CRÍTICO: el path es server/.deploy-info (mismo dir que healthHandler.js).
// Cualquier residuo de un test corrupto al fixture real → cleanup en finally.
function writeDeployInfo(content) {
    fsMod.writeFileSync(DEPLOY_INFO_PATH, content, 'utf8');
}
function removeDeployInfo() {
    try { fsMod.unlinkSync(DEPLOY_INFO_PATH); } catch { /* idempotente */ }
}

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

// Asegurar fixture limpio al INICIO (puede haber residuos de runs previos).
removeDeployInfo();

console.log('healthEndpoint — Sprint 022 Fase 2B.4');

// ────────────────────────────────────────────────────────────────────────────
// 1. Shape básico del payload
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 1] Shape básico del payload');
{
    const defaults = getHealthDefaults();
    const payload = buildHealthPayload(defaults);

    ok('status === "ok"',                payload.status === 'ok');
    ok('service === "chibalete-api"',    payload.service === 'chibalete-api');
    ok('instance es string',             typeof payload.instance === 'string');
    ok('uptime es number',               typeof payload.uptime === 'number');
    ok('uptime es entero >= 0',          Number.isInteger(payload.uptime) && payload.uptime >= 0);
    ok('timestamp es string',            typeof payload.timestamp === 'string');
    ok('timestamp es ISO 8601 válido',   !isNaN(Date.parse(payload.timestamp)));
    ok('version es string',              typeof payload.version === 'string');
    ok('commit es string o null',        payload.commit === null || typeof payload.commit === 'string');
    ok('deployed_at es string o null',   payload.deployed_at === null || typeof payload.deployed_at === 'string');

    // Top-level keys exactas: ningún campo extra accidental.
    const expectedKeys = ['status', 'service', 'instance', 'uptime', 'timestamp', 'version', 'commit', 'deployed_at'];
    const actualKeys = Object.keys(payload).sort();
    ok('exactamente 8 campos top-level',
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys.sort()),
        `got ${JSON.stringify(actualKeys)}`);
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Backwards-compat con consumer mínimo
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 2] Backwards-compat con consumer mínimo');
{
    const payload = buildHealthPayload(getHealthDefaults());
    // Cualquier monitor que solo lea body.status sigue funcionando.
    ok('un consumer que solo lee body.status === "ok" funciona',
        payload.status === 'ok');
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Precedencia de version: CHIBALETE_RELEASE > package.json > "unknown"
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 3] Precedencia de version');
{
    // 3a. Sin env CHIBALETE_RELEASE: debe leer de package.json
    const beforeRelease = process.env.CHIBALETE_RELEASE;
    delete process.env.CHIBALETE_RELEASE;
    const d1 = getHealthDefaults();
    ok('3a: sin CHIBALETE_RELEASE, version es string no vacío',
        typeof d1.version === 'string' && d1.version.length > 0);
    ok('3a: version no es "unknown" (package.json se leyó OK)',
        d1.version !== 'unknown',
        `got "${d1.version}" — package.json no se pudo leer?`);

    // 3b. Con CHIBALETE_RELEASE setteado, sobrescribe package.json
    process.env.CHIBALETE_RELEASE = 'rel-test-2026';
    const d2 = getHealthDefaults();
    ok('3b: CHIBALETE_RELEASE override package.json',
        d2.version === 'rel-test-2026');

    // 3c. Restaurar para no afectar tests siguientes
    if (beforeRelease === undefined) delete process.env.CHIBALETE_RELEASE;
    else process.env.CHIBALETE_RELEASE = beforeRelease;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. commit: env GIT_SHA o null
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 4] commit precedencia');
{
    const beforeSha = process.env.GIT_SHA;

    // 4a. Sin env: commit === null
    delete process.env.GIT_SHA;
    const d1 = getHealthDefaults();
    ok('4a: sin GIT_SHA, commit === null',
        d1.commit === null,
        `got ${JSON.stringify(d1.commit)}`);

    // 4b. Con env: commit === valor exacto
    process.env.GIT_SHA = 'abc1234';
    const d2 = getHealthDefaults();
    ok('4b: GIT_SHA="abc1234", commit === "abc1234"',
        d2.commit === 'abc1234');

    // 4c. String vacío en env trata como null (operador || maneja falsy)
    process.env.GIT_SHA = '';
    const d3 = getHealthDefaults();
    ok('4c: GIT_SHA="" → commit === null (no string vacía)',
        d3.commit === null);

    // Restaurar
    if (beforeSha === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = beforeSha;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. instance: HOSTNAME o "unknown"
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 5] instance precedencia');
{
    const beforeHost = process.env.HOSTNAME;

    process.env.HOSTNAME = 'chibalete_api_1';
    const d1 = getHealthDefaults();
    ok('5a: HOSTNAME="chibalete_api_1" → instance === "chibalete_api_1"',
        d1.instance === 'chibalete_api_1');

    delete process.env.HOSTNAME;
    const d2 = getHealthDefaults();
    ok('5b: sin HOSTNAME → instance === "unknown"',
        d2.instance === 'unknown');

    if (beforeHost === undefined) delete process.env.HOSTNAME;
    else process.env.HOSTNAME = beforeHost;
}

// ────────────────────────────────────────────────────────────────────────────
// 6. timestamp se actualiza por request (inyectable en tests)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 6] timestamp es por-request, no estático');
{
    const defaults = getHealthDefaults();
    const fixedDate = new Date('2026-05-06T12:34:56.000Z');
    const payload = buildHealthPayload(defaults, fixedDate);
    ok('timestamp inyectable (signature soporta override en tests)',
        payload.timestamp === '2026-05-06T12:34:56.000Z');

    // Sin override usa Date actual — cada llamada produce timestamp distinto
    const p1 = buildHealthPayload(defaults);
    // Pequeña espera no-crítica: usamos un sleep busy minimal.
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin 5ms */ }
    const p2 = buildHealthPayload(defaults);
    ok('timestamp diferente en llamadas separadas',
        p1.timestamp !== p2.timestamp);
}

// ────────────────────────────────────────────────────────────────────────────
// 7. uptime es process.uptime() actual (número entero)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 7] uptime refleja process.uptime()');
{
    const defaults = getHealthDefaults();
    const payload = buildHealthPayload(defaults);
    const pUptime = process.uptime();
    // Tolerancia de 2 segundos (los tests pueden tardar)
    ok('uptime ≈ process.uptime() (tolerancia 2s)',
        Math.abs(payload.uptime - Math.floor(pUptime)) <= 2,
        `payload.uptime=${payload.uptime}, process.uptime=${pUptime}`);
}

// ────────────────────────────────────────────────────────────────────────────
// 8. Garantías de seguridad: no llama validateMembershipIntegrity, no requiere
//    admin secret. Verificación estática del módulo importado.
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 8] Garantías de seguridad — verificación estática del módulo');
{
    // Leer el código fuente del helper y verificar ausencia de patrones peligrosos.
    // El helper NO debe importar fs.readFileSync sobre rutas de data ni adquirir
    // locks ni invocar validateMembershipIntegrity.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __filename = url.fileURLToPath(import.meta.url);
    const helperPath = path.resolve(path.dirname(__filename), '..', 'healthHandler.js');
    const rawSrc = fs.readFileSync(helperPath, 'utf8');

    // Stripear comentarios de bloque y línea — los chequeos buscan
    // referencias EN CÓDIGO REAL, no en JSDoc explicativo (donde
    // legítimamente nombramos lo que NO debe hacer).
    const src = rawSrc
        .replace(/\/\*[\s\S]*?\*\//g, '')   // /* ... */
        .replace(/^\s*\/\/.*$/gm, '')        // // ...
        .replace(/\s*\/\/[^\n]*$/gm, '');    // trailing // ...

    ok('NO importa validateMembershipIntegrity (en código)',
        !/validateMembershipIntegrity/.test(src));
    ok('NO importa withFileLock (en código)',
        !/withFileLock/.test(src));
    ok('NO importa USERS_DB ni data-critical (en código)',
        !/USERS_DB|data-critical|data\/users_db/.test(src));
    ok('NO requiere auth middleware (en código)',
        !/requireAdminAccess|requireAuth/.test(src));
    ok('NO ejecuta queries de membresía (en código)',
        !/getGroupMembers|getExplicitGroupMembers|applyGroupMembersChange/.test(src));
}

// ────────────────────────────────────────────────────────────────────────────
// 9. .deploy-info (Sprint 022 Fase 2B.7 — D2)
// ────────────────────────────────────────────────────────────────────────────
console.log('\n[CASO 9] .deploy-info — fuente canónica del deploy backend');
{
    const beforeRel = process.env.CHIBALETE_RELEASE;
    const beforeSha = process.env.GIT_SHA;
    delete process.env.CHIBALETE_RELEASE;
    delete process.env.GIT_SHA;

    try {
        // 9a. Sin .deploy-info: fallback a env/package.json, deployed_at=null
        removeDeployInfo();
        const d1 = getHealthDefaults();
        ok('9a: sin .deploy-info, deployed_at === null',
            d1.deployed_at === null);
        ok('9a: sin .deploy-info, commit === null',
            d1.commit === null);
        ok('9a: sin .deploy-info, version cae a package.json (no "unknown")',
            d1.version !== 'unknown');

        // 9b. .deploy-info válido: prevalece sobre env/package.json
        writeDeployInfo(JSON.stringify({
            release_tag: 'rel-2026-05-07-test',
            git_sha:     'abc1234567890def',
            deployed_at: '2026-05-07T23:14:55Z',
        }));
        const d2 = getHealthDefaults();
        ok('9b: release_tag prevalece sobre package.json',
            d2.version === 'rel-2026-05-07-test');
        ok('9b: git_sha del .deploy-info → commit',
            d2.commit === 'abc1234567890def');
        ok('9b: deployed_at del .deploy-info se expone',
            d2.deployed_at === '2026-05-07T23:14:55Z');

        // 9c. .deploy-info presente pero CHIBALETE_RELEASE también: file gana
        process.env.CHIBALETE_RELEASE = 'env-should-lose';
        process.env.GIT_SHA = 'env-sha-should-lose';
        const d3 = getHealthDefaults();
        ok('9c: .deploy-info.release_tag > CHIBALETE_RELEASE',
            d3.version === 'rel-2026-05-07-test');
        ok('9c: .deploy-info.git_sha > GIT_SHA env',
            d3.commit === 'abc1234567890def');
        delete process.env.CHIBALETE_RELEASE;
        delete process.env.GIT_SHA;

        // 9d. .deploy-info JSON corrupto: NO romper, fallback graceful
        writeDeployInfo('{ esto NO es JSON válido :::: ');
        let d4;
        let threw = false;
        try { d4 = getHealthDefaults(); } catch { threw = true; }
        ok('9d: JSON corrupto NO lanza excepción',
            !threw);
        ok('9d: JSON corrupto → deployed_at === null (fallback)',
            d4 && d4.deployed_at === null);
        ok('9d: JSON corrupto → commit === null (fallback)',
            d4 && d4.commit === null);

        // 9e. .deploy-info vacío: NO romper
        writeDeployInfo('');
        const d5 = getHealthDefaults();
        ok('9e: archivo vacío → deployed_at === null',
            d5.deployed_at === null);

        // 9f. .deploy-info con campos faltantes: cada campo cae a su fallback
        writeDeployInfo(JSON.stringify({ release_tag: 'partial-rel' }));
        const d6 = getHealthDefaults();
        ok('9f: solo release_tag presente → version usa release_tag',
            d6.version === 'partial-rel');
        ok('9f: git_sha ausente → commit === null',
            d6.commit === null);
        ok('9f: deployed_at ausente → deployed_at === null',
            d6.deployed_at === null);

        // 9g. .deploy-info con tipos no string: ignora con coerce a null
        writeDeployInfo(JSON.stringify({
            release_tag: 12345,        // number, no string → ignorar
            git_sha:     null,         // null → ignorar
            deployed_at: '2026-01-01T00:00:00Z',
        }));
        const d7 = getHealthDefaults();
        ok('9g: release_tag no-string → cae a package.json (no number)',
            typeof d7.version === 'string' && d7.version !== '12345');
        ok('9g: git_sha null → commit null',
            d7.commit === null);
        ok('9g: deployed_at string válido se expone',
            d7.deployed_at === '2026-01-01T00:00:00Z');

        // 9h. Array (JSON válido pero shape inválido)
        writeDeployInfo(JSON.stringify(['rel', 'sha', 'when']));
        const d8 = getHealthDefaults();
        ok('9h: array JSON → tratado como inválido, fallback completo',
            d8.deployed_at === null && d8.commit === null);

    } finally {
        // CRÍTICO: limpiar fixture aunque el test falle a mitad de camino.
        // No queremos dejar un .deploy-info residual en server/ que afecte
        // runs siguientes o el health endpoint en dev.
        removeDeployInfo();
        if (beforeRel === undefined) delete process.env.CHIBALETE_RELEASE;
        else process.env.CHIBALETE_RELEASE = beforeRel;
        if (beforeSha === undefined) delete process.env.GIT_SHA;
        else process.env.GIT_SHA = beforeSha;
    }
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\nhealthEndpoint — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
