/**
 * OptionalProcessingUi.structural.test.mjs — CHP-V8.1-PROD-02B (004 A3 / A5 en el cliente).
 * El servidor decide (registro de decisiones); el cliente solo pregunta y respeta lo decidido.
 *   node pages/__tests__/OptionalProcessingUi.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (l, c) => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l), fail++));

const act = src('pages/ActivarCuenta.tsx');
ok('ActivarCuenta: A3 y A5 empiezan sin decidir (sin opción premarcada)', /[a3, setA3]s*=s*useState<'' | 'yes' | 'no'>('')/.test(act) && /[a5, setA5]s*=s*useState<'' | 'yes' | 'no'>('')/.test(act));
ok('ActivarCuenta: A3/A5 solo se envían si se decidieron', /\.\.\.\(a3 \? \{ A3: a3 \} : \{\}\)/.test(act) && /\.\.\.\(a5 \? \{ A5: a5 \} : \{\}\)/.test(act));
ok('ActivarCuenta: las dos preguntas se muestran con Sí / No', /<Choice name="A3"/.test(act) && /<Choice name="A5"/.test(act));

const orl = src('components/OralityModal.tsx');
const gateIdx = orl.indexOf('voiceAllowed !== true');
const micIdx = orl.indexOf('getUserMedia');
ok('Oralidad: consulta el estado decidido en el servidor (/api/auth/me · voiceTranscription)', /\/api\/auth\/me/.test(orl) && /optionalProcessing\?\.voiceTranscription === true/.test(orl));
ok('Oralidad: sin A5 no abre el micrófono (la comprobación va antes de getUserMedia)', gateIdx > 0 && micIdx > gateIdx);
ok('Oralidad: fallo cerrado si no se puede comprobar', /\.catch\(\(\) => \{ if \(alive\) setVoiceAllowed\(false\); \}\)/.test(orl));

const leo = src('components/LeoCompanion.tsx');
ok('Leo: mensaje claro ante A3_REQUIRED, sin mostrar el código', /res\.status === 403 && data\?\.code === 'A3_REQUIRED'/.test(leo));

console.log(`\noptional processing UI (V8.1-PROD-02B): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
