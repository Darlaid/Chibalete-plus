/**
 * leoEvidenceMinimization.test.mjs — CHP-LEO-EVIDENCE-DATA-MINIMIZATION-01A
 *
 * Invariante bajo prueba: leo_evidence_db.json guarda evidencia ESTRUCTURADA y
 * nunca extractos verbatim de la entrada del alumno ni de la respuesta de Leo,
 * ni sustituto alguno (longitud, hash, resumen).
 *
 * HERMÉTICO POR CONSTRUCCIÓN: la ruta del store se redirige a un directorio
 * temporal ANTES de importar el módulo (el path se resuelve al cargar). El test
 * aborta antes de cualquier escritura si la ruta efectiva cae en data/ o
 * data-critical/, y verifica que el store real conserva hash, tamaño y mtime.
 *
 *   node server/__test__/leoEvidenceMinimization.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('CHP-LEO-EVIDENCE-DATA-MINIMIZATION-01A — minimización en origen');

// ── §0: hermeticidad ANTES de importar nada ──────────────────────────────────
section('[0] hermeticidad');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_leo_evid_'));
const STORE = path.join(TMP, 'leo_evidence_db.json');
process.env.LEO_EVIDENCE_DB = STORE;

const REAL_STORE = path.join(REPO, 'data', 'leo_evidence_db.json');

// Guarda fail-closed: si la ruta efectiva no está dentro del temporal, o apunta
// a data/ o data-critical/, abortar ANTES de escribir un solo byte.
const effective = path.resolve(process.env.LEO_EVIDENCE_DB);
const insideTmp = effective.startsWith(path.resolve(TMP) + path.sep);
const touchesReal = effective.startsWith(path.join(REPO, 'data') + path.sep)
                 || effective.startsWith(path.join(REPO, 'data-critical') + path.sep);
if (!insideTmp || touchesReal) {
    console.error(`  ✗ ABORTO: ruta efectiva fuera del temporal (${effective})`);
    process.exit(1);
}
ok('ruta efectiva dentro del directorio temporal', insideTmp);
ok('ruta efectiva NO apunta a data/ ni data-critical/', !touchesReal);

// Huella del store real: hash de bytes sin inspeccionar ni imprimir contenido.
const fingerprint = (p) => {
    if (!fs.existsSync(p)) return { exists: false };
    const st = fs.statSync(p);
    return {
        exists: true,
        size: st.size,
        mtimeMs: st.mtimeMs,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
    };
};
const realBefore = fingerprint(REAL_STORE);
ok(`store real registrado (${realBefore.exists ? `${realBefore.size} B` : 'ausente'})`, true);

// Import DESPUÉS de fijar la ruta.
const svc = await import('../leoEvidenceService.js');
const { buildLeoEvidenceEntry, persistLeoEvidence, getEvidenceEntriesForUser } = svc;

const SENTINEL_IN  = 'SENTINELA-ENTRADA-DEL-ALUMNO-NO-DEBE-PERSISTIR';
const SENTINEL_OUT = 'SENTINELA-RESPUESTA-DE-LEO-NO-DEBE-PERSISTIR';

const writeStore = (entries) =>
    fs.writeFileSync(STORE, JSON.stringify({ schemaVersion: 1, entries }, null, 2));
const readStore = () => JSON.parse(fs.readFileSync(STORE, 'utf8'));
const rawStore  = () => fs.readFileSync(STORE, 'utf8');

const ALLOWED = [
    'id', 'userId', 'contentId', 'surface', 'interactionType', 'chunkIndex',
    'pedagogicalObjective', 'promptType', 'pedagogicalStage', 'difficultyLevel',
    'evidenceType', 'interpretationHint', 'icdliHasData', 'preferredSupportType',
    'interactionCountAtEvent', 'sequenceId', 'sequenceStep', 'timestamp',
];

// ── §1: el builder no produce extractos verbatim ─────────────────────────────
section('[1] el builder no construye extractos verbatim');
{
    const entry = buildLeoEvidenceEntry(
        {
            userId: 'U1', contentId: 'C1', surface: 'companion',
            interactionType: 'question', chunkIndex: 3,
            difficultyLevel: 'medio', pedagogicalStage: 'exploracion',
            readerProfile: { preferredSupportType: 'vocabulario' },
            sessionMemory: { interactionCount: 4 },
            icdliSnapshot: { hasData: true },
            payload: SENTINEL_IN,
            tituloLibro: SENTINEL_IN,
        },
        { answer: SENTINEL_OUT },
    );
    ok('la entrada construida NO tiene userInputPreview', !('userInputPreview' in entry));
    ok('la entrada construida NO tiene answerPreview',    !('answerPreview' in entry));
    const json = JSON.stringify(entry);
    ok('ningún sentinela aparece en la entrada construida',
       !json.includes(SENTINEL_IN) && !json.includes(SENTINEL_OUT));
    ok('conserva la clasificación pedagógica',  typeof entry.pedagogicalObjective === 'string');
    ok('conserva evidenceType e interpretationHint',
       typeof entry.evidenceType === 'string' && typeof entry.interpretationHint === 'string');
}

// ── §2: el writer proyecta y descarta todo lo no autorizado ──────────────────
section('[2] el writer persiste solo el contrato estructurado');
{
    writeStore([]);
    // Entrada maliciosa/heredada: trae los previews y propiedades desconocidas.
    persistLeoEvidence({
        id: 'ev_test_1', userId: 'U1', contentId: 'C1', surface: 'companion',
        interactionType: 'question', chunkIndex: 3,
        pedagogicalObjective: 'inferential', promptType: 'question',
        pedagogicalStage: 'exploracion', difficultyLevel: 'medio',
        evidenceType: 'comprension', interpretationHint: 'pista',
        icdliHasData: true, preferredSupportType: 'vocabulario',
        interactionCountAtEvent: 5, sequenceId: null, sequenceStep: null,
        timestamp: '2026-09-14T00:00:00.000Z',
        userInputPreview: SENTINEL_IN,
        answerPreview: SENTINEL_OUT,
        campoDesconocido: 'no debe persistir',
        otroCampo: { anidado: SENTINEL_IN },
    });

    const db = readStore();
    const e = db.entries[0];
    ok('se persistió exactamente 1 entrada', db.entries.length === 1);
    ok('userInputPreview NO se persistió', !('userInputPreview' in e));
    ok('answerPreview NO se persistió',    !('answerPreview' in e));
    ok('propiedad desconocida NO se persistió', !('campoDesconocido' in e));
    ok('segunda propiedad desconocida NO se persistió', !('otroCampo' in e));

    const raw = rawStore();
    ok('el sentinela de la entrada del alumno NO está en el archivo', !raw.includes(SENTINEL_IN));
    ok('el sentinela de la respuesta de Leo NO está en el archivo',  !raw.includes(SENTINEL_OUT));

    const keys = Object.keys(e).sort();
    ok(`las claves persistidas son exactamente el contrato (${keys.length})`,
       JSON.stringify(keys) === JSON.stringify([...ALLOWED].sort()));

    // Sin sustitutos: ni longitudes, ni hashes, ni resúmenes.
    const sustitutos = keys.filter(k => /len|length|hash|digest|sha|summary|resumen|excerpt|snippet|preview|text|chars/i.test(k));
    ok('no se añadió ningún sustituto (longitud/hash/resumen)', sustitutos.length === 0,
       sustitutos.join(','));

    ok('los campos estructurados conservan su valor',
       e.id === 'ev_test_1' && e.userId === 'U1' && e.contentId === 'C1'
       && e.surface === 'companion' && e.interactionType === 'question'
       && e.chunkIndex === 3 && e.pedagogicalObjective === 'inferential'
       && e.promptType === 'question' && e.pedagogicalStage === 'exploracion'
       && e.difficultyLevel === 'medio' && e.evidenceType === 'comprension'
       && e.interpretationHint === 'pista' && e.icdliHasData === true
       && e.preferredSupportType === 'vocabulario'
       && e.interactionCountAtEvent === 5 && e.sequenceId === null
       && e.sequenceStep === null && e.timestamp === '2026-09-14T00:00:00.000Z');
}

// ── §3: el histórico no se toca ──────────────────────────────────────────────
section('[3] entradas legacy intactas (esta unidad no purga)');
{
    const legacy = {
        id: 'ev_legacy', userId: 'U9', contentId: 'C9', surface: 'chatbot',
        interactionType: 'chat', chunkIndex: null,
        pedagogicalObjective: 'emotional', promptType: 'question',
        pedagogicalStage: null, difficultyLevel: 'medio',
        userInputPreview: 'texto histórico del alumno',
        answerPreview: 'respuesta histórica de Leo',
        evidenceType: 'afectiva', interpretationHint: 'pista',
        icdliHasData: false, preferredSupportType: null,
        interactionCountAtEvent: 1, sequenceId: null, sequenceStep: null,
        timestamp: '2025-01-01T00:00:00.000Z',
    };
    writeStore([legacy]);
    persistLeoEvidence({ id: 'ev_new', userId: 'U1', timestamp: '2026-09-14T00:00:00.000Z' });

    const db = readStore();
    ok('append-only: la legacy sigue primera y se añadió al final',
       db.entries.length === 2 && db.entries[0].id === 'ev_legacy' && db.entries[1].id === 'ev_new');
    ok('la entrada legacy CONSERVA userInputPreview',
       db.entries[0].userInputPreview === 'texto histórico del alumno');
    ok('la entrada legacy CONSERVA answerPreview',
       db.entries[0].answerPreview === 'respuesta histórica de Leo');
    ok('la entrada nueva no arrastró claves ausentes',
       Object.keys(db.entries[1]).sort().join(',') === 'id,timestamp,userId');
    ok('schemaVersion preservado', db.schemaVersion === 1);
}

// ── §4: recorte 2000 → 1800 intacto ──────────────────────────────────────────
section('[4] recorte por volumen intacto');
{
    const many = Array.from({ length: 2000 }, (_, i) => ({
        id: `ev_${i}`, userId: 'U1', timestamp: '2026-01-01T00:00:00.000Z',
    }));
    writeStore(many);
    persistLeoEvidence({ id: 'ev_2000', userId: 'U1', timestamp: '2026-09-14T00:00:00.000Z' });
    const db = readStore();
    ok('2001 entradas → recortado a 1800', db.entries.length === 1800);
    ok('conserva la cola (la más reciente es la nueva)', db.entries[1799].id === 'ev_2000');
    ok('descartó las más antiguas', db.entries[0].id === 'ev_201');
}

// ── §5: escritura atómica y tolerancia a fallos ──────────────────────────────
section('[5] escritura atómica y no-throw');
{
    writeStore([{ id: 'ev_keep', userId: 'U1', timestamp: '2026-01-01T00:00:00.000Z' }]);
    persistLeoEvidence({ id: 'ev_atomic', userId: 'U1', timestamp: '2026-09-14T00:00:00.000Z' });
    ok('no queda archivo .tmp tras una escritura correcta', !fs.existsSync(`${STORE}.tmp`));
    ok('el archivo resultante es JSON válido', (() => { try { readStore(); return true; } catch { return false; } })());

    // Fallo de escritura forzado: un DIRECTORIO ocupa la ruta del archivo .tmp,
    // así que writeFileSync lanza EISDIR y el servicio debe tragárselo.
    const before = fs.readFileSync(STORE);
    fs.mkdirSync(`${STORE}.tmp`);
    let threw = false;
    try { persistLeoEvidence({ id: 'ev_fail', userId: 'U1', timestamp: '2026-09-14T00:00:00.000Z' }); }
    catch { threw = true; }
    const after = fs.readFileSync(STORE);
    ok('un fallo de escritura NO lanza', threw === false);
    ok('el fixture queda byte-idéntico tras el fallo', before.equals(after));
    fs.rmdirSync(`${STORE}.tmp`);
}

// ── §6: los lectores existentes reciben el contrato estructurado ─────────────
section('[6] lectores existentes');
{
    writeStore([]);
    persistLeoEvidence({
        id: 'ev_read', userId: 'U7', contentId: 'C7', surface: 'companion',
        interactionType: 'vocab', chunkIndex: 1,
        pedagogicalObjective: 'vocabulary', promptType: 'explanation',
        pedagogicalStage: 'exploracion', difficultyLevel: 'facil',
        evidenceType: 'lexica', interpretationHint: 'pista',
        icdliHasData: false, preferredSupportType: null,
        interactionCountAtEvent: 2, sequenceId: null, sequenceStep: null,
        timestamp: '2026-09-14T00:00:00.000Z',
        userInputPreview: SENTINEL_IN, answerPreview: SENTINEL_OUT,
    });
    const rows = getEvidenceEntriesForUser('U7', 10);
    ok('el lector devuelve la entrada', rows.length === 1);
    ok('el lector NO ve previews',
       !('userInputPreview' in rows[0]) && !('answerPreview' in rows[0]));
    // Campos que leoMediatorViewService._toEvidenceSignal proyecta hoy:
    for (const f of ['timestamp', 'surface', 'contentId', 'pedagogicalObjective', 'evidenceType', 'interpretationHint']) {
        ok(`el lector conserva '${f}'`, rows[0][f] !== undefined);
    }
}

// ── §7: el default productivo de ruta no cambió ──────────────────────────────
section('[7] default productivo intacto');
{
    const src = fs.readFileSync(path.join(REPO, 'server', 'leoEvidenceService.js'), 'utf8');
    ok('el default sigue siendo ../data/leo_evidence_db.json',
       /process\.env\.LEO_EVIDENCE_DB \|\| path\.resolve\(__dirname, '\.\.\/data\/leo_evidence_db\.json'\)/.test(src));
    ok('el servicio NO menciona ya userInputPreview como campo persistido',
       !/^\s*userInputPreview,\s*$/m.test(src));
    ok('el servicio NO construye answerPreview', !/answerPreview:\s*answerClean/.test(src));
    ok('la proyección explícita existe', /_PERSISTED_FIELDS/.test(src) && /_projectEvidenceEntry/.test(src));
}

// ── §8: el store real no fue tocado ──────────────────────────────────────────
section('[8] store real intacto');
{
    const realAfter = fingerprint(REAL_STORE);
    ok('presencia del store real sin cambios', realBefore.exists === realAfter.exists);
    if (realBefore.exists) {
        ok('tamaño idéntico',  realBefore.size === realAfter.size);
        ok('mtime idéntico',   realBefore.mtimeMs === realAfter.mtimeMs);
        ok('sha256 idéntico',  realBefore.sha256 === realAfter.sha256);
    }
    const stray = fs.existsSync(`${REAL_STORE}.tmp`);
    ok('no se creó ningún .tmp junto al store real', !stray);
}

// Limpieza del temporal (nunca toca el repositorio).
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
