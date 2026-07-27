/**
 * referenceEngine.test.mjs — CHP-METRICS-CONTRACT-01B (contrato v2).
 *
 * Fija el contrato canónico con D1–D10 aprobadas, sobre fixtures 100 %
 * sintéticas. El motor es puro: este test no abre ningún store real.
 *
 *   node engines/metrics/__tests__/referenceEngine.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    classifyEvent, EVENT_CLASS, sessionDuration, reconstructSessions, groupBySessionId,
    IDLE_MS, SESSION_CAP_MS,
} from '../eventContract.mjs';
import {
    summarize, buildIndex, computeOrganization, unattributedReport, attributeEvent,
    organizationPopulation, metricEnvelope, defaultPeriod,
    MEASUREMENT_STATUS, UNATTRIBUTED_BUCKET, STATUS_LABEL, CONTRACT_VERSION,
} from '../referenceEngine.mjs';
import { classifyGroup } from '../../../server/identity/organizationScope.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// ── Fixtures: réplica a escala de la topología productiva ───────────────────
const SCHOOLS = [
    { id: 'org-villas',    name: 'Villas' },        // población y actividad
    { id: 'org-bosque',    name: 'Bosque' },        // población, cero actividad
    { id: 'org-filbo',     name: 'FilBo' },         // 2 lectores fuera de grupo
    { id: 'org-externado', name: 'Externado' },     // sin ningún grupo
];
const GROUPS = [
    { id: 'g-villas', organizationId: 'org-villas', memberIds: ['v1', 'v2', 'v3'] },
    { id: 'g-bosque', organizationId: 'org-bosque', memberIds: ['b1', 'b2'] },
    { id: 'g-filbo',  organizationId: 'org-filbo',  memberIds: ['f1', 'f2'] },
    { id: 'g-hist',   school: 'Histórica',          memberIds: ['h1'] },
    { id: 'g-synth',  organizationId: 'lt-org',     memberIds: ['s1', 's2'] },
];
const USERS = [
    { id: 'v1', roles: ['lector'] }, { id: 'v2', roles: ['lector'] },
    { id: 'v3', roles: ['mediador'] },                                  // NO es lector
    { id: 'b1', roles: ['lector'] }, { id: 'b2', roles: ['lector'] },
    { id: 'f1', roles: ['lector'] }, { id: 'f2', roles: ['lector'] },
    // Los dos lectores de FilBo SIN grupo: solo declaran organizationId.
    { id: 'f3', roles: ['lector'], organizationId: 'org-filbo' },
    { id: 'f4', roles: ['lector'], organizationId: 'org-filbo' },
    // Externado: 2 usuarios que declaran la organización y no tienen grupo.
    { id: 'e1', roles: ['mediador'], organizationId: 'org-externado' },
    { id: 'e2', roles: ['mediador'], organizationId: 'org-externado' },
    { id: 'h1', roles: ['lector'] },                                    // grupo histórico
    { id: 's1', roles: ['lector'], _loadtest_marker: true },
    { id: 's2', roles: ['lector'], _loadtest_marker: true },
    { id: 'x1', roles: ['lector'] },                                    // sin grupo ni organización
];
const T0 = 1_700_000_000_000;
const ev = (id, event, userId, off, extra = {}) => ({
    eventId: id, event, userId, mode: event.split('.')[0],
    sessionId: extra.sessionId ?? `s-${id}`, serverTs: T0 + off,
    contentId: extra.contentId ?? null, elapsedMs: extra.elapsedMs ?? null,
    progressFraction: null,
});

const EVENTS = [
    // v1: sesión de lectura de 10 min con cierre explícito
    ev('e1', 'text.session_start',     'v1', 0,         { contentId: 'c1', elapsedMs: 0,       sessionId: 'sA' }),
    ev('e2', 'text.block_complete',    'v1', 400_000,   { contentId: 'c1', elapsedMs: 400_000, sessionId: 'sA' }),
    ev('e3', 'text.session_end',       'v1', 600_000,   { contentId: 'c1', elapsedMs: 600_000, sessionId: 'sA' }),
    // v1: segunda sesión tras 50 min, otro contenido, sin cierre
    ev('e4', 'immersive.session_start','v1', 3_600_000, { contentId: 'c2', elapsedMs: 0 }),
    ev('e5', 'immersive.audio_play',   'v1', 3_700_000, { contentId: 'c2', elapsedMs: 100_000 }),
    // v2: SOLO telemetría y sistema → tiene actividad, pero NO es lector activo
    ev('e6', 'immersive.session_heartbeat', 'v2', 1000, { contentId: 'c1', elapsedMs: 1000 }),
    ev('e7', 'immersive.chunk_audio_reuse', 'v2', 2000),
    // v3 (mediador, en grupo): evento de lectura — cuenta en actividad, no en lectores
    ev('e8', 'text.block_complete',    'v3', 1000,      { contentId: 'c1' }),
    // f1: lectura
    ev('e9', 'pdf.page_change',        'f1', 500,       { contentId: 'c3' }),
    // f3 (lector de FilBo SIN grupo): lectura — no es elegible
    ev('e10','text.block_complete',    'f3', 500,       { contentId: 'c3' }),
    // fuera de scope
    ev('e11','text.block_complete',    'h1', 0,         { contentId: 'c1' }),
    ev('e12','text.block_complete',    's1', 0,         { contentId: 'c1' }),
    ev('e13','text.block_complete',    'x1', 0,         { contentId: 'c1' }),
    ev('e14','text.block_complete',    'fantasma', 0,   { contentId: 'c1' }),
    ev('e15','immersive.tipo_sin_contrato', 'v1', 5000),
];

const BASE = { users: USERS, groups: GROUPS, schools: SCHOOLS, events: EVENTS, classifyGroup };
const orgOf = (out, id) => out.organizations.find(o => o.organizationId === id);

console.log('referenceEngine — CHP-METRICS-CONTRACT-01B (contrato v2)');

// ── §1 Taxonomía ────────────────────────────────────────────────────────────
console.log('\n[1] taxonomía');
{
    ok('session_start es SESSION_BOUNDARY', classifyEvent('text.session_start').class === EVENT_CLASS.SESSION_BOUNDARY);
    ok('block_complete es READING_ACTIVITY', classifyEvent('text.block_complete').class === EVENT_CLASS.READING_ACTIVITY);
    ok('heartbeat es telemetría, no lectura', classifyEvent('text.session_heartbeat').class === EVENT_CLASS.HEARTBEAT_OR_TELEMETRY);
    ok('chunk_audio_* es sistema', classifyEvent('immersive.chunk_audio_reuse').class === EVENT_CLASS.SYSTEM_EVENT);
    ok('un tipo nuevo cae en UNKNOWN_REVIEW_REQUIRED',
        classifyEvent('immersive.tipo_sin_contrato').class === EVENT_CLASS.UNKNOWN_REVIEW_REQUIRED);
}

// ── §2 D5: tiempo por ventana, elapsed_ms nunca se suma ─────────────────────
console.log('\n[2] D5 · tiempo');
{
    const sA = EVENTS.filter(e => e.sessionId === 'sA');
    const d = sessionDuration(sA);
    ok('la duración es la ventana de actividad atribuible',
        d.ms === 600_000 && d.source === 'ATTRIBUTABLE_ACTIVITY_WINDOW');
    const suma = sA.reduce((a, e) => a + (e.elapsedMs ?? 0), 0);
    ok('sumar elapsed_ms daría 1.000.000 y no se usa', suma === 1_000_000 && d.ms !== suma);
    ok('elapsed_ms se conserva solo como corroboración',
        d.corroborationMs === 600_000 && d.corroborationDeltaMs === 0);

    const unico = [{ event: 'text.session_end', serverTs: T0, elapsedMs: 120_000 }];
    const du = sessionDuration(unico);
    ok('ventana 0 con acumulado válido → fallback validado',
        du.ms === 120_000 && du.source === 'ELAPSED_FALLBACK_VALIDATED');

    const larga = [{ event: 'text.session_start', serverTs: T0 }, { event: 'text.block_complete', serverTs: T0 + 50 * 3600_000 }];
    const dl = sessionDuration(larga);
    ok('D5 · tope de 4 horas aplicado', dl.capped === true && dl.ms === SESSION_CAP_MS);
    ok('SESSION_CAP_MS son 4 horas', SESSION_CAP_MS === 4 * 60 * 60 * 1000);
}

// ── §3 D2/D3: sesiones ──────────────────────────────────────────────────────
console.log('\n[3] D2/D3 · sesiones');
{
    ok('D3 · el idle por defecto son 15 minutos', IDLE_MS === 15 * 60 * 1000);
    const v1 = EVENTS.filter(e => e.userId === 'v1');
    const s = reconstructSessions(v1);
    ok('50 min de inactividad separan dos sesiones', s.length === 2, JSON.stringify(s.map(x => x.durationMs)));
    ok('session_end cierra la sesión en su propio timestamp', s[0].endTs === T0 + 600_000);
    // Cierre explícito ANTES del umbral: dos eventos separados por 1 min, con
    // un session_end en medio, producen DOS sesiones y no una.
    const cierreTemprano = [
        ev('c1', 'text.session_start',  'v1', 0),
        ev('c2', 'text.session_end',    'v1', 10_000),
        ev('c3', 'text.session_start',  'v1', 70_000),
        ev('c4', 'text.block_complete', 'v1', 80_000),
    ];
    ok('session_end corta antes del idle de 15 min', reconstructSessions(cierreTemprano).length === 2);
    ok('un session_end huérfano NO abre sesión',
        reconstructSessions([ev('h', 'text.session_end', 'v1', 0, { elapsedMs: 600_000 })]).length === 0);

    const soloSistema = [ev('z1', 'immersive.chunk_audio_reuse', 'v2', 0)];
    ok('un evento de sistema NO abre sesión por sí solo', reconstructSessions(soloSistema).length === 0);
    const sistemaTrasInicio = [
        ev('z2', 'text.session_start', 'v2', 0),
        ev('z3', 'immersive.chunk_audio_reuse', 'v2', 1000),
    ];
    ok('un evento de sistema sí extiende una sesión abierta',
        reconstructSessions(sistemaTrasInicio).length === 1
        && reconstructSessions(sistemaTrasInicio)[0].eventCount === 2);

    ok('session_id no es autoridad: se reporta pero no agrupa',
        s[0].distinctSessionIds >= 1 && groupBySessionId(v1).length >= 1);
    ok('determinístico ante cualquier orden de entrada',
        JSON.stringify(reconstructSessions([...v1].reverse())) === JSON.stringify(s));
}

// ── §4 Fase 2: casos de aceptación poblacional ──────────────────────────────
console.log('\n[4] Fase 2 · casos de aceptación');
{
    const out = summarize(BASE);

    const filbo = orgOf(out, 'org-filbo');
    ok('FilBo conserva 4 registrados aunque 2 no tengan grupo',
        filbo.population.registeredUsers === 4, JSON.stringify(filbo.population));
    ok('FilBo identifica por separado los lectores sin grupo',
        filbo.population.readersWithoutGroup === 2);
    ok('FilBo NO reduce registeredUsers a los miembros del grupo',
        filbo.population.registeredUsers !== filbo.population.eligibleReaders);
    ok('FilBo eligibleReaders = 2 (los del grupo activo)', filbo.population.eligibleReaders === 2);

    const ext = orgOf(out, 'org-externado');
    ok('Externado conserva 2 registrados aunque tenga 0 grupos',
        ext.population.registeredUsers === 2, JSON.stringify(ext.population));
    ok('Externado eligibleReaders = 0', ext.population.eligibleReaders === 0);
    ok('Externado lectura institucional → NO_DATA',
        ext.metrics.activeReaders.status === MEASUREMENT_STATUS.NO_DATA);
    ok('Externado NO muestra registeredUsers = 0',
        ext.metrics.registeredUsers.value === 2 && ext.metrics.registeredUsers.measured === true);

    const bosque = orgOf(out, 'org-bosque');
    ok('Bosque conserva 2 registrados', bosque.population.registeredUsers === 2);
    ok('Bosque con población elegible y sin lectura → activeReaders 0 medido',
        bosque.metrics.activeReaders.value === 0
        && bosque.metrics.activeReaders.measured === true
        && bosque.metrics.activeReaders.status === MEASUREMENT_STATUS.NO_ACTIVITY);

    const villas = orgOf(out, 'org-villas');
    ok('Villas: los registrados no dependen de que existan eventos',
        villas.population.registeredUsers === 3);
    ok('registeredReaders refleja el rol real, no asume que todos son lectores',
        villas.population.registeredReaders === 2 && villas.population.registeredUsers === 3);
}

// ── §5 D4: actividad y lectura son métricas distintas ───────────────────────
console.log('\n[5] D4 · usersWithActivity ≠ activeReaders');
{
    const villas = orgOf(summarize(BASE), 'org-villas');
    ok('v2 (solo telemetría y sistema) cuenta como actividad',
        villas.population.usersWithActivity === 3, String(villas.population.usersWithActivity));
    ok('v2 NO cuenta como lector activo: no tiene READING_ACTIVITY',
        villas.population.activeReaders === 1, String(villas.population.activeReaders));
    ok('las dos métricas existen por separado',
        villas.metrics.usersWithActivity.metric === 'usersWithActivity'
        && villas.metrics.activeReaders.metric === 'activeReaders');
    ok('un mediador con lectura suma a actividad pero no a lectores activos',
        villas.population.usersWithActivity > villas.population.activeReaders);

    const soloSistema = summarize({ ...BASE, events: [ev('q1', 'immersive.chunk_audio_reuse', 'v1', 0)] });
    ok('solo eventos de sistema → sin actividad',
        orgOf(soloSistema, 'org-villas').metrics.usersWithActivity.status === MEASUREMENT_STATUS.NO_ACTIVITY);
}

// ── §6 Estados y contrato de respuesta ──────────────────────────────────────
console.log('\n[6] estados y sobre de respuesta');
{
    const villas = orgOf(summarize(BASE), 'org-villas');
    const m = villas.metrics.activeReaders;
    ok('el sobre lleva contractVersion 2', m.contractVersion === CONTRACT_VERSION && CONTRACT_VERSION === 2);
    ok('el sobre lleva population completa',
        ['registeredUsers', 'registeredReaders', 'eligibleReaders', 'usersWithActivity', 'activeReaders']
            .every(k => typeof m.population[k] === 'number'));
    ok('el sobre lleva coverage con numerador y denominador',
        m.coverage.numerator === 1 && m.coverage.denominator === 2 && m.coverage.ratio === 0.5);
    ok('el sobre lleva quality',
        ['unattributedEvents', 'unknownEvents', 'cappedSessions'].every(k => k in m.quality));

    ok('D6 · el tiempo de lectura permanece NOT_DEFINED',
        villas.metrics.readingTimeMs.status === MEASUREMENT_STATUS.NOT_DEFINED
        && villas.metrics.readingTimeMs.value === null);
    ok('D6 · no se reetiqueta el tiempo en plataforma como lectura',
        villas.metrics.readingTimeMs.value !== villas.metrics.platformTimeMs.value);

    for (const st of ['NO_DATA', 'NOT_MATERIALIZED', 'NOT_DEFINED', 'ERROR']) {
        ok(`${st} devuelve null`, metricEnvelope({ metric: 'x', value: 42, status: MEASUREMENT_STATUS[st] }).value === null);
    }
    ok('NO_ACTIVITY es el único que admite 0 medido',
        metricEnvelope({ metric: 'x', value: 0, status: MEASUREMENT_STATUS.NO_ACTIVITY }).measured === true);
    ok('D10 · las etiquetas visibles están declaradas',
        STATUS_LABEL.NO_ACTIVITY === 'Sin actividad registrada'
        && STATUS_LABEL.NO_DATA === 'Sin datos suficientes'
        && STATUS_LABEL.NOT_MATERIALIZED === 'Pendiente de cálculo'
        && STATUS_LABEL.NOT_DEFINED === 'Métrica aún no disponible');
    ok('D1 · una entrada es el inicio de una sesión reconstruida',
        villas.metrics.entries.value === villas.metrics.sessions.value);
}

// ── §7 D8: no atribuibles preservados ───────────────────────────────────────
console.log('\n[7] D8 · no atribuibles');
{
    const index = buildIndex(BASE);
    const b = (uid) => attributeEvent(EVENTS.find(e => e.userId === uid), index);
    ok('grupo histórico → HISTORICAL_SCOPE', b('h1').bucket === UNATTRIBUTED_BUCKET.HISTORICAL_SCOPE);
    ok('usuario sintético → SYNTHETIC_SCOPE', b('s1').bucket === UNATTRIBUTED_BUCKET.SYNTHETIC_SCOPE);
    ok('sin grupo ni organización → UNATTRIBUTED_GROUP', b('x1').bucket === UNATTRIBUTED_BUCKET.UNATTRIBUTED_GROUP);
    ok('fuera del padrón → UNATTRIBUTED_IDENTITY', b('fantasma').bucket === UNATTRIBUTED_BUCKET.UNATTRIBUTED_IDENTITY);

    const rep = unattributedReport({ events: EVENTS, index });
    ok('ningún evento se pierde', rep.totalEvents === EVENTS.length);
    ok('los seis buckets existen', Object.keys(rep.buckets).length === 6);
    ok('los no atribuibles no se reparten',
        rep.buckets.HISTORICAL_SCOPE.events === 1 && rep.buckets.SYNTHETIC_SCOPE.events === 1
        && rep.buckets.UNATTRIBUTED_GROUP.events === 1 && rep.buckets.UNATTRIBUTED_IDENTITY.events === 1);
    ok('el reporte no expone identidades', !JSON.stringify(rep).includes('fantasma'));

    const villas = orgOf(summarize(BASE), 'org-villas');
    ok('los eventos fuera de scope no inflan la organización', villas.population.activeReaders === 1);
}

// ── §8 D7: periodo ──────────────────────────────────────────────────────────
console.log('\n[8] D7 · periodo');
{
    const p = defaultPeriod(T0 + 10_000_000);
    ok('el periodo por defecto son 30 días', p.days === 30 && p.toTs - p.fromTs === 30 * 24 * 3600_000);
    let lanzo = false;
    try { defaultPeriod(undefined); } catch { lanzo = true; }
    ok('exige nowTs inyectado (motor sin reloj)', lanzo);

    const corto = summarize({ ...BASE, period: { fromTs: T0, toTs: T0 + 1_000_000 } });
    const largo = summarize({ ...BASE, period: { fromTs: T0, toTs: T0 + 10_000_000 } });
    ok('acotar el periodo reduce las sesiones',
        orgOf(corto, 'org-villas').metrics.sessions.value < orgOf(largo, 'org-villas').metrics.sessions.value);
    ok('el periodo viaja en cada métrica',
        orgOf(corto, 'org-villas').metrics.sessions.period.toTs === T0 + 1_000_000);
    ok('el periodo se declara aunque sea null', orgOf(summarize(BASE), 'org-villas').metrics.sessions.period === null);
}

// ── §9 Robustez y determinismo ──────────────────────────────────────────────
console.log('\n[9] robustez');
{
    ok('dos ejecuciones idénticas dan el mismo resultado',
        JSON.stringify(summarize(BASE)) === JSON.stringify(summarize(BASE)));
    const dup = summarize({ ...BASE, events: [...EVENTS, ...EVENTS.filter(e => e.userId === 'v1')] });
    const base = summarize(BASE);
    ok('duplicar eventos no cambia los lectores activos',
        orgOf(dup, 'org-villas').metrics.activeReaders.value === orgOf(base, 'org-villas').metrics.activeReaders.value);
    ok('duplicar eventos no multiplica el tiempo',
        orgOf(dup, 'org-villas').metrics.platformTimeMs.value === orgOf(base, 'org-villas').metrics.platformTimeMs.value);
    ok('entradas vacías no lanzan',
        summarize({ users: [], groups: [], schools: [], events: [], classifyGroup }).organizations.length === 0);
    let lanzo = false;
    try { buildIndex({ users: USERS, groups: GROUPS, schools: SCHOOLS }); } catch { lanzo = true; }
    ok('classifyGroup es inyección obligatoria', lanzo);
    ok('lt-org y la organización histórica no aparecen',
        !base.organizations.some(o => ['lt-org', undefined].includes(o.organizationId)) && base.organizations.length === 4);
    ok('D9 · las instituciones sin actividad no se ocultan',
        base.organizations.some(o => o.organizationId === 'org-bosque'));
}

// ── §10 Higiene ─────────────────────────────────────────────────────────────
console.log('\n[10] higiene');
{
    const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['eventContract.mjs', 'referenceEngine.mjs']) {
        const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, 'engines', 'metrics', f), 'utf8'));
        ok(`${f} no abre archivos`, !/node:fs|require\(|readFileSync|writeFileSync/.test(src));
        ok(`${f} no conoce rutas productivas`, !/\/app\/|\/var\/www\/|data-critical/.test(src));
        ok(`${f} no usa reloj propio`, !/Date\.now\(\)|new Date\(\)/.test(src));
        ok(`${f} no usa aleatoriedad`, !/Math\.random\(/.test(src));
    }
    const s = JSON.stringify(summarize(BASE));
    ok('la salida no contiene identidades', !/"v1"|"f3"|fantasma/.test(s));
    ok('la salida no contiene emails ni nombres', !/@/.test(s) && !/nombre_completo/.test(s));
    ok('ningún store real fue tocado', !fs.existsSync(path.join(REPO_ROOT, 'data', 'metrics_reference.json')));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
