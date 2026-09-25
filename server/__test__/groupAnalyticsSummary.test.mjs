/**
 * groupAnalyticsSummary.test.mjs — CHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1A).
 *
 * GET /api/groups/:id/analytics-summary: resumen REAL del grupo (sustituye a
 * `pedagogicalStats` de localStorage como autoridad). Módulo + servidor real
 * sobre stores temporales (patrón authz* / a11yAutoAdvanceUnlock).
 *
 *   A  80 lectores + 10 mediadores → readerCount 80
 *   B  tiempo histórico > 0 → all > 0 (hot ∪ archive, legacy + canónico)
 *   C  actividad fuera de 28 d → all > 0, last28d = 0
 *   D  Leo real → agregado correcto (mediadores y otra org fuera)
 *   E  progreso real → iniciados / completados con el criterio vigente
 *   F  sin actividad → cero real
 *   G  tareas → no_server_source      H  PISA → no_server_source
 *   I  mediadores / admin fuera del denominador
 *   J  scope vigente (mediador propio 200, lector 403, admin 200, inexistente 403)
 *   K  sin sesión → 401               L  cross-school → 403
 *   +  equivalencia por lector con userEffectiveReadingMs (autoridad indexada)
 *   +  la consulta usa el índice por user_id; nunca lee a los no-cohorte
 *   +  rendimiento con 80 lectores y ~35k filas; /api/health durante el cálculo
 *   +  no-store; stores sin escrituras
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import {
    buildGroupAnalyticsSummary, readCohortHistoricalRows, resolveGroupLectorCohort,
    summarizeReading, EFFECTIVE_READING_RAW_EVENTS, WINDOW_28D_MS,
} from '../analytics/groupAnalyticsSummary.mjs';
import { userEffectiveReadingMs, readUserHistoricalRows } from '../analytics/userEffectiveReadingTime.mjs';
import { computeEffectiveReadingMs, EFFECTIVE_READING_EVENT_NAMES } from '../analytics/effectiveReadingTime.mjs';
import { normalizeEventForSignals, LEGACY_EVENT_MAP } from '../analytics/legacyEventNormalizer.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MIN = 60_000, DAY = 86_400_000;
const NOW = Date.now();
const OLD = NOW - 60 * DAY;       // fuera de 28 d
const RECENT = NOW - 5 * DAY;     // dentro de 28 d
const ORG_A = 'org-alfa', ORG_B = 'org-beta';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_grpanalytics_'));
const P = {
    data: path.join(tmp, 'data'),
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    usersCorrupt: path.join(tmp, 'users_corrupt.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });
const EVENTS = path.join(P.data, 'events.db');
const ARCHIVE = path.join(P.data, 'events.archive.db');
const PROGRESS = path.join(P.data, 'progress.db');
const LEO = path.join(P.data, 'leo_interactions_db.json');

// ── Usuarios y grupos (ningún id real) ────────────────────────────────────────
const pad = (n, w = 3) => String(n).padStart(w, '0');
const LECTORES = Array.from({ length: 80 }, (_, i) => `lec-${pad(i + 1)}`);
const MEDIADORES = Array.from({ length: 10 }, (_, i) => `med-${pad(i + 1, 2)}`);
const USERS = [
    ...LECTORES.map(id => ({ id, roles: ['lector'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: ['g-a1'] })),
    ...MEDIADORES.map(id => ({ id, roles: ['mediador'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher', groupIds: ['g-a1'] })),
    // admin con el grupo en groupIds: nunca es lector (I).
    { id: 'adm', roles: ['administrador'], accountStatus: 'active', groupIds: ['g-a1'] },
    { id: 'lec-z1', roles: ['lector'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: ['g-a2'] },
    { id: 'lec-z2', roles: ['lector'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: ['g-a2'] },
    { id: 'lec-b1', roles: ['lector'], organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', groupIds: ['g-b1'] },
    { id: 'med-b', roles: ['mediador'], organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', mediatorKind: 'teacher', groupIds: ['g-b1'] },
    // Filtro SQL por nombre de evento (1A-bis): grupo propio, no altera g-a1.
    ...['lec-f1', 'lec-f2', 'lec-f3'].map(id => ({ id, roles: ['lector'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: ['g-f'] })),
    // Población AJENA con mucho volumen: nunca debe leerse.
    ...Array.from({ length: 40 }, (_, i) => ({ id: `ext-${pad(i + 1)}`, roles: ['lector'], organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', groupIds: ['g-b1'] })),
];
const GROUPS = [
    { id: 'g-a1', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: [...MEDIADORES], studentIds: [...LECTORES], memberIds: [...LECTORES] },
    { id: 'g-a2', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: ['med-01'], studentIds: ['lec-z1', 'lec-z2'], memberIds: ['lec-z1', 'lec-z2'] },
    { id: 'g-f', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: ['med-01'], studentIds: ['lec-f1', 'lec-f2', 'lec-f3'], memberIds: ['lec-f1', 'lec-f2', 'lec-f3'] },
    { id: 'g-b1', type: 'course', organizationId: ORG_B, school: 'Colegio Beta',
      mediatorIds: ['med-b'], studentIds: ['lec-b1', ...Array.from({ length: 40 }, (_, i) => `ext-${pad(i + 1)}`)],
      memberIds: ['lec-b1', ...Array.from({ length: 40 }, (_, i) => `ext-${pad(i + 1)}`)] },
];
fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG_A, name: 'Colegio Alfa' }, { id: ORG_B, name: 'Colegio Beta' }], null, 2));
fs.writeFileSync(P.usersCorrupt, '{ esto no es json');
fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.content, JSON.stringify([{ id: 'c-1', titulo: 'Uno', autor: 'A', tipo: 'libro', status: 'disponible' }], null, 2));

// ── Eventos: hot + archive, con los índices de producción ─────────────────────
const DDL = (idx) => `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
    schema_version INTEGER NOT NULL, event TEXT NOT NULL, mode TEXT NOT NULL,
    user_id TEXT NOT NULL, content_id TEXT, session_id TEXT NOT NULL,
    client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL, elapsed_ms INTEGER,
    progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS ${idx} ON events(user_id, content_id, server_ts);`;
let nextId = 1;
function seed(dbPath, idx, rows) {
    const db = new Database(dbPath);
    db.exec(DDL(idx));
    const ins = db.prepare(`INSERT INTO events (id,event_id,schema_version,event,mode,user_id,content_id,session_id,client_ts,server_ts,elapsed_ms,progress_fraction,payload_json,created_at)
        VALUES (@id,@event_id,1,@event,@mode,@user_id,@content_id,@session_id,@ts,@ts,@elapsed_ms,NULL,@payload_json,@ts)`);
    db.transaction(() => {
        for (const r of rows) {
            const id = nextId++;
            ins.run({ id, event_id: `ev-${id}`, mode: 'text', content_id: 'c-1', session_id: `s-${id}`,
                elapsed_ms: null, payload_json: '{}', ...r });
        }
    })();
    db.close();
}
const session = (user_id, ts, minutes, content_id = 'c-1', canonical = true) => canonical ? [
    { user_id, content_id, event: 'reading_started', ts },
    { user_id, content_id, event: 'session_heartbeat', ts: ts + Math.floor(minutes / 2) * MIN, payload_json: JSON.stringify({ elapsedMs: Math.floor(minutes / 2) * MIN }) },
    { user_id, content_id, event: 'session_ended', ts: ts + minutes * MIN, payload_json: JSON.stringify({ totalMs: minutes * MIN }) },
] : [
    { user_id, content_id, event: 'a11y.session_start', ts },
    { user_id, content_id, event: 'a11y.session_heartbeat', ts: ts + 5 * MIN, elapsed_ms: 5 * MIN },
    { user_id, content_id, event: 'a11y.session_end', ts: ts + minutes * MIN, elapsed_ms: minutes * MIN },
];
// Volumen: cada lector 004..080 con ~60 sesiones antiguas (180 filas); los
// ajenos con 500 filas cada uno. Total ≈ 13.9k cohorte + 20k ajenas.
const bulkReader = (uid, n) => {
    const out = [];
    for (let s = 0; s < n; s++) out.push(...session(uid, OLD - s * 3 * 3_600_000, 3, `c-${s % 7}`));
    return out;
};
const SINCE_28D = NOW - 28 * DAY;
const payload = (o) => JSON.stringify(o);
const archiveRows = [
    ...session('lec-001', OLD, 30, 'c-1', false),                 // legacy, 30 min, fuera de 28 d
    // B legacy normalizable (pdf.*) en el archivo.
    { user_id: 'lec-f1', content_id: 'c-2', event: 'pdf.session_start', ts: OLD },
    { user_id: 'lec-f1', content_id: 'c-2', event: 'pdf.session_heartbeat', ts: OLD + 4 * MIN, elapsed_ms: 4 * MIN },
    { user_id: 'lec-f1', content_id: 'c-2', event: 'pdf.session_end', ts: OLD + 9 * MIN, elapsed_ms: 9 * MIN },
    // H duplicado: el MISMO event_id que en la caliente (gana la caliente).
    { user_id: 'lec-f2', event_id: 'dup-1', event: 'session_ended', ts: RECENT + 30 * MIN, payload_json: payload({ totalMs: 99 * MIN }) },
];
// Filas del grupo g-f en la caliente: relevantes + ruido que el filtro descarta.
const filterRows = [
    // A canónico relevante
    { user_id: 'lec-f1', event: 'reading_started', ts: RECENT },
    { user_id: 'lec-f1', event: 'session_heartbeat', ts: RECENT + 6 * MIN, payload_json: payload({ elapsedMs: 6 * MIN }) },
    { user_id: 'lec-f1', event: 'session_ended', ts: RECENT + 12 * MIN, payload_json: payload({ totalMs: 12 * MIN }) },
    // C telemetría immersive.* y avance: nunca aportan tiempo
    ...Array.from({ length: 5 }, (_, i) => ({ user_id: 'lec-f1', event: 'immersive.pb_audio_preparing', ts: RECENT + i * MIN, payload_json: payload({ elapsedMs: 999 * MIN }) })),
    { user_id: 'lec-f1', event: 'immersive.session_completed', ts: RECENT + 13 * MIN, payload_json: payload({ totalMs: 999 * MIN }) },
    { user_id: 'lec-f1', event: 'a11y.progress', ts: RECENT + 2 * MIN, elapsed_ms: 999 * MIN },
    { user_id: 'lec-f1', event: 'reading_progress', ts: RECENT + 3 * MIN, payload_json: payload({ elapsedMs: 999 * MIN }) },
    // D ajenos
    { user_id: 'lec-f1', event: 'lu.session_start', ts: RECENT, content_id: null },
    { user_id: 'lec-f1', event: 'text.leo_interaction', ts: RECENT + MIN },
    // H límites: sesión que empieza EXACTAMENTE en la frontera de 28 d, doble
    // cierre y duplicado de event_id con el archivo.
    { user_id: 'lec-f2', event: 'text.session_start', ts: SINCE_28D },
    { user_id: 'lec-f2', event: 'text.session_end', ts: SINCE_28D + 10 * MIN, elapsed_ms: 10 * MIN },
    { user_id: 'lec-f2', event: 'text.session_end', ts: SINCE_28D + 10 * MIN + 1, elapsed_ms: 10 * MIN },
    { user_id: 'lec-f2', event: 'reading_started', ts: RECENT },
    { user_id: 'lec-f2', event_id: 'dup-1', event: 'session_ended', ts: RECENT + 30 * MIN, payload_json: payload({ totalMs: 30 * MIN }) },
    // Solo ruido: el filtro no devuelve nada y el cálculo daba 0 igualmente.
    { user_id: 'lec-f3', event: 'immersive.audio_play', ts: RECENT },
    { user_id: 'lec-f3', event: 'immersive.chunk_audio_reuse', ts: RECENT + MIN, elapsed_ms: 50 * MIN },
];
const hotRows = [
    ...session('lec-001', OLD + DAY, 100),                        // canónico, 100 min, fuera de 28 d
    ...session('lec-002', RECENT, 20),                            // dentro de 28 d
    ...session('med-01', RECENT, 50),                             // mediador: no cuenta
    ...session('adm', RECENT, 40),                                // admin: no cuenta
    ...session('lec-b1', RECENT, 70),                             // otra org
    ...filterRows,
    ...LECTORES.slice(3).flatMap(uid => bulkReader(uid, 60)),
    ...Array.from({ length: 40 }, (_, i) => `ext-${pad(i + 1)}`).flatMap(uid => bulkReader(uid, 167)),
];
seed(ARCHIVE, 'idx_arch_user_content', archiveRows);
seed(EVENTS, 'idx_user_content', hotRows);

// ── Leo y progreso ────────────────────────────────────────────────────────────
const LEO_ROWS = [
    ...Array(3).fill({ userId: 'lec-001' }), { userId: 'lec-002' },
    ...Array(5).fill({ userId: 'med-01' }), ...Array(2).fill({ userId: 'lec-b1' }), { userId: 'adm' },
].map((x, i) => ({ ...x, contentId: 'c-1', timestamp: OLD + i, interactionType: 'chat', surface: 'reader' }));
fs.writeFileSync(LEO, JSON.stringify(LEO_ROWS, null, 2));
{
    const db = new Database(PROGRESS);
    db.exec(`CREATE TABLE IF NOT EXISTS progress (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, content_id TEXT NOT NULL,
        is_completed INTEGER NOT NULL DEFAULT 0, canonical_progress TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL,
        history TEXT NOT NULL DEFAULT '[]'); CREATE INDEX IF NOT EXISTS idx_progress_user_id ON progress(user_id);`);
    const ins = db.prepare('INSERT INTO progress VALUES (?,?,?,?,?,?,?)');
    const at = new Date(OLD).toISOString();
    for (const [uid, cid, pct, done] of [
        ['lec-001', 'c-1', 95, 0],    // ≥ 90 → completado
        ['lec-001', 'c-2', 10, 0],
        ['lec-002', 'c-1', 50, 1],    // isCompleted → completado
        ['lec-003', 'c-1', 2, 0],
        ['med-01', 'c-1', 100, 1],    // mediador: no cuenta
    ]) ins.run(`${uid}_${cid}`, uid, cid, done, JSON.stringify({ globalPercentage: pct }), at, '[]');
    db.close();
}

const countRows = (p) => { const db = new Database(p, { readonly: true }); const n = db.prepare('SELECT COUNT(*) n FROM events').get().n; db.close(); return n; };
const HOT_ROWS = countRows(EVENTS), ARCH_ROWS = countRows(ARCHIVE);
const progressRows = () => { const db = new Database(PROGRESS, { readonly: true }); const n = db.prepare('SELECT COUNT(*) n FROM progress').get().n; db.close(); return n; };
const PROG_ROWS = progressRows();
const LEO_TXT = fs.readFileSync(LEO, 'utf8');

// Autoridad esperada, calculada por la ruta indexada POR USUARIO ya vigente.
const opts = { eventsPath: EVENTS, archivePath: ARCHIVE };
const expectedAllMs = LECTORES.reduce((a, id) => a + userEffectiveReadingMs(id, opts), 0);

function spawnApi(port, extraEnv = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            PROGRESS_SQLITE_PATH: PROGRESS,
            EVENTS_SQLITE_PATH: EVENTS,
            ARCHIVE_SQLITE_PATH: ARCHIVE,
            INSIGHTS_SQLITE_PATH: path.join(P.data, 'insights.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, 'offline_assignments.db'),
            IDENTITY_DB: path.join(P.data, 'identity.db'),
            SESSIONS_DB: path.join(P.data, 'sessions.db'),
            LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted',
            SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
            ...extraEnv,
        },
    });
    let bootLog = '';
    child.stdout.on('data', d => { bootLog += d; });
    child.stderr.on('data', d => { bootLog += d; });
    child._boot = () => bootLog;
    return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-2000)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-2000)}`);
}

// Rango propio 5240–5319 (5040 = servicio de Windows).
const PORT = 5240 + (process.pid % 80), PORT_BAD = PORT + 80;
const BASE = `http://127.0.0.1:${PORT}`, BASE_BAD = `http://127.0.0.1:${PORT_BAD}`;
const ROUTE = (gid) => `/api/groups/${gid}/analytics-summary`;
const GET = (uid, url, base = BASE) => fetch(`${base}${url}`, uid ? { headers: { 'x-user-id': uid } } : {});
const json = async (r) => { try { return await r.json(); } catch { return null; } };

let api, apiBad;
async function main() {
    section('[MÓDULO] cohorte, equivalencia y plan de consulta');
    {
        const cohort = resolveGroupLectorCohort(GROUPS[0], USERS, GROUPS);
        ok('A cohorte = 80 lectores', cohort.length === 80, String(cohort.length));
        ok('I ningún mediador ni admin en la cohorte', !cohort.some(id => id.startsWith('med-') || id === 'adm'));
        const { byUser, sources } = readCohortHistoricalRows(cohort, opts);
        ok('solo filas de la cohorte (ningún ext-*, med-*, adm, lec-b1)',
            [...byUser.keys()].every(id => LECTORES.includes(id)), [...byUser.keys()].filter(id => !LECTORES.includes(id)).join(','));
        ok('lee hot y archive', sources.hot > 0 && sources.archive > 0, JSON.stringify(sources));
        const { summary } = buildGroupAnalyticsSummary({ group: GROUPS[0], users: USERS, allGroups: GROUPS,
            leoInteractions: LEO_ROWS, getProgressByUser: () => [], nowTs: NOW, ...opts });
        ok('reading.all == Σ userEffectiveReadingMs por lector (autoridad indexada)',
            summary.reading.all.totalEffectiveMs === expectedAllMs, `${summary.reading.all.totalEffectiveMs} vs ${expectedAllMs}`);
        for (const [idx, p] of [['idx_user_content', EVENTS], ['idx_arch_user_content', ARCHIVE]]) {
            const db = new Database(p, { readonly: true });
            const ev = EFFECTIVE_READING_RAW_EVENTS;
            const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id, event_id, event, user_id, content_id, server_ts, elapsed_ms, payload_json
                FROM events WHERE user_id IN (?,?,?) AND event IN (${ev.map(() => '?').join(',')})`).all('a', 'b', 'c', ...ev).map(r => r.detail).join(' | ');
            db.close();
            ok(`consulta por cohorte usa ${idx} (sin SCAN)`, plan.includes(idx) && !/SCAN events/.test(plan), plan);
        }
        const src = fs.readFileSync(path.join(REPO, 'server', 'analytics', 'groupAnalyticsSummary.mjs'), 'utf8');
        ok('no lee ni escribe pedagogicalStats / localStorage', !/pedagogicalStats|localStorage/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
        ok('ningún SELECT sin filtro de sujeto', !/FROM events(?!\s+WHERE user_id IN)/.test(src));
    }

    section('[FILTRO] allowlist derivada y equivalencia con el camino sin filtro');
    {
        const consumed = new Set(EFFECTIVE_READING_EVENT_NAMES);
        ok('allowlist ⊇ nombres consumidos por computeEffectiveReadingMs',
            EFFECTIVE_READING_EVENT_NAMES.every(n => EFFECTIVE_READING_RAW_EVENTS.includes(n)));
        ok('allowlist ⊇ toda clave legacy que el normalizador traduce a ellos',
            Object.keys(LEGACY_EVENT_MAP).filter(k => consumed.has(LEGACY_EVENT_MAP[k])).every(k => EFFECTIVE_READING_RAW_EVENTS.includes(k)));
        ok('cada nombre de la allowlist normaliza a un nombre consumido (nada sobra)',
            EFFECTIVE_READING_RAW_EVENTS.every(n => consumed.has(normalizeEventForSignals(n))), EFFECTIVE_READING_RAW_EVENTS.join(','));

        const F = ['lec-f1', 'lec-f2', 'lec-f3'];
        const { byUser } = readCohortHistoricalRows(F, opts);
        const got = new Set([...byUser.values()].flat().map(r => r.event));
        ok('A canónico relevante incluido (reading_started / session_heartbeat / session_ended)',
            ['reading_started', 'session_heartbeat', 'session_ended'].every(n => got.has(n)), [...got].join(','));
        ok('B legacy normalizable incluido (pdf.session_* del archivo)',
            ['pdf.session_start', 'pdf.session_heartbeat', 'pdf.session_end'].every(n => got.has(n)), [...got].join(','));
        ok('C immersive.* / avance irrelevantes excluidos',
            !['immersive.pb_audio_preparing', 'immersive.session_completed', 'a11y.progress', 'reading_progress', 'immersive.audio_play', 'immersive.chunk_audio_reuse'].some(n => got.has(n)), [...got].join(','));
        ok('D ajenos excluidos (lu.session_start, text.leo_interaction)', !got.has('lu.session_start') && !got.has('text.leo_interaction'));
        ok('lec-f3 (solo ruido): 0 filas leídas', !byUser.has('lec-f3'));

        const since = NOW - WINDOW_28D_MS;
        const nameOf = (r) => normalizeEventForSignals(r.event);
        let mism = 0, n = 0;
        for (const id of [...F, ...LECTORES]) {
            const raw = readUserHistoricalRows(id, opts).rows;       // sin filtro, semántica vigente
            const fil = readCohortHistoricalRows([id], opts).byUser.get(id) || [];
            const a = [computeEffectiveReadingMs(raw, nameOf).ms, computeEffectiveReadingMs(raw.filter(r => r.server_ts >= since), nameOf).ms];
            const b = [computeEffectiveReadingMs(fil, nameOf).ms, computeEffectiveReadingMs(fil.filter(r => r.server_ts >= since), nameOf).ms];
            n++; if (a[0] !== b[0] || a[1] !== b[1]) mism++;
        }
        ok(`E filtrado == sin filtro (all y 28 d) para ${n} lectores`, mism === 0, `mismatches=${mism}`);
        ok('F hot ∪ archive: lec-f1 suma archivo (9 min pdf) + caliente (12 min)',
            userEffectiveReadingMs('lec-f1', opts) === 21 * MIN
            && summarizeReading(byUser, ['lec-f1'], NOW).all.totalEffectiveMs === 21 * MIN);
        const f2 = summarizeReading(byUser, ['lec-f2'], NOW);
        ok('H duplicado de event_id: gana la caliente (30 min, no 99)', f2.all.totalEffectiveMs === userEffectiveReadingMs('lec-f2', opts)
            && f2.all.totalEffectiveMs === 40 * MIN, JSON.stringify(f2));
        ok('H frontera de 28 d inclusiva y doble cierre ignorado (10 + 30 min)', f2.last28d.totalEffectiveMs === 40 * MIN, JSON.stringify(f2));
        ok('G fuera de 28 d: lec-f1 archivo (60 d) cuenta en all, no en 28 d',
            summarizeReading(byUser, ['lec-f1'], NOW).last28d.totalEffectiveMs === 12 * MIN);
    }

    section('[PERF] 80 lectores, en proceso');
    {
        const run = () => { const t = performance.now(); buildGroupAnalyticsSummary({ group: GROUPS[0], users: USERS, allGroups: GROUPS,
            leoInteractions: LEO_ROWS, getProgressByUser: () => [], nowTs: NOW, ...opts }); return performance.now() - t; };
        const cold = run(); const warm = [run(), run(), run()];
        console.log(`    cold=${cold.toFixed(1)} ms warm=${warm.map(x => x.toFixed(1)).join('/')} ms (hot=${HOT_ROWS} archive=${ARCH_ROWS} filas)`);
        ok('cold < 1 s', cold < 1000, `${cold}`);
        ok('warm < 1 s (3 de 3)', warm.every(x => x < 1000), warm.join(','));
    }

    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    section('[A–I] contenido del resumen (admin sobre g-a1)');
    let body;
    {
        const r = await GET('adm', ROUTE('g-a1'));
        body = await json(r);
        ok('adm → 200', r.status === 200, `${r.status} ${JSON.stringify(body)}`);
        ok('Cache-Control: no-store', r.headers.get('cache-control') === 'no-store', String(r.headers.get('cache-control')));
        ok('A readerCount = 80 (10 mediadores + admin con groupIds fuera)', body?.readerCount === 80, String(body?.readerCount));
        ok('forma exacta', JSON.stringify(Object.keys(body ?? {})) === '["groupId","readerCount","reading","leo","progress","tasks","pisa"]', JSON.stringify(Object.keys(body ?? {})));
        const all = body?.reading?.all, d28 = body?.reading?.last28d;
        ok('B all > 0 y == Σ autoridad por lector', all?.totalEffectiveMs > 0 && all.totalEffectiveMs === expectedAllMs, `${all?.totalEffectiveMs} vs ${expectedAllMs}`);
        ok('B lec-001 aporta 130 min (100 hot canónico + 30 archive legacy)',
            userEffectiveReadingMs('lec-001', opts) === 130 * MIN);
        ok('C last28d = solo lec-002 (20 min): lo antiguo queda fuera', d28?.totalEffectiveMs === 20 * MIN && d28?.readersWithActivity === 1, JSON.stringify(d28));
        ok('I promedio con denominador 80', Math.abs(all.averageEffectiveMsPerReader - all.totalEffectiveMs / 80) < 1e-6
            && Math.abs(d28.averageEffectiveMsPerReader - 20 * MIN / 80) < 1e-6, JSON.stringify(body?.reading));
        ok('I el tiempo del mediador (50 min) y del admin (40 min) no entra',
            all.readersWithActivity === 79 && d28.totalEffectiveMs === 20 * MIN, JSON.stringify(all));
        ok('D Leo = 4 interacciones de 2 lectores; promedio 4/80 sin redondeo',
            JSON.stringify(body?.leo) === JSON.stringify({ interactions: 4, readersWithInteractions: 2, averageInteractionsPerReader: 0.05 }), JSON.stringify(body?.leo));
        ok('E progreso: 3 lectores, 4 iniciados, 2 completados (≥90 % o isCompleted)',
            JSON.stringify(body?.progress) === JSON.stringify({ readersWithProgress: 3, booksStarted: 4, booksCompleted: 2 }), JSON.stringify(body?.progress));
        ok('G tareas = { state: no_server_source } (sin completionRate)', JSON.stringify(body?.tasks) === '{"state":"no_server_source"}', JSON.stringify(body?.tasks));
        ok('H PISA = { state: no_server_source } (sin score)', JSON.stringify(body?.pisa) === '{"state":"no_server_source"}', JSON.stringify(body?.pisa));
        const txt = JSON.stringify(body);
        for (const fuga of ['lec-0', 'med-', 'c-1', 'ev-', 'session', 'pedagogicalStats']) ok(`sin "${fuga}" en la respuesta`, !txt.includes(fuga), txt.slice(0, 200));
    }

    section('[F] grupo sin actividad → cero real, tareas/PISA siguen sin fuente');
    {
        const b = await json(await GET('adm', ROUTE('g-a2')));
        ok('readerCount 2', b?.readerCount === 2);
        ok('reading all/28d = 0 con 0 lectores activos',
            b?.reading?.all?.totalEffectiveMs === 0 && b.reading.all.readersWithActivity === 0 && b.reading.last28d.totalEffectiveMs === 0, JSON.stringify(b?.reading));
        ok('leo y progreso = 0 reales (números, no ausencia)', b?.leo?.interactions === 0 && b?.progress?.booksStarted === 0, JSON.stringify(b));
        ok('tareas y PISA = no_server_source (no 0)', b?.tasks?.state === 'no_server_source' && b?.pisa?.state === 'no_server_source');
    }

    section('[J/K/L] authz: scope vigente');
    {
        ok('J mediador sobre SU grupo → 200', (await GET('med-01', ROUTE('g-a1'))).status === 200);
        const lec = await GET('lec-001', ROUTE('g-a1'));
        ok('J lector sobre su propio grupo → 403 (mismo contrato que /diagnosis)', lec.status === 403, String(lec.status));
        ok('J admin sobre org B → 200', (await GET('adm', ROUTE('g-b1'))).status === 200);
        const x = await GET('med-01', ROUTE('g-b1'));
        const xb = await json(x);
        ok('L mediador de org A sobre grupo de org B → 403 scope_access_denied', x.status === 403 && xb?.error === 'scope_access_denied', `${x.status} ${JSON.stringify(xb)}`);
        ok('L el 403 no filtra datos', !JSON.stringify(xb).includes('reading') && !JSON.stringify(xb).includes('Colegio Beta'));
        ok('J grupo inexistente → 403 (no oráculo de existencia)', (await GET('med-01', ROUTE('no-existe'))).status === 403);
        ok('K sin sesión → 401', (await GET(null, ROUTE('g-a1'))).status === 401);
        const q = await json(await GET('med-01', `${ROUTE('g-a1')}?userId=lec-b1&userIds=ext-001`));
        ok('userIds por query se ignoran (mismo resumen)', q?.readerCount === 80 && q?.reading?.all?.totalEffectiveMs === expectedAllMs);
        const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
        const i = src.indexOf(`app.get('/api/groups/:id/analytics-summary'`);
        const handler = src.slice(i, src.indexOf('\n});', i));
        ok('el handler solo lee req.params.id (ni query ni body)', i > 0 && !/req\.(query|body)/.test(handler));
        ok('usa requireSubjectScope(group, allowSelf:false)', /requireSubjectScope\(req, res, 'group', id, \{ allowSelf: false \}\)/.test(handler));
    }

    section('[PERF] HTTP + /api/health durante el cálculo');
    {
        const t0 = performance.now();
        const [r, h] = await Promise.all([
            GET('adm', ROUTE('g-a1')),
            (async () => { await sleep(5); const t = performance.now(); const x = await fetch(`${BASE}/api/health`); return { ok: x.ok, ms: performance.now() - t }; })(),
        ]);
        const total = performance.now() - t0;
        const times = [];
        for (let k = 0; k < 3; k++) { const t = performance.now(); await GET('adm', ROUTE('g-a1')); times.push(performance.now() - t); }
        console.log(`    http first=${total.toFixed(0)} ms warm=${times.map(x => x.toFixed(0)).join('/')} ms health_during=${h.ms.toFixed(0)} ms`);
        ok('HTTP 200 y < 1 s', r.status === 200 && total < 1000, `${r.status} ${total}`);
        ok('HTTP warm < 1 s (3 de 3)', times.every(x => x < 1000), times.join(','));
        ok('/api/health responde durante el cálculo en < 1 s', h.ok && h.ms < 1000, JSON.stringify(h));
        ok('sin SQLITE_BUSY ni ERROR en el log', !/SQLITE_BUSY|analytics-summary error/.test(api._boot()));
        ok('el servidor registra la duración [GROUP_ANALYTICS]', /\[GROUP_ANALYTICS\] group=g-a1 readers=80 rows=\d+ ms=\d+/.test(api._boot()));
    }

    section('[IDENTIDAD] indisponible → contrato vigente (503, sin datos)');
    {
        apiBad = spawnApi(PORT_BAD, { SESSION_AUTH_MODE: 'compat', USERS_DB: P.usersCorrupt });
        await waitHealthy(BASE_BAD, apiBad);
        const r = await GET('med-01', ROUTE('g-a1'), BASE_BAD);
        const b = await json(r);
        ok('padrón corrupto → 503', r.status === 503, `${r.status} ${JSON.stringify(b)}`);
        ok('…sin resumen en el cuerpo', !('reading' in (b ?? {})), JSON.stringify(b));
    }

    section('[STORES] sin escrituras');
    {
        ok('events.db: mismas filas', countRows(EVENTS) === HOT_ROWS);
        ok('events.archive.db: mismas filas', countRows(ARCHIVE) === ARCH_ROWS);
        ok('progress.db: mismas filas', progressRows() === PROG_ROWS);
        ok('leo_interactions_db byte-idéntico', fs.readFileSync(LEO, 'utf8') === LEO_TXT);
        ok('users byte-idéntico', fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
        ok('groups byte-idéntico', fs.readFileSync(P.groups, 'utf8') === JSON.stringify(GROUPS, null, 2));
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        try { api?.kill('SIGKILL'); } catch { /* ya muerto */ }
        try { apiBad?.kill('SIGKILL'); } catch { /* ya muerto */ }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nCHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1A) — ${pass} ✓, ${fail} ✗`);
        process.exit(fail ? 1 : 0);
    });
