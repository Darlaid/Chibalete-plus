/**
 * ActivarCuentaDecisions.structural.test.mjs — CHP-V8.1-CLOSE-05 (DIR-V81-01).
 *
 * La pantalla de activación (único punto de vinculación) presenta decisiones
 * diferenciadas sin casillas premarcadas y envía las versiones que exige el
 * servidor, tomadas de la misma fuente.
 *
 *   node pages/__tests__/ActivarCuentaDecisions.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPTANCE_DOCUMENTS, DECISION_OPTIONS } from '../../utils/acceptanceDocuments.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'pages', 'ActivarCuenta.tsx'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server', 'privacy', 'acceptance.mjs'), 'utf8');
let pass = 0, fail = 0;
const ok = (l, c) => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l), fail++);

ok('usa la fuente única de versiones', src.includes("from '../utils/acceptanceDocuments.mjs'") && server.includes("from '../../utils/acceptanceDocuments.mjs'"));
ok('sin casillas premarcadas (ni defaultChecked ni checked={true})', !/defaultChecked|checked=\{true\}/.test(src));
for (const [name, init] of [['actingAs', "''"], ['a0', "''"], ['a1', "''"], ['a2', "''"], ['terms', 'false'], ['adultDeclared', 'false'], ['mediatorCommitment', 'false']]) {
    ok(`estado inicial sin decidir: ${name} = ${init}`, new RegExp(`\\[${name}, set\\w+\\]\\s*=\\s*useState(<[^>]+>)?\\(${init.replace(/'/g, "'")}\\)`).test(src));
}
ok('A1 y A2 son decisiones separadas en la pantalla', /name="A1"/.test(src) && /name="A2"/.test(src));
ok('A2 ofrece «No aplica» y aclara que es independiente de A1', src.includes("'not_applicable'") && /independiente de A1/.test(src));
ok('términos (002) separados de las autorizaciones (004)', /DOCS\.terms\.title/.test(src) && /DOCS\.dataNotice\.title/.test(src));
ok('el representante decide A0 y se le advierte la verificación', /name="A0"/.test(src) && /Verificaremos la representación/.test(src));
ok('el compromiso 005 aparece cuando el servidor lo pide', /required\.includes\('C005'\)/.test(src));
ok('envía las versiones exigidas', /termsVersion: DOCS\.terms\.version/.test(src) && /dataNoticeVersion: DOCS\.dataNotice\.version/.test(src) && /mediatorVersion: DOCS\.mediator\.version/.test(src));
ok('solo envía lo decidido (lo vacío no viaja)', /\.\.\.\(a1 \? \{ A1: a1 \} : \{\}\)/.test(src) && /\.\.\.\(a2 \? \{ A2: a2 \} : \{\}\)/.test(src));
ok('las opciones de la pantalla son las admitidas', ['titular', 'legal_representative'].every((v) => DECISION_OPTIONS.actingAs.includes(v) && src.includes(`'${v}'`)));
ok('versiones con formato documento@versión', Object.values(ACCEPTANCE_DOCUMENTS).every((d) => /^\d{3}@\d+(\.\d+)*$/.test(d.version)));
ok('422 muestra lo que falta', /res\.status === 422/.test(src) && /setRequired/.test(src));

console.log(`\nActivarCuenta decisiones (V8.1-CLOSE-05): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
