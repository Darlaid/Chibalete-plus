/**
 * ttsProgressRace.test.mjs — CHP-TTS-PROGRESS-CALLBACK-RACE-01.
 *
 * Demuestra —y luego impide— que un callback de progreso TARDIO sobrescriba el
 * estado TERMINAL de un job de TTS.
 *
 * Incidente que lo motiva (04D/R10, 2026-08-26): la recuperacion del mook creo
 * 14 recursos textuales nuevos. `POST /api/content` fuerza `ttsStatus:'generando'`
 * y encola TTS para todo contenido nuevo con `texto_plano_url`. El TTS termino
 * —los 14 manifests quedaron completos— pero los 14 registros se quedaron en
 * `ttsStatus:'generando'` con `processingStatus.status:'processing'`.
 *
 * Mecanismo: cada llamada a `onProgress` lanzaba una tarea DESLIGADA
 * (fire-and-forget) que competia por `withFileLock`. Ese lock es polling con
 * reintentos cada 40 ms y SIN cola FIFO: el contendiente recien llegado prueba
 * `openSync` de inmediato, asi que el `completed` final suele ganar el lock
 * libre y un `processing` rezagado lo pisa despues. Con la cache de audio
 * caliente todos los callbacks colapsan en milisegundos y la carrera se pierde
 * de forma sistematica (en produccion: 14 de 14).
 *
 * No es la misma familia que CHP-CONTENT-STORE-RMW-01: alli se perdian
 * escrituras por releer una cache vieja DENTRO del lock (entre replicas). Aqui
 * las dos escrituras aterrizan correctamente; el problema es el ORDEN, y ocurre
 * dentro de UNA sola replica.
 *
 * Aislamiento: todo ocurre en ficheros temporales, con la cache de audio
 * sembrada a mano y las claves de proveedor vacias. NUNCA toca data/,
 * data-critical/, uploads productivos ni la red.
 *
 *   node server/__test__/ttsProgressRace.test.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_ttsrace_'));
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
fs.writeFileSync(P.users, JSON.stringify([{ id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' }], null, 2));
for (const f of [P.groups, P.schools, P.access, P.content]) fs.writeFileSync(f, '[]');
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
            SESSION_AUTH_MODE: 'off',
            // Sin proveedor real: la cache sembrada cubre todos los chunks.
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
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-2000)}`);
}

const H = { 'content-type': 'application/json', 'x-user-id': 'ADM' };
const disco = () => JSON.parse(fs.readFileSync(P.content, 'utf8'));
const registro = (id) => disco().find(c => c.id === id);

/** Siembra texto + cache de audio COMPLETA para un contenido. */
function sembrar(id, frases) {
    const rel = `${id}.txt`;
    fs.writeFileSync(path.join(P.uploads, rel), frases.join(' '));
    const audioDir = path.join(P.uploads, 'audio', id);
    fs.mkdirSync(audioDir, { recursive: true });
    const manifest = {};
    // La cache acierta POR INDICE: basta con que manifest[i].file exista y pese >0.
    // Se siembran mas entradas de las necesarias; las sobrantes no se consultan.
    for (let i = 0; i < 40; i++) {
        const nombre = `chunk_${i}_gemini.mp3`;
        fs.writeFileSync(path.join(audioDir, nombre), Buffer.from([0xff, 0xfb, 0x90, 0x00, i]));
        manifest[i] = { text: '', file: `audio/${id}/${nombre}`, index: i, provider: 'gemini', model: 'gemini-2.5-flash-preview-tts' };
    }
    fs.writeFileSync(path.join(audioDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    return `/uploads/${rel}`;
}

const crearTexto = (base, id, url) => fetch(`${base}/api/content`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
        id, titulo: `T ${id}`, tipo: 'articulo_pedagogico', standalone: false,
        texto_plano_url: url, ttsStatus: 'listo',
    }),
});

/** Espera a que el job de TTS deje de moverse (processingStatus estable). */
async function esperarQuietud(ids, msMax = 25000) {
    let previo = '';
    const limite = Date.now() + msMax;
    while (Date.now() < limite) {
        await sleep(700);
        const firma = ids.map(id => { const r = registro(id); return r ? r.ttsStatus + ':' + (r.processingStatus?.lastUpdated || '') : '-'; }).join('|');
        if (firma === previo) return true;
        previo = firma;
    }
    return false;
}

const PORT1 = 5100 + (process.pid % 120), PORT2 = PORT1 + 1;
const b1 = `http://127.0.0.1:${PORT1}`, b2 = `http://127.0.0.1:${PORT2}`;
let api1, api2;

/* ── [0] Ratchet estructural ───────────────────────────────────────────── */
function ratchetEstructural() {
    console.log('[0] ratchet estructural sobre server.js');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');

    // Firma del defecto, sin depender de longitudes: una IIFE async desligada que
    // toma el lock del catalogo. Ese es el escritor que nadie espera ni ordena.
    const escritoresSueltos = (src.match(/\(async \(\) => \{\s*try \{\s*await withFileLock\(DB_FILE/g) || []).length;
    ok('ningun escritor de estado TTS queda fire-and-forget', escritoresSueltos === 0,
        escritoresSueltos + ' escritor(es) desligado(s)');

    const catchVacios = (src.match(/catch \(e\) \{ \/\* ignore[^*]*\*\/ \}/g) || []).length;
    ok('ningun error de escritura de estado se traga en un catch vacio', catchVacios === 0,
        catchVacios + ' catch vacio(s)');

    ok('el estado terminal de TTS se persiste con espera explicita',
        /await onProgress\(/.test(src), 'no hay ningun `await onProgress(`');

    ok('los dos consumidores usan el escritor serializado',
        (src.match(/createTtsProgressWriter\(/g) || []).length === 2,
        (src.match(/createTtsProgressWriter\(/g) || []).length + ' uso(s)');
}

/* ── [1] Contrato del escritor, determinista ───────────────────────────── */
async function contratoEscritor() {
    console.log('\n[1] contrato del escritor serializado (determinista)');
    let mod = null;
    try { mod = await import('../ttsProgressWriter.js'); }
    catch { ok('existe server/ttsProgressWriter.js', false, 'modulo ausente'); return; }
    ok('existe server/ttsProgressWriter.js', typeof mod.createTtsProgressWriter === 'function');
    const crear = mod.createTtsProgressWriter;

    // orden: los progresos se aplican en el orden de llamada y `completed` cierra
    {
        const vistos = []; const errores = [];
        const w = crear({ contentId: 'x', persist: async (s) => { await sleep(5); vistos.push(s.status + ':' + s.currentSentence); }, onError: (e) => errores.push(e) });
        w({ status: 'processing', currentSentence: 1 });
        w({ status: 'processing', currentSentence: 2 });
        await w({ status: 'completed', currentSentence: 0 });
        ok('las escrituras se serializan en orden de llamada',
            vistos.join(',') === 'processing:1,processing:2,completed:0', vistos.join(','));
        ok('sin errores', errores.length === 0);
    }
    // un progreso TARDIO no revierte el estado terminal
    {
        const vistos = [];
        const w = crear({ contentId: 'x', persist: async (s) => { vistos.push(s.status); }, onError: () => {} });
        await w({ status: 'completed' });
        await w({ status: 'processing', currentSentence: 9 });
        ok('un `processing` posterior a `completed` se descarta', vistos.join(',') === 'completed', vistos.join(','));
    }
    // el estado de error tampoco se revierte
    {
        const vistos = [];
        const w = crear({ contentId: 'x', persist: async (s) => { vistos.push(s.status); }, onError: () => {} });
        await w({ status: 'error_proveedor' });
        await w({ status: 'processing' });
        ok('un `processing` posterior a un error se descarta', vistos.join(',') === 'error_proveedor', vistos.join(','));
    }
    // una regeneracion NUEVA si puede volver a `generando`
    {
        const vistos = [];
        const persist = async (s) => { vistos.push(s.status); };
        const w1 = crear({ contentId: 'x', persist, onError: () => {} });
        await w1({ status: 'completed' });
        const w2 = crear({ contentId: 'x', persist, onError: () => {} });   // job nuevo
        await w2({ status: 'processing' });
        ok('una regeneracion explicita si reabre el estado', vistos.join(',') === 'completed,processing', vistos.join(','));
    }
    // los fallos de persistencia son observables, no silenciosos
    {
        const errores = [];
        const w = crear({ contentId: 'x', persist: async () => { throw new Error('lock timeout'); }, onError: (e, s) => errores.push(s.status + '/' + e.message) });
        await w({ status: 'completed' });
        ok('un fallo de persistencia llega a onError', errores.join(',') === 'completed/lock timeout', errores.join(','));
    }
    // un fallo no rompe la cadena posterior
    {
        const vistos = []; let n = 0;
        const w = crear({ contentId: 'x', persist: async (s) => { if (++n === 1) throw new Error('x'); vistos.push(s.status); }, onError: () => {} });
        w({ status: 'processing' });
        await w({ status: 'completed' });
        ok('la cadena sobrevive a un fallo intermedio', vistos.join(',') === 'completed', vistos.join(','));
    }
}

/* ── [2] Reproduccion del incidente ────────────────────────────────────── */
async function reproduccion() {
    console.log('\n[2] 14 recursos textuales con cache caliente (el caso del mook)');
    const ids = [];
    for (let i = 0; i < 14; i++) {
        const id = `tts-race-${String(i).padStart(2, '0')}`;
        const frases = Array.from({ length: 3 + (i % 6) }, (_, k) => `Frase ${k} del recurso ${i}.`);
        const url = sembrar(id, frases);
        ids.push(id);
        const r = await crearTexto(b1, id, url);
        if (!r.ok) throw new Error(`creacion ${id} -> ${r.status}`);
        await sleep(120);
    }
    ok('14/14 registros creados', ids.every(id => !!registro(id)));
    const quieto = await esperarQuietud(ids);
    ok('los jobs de TTS terminaron (estado estable)', quieto);

    const finales = ids.map(id => registro(id));
    const listos = finales.filter(r => r.ttsStatus === 'listo').length;
    const generando = finales.filter(r => r.ttsStatus === 'generando').length;
    const conManifest = ids.filter(id => fs.existsSync(path.join(P.uploads, 'audio', id, 'manifest.json'))).length;

    ok('14/14 manifests de audio presentes', conManifest === 14, conManifest + '/14');
    ok('14/14 terminan en ttsStatus="listo"', listos === 14,
        `listo=${listos} generando=${generando} — el estado terminal fue pisado por un progreso tardio`);
    ok('ninguno queda en "generando"', generando === 0, generando + ' en generando');
    ok('processingStatus terminal es "completed"',
        finales.every(r => r.processingStatus?.status === 'completed'),
        JSON.stringify(finales.map(r => r.processingStatus?.status).filter(s => s !== 'completed').slice(0, 5)));
}

/* ── [3] No se rompe nada de lo ya protegido ───────────────────────────── */
async function noRegresion() {
    console.log('\n[3] invariantes que ya estaban protegidas');
    // dos procesos, store compartido: ni un registro perdido
    await waitHealthy(b2, api2);
    const antes = disco().length;
    for (let i = 0; i < 20; i++) {
        const base = i % 2 === 0 ? b1 : b2;
        const r = await fetch(`${base}/api/content`, {
            method: 'POST', headers: H,
            body: JSON.stringify({ id: `tts-rmw-${i}`, titulo: `RMW ${i}`, tipo: 'articulo_pedagogico', standalone: false }),
        });
        if (!r.ok) throw new Error(`rmw ${i} -> ${r.status}`);
    }
    const despues = disco();
    ok('20/20 altas desde dos procesos sobreviven', despues.length === antes + 20, `${despues.length} vs ${antes + 20}`);
    ok('0 ids duplicados', despues.length === new Set(despues.map(c => c.id)).size);
    ok('los 14 del caso anterior siguen intactos',
        Array.from({ length: 14 }, (_, i) => `tts-race-${String(i).padStart(2, '0')}`).every(id => !!registro(id)));

    // regeneracion legitima: el retry vuelve a abrir el estado
    const id = 'tts-race-00';
    const r = await fetch(`${b1}/api/content/${id}/retry`, { method: 'POST', headers: H });
    ok('el retry de TTS responde 2xx o 409', r.status < 300 || r.status === 409, String(r.status));
    if (r.status < 300) {
        await esperarQuietud([id], 20000);
        const f = registro(id);
        ok('tras una regeneracion legitima vuelve a un estado terminal',
            f.ttsStatus === 'listo' || f.ttsStatus === 'error_proveedor', f.ttsStatus);
    }

    ok('no queda ningun lock huerfano', !fs.existsSync(`${P.content}.lock`));
    ok('no queda ningun temporal de escritura', !fs.existsSync(`${P.content}.tmp`));
    ok('users.json intacto', JSON.parse(fs.readFileSync(P.users, 'utf8')).length === 1);
}

async function main() {
    ratchetEstructural();
    await contratoEscritor();
    api1 = spawnApi(PORT1);
    api2 = spawnApi(PORT2);
    await waitHealthy(b1, api1);
    await reproduccion();
    await noRegresion();
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message); fail++; })
    .finally(async () => {
        for (const c of [api1, api2]) { try { c?.kill('SIGKILL'); } catch { /* ya muerto */ } }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows a veces retiene */ }
        console.log(`\nttsProgressRace — PASS ${pass} / FAIL ${fail}`);
        process.exit(fail === 0 ? 0 : 1);
    });
