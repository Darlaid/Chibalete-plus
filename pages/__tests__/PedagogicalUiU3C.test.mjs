/**
 * PedagogicalUiU3C.test.mjs — CHP V9 F7-C2R-U3C.
 *
 * Interfaces de Leo del mediador e impacto de intervenciones. Dos partes:
 *   [1][2] comportamiento de `utils/pedagogicalStates.ts` (ejecutado): cada estado del servidor tiene un texto para
 *          docentes, ningún estado sin cálculo se convierte en cero, y los tres estados del impacto no se mezclan;
 *   [3][4] estructura de los paneles y de su integración: consumen los contratos de U3, no calculan indicadores, no
 *          guardan nada en el navegador, exponen estados a tecnologías de asistencia y no amplían la audiencia.
 * Las cifras y la autorización se prueban en server/__test__/pedagogicalUiHttp.test.mjs.
 *
 *   node pages/__tests__/PedagogicalUiU3C.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const code = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 300)), fail++);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_u3c_ui_'));
try {
    const out = path.join(tmp, 'states.mjs');
    await esbuild.build({ entryPoints: [path.join(ROOT, 'utils', 'pedagogicalStates.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'silent' });
    const S = await import(pathToFileURL(out).href);

    console.log('\n[1] estados de evidencia');
    ok('evidencia suficiente: sin aviso', S.describeDataState('ok') === null);
    const kinds = {
        no_activity: S.describeDataState('no_activity', 'no_activity_in_context'),
        few: S.describeDataState('insufficient', 'few_signals'),
        unverifiable: S.describeDataState('insufficient', 'unverifiable_history'),
        ledger: S.describeDataState('insufficient', 'provenance_not_recorded'),
        works: S.describeDataState('no_course_works'),
    };
    ok('cinco estados distintos, cada uno con título y explicación', new Set(Object.values(kinds).map((k) => k.kind)).size === 5 && Object.values(kinds).every((k) => k.title.length > 5 && k.body.length > 40));
    ok('«registro contextual todavía no habilitado» se nombra como tal', /Registro contextual todavía no habilitado/.test(kinds.ledger.title) && kinds.ledger.kind === 'ledger_off');
    ok('«lectura histórica no atribuible» y «curso sin obras» se nombran', /no atribuible/.test(kinds.unverifiable.title) && /sin obras/.test(kinds.works.title));
    ok('ningún estado afirma que el lector no lee', Object.values(kinds).every((k) => !/no ha leído|no lee nada|sin leer/i.test(k.title + k.body))
        && [kinds.unverifiable, kinds.ledger, kinds.works].every((k) => /(no|ni) (significa|describe|se interpreta)/i.test(k.body)));
    const leoNone = S.describeDataState('no_activity', 'no_activity_in_context', 'leo');
    ok('para Leo, «sin evidencia» habla de la evidencia de Leo, no de la lectura del lector', /Leo aún no tiene evidencia/.test(leoNone.title) && /no describe cuánto lee/i.test(leoNone.body));
    ok('ningún texto muestra un código de servidor', Object.values(kinds).concat(leoNone).every((k) => !/[a-z]+_[a-z_]+/.test(k.title + k.body)));
    const states = ['ACTIVE_PROGRESS', 'ACTIVE_NO_PROGRESS', 'ACTIVE_UNVERIFIED_HISTORY', 'NO_COURSE_WORKS', 'REGISTERED_NO_LOGIN', 'NO_GROUP', 'NO_ACCESS', 'TECH_ISSUE'];
    ok('estado del estudiante: etiqueta para docentes en los ocho estados, nunca el código', states.every((s) => !/_|[A-Z]{3,}/.test(S.studentStateLabel(s))) && S.studentStateLabel('ACTIVE_UNVERIFIED_HISTORY') === 'Lectura no atribuible al curso'
        && !/_/.test(S.studentStateLabel('ALGO_NUEVO')));
    ok('objetivos y activación en palabras de aula', S.objectiveLabel('inferential') === 'Inferencia' && S.objectiveLabel(null) === null && S.activationLabel('family') === 'Mensaje para la familia');

    console.log('\n[2] impacto: tres estados que no se mezclan');
    const pending = { data_state: 'pending', outcome_label: null, followup_due_at: Date.UTC(2026, 10, 28) };
    const insufficient = { data_state: 'insufficient', outcome_label: 'insufficient_data', reason: 'insufficient_window_evidence' };
    const calculated = { data_state: 'ok', outcome_label: 'improved' };
    ok('pendiente / insuficiente / calculado', S.impactStateOf(pending) === 'pending' && S.impactStateOf(insufficient) === 'insufficient' && S.impactStateOf(calculated) === 'calculated'
        && S.impactStateOf({ data_state: 'insufficient', outcome_label: null }) === 'insufficient');
    const fmt = () => '28 de nov';
    ok('pendiente: dice desde cuándo habrá comparación y que aún no hay resultado', /28 de nov/.test(S.describeImpactState(pending, fmt)) && /Todavía no hay resultado/.test(S.describeImpactState(pending, fmt)));
    ok('insuficiente: no afirma mejoría ni deterioro', /No se afirma mejoría ni deterioro/.test(S.describeImpactState(insufficient, fmt)));
    ok('insuficiente por lectura no atribuible o por curso sin obras: lo dice', /no puede atribuirse al curso/.test(S.describeImpactState({ ...insufficient, outcome_label: null, reason: 'unverifiable_history' }, fmt))
        && /no tiene obras asociadas/.test(S.describeImpactState({ ...insufficient, outcome_label: null, reason: 'no_course_works' }, fmt)));
    ok('un valor que el servidor no calculó es «sin dato», nunca 0', S.formatImpactValue(null, 'pct') === 'sin dato' && S.formatImpactValue(undefined, 'min') === 'sin dato' && S.formatImpactValue(NaN, 'pct') === 'sin dato');
    ok('los valores calculados se muestran como los entrega el servidor', S.formatImpactValue(2 / 7, 'pct') === '29 %' && S.formatImpactValue(1, 'pct') === '100 %' && S.formatImpactValue(0, 'pct') === '0 %' && S.formatImpactValue(80, 'min') === '80 min');
    ok('etiquetas de resultado y de estrategia', S.outcomeLabel('improved') === 'Mejoró' && S.outcomeLabel('insufficient_data') === 'Sin resultado' && S.interventionLabel('sesion_acompanada') === 'Sesión acompañada'
        && S.interventionLabel('lectura_guiada') === 'Lectura guiada');

    console.log('\n[3] paneles');
    const leo = code('components/aula-viva/LeoMediatorPanel.tsx'), impact = code('components/aula-viva/InterventionImpactPanel.tsx');
    ok('Leo consume los tres contratos de U3', /\/api\/leo\/mediator\/student\/\$\{id\}/.test(leo) && /\/api\/leo\/activation\/\$\{id\}/.test(leo) && /\/content\/\$\{encodeURIComponent\(contentId\)\}/.test(leo));
    ok('el impacto consume la ruta existente, individual y de curso', /\/api\/aula-viva\/institutional\/outcomes\/scope\/\$\{scope\.type\}\//.test(impact));
    ok('ninguno guarda datos del lector en el navegador ni envía nada', [leo, impact].every((c) => !/localStorage|sessionStorage|method: 'POST'|indexedDB/.test(c)));
    ok('ninguno abre una conversación con Leo', !/\/api\/leo\/(ask|chat|ingest|memory)/.test(leo + impact));
    ok('el estado sin evidencia sustituye al contenido (no se pintan indicadores vacíos)', /if \(state\) \{\s+return \(/.test(leo) && /data-testid="leo-state"/.test(leo));
    ok('los fallos (revocación, sesión, servicio) usan los textos institucionales, no el código del servidor', [leo, impact].every((c) => /describeInstitutionalError\(/.test(c) && /role="alert"/.test(c)));
    ok('estados anunciados a tecnologías de asistencia', [leo, impact].every((c) => /role="status"/.test(c) && /aria-labelledby=/.test(c) && /aria-label="Actualizar/.test(c)));
    ok('controles de teclado: botones reales con estado expandido y foco visible', /<button type="button" onClick=\{\(\) => toggleWork\(w\)\} aria-expanded=\{open\}/.test(leo) && /focus:ring-2/.test(leo) && /focus:ring-2/.test(impact));
    ok('tablas del impacto con encabezados de columna y de fila', /<th scope="col"/.test(impact) && /<th scope="row"/.test(impact) && /<caption/.test(impact));
    ok('el impacto del curso declara la población evaluada y el caso sin lectores habilitados', /Población evaluada:/.test(impact) && /describeNoEligibleReaders\(/.test(impact));
    ok('por estrategia: sin evidencia suficiente no se muestra un resultado', /t\.sufficient\s+\? /.test(impact) && /Evidencia insuficiente \(se necesitan al menos/.test(impact));
    ok('las cifras antes/después solo se pintan en un resultado calculado', /st === 'calculated' && r\.baseline_metrics && r\.followup_metrics/.test(impact));

    console.log('\n[4] integración');
    const aula = code('pages/AulaViva.tsx'), panel = code('components/aula-viva/StudentStatusPanel.tsx');
    ok('Leo e impacto individual viven en el detalle del estudiante de Aula Viva', /<LeoMediatorPanel studentId=\{selectedStudent\.id\}/.test(aula) && /<InterventionImpactPanel scope=\{\{ type: 'user', id: selectedStudent\.id \}\}/.test(aula));
    ok('el impacto del curso vive en la analítica del grupo', /<InterventionImpactPanel scope=\{\{ type: 'group', id: selectedGroup \}\}/.test(aula));
    ok('solo para quien media: la sesión de administración no los recibe', (aula.match(/canManageClassroom && !isAdmin && \(/g) || []).length === 2);
    ok('el panel de estado ya no muestra el código del estado', /\{studentStateLabel\(status\.state\)\}/.test(panel) && !/status\.state\.replace\(/.test(panel));
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nPedagogicalUiU3C — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
