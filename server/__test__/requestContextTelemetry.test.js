/**
 * requestContextTelemetry.test.js — CHP-STATS-LEGACY-PERF-OBS-01A-R2.
 *
 *   §1  Snapshot: forma, tipos, objeto nuevo, no mutable desde fuera
 *   §2  Derivaciones: active, studentComputations, clamp defensivo
 *   §3  Ausencia de contadores inventados, de PII, de secretos y de reset
 *   §4  Flag off: consultar no crea contexto
 *   §5  Flag on: created / disposed / active en una ruta institucional
 *   §6  Excepción controlada: también dispone
 *   §7  Ruta sin contexto: no crea contexto
 *   §8  Peticiones sucesivas y concurrentes: created = disposed, active = 0
 *   §9  Memoización: solo dentro de la misma petición
 *  §10  Matriz de autorización del middleware secret-only
 *  §11  Ruta HTTP real: 401 / 200, cabeceras y cuerpo
 *  §12  Stores reales intactos
 *
 *   node server/__test__/requestContextTelemetry.test.js
 *
 * Aislamiento total: `testMode.mjs` como primer import, fixtures sintéticas en
 * memoria, secreto de prueba en un temporal. Cero red, cero stores reales.
 */
import './helpers/testMode.mjs';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import express from 'express';

import {
    init as initMetrics,
    computeSchoolMetrics,
    computeCourseMetrics,
    computeStudentMetrics,
    createMetricsRequestContext,
    getMetricsRequestContextTelemetrySnapshot,
    metricsContextCounters,
    __setRequestContextEnabledForTests,
    isRequestContextEnabled,
} from '../metricsService.js';
import {
    createOperationalAdminSecretGuard,
    secretsMatch,
    candidateSecret,
    OPERATIONAL_ADMIN_HEADER,
} from '../lib/operationalAdminAuth.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};
const section = (n) => console.log(`\n${n}`);

// ── Huella de stores reales (§12) ───────────────────────────────────────────
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
const WATCHED = ['data', 'data-critical', 'public/uploads'].map((d) => path.resolve(REPO, d));
const storeFingerprint = () => {
    const h = crypto.createHash('sha256');
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.isFile()) continue;
            try { const st = fs.statSync(p); h.update(`${path.relative(REPO, p)}:${st.size}:${st.mtimeMs}|`); } catch { /* */ }
        }
    };
    for (const d of WATCHED) walk(d);
    return h.digest('hex');
};
const STORES_BEFORE = storeFingerprint();

// ── Fixtures sintéticas ─────────────────────────────────────────────────────
const SYNTHETIC = (() => {
    const users = [], groups = [], events = [], progressMap = {};
    for (let i = 1; i <= 6; i++) {
        const id = `u-tel-${i}`;
        users.push({ id, nombre_completo: `Sintetico ${i}`, roles: ['lector'] });
        progressMap[`${id}__c-1`] = { userId: id, contentId: 'c-1', progressPercentage: 40 + i, lastUpdated: '2026-07-01T00:00:00Z' };
        events.push({ userId: id, event: 'text.page_change', mode: 'text', contentId: 'c-1', server_ts: 1780000000000 + i * 1000, sessionId: `s-${i}` });
    }
    groups.push({ id: 'g-tel-1', name: 'Grupo telemetría', school: 'colegio-tel', studentIds: users.map((u) => u.id) });
    groups.push({ id: 'g-tel-2', name: 'Grupo telemetría 2', school: 'colegio-tel', studentIds: users.slice(0, 3).map((u) => u.id) });
    return { users, groups, events, progress: { progressMap }, leoMemory: { memoryMap: {} }, leoInteractions: [] };
})();

const resetCounters = () => {
    for (const k of Object.keys(metricsContextCounters)) metricsContextCounters[k] = 0;
};

const run = async () => {
    initMetrics(SYNTHETIC);

    // ── §1 ───────────────────────────────────────────────────────────────────
    section('§1 Snapshot: forma y defensa');
    __setRequestContextEnabledForTests(false);
    resetCounters();
    const s1 = getMetricsRequestContextTelemetrySnapshot();
    const CAMPOS = ['enabled', 'scope', 'createdTotal', 'disposedTotal', 'active',
        'progressUsersIndexedTotal', 'eventUsersIndexedTotal', 'memoHitsTotal',
        'memoMissesTotal', 'legacyFallbackCallsTotal', 'studentComputationsTotal',
        'buildDurationMsTotal'];
    ok('tiene exactamente los campos del contrato',
        Object.keys(s1).sort().join(',') === [...CAMPOS].sort().join(','), Object.keys(s1).join(','));
    ok('scope = process', s1.scope === 'process');
    ok('enabled es booleano', typeof s1.enabled === 'boolean');
    ok('todos los contadores son enteros no negativos',
        CAMPOS.filter((k) => !['enabled', 'scope'].includes(k))
            .every((k) => Number.isInteger(s1[k]) && s1[k] >= 0));
    const s1b = getMetricsRequestContextTelemetrySnapshot();
    ok('devuelve un objeto NUEVO en cada llamada', s1 !== s1b);
    s1b.createdTotal = 99999;
    ok('mutar la respuesta no altera los contadores',
        metricsContextCounters.metrics_request_context_created_total === 0
        && getMetricsRequestContextTelemetrySnapshot().createdTotal === 0);
    ok('consultar el snapshot no incrementa nada',
        getMetricsRequestContextTelemetrySnapshot().createdTotal === 0
        && getMetricsRequestContextTelemetrySnapshot().buildDurationMsTotal === 0);

    // ── §2 ───────────────────────────────────────────────────────────────────
    section('§2 Derivaciones');
    resetCounters();
    metricsContextCounters.metrics_request_context_created_total = 7;
    metricsContextCounters.metrics_request_context_disposed_total = 5;
    ok('active = created - disposed', getMetricsRequestContextTelemetrySnapshot().active === 2);
    metricsContextCounters.metrics_request_context_disposed_total = 9;
    ok('clamp defensivo: nunca negativo', getMetricsRequestContextTelemetrySnapshot().active === 0);
    resetCounters();
    metricsContextCounters.metrics_student_memo_misses_total = 11;
    metricsContextCounters.metrics_legacy_fallback_calls_total = 4;
    metricsContextCounters.metrics_student_memo_hits_total = 100;
    const s2 = getMetricsRequestContextTelemetrySnapshot();
    ok('studentComputations = misses + fallback (los hits NO cuentan)', s2.studentComputationsTotal === 15);
    ok('los hits se publican aparte', s2.memoHitsTotal === 100);

    // ── §3 ───────────────────────────────────────────────────────────────────
    section('§3 Sin contadores inventados, sin PII, sin secretos');
    const texto = JSON.stringify(getMetricsRequestContextTelemetrySnapshot());
    for (const inventado of ['generationGuardFailures', 'contextErrors']) {
        ok(`no expone ${inventado} (no existe contador)`, !texto.includes(inventado));
    }
    ok('sin identificadores de usuario', !/u-tel-|userId/i.test(texto));
    ok('sin instituciones ni grupos', !/colegio-tel|g-tel/i.test(texto));
    ok('sin rutas', !texto.includes('/api/'));
    ok('sin timestamps', !/\d{4}-\d{2}-\d{2}T/.test(texto));
    ok('sin claves ni cabeceras', !/secret|token|authorization/i.test(texto));
    const mod = await import('../metricsService.js');
    ok('no se exporta ningún reset de telemetría',
        !Object.keys(mod).some((k) => /reset|clear|zero/i.test(k) && /telemetry|counter/i.test(k)));

    // ── §4 ───────────────────────────────────────────────────────────────────
    section('§4 Flag off');
    __setRequestContextEnabledForTests(false);
    resetCounters();
    ok('enabled refleja el proceso, no una cabecera',
        getMetricsRequestContextTelemetrySnapshot().enabled === false && isRequestContextEnabled() === false);
    computeSchoolMetrics('colegio-tel');
    const s4 = getMetricsRequestContextTelemetrySnapshot();
    ok('con el flag off no se crea contexto', s4.createdTotal === 0 && s4.disposedTotal === 0);
    ok('active = 0', s4.active === 0);
    ok('los cálculos van por la vía legacy', s4.legacyFallbackCallsTotal > 0);

    // ── §5 ───────────────────────────────────────────────────────────────────
    section('§5 Flag on — ruta institucional');
    __setRequestContextEnabledForTests(true);
    resetCounters();
    computeSchoolMetrics('colegio-tel');
    const s5 = getMetricsRequestContextTelemetrySnapshot();
    ok('enabled = true', s5.enabled === true);
    ok('se creó exactamente un contexto', s5.createdTotal === 1, String(s5.createdTotal));
    ok('se liberó exactamente un contexto', s5.disposedTotal === 1, String(s5.disposedTotal));
    ok('active vuelve a cero', s5.active === 0);
    ok('created = disposed', s5.createdTotal === s5.disposedTotal);
    ok('indexó usuarios con progreso', s5.progressUsersIndexedTotal > 0);
    ok('indexó usuarios con eventos', s5.eventUsersIndexedTotal > 0);
    ok('hubo cálculos de estudiante', s5.studentComputationsTotal > 0);
    ok('cero fallback legacy cuando el contexto se entrega', s5.legacyFallbackCallsTotal === 0);
    ok('memo hits > 0 en institución (cada alumno se pide dos veces)', s5.memoHitsTotal > 0);
    ok('buildDuration es acumulado y no negativo', s5.buildDurationMsTotal >= 0);

    // ── §6 ───────────────────────────────────────────────────────────────────
    section('§6 Excepción controlada');
    resetCounters();
    let lanzo = false;
    try { computeSchoolMetrics('colegio-que-no-existe'); } catch { lanzo = true; }
    const s6a = getMetricsRequestContextTelemetrySnapshot();
    ok('una institución inexistente lanza antes de crear contexto',
        lanzo && s6a.createdTotal === 0 && s6a.active === 0);

    // Excepción DENTRO del cálculo, con un contexto ya creado: se usa la guarda
    // real `assertUsable()` pasando un contexto liberado. Es la única forma de
    // provocar el fallo después de `contextForTopLevel` sin tocar la
    // implementación productiva.
    resetCounters();
    const ctxMuerto = createMetricsRequestContext();
    ctxMuerto.dispose();
    const trasCrearYLiberar = getMetricsRequestContextTelemetrySnapshot();
    ok('crear y liberar deja el balance en cero',
        trasCrearYLiberar.createdTotal === 1 && trasCrearYLiberar.disposedTotal === 1 && trasCrearYLiberar.active === 0);

    lanzo = false;
    let mensaje = '';
    try { computeSchoolMetrics('colegio-tel', { context: ctxMuerto }); }
    catch (e) { lanzo = true; mensaje = String(e.message); }
    const s6b = getMetricsRequestContextTelemetrySnapshot();
    ok('la guarda detecta un contexto ya liberado', lanzo && /ya liberado/.test(mensaje), mensaje);
    ok('la excepción no descuadra el balance', s6b.createdTotal === s6b.disposedTotal, `${s6b.createdTotal}/${s6b.disposedTotal}`);
    ok('active = 0 tras la excepción', s6b.active === 0);
    ok('un contexto ajeno no se libera dos veces', s6b.disposedTotal === 1);

    // Excepción con contexto PROPIO: el `finally` debe liberarlo igualmente.
    resetCounters();
    const antesDeFallar = getMetricsRequestContextTelemetrySnapshot();
    lanzo = false;
    try { computeCourseMetrics('grupo-inexistente'); } catch { lanzo = true; }
    const s6c = getMetricsRequestContextTelemetrySnapshot();
    ok('un grupo inexistente lanza sin dejar contexto vivo',
        lanzo && s6c.active === 0 && s6c.createdTotal === s6c.disposedTotal,
        `${s6c.createdTotal}/${s6c.disposedTotal}`);
    void antesDeFallar;

    // ── §7 ───────────────────────────────────────────────────────────────────
    section('§7 Ruta sin contexto');
    resetCounters();
    computeStudentMetrics('u-tel-1');
    const s7 = getMetricsRequestContextTelemetrySnapshot();
    ok('un cálculo de estudiante suelto NO crea contexto', s7.createdTotal === 0);
    ok('se contabiliza como fallback legacy', s7.legacyFallbackCallsTotal === 1);
    ok('active sigue en cero', s7.active === 0);

    // ── §8 ───────────────────────────────────────────────────────────────────
    section('§8 Secuencial y concurrente');
    resetCounters();
    for (let i = 0; i < 5; i++) computeSchoolMetrics('colegio-tel');
    const s8a = getMetricsRequestContextTelemetrySnapshot();
    ok('cinco peticiones → cinco contextos', s8a.createdTotal === 5);
    ok('created = disposed tras la secuencia', s8a.createdTotal === s8a.disposedTotal);
    ok('active = 0', s8a.active === 0);

    resetCounters();
    await Promise.all(Array.from({ length: 8 }, async (_, i) => {
        await new Promise((r) => setTimeout(r, i));
        return i % 2 === 0 ? computeSchoolMetrics('colegio-tel') : computeCourseMetrics('g-tel-2');
    }));
    const s8b = getMetricsRequestContextTelemetrySnapshot();
    ok('ocho peticiones concurrentes → ocho contextos', s8b.createdTotal === 8, String(s8b.createdTotal));
    ok('estado final: created = disposed', s8b.createdTotal === s8b.disposedTotal);
    ok('estado final: active = 0', s8b.active === 0);

    // ── §9 ───────────────────────────────────────────────────────────────────
    section('§9 Memoización acotada a la petición');
    resetCounters();
    computeSchoolMetrics('colegio-tel');
    const primera = getMetricsRequestContextTelemetrySnapshot();
    computeSchoolMetrics('colegio-tel');
    const segunda = getMetricsRequestContextTelemetrySnapshot();
    ok('la segunda petición vuelve a calcular (no hay caché entre peticiones)',
        segunda.memoMissesTotal === primera.memoMissesTotal * 2, `${primera.memoMissesTotal} → ${segunda.memoMissesTotal}`);
    ok('cada petición crea su propio contexto', segunda.createdTotal === 2);

    // ── §10 ──────────────────────────────────────────────────────────────────
    section('§10 Matriz de autorización (secret-only)');
    const SECRETO = 'a'.repeat(96);
    const guard = createOperationalAdminSecretGuard({ readSecret: async () => SECRETO });
    const intentar = (headers, extra = {}) => new Promise((resolve) => {
        const req = { method: 'GET', path: '/api/admin/system/metrics/request-context', headers, ...extra };
        const res = { status: (c) => ({ json: () => resolve({ r: 'RECHAZADO', c }) }) };
        guard(req, res, () => resolve({ r: 'PERMITIDO', c: 200 }));
    });
    const casos = [
        ['sin cabeceras', {}, 401],
        ['x-user-id lector', { 'x-user-id': 'u-lector' }, 401],
        ['x-user-id mediador', { 'x-user-id': 'u-mediador' }, 401],
        ['x-user-id administrador', { 'x-user-id': 'u-admin' }, 401],
        ['x-user-id inexistente', { 'x-user-id': 'no-existe' }, 401],
        ['x-role: admin', { 'x-role': 'admin' }, 401],
        ['cookie sintética', { cookie: 'session=admin' }, 401],
        ['bearer sintético', { authorization: 'Bearer sintetico' }, 401],
        ['secreto incorrecto', { [OPERATIONAL_ADMIN_HEADER]: 'incorrecto' }, 401],
        ['secreto corto', { [OPERATIONAL_ADMIN_HEADER]: 'a' }, 401],
        ['secreto de longitud equivalente', { [OPERATIONAL_ADMIN_HEADER]: 'b'.repeat(96) }, 401],
        ['secreto vacío', { [OPERATIONAL_ADMIN_HEADER]: '' }, 401],
        ['secreto correcto', { [OPERATIONAL_ADMIN_HEADER]: SECRETO }, 200],
        ['administrador + secreto incorrecto', { 'x-user-id': 'u-admin', [OPERATIONAL_ADMIN_HEADER]: 'malo' }, 401],
        ['lector + secreto correcto', { 'x-user-id': 'u-lector', [OPERATIONAL_ADMIN_HEADER]: SECRETO }, 200],
    ];
    for (const [label, headers, esperado] of casos) {
        const r = await intentar(headers);
        ok(`${label} → ${esperado}`, r.c === esperado, `obtenido ${r.c}`);
    }
    const r401q = await intentar({}, { query: { role: 'admin', 'x-admin-secret': SECRETO } });
    ok('secreto por query NO autoriza', r401q.c === 401);
    const r401b = await intentar({}, { body: { 'x-admin-secret': SECRETO, role: 'administrador' } });
    ok('secreto por body NO autoriza', r401b.c === 401);

    const guardSinArchivo = createOperationalAdminSecretGuard({
        readSecret: async () => { throw new Error('SECRET_FILE_ERROR'); },
    });
    const rClosed = await new Promise((resolve) => {
        const req = { method: 'GET', path: '/x', headers: { [OPERATIONAL_ADMIN_HEADER]: SECRETO } };
        const res = { status: (c) => ({ json: () => resolve(c) }) };
        guardSinArchivo(req, res, () => resolve(200));
    });
    ok('archivo canónico inválido → falla cerrado con 401', rClosed === 401);

    ok('secretsMatch es estricto', secretsMatch(SECRETO, SECRETO) === true
        && secretsMatch(SECRETO, SECRETO + 'x') === false
        && secretsMatch('', '') === false);
    ok('candidateSecret rechaza array y tipos raros',
        candidateSecret({ headers: { [OPERATIONAL_ADMIN_HEADER]: ['a', 'b'] } }) === null
        && candidateSecret({ headers: {} }) === null);

    // ── §11 ──────────────────────────────────────────────────────────────────
    section('§11 Ruta HTTP real');
    const app = express();
    app.get('/api/admin/system/metrics/request-context',
        createOperationalAdminSecretGuard({ readSecret: async () => SECRETO }),
        (req, res) => {
            res.set('Cache-Control', 'no-store');
            res.status(200).json({ ok: true, metricsRequestContext: getMetricsRequestContextTelemetrySnapshot() });
        });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/api/admin/system/metrics/request-context`;

    const sinAuth = await fetch(base);
    ok('sin credenciales → 401', sinAuth.status === 401);
    ok('el 401 no revela la causa', JSON.stringify(await sinAuth.json()) === JSON.stringify({ error: 'No autorizado' }));

    const conUser = await fetch(base, { headers: { 'x-user-id': 'u-admin' } });
    ok('x-user-id de administrador sin secreto → 401', conUser.status === 401);

    resetCounters();
    const antes = getMetricsRequestContextTelemetrySnapshot();
    const conSecreto = await fetch(base, { headers: { [OPERATIONAL_ADMIN_HEADER]: SECRETO } });
    const cuerpo = await conSecreto.json();
    ok('secreto correcto → 200', conSecreto.status === 200);
    ok('content-type JSON', (conSecreto.headers.get('content-type') ?? '').includes('application/json'));
    ok('cache-control: no-store', conSecreto.headers.get('cache-control') === 'no-store');
    ok('cuerpo { ok, metricsRequestContext }',
        cuerpo.ok === true && typeof cuerpo.metricsRequestContext === 'object');
    ok('el subobjeto respeta el contrato',
        Object.keys(cuerpo.metricsRequestContext).sort().join(',') === [...CAMPOS].sort().join(','));
    const despues = getMetricsRequestContextTelemetrySnapshot();
    ok('consultar la ruta NO crea contexto',
        despues.createdTotal === antes.createdTotal && despues.active === 0);
    ok('consultar la ruta no altera ningún contador',
        JSON.stringify(despues) === JSON.stringify(antes));
    const repetida = await fetch(base, { headers: { [OPERATIONAL_ADMIN_HEADER]: SECRETO } });
    ok('consulta repetida sigue siendo read-only',
        repetida.status === 200
        && JSON.stringify((await repetida.json()).metricsRequestContext) === JSON.stringify(antes));
    ok('sin PII en la respuesta HTTP', !/u-tel-|colegio-tel|g-tel/.test(JSON.stringify(cuerpo)));
    ok('sin el secreto en la respuesta', !JSON.stringify(cuerpo).includes(SECRETO));
    await new Promise((r) => server.close(r));

    // ── §12 ──────────────────────────────────────────────────────────────────
    section('§12 Stores reales');
    ok('UNEXPECTED_STORE_DELTA = 0', storeFingerprint() === STORES_BEFORE);
    ok('los stores SQLite se resolvieron a un temporal',
        !String(process.env.PROGRESS_SQLITE_PATH ?? '').startsWith(REPO)
        && !String(process.env.EVENTS_SQLITE_PATH ?? '').startsWith(REPO));

    __setRequestContextEnabledForTests(false);
    resetCounters();
};

run().then(() => {
    console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} fallos`);
    process.exit(fail === 0 ? 0 : 1);
}).catch((e) => { console.error('ERROR inesperado:', e); process.exit(1); });

// Silencia el aviso de os no usado en algunas plataformas.
void os;
