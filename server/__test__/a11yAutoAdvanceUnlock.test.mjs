/**
 * a11yAutoAdvanceUnlock.test.mjs — CHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01.
 *
 * GET /api/reading/my-effective-time: desbloqueo del avance automático del
 * Modo Accesible. Servidor REAL sobre stores temporales (patrón authz*).
 *
 *   S1  self → 200 con { effectiveReadingMs, autoAdvanceUnlocked } y nada más.
 *   S2  sin sesión → 401.
 *   S3  no hay forma de pedir el tiempo de OTRO usuario (query/path ignorados).
 *   S4  identidad indisponible → 503 identity_unavailable.
 *   +   la autoridad es computeEffectiveReadingMs sobre hot ∪ archive
 *       (máximo acumulado por sesión, nombres legacy y canónicos).
 *   +   umbral exacto: 120 min.
 *   +   no-store; stores de eventos sin escrituras.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const MIN = 60_000;
const ORG_A = 'org-alfa';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_autoadv_'));
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

const USERS = [
    { id: 'lec-a1', roles: ['lector'],   organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active' },
    { id: 'lec-a2', roles: ['lector'],   organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active' },
    { id: 'lec-a3', roles: ['lector'],   organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active' },
    { id: 'med-a',  roles: ['mediador'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'adm',    roles: ['administrador'], accountStatus: 'active' },
];
fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a1', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: ['med-a'], memberIds: ['lec-a1', 'lec-a2', 'lec-a3'], studentIds: ['lec-a1', 'lec-a2', 'lec-a3'] },
], null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG_A, name: 'Colegio Alfa' }], null, 2));
fs.writeFileSync(P.usersCorrupt, '{ esto no es json');
fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.content, JSON.stringify([{ id: 'c-1', titulo: 'Uno', autor: 'A', tipo: 'libro', status: 'disponible' }], null, 2));

// ── events.db (hot) + events.archive.db, sembrados ANTES del arranque ─────────
const DDL = `CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
    schema_version INTEGER NOT NULL, event TEXT NOT NULL, mode TEXT NOT NULL,
    user_id TEXT NOT NULL, content_id TEXT, session_id TEXT NOT NULL,
    client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL, elapsed_ms INTEGER,
    progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL)`;
let nextId = 1;
function seed(dbPath, rows) {
    const db = new Database(dbPath);
    db.exec(DDL);
    const ins = db.prepare(`INSERT INTO events (id,event_id,schema_version,event,mode,user_id,content_id,session_id,client_ts,server_ts,elapsed_ms,progress_fraction,payload_json,created_at)
        VALUES (@id,@event_id,1,@event,@mode,@user_id,@content_id,@session_id,@ts,@ts,@elapsed_ms,NULL,@payload_json,@ts)`);
    for (const r of rows) {
        const id = nextId++;
        ins.run({ id, event_id: `ev-${id}`, mode: 'a11y', content_id: 'c-1', session_id: `s-${id}`,
            elapsed_ms: null, payload_json: '{}', ...r });
    }
    db.close();
}
const T0 = Date.now() - 30 * 86_400_000;
// lec-a1: 100 min en hot (canónico) + 30 min en archivo (legacy) = 130 → desbloqueado.
//         Los heartbeats son ACUMULADOS: sumarlos daría mucho más (no es la regla).
// lec-a2: 119 min exactos → bloqueado. lec-a3: 120 min exactos → desbloqueado.
// med-a:  sin lectura → 0.
seed(ARCHIVE, [
    { user_id: 'lec-a1', event: 'a11y.session_start', ts: T0 },
    { user_id: 'lec-a1', event: 'a11y.session_heartbeat', ts: T0 + 10 * MIN, elapsed_ms: 10 * MIN },
    { user_id: 'lec-a1', event: 'a11y.session_end', ts: T0 + 30 * MIN, elapsed_ms: 30 * MIN },
]);
seed(EVENTS, [
    { user_id: 'lec-a1', event: 'reading_started', ts: T0 + 86_400_000 },
    { user_id: 'lec-a1', event: 'session_heartbeat', ts: T0 + 86_400_000 + 50 * MIN, payload_json: JSON.stringify({ elapsedMs: 50 * MIN }) },
    { user_id: 'lec-a1', event: 'session_ended', ts: T0 + 86_400_000 + 100 * MIN, payload_json: JSON.stringify({ totalMs: 100 * MIN }) },
    { user_id: 'lec-a2', event: 'reading_started', ts: T0 },
    { user_id: 'lec-a2', event: 'session_ended', ts: T0 + 119 * MIN, payload_json: JSON.stringify({ totalMs: 119 * MIN }) },
    { user_id: 'lec-a3', event: 'reading_started', ts: T0 },
    { user_id: 'lec-a3', event: 'session_ended', ts: T0 + 120 * MIN, payload_json: JSON.stringify({ totalMs: 120 * MIN }) },
]);
const countRows = (p) => { const db = new Database(p, { readonly: true }); const n = db.prepare('SELECT COUNT(*) n FROM events').get().n; db.close(); return n; };
const HOT_ROWS = countRows(EVENTS), ARCH_ROWS = countRows(ARCHIVE);

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
            PROGRESS_SQLITE_PATH: path.join(P.data, 'progress.db'),
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

// 5040 = servicio de Windows (ver authzSubjectScope). Rango propio 5160–5239.
const pickPort = (base) => ((p) => (p === 5040 ? 5041 : p))(base + (process.pid % 80));
const PORT = pickPort(5160), PORT_BAD = PORT + 80;
const BASE = `http://127.0.0.1:${PORT}`, BASE_BAD = `http://127.0.0.1:${PORT_BAD}`;
const ROUTE = '/api/reading/my-effective-time';
const GET = (uid, url = ROUTE, base = BASE) =>
    fetch(`${base}${url}`, uid ? { headers: { 'x-user-id': uid } } : {});
const json = async (r) => { try { return await r.json(); } catch { return null; } };

let api, apiBad;
async function main() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    section('[S1] SELF → 200 con respuesta mínima');
    {
        const r = await GET('lec-a1');
        const b = await json(r);
        ok('lec-a1 → 200', r.status === 200, String(r.status));
        ok('solo { effectiveReadingMs, autoAdvanceUnlocked }',
            JSON.stringify(Object.keys(b ?? {}).sort()) === '["autoAdvanceUnlocked","effectiveReadingMs"]', JSON.stringify(b));
        ok('hot ∪ archive: 100 min + 30 min = 130 min', b?.effectiveReadingMs === 130 * MIN, String(b?.effectiveReadingMs));
        ok('130 min ≥ 120 → desbloqueado', b?.autoAdvanceUnlocked === true);
        ok('Cache-Control: no-store', r.headers.get('cache-control') === 'no-store', String(r.headers.get('cache-control')));
        const txt = JSON.stringify(b);
        for (const fuga of ['c-1', 'session', 'ev-', 'server_ts', String(T0)]) {
            ok(`la respuesta no contiene "${fuga}"`, !txt.includes(fuga), txt);
        }
    }

    section('[UMBRAL] 120 min exactos');
    {
        const a2 = await json(await GET('lec-a2'));
        ok('119 min → bloqueado', a2?.effectiveReadingMs === 119 * MIN && a2?.autoAdvanceUnlocked === false, JSON.stringify(a2));
        const a3 = await json(await GET('lec-a3'));
        ok('120 min → desbloqueado', a3?.effectiveReadingMs === 120 * MIN && a3?.autoAdvanceUnlocked === true, JSON.stringify(a3));
        const m = await GET('med-a');
        const mb = await json(m);
        ok('mediador → 200 con SU tiempo (0)', m.status === 200 && mb?.effectiveReadingMs === 0 && mb?.autoAdvanceUnlocked === false, JSON.stringify(mb));
    }

    section('[S2] SIN SESIÓN → 401');
    {
        const r = await GET(null);
        ok('sin x-user-id → 401', r.status === 401, String(r.status));
    }

    section('[S3] NO HAY FORMA DE PEDIR EL TIEMPO DE OTRO');
    {
        const q = await json(await GET('lec-a2', `${ROUTE}?userId=lec-a1&user=lec-a1&uid=lec-a1`));
        ok('?userId=otro se ignora: devuelve el propio (119 min)', q?.effectiveReadingMs === 119 * MIN, JSON.stringify(q));
        const pth = await GET('lec-a2', `${ROUTE}/lec-a1`);
        ok('/…/:userId no existe como ruta (no 200)', pth.status !== 200, String(pth.status));
        const adm = await json(await GET('adm', `${ROUTE}?userId=lec-a1`));
        ok('administrador: tampoco consulta a otro (devuelve el suyo, 0)', adm?.effectiveReadingMs === 0, JSON.stringify(adm));
        const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
        const i = src.indexOf(`app.get('${ROUTE}'`);
        const handler = src.slice(i, src.indexOf('\n});', i));
        ok('el handler no lee req.query / req.body / req.params', i > 0 && !/req\.(query|body|params)/.test(handler));
        ok('el sujeto sale de la sesión (req.user.id → getPrincipal)', /getPrincipal\(String\(req\.user\?\.id/.test(handler));
        ok('única ruta registrada para este recurso', src.split(`'${ROUTE}`).length === 2);
    }

    section('[S4] IDENTIDAD INDISPONIBLE → 503');
    {
        // Contrato vigente de requireUserAuth con sesión (compat/enforce, como
        // producción): autoridad física del usuario ilegible → 503, JAMÁS un
        // 401/403 ni un tiempo 0 presentado como decisión ordinaria.
        apiBad = spawnApi(PORT_BAD, { SESSION_AUTH_MODE: 'compat', USERS_DB: P.usersCorrupt });
        await waitHealthy(BASE_BAD, apiBad);
        const r = await GET('lec-a1', ROUTE, BASE_BAD);
        const b = await json(r);
        ok('padrón de usuarios corrupto → 503', r.status === 503, `${r.status} ${JSON.stringify(b)}`);
        ok('…sin tiempo ni desbloqueo en el cuerpo',
            !('effectiveReadingMs' in (b ?? {})) && !('autoAdvanceUnlocked' in (b ?? {})), JSON.stringify(b));
        const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
        const i = src.indexOf(`app.get('${ROUTE}'`);
        const handler = src.slice(i, src.indexOf('\n});', i));
        ok('el handler traduce IdentityUnavailableError del CIS a 503 identity_unavailable',
            /e instanceof IdentityUnavailableError/.test(handler) && /status\(503\)\.json\(\{ error: 'identity_unavailable'/.test(handler));
    }

    section('[STORES] sin escrituras');
    {
        ok('events.db: mismas filas', countRows(EVENTS) === HOT_ROWS);
        ok('events.archive.db: mismas filas', countRows(ARCHIVE) === ARCH_ROWS);
        ok('users byte-idéntico', fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        try { api?.kill('SIGKILL'); } catch { /* ya muerto */ }
        try { apiBad?.kill('SIGKILL'); } catch { /* ya muerto */ }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nCHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 (unlock) — ${pass} ✓, ${fail} ✗`);
        process.exit(fail ? 1 : 0);
    });
