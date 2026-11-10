/**
 * voiceAuthorizationA5.test.mjs — CHP-V8.1-PROD-02F (004 §6.3, decisión A5 en el dictado a Leo).
 *
 * Cadena completa con datos sintéticos, sin servidor HTTP:
 *   registro de decisiones (A5) → decisionGate → optionalProcessingFor → cuerpo de /api/auth/me
 *   → utils/voiceAuthorization.mjs (lo que usan Chatbot y OralityModal antes de abrir el micrófono).
 *
 *  [1] A5 Sí / No / Pendiente / Revocada / Sin verificar ⇒ micrófono solo con Sí efectiva.
 *  [2] A3 Sí con A5 No ⇒ Leo (escrito) disponible, micrófono cerrado.
 *  [3] Revocación durante la sesión ⇒ la vigilancia corta la captura una sola vez.
 *  [4] Fallo de la consulta (red, 401, JSON inválido, registro alterado) ⇒ no se abre el micrófono.
 *  [5] La vigilancia no actúa tras detenerse ni con A5 vigente, y no solapa consultas.
 *
 *   node server/__test__/voiceAuthorizationA5.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import { a2RegistryPath, grantOptional } from './helpers/testA2.mjs';

const R = await import('../privacy/a2Registry.mjs');
const A = await import('../privacy/acceptance.mjs');
const V = await import('../../utils/voiceAuthorization.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++));
const section = (t) => console.log(`\n${t}`);

const reg = a2RegistryPath();
const env = { CHP_A2_REGISTRY: reg };
const reader = (id) => ({ id, roles: ['lector'], organizationId: 'org-a', accountStatus: 'active' });

grantOptional('A5', ['r-si', 'r-rev', 'r-live']);
grantOptional('A5', ['r-no', 'r-a3si-a5no'], { status: 'denied' });
grantOptional('A5', ['r-unv'], { verification: 'unverified' });
grantOptional('A3', ['r-a3si-a5no']);
R.appendDecisions([{ subjectId: 'r-rev', kind: 'A5', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0',
    medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-SINT-A5-REV' }], { env });

/** Lo que devolvería /api/auth/me (server.js: optionalProcessing con fallo cerrado). */
const meBody = (id) => {
    let optionalProcessing;
    try { optionalProcessing = A.optionalProcessingFor(reader(id), R.decisionGate(env)); }
    catch { optionalProcessing = { leo: false, voiceTranscription: false }; }
    return { id, optionalProcessing };
};
const fetchFor = (id) => async (url, init) => {
    if (url !== '/api/auth/me' || init?.cache !== 'no-store' || init?.credentials !== 'same-origin') throw new Error(`petición inesperada ${url}`);
    return { ok: true, json: async () => meBody(id) };
};
const allowed = (id) => V.isVoiceCaptureAllowed(fetchFor(id));

section('[1] A5 Sí / No / Pendiente / Revocada / Sin verificar');
ok('A5 Sí (concedida y verificada) ⇒ micrófono permitido', (await allowed('r-si')) === true);
ok('A5 No ⇒ micrófono cerrado', (await allowed('r-no')) === false);
ok('A5 Pendiente (sin decisión) ⇒ micrófono cerrado', (await allowed('r-pend')) === false);
ok('A5 Revocada ⇒ micrófono cerrado', (await allowed('r-rev')) === false);
ok('A5 sin verificar (representante en la app) ⇒ micrófono cerrado', (await allowed('r-unv')) === false);

section('[2] A3 Sí con A5 No');
const both = meBody('r-a3si-a5no').optionalProcessing;
ok('Leo escrito disponible (leo true) y micrófono cerrado (voiceTranscription false)', both.leo === true && both.voiceTranscription === false, JSON.stringify(both));
ok('…el cliente no abre el micrófono', (await allowed('r-a3si-a5no')) === false);

section('[3] Revocación durante la sesión');
{
    const ticks = [];
    const timers = { setInterval: (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; }, clearInterval: (id) => { if (ticks[id - 1]) ticks[id - 1].cleared = true; } };
    let revoked = 0;
    ok('antes: r-live tiene A5 efectiva', (await allowed('r-live')) === true);
    const w = V.watchVoiceAuthorization({ onRevoked: () => { revoked++; }, check: () => allowed('r-live'), timers });
    ok('vigila con el intervalo por defecto', ticks.length === 1 && ticks[0].ms === V.VOICE_RECHECK_MS);
    await w.checkNow();
    ok('con A5 vigente no corta', revoked === 0 && !ticks[0].cleared);
    R.appendDecisions([{ subjectId: 'r-live', kind: 'A5', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0',
        medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-SINT-A5-LIVE' }], { env });
    await w.checkNow();
    ok('revocada en el registro ⇒ onRevoked y deja de vigilar', revoked === 1 && ticks[0].cleared === true);
    await w.checkNow();
    ok('…una sola vez', revoked === 1);
    ok('…y una nueva captura ya no se permite', (await allowed('r-live')) === false);
}

section('[4] Fallo de la consulta ⇒ no se abre el micrófono');
ok('error de red', (await V.isVoiceCaptureAllowed(async () => { throw new Error('offline'); })) === false);
ok('401 / 503', (await V.isVoiceCaptureAllowed(async () => ({ ok: false, status: 401, json: async () => ({}) }))) === false);
ok('JSON inválido', (await V.isVoiceCaptureAllowed(async () => ({ ok: true, json: async () => { throw new SyntaxError('x'); } }))) === false);
ok('respuesta sin optionalProcessing', (await V.isVoiceCaptureAllowed(async () => ({ ok: true, json: async () => ({ id: 'x' }) }))) === false);
ok('valor no booleano ("true")', (await V.isVoiceCaptureAllowed(async () => ({ ok: true, json: async () => ({ optionalProcessing: { voiceTranscription: 'true' } }) }))) === false);
{
    const saved = fs.readFileSync(reg, 'utf8');
    fs.writeFileSync(reg, saved.replace('"A5"', '"A3"'));                        // registro alterado (MAC inválida)
    ok('registro de decisiones alterado ⇒ A5 Sí ya no abre el micrófono', (await allowed('r-si')) === false);
    fs.writeFileSync(reg, saved);
    ok('…restaurado el registro, vuelve a permitirse', (await allowed('r-si')) === true);
}
{
    let revoked = 0;
    const timers = { setInterval: () => 1, clearInterval: () => {} };
    const w = V.watchVoiceAuthorization({ onRevoked: () => { revoked++; }, check: async () => { throw new Error('caída'); }, timers });
    await w.checkNow();
    ok('vigilancia: consulta que falla durante la captura ⇒ se corta', revoked === 1);
}

section('[5] Vigilancia: parada y concurrencia');
{
    let revoked = 0, calls = 0, release;
    const timers = { setInterval: () => 1, clearInterval: () => {} };
    const w = V.watchVoiceAuthorization({ onRevoked: () => { revoked++; }, check: () => { calls++; return new Promise((r) => { release = r; }); }, timers });
    const p1 = w.checkNow(); const p2 = w.checkNow();
    ok('no solapa consultas', calls === 1);
    w.stop(); release(false); await p1; await p2;
    ok('detenida antes de la respuesta ⇒ no llama a onRevoked', revoked === 0);
}

section('[6] No crea otro registro de decisiones');
{
    const kinds = R.readDecisions(env);
    const list = Array.isArray(kinds) ? kinds : (kinds?.decisions || []);
    ok('el módulo cliente no escribe en el registro (solo las altas sintéticas de esta prueba)', list.every((d) => /^AUT-SINT-/.test(d.requestRef)), JSON.stringify(list.map((d) => d.requestRef)));
    const src = fs.readFileSync(new URL('../../utils/voiceAuthorization.mjs', import.meta.url), 'utf8');
    ok('el módulo cliente solo consulta /api/auth/me (sin almacenamiento propio)', !/localStorage|sessionStorage|indexedDB|appendDecisions/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')));
}

console.log(`\nvoice A5 (V8.1-PROD-02F): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
