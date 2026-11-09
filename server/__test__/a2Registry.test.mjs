/**
 * a2Registry.test.mjs — CHP-V8.1-CLOSE-01 (G-02).
 *
 * Registro A2 y criterio único de divulgación individual, con datos sintéticos:
 *  [1] Sí / No / pendiente / vencida / revocada / renovada (gana la última línea)
 *  [2] fallo cerrado: sin ruta, sin clave, ausente, alterado, truncado, no independiente
 *  [3] escritura: validación, acuse sin ids, nada en claro
 *  [4] criterio único: ok, pocos retenidos (agregados sobre visibles), ≥5 retenidos
 *  [5] agregados recalculados = suma del detalle visible; la caché no se toca
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/a2Registry.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as A2 from '../privacy/a2Registry.mjs';
import { clearSubjectKey, installSubjectKey } from '../gamification/subjectKey.mjs';
import { restrictSummaryToReaders } from '../analytics/groupAnalyticsSummary.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_a2_'));
const REG = path.join(tmp, 'a2.jsonl');
fs.writeFileSync(REG, '');
const env = { CHP_A2_REGISTRY: REG, GAMIFICATION_EXCLUSION_REGISTRY: path.join(tmp, 'excl.jsonl') };
const NOW = Date.parse('2026-11-09T15:00:00Z');
const put = (userId, status, extra = {}) => A2.appendA2Decision({ userId, status, requestRef: `A2-SINT-${userId}`, ...extra }, { env, now: NOW });
const allows = (u, now = NOW) => A2.a2Gate(env, now).allows(u);

try {
    section('[1] estados');
    ok('registro vacío ⇒ pendiente para todos', !allows('r1'));
    put('r1', 'granted');
    ok('A2 = Sí ⇒ permitido', allows('r1'));
    put('r2', 'denied');
    ok('A2 = No ⇒ no permitido', !allows('r2'));
    ok('sin línea (pendiente) ⇒ no permitido', !allows('r3'));
    put('r3', 'granted', { validUntil: '2026-11-09' });
    ok('vigencia inclusive el último día', allows('r3'));
    ok('vencida al día siguiente', !allows('r3', NOW + 86_400_000));
    put('r1', 'revoked');
    ok('revocada ⇒ gana la última línea', !allows('r1'));
    put('r1', 'granted');
    ok('nueva autorización tras revocar ⇒ permitido (reversible)', allows('r1'));
    ok('A2 no se infiere de nada más: id vacío o no texto ⇒ no', !allows('') && !allows(undefined) && !allows(42));

    section('[2] fallo cerrado');
    ok('sin CHP_A2_REGISTRY ⇒ UNAVAILABLE', codeOf(() => A2.a2Gate({ CHP_A2_REGISTRY: '' }, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    ok('archivo ausente ⇒ UNAVAILABLE', codeOf(() => A2.a2Gate({ CHP_A2_REGISTRY: path.join(tmp, 'nope.jsonl') }, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    ok('misma ruta que el registro de exclusiones ⇒ NOT_INDEPENDENT', codeOf(() => A2.a2Gate({ CHP_A2_REGISTRY: REG, GAMIFICATION_EXCLUSION_REGISTRY: REG }, NOW)) === 'A2_REGISTRY_NOT_INDEPENDENT');
    const good = fs.readFileSync(REG, 'utf8');
    fs.writeFileSync(REG, good.replace('"a":"denied"', '"a":"granted"'));
    ok('una línea alterada (No → Sí) ⇒ UNAVAILABLE, nunca permitido', codeOf(() => A2.a2Gate(env, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(REG, good.slice(0, -1));
    ok('última línea sin terminar ⇒ UNAVAILABLE', codeOf(() => A2.a2Gate(env, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(REG, `${good}{"s":"x","a":"granted"}\n`);
    ok('línea añadida sin MAC ⇒ UNAVAILABLE', codeOf(() => A2.a2Gate(env, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    fs.writeFileSync(REG, good);
    clearSubjectKey();
    ok('sin clave ⇒ UNAVAILABLE (también con registro vacío)', codeOf(() => A2.a2Gate(env, NOW)) === 'A2_REGISTRY_UNAVAILABLE'
        && codeOf(() => A2.a2Gate({ CHP_A2_REGISTRY: path.join(tmp, 'empty.jsonl') }, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    ok('sin clave ⇒ el criterio único no deja ver a nadie', A2.individualDisclosure(['r1'], { env, now: NOW }).status === 'unavailable'
        && A2.individualDisclosure(['r1'], { env, now: NOW }).allowed.size === 0);
    installSubjectKey('f'.repeat(64));
    ok('otra clave ⇒ los MAC no verifican ⇒ UNAVAILABLE', codeOf(() => A2.a2Gate(env, NOW)) === 'A2_REGISTRY_UNAVAILABLE');
    installSubjectKey(process.env.CHP_TEST_SUBJECT_KEY);
    ok('clave correcta de nuevo ⇒ verifica', allows('r1'));

    section('[3] escritura');
    ok('estado desconocido ⇒ INVALID_STATUS', codeOf(() => A2.appendA2Decision({ userId: 'r9', status: 'yes', requestRef: 'X-1' }, { env })) === 'INVALID_STATUS');
    ok('referencia con texto libre ⇒ INVALID_REQUEST_REF', codeOf(() => A2.appendA2Decision({ userId: 'r9', status: 'granted', requestRef: 'Ana Pérez 5B' }, { env })) === 'INVALID_REQUEST_REF');
    ok('vigencia en una negativa ⇒ INVALID_VALID_UNTIL', codeOf(() => A2.appendA2Decision({ userId: 'r9', status: 'denied', requestRef: 'X-1', validUntil: '2027-01-01' }, { env })) === 'INVALID_VALID_UNTIL');
    fs.writeFileSync(REG, good.replace('"a":"denied"', '"a":"granted"'));
    ok('no se añade a un registro que no verifica', codeOf(() => put('r9', 'granted')) === 'A2_REGISTRY_UNAVAILABLE' && !fs.readFileSync(REG, 'utf8').includes('A2-SINT-r9'));
    fs.writeFileSync(REG, good);
    const ack = put('r9', 'granted');
    ok('acuse sin id del lector', !JSON.stringify(ack).includes('r9') && ack.status === 'granted' && ack.day === '2026-11-09', JSON.stringify(ack));
    const raw = fs.readFileSync(REG, 'utf8');
    ok('el registro no contiene ids en claro', !/"r[0-9]"/.test(raw) && !/:"r\d"/.test(raw));

    section('[4] criterio único');
    const many = Array.from({ length: 12 }, (_, i) => `m${i}`);
    for (const u of many) put(u, 'granted');
    let d = A2.individualDisclosure(many, { env, now: NOW });
    ok('todos con A2 ⇒ ok, todos visibles, agregados de la cohorte', d.status === 'ok' && d.allowed.size === 12 && d.aggregateOver === 'cohort');
    put('m0', 'denied');
    d = A2.individualDisclosure(many, { env, now: NOW });
    ok('1 retenido ⇒ partial, 11 visibles, agregados SOLO de los visibles', d.status === 'partial' && d.allowed.size === 11 && !d.allowed.has('m0') && d.aggregateOver === 'allowed');
    for (const u of ['m1', 'm2', 'm3', 'm4']) put(u, 'revoked');
    d = A2.individualDisclosure(many, { env, now: NOW });
    ok(`${A2.A2_MIN_WITHHELD} retenidos ⇒ agregados de la cohorte otra vez (k)`, d.allowed.size === 7 && d.aggregateOver === 'cohort');
    d = A2.individualDisclosure(['p1', 'p2'], { env, now: NOW });
    ok('nadie con A2 ⇒ nadie visible, agregados como siempre', d.allowed.size === 0 && d.aggregateOver === 'cohort');
    d = A2.individualDisclosure(['m5', 'm5', null, 'm6'], { env, now: NOW });
    ok('ids duplicados o inválidos no cuentan', d.status === 'ok' && d.allowed.size === 2);

    section('[5] agregados recalculados');
    const reader = (userId, ms, i, b) => ({ userId, reading: { allEffectiveMs: ms, last28dEffectiveMs: ms / 2 }, leo: { interactions: i }, progress: { booksStarted: b, booksCompleted: 0, averagePercent: 0 } });
    const cached = Object.freeze({ groupId: 'g', readerCount: 3, reading: {}, leo: {}, progress: {}, tasks: { state: 'x' }, pisa: { state: 'x' },
        readers: Object.freeze([reader('a', 100, 1, 1), reader('b', 300, 0, 2), reader('c', 7, 9, 0)]) });
    const before = JSON.stringify(cached);
    const r = restrictSummaryToReaders(cached, new Set(['a', 'b']));
    ok('readers = solo los permitidos', r.readers.map((x) => x.userId).join() === 'a,b');
    ok('readerCount y sumas = las de los visibles', r.readerCount === 2 && r.reading.all.totalEffectiveMs === 400 && r.reading.all.averageEffectiveMsPerReader === 200
        && r.leo.interactions === 1 && r.progress.booksStarted === 3, JSON.stringify(r));
    ok('nada del retenido en el resultado', !JSON.stringify(r).includes('"c"') && r.leo.interactions !== 10);
    ok('el objeto de la caché no cambia', JSON.stringify(cached) === before);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
}

console.log(`\nA2 registry (V8.1-CLOSE-01 G-02): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
