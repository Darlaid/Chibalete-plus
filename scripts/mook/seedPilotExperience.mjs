#!/usr/bin/env node
/**
 * seedPilotExperience.mjs — CHP-MOOK-01.
 *
 * Crea (idempotente por slug) la Experiencia piloto "Me desconecto, luego
 * existo" con su V1 publicada, según docs/product/CHP_MOOK_PILOT_DESIGN_00.md.
 * Dry-run por defecto; --apply escribe mook_db.json. LOCAL/dev — el seed
 * productivo pertenece a la unidad de release.
 *
 * Uso: node scripts/mook/seedPilotExperience.mjs [--apply] [--data-dir <dir>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    normalizeMookStore, createExperience, createDraftVersion, publishVersion,
} from '../../server/lib/experienceStore.js';

export const PILOT_SLUG = 'me-desconecto-luego-existo';
export const PILOT_BOOK = 'content-1765751139919';

export const PILOT_DEFINITION = {
    slug: PILOT_SLUG,
    title: 'Me desconecto, luego existo',
    description: 'Ruta pedagógica: toma una posición argumentada sobre tu relación con la hiperconexión, con Descartes, Kierkegaard y Simone Weil como compañía.',
    objectives: [
        'Tomar una posición argumentada sobre la propia relación con la hiperconexión',
        'Apoyarse en las tres tensiones del libro: existencia vs. aparición, multitud vs. elección, ruido vs. atención',
    ],
    // V4: los nodos se agrupan en módulos (ver moduleFor más abajo).
    nodes: [
        { id: 'n1-leer', type: 'READING', title: 'Leer: existencia vs. aparición', resourceRef: PILOT_BOOK, config: { fragmento: 'Introducción + primera tensión' } },
        {
            id: 'n2-leo', type: 'LEO', title: 'Conversar con Leo: desconectarse para existir', resourceRef: PILOT_BOOK,
            config: { objetivo: 'comprensión + conexión personal', semilla: '¿Qué significa para ti "desconectarse para existir"? ¿Cuándo sientes que apareces más de lo que existes?', minIntercambios: 3 },
        },
        {
            id: 'n3-actividad', type: 'ACTIVITY', title: 'Las tres tensiones, con tus palabras',
            config: {
                instruccion: 'Responde con tus palabras (2–4 líneas cada una).',
                preguntas: [
                    { texto: '¿Qué diferencia hay entre existir y aparecer?' },
                    { texto: '¿Qué te quita la multitud cuando decides con ella?' },
                    { texto: '¿Qué te permite la atención que el ruido no?' },
                ],
            },
        },
        {
            id: 'n4-produccion', type: 'PRODUCTION', title: 'Tu posición: ¿somos lo que mostramos?',
            config: {
                consigna: 'Escribe un texto de 150–300 palabras: ¿Somos lo que mostramos o lo que somos cuando nadie nos ve? Toma posición, da al menos 2 razones y usa al menos 1 idea del libro.',
                criterioRevision: 'posición clara + ≥2 razones + ≥1 referencia al libro',
                minPalabras: 150, maxPalabras: 300,
            },
        },
        {
            id: 'n5-cierre', type: 'ACTIVITY', title: 'Cierre: ¿qué cambió?', required: false,
            config: { instruccion: 'Reflexión final, sin calificación.', preguntas: [{ texto: '¿Qué cambió (o no) en tu forma de ver la desconexión después de esta ruta?' }] },
        },
    ],
};

/**
 * Mapping puro (testeable): asegura el piloto en el doc. Idempotente por slug.
 * `bookIdOverride` permite sembrar en entornos dev cuyo catálogo local no
 * contiene el libro productivo del piloto (la definición congelada NO cambia).
 */
export function seedPilot(doc, contentList, { bookIdOverride } = {}) {
    const bookExists = (id) => (contentList || []).some(c => c.id === id);
    if (doc.experiences.some(e => e.slug === PILOT_SLUG)) {
        return { doc, created: false, reason: 'ya existe (idempotente)' };
    }
    const bookId = bookIdOverride || PILOT_BOOK;
    if (!bookExists(bookId)) {
        return { doc, created: false, reason: `libro canónico ausente: ${bookId}` };
    }
    const nodes = PILOT_DEFINITION.nodes.map(n => (n.resourceRef ? { ...n, resourceRef: bookId } : n));
    // V4: agrupación en módulos (estructura embebida en la versión).
    const modules = [
        { id: 'm1-leer-conversar', title: 'Leer y conversar', nodes: nodes.slice(0, 2) },
        { id: 'm2-pensar-producir', title: 'Pensar y producir', nodes: nodes.slice(2) },
    ];
    const exp = createExperience(doc, { slug: PILOT_DEFINITION.slug, title: PILOT_DEFINITION.title, description: PILOT_DEFINITION.description });
    const v1 = createDraftVersion(doc, exp.id, { objectives: PILOT_DEFINITION.objectives, modules }, bookExists);
    publishVersion(doc, v1.id);
    return { doc, created: true, experienceId: exp.id, versionId: v1.id, bookId };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const dirIdx = args.indexOf('--data-dir');
    const dataDir = dirIdx >= 0 ? args[dirIdx + 1] : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    const readJson = (f, fb) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : fb);

    const bookIdx = args.indexOf('--book');
    const bookIdOverride = bookIdx >= 0 ? args[bookIdx + 1] : undefined;

    const mookPath = path.join(dataDir, 'mook_db.json');
    const doc = normalizeMookStore(readJson(mookPath, {}));
    const contentList = readJson(path.join(dataDir, 'content.json'), []);
    const out = seedPilot(doc, contentList, { bookIdOverride });

    console.log(`[MOOK-SEED] modo=${apply ? 'APPLY' : 'DRY-RUN'} dataDir=${dataDir}`);
    console.log(`[MOOK-SEED] created=${out.created}${out.reason ? ` (${out.reason})` : ''} experiencias=${doc.experiences.length} versiones=${doc.versions.length}`);
    if (apply && out.created) {
        fs.writeFileSync(mookPath, JSON.stringify(doc, null, 2));
        console.log(`[MOOK-SEED] escrito ${mookPath}`);
    }
}
