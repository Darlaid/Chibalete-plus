/**
 * mookAudioA11y.test.mjs — CHP-MOOK-ESTAS-AQUI-02.
 *
 * Cierra las capacidades de audio pendientes del preflight:
 *   duración REAL (del elemento nativo, nunca persistida ni estimada),
 *   estados de reproducción anunciados sin confundir pausa con final,
 *   y descarga REAL de la transcripción (cliente, sin endpoint).
 *
 * Las funciones puras se extraen del .tsx y se evalúan; la conducta del
 * reproductor se ejerce con un doble de `HTMLAudioElement` que reproduce el
 * MISMO cableado de listeners del componente. Los contratos estructurales se
 * verifican sobre la fuente (mismo patrón que el resto de la suite MOOK).
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { emptyMookStore, createExperience, createDraftVersion, publishVersion } from '../lib/experienceStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const SRC = readFileSync(join(root, 'pages', 'Experiencias.tsx'), 'utf8');
const STUDIO = readFileSync(join(root, 'components', 'studio', 'ExperienceStudio.tsx'), 'utf8');

// ── Extracción de las funciones puras del .tsx (sin bundler) ────────────────
function extraer(nombre) {
    const i = SRC.indexOf(`export const ${nombre} =`);
    assert.ok(i > 0, `no se encontró ${nombre}`);
    const fin = SRC.indexOf('\n};', i);
    let cuerpo = SRC.slice(i, fin + 3).replace(`export const ${nombre} =`, '');
    // se retiran las anotaciones de tipo de TS (firmas simples de estas utilidades)
    cuerpo = cuerpo
        .replace(/\(segundos: number \| null \| undefined\): string \| null/, '(segundos)')
        .replace(/\(titulo: string\): string/, '(titulo)')
        .replace(/\(texto: string, titulo: string\): void/, '(texto, titulo)');
    return cuerpo.trim().replace(/;$/, '');
}
const formatAudioDuration = eval(`(${extraer('formatAudioDuration')})`);
const transcriptFilename = eval(`(${extraer('transcriptFilename')})`);
const downloadTranscriptSrc = extraer('downloadTranscript');

const tests = [];
const test = (n, f) => tests.push([n, f]);

// ── Doble del elemento de audio: mismo cableado que NodeMediaPlayer ─────────
class FakeAudio {
    constructor() {
        this.listeners = {}; this.duration = NaN; this.currentTime = 0;
        this.ended = false; this.paused = true; this.readyState = 0;
        this.autoplay = false;
    }
    addEventListener(t, h) { (this.listeners[t] ||= []).push(h); }
    removeEventListener(t, h) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== h); }
    emit(t) { (this.listeners[t] || []).forEach(h => h()); }
    // acciones del usuario
    loadMetadata(d) { this.duration = d; this.readyState = 1; this.emit('loadedmetadata'); }
    play() { this.paused = false; this.emit('play'); }
    pause() { this.paused = true; this.emit('pause'); }
    finish() { this.ended = true; this.paused = true; this.emit('ended'); this.emit('pause'); }
}

/** Reproduce el efecto del componente: mismos handlers, mismas guardas. */
function montarPlayer(el) {
    const estado = { duracion: null, aviso: null, avisos: [] };
    const setAviso = (v) => { estado.aviso = v; if (v) estado.avisos.push(v); };
    const onMeta = () => { estado.duracion = el.duration; };
    const onPause = () => {
        if (el.ended || el.currentTime <= 0) return;
        setAviso('Puedes continuar después. La pausa también forma parte del recorrido.');
    };
    const onPlay = () => setAviso(null);
    const onEnded = () => setAviso('No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.');
    el.addEventListener('loadedmetadata', onMeta);
    el.addEventListener('pause', onPause);
    el.addEventListener('play', onPlay);
    el.addEventListener('ended', onEnded);
    if (el.readyState >= 1) estado.duracion = el.duration;
    const desmontar = () => {
        el.removeEventListener('loadedmetadata', onMeta);
        el.removeEventListener('pause', onPause);
        el.removeEventListener('play', onPlay);
        el.removeEventListener('ended', onEnded);
    };
    // texto tal como lo compone el render
    estado.texto = () => {
        const legible = formatAudioDuration(estado.duracion);
        return legible
            ? `Este audio dura ${legible}. Si puedes, escucha una sola pieza a la vez.`
            : 'Preparando la duración… Si puedes, escucha una sola pieza a la vez.';
    };
    return { estado, desmontar };
}

// ── 1. Cero autoplay ────────────────────────────────────────────────────────
test('1. el audio NUNCA lleva autoplay (ni el elemento ni una llamada a play())', () => {
    const i = SRC.indexOf('<audio');
    assert.ok(i > 0, 'existe un elemento <audio> nativo en el nodo');
    const tag = SRC.slice(i, SRC.indexOf('/>', i));
    assert.ok(!/autoplay/i.test(tag), 'el elemento no declara autoplay');
    assert.ok(/controls/.test(tag), 'controles NATIVOS presentes');
    assert.ok(/preload="metadata"/.test(tag), 'preload=metadata: se piden metadatos, no el audio entero');
    // El componente jamás inicia la reproducción por su cuenta.
    const comp = SRC.slice(SRC.indexOf('NodeMediaPlayer'), SRC.indexOf('ESTAS-AQUI-01 — bitácora privada'));
    assert.ok(!/\.play\(\)/.test(comp), 'el componente no llama a play()');
});

// ── 2 y 3. Duración real / desconocida ──────────────────────────────────────
test('2. la duración aparece SOLO después de loadedmetadata, con formato legible', () => {
    const el = new FakeAudio();
    const { estado } = montarPlayer(el);
    assert.equal(estado.duracion, null, 'antes de los metadatos no hay duración');
    el.loadMetadata(272);
    assert.equal(estado.duracion, 272);
    assert.equal(formatAudioDuration(272), '4 min 32 s');
    assert.equal(estado.texto(), 'Este audio dura 4 min 32 s. Si puedes, escucha una sola pieza a la vez.');
    // formatos legibles en los bordes
    assert.equal(formatAudioDuration(45), '45 s');
    assert.equal(formatAudioDuration(120), '2 min');
    assert.equal(formatAudioDuration(59.6), '1 min', 'el redondeo no produce «0 min 60 s»');
    assert.equal(formatAudioDuration(4840), '80 min 40 s');
});

test('3. una duración desconocida NO muestra un valor falso', () => {
    for (const v of [null, undefined, NaN, Infinity, 0, -5, 'abc']) {
        assert.equal(formatAudioDuration(v), null, `${String(v)} no produce duración`);
    }
    const el = new FakeAudio();
    const { estado } = montarPlayer(el);
    const t = estado.texto();
    assert.ok(t.includes('Preparando la duración'), 'estado neutro mientras se desconoce');
    assert.ok(!/\d+\s*(min|s)\b/.test(t.replace('una sola pieza', '')), 'no se anuncia ninguna cifra');
    // duración no finita tras metadata (stream): sigue sin inventar cifra
    el.loadMetadata(Infinity);
    assert.ok(estado.texto().includes('Preparando la duración'));
});

// ── 4 a 7. Estados de reproducción ──────────────────────────────────────────
test('4. una pausa VÁLIDA (ya empezó, no terminó) muestra la microcopia', () => {
    const el = new FakeAudio();
    const { estado } = montarPlayer(el);
    el.loadMetadata(272); el.play(); el.currentTime = 30; el.pause();
    assert.equal(estado.aviso, 'Puedes continuar después. La pausa también forma parte del recorrido.');
});

test('5. la carga inicial / navegación NO anuncian pausa', () => {
    const el = new FakeAudio();
    const { estado, desmontar } = montarPlayer(el);
    el.pause();                       // pausa espuria antes de empezar
    assert.equal(estado.aviso, null, 'sin currentTime no se anuncia pausa');
    el.loadMetadata(272);
    el.pause();                       // metadatos cargados pero nunca reproducido
    assert.equal(estado.aviso, null, 'cargar metadatos no anuncia pausa');
    // desmontaje: la pausa que el navegador dispara al descartar el elemento
    el.play(); el.currentTime = 10;
    desmontar();
    el.pause();
    assert.equal(estado.aviso, null, 'tras desmontar no se anuncia nada');
});

test('6. al terminar se anuncia la microcopia de final, no la de pausa', () => {
    const el = new FakeAudio();
    const { estado } = montarPlayer(el);
    el.loadMetadata(272); el.play(); el.currentTime = 272;
    el.finish();                      // 'ended' + el 'pause' que emiten los navegadores
    assert.equal(estado.aviso, 'No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.');
    assert.ok(!estado.avisos.some(a => a.includes('La pausa también forma parte')),
        'el final NUNCA se anuncia como pausa');
});

test('7. al terminar NO se inicia otra pieza (sin playlist ni «siguiente»)', () => {
    const comp = SRC.slice(SRC.indexOf('NodeMediaPlayer'), SRC.indexOf('ESTAS-AQUI-01 — bitácora privada'));
    const onEnded = comp.slice(comp.indexOf('const onEnded'), comp.indexOf('el.addEventListener'));
    assert.ok(/setAviso\(/.test(onEnded), 'onEnded solo anuncia');
    assert.ok(!/play\(|next|siguiente[A-Za-z]*\(|src\s*=/.test(onEnded), 'onEnded no reproduce ni cambia de fuente');
    assert.ok(!/playlist|autoNext|queue/i.test(comp), 'no hay playlist ni cola');
    // Se anuncia explícitamente que no hay reproducción automática.
    assert.ok(SRC.includes('No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.'));
});

// ── 8 a 10. Descarga de la transcripción ────────────────────────────────────
test('8. la descarga contiene EXACTAMENTE la transcripción (voces y saltos incluidos)', () => {
    const TRANSCRIPCION = 'VOZ 1: Yo estaba hablando…\nNARRACIÓN: ¿Cómo lo sabemos?\n\nVOZ 2: Mi mamá pregunta.\n';
    const capturado = {};
    const g = {
        Blob: class { constructor(parts, opts) { capturado.partes = parts; capturado.opts = opts; } },
        URL: { createObjectURL: () => 'blob:fake', revokeObjectURL: () => { } },
        document: {
            createElement: () => ({ click() { }, remove() { }, set href(v) { }, set download(v) { capturado.nombre = v; } }),
            body: { appendChild() { } },
        },
    };
    const fn = new Function('Blob', 'URL', 'document', 'transcriptFilename',
        `return (${downloadTranscriptSrc});`)(g.Blob, g.URL, g.document, transcriptFilename);
    fn(TRANSCRIPCION, 'A06. Me estás escuchando');

    assert.equal(capturado.partes.length, 1);
    assert.equal(capturado.partes[0], TRANSCRIPCION, 'byte a byte la misma transcripción');
    assert.ok(capturado.partes[0].includes('VOZ 1:') && capturado.partes[0].includes('NARRACIÓN:'), 'voces conservadas');
    assert.equal(capturado.partes[0].split('\n').length, TRANSCRIPCION.split('\n').length, 'saltos de línea conservados');
    assert.equal(capturado.opts.type, 'text/plain;charset=utf-8', 'texto plano UTF-8');
});

test('9. el filename queda saneado, es comprensible y termina en .txt', () => {
    assert.equal(transcriptFilename('A06. Me estás escuchando'), 'a06-me-estas-escuchando.txt');
    assert.equal(transcriptFilename('A07.1. Si no posteo, desaparezco'), 'a07-1-si-no-posteo-desaparezco.txt');
    assert.equal(transcriptFilename('A08. Día 1 — Una hora sin notificaciones'), 'a08-dia-1-una-hora-sin-notificaciones.txt');
    // sin separadores de ruta ni caracteres peligrosos
    for (const malicioso of ['../../etc/passwd', 'C:\\Windows\\system32', 'a/b\\c:d*e?f"g<h>i|j']) {
        const f = transcriptFilename(malicioso);
        assert.ok(!/[/\\:*?"<>|]/.test(f), `saneado: ${f}`);
        assert.ok(f.endsWith('.txt'));
    }
    assert.equal(transcriptFilename(''), 'transcripcion.txt', 'título vacío tiene respaldo');
    assert.equal(transcriptFilename('¿¡—…!?'), 'transcripcion.txt', 'título sin alfanuméricos tiene respaldo');
    assert.ok(transcriptFilename('x'.repeat(300)).length <= 84, 'longitud acotada');
});

test('10. el Object URL se revoca siempre (incluso si el click falla)', () => {
    const eventos = [];
    const Blob_ = class { constructor(p, o) { } };
    const URL_ = { createObjectURL: () => { eventos.push('create'); return 'blob:x'; }, revokeObjectURL: (u) => eventos.push('revoke:' + u) };
    const mkDoc = (clickFn) => ({
        createElement: () => ({ click: clickFn, remove() { }, set href(v) { }, set download(v) { } }),
        body: { appendChild() { } },
    });
    const build = (doc) => new Function('Blob', 'URL', 'document', 'transcriptFilename',
        `return (${downloadTranscriptSrc});`)(Blob_, URL_, doc, transcriptFilename);

    build(mkDoc(() => { }))('texto', 'titulo');
    assert.deepEqual(eventos, ['create', 'revoke:blob:x'], 'se revoca tras usarlo');

    eventos.length = 0;
    assert.throws(() => build(mkDoc(() => { throw new Error('click bloqueado'); }))('texto', 'titulo'));
    assert.ok(eventos.includes('revoke:blob:x'), 'el finally revoca aunque falle la descarga');
});

// ── 11 a 13. Renderer compartido, telemetría y gate ─────────────────────────
test('11. la preview usa el MISMO renderer (NodeShell → NodeMediaPlayer)', () => {
    assert.ok(/<NodeShell[^>]*preview/.test(STUDIO), 'la preview monta NodeShell');
    assert.ok(/userId=\{user\?\.id\}/.test(STUDIO), 'la preview pasa el actor para el preflight');
    assert.ok(/<NodeMediaPlayer node=\{node\} userId=\{userId\} \/>/.test(SRC), 'NodeShell delega en el renderer compartido');
    // No hay un segundo reproductor propio del Studio.
    assert.ok(!/<audio/.test(STUDIO), 'el Studio no define su propio <audio>');
    // Un solo <audio> en el runtime MOOK: no se duplicó el renderer.
    assert.equal((SRC.match(/<audio/g) || []).length, 1);
});

test('12. la descarga y la reproducción NO emiten analytics ni texto a eventos', () => {
    const util = SRC.slice(SRC.indexOf('export const downloadTranscript'), SRC.indexOf('ESTAS-AQUI-01 — bitácora privada'));
    for (const prohibido of ['analytics', 'trackEvent', 'emitEvent', 'sendBeacon', '/api/v1/events', 'eventTransport', 'fetch(']) {
        assert.ok(!util.includes(prohibido), `sin telemetría en el audio/descarga: ${prohibido}`);
    }
    // La transcripción jamás viaja en un payload de evento.
    assert.ok(!/transcripcion[^)]*event/i.test(SRC), 'la transcripción no se adjunta a eventos');
});

test('13. el gate TRANSCRIPTION_REQUIRED sigue intacto', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'g', title: 'Gate' });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['o'],
        modules: [{ id: 'm', title: 'M', nodes: [{ id: 'a', type: 'AUDIO', title: 'Sin transcripción', resourceRef: 'c1', config: {} }] }],
    }, () => true);
    assert.throws(() => publishVersion(doc, v.id), (e) => e.code === 'TRANSCRIPTION_REQUIRED');

    const doc2 = emptyMookStore();
    const e2 = createExperience(doc2, { slug: 'g2', title: 'Gate2' });
    const v2 = createDraftVersion(doc2, e2.id, {
        objectives: ['o'],
        modules: [{ id: 'm', title: 'M', nodes: [{ id: 'a', type: 'AUDIO', title: 'Con transcripción', resourceRef: 'c1', config: { transcripcion: 'VOZ 1: hola' } }] }],
    }, () => true);
    publishVersion(doc2, v2.id);
    assert.equal(v2.status, 'published');
});

// ── Accesibilidad y microcopias ─────────────────────────────────────────────
test('14. controles accesibles y microcopias exactas', () => {
    assert.ok(SRC.includes('Ver transcripción'), 'control «Ver transcripción»');
    assert.ok(SRC.includes('Descargar transcripción'), 'control «Descargar transcripción»');
    assert.ok(/Este audio dura \$\{legible\}\. Si puedes, escucha una sola pieza a la vez\./.test(SRC),
        'microcopia de duración exacta');
    assert.ok(SRC.includes('Puedes continuar después. La pausa también forma parte del recorrido.'));
    assert.ok(SRC.includes('No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.'));
    assert.ok(/role="status" aria-live="polite"/.test(SRC), 'estados anunciados por aria-live');
    assert.ok(/aria-label=\{`Audio: \$\{node\.title\}`\}/.test(SRC), 'el audio tiene nombre accesible');
    // El botón de descarga es un <button> nativo (operable por teclado).
    const i = SRC.indexOf('Descargar transcripción');
    const bloque = SRC.slice(i - 500, i);
    assert.ok(/<button\s+type="button"/.test(bloque), 'la descarga es un button nativo');
    // Y vive FUERA del <details>, para funcionar con la transcripción contraída.
    const detallesFin = SRC.lastIndexOf('</details>', i);
    assert.ok(detallesFin > 0 && detallesFin < i, 'el botón está fuera del <details> (funciona contraído)');
});

let failed = 0;
for (const [name, fn] of tests) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log(`\nmookAudioA11y: ${tests.length - failed}/${tests.length} OK`);
if (failed) process.exit(1);
