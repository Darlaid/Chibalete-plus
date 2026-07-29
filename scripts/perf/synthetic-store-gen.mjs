/**
 * synthetic-store-gen.mjs — CHP-STATS-SHADOW-PERF-01D, Fase 12.
 *
 * Genera fixtures **completamente sintéticas y determinísticas** para medir
 * escalabilidad a 1×, 5× y 10×.
 *
 * Qué se replica: el *schema*, la proporción aproximada de tipos de evento, la
 * distribución por modo de lectura, las ventanas temporales y las relaciones
 * usuario→grupo→institución.
 *
 * Qué NO se replica, nunca: identificadores reales, correos, nombres, tokens,
 * textos ni payloads de eventos reales. Todo se deriva de una semilla, así que
 * el dataset es reproducible sin necesidad de versionar la base generada.
 *
 * Uso:
 *   node synthetic-store-gen.mjs --out /ruta/dataset-5x --scale 5 --seed 20260729
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const k = argv[i].slice(2);
        const v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    }
    return out;
}
const args = parseArgs(process.argv);
const OUT   = String(args.out || (() => { console.error('falta --out'); process.exit(2); })());
const SCALE = Number(args.scale ?? 1);
const SEED  = Number(args.seed ?? 20260729);

/** PRNG determinístico. La semilla queda documentada en el manifiesto. */
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int  = (min, max) => min + Math.floor(rand() * (max - min + 1));

// ── forma del 1× de referencia (solo magnitudes, ningún dato) ──────────────
// Derivadas del snapshot: 19.465 eventos, 647 usuarios, 20 grupos, 4
// instituciones, ventana ~79 días.
const BASE = {
    events: 19_465,
    users: 647,
    groups: 20,
    organizations: 4,
    windowFromTs: 1778203452389,
    windowToTs:   1785021479763,
};

// Distribución por modo observada en el snapshot (aproximada, no exacta).
const MODES = [
    { mode: 'immersive', weight: 0.62 },
    { mode: 'text',      weight: 0.24 },
    { mode: 'album',     weight: 0.10 },
    { mode: 'a11y',      weight: 0.04 },
];
const EVENT_TYPES = [
    { type: 'heartbeat',     weight: 0.70 },
    { type: 'session_start', weight: 0.12 },
    { type: 'session_end',   weight: 0.09 },
    { type: 'page_view',     weight: 0.06 },
    { type: 'content_open',  weight: 0.03 },
];
function weighted(table, key) {
    const r = rand();
    let acc = 0;
    for (const row of table) { acc += row.weight; if (r <= acc) return row[key]; }
    return table[table.length - 1][key];
}

// ── padrón sintético ───────────────────────────────────────────────────────
const orgCount   = BASE.organizations;
const groupCount = BASE.groups;
const userCount  = BASE.users * SCALE;

const organizations = Array.from({ length: orgCount }, (_, i) => ({
    id: `synthetic-org-${String(i + 1).padStart(3, '0')}`,
    name: `Institucion Sintetica ${i + 1}`,
    createdAt: new Date(BASE.windowFromTs).toISOString(),
}));

// Una institución deliberadamente SIN actividad y otra SIN población, para que
// el dataset ejercite NO_ACTIVITY y NO_DATA igual que el real.
const ORG_NO_ACTIVITY = organizations[orgCount - 2].id;
const ORG_NO_DATA     = organizations[orgCount - 1].id;

const groups = Array.from({ length: groupCount }, (_, i) => {
    const org = organizations[i % (orgCount - 1)];      // la última queda vacía
    return {
        id: `synthetic-group-${String(i + 1).padStart(3, '0')}`,
        name: `Grupo Sintetico ${i + 1}`,
        school: org.name,
        organizationId: org.id,
        grade: `G${(i % 11) + 1}`,
        teacherId: null,
        memberIds: [],
        studentIds: [],
    };
});

const users = [];
for (let i = 0; i < userCount; i++) {
    const g = groups[i % groups.length];
    const isMediator = i % 40 === 0;
    const id = `synthetic-user-${String(i + 1).padStart(6, '0')}`;
    users.push({
        id,
        nombre_completo: `Persona Sintetica ${i + 1}`,
        nombre_usuario: `usuario${i + 1}`,
        email: `usuario${i + 1}@synthetic.invalid`,   // TLD reservado: nunca enrutable
        password: 'synthetic-not-a-credential',
        roles: [isMediator ? 'mediador' : 'lector'],
        mediatorKind: isMediator ? 'teacher' : null,
        organizationId: g.organizationId,
        nivel_lectura: pick(['Inicial', 'Intermedio', 'Avanzado']),
        accountStatus: 'active',
        lastLoginAt: null,
        social_connections: [],
    });
    if (isMediator) { g.teacherId = id; g.memberIds.push(id); }
    else { g.studentIds.push(id); g.memberIds.push(id); }
}

// ── eventos sintéticos ─────────────────────────────────────────────────────
const eventCount = BASE.events * SCALE;
const contentIds = Array.from({ length: 60 }, (_, i) => `synthetic-content-${String(i + 1).padStart(4, '0')}`);

// Usuarios elegibles para emitir eventos: los de instituciones con actividad.
const activeUsers = users.filter((u) => u.organizationId !== ORG_NO_ACTIVITY && u.organizationId !== ORG_NO_DATA);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'data-critical'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'uploads'), { recursive: true });

const eventsPath = path.join(OUT, 'data-critical', 'events.db');
const db = new Database(eventsPath);
db.pragma('journal_mode = WAL');

// Schema igual al productivo: se copia la DDL del snapshot si se indica.
const ddlSource = args.schemaFrom ? String(args.schemaFrom) : null;
if (ddlSource) {
    const src = new Database(ddlSource, { readonly: true, fileMustExist: true });
    const stmts = src.prepare(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
    for (const { sql } of stmts) db.exec(sql);
    src.close();
} else {
    console.error('falta --schemaFrom: el schema debe derivarse del snapshot, no inventarse');
    process.exit(2);
}

const cols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
const insertCols = cols.filter((c) => c !== 'id');
const insert = db.prepare(
    `INSERT INTO events (${insertCols.join(',')}) VALUES (${insertCols.map(() => '?').join(',')})`);

const span = BASE.windowToTs - BASE.windowFromTs;
let sessionSeq = 0;
const insertMany = db.transaction((n) => {
    for (let i = 0; i < n; i++) {
        const u = activeUsers[Math.floor(rand() * activeUsers.length)];
        const ts = BASE.windowFromTs + Math.floor(rand() * span);
        const mode = weighted(MODES, 'mode');
        const type = weighted(EVENT_TYPES, 'type');
        if (type === 'session_start') sessionSeq++;
        const row = {
            server_ts: ts,
            client_ts: ts - int(0, 500),
            user_id: u.id,
            session_id: `synthetic-session-${String(sessionSeq || 1).padStart(8, '0')}`,
            event_type: type,
            mode,
            content_id: pick(contentIds),
            elapsed_ms: int(0, 900_000),
            progress: Math.round(rand() * 100) / 100,
            source: rand() < 0.85 ? 'native' : 'legacy',
            organization_id: u.organizationId,
            group_id: null,
            payload: JSON.stringify({ synthetic: true }),
        };
        insert.run(insertCols.map((c) => (row[c] !== undefined ? row[c] : null)));
    }
});

const CHUNK = 5000;
for (let done = 0; done < eventCount; done += CHUNK) {
    insertMany(Math.min(CHUNK, eventCount - done));
}
db.pragma('wal_checkpoint(TRUNCATE)');
const quick = db.pragma('quick_check', { simple: true });
const total = db.prepare('SELECT COUNT(*) c FROM events').get().c;
db.close();

// ── stores JSON ────────────────────────────────────────────────────────────
const write = (rel, data) => {
    const p = path.join(OUT, rel);
    fs.writeFileSync(p, JSON.stringify(data));
    return p;
};
write('data-critical/usuarios_colegios_oro.json', users);
write('data/groups_db.json', groups);
write('data/schools_db.json', organizations);
write('data/users_db.json', []);
write('data/access_db.json', []);
write('data/sections.json', []);
write('data/school_configs.json', {});
write('data/content.json', contentIds.map((id) => ({ id, title: `Contenido Sintetico ${id.slice(-4)}`, type: 'text' })));
write('data/content_db.json', []);
write('data/analytics_db.json', []);
write('data/leo_memory_db.json', { memoryMap: {} });
write('data/leo_interactions_db.json', []);
write('data/leo_evidence_db.json', []);
write('data/leo_profile_db.json', {});
write('data/interventions_db.json', []);
write('data/submissions_db.json', []);
write('data/user_audit_log.json', []);
write('data/progress_db.json', { progressMap: {} });
write('data/lu_config.json', {});

// progress.db y offline_assignments.db con el schema del snapshot, vacías.
for (const [rel, srcKey] of [['data/progress.db', 'progressFrom'], ['data/offline_assignments.db', 'offlineFrom']]) {
    const src = args[srcKey] ? String(args[srcKey]) : null;
    const target = path.join(OUT, rel);
    const out = new Database(target);
    out.pragma('journal_mode = WAL');
    if (src) {
        const s = new Database(src, { readonly: true, fileMustExist: true });
        for (const { sql } of s.prepare("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all()) {
            out.exec(sql);
        }
        s.close();
    }
    out.pragma('wal_checkpoint(TRUNCATE)');
    out.close();
}

// ── manifiesto reproducible ────────────────────────────────────────────────
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const manifest = {
    dataset: `DATASET_${SCALE}X`,
    generator: 'scripts/perf/synthetic-store-gen.mjs',
    seed: SEED,
    scale: SCALE,
    synthetic: true,
    realIdentifiers: false,
    counts: {
        events: total,
        users: users.length,
        groups: groups.length,
        organizations: organizations.length,
        organizationsWithoutActivity: 1,
        organizationsWithoutPopulation: 1,
    },
    window: { fromTs: BASE.windowFromTs, toTs: BASE.windowToTs },
    integrity: { events_quick_check: quick, events_sha256: sha(eventsPath), events_bytes: fs.statSync(eventsPath).size },
};
fs.writeFileSync(path.join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
