/**
 * adminSecretIntegration.test.js — CHP-SEC-ADMIN-FILE-01B
 *
 * Prueba la integración file-only del gateway `headerMatchesAdminSecret` y su
 * semántica en los consumidores. Para ejercer la RUTA CANÓNICA fija
 * (/app/secrets/admin_secret) sin seams productivos, este test se ejecuta dentro
 * del runner Docker con /app/secrets montado como tmpfs privado, propiedad del
 * proceso, modo 0400, poblado sólo con secretos sintéticos.
 *
 * Run (Linux; requiere poder crear /app/secrets/admin_secret 0400 propiedad del
 * proceso — en el runner corre como root con tmpfs en /app/secrets):
 *   node server/__test__/adminSecretIntegration.test.js
 *
 * En win32 o sin /app/secrets escribible, el test se AUTO-OMITE (skip) porque la
 * ruta canónica no es configurable por diseño (FILE-01A). No usa fallback.
 */
import fs from 'node:fs';
import { headerMatchesAdminSecret } from '../lib/adminSecretRequest.js';
import { ADMIN_SECRET_PATH } from '../lib/adminSecret.js';

let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
    if (condition) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(label) { console.log(`\n${label}`); }

// Secretos sintéticos y un centinela de environment.
const SENTINEL = 'SENTINEL-ENV-NEVER-RETURNED-9998887776665554443';
const SECRET_A = 'INTEG-secret-alpha-0123456789abcdefghijkl';
const SECRET_B = 'INTEG_secret_bravo_zyxwvutsrqponmlkjihgfe';

const CANON = ADMIN_SECRET_PATH; // '/app/secrets/admin_secret'
const DIR = CANON.slice(0, CANON.lastIndexOf('/'));

// Escribe el archivo canónico con el modo/propiedad que exige el helper.
function stageCanonical(content) {
    const tmp = `${DIR}/.stage-${Math.abs(hashish(content))}`;
    fs.writeFileSync(tmp, content);
    fs.chmodSync(tmp, 0o400);
    fs.renameSync(tmp, CANON); // sustitución atómica
}
function hashish(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function removeCanonical() { try { fs.chmodSync(CANON, 0o600); } catch {} try { fs.unlinkSync(CANON); } catch {} }
const reqWith = (val) => ({ headers: val === undefined ? {} : { 'x-admin-secret': val } });

// ¿Podemos crear la ruta canónica con el modo requerido?
let CAN_STAGE = false;
try {
    fs.mkdirSync(DIR, { recursive: true });
    stageCanonical(`${SECRET_A}`);
    removeCanonical();
    CAN_STAGE = process.platform === 'linux';
} catch { CAN_STAGE = false; }

console.log('adminSecretIntegration — gateway file-only');
console.log(`  runtime: ${process.platform} node ${process.version} uid=${process.getuid?.()} gid=${process.getgid?.()}`);
console.log(`  ruta canónica: ${CANON}`);

if (!CAN_STAGE) {
    console.log('\n  [SKIP] entorno sin /app/secrets escribible como tmpfs propiedad del proceso.');
    console.log('  Este test está diseñado para el runner Docker (FASE 3). No usa seam ni fallback.');
    console.log(`\nadminSecretIntegration — pass=${pass} fail=${fail} (SKIPPED)`);
    process.exit(0);
}

try {
    // ───────────────────────────── [1] import inocuo, sin archivo
    section('[1] sin archivo canónico');
    {
        removeCanonical();
        ok('archivo canónico ausente', !fs.existsSync(CANON));
        const beforeSecret = process.env.ADMIN_SECRET;
        process.env.ADMIN_SECRET = SENTINEL; // env poblado; jamás debe usarse
        try {
            const r = await headerMatchesAdminSecret(reqWith(SENTINEL));
            ok('[4] header=sentinel + archivo ausente → false', r === false);
            ok('[4] devuelve boolean, nunca truthy accidental', typeof r === 'boolean');
        } finally {
            if (beforeSecret === undefined) delete process.env.ADMIN_SECRET;
            else process.env.ADMIN_SECRET = beforeSecret;
        }
    }

    // ───────────────────────────── [2-3] header ausente/ inválido → sin lectura, false
    section('[2-3] header candidato inválido');
    {
        stageCanonical(SECRET_A); // archivo válido presente
        ok('header ausente → false', (await headerMatchesAdminSecret(reqWith(undefined))) === false);
        ok('header vacío → false', (await headerMatchesAdminSecret(reqWith(''))) === false);
        ok('header array → false', (await headerMatchesAdminSecret({ headers: { 'x-admin-secret': [SECRET_A] } })) === false);
        ok('header número → false', (await headerMatchesAdminSecret({ headers: { 'x-admin-secret': 123 } })) === false);
        ok('req sin headers → false', (await headerMatchesAdminSecret({})) === false);
    }

    // ───────────────────────────── [7-8] archivo válido + header correcto/incorrecto
    section('[7-8] archivo canónico válido');
    {
        stageCanonical(SECRET_A);
        ok('[7] header correcto → true', (await headerMatchesAdminSecret(reqWith(SECRET_A))) === true);
        ok('[8] header incorrecto → false', (await headerMatchesAdminSecret(reqWith(SECRET_B))) === false);
        ok('[8] header casi-correcto → false', (await headerMatchesAdminSecret(reqWith(`${SECRET_A}x`))) === false);
    }

    // ───────────────────────────── [5] archivo inseguro + sentinel en env
    section('[5] archivo inseguro no autoriza ni hace fallback');
    {
        const beforeSecret = process.env.ADMIN_SECRET;
        process.env.ADMIN_SECRET = SENTINEL;
        try {
            // modo 0644 = inseguro → helper lanza INVALID_MODE → gateway false
            const tmp = `${DIR}/.stage-bad`;
            fs.writeFileSync(tmp, SECRET_A);
            fs.chmodSync(tmp, 0o400);
            fs.renameSync(tmp, CANON);
            fs.chmodSync(CANON, 0o644);
            ok('[5] archivo modo inseguro + header correcto → false', (await headerMatchesAdminSecret(reqWith(SECRET_A))) === false);
            ok('[5] sentinel en env jamás autoriza', (await headerMatchesAdminSecret(reqWith(SENTINEL))) === false);
            fs.chmodSync(CANON, 0o400); // restaurar
        } finally {
            if (beforeSecret === undefined) delete process.env.ADMIN_SECRET;
            else process.env.ADMIN_SECRET = beforeSecret;
        }
    }

    // ───────────────────────────── [6] ADMIN_SECRET_FILE ignorado
    section('[6] ADMIN_SECRET_FILE completamente ignorado');
    {
        const beforeFile = process.env.ADMIN_SECRET_FILE;
        const decoy = `${DIR}/decoy_secret`;
        fs.writeFileSync(decoy, SECRET_B);
        fs.chmodSync(decoy, 0o400);
        process.env.ADMIN_SECRET_FILE = decoy;
        try {
            stageCanonical(SECRET_A);
            ok('sólo la ruta canónica cuenta (header=A → true)', (await headerMatchesAdminSecret(reqWith(SECRET_A))) === true);
            ok('el decoy de ADMIN_SECRET_FILE nunca autoriza (header=B → false)', (await headerMatchesAdminSecret(reqWith(SECRET_B))) === false);
        } finally {
            if (beforeFile === undefined) delete process.env.ADMIN_SECRET_FILE;
            else process.env.ADMIN_SECRET_FILE = beforeFile;
            try { fs.unlinkSync(decoy); } catch {}
        }
    }

    // ───────────────────────────── [9] fallos del helper fallan cerrado sin lanzar
    section('[9] errores del helper → false, sin excepción');
    {
        // FILE_MISSING
        removeCanonical();
        let threw = false;
        let r;
        try { r = await headerMatchesAdminSecret(reqWith(SECRET_A)); } catch { threw = true; }
        ok('FILE_MISSING → false, sin throw', r === false && !threw);

        // NOT_REGULAR_FILE (directorio en la ruta) — difícil sin colisionar; probamos symlink.
        stageCanonical(SECRET_A);
        const linkSrc = `${DIR}/real_secret`;
        fs.writeFileSync(linkSrc, SECRET_A); fs.chmodSync(linkSrc, 0o400);
        removeCanonical();
        fs.symlinkSync(linkSrc, CANON);
        let threw2 = false; let r2;
        try { r2 = await headerMatchesAdminSecret(reqWith(SECRET_A)); } catch { threw2 = true; }
        ok('SYMLINK_REJECTED → false, sin throw', r2 === false && !threw2);
        fs.unlinkSync(CANON); fs.unlinkSync(linkSrc);
    }

    // ───────────────────────────── [15-16] rotación A/B visible por evaluación
    section('[15-16] sustitución atómica A/B visible sin reiniciar');
    {
        stageCanonical(SECRET_A);
        ok('[15] con A: header A → true', (await headerMatchesAdminSecret(reqWith(SECRET_A))) === true);
        stageCanonical(SECRET_B);
        ok('[15] tras rename B: header A → false', (await headerMatchesAdminSecret(reqWith(SECRET_A))) === false);
        ok('[15] tras rename B: header B → true', (await headerMatchesAdminSecret(reqWith(SECRET_B))) === true);

        let good = 0;
        for (let i = 0; i < 10; i++) {
            const cur = i % 2 === 0 ? SECRET_A : SECRET_B;
            const other = i % 2 === 0 ? SECRET_B : SECRET_A;
            stageCanonical(cur);
            const okCur = (await headerMatchesAdminSecret(reqWith(cur))) === true;
            const rejOther = (await headerMatchesAdminSecret(reqWith(other))) === false;
            if (okCur && rejOther) good++;
        }
        ok('[16] 10 alternancias: siempre valor completo, nunca mezclado', good === 10, `ok=${good}/10`);
    }

    // ───────────────────────────── [17] no filtración de sentinels
    section('[17] sin filtración de material');
    {
        // El gateway no lanza ni loguea; verificamos que su retorno es sólo boolean.
        stageCanonical(SECRET_A);
        const r = await headerMatchesAdminSecret(reqWith(SECRET_A));
        ok('retorno estrictamente boolean', r === true && typeof r === 'boolean');
    }

    // ─────────────── [S] cero lectura sin header candidato (instrumentación externa) ──
    // Envolvemos fs.promises.open (capa Node, NO el helper) para contar aperturas de
    // la ruta canónica. No expone el Buffer interno ni configura ruta/lector.
    section('[S] cero open() de la ruta canónica sin candidato');
    {
        stageCanonical(SECRET_A);
        const realOpen = fs.promises.open;
        let opens = 0;
        fs.promises.open = function (p, ...rest) {
            if (p === CANON) opens += 1;
            return realOpen.call(this, p, ...rest);
        };
        try {
            opens = 0;
            await headerMatchesAdminSecret(reqWith(undefined)); // sin header
            await headerMatchesAdminSecret(reqWith(''));         // vacío
            await headerMatchesAdminSecret({ headers: {} });     // sin headers
            ok('[4-5] sin candidato → 0 open() de la ruta canónica', opens === 0, `opens=${opens}`);

            opens = 0;
            await headerMatchesAdminSecret(reqWith(SECRET_A));   // con candidato
            ok('[5] con candidato → exactamente 1 open()', opens === 1, `opens=${opens}`);

            opens = 0;
            await headerMatchesAdminSecret(reqWith(SECRET_A));
            await headerMatchesAdminSecret(reqWith(SECRET_A));
            ok('[24] sin caché: 2 evaluaciones → 2 open()', opens === 2, `opens=${opens}`);
        } finally {
            fs.promises.open = realOpen;
        }
    }
} finally {
    removeCanonical();
    console.log(`\n  ruta canónica limpia: ${!fs.existsSync(CANON)}`);
}

console.log(`\nadminSecretIntegration — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
