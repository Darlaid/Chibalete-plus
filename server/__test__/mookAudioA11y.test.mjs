/**
 * mookAudioA11y.test.mjs — CHP-MOOK-ESTAS-AQUI-02.
 *
 * Cierra las capacidades de audio pendientes del preflight:
 *   duración REAL (del elemento nativo, nunca persistida ni estimada),
 *   estados de reproducción anunciados sin confundir pausa con final,
 *   y la transcripción como alternativa textual en la página (CP-4D: sin
 *   descarga, por la política global de solo lectura).
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

const tests = [];
const test = (n, f) => tests.push([n, f]);

// ── CHP-WCAG-FIVE-SURFACES-01B — Studio: contraste de la acción y foco tras Editar ──
test('WCAG-STUDIO-01: «Crear nueva versión» usa bg-amber-700 (≥ 4.5:1 con texto blanco), nunca amber-600', () => {
    const btns = [...STUDIO.matchAll(/<button[^>]*>Crear nueva versión[^<]*<\/button>/g)].map(m => m[0]);
    assert.ok(btns.length >= 2, 'ambos botones de nueva versión presentes');
    for (const b of btns) {
        assert.ok(b.includes('bg-amber-700'), 'fondo amber-700');
        assert.ok(!b.includes('bg-amber-600'), 'sin amber-600');
    }
});
// ── CHP-WCAG-FIVE-SURFACES-01C — P2 de Runtime y Studio ──
test('WCAG-RUNTIME-01..04: anuncio de avance, contraste, enlace ≥ 24 px y jerarquía h1→h2→h3', () => {
    assert.ok(/<p role="status" aria-live="polite" className="sr-only">\{progressAnnounce\}<\/p>/.test(SRC), 'región viva del avance');
    assert.ok(/setProgressAnnounce\(`Paso completado\. \$\{done\} de \$\{route\.progress\.totalRequired\} pasos requeridos completados\.`\)/.test(SRC), 'mensaje de paso completado');
    assert.ok(/text-xs text-gray-600 dark:text-gray-400 mb-1">\{experienceTitle\} · \{moduleTitle\}/.test(SRC), 'migas con contraste');
    assert.ok(!/'text-gray-400'\}`\}>/.test(SRC), 'contador de palabras sin gray-400');
    assert.equal((SRC.match(/inline-flex items-center min-h-6">← Biblioteca/g) || []).length, 3, 'tres enlaces «← Biblioteca» con alto mínimo');
    assert.ok(/<h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100">\{detail\?\.title \?\? 'Tu ruta'\}<\/h1>/.test(SRC), 'título de la ruta es h1');
    assert.ok(/<h2 className="text-lg font-bold text-gray-800 dark:text-gray-100">\{m\.title\}<\/h2>/.test(SRC), 'módulo es h2');
    assert.ok(/<h3 tabIndex=\{-1\}/.test(SRC) && /querySelector\('h3'\)\?\.focus\?\.\(\)/.test(SRC), 'nodo es h3 y sigue enfocable');
    assert.ok(!/<h4/.test(SRC), 'sin h4 huérfanos');
});
test('WCAG-STUDIO-02/04/07: contrastes, «Añadir objetivo» ≥ 24 px y tablist con flechas', () => {
    assert.ok(/text-gray-600 dark:text-gray-400">· \{NODE_TYPE_LABEL\[n\.type\]\}/.test(STUDIO), 'tipo de nodo con contraste');
    assert.ok(/text-gray-600 dark:text-gray-400">Plantilla sugerida/.test(STUDIO), 'plantilla sugerida con contraste');
    assert.ok(/text-gray-600 dark:text-gray-300">Sin cubierta/.test(STUDIO), 'sin cubierta con contraste');
    assert.ok(/text-gray-700 dark:text-gray-200 rounded-md font-bold inline-fl/.test(STUDIO), 'Archivar del listado con contraste');
    assert.ok(/min-h-6 text-sm font-bold text-indigo-600 hover:underline">\s*<Plus size=\{14\} aria-hidden \/> Añadir objetivo/.test(STUDIO), 'Añadir objetivo con alto mínimo');
    assert.ok(/tabIndex=\{tab === k \? 0 : -1\}/.test(STUDIO), 'tabindex itinerante en las pestañas');
    assert.ok(/e\.key === 'ArrowRight'/.test(STUDIO) && /e\.key === 'ArrowLeft'/.test(STUDIO) && /e\.key === 'Home'/.test(STUDIO) && /e\.key === 'End'/.test(STUDIO), 'flechas, Inicio y Fin');
});
test('WCAG-STUDIO-03: al entrar al editor el foco va al encabezado «Editar: …»', () => {
    assert.ok(/const editorHeadingRef = useRef<HTMLHeadingElement \| null>\(null\)/.test(STUDIO), 'ref del encabezado');
    assert.ok(/useEffect\(\(\) => \{ if \(view === 'editor'\) editorHeadingRef\.current\?\.focus\(\); \}, \[view\]\)/.test(STUDIO), 'efecto de foco al cambiar a editor');
    assert.ok(/<h2 ref=\{editorHeadingRef\} tabIndex=\{-1\}/.test(STUDIO), 'h2 enfocable programáticamente');
});

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

// ── 8 a 10. Transcripción: lectura en la página, sin descarga (CP-4D) ────────
test('8. la transcripción se muestra en la página, TAL CUAL (voces y saltos)', () => {
    const i = SRC.indexOf('Ver transcripción');
    const bloque = SRC.slice(i - 400, i + 400);
    assert.ok(/<details>/.test(bloque) && /<summary/.test(bloque), 'control nativo <details>/<summary>');
    assert.ok(/whitespace-pre-line">\{node\.config\.transcripcion\}/.test(bloque), 'el texto completo, con saltos de línea');
});

test('9. CP-4D: no existe descarga de la transcripción (política global de solo lectura)', () => {
    assert.ok(!SRC.includes('Descargar transcripción'), 'sin control «Descargar transcripción»');
    assert.ok(!/downloadTranscript|transcriptFilename/.test(SRC), 'sin utilidades de descarga');
    assert.ok(!/\.download\s*=|createObjectURL/.test(SRC), 'sin enlaces de descarga generados en el cliente');
});

test('10. la alternativa textual sigue presente para AUDIO y VIDEO', () => {
    assert.ok(/node\.type === 'VIDEO' \|\| node\.type === 'AUDIO'\) && node\.config\?\.transcripcion/.test(SRC));
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

test('12. la reproducción NO emite analytics ni texto a eventos', () => {
    const util = SRC.slice(SRC.indexOf('export const NodeMediaPlayer'), SRC.indexOf('ESTAS-AQUI-01 — bitácora privada'));
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
    assert.ok(!SRC.includes('Descargar transcripción'), 'CP-4D: sin «Descargar transcripción»');
    assert.ok(/Este audio dura \$\{legible\}\. Si puedes, escucha una sola pieza a la vez\./.test(SRC),
        'microcopia de duración exacta');
    assert.ok(SRC.includes('Puedes continuar después. La pausa también forma parte del recorrido.'));
    assert.ok(SRC.includes('No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.'));
    assert.ok(/role="status" aria-live="polite"/.test(SRC), 'estados anunciados por aria-live');
    assert.ok(/aria-label=\{`Audio: \$\{node\.title\}`\}/.test(SRC), 'el audio tiene nombre accesible');
    // La transcripción se abre con un control nativo operable por teclado.
    assert.ok(/<summary[^>]*cursor-pointer">Ver transcripción<\/summary>/.test(SRC), '<summary> nativo');
});

let failed = 0;
for (const [name, fn] of tests) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log(`\nmookAudioA11y: ${tests.length - failed}/${tests.length} OK`);
if (failed) process.exit(1);
