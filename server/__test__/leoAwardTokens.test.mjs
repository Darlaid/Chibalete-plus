/**
 * leoAwardTokens.test.mjs — CHP-GAMIFICACION-G0-01 (Leo).
 *
 * Verifica que el token legacy [AWARD_POINTS:n] no sobrevive en ninguna
 * respuesta de Leo y que el prompt ya no lo induce:
 *   - valores arbitrarios (grandes, negativos, decimales, texto, vacío);
 *   - variantes de espacios, mayúsculas y separadores;
 *   - varios tokens en una respuesta, token escapado y token sin cerrar;
 *   - [SAVE_VOCAB:…] e [INTERACTION_TYPE:…] quedan intactos;
 *   - leoOrchestrator: prompt sin el token y limpieza cableada en chat + dispatch.
 *
 * Cómo correr:  node server/__test__/leoAwardTokens.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripAwardPointsTokens, sanitizeLeoResult } from '../leoAwardTokens.js';
import { stripAwardPointsTokens as clientStrip, AWARD_POINTS_TOKEN_RE as CLIENT_RE } from '../../utils/leoActionTokens.mjs';
import { AWARD_POINTS_TOKEN_RE as SERVER_RE } from '../leoAwardTokens.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const noToken = (s) => !/award[\s_-]*points/i.test(s);

console.log('\n[1] valores arbitrarios y variantes');
const VARIANTS = [
    '[AWARD_POINTS: 5]', '[AWARD_POINTS:5]', '[AWARD_POINTS:99999]', '[AWARD_POINTS: -3]',
    '[AWARD_POINTS: 2.5]', '[AWARD_POINTS: cinco]', '[AWARD_POINTS:]', '[AWARD_POINTS]',
    '[ AWARD_POINTS : 10 ]', '[award_points: 7]', '[Award Points: 7]', '[AWARD-POINTS: 7]',
    '[AWARD_POINTS:\t42]', '\\[AWARD_POINTS: 5\\]', '[AWARD_POINTS: 1e9]',
];
for (const tok of VARIANTS) {
    for (const [name, fn] of [['servidor', stripAwardPointsTokens], ['cliente', clientStrip]]) {
        const out = fn(`¡Muy bien pensado!\n${tok}`);
        ok(`${name}: borra ${JSON.stringify(tok)}`, noToken(out) && out === '¡Muy bien pensado!', JSON.stringify(out));
    }
}

console.log('\n[2] respuestas con varios tokens / posiciones');
const multi = 'Inicio [AWARD_POINTS: 5] medio\n[AWARD_POINTS:500]\nfin [award_points: 1]';
ok('servidor: borra todos los tokens de una respuesta', noToken(stripAwardPointsTokens(multi)));
ok('cliente: borra todos los tokens de una respuesta', noToken(clientStrip(multi)));
ok('token sin cerrar al final se borra', noToken(stripAwardPointsTokens('Bien hecho.\n[AWARD_POINTS: 5')));
ok('token sin cerrar no se come la línea siguiente',
   stripAwardPointsTokens('A [AWARD_POINTS: 5\nB') === 'A \nB'.replace(/[ \t]+\n/, '\n'));
ok('respuesta solo-token queda vacía (el handler usa su texto por defecto)', stripAwardPointsTokens('[AWARD_POINTS: 5]') === '');
ok('texto sin token no cambia', stripAwardPointsTokens('Hola, ¿qué sentiste en esa escena?') === 'Hola, ¿qué sentiste en esa escena?');
ok('no-string se devuelve tal cual', stripAwardPointsTokens(null) === null && stripAwardPointsTokens(undefined) === undefined);
ok('regex global sin estado entre llamadas',
   noToken(stripAwardPointsTokens('[AWARD_POINTS:1]')) && noToken(stripAwardPointsTokens('x [AWARD_POINTS:2]')));

console.log('\n[3] tokens legítimos intactos');
const legit = 'Buena pregunta.\n[SAVE_VOCAB: efímero]\n[INTERACTION_TYPE:inferential]\n[AWARD_POINTS: 5]';
for (const [name, fn] of [['servidor', stripAwardPointsTokens], ['cliente', clientStrip]]) {
    const out = fn(legit);
    ok(`${name}: conserva [SAVE_VOCAB:…]`, out.includes('[SAVE_VOCAB: efímero]'));
    ok(`${name}: conserva [INTERACTION_TYPE:…]`, out.includes('[INTERACTION_TYPE:inferential]'));
    ok(`${name}: borra solo el de puntos`, noToken(out));
}

console.log('\n[4] sanitizeLeoResult');
const r = sanitizeLeoResult({ answer: 'Gran idea [AWARD_POINTS: 5]', extra: 1 });
ok('limpia answer y conserva el resto', r.answer === 'Gran idea' && r.extra === 1);
ok('resultado sin answer string se devuelve igual', sanitizeLeoResult(null) === null && sanitizeLeoResult({ a: 1 }).a === 1);

console.log('\n[5] paridad servidor/cliente');
ok('misma regex en servidor y cliente', SERVER_RE.source === CLIENT_RE.source && SERVER_RE.flags === CLIENT_RE.flags);

console.log('\n[6] leoOrchestrator (estructural)');
const orch = fs.readFileSync(path.join(HERE, '..', 'leoOrchestrator.js'), 'utf8');
const prompt = (orch.match(/function _buildChatSystemPrompt\([\s\S]+?\r?\n}\r?\n/) || [''])[0];
ok('prompt de chat localizable', prompt.length > 200);
ok('el prompt ya no contiene AWARD_POINTS', !/AWARD_POINTS/i.test(prompt));
ok('el prompt ya no ofrece puntos de magia', !/PUNTOS DE MAGIA|puntos de magia|SISTEMA DE PREMIOS/i.test(prompt));
ok('el prompt prohíbe prometer puntos o premios', /No otorgues, prometas ni menciones puntos/.test(prompt));
ok('ningún otro prompt del orquestador pide el token', !/escribe[^\n]*\[AWARD_POINTS/i.test(orch));
ok('importa el guard', /from '\.\/leoAwardTokens\.js'/.test(orch));
ok('_handleChat limpia la respuesta del modelo', /const answer = stripAwardPointsTokens\(result\.data \?\? ''\) \|\|/.test(orch));
ok('dispatchInteraction sanea toda superficie antes de evidencia y respuesta',
   /result = sanitizeLeoResult\(result\);[\s\S]+?buildLeoEvidenceEntry\(enrichedReq, result\)[\s\S]+?return result;/.test(orch));

console.log(`\nCHP-GAMIFICACION-G0-01 (Leo) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
