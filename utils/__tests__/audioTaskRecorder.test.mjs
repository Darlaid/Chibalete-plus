/**
 * audioTaskRecorder.test.mjs — CHP-V8.1-PROD-02H (ciclo de vida del audio en Home).
 *
 * Ejecuta de verdad el ciclo de grabación de respuestas orales (utils/audioTaskRecorder.mjs,
 * el que usa pages/Home.tsx) con MediaRecorder, getUserMedia, URL y A5 simulados:
 *  [1] sin A5 no se inicia captura (ni getUserMedia)
 *  [2] iniciar y cerrar el modal: recorder detenido, pistas cerradas, A5 sin vigilar, sin resultado
 *  [3] cerrar el modal mientras se pide el micrófono: la pista concedida tarde se cierra
 *  [4] detener y repetir: la toma se escucha (URL viva) y se libera al borrar o regrabar
 *  [5] A5 revocada durante la grabación (vigilancia real con temporizador simulado):
 *      fragmentos descartados y ningún resultado posterior
 *  [6] salir de Home: micrófono cerrado, URL liberada, sin avisos posteriores
 *  [7] entrega: la URL se libera tras entregar; localStorage no guarda blob: de audio nuevo;
 *      entradas antiguas con blob: siguen clasificándose igual
 *  [S] estructura: Home y dataService conectan el ciclo; la entrega al servidor no cambia
 *
 *   node utils/__tests__/audioTaskRecorder.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createAudioTaskRecorder, storedSubmissionContent, isNonTextSubmissionContent, AUDIO_SUBMISSION_LOCAL_NOTE,
} from '../audioTaskRecorder.mjs';
import { watchVoiceAuthorization } from '../voiceAuthorization.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++));
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── Dobles ──────────────────────────────────────────────────────────────────
function harness({ allowed = true, holdMic = false, micError = null } = {}) {
    const h = {
        allowed, gumCalls: 0, streams: [], recorders: [], created: [], revoked: new Set(),
        states: [], micErrors: [], watches: [], intervals: new Map(), nextInterval: 1,
        pendingMic: null,
    };
    const makeStream = () => {
        const track = { stopped: 0, stop() { this.stopped += 1; } };
        const s = { track, getTracks: () => [track] };
        h.streams.push(s);
        return s;
    };
    class FakeMediaRecorder {
        constructor(stream) { this.stream = stream; this.state = 'inactive'; this.ondataavailable = null; this.onstop = null; this.stopCalls = 0; h.recorders.push(this); }
        start() { this.state = 'recording'; }
        // Como el real: tras stop() llegan (en tareas posteriores) dataavailable y luego stop.
        stop() {
            if (this.state === 'inactive') throw new Error('InvalidStateError');
            this.state = 'inactive'; this.stopCalls += 1;
            setTimeout(() => { this.ondataavailable?.({ data: { size: 3, tag: 'tail' } }); this.onstop?.(); }, 0);
        }
        emit(tag = 'chunk') { this.ondataavailable?.({ data: { size: 5, tag } }); }
    }
    class FakeBlob { constructor(parts, opts) { this.parts = parts; this.type = opts?.type; } }
    // Temporizador simulado para la vigilancia A5 real (watchVoiceAuthorization).
    const timers = {
        setInterval: (fn) => { const id = h.nextInterval++; h.intervals.set(id, fn); return id; },
        clearInterval: (id) => { h.intervals.delete(id); },
    };
    const rec = createAudioTaskRecorder({
        onChange: (st) => h.states.push(st),
        onMicError: (e) => h.micErrors.push(e),
        checkAllowed: async () => h.allowed,
        watch: (opts) => {
            const w = watchVoiceAuthorization({ ...opts, check: async () => h.allowed, intervalMs: 1000, timers });
            h.watches.push(w);
            return w;
        },
        getUserMedia: (c) => {
            h.gumCalls += 1;
            h.lastConstraints = c;
            if (micError) return Promise.reject(micError);
            if (holdMic) return new Promise((res) => { h.pendingMic = () => res(makeStream()); });
            return Promise.resolve(makeStream());
        },
        MediaRecorderCtor: FakeMediaRecorder,
        createObjectURL: (b) => { const u = `blob:http://local/${h.created.length + 1}`; h.created.push({ url: u, blob: b }); return u; },
        revokeObjectURL: (u) => { h.revoked.add(u); },
        BlobCtor: FakeBlob,
    });
    h.rec = rec;
    h.last = () => h.states[h.states.length - 1];
    h.fireIntervals = async () => { for (const fn of [...h.intervals.values()]) fn(); await tick(); };
    return h;
}

console.log('\n[1] sin A5 no se inicia captura');
{
    const h = harness({ allowed: false });
    await h.rec.start();
    ok('sin A5: getUserMedia no se llama', h.gumCalls === 0);
    ok('sin A5: no se crea MediaRecorder ni se vigila', h.recorders.length === 0 && h.watches.length === 0);
    ok('sin A5: estado bloqueado por A5, sin grabar ni URL', h.last()?.blocked === 'a5' && h.last().isRecording === false && h.last().audioUrl === null);
    h.allowed = true;
    await h.rec.start();
    ok('con A5 concedida después: la captura arranca y el aviso desaparece', h.gumCalls === 1 && h.last().isRecording === true && h.last().blocked === null);
    ok('solo se pide audio', h.lastConstraints?.audio === true && Object.keys(h.lastConstraints).length === 1);
    h.rec.dispose();
}

console.log('\n[2] iniciar y cerrar el modal');
{
    const h = harness();
    await h.rec.start();
    const r = h.recorders[0];
    r.emit('a'); r.emit('b');
    ok('grabando: un recorder, una pista y una vigilancia A5 activa', r.state === 'recording' && h.streams.length === 1 && h.intervals.size === 1);
    h.rec.reset(); // cierre del modal (X)
    ok('cerrar: MediaRecorder detenido', r.state === 'inactive' && r.stopCalls === 1);
    ok('cerrar: pistas del micrófono cerradas', h.streams[0].track.stopped >= 1);
    ok('cerrar: vigilancia A5 cancelada', h.intervals.size === 0);
    ok('cerrar: estado limpio', h.last().isRecording === false && h.last().audioUrl === null && h.last().blocked === null);
    const before = h.states.length;
    await tick(); await tick();
    ok('cerrar: dataavailable/stop tardíos no generan grabación ni URL', h.created.length === 0 && h.states.length === before);
    h.rec.reset();
    ok('cerrar dos veces no falla ni reabre nada', h.recorders[0].stopCalls === 1 && h.gumCalls === 1);
}

console.log('\n[3] cerrar mientras se pide el micrófono');
{
    const h = harness({ holdMic: true });
    const p = h.rec.start();
    await tick();
    ok('permiso pendiente: getUserMedia pedido una vez', h.gumCalls === 1 && h.pendingMic !== null);
    h.rec.reset();
    h.pendingMic();
    await p;
    ok('permiso concedido tras cerrar: la pista se cierra al instante', h.streams[0].track.stopped === 1);
    ok('permiso concedido tras cerrar: sin recorder, sin vigilancia, sin grabar', h.recorders.length === 0 && h.intervals.size === 0 && h.last().isRecording === false);
}
{
    const h = harness({ allowed: true });
    // A5 se resuelve después del cierre: no se llega a pedir el micrófono.
    let release; h.rec = createAudioTaskRecorder({ onChange: (s) => h.states.push(s), checkAllowed: () => new Promise((r) => { release = r; }),
        getUserMedia: () => { h.gumCalls += 1; return Promise.resolve({ getTracks: () => [] }); } });
    const p = h.rec.start();
    h.rec.reset(); release(true); await p;
    ok('A5 resuelta tras cerrar: no se abre el micrófono', h.gumCalls === 0);
}

console.log('\n[4] detener, escuchar y repetir');
{
    const h = harness();
    await h.rec.start();
    h.recorders[0].emit('a');
    h.rec.stop();
    ok('detener: deja de grabar y cierra pistas de inmediato', h.last().isRecording === false && h.streams[0].track.stopped >= 1);
    ok('detener: vigilancia A5 cancelada', h.intervals.size === 0);
    await tick();
    const url1 = h.last().audioUrl;
    ok('detener: la toma queda disponible como blob: local', typeof url1 === 'string' && url1.startsWith('blob:') && h.created.length === 1);
    ok('detener: la toma contiene los fragmentos grabados (incluido el último)', h.created[0].blob.parts.map((d) => d.tag).join() === 'a,tail' && h.created[0].blob.type === 'audio/webm');
    ok('reproducción válida: la URL de la toma NO se libera mientras se muestra', !h.revoked.has(url1));
    await tick();
    ok('reproducción válida: sigue viva tras más tareas', !h.revoked.has(url1) && h.last().audioUrl === url1);
    h.rec.discard(); // «Borrar y grabar de nuevo»
    ok('borrar: la URL de la toma se libera', h.revoked.has(url1) && h.last().audioUrl === null);
    await h.rec.start();
    h.recorders[1].emit('c');
    h.rec.stop(); await tick();
    const url2 = h.last().audioUrl;
    ok('repetir: nueva toma con URL distinta, viva', url2 && url2 !== url1 && !h.revoked.has(url2));
    ok('repetir: un micrófono nuevo por toma, ambos cerrados', h.streams.length === 2 && h.streams.every((s) => s.track.stopped >= 1));
    h.rec.stop(); h.rec.discard(); h.rec.discard();
    ok('repetir: stop/borrar sin grabación no fallan; la URL se libera una sola vez', h.revoked.has(url2) && h.last().audioUrl === null);
}
{
    const h = harness({ micError: new Error('NotAllowedError') });
    await h.rec.start();
    ok('micrófono denegado por el navegador: aviso de error, sin vigilancia ni grabación', h.micErrors.length === 1 && h.intervals.size === 0 && h.recorders.length === 0);
}

console.log('\n[5] A5 revocada durante la grabación');
{
    const h = harness();
    await h.rec.start();
    const r = h.recorders[0];
    r.emit('a'); r.emit('b');
    await h.fireIntervals();
    ok('A5 vigente: la vigilancia no corta', r.state === 'recording' && h.last().isRecording === true);
    h.allowed = false;
    await h.fireIntervals(); // la vigilancia real detecta la revocación
    ok('revocar: MediaRecorder detenido y pistas cerradas', r.state === 'inactive' && h.streams[0].track.stopped >= 1);
    ok('revocar: vigilancia terminada', h.intervals.size === 0);
    ok('revocar: aviso A5, sin grabar ni URL', h.last().blocked === 'a5' && h.last().isRecording === false && h.last().audioUrl === null);
    r.emit('late');
    await tick(); await tick();
    ok('revocar: fragmentos descartados y ningún resultado posterior', h.created.length === 0 && h.last().audioUrl === null);
    await h.rec.start();
    ok('tras revocar: no se vuelve a abrir el micrófono sin A5', h.gumCalls === 1 && h.last().blocked === 'a5');
}
{
    const h = harness();
    await h.rec.start();
    h.rec.stop(); await tick();
    const url = h.last().audioUrl;
    await h.rec.start();
    ok('nueva toma: la anterior se libera al empezar', h.revoked.has(url));
    h.allowed = false; await h.fireIntervals();
    ok('revocar en la segunda toma: sin URL y con aviso', h.last().audioUrl === null && h.last().blocked === 'a5' && h.created.length === 1);
}

console.log('\n[6] salir de Home');
{
    const h = harness();
    await h.rec.start();
    h.rec.dispose();
    ok('salir grabando: recorder detenido, pistas cerradas, sin vigilancia', h.recorders[0].state === 'inactive' && h.streams[0].track.stopped >= 1 && h.intervals.size === 0);
    const n = h.states.length;
    await tick(); await tick();
    ok('salir grabando: sin resultado ni avisos posteriores', h.created.length === 0 && h.states.length === n);
    await h.rec.start();
    ok('tras salir: no se puede volver a abrir el micrófono', h.gumCalls === 1);
}
{
    const h = harness();
    await h.rec.start();
    h.rec.stop(); await tick();
    const url = h.last().audioUrl;
    h.rec.dispose();
    ok('salir con una toma terminada: su URL se libera', h.revoked.has(url));
}

console.log('\n[7] entrega y localStorage');
{
    const h = harness();
    await h.rec.start();
    h.rec.stop(); await tick();
    const url = h.last().audioUrl;
    const stored = storedSubmissionContent('audio', url);
    h.rec.reset(); // Home, tras entregar
    ok('entregar: la URL se libera cuando ya no se necesita', h.revoked.has(url) && h.last().audioUrl === null);
    ok('localStorage: un audio nuevo no guarda la referencia blob:', stored === AUDIO_SUBMISSION_LOCAL_NOTE && !stored.startsWith('blob:'));
    ok('localStorage: texto, foto y video se guardan igual que antes', storedSubmissionContent('text', 'hola') === 'hola'
        && storedSubmissionContent('photo', 'blob:x/1') === 'blob:x/1' && storedSubmissionContent('video', 'blob:x/2') === 'blob:x/2'
        && storedSubmissionContent('audio', '') === '');
    ok('compatibilidad: entradas antiguas con blob: siguen fuera del recuento de texto', isNonTextSubmissionContent('blob:http://old/abc') === true);
    ok('compatibilidad: la nota de audio local tampoco cuenta como texto', isNonTextSubmissionContent(AUDIO_SUBMISSION_LOCAL_NOTE) === true);
    ok('compatibilidad: el texto sigue contando', isNonTextSubmissionContent('mi respuesta') === false && isNonTextSubmissionContent(undefined) === false);
}

console.log('\n[S] estructura');
{
    const home = src('pages/Home.tsx');
    const ds = src('services/dataService.ts');
    const modal = home.slice(home.indexOf('{/* Assignment Submission Modal */}'));
    ok('Home: la X del modal usa el cierre que corta la grabación', /<button onClick=\{closeAssignmentModal\}/.test(modal) && !/onClick=\{\(\) => setSelectedAssignment\(null\)\}/.test(home));
    ok('Home: closeAssignmentModal reinicia el ciclo antes de cerrar', /const closeAssignmentModal = \(\) => \{\s*\n\s*audioRecorderRef\.current\?\.reset\(\);\s*\n\s*setSelectedAssignment\(null\);/.test(home));
    ok('Home: «Borrar y grabar de nuevo» libera la toma', /onClick=\{discardRecording\}/.test(modal) && /discardRecording = \(\) => \{ audioRecorderRef\.current\?\.discard\(\); \}/.test(home));
    ok('Home: el estado de audio solo lo escribe el ciclo (sin setSubmissionAudioUrl suelto)', (home.match(/setSubmissionAudioUrl\(/g) || []).length === 1);
    ok('Home: el reproductor usa la toma vigente', /<audio src=\{submissionAudioUrl\} controls/.test(modal));
    const sa = ds.slice(ds.indexOf('submitAssignment(assignmentId'), ds.indexOf('private async persistSubmissionToServer'));
    ok('dataService: guarda el contenido vía storedSubmissionContent', /content: storedSubmissionContent\(assignment\.submissionType, content\)/.test(sa));
    ok('dataService: la entrega al servidor no cambia (mismo filtro sobre el contenido original)', /if \(typeof content === 'string' && !content\.startsWith\('blob:'\)\) \{\s*\n\s*this\.persistSubmissionToServer\(assignmentId, studentId, content, assignment\)/.test(sa));
    ok('ningún almacenamiento de audio nuevo (sin IndexedDB/caches/FormData en el ciclo)', !/indexedDB|caches\.|FormData|fetch\(/.test(src('utils/audioTaskRecorder.mjs').replace(/\/\*[\s\S]*?\*\//g, '')));
}

console.log(`\naudio task recorder (V8.1-PROD-02H): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
