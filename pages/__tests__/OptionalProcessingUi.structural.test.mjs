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

// V8.1-PROD-02F — A5 también en el dictado a Leo (Chatbot) y comprobación fresca en la oralidad.
const bot = src('components/Chatbot.tsx');
const tl = bot.slice(bot.indexOf('const toggleListening'));
ok('Dictado a Leo: usa la consulta común de A5 (utils/voiceAuthorization.mjs)', /from '\.\.\/utils\/voiceAuthorization\.mjs'/.test(bot));
ok('Dictado a Leo: A5 se comprueba antes de crear el reconocimiento y de start()', tl.indexOf('isVoiceCaptureAllowed()') > 0 && tl.indexOf('isVoiceCaptureAllowed()') < tl.indexOf('new SpeechRecognition()') && tl.indexOf('if (!allowed) return;') < tl.indexOf('recognition.start()'));
ok('Dictado a Leo: vigila la A5 mientras escucha y corta al revocarse', /watchVoiceAuthorization\(\{ onRevoked: handleVoiceRevoked \}\)/.test(tl) && /voiceRevokedRef\.current = true/.test(bot) && /if \(voiceRevokedRef\.current\) return;/.test(bot));
ok('Dictado a Leo: sin A5 no se muestra el micrófono', /\(voiceAllowed === true \|\| isListening\) && \(/.test(bot));
ok('Dictado a Leo: la entrada escrita no depende de A5', /<input\s+type="text"/.test(bot) && !/disabled=\{[^}]*voiceAllowed/.test(bot));
ok('Dictado a Leo: no pide autorización por uso (sin confirm/prompt)', !/window\.confirm|\bconfirm\(|\bprompt\(/.test(bot));
const orlStart = orl.slice(orl.indexOf('const startRecording'));
ok('Oralidad: A5 se vuelve a consultar justo antes de getUserMedia', orlStart.indexOf('isVoiceCaptureAllowed()') > 0 && orlStart.indexOf('isVoiceCaptureAllowed()') < orlStart.indexOf('getUserMedia'));
ok('Oralidad: vigila la A5 durante la grabación y descarta el intento al revocarse', /watchVoiceAuthorization\(\{/.test(orlStart) && /voiceRevokedRef\.current = true;\s*\n\s*cleanupMedia\(\);/.test(orlStart));

const leo = src('components/LeoCompanion.tsx');
ok('Leo: mensaje claro ante A3_REQUIRED, sin mostrar el código', /res\.status === 403 && data\?\.code === 'A3_REQUIRED'/.test(leo));

console.log(`\noptional processing UI (V8.1-PROD-02B): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
