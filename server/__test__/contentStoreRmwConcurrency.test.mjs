/**
 * contentStoreRmwConcurrency.test.mjs — CHP-CONTENT-STORE-RMW-01.
 *
 * Demuestra —y luego impide— la PÉRDIDA DE ESCRITURAS de content.json cuando
 * dos réplicas ejecutan read-modify-write sobre el mismo store compartido.
 *
 * Incidente que lo motiva (04D/R8, 2026-08-26): la carga del mook «¿Estás
 * aquí?» creó 39 recursos repartidos por round-robin entre api_1 y api_2;
 * solo 20 sobrevivieron. `withFileLock` es cross-process y correcto, pero la
 * relectura «fresca» DENTRO del lock era `readJSON(DB_FILE)`, que sirve la
 * caché en proceso (TTL 30 s). Cada réplica reescribía el array COMPLETO a
 * partir de una instantánea vieja y borraba en silencio lo que la otra había
 * añadido. `mutateMook` nunca sufrió esto porque invalida antes de leer;
 * content.json era el ÚNICO store sin esa invalidación.
 *
 * Por qué DOS PROCESOS reales y no mocks: el defecto vive en la interacción
 * entre el lock de fichero y una caché por proceso. Un único proceso comparte
 * caché y no puede reproducirlo; un mock que evite la caché real probaría
 * justamente lo que no es. Se arrancan dos server.js contra un CHP_DATA_DIR
 * temporal.
 *
 * Aislamiento: todo ocurre en ficheros temporales. NUNCA toca data/,
 * data-critical/, uploads productivos ni ninguna ruta real.
 *
 *   node server/__test__/contentStoreRmwConcurrency.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rmw_'));
const P = {
    data: path.join(tmp, 'data'),
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    progress: path.join(tmp, 'progress_db.json'),
    uploads: path.join(tmp, 'uploads'),
};
fs.mkdirSync(P.uploads, { recursive: true });
fs.mkdirSync(P.data, { recursive: true });

fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' },
], null, 2));
fs.writeFileSync(P.groups, JSON.stringify([], null, 2));
fs.writeFileSync(P.schools, JSON.stringify([], null, 2));
fs.writeFileSync(P.access, JSON.stringify([], null, 2));
fs.writeFileSync(P.content, JSON.stringify([], null, 2));
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));

function spawnApi(port) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            // Sin emisión de sesión: requireAdminRole acepta x-user-id (modo legacy).
            SESSION_AUTH_MODE: 'off',
            // Sin proveedor de IA: el TTS falla tras emitir su primer progreso,
            // que es justo la escritura que este test necesita ejercitar.
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
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
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* aún arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-2000)}`);
}

const H = { 'content-type': 'application/json', 'x-user-id': 'ADM' };

const crear = (base, id, extra = {}) => fetch(`${base}/api/content`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ id, titulo: `T ${id}`, tipo: 'articulo_pedagogico', standalone: false, ...extra }),
});
const listar = (base) => fetch(`${base}/api/content`, { headers: H });
const borrar = (base, id) => fetch(`${base}/api/content/${id}`, { method: 'DELETE', headers: H });

const disco = () => JSON.parse(fs.readFileSync(P.content, 'utf8'));
const ids = () => new Set(disco().map(c => c.id));

const PORT1 = 4900 + (process.pid % 120), PORT2 = PORT1 + 1;
const b1 = `http://127.0.0.1:${PORT1}`, b2 = `http://127.0.0.1:${PORT2}`;
let api1, api2;

/**
 * [0] Ratchet estructural. Los tests de comportamiento demuestran el arreglo
 * hoy; este impide que un commit futuro lo deshaga sin romper nada visible.
 * Cada RMW de content.json debe invalidar la caché ANTES de leer, dentro del
 * lock, y ninguna escritura puede ocurrir fuera de un lock.
 */
function ratchetEstructural() {
    console.log('[0] ratchet estructural sobre server.js');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');

    const bloques = [];
    let i = src.indexOf('withFileLock(DB_FILE');
    while (i !== -1) {
        bloques.push(src.slice(i, i + 600));
        i = src.indexOf('withFileLock(DB_FILE', i + 1);
    }
    ok('los 6 flujos RMW de content.json siguen presentes', bloques.length === 6, String(bloques.length));

    const sinInvalidar = bloques.filter(b => {
        const inval = b.indexOf('_jsonCache.delete(DB_FILE)');
        const lect = b.indexOf('readJSON(DB_FILE)');
        return inval === -1 || (lect !== -1 && inval > lect);
    });
    ok('todos invalidan la caché antes de leer', sinInvalidar.length === 0,
        sinInvalidar.length + ' flujo(s) leen sin invalidar');

    const escrituras = (src.match(/writeJSON\(DB_FILE/g) || []).length;
    ok('toda escritura de content.json vive dentro de un lock', escrituras === 6, escrituras + ' escrituras');

    ok('la auditoría de arranque ya no reescribe la lista leída fuera del lock',
        !/withFileLock\(DB_FILE, \(\) => \{\s*writeJSON\(DB_FILE, contentList\)/.test(src));
}

async function main() {
    ratchetEstructural();
    api1 = spawnApi(PORT1);
    api2 = spawnApi(PORT2);
    await waitHealthy(b1, api1);
    await waitHealthy(b2, api2);

    // ── [1] Reproducción exacta del incidente ────────────────────────────
    // 39 creaciones alternando réplica, con una lectura de verificación tras
    // cada escritura: la misma secuencia que ejecutó el bridge del mook.
    console.log('\n[1] 39 escrituras alternando réplica (secuencia del bridge 04D)');
    await listar(b1); await listar(b2);            // ambas cachés calientes
    for (let i = 0; i < 39; i++) {
        const base = i % 2 === 0 ? b1 : b2;
        const r = await crear(base, `rmw-alt-${String(i).padStart(2, '0')}`);
        if (!r.ok) throw new Error(`creación ${i} respondió ${r.status}`);
        await listar(b1); await listar(b2);        // verificación, como el bridge
    }
    const tras39 = ids();
    ok('39/39 registros sobreviven', tras39.size === 39, `sobreviven ${tras39.size}/39`);
    const perdidos = Array.from({ length: 39 }, (_, i) => `rmw-alt-${String(i).padStart(2, '0')}`)
        .filter(id => !tras39.has(id));
    ok('ningún id creado desaparece', perdidos.length === 0, `faltan ${perdidos.length}: ${perdidos.slice(0, 6).join(', ')}`);

    // ── [2] Volumen: 100 ids únicos desde dos procesos ───────────────────
    console.log('\n[2] 100 ids únicos alternando entre dos procesos');
    const antes = ids().size;
    for (let i = 0; i < 100; i++) {
        const base = i % 2 === 0 ? b1 : b2;
        await crear(base, `rmw-vol-${String(i).padStart(3, '0')}`);
        if (i % 5 === 0) { await listar(b1); await listar(b2); }
    }
    const tras100 = ids();
    ok('100/100 registros sobreviven', tras100.size === antes + 100, `esperados ${antes + 100}, hay ${tras100.size}`);

    // ── [3] Monotonía: el conteo nunca retrocede ─────────────────────────
    console.log('\n[3] El conteo solo aumenta, nunca retrocede');
    let previo = ids().size, retrocesos = 0;
    for (let i = 0; i < 20; i++) {
        await crear(i % 2 === 0 ? b1 : b2, `rmw-mono-${i}`);
        const ahora = ids().size;
        if (ahora < previo) retrocesos++;
        previo = ahora;
    }
    ok('0 retrocesos del conteo', retrocesos === 0, `${retrocesos} retrocesos`);

    // ── [4] Progreso TTS concurrente con creaciones ──────────────────────
    // El handler onProgress hace su propio RMW asíncrono sobre el array
    // COMPLETO. Con un fichero de texto real, generateAudioForContent emite
    // su primer progreso ANTES de llamar al proveedor: no hace falta red.
    console.log('\n[4] progreso TTS en una réplica + creaciones en la otra');
    const txtRel = 'rmw-tts.txt';
    fs.writeFileSync(path.join(P.uploads, txtRel), 'Una frase corta. Otra frase corta. Y una tercera.');
    await listar(b1); await listar(b2);
    await crear(b1, 'rmw-tts-01', { texto_plano_url: `/uploads/${txtRel}` });
    const durante = [];
    for (let i = 0; i < 12; i++) {
        await crear(b2, `rmw-tts-par-${String(i).padStart(2, '0')}`);
        durante.push(`rmw-tts-par-${String(i).padStart(2, '0')}`);
        await sleep(120);
    }
    await sleep(1500); // deja aterrizar las escrituras asíncronas del TTS
    const trasTts = ids();
    ok('el contenido con TTS sigue presente', trasTts.has('rmw-tts-01'));
    ok('12/12 creaciones concurrentes al TTS sobreviven',
        durante.every(id => trasTts.has(id)),
        `faltan ${durante.filter(id => !trasTts.has(id)).length}`);
    ok('ningún registro anterior fue borrado por el TTS',
        Array.from(tras100).every(id => trasTts.has(id)),
        `perdidos ${Array.from(tras100).filter(id => !trasTts.has(id)).length}`);
    const conTts = disco().find(c => c.id === 'rmw-tts-01');
    ok('el TTS escribió su estado en el registro', !!conTts && !!conTts.ttsStatus, JSON.stringify(conTts?.ttsStatus));

    // ── [5] Actualización de metadata desde ambas réplicas ───────────────
    console.log('\n[5] dos actualizaciones de metadata, una por réplica');
    await listar(b1); await listar(b2);
    await crear(b1, 'rmw-meta-a', { titulo: 'A original' });
    await crear(b2, 'rmw-meta-b', { titulo: 'B original' });
    // El guard de idempotencia existente deduplica actor+id durante 2 s: la
    // edición debe llegar después de esa ventana para ser una edición real.
    await sleep(2200);
    await listar(b1); await listar(b2);
    await crear(b1, 'rmw-meta-a', { titulo: 'A editado' });
    await crear(b2, 'rmw-meta-b', { titulo: 'B editado' });
    const metaDisco = disco();
    const ma = metaDisco.find(c => c.id === 'rmw-meta-a');
    const mb = metaDisco.find(c => c.id === 'rmw-meta-b');
    ok('la edición de la réplica 1 persiste', ma?.titulo === 'A editado', ma?.titulo);
    ok('la edición de la réplica 2 persiste', mb?.titulo === 'B editado', mb?.titulo);
    ok('ninguna actualización creó un duplicado',
        metaDisco.filter(c => c.id === 'rmw-meta-a').length === 1 &&
        metaDisco.filter(c => c.id === 'rmw-meta-b').length === 1);

    // ── [6] Creación concurrente con eliminación ─────────────────────────
    console.log('\n[6] eliminación en una réplica, creación en la otra');
    await listar(b1); await listar(b2);
    const previoBorrado = ids();
    await borrar(b1, 'rmw-meta-a');
    await crear(b2, 'rmw-del-nuevo');
    const trasBorrado = ids();
    ok('el registro eliminado no reaparece', !trasBorrado.has('rmw-meta-a'));
    ok('el registro creado en paralelo persiste', trasBorrado.has('rmw-del-nuevo'));
    ok('la eliminación no arrastró registros ajenos',
        Array.from(previoBorrado).filter(id => id !== 'rmw-meta-a').every(id => trasBorrado.has(id)),
        `arrastrados ${Array.from(previoBorrado).filter(id => id !== 'rmw-meta-a' && !trasBorrado.has(id)).length}`);

    // ── [7] Idempotencia existente conservada ────────────────────────────
    console.log('\n[7] idempotencia de ráfaga (guard de 2 s) intacta');
    const [r1, r2] = await Promise.all([
        crear(b1, 'rmw-idem-01', { titulo: 'idem' }),
        crear(b1, 'rmw-idem-01', { titulo: 'idem' }),
    ]);
    ok('ambas respuestas son exitosas', r1.ok && r2.ok, `${r1.status}/${r2.status}`);
    ok('el id aparece una sola vez', disco().filter(c => c.id === 'rmw-idem-01').length === 1);

    // ── [8] Invariantes del store y del lock ─────────────────────────────
    console.log('\n[8] invariantes de integridad');
    ok('content.json es JSON válido y es un array', Array.isArray(disco()));
    ok('0 ids duplicados en todo el store',
        new Set(disco().map(c => c.id)).size === disco().length);
    ok('no queda ningún lock huérfano', !fs.existsSync(`${P.content}.lock`));
    ok('no queda ningún temporal de escritura', !fs.existsSync(`${P.content}.tmp`));

    // ── [9] Ningún otro store fue tocado ─────────────────────────────────
    console.log('\n[9] stores ajenos intactos');
    ok('users.json intacto', JSON.parse(fs.readFileSync(P.users, 'utf8')).length === 1);
    ok('groups.json intacto', JSON.parse(fs.readFileSync(P.groups, 'utf8')).length === 0);
    ok('mook_db.json no fue creado por estas rutas', !fs.existsSync(path.join(P.data, 'mook_db.json')));
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message); fail++; })
    .finally(async () => {
        for (const c of [api1, api2]) { try { c?.kill('SIGKILL'); } catch { /* ya muerto */ } }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows a veces retiene */ }
        console.log(`\ncontentStoreRmwConcurrency — PASS ${pass} / FAIL ${fail}`);
        process.exit(fail === 0 ? 0 : 1);
    });
