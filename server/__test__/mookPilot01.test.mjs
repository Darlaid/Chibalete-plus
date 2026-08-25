// CHP-MOOK-PILOT-01 — validaciones mínimas del piloto de inducción docente.
// (1) La estructura contractual del piloto (3 módulos, secuencias §17.8, transcripción
//     en nodos AUDIO, dos LEO con configuraciones distintas, producción revisable)
//     valida en el store real.
// (2) El runtime muestra la transcripción del nodo VIDEO/AUDIO (cambio mínimo de esta
//     unidad: ADR §17.4 exige la alternativa textual accesible desde el nodo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExperience, createDraftVersion, publishVersion } from '../lib/experienceStore.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = new Set(['c-texto1', 'c-audio1', 'c-texto2', 'c-texto3', 'c-audio2']);
const bookExists = (id) => CATALOG.has(id);

function pilotModules() {
    return [
        { id: 'mod1', title: 'Bienvenida y fundamentos', nodes: [
            { id: 'n1', type: 'READING', title: 'Leer', resourceRef: 'c-texto1' },
            { id: 'n2', type: 'AUDIO', title: 'Escuchar', resourceRef: 'c-audio1', config: { transcripcion: 'Transcripción exacta del guion de bienvenida.' } },
            { id: 'n3', type: 'ACTIVITY', title: 'Actividad', config: { preguntas: [{ texto: '¿Qué lugar ocupa la conversación en tu aula?' }] } },
        ] },
        { id: 'mod2', title: 'Competencias, trayectorias y mediación con Leo', nodes: [
            { id: 'n4', type: 'READING', title: 'Leer', resourceRef: 'c-texto2' },
            { id: 'n5', type: 'LEO', title: 'Conversar', config: { objetivo: 'mediación en el aula', semilla: '¿Qué pregunta haces tras leer?', minIntercambios: 3 } },
            { id: 'n6', type: 'ACTIVITY', title: 'Actividad', config: { preguntas: [{ texto: 'Rediseña una pregunta literal.' }] } },
        ] },
        { id: 'mod3', title: 'Seguimiento, evidencia y responsabilidad institucional', nodes: [
            { id: 'n7', type: 'READING', title: 'Leer', resourceRef: 'c-texto3' },
            { id: 'n8', type: 'AUDIO', title: 'Escuchar', resourceRef: 'c-audio2', config: { transcripcion: 'Transcripción exacta del guion de evidencia.' } },
            { id: 'n9', type: 'LEO', title: 'Conversar', config: { objetivo: 'leer evidencia sin calificar', semilla: 'Una respuesta descriptiva: ¿qué te dice como evidencia?', minIntercambios: 3 } },
            { id: 'n10', type: 'PRODUCTION', title: 'Producción final', config: { consigna: 'Propuesta breve de aplicación; la revisa una persona, no es una calificación.', criterioRevision: 'Revisión humana transparente; no asigna nota.', minPalabras: 120, maxPalabras: 350 } },
        ] },
    ];
}

test('piloto: la estructura contractual de 3 módulos valida y publica en el store', () => {
    const doc = { experiences: [], versions: [], runs: [], evidence: [] };
    const exp = createExperience(doc, { slug: 'piloto-induccion-docente-test', title: 'Inducción docente (test)' }, 'admin-super-1');
    const v = createDraftVersion(doc, exp.id, { objectives: ['obj1'], modules: pilotModules() }, 'admin-super-1', bookExists);
    assert.equal(v.modules.length, 3);
    const nodes = v.modules.flatMap(m => m.nodes);
    assert.equal(nodes.length, 10);
    const types = new Set(nodes.map(n => n.type));
    for (const t of ['READING', 'AUDIO', 'LEO', 'ACTIVITY', 'PRODUCTION']) assert.ok(types.has(t), `falta tipo ${t}`);
    // los dos LEO tienen configuraciones distintas y mínimo visible
    const leos = nodes.filter(n => n.type === 'LEO');
    assert.equal(leos.length, 2);
    assert.notEqual(leos[0].config.objetivo, leos[1].config.objetivo);
    assert.notEqual(leos[0].config.semilla, leos[1].config.semilla);
    leos.forEach(l => assert.equal(l.config.minIntercambios, 3));
    // todos los AUDIO llevan transcripción (gate del piloto)
    nodes.filter(n => n.type === 'AUDIO').forEach(n => assert.ok((n.config.transcripcion ?? '').length > 10, 'AUDIO sin transcripción'));
    // la producción final es textual y revisable, sin escala de calificación
    const prod = nodes.find(n => n.type === 'PRODUCTION');
    assert.ok(prod.config.consigna.includes('no es una calificación'));
    assert.equal(prod.config.minPalabras, 120);
    publishVersion(doc, v.id, 'admin-super-1');
    assert.equal(v.status, 'published');
});

test('runtime: el nodo VIDEO/AUDIO muestra la transcripción como alternativa textual', () => {
    const src = readFileSync(path.join(ROOT, 'pages', 'Experiencias.tsx'), 'utf8');
    assert.match(src, /node\.type === 'VIDEO' \|\| node\.type === 'AUDIO'/);
    assert.match(src, /config\?\.transcripcion/);
    // ESTAS-AQUI-02 renombra el control a «Ver transcripción» y añade la descarga real;
    // la intención de §17.4 (alternativa textual accesible desde el nodo) se conserva.
    assert.match(src, /Ver transcripción</);
    assert.match(src, /Descargar transcripción/);
});
