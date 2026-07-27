/**
 * referenceEngine.test.mjs — CHP-METRICS-CONTRACT-01A.
 *
 * Fija el contrato canónico de métricas sobre fixtures 100 % sintéticas.
 * El motor es puro: este test no abre ningún store real ni escribe nada.
 *
 *   node engines/metrics/__tests__/referenceEngine.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    classifyEvent, EVENT_CLASS, sessionDuration, reconstructSessions, groupBySessionId,
} from '../eventContract.mjs';
import {
    summarize, buildIndex, computeOrganization, unattributedReport, attributeEvent,
    metric, MEASUREMENT_STATUS, UNATTRIBUTED_BUCKET,
} from '../referenceEngine.mjs';
import { classifyGroup } from '../../../server/identity/organizationScope.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── Fixtures ────────────────────────────────────────────────────────────────
const SCHOOLS = [
    { id: 'org-activa',   name: 'Institución Activa' },
    { id: 'org-sin-act',  name: 'Institución Sin Actividad' },
    { id: 'org-sin-grupo',name: 'Institución Sin Grupo' },
];
const GROUPS = [
    { id: 'g-activa',  organizationId: 'org-activa',  memberIds: ['u1', 'u2', 'u3'] },
    { id: 'g-sin-act', organizationId: 'org-sin-act', memberIds: ['u4', 'u5'] },
    { id: 'g-hist',    school: 'Histórica',           memberIds: ['u6'] },
    { id: 'g-synth',   organizationId: 'lt-org',      memberIds: ['u7', 'u8'] },
];
const USERS = [
    { id: 'u1', roles: ['lector'] }, { id: 'u2', roles: ['lector'] }, { id: 'u3', roles: ['lector'] },
    { id: 'u4', roles: ['lector'] }, { id: 'u5', roles: ['lector'] },
    { id: 'u6', roles: ['lector'] },                                   // grupo histórico
    { id: 'u7', roles: ['lector'], _loadtest_marker: true },           // sintético
    { id: 'u8', roles: ['lector'], _loadtest_marker: true },
    { id: 'u9', roles: ['lector'] },                                   // sin grupo
];
const T0 = 1_700_000_000_000;
const ev = (id, event, userId, tsOffsetMs, extra = {}) => ({
    eventId: id, event, userId, mode: event.split('.')[0],
    sessionId: extra.sessionId ?? `s-${id}`, serverTs: T0 + tsOffsetMs,
    contentId: extra.contentId ?? null, elapsedMs: extra.elapsedMs ?? null,
    progressFraction: extra.progressFraction ?? null,
});

// u1: una sesión de 10 min con cierre explícito (elapsed acumulado)
const EVENTS = [
    ev('e1', 'text.session_start',     'u1', 0,        { sessionId: 'sA', contentId: 'c1', elapsedMs: 0 }),
    ev('e2', 'text.session_heartbeat', 'u1', 300_000,  { sessionId: 'sA', contentId: 'c1', elapsedMs: 300_000 }),
    ev('e3', 'text.block_complete',    'u1', 400_000,  { sessionId: 'sA', contentId: 'c1', elapsedMs: 400_000 }),
    ev('e4', 'text.session_end',       'u1', 600_000,  { sessionId: 'sA', contentId: 'c1', elapsedMs: 600_000 }),
    // u1: segunda sesión tras 40 min de inactividad, otro contenido, sin cierre
    ev('e5', 'immersive.session_start','u1', 3_000_000,{ sessionId: 'sB', contentId: 'c2', elapsedMs: 0 }),
    ev('e6', 'immersive.audio_play',   'u1', 3_120_000,{ sessionId: 'sB', contentId: 'c2', elapsedMs: 120_000 }),
    // u2: una sola marca (sesión de duración 0 medida)
    ev('e7', 'pdf.session_start',      'u2', 10_000,   { sessionId: 'sC', contentId: 'c3', elapsedMs: 0 }),
    // u6 (grupo histórico) y u7 (sintético) y u9 (sin grupo) generan actividad
    ev('e8', 'text.session_start',     'u6', 0,        { sessionId: 'sD', contentId: 'c1', elapsedMs: 0 }),
    ev('e9', 'text.session_start',     'u7', 0,        { sessionId: 'sE', contentId: 'c1', elapsedMs: 0 }),
    ev('e10','text.session_start',     'u9', 0,        { sessionId: 'sF', contentId: 'c1', elapsedMs: 0 }),
    // identidad ausente del padrón
    ev('e11','text.session_start',     'u-fantasma', 0,{ sessionId: 'sG', contentId: 'c1', elapsedMs: 0 }),
    // evento de vocabulario desconocido, de un usuario atribuible
    ev('e12','immersive.cosa_nueva_sin_contrato', 'u3', 5_000, { sessionId: 'sH' }),
];

console.log('referenceEngine — CHP-METRICS-CONTRACT-01A');

// ── §1 Taxonomía de eventos ─────────────────────────────────────────────────
console.log('\n[1] taxonomía');
{
    ok('session_start es SESSION_BOUNDARY', classifyEvent('text.session_start').class === EVENT_CLASS.SESSION_BOUNDARY);
    ok('session_heartbeat es telemetría', classifyEvent('pdf.session_heartbeat').class === EVENT_CLASS.HEARTBEAT_OR_TELEMETRY);
    ok('block_complete es lectura', classifyEvent('text.block_complete').class === EVENT_CLASS.READING_ACTIVITY);
    ok('progress es señal de progreso', classifyEvent('album.progress').class === EVENT_CLASS.PROGRESS_SIGNAL);
    ok('chunk_audio_* es evento de sistema', classifyEvent('immersive.chunk_audio_reuse').class === EVENT_CLASS.SYSTEM_EVENT);
    ok('un evento nuevo cae en UNKNOWN_REVIEW_REQUIRED, no se supone semántica',
        classifyEvent('immersive.cosa_nueva_sin_contrato').class === EVENT_CLASS.UNKNOWN_REVIEW_REQUIRED);
    ok('extrae el modo del prefijo', classifyEvent('immersive.audio_play').mode === 'immersive');
    ok('lu no es modo de lectura', classifyEvent('lu.page_view').mode === 'lu');
}

// ── §2 elapsed_ms NO es aditivo ─────────────────────────────────────────────
console.log('\n[2] elapsed_ms acumulado, no aditivo');
{
    const sA = EVENTS.filter(e => e.sessionId === 'sA');
    const d = sessionDuration(sA);
    ok('la duración sale del elapsed del cierre', d.ms === 600_000 && d.source === 'SESSION_END_ELAPSED');
    const suma = sA.reduce((a, e) => a + (e.elapsedMs ?? 0), 0);
    ok('sumar elapsed_ms sobreestimaría (1.300.000 vs 600.000)', suma === 1_300_000 && suma > d.ms);
    ok('la duración NUNCA es la suma', d.ms !== suma);

    const sinCierre = EVENTS.filter(e => e.sessionId === 'sB');
    const d2 = sessionDuration(sinCierre);
    ok('sin cierre usa el máximo elapsed', d2.ms === 120_000 && d2.source === 'MAX_ELAPSED');

    const soloTs = [{ event: 'x.y', serverTs: T0 }, { event: 'x.y', serverTs: T0 + 5000 }];
    ok('sin elapsed cae a la ventana temporal',
        sessionDuration(soloTs).ms === 5000 && sessionDuration(soloTs).source === 'TIMESTAMP_WINDOW');

    const abandonada = [{ event: 'x.session_end', serverTs: T0, elapsedMs: 50 * 3600_000 }];
    const dc = sessionDuration(abandonada);
    ok('una sesión abandonada se acota, no se descarta', dc.capped === true && dc.ms === 4 * 3600_000);
    ok('valores negativos se ignoran',
        sessionDuration([{ event: 'x.session_end', serverTs: T0, elapsedMs: -5 }]).source !== 'SESSION_END_ELAPSED');
}

// ── §3 Sesiones ─────────────────────────────────────────────────────────────
console.log('\n[3] sesiones');
{
    const u1 = EVENTS.filter(e => e.userId === 'u1');
    const s15 = reconstructSessions(u1, { idleMs: 15 * 60000 });
    ok('ventana de 15 min separa las dos sesiones de u1', s15.length === 2, JSON.stringify(s15.map(s => s.durationMs)));
    const s60 = reconstructSessions(u1, { idleMs: 60 * 60000 });
    ok('una ventana de 60 min las fusiona en una', s60.length === 1);
    ok('cambiar el umbral cambia el resultado (sensibilidad declarada)', s15.length !== s60.length);

    const u2 = EVENTS.filter(e => e.userId === 'u2');
    const s2 = reconstructSessions(u2);
    ok('un único evento produce una sesión de duración 0 MEDIDA', s2.length === 1 && s2[0].durationMs === 0);

    const det1 = JSON.stringify(reconstructSessions([...u1].reverse(), { idleMs: 15 * 60000 }));
    const det2 = JSON.stringify(s15);
    ok('el resultado es determinístico con cualquier orden de entrada', det1 === det2);

    const porId = groupBySessionId(u1);
    ok('la estrategia por session_id existe como fallback documentado', porId.length === 2);
}

// ── §4 Atribución y buckets ─────────────────────────────────────────────────
console.log('\n[4] atribución');
{
    const index = buildIndex({ users: USERS, groups: GROUPS, schools: SCHOOLS, classifyGroup });
    const b = (uid) => attributeEvent(EVENTS.find(e => e.userId === uid), index);
    ok('usuario de grupo ACTIVE_REAL se atribuye', b('u1').attributed && b('u1').organizationId === 'org-activa');
    ok('grupo histórico → HISTORICAL_SCOPE',
        b('u6').attributed === false && b('u6').bucket === UNATTRIBUTED_BUCKET.HISTORICAL_SCOPE);
    ok('usuario sintético → SYNTHETIC_SCOPE',
        b('u7').attributed === false && b('u7').bucket === UNATTRIBUTED_BUCKET.SYNTHETIC_SCOPE);
    ok('usuario sin grupo → UNATTRIBUTED_GROUP',
        b('u9').attributed === false && b('u9').bucket === UNATTRIBUTED_BUCKET.UNATTRIBUTED_GROUP);
    ok('identidad ausente del padrón → UNATTRIBUTED_IDENTITY',
        b('u-fantasma').attributed === false && b('u-fantasma').bucket === UNATTRIBUTED_BUCKET.UNATTRIBUTED_IDENTITY);
    ok('evento de vocabulario desconocido conserva la identidad y marca el tipo',
        b('u3').attributed === true && b('u3').bucket === UNATTRIBUTED_BUCKET.UNKNOWN_EVENT_TYPE);

    const rep = unattributedReport({ events: EVENTS, index });
    ok('ningún evento se pierde', rep.totalEvents === EVENTS.length);
    const enBuckets = Object.values(rep.buckets).reduce((a, x) => a + x.events, 0);
    ok('los no atribuibles se conservan en buckets', enBuckets === 5, String(enBuckets));
    ok('el reporte no expone identidades',
        !JSON.stringify(rep).includes('u-fantasma') && !JSON.stringify(rep).includes('"u1"'));
}

// ── §5 Estados de medición: cero ≠ sin datos ────────────────────────────────
console.log('\n[5] cero medido vs sin datos');
{
    const out = summarize({ users: USERS, groups: GROUPS, schools: SCHOOLS, events: EVENTS, classifyGroup });
    const byOrg = Object.fromEntries(out.organizations.map(o => [o.organizationId, o]));

    const activa = byOrg['org-activa'];
    ok('institución con actividad → MEASURED', activa.activeReaders.status === MEASUREMENT_STATUS.MEASURED);
    ok('activeReaders cuenta solo lectores con eventos', activa.activeReaders.value === 3, String(activa.activeReaders.value));
    ok('registeredReaders mide la población', activa.registeredReaders.value === 3);
    ok('la cobertura declara qué parte está representada',
        activa.activeReaders.coverage.population === 3 && activa.activeReaders.coverage.ratio === 1);

    const sinAct = byOrg['org-sin-act'];
    ok('institución con población y 0 actividad → NO_ACTIVITY',
        sinAct.activeReaders.status === MEASUREMENT_STATUS.NO_ACTIVITY);
    ok('ese 0 SÍ es un cero medido', sinAct.activeReaders.value === 0 && sinAct.activeReaders.measured === true);

    const sinGrupo = byOrg['org-sin-grupo'];
    ok('institución sin población → NO_DATA', sinGrupo.activeReaders.status === MEASUREMENT_STATUS.NO_DATA);
    ok('NO_DATA no usa 0 como sustituto',
        sinGrupo.activeReaders.value === null && sinGrupo.activeReaders.measured === false);

    ok('el tiempo de lectura queda NOT_DEFINED mientras no se apruebe',
        activa.readingTimeMs.status === MEASUREMENT_STATUS.NOT_DEFINED
        && activa.readingTimeMs.value === null);

    const err = metric({ value: 99, status: MEASUREMENT_STATUS.ERROR });
    ok('ERROR nunca se convierte en número', err.value === null && err.measured === false);
    const notMat = metric({ value: 5, status: MEASUREMENT_STATUS.NOT_MATERIALIZED });
    ok('NOT_MATERIALIZED tampoco emite valor', notMat.value === null);
}

// ── §6 Aislamiento institucional en las métricas ────────────────────────────
console.log('\n[6] históricos y sintéticos fuera de las métricas');
{
    const out = summarize({ users: USERS, groups: GROUPS, schools: SCHOOLS, events: EVENTS, classifyGroup });
    ok('lt-org no aparece como organización', !out.organizations.some(o => o.organizationId === 'lt-org'));
    ok('la institución histórica no aparece', out.organizations.length === 3);
    const activa = out.organizations.find(o => o.organizationId === 'org-activa');
    ok('los eventos de u6/u7/u9 no inflan la institución activa', activa.activeReaders.value === 3);
    ok('las cinco poblaciones se reportan por separado',
        out.populations.registeredOrganizations.length === 3
        && out.populations.organizationsWithActiveGroups.length === 2
        && out.populations.organizationsWithReaders.length === 2
        && out.populations.organizationsWithEventReaders.length === 1);
}

// ── §7 Periodo y determinismo ───────────────────────────────────────────────
console.log('\n[7] periodo y determinismo');
{
    const base = { users: USERS, groups: GROUPS, schools: SCHOOLS, events: EVENTS, classifyGroup };
    const corto = summarize({ ...base, period: { fromTs: T0, toTs: T0 + 1_000_000 } });
    const largo = summarize({ ...base, period: { fromTs: T0, toTs: T0 + 10_000_000 } });
    const a = corto.organizations.find(o => o.organizationId === 'org-activa');
    const b = largo.organizations.find(o => o.organizationId === 'org-activa');
    ok('acotar el periodo reduce las sesiones', a.sessions.value < b.sessions.value,
        `${a.sessions.value} vs ${b.sessions.value}`);
    ok('el periodo viaja en la respuesta', a.sessions.period.toTs === T0 + 1_000_000);
    ok('dos ejecuciones idénticas dan el mismo resultado',
        JSON.stringify(summarize(base)) === JSON.stringify(summarize(base)));
    ok('la estrategia de sesión se declara en la salida',
        summarize(base).sessionStrategy === 'INACTIVITY_WINDOW_15MIN');
    ok('el contrato está versionado', summarize(base).contractVersion === 1);
}

// ── §8 Duplicados y robustez ────────────────────────────────────────────────
console.log('\n[8] duplicados y robustez');
{
    const dup = [...EVENTS, ...EVENTS.filter(e => e.userId === 'u1')];
    const index = buildIndex({ users: USERS, groups: GROUPS, schools: SCHOOLS, classifyGroup });
    const s = computeOrganization({ organizationId: 'org-activa', events: dup, index, users: USERS });
    const base = computeOrganization({ organizationId: 'org-activa', events: EVENTS, index, users: USERS });
    ok('duplicar eventos no cambia los lectores activos', s.activeReaders.value === base.activeReaders.value);
    ok('duplicar eventos no cambia los contenidos abiertos', s.contentsOpened.value === base.contentsOpened.value);
    ok('duplicar eventos no multiplica el tiempo', s.platformTimeMs.value === base.platformTimeMs.value);
    ok('entradas vacías no lanzan',
        summarize({ users: [], groups: [], schools: [], events: [], classifyGroup }).organizations.length === 0);
    let lanzo = false;
    try { buildIndex({ users: USERS, groups: GROUPS, schools: SCHOOLS }); } catch { lanzo = true; }
    ok('classifyGroup es inyección obligatoria', lanzo);
}

// ── §9 Higiene: motor puro y sin PII ────────────────────────────────────────
console.log('\n[9] higiene');
{
    // Se evalúa el CÓDIGO, no la prosa: los comentarios citan la fórmula de los
    // productores (`Date.now() - sessionStartTs`) para documentar por qué
    // `elapsed_ms` es acumulado, y eso no es una llamada al reloj.
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['eventContract.mjs', 'referenceEngine.mjs']) {
        const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, 'engines', 'metrics', f), 'utf8'));
        ok(`${f} no abre archivos`, !/node:fs|require\(|readFileSync|writeFileSync/.test(src));
        ok(`${f} no conoce rutas productivas`, !/\/app\/|\/var\/www\/|data-critical/.test(src));
        ok(`${f} no usa reloj propio`, !/Date\.now\(\)|new Date\(\)/.test(src));
        ok(`${f} no usa aleatoriedad`, !/Math\.random\(/.test(src));
    }
    const out = summarize({ users: USERS, groups: GROUPS, schools: SCHOOLS, events: EVENTS, classifyGroup });
    const s = JSON.stringify(out);
    ok('la salida no contiene identidades de usuario', !/"u\d"|u-fantasma/.test(s));
    ok('la salida no contiene emails ni nombres', !/@/.test(s) && !/nombre_completo/.test(s));

    // Ningún store real fue tocado por este test.
    ok('no se creó ningún archivo en data/',
        !fs.existsSync(path.join(REPO_ROOT, 'data', 'metrics_reference.json')));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
