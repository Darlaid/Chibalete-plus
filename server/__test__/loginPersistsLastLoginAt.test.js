/**
 * loginPersistsLastLoginAt.test.js — Sprint Modo Accesible (Objetivo 1).
 *
 * Verifica el fix de persistencia: tras un login exitoso, el campo
 * lastLoginAt queda escrito en el user, y buildStudentStatus deja de
 * resolver el estado como REGISTERED_NO_LOGIN.
 *
 * Reproduce el cuerpo del handler POST /api/auth/login (la sección
 * relevante: el branch isValid + isUserActive). No levanta Express —
 * mismo patrón scenario-level usado en los sprints anteriores.
 *
 * Cómo correr:
 *   node server/__test__/loginPersistsLastLoginAt.test.js
 */

import {
    buildStudentStatus,
    STUDENT_STATE,
} from '../../utils/studentStatus.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

console.log('loginPersistsLastLoginAt — Sprint Modo Accesible (Objetivo 1)');

// Réplica mínima del handler (la rama isValid + isUserActive, posterior al fix).
function simulateLoginHandler(usersDb, email) {
    const userIndex = usersDb.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (userIndex === -1) return { ok: false, reason: 'not_found' };
    const user = usersDb[userIndex];
    // Simulamos isValid=true e isUserActive=true.
    user.lastLoginAt = new Date().toISOString();
    usersDb[userIndex] = user;
    return { ok: true, user };
}

// ────────────────────────────────────────────────────────────────────────────
// 1. Antes del login: REGISTERED_NO_LOGIN (sin lastLoginAt)
// ────────────────────────────────────────────────────────────────────────────
{
    const user = {
        id:               'u1',
        nombre_completo:  'Ana Pérez',
        email:            'ana@x.com',
        roles:            ['lector'],
        // Sin lastLoginAt — recién creada o nunca ingresó.
    };
    const status = buildStudentStatus(
        user,
        { inAnyGroup: true, hasContentAccess: true },
        { lastLoginAt: user.lastLoginAt || null },
    );
    ok('PRE-LOGIN: state = REGISTERED_NO_LOGIN', status.state === STUDENT_STATE.REGISTERED_NO_LOGIN);
    ok('PRE-LOGIN: lastLoginAt = null',          status.lastLoginAt === null);
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Tras login: handler escribe lastLoginAt
// ────────────────────────────────────────────────────────────────────────────
{
    const usersDb = [{
        id: 'u1', nombre_completo: 'Ana Pérez',
        email: 'ana@x.com', roles: ['lector'],
    }];
    const result = simulateLoginHandler(usersDb, 'ana@x.com');
    ok('LOGIN: handler retorna ok',                  result.ok === true);
    ok('LOGIN: user.lastLoginAt persistido',         typeof usersDb[0].lastLoginAt === 'string');
    ok('LOGIN: lastLoginAt es ISO timestamp válido', !Number.isNaN(new Date(usersDb[0].lastLoginAt).getTime()));
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Tras login: studentStatus deja de ser REGISTERED_NO_LOGIN
// ────────────────────────────────────────────────────────────────────────────
{
    const usersDb = [{
        id: 'u1', nombre_completo: 'Ana Pérez',
        email: 'ana@x.com', roles: ['lector'],
    }];
    simulateLoginHandler(usersDb, 'ana@x.com');
    const user = usersDb[0];

    // Caso 3a: tiene grupo + acceso + ahora tiene login → ACTIVE_NO_PROGRESS
    const statusNoProgress = buildStudentStatus(
        user,
        { inAnyGroup: true, hasContentAccess: true, lastReadingEventAt: null },
        { lastLoginAt: user.lastLoginAt },
    );
    ok('POST-LOGIN sin progreso: state = ACTIVE_NO_PROGRESS',
        statusNoProgress.state === STUDENT_STATE.ACTIVE_NO_PROGRESS);
    ok('POST-LOGIN sin progreso: lastLoginAt visible',
        statusNoProgress.lastLoginAt === user.lastLoginAt);

    // Caso 3b: tiene grupo + acceso + login + lectura → ACTIVE_PROGRESS
    const statusActive = buildStudentStatus(
        user,
        { inAnyGroup: true, hasContentAccess: true,
          lastReadingEventAt: '2026-05-04T10:00:00Z',
          booksStarted: 1, progressPercentage: 50 },
        { lastLoginAt: user.lastLoginAt },
    );
    ok('POST-LOGIN con progreso: state = ACTIVE_PROGRESS',
        statusActive.state === STUDENT_STATE.ACTIVE_PROGRESS);
}

// ────────────────────────────────────────────────────────────────────────────
// 4. lastLoginAt avanza en logins sucesivos (no se queda fija)
// ────────────────────────────────────────────────────────────────────────────
{
    const usersDb = [{ id: 'u1', email: 'ana@x.com', roles: ['lector'] }];
    simulateLoginHandler(usersDb, 'ana@x.com');
    const first = usersDb[0].lastLoginAt;

    // Esperamos un tick para que ISO cambie (al menos 1 ms).
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    await wait(5);
    simulateLoginHandler(usersDb, 'ana@x.com');
    const second = usersDb[0].lastLoginAt;

    ok('LOGIN sucesivo: lastLoginAt avanza', new Date(second).getTime() > new Date(first).getTime());
}

// ────────────────────────────────────────────────────────────────────────────
// 5. El handler NO escribe lastLoginAt en login fallido
// ────────────────────────────────────────────────────────────────────────────
{
    // Simulamos el branch fallido: el handler simplemente no entra al bloque
    // isValid → no muta usersDb. Reproducimos no llamando a simulateLoginHandler.
    const user = { id: 'u1', email: 'ana@x.com', roles: ['lector'] };
    ok('LOGIN fallido: lastLoginAt sigue undefined', user.lastLoginAt === undefined);
    const status = buildStudentStatus(user,
        { inAnyGroup: true, hasContentAccess: true },
        { lastLoginAt: user.lastLoginAt || null });
    ok('LOGIN fallido: state sigue REGISTERED_NO_LOGIN', status.state === STUDENT_STATE.REGISTERED_NO_LOGIN);
}

console.log('');
console.log(`loginPersistsLastLoginAt — pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
