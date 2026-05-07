/**
 * studentStatus.test.js — Sprint Panel del estudiante.
 *
 * Cubre los 6 estados, prioridad first-match-wins, shape estable,
 * y regression guard de jerga técnica en mensajes.
 *
 * Cómo correr:
 *   node server/__test__/studentStatus.test.js
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

const baseUser = {
    id: 'u1',
    nombre_completo: 'Ana Pérez',
    nombre_usuario:  'anita',
    email:           'ana@x.com',
    roles:           ['lector'],
};

console.log('studentStatus — Sprint Panel del estudiante');

// ────────────────────────────────────────────────────────────────────────────
// 1. ACTIVE_PROGRESS
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true,
          lastReadingEventAt: '2026-05-04T10:00:00Z',
          booksStarted: 2, booksCompleted: 1, progressPercentage: 60 },
        { lastLoginAt: '2026-05-04T09:55:00Z', recentErrorsCount: 0 });

    ok('ACTIVE_PROGRESS: state',         s.state === STUDENT_STATE.ACTIVE_PROGRESS);
    ok('ACTIVE_PROGRESS: tone=ok',       s.tone === 'ok');
    ok('ACTIVE_PROGRESS: name resuelto', s.name === 'Ana Pérez');
    ok('ACTIVE_PROGRESS: progress.percentage=60', s.progress.percentage === 60);
    ok('ACTIVE_PROGRESS: lastLoginAt presente',    s.lastLoginAt === '2026-05-04T09:55:00Z');
    ok('ACTIVE_PROGRESS: lastReadingEventAt',      s.lastReadingEventAt === '2026-05-04T10:00:00Z');
}

// ────────────────────────────────────────────────────────────────────────────
// 2. ACTIVE_NO_PROGRESS — entró pero no avanzó
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true,
          lastReadingEventAt: null, booksStarted: 0, progressPercentage: 0 },
        { lastLoginAt: '2026-05-03T08:00:00Z' });

    ok('ACTIVE_NO_PROGRESS: state', s.state === STUDENT_STATE.ACTIVE_NO_PROGRESS);
    ok('ACTIVE_NO_PROGRESS: tone=warning', s.tone === 'warning');
    ok('ACTIVE_NO_PROGRESS: lastLoginAt preservado',
        s.lastLoginAt === '2026-05-03T08:00:00Z');
    ok('ACTIVE_NO_PROGRESS: progress en cero',
        s.progress.percentage === 0 && s.progress.booksStarted === 0);
    ok('ACTIVE_NO_PROGRESS: message no vacío',           s.message.length > 0);
    ok('ACTIVE_NO_PROGRESS: cause no vacío',             s.cause.length > 0);
    ok('ACTIVE_NO_PROGRESS: recommendedAction no vacío', s.recommendedAction.length > 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 3. REGISTERED_NO_LOGIN — sin lastLoginAt
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true },
        { lastLoginAt: null });

    ok('REGISTERED_NO_LOGIN: state',   s.state === STUDENT_STATE.REGISTERED_NO_LOGIN);
    ok('REGISTERED_NO_LOGIN: tone=warning', s.tone === 'warning');
    ok('REGISTERED_NO_LOGIN: lastLoginAt=null', s.lastLoginAt === null);
}

// ────────────────────────────────────────────────────────────────────────────
// 4. NO_GROUP — sin grupos asignados
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(baseUser,
        { inAnyGroup: false },
        { lastLoginAt: '2026-05-01T08:00:00Z', recentErrorsCount: 0 });

    ok('NO_GROUP: state',         s.state === STUDENT_STATE.NO_GROUP);
    ok('NO_GROUP: tone=warning',  s.tone === 'warning');
    // El estado NO_GROUP gana sobre REGISTERED_NO_LOGIN cuando ya tiene login
    ok('NO_GROUP: lastLoginAt preservado', s.lastLoginAt === '2026-05-01T08:00:00Z');
}

// ────────────────────────────────────────────────────────────────────────────
// 5. NO_ACCESS — en grupo pero sin contenido habilitado
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: false },
        { lastLoginAt: '2026-05-01T08:00:00Z' });

    ok('NO_ACCESS: state',          s.state === STUDENT_STATE.NO_ACCESS);
    ok('NO_ACCESS: tone=warning',   s.tone === 'warning');
}

// ────────────────────────────────────────────────────────────────────────────
// 6. TECH_ISSUE — errores técnicos recientes
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true, lastReadingEventAt: '2026-05-04T10:00:00Z' },
        { lastLoginAt: '2026-05-04T09:55:00Z', recentErrorsCount: 5 });

    ok('TECH_ISSUE: state',     s.state === STUDENT_STATE.TECH_ISSUE);
    ok('TECH_ISSUE: tone=error', s.tone === 'error');
    // TECH_ISSUE gana sobre cualquier otro estado positivo
}

// ────────────────────────────────────────────────────────────────────────────
// 7. PRIORIDAD — TECH_ISSUE > NO_GROUP > NO_ACCESS > REGISTERED_NO_LOGIN
// ────────────────────────────────────────────────────────────────────────────
{
    // TECH gana aunque también no tenga grupo
    const s1 = buildStudentStatus(baseUser,
        { inAnyGroup: false }, { lastLoginAt: null, recentErrorsCount: 1 });
    ok('PRIORIDAD: TECH > NO_GROUP', s1.state === STUDENT_STATE.TECH_ISSUE);

    // NO_GROUP gana sobre NO_ACCESS y REGISTERED_NO_LOGIN
    const s2 = buildStudentStatus(baseUser,
        { inAnyGroup: false, hasContentAccess: false }, { lastLoginAt: null });
    ok('PRIORIDAD: NO_GROUP > NO_ACCESS', s2.state === STUDENT_STATE.NO_GROUP);

    // NO_ACCESS gana sobre REGISTERED_NO_LOGIN cuando hay grupo
    const s3 = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: false }, { lastLoginAt: null });
    ok('PRIORIDAD: NO_ACCESS > REGISTERED_NO_LOGIN', s3.state === STUDENT_STATE.NO_ACCESS);

    // REGISTERED_NO_LOGIN gana sobre ACTIVE_NO_PROGRESS
    const s4 = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true }, { lastLoginAt: null });
    ok('PRIORIDAD: REGISTERED_NO_LOGIN > ACTIVE_NO_PROGRESS',
        s4.state === STUDENT_STATE.REGISTERED_NO_LOGIN);

    // ACTIVE_NO_PROGRESS gana sobre ACTIVE_PROGRESS sin reading
    const s5 = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true,
          lastReadingEventAt: null, booksStarted: 0, progressPercentage: 0 },
        { lastLoginAt: '2026-05-04T08:00:00Z' });
    ok('PRIORIDAD: ACTIVE_NO_PROGRESS sin reading',
        s5.state === STUDENT_STATE.ACTIVE_NO_PROGRESS);
}

// ────────────────────────────────────────────────────────────────────────────
// 8. INPUTS UNDEFINED — el decisor no inventa
// ────────────────────────────────────────────────────────────────────────────
{
    // Si hasContentAccess es undefined, NO_ACCESS no se activa.
    // Si inAnyGroup es undefined, NO_GROUP no se activa.
    // Solo nos queda REGISTERED_NO_LOGIN (lastLoginAt está implícitamente null).
    const s = buildStudentStatus(baseUser, {}, {});
    ok('UNDEFINED: estado por defecto = REGISTERED_NO_LOGIN',
        s.state === STUDENT_STATE.REGISTERED_NO_LOGIN);
    ok('UNDEFINED: progress en cero',
        s.progress.percentage === 0 && s.progress.booksStarted === 0 && s.progress.booksCompleted === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 9. USER NULO — sentinel TECH_ISSUE
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(null, {}, {});
    ok('NULL user: state TECH_ISSUE', s.state === STUDENT_STATE.TECH_ISSUE);
    ok('NULL user: userId null',      s.userId === null);
    ok('NULL user: name fallback',    s.name === 'Estudiante');
    ok('NULL user: tone error',       s.tone === 'error');
    ok('NULL user: progress en cero', s.progress.percentage === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 10. NAME RESOLUTION — fallback chain
// ────────────────────────────────────────────────────────────────────────────
{
    const u1 = { id: 'u1', nombre_completo: 'Beto', nombre_usuario: 'b', email: 'b@x' };
    ok('NAME: nombre_completo gana', buildStudentStatus(u1, {}, {}).name === 'Beto');

    const u2 = { id: 'u2', nombre_usuario: 'cris', email: 'c@x' };
    ok('NAME: nombre_usuario fallback', buildStudentStatus(u2, {}, {}).name === 'cris');

    const u3 = { id: 'u3', email: 'dafne@x' };
    ok('NAME: email fallback', buildStudentStatus(u3, {}, {}).name === 'dafne@x');

    const u4 = { id: 'u4' };
    ok('NAME: default "Estudiante"', buildStudentStatus(u4, {}, {}).name === 'Estudiante');
}

// ────────────────────────────────────────────────────────────────────────────
// 11. SHAPE ESTABLE
// ────────────────────────────────────────────────────────────────────────────
{
    const s = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true,
          lastReadingEventAt: '2026-05-04T10:00:00Z', booksStarted: 1, progressPercentage: 30 },
        { lastLoginAt: '2026-05-04T09:55:00Z' });

    const requiredKeys = ['userId', 'name', 'state', 'tone', 'headline',
                          'message', 'cause', 'recommendedAction',
                          'lastLoginAt', 'lastReadingEventAt', 'progress'];
    for (const k of requiredKeys) {
        ok(`SHAPE: campo ${k} presente`, k in s);
    }
    ok('SHAPE: progress es objeto',
        typeof s.progress === 'object' && s.progress !== null);
    ok('SHAPE: progress.booksStarted number',   typeof s.progress.booksStarted === 'number');
    ok('SHAPE: progress.booksCompleted number', typeof s.progress.booksCompleted === 'number');
    ok('SHAPE: progress.percentage number',     typeof s.progress.percentage === 'number');
    ok('SHAPE: tone enum válido',  ['ok', 'warning', 'error'].includes(s.tone));
}

// ────────────────────────────────────────────────────────────────────────────
// 12. CLAMPING — percentage entre 0 y 100
// ────────────────────────────────────────────────────────────────────────────
{
    const high = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true,
          lastReadingEventAt: '2026-05-04T10:00:00Z', progressPercentage: 250 },
        { lastLoginAt: '2026-05-04T09:55:00Z' });
    ok('CLAMP: percentage > 100 → 100', high.progress.percentage === 100);

    const low = buildStudentStatus(baseUser,
        { inAnyGroup: true, hasContentAccess: true,
          lastReadingEventAt: '2026-05-04T10:00:00Z', progressPercentage: -5 },
        { lastLoginAt: '2026-05-04T09:55:00Z' });
    ok('CLAMP: percentage < 0 → 0', low.progress.percentage === 0);
}

// ────────────────────────────────────────────────────────────────────────────
// 13. REGRESSION GUARD — sin jerga técnica en mensajes
// ────────────────────────────────────────────────────────────────────────────
{
    const allMessages = [];
    const scenarios = [
        [{ inAnyGroup: false }, { lastLoginAt: null }],
        [{ inAnyGroup: true, hasContentAccess: false }, { lastLoginAt: null }],
        [{ inAnyGroup: true, hasContentAccess: true }, { lastLoginAt: null }],
        [{ inAnyGroup: true, hasContentAccess: true, lastReadingEventAt: null },
            { lastLoginAt: '2026-05-04T08:00:00Z' }],
        [{ inAnyGroup: true, hasContentAccess: true,
            lastReadingEventAt: '2026-05-04T10:00:00Z', booksStarted: 1 },
            { lastLoginAt: '2026-05-04T09:55:00Z' }],
        [{ inAnyGroup: true, hasContentAccess: true }, { lastLoginAt: '2026-05-04T09:55:00Z', recentErrorsCount: 3 }],
    ];
    for (const [m, l] of scenarios) {
        const s = buildStudentStatus(baseUser, m, l);
        allMessages.push(s.headline, s.message, s.cause, s.recommendedAction);
    }
    // También para user nulo
    const sNull = buildStudentStatus(null, {}, {});
    allMessages.push(sNull.headline, sNull.message, sNull.cause, sNull.recommendedAction);

    const techJargon = [/groupIds/, /memberIds/, /studentIds/, /\bnull\b/, /\bundefined\b/, /lastLoginAt/, /recentErrorsCount/];
    const offenders = allMessages.filter(m => techJargon.some(rx => rx.test(m)));
    ok('UI: ningún mensaje contiene jerga técnica',
        offenders.length === 0,
        `mensajes con jerga: ${JSON.stringify(offenders)}`);
}

console.log('');
console.log(`studentStatus — pass=${pass} fail=${fail}`);
if (fail > 0) process.exitCode = 1;
