/**
 * leoIcdliDataDir.test.mjs — CHP V9 65B. El ICDLI respeta el directorio de datos configurado.
 *
 * `leoICDLIBridge.js` leía los eventos de lectura y la memoria de Leo de una ruta fija (`../data/…` del repositorio),
 * sin mirar `CHP_DATA_DIR`: un proceso configurado con otro almacén calculaba el ICDLI global con los datos del
 * directorio del repositorio (o con ninguno). Aquí dos almacenes sintéticos distintos, cada uno en su proceso:
 * cada proceso ve SOLO lo suyo. Sin servidor; nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/leoIcdliDataDir.test.mjs
 */
import './helpers/testMode.mjs';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 700)), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65b_icdli_'));
const NOW = Date.now(), DAY = 86_400_000;
/** Un almacén: `sessions` sesiones de lectura de `userId` y una memoria de Leo con `anchors` anclas. */
const store = (name, userId, sessions, anchors) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    const events = [];
    for (let i = 0; i < sessions; i++) {
        const t = NOW - (i + 1) * DAY;
        events.push({ event: 'session_start', userId, contentId: 'c1', timestamp: t, streak: 0 });
        events.push({ event: 'block_complete', userId, contentId: 'c1', timestamp: t + 1000, streak: 1 });
        events.push({ event: 'session_end', userId, contentId: 'c1', timestamp: t + 600_000, sessionDuration: 600_000, progressPercentage: 50 });
    }
    fs.writeFileSync(path.join(dir, 'analytics_db.json'), JSON.stringify(events));
    fs.writeFileSync(path.join(dir, 'leo_memory_db.json'), JSON.stringify({ memoryMap: { [`${userId}__c1`]: { schemaVersion: 1, interactionCount: anchors, pedagogicalStage: 'creation',
        difficultyLevel: 'avanzado', recentAnchors: Array.from({ length: anchors }, (_, i) => `a${i}`), updatedAt: new Date(NOW).toISOString() } } }));
    fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([{ id: userId, roles: ['lector'], accountStatus: 'active' }]));
    fs.writeFileSync(path.join(dir, 'groups.json'), '[]');
    return dir;
};
const A = store('almacen-a', 'lector-a', 6, 3), B = store('almacen-b', 'lector-b', 2, 0);

const BRIDGE = pathToFileURL(path.join(HERE, '..', 'leoICDLIBridge.js')).href;
const CHILD = `
    const { getLeoICDLISnapshot, getContextualICDLISnapshot } = await import(${JSON.stringify(BRIDGE)});
    const pick = (s) => s && ({ hasData: s.hasData, composite: s.composite, level: s.levelLabel, sessions: s.readingSessions });
    const all = Object.assign(() => true, { strict: false });
    const out = {};
    for (const u of ['lector-a', 'lector-b']) out[u] = { global: pick(getLeoICDLISnapshot(u)), contextual: pick(getContextualICDLISnapshot(u, { includeContent: all, leoEntries: [] })) };
    console.log('RESULT ' + JSON.stringify(out));
`;
const run = (dir) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test', CHP_DATA_DIR: dir,
        USERS_DB: path.join(dir, 'users.json'), GROUPS_DB: path.join(dir, 'groups.json'), PROGRESS_SQLITE_PATH: path.join(dir, 'progress.db') } });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('RESULT '));
    return line ? JSON.parse(line.slice(7)) : { error: `${r.status} ${r.stderr?.slice(-600)}` };
};

console.log('\n[1] dos almacenes, dos procesos');
const ra = run(A), rb = run(B);
ok('proceso A: el ICDLI global de su lector sale de SU almacén (6 sesiones)', ra['lector-a']?.global?.hasData === true && ra['lector-a'].global.composite > 0, JSON.stringify(ra));
ok('proceso A: del lector del otro almacén no sabe nada', ra['lector-b']?.global?.hasData === false && ra['lector-b'].contextual?.hasData === false, JSON.stringify(ra['lector-b']));
ok('proceso B: lo mismo, al revés', rb['lector-b']?.global?.hasData === true && rb['lector-a']?.global?.hasData === false && rb['lector-a'].contextual?.hasData === false, JSON.stringify(rb));
ok('el ICDLI global y el contextual leen el mismo almacén (mismas sesiones de lectura)', ra['lector-a']?.contextual?.hasData === true && ra['lector-a'].contextual.sessions === 6
    && rb['lector-b']?.contextual?.sessions === 2, JSON.stringify([ra['lector-a'], rb['lector-b']]));
ok('la memoria de Leo también sale del almacén configurado: el compuesto de A (con anclas y etapa avanzada) no es el de un lector sin memoria', ra['lector-a']?.global?.composite > ra['lector-a']?.contextual?.composite,
    JSON.stringify(ra['lector-a']));

console.log('\n[2] las rutas salen de la configuración, no de una ruta fija del repositorio');
const src = (f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8');
const bridge = src('leoICDLIBridge.js'), orch = src('leoOrchestrator.js');
ok('leoICDLIBridge: eventos y memoria de Leo bajo CHP_DATA_DIR', /_DATA_DIR\s*=\s*process\.env\.CHP_DATA_DIR \|\|/.test(bridge) && /_ANALYTICS_DB\s*=\s*path\.join\(_DATA_DIR/.test(bridge)
    && /_LEO_MEMORY_DB\s*=\s*path\.join\(_DATA_DIR/.test(bridge) && !/path\.resolve\(__dirname, '\.\.\/data\/[a-z_]+\.json'\)/.test(bridge));
ok('leoOrchestrator: el catálogo es el de CONTENT_DB o el del directorio de datos configurado', /_DB_FILE\s*=\s*process\.env\.CONTENT_DB \|\| path\.join\(process\.env\.CHP_DATA_DIR \|\|/.test(orch)
    && !/path\.resolve\(__dirname, '\.\.\/data\/content\.json'\)/.test(orch));

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
