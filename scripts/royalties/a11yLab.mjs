#!/usr/bin/env node
/**
 * a11yLab.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A3 / A11Y-FIX-01.
 *
 * Laboratorio AISLADO para las pruebas manuales con VoiceOver y TalkBack
 * (`docs/royalties/F3A3_A11Y_FIX_01.md` §5). Todo vive en un directorio
 * temporal con datos SINTÉTICOS: un lector de laboratorio, una regla pagada
 * de laboratorio y dos obras generadas (una larga y una que cabe en pantalla).
 * La ingesta económica se enciende SOLO en el servidor que arranca este
 * script. Nunca lee ni escribe `data/`, `data-critical/` ni uploads reales.
 *
 *   node scripts/royalties/a11yLab.mjs seed   --dir <lab> --origin http://<IP-LAN>:5173
 *       (<lab> dentro del directorio temporal del sistema: el servidor en modo
 *        test solo acepta un padrón temporal)
 *   node scripts/royalties/a11yLab.mjs start  --dir <lab> [--ingest off]   (POSIX: clave de sesión 0400)
 *   node scripts/royalties/a11yLab.mjs report --dir <lab>        (solo lectura de econ_events)
 *
 * El frontend se sirve aparte con `npm run dev` (Vite escucha en 0.0.0.0 y
 * reenvía /api y /uploads a :3000).
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1 } from '../../server/royalties/economicEpisodes.mjs';
import { engineClockContext, excludedUsersFromRows } from '../../server/royalties/econEvents.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MARKER = 'CHP_A11Y_LAB';
import { makeEpub, xhtml } from '../../server/__test__/helpers/epubFixture.mjs';

const MARKER_TEXT = 'laboratorio sintético A11Y-FIX-01: se puede borrar entero\n';
// Dos cuentas sintéticas: la segunda trae historial pedagógico de 2 h 10 min
// para que el avance automático del Modo Accesible esté desbloqueado SIN tocar
// el umbral real (120 min, `AUTO_ADVANCE_UNLOCK_MS`).
const LAB_USERS = [
    { id: 'LAB-LECTOR', email: 'lector@a11y-lab.test', nombre_completo: 'Lector de laboratorio', historyMs: 0 },
    { id: 'LAB-AVANCE', email: 'lector-avance@a11y-lab.test', nombre_completo: 'Lector de laboratorio (avance automático)', historyMs: 130 * 60 * 1000 },
];
// Obra donde vive el historial: NO está en el catálogo ni en las reglas, así
// que nunca es atribuible ni elegible; y el historial es pedagógico (`events`),
// no económico (`econ_events`).
const HISTORY_CONTENT_ID = 'lab-historial-sintetico';
const CONTENTS = [
    { id: 'lab-largo', titulo: 'Laboratorio · texto largo', words: 4000 },
    { id: 'lab-corto', titulo: 'Laboratorio · cabe en pantalla', words: 70 },
    { id: 'lab-epub', titulo: 'Laboratorio · EPUB', words: 4500, epub: true },
];

const [cmd, ...rest] = process.argv.slice(2);
const arg = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };
const die = (msg) => { console.error(`a11yLab: ${msg}`); process.exit(1); };

function labDir({ fresh }) {
    const raw = arg('dir');
    if (!raw) die('falta --dir <directorio del laboratorio>');
    const dir = path.resolve(raw);
    const tmpRoot = fs.realpathSync(os.tmpdir());
    const real = fs.existsSync(dir) ? fs.realpathSync(dir) : path.join(fs.realpathSync(path.dirname(dir)), path.basename(dir));
    if (!real.startsWith(tmpRoot + path.sep)) die(`--dir debe estar dentro de ${tmpRoot} (el servidor en modo test solo acepta un padrón temporal)`);
    for (const forbidden of ['data', 'data-critical', path.join('public', 'uploads')]) {
        const f = path.join(REPO, forbidden);
        if (dir === f || dir.startsWith(f + path.sep)) die(`--dir no puede estar dentro de ${forbidden}/`);
    }
    if (dir === REPO || REPO.startsWith(dir + path.sep)) die('--dir no puede ser el repositorio ni contenerlo');
    if (fresh) {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length) die(`${dir} no está vacío`);
        fs.mkdirSync(dir, { recursive: true });
    } else if (!fs.existsSync(path.join(dir, MARKER))) {
        die(`${dir} no es un laboratorio (falta ${MARKER}); créalo con "seed"`);
    }
    return dir;
}

const paths = (dir) => ({
    users: path.join(dir, 'users.json'), groups: path.join(dir, 'groups.json'), schools: path.join(dir, 'schools.json'),
    access: path.join(dir, 'access.json'), content: path.join(dir, 'content.json'), progress: path.join(dir, 'progress_db.json'),
    identity: path.join(dir, 'identity.db'), uploads: path.join(dir, 'uploads'), offline: path.join(dir, 'offline.db'),
    sessions: path.join(dir, 'sessions.db'), key: path.join(dir, 'session_signing_key'), events: path.join(dir, 'events.db'),
    insights: path.join(dir, 'insights.db'), royalties: path.join(dir, 'rdb', 'royalties.db'), audit: path.join(dir, 'audit.json'),
    data: path.join(dir, 'data'), config: path.join(dir, 'lab.json'), archive: path.join(dir, 'events.archive.db'),
});

// Texto sintético determinista: párrafos cortos, como un libro de lectura.
function syntheticText(words) {
    const vocab = ['la', 'lectora', 'abrió', 'el', 'libro', 'junto', 'a', 'la', 'ventana', 'y', 'leyó', 'despacio', 'cada', 'palabra',
        'del', 'capítulo', 'mientras', 'afuera', 'llovía', 'sobre', 'los', 'tejados', 'de', 'la', 'ciudad', 'tranquila'];
    const out = [];
    let n = 0, i = 0;
    while (n < words) {
        const len = Math.min(words - n, 12 + (i % 7));
        const s = Array.from({ length: len }, (_, k) => vocab[(i * 7 + k * 3) % vocab.length]).join(' ');
        out.push(s.charAt(0).toUpperCase() + s.slice(1) + '.');
        n += len; i++;
        if (i % 4 === 0) out.push('\n\n');
    }
    return out.join(' ').replace(/ \n\n /g, '\n\n');
}

// EPUB sintético (3 capítulos del mismo generador de texto): paginable en
// varias páginas por capítulo. Sin contenido editorial.
function syntheticEpub(words) {
    const per = Math.ceil(words / 3);
    const docs = {};
    for (let i = 1; i <= 3; i++) {
        const paras = syntheticText(per).split('\n\n').map((p) => `<p>${p}</p>`).join('\n');
        docs[`Text/cap${i}.xhtml`] = xhtml(`<h1>Capítulo ${i}</h1>\n${paras}`);
    }
    return makeEpub(docs);
}

async function seed() {
    const dir = labDir({ fresh: true });
    const origin = arg('origin');
    if (!origin || !/^https?:\/\/[^/]+$/.test(origin)) die('falta --origin http://<IP-LAN>:5173 (origen del navegador del dispositivo)');
    const P = paths(dir);
    // Primero el marcador: si algo falla a mitad, el directorio sigue siendo reconocible como laboratorio.
    fs.writeFileSync(path.join(dir, MARKER), MARKER_TEXT);
    const passwords = {};
    fs.writeFileSync(P.users, JSON.stringify(LAB_USERS.map((u) => {
        passwords[u.email] = crypto.randomBytes(9).toString('base64url');
        return { id: u.id, email: u.email, password: bcrypt.hashSync(passwords[u.email], 10), roles: ['lector'], accountStatus: 'active', nombre_completo: u.nombre_completo };
    }), null, 2));
    for (const f of [P.groups, P.schools]) fs.writeFileSync(f, '[]');
    fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));
    // Cada obra en /uploads/<id>/ (el endpoint del EPUB exige que la ruta sea de la propia obra).
    const content = CONTENTS.map((c) => {
        const up = path.join(P.uploads, c.id);
        fs.mkdirSync(up, { recursive: true });
        fs.writeFileSync(path.join(up, `${c.id}.txt`), syntheticText(c.words));
        const rec = { id: c.id, titulo: c.titulo, autor: 'Laboratorio', tipo: 'libro', editorial: 'Laboratorio', etiquetas: ['laboratorio'],
            status: 'disponible', descripcion_corta: 'Obra sintética de laboratorio', publisherId: 'pub-laboratorio',
            texto_plano_url: `/uploads/${c.id}/${c.id}.txt` };
        if (c.epub) {
            fs.writeFileSync(path.join(up, `${c.id}.epub`), syntheticEpub(c.words));
            rec.epub_url = `/uploads/${c.id}/${c.id}.epub`;
        }
        return rec;
    });
    fs.writeFileSync(P.content, JSON.stringify(content, null, 2));
    const since = Date.now() - 60_000;
    fs.writeFileSync(P.access, JSON.stringify(LAB_USERS.map((u) => ({
        id: `lab-regla-pagada-${u.id.toLowerCase()}`, scope: 'user', scopeId: u.id, titleIds: CONTENTS.map((c) => c.id), collectionIds: [], expiresAt: null,
        commercialClass: 'paid_b2c', commercialClassSince: since,
        commercialClassHistory: [{ commercialClass: 'paid_b2c', since, by: 'a11y-lab', evidenceRef: 'laboratorio-sintetico' }],
    })), null, 2));
    // Historial pedagógico sintético (sesiones cerradas) con el propio insertEvent
    // del servidor, en el events.db DEL LABORATORIO.
    process.env.EVENTS_SQLITE_PATH = P.events;
    const events = await import('../../server/eventsService.js');
    const t0 = Date.now() - 2 * 86_400_000;
    for (const u of LAB_USERS.filter((x) => x.historyMs > 0)) {
        const half = Math.round(u.historyMs / 2);
        for (let s = 0; s < 2; s++) {
            const sessionId = `lab-historial-${u.id.toLowerCase()}-${s + 1}`;
            const base = { schemaVersion: 1, mode: 'a11y', userId: u.id, contentId: HISTORY_CONTENT_ID, sessionId };
            events.insertEvent({ ...base, eventId: `${sessionId}-start`, event: 'reading_started', clientTs: t0 + s * 3 * 3_600_000 });
            events.insertEvent({ ...base, eventId: `${sessionId}-end`, event: 'session_ended', clientTs: t0 + s * 3 * 3_600_000 + half, elapsedMs: half, payload: { totalMs: half } });
        }
    }
    events.closeDb();
    fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
    try { fs.chmodSync(P.key, 0o400); } catch { /* Windows: el servidor exige POSIX */ }
    fs.writeFileSync(P.config, JSON.stringify({ origin, createdAt: new Date().toISOString() }, null, 2));
    console.log(`Laboratorio creado en ${dir}`);
    for (const u of LAB_USERS) {
        console.log(`Cuenta: ${u.email}  ·  contraseña: ${passwords[u.email]}  (${u.historyMs ? 'avance automático desbloqueado' : 'sin historial'}; solo existe en este laboratorio)`);
    }
    console.log(`Obras: ${CONTENTS.map((c) => `${c.id} (${c.words} palabras${c.epub ? ', EPUB' : ''})`).join(', ')}`);
}

function start() {
    // Igual que econIngestHttp: en Windows la clave de sesión no puede ser
    // 0400/uid, el login no emite cookie y /api/v1/events responde 401.
    if (process.platform === 'win32') die('start requiere macOS o Linux (o WSL): la sesión firmada exige la clave 0400');
    // server.js carga ../.env (dotenv): en una máquina de desarrollo trae
    // credenciales reales. El laboratorio solo arranca desde un árbol limpio
    // (p. ej. `git archive` dentro de un contenedor).
    if (fs.existsSync(path.join(REPO, '.env'))) die('hay un .env en el repositorio: usa una copia limpia (git archive), ver F3A3_A11Y_LAB_02.md');
    // Varios módulos (memoria de Leo, configuración LU) escriben en ../data con
    // rutas fijas: con stores reales presentes el laboratorio no arranca.
    for (const real of ['data', 'data-critical']) {
        if (fs.existsSync(path.join(REPO, real))) die(`existe ${real}/ en el repositorio: usa una copia limpia (git archive), ver F3A3_A11Y_LAB_02.md`);
    }
    const dir = labDir({ fresh: false });
    const P = paths(dir);
    const { origin } = JSON.parse(fs.readFileSync(P.config, 'utf8'));
    const ingest = arg('ingest') ?? 'on';
    if (!['on', 'off'].includes(ingest)) die('--ingest on|off');
    // Entorno mínimo explícito: nada heredado salvo lo que necesita el proceso.
    const keep = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ'].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));
    const env = {
        ...keep, NODE_ENV: 'test', PORT: '3000', CHP_DATA_DIR: P.data,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
        UPLOADS_ROOT: P.uploads, OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: P.audit,
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: 'enforce',
        SESSION_ALLOWED_ORIGINS: `${origin},http://localhost:5173`, ALLOWED_ORIGINS: `${origin},http://localhost:5173`,
        ACCESS_FALLBACK_MODE: 'restricted', EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights,
        ROYALTIES_DB: P.royalties, ECONOMIC_INGEST_MODE: ingest === 'on' ? 'on' : '',
        PROGRESS_SQLITE_PATH: path.join(dir, 'progress.db'), LEO_EVIDENCE_DB: path.join(dir, 'leo_evidence.db'),
        ARCHIVE_SQLITE_PATH: P.archive,
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        // Tienda: la URL remota es fija salvo en NODE_ENV=test; aquí no lleva a ninguna parte.
        CHP_TEST_WOO_ORIGIN: 'http://127.0.0.1:9',
    };
    console.log(`a11yLab: servidor de laboratorio en :3000 con ECONOMIC_INGEST_MODE=${ingest} (solo ${dir})`);
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env, stdio: 'inherit' });
    // Parar el laboratorio para también el servidor: sin procesos huérfanos.
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
    child.on('exit', (code) => process.exit(code ?? 0));
}

function report() {
    const dir = labDir({ fresh: false });
    const P = paths(dir);
    if (!fs.existsSync(P.events)) die('todavía no hay events.db: arranca el laboratorio y lee algo');
    const db = new Database(P.events, { readonly: true, fileMustExist: true });
    let rows;
    try {
        const has = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='econ_events'").get();
        rows = has ? db.prepare('SELECT * FROM econ_events ORDER BY id').all() : [];
    } finally { db.close(); }
    if (!rows.length) { console.log('econ_events vacía'); return; }
    const sessions = new Map();
    for (const r of rows.filter((x) => x.event === 'econ_tick')) {
        const s = sessions.get(r.session_id) ?? { user: r.user_id, mode: r.mode, content: r.content_id, ticks: 0, signals: 0, audio: 0, from: r.client_ts, to: r.client_ts };
        const p = JSON.parse(r.payload_json || '{}');
        s.ticks++; if (p.humanSignalAgoMs != null) s.signals++; if (p.audio?.playing) s.audio++;
        s.from = Math.min(s.from, r.client_ts); s.to = Math.max(s.to, r.client_ts);
        sessions.set(r.session_id, s);
    }
    console.log('Sesiones técnicas (una por obra × modo × apertura):');
    for (const [id, s] of sessions) {
        console.log(`  ${id}  ${s.user.padEnd(10)} ${s.mode.padEnd(9)} ${s.content.padEnd(10)} ${new Date(s.from).toISOString().slice(11, 19)}–${new Date(s.to).toISOString().slice(11, 19)}  ticks ${s.ticks}  con señal ${s.signals}  con audio ${s.audio}`);
    }
    const engine = (rs) => computeEconomicEpisodes(rs, {
        ruleSet: RULE_SET_RS_2026_01_V1, eligibleContentIds: CONTENTS.map((c) => c.id),
        expectedMinutesByContent: Object.fromEntries(CONTENTS.map((c) => [c.id, Math.max(1, Math.round(c.words / RULE_SET_RS_2026_01_V1.proseWordsPerMinute))])),
        excludedUsers: excludedUsersFromRows(rs), ...engineClockContext(),
    });
    // Cada caso manual es una sesión: su tiempo aislado, con el mismo motor.
    console.log('Acreditado por sesión (evaluación aislada de cada caso):');
    for (const [id, s] of sessions) {
        const own = engine(rows.filter((r) => r.session_id === id)).episodes.reduce((a, e) => a + e.activeSeconds, 0);
        console.log(`  ${id}  ${s.user.padEnd(10)} ${s.mode.padEnd(9)} con ticks ≈ ${Math.round((s.to - s.from) / 1000)} s  acreditado ${own} s`);
    }
    const res = engine(rows);
    console.log('Episodios (motor F3-A1, rs-2026-01-v1):');
    for (const e of res.episodes) {
        console.log(`  ${e.contentId}  activos ${e.activeSeconds} s  por modo ${JSON.stringify(e.modeSeconds)}  cualificado ${e.qualified}${e.reasons?.length ? ` (${e.reasons.join(', ')})` : ''}`);
    }
    for (const w of res.works ?? []) console.log(`  obra ${w.contentId}: Q = ${w.Q}`);
    if (res.invalid?.length) console.log(`  descartados: ${res.invalid.length} (${[...new Set(res.invalid.map((x) => x.reason))].join(', ')})`);
}

if (cmd === 'seed') await seed();
else if (cmd === 'start') start();
else if (cmd === 'report') report();
else die('uso: seed --dir <lab> --origin <url> | start --dir <lab> | report --dir <lab>');
