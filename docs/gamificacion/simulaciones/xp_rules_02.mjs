/**
 * xp_rules_02.mjs — validación del candidato A7/A12. Solo memoria: sin bases ni
 * stores. Usa decideRecognition y validateApprovedRecognition reales. Los importes
 * son una propuesta sin aprobar.
 *
 *   node docs/gamificacion/simulaciones/xp_rules_02.mjs
 */
import assert from 'node:assert';
import { applyRecognition, decideRecognition, summarizeRecognition, validateApprovedRecognition } from '../../../server/gamification/recognition.mjs';

const DAY = 86_400_000;
const T0 = Date.UTC(2027, 1, 1, 15);
const cfg = ({ reading = 10, reflection = 20, ceiling = 50, xpFactors = [0.5, 0.25], windowDays = 30 } = {}) => ({
    approvalRef: 'SIMULACION',
    amounts: { xp: { reading, reflection, validated: 0, route: 0 }, pm: { reviewed: 0, validated: 0 } },
    xpCeilingPerWorkCycle: ceiling, reread: { windowDays, xpFactors, pmFactors: xpFactors.map(() => 0) },
});
const subject = { exists: true, active: true, synthetic: false };
let seq = 0;
const state = () => ({ h: [], xp: 0, skipped: 0 });
function evidence(st, config, over) {
    const d = decideRecognition({ evidence: { source: 'mook_review', userId: 'u', actorId: 'm', evidenceId: `e${++seq}`, decision: 'aprobado', workRef: 'w', at: T0, ...over },
        subject, history: st.h, config, flags: { xpEarning: true, pmEarning: false } });
    if (d.xp > 0) { st.h = applyRecognition(st.h, d); st.xp += d.xp; } else st.skipped += 1; // sin XP no hay fila
    return d;
}
const row = (c) => `| ${c.join(' | ')} |`;

assert.equal(validateApprovedRecognition(cfg()).ok, true, 'el candidato supera la validación real');

console.log('## perfiles candidato: obras x reflexiones por obra');
for (const n of [1, 5, 10, 20]) {
    const out = [1, 2, 3, 5].map((r) => { const st = state(); const c = cfg(); for (let w = 0; w < n; w++) for (let i = 0; i < r; i++) evidence(st, c, { workRef: `w${w}`, at: T0 + (w * 7 + i) * DAY }); return st.xp; });
    console.log(row([n, ...out]));
}

console.log('## alternativas: 1 obra, XP por evidencia sucesiva (hasta 5)');
for (const [name, a] of [['candidato 10/20/50', {}], ['techo 30', { ceiling: 30 }], ['techo 70', { ceiling: 70 }], ['5/10/25', { reading: 5, reflection: 10, ceiling: 25 }], ['15/30/75', { reading: 15, reflection: 30, ceiling: 75 }], ['20/20/60', { reading: 20, reflection: 20, ceiling: 60 }]]) {
    const st = state(); const c = cfg(a); const seqXp = [];
    for (let i = 0; i < 5; i++) seqXp.push(evidence(st, c, {}).xp);
    console.log(row([name, seqXp.join(' + '), st.xp, validateApprovedRecognition(c).ok]));
}

console.log('## ciclos: canal MOOK real (sin newTraversal)');
{ const st = state(); const c = cfg(); const cycles = new Set(); for (let d = 0; d < 400; d += 40) { const r = evidence(st, c, { at: T0 + d * DAY }); if (r.cycle) cycles.add(r.cycle); } console.log(row(['10 evidencias en 400 días', [...cycles].join(), st.xp])); assert.deepEqual([...cycles], [1]); }

console.log('## ciclos: con recorrido nuevo demostrado');
for (const f of [[], [0.5], [0.5, 0.25]]) {
    const st = state(); const c = cfg({ xpFactors: f }); const per = [];
    for (let i = 0; i < 4; i++) { const b = st.xp; evidence(st, c, { at: T0 + i * 40 * DAY, newTraversal: i > 0 }); per.push(st.xp - b); }
    const full = state();
    for (let i = 0; i < 4; i++) for (let r = 0; r < 500; r++) evidence(full, c, { at: T0 + i * 40 * DAY + r, newTraversal: i > 0 && r === 0 });
    console.log(row([JSON.stringify(f), per.join(' / '), full.xp, Math.max(...full.h.map((e) => e.cycle))]));
    assert.equal(full.xp, 50 * (f.length + 1), 'máximo por obra = techo × ciclos');
}

console.log('## ciclo 2 detalle [0.5,0.25]: XP por evidencia');
{ const st = state(); const c = cfg(); evidence(st, c, {}); evidence(st, c, {}); evidence(st, c, {}); const out = []; for (let i = 0; i < 7; i++) out.push(evidence(st, c, { at: T0 + 40 * DAY + i, newTraversal: i === 0 }).xp); console.log(row(out)); }

console.log('## agotados los factores');
{ const st = state(); const c = cfg(); for (let i = 0; i < 3; i++) for (let r = 0; r < 500; r++) evidence(st, c, { at: T0 + i * 40 * DAY + r, newTraversal: i > 0 && r === 0 }); const total = st.xp; const d = evidence(st, c, { at: T0 + 500 * DAY, newTraversal: true }); console.log(row([total, d.xp, d.cycle ?? '-', d.reasons.join(',')])); assert.equal(d.xp, 0); }

console.log('## ventana sin cumplir');
{ const st = state(); const c = cfg(); evidence(st, c, {}); const d = evidence(st, c, { at: T0 + 10 * DAY, newTraversal: true }); console.log(row([d.cycle, d.xp, d.reasons.join(',')])); assert.equal(d.cycle, 1); }

console.log('## comportamientos repetitivos');
{ const st = state(); const c = cfg(); for (let i = 0; i < 1000; i++) evidence(st, c, {}); console.log(row(['1000 producciones, una obra', st.xp, st.skipped])); assert.equal(st.xp, 50); }
{ const st = state(); const c = cfg(); for (const route of ['a', 'b', 'c']) for (let i = 0; i < 3; i++) evidence(st, c, { evidenceId: `${route}${i}` }); console.log(row(['3 rutas, misma obra', st.xp, st.h.filter((e) => e.act === 'reading').length])); assert.equal(st.xp, 50); }
{ const st = state(); const c = cfg(); const id = 'misma'; evidence(st, c, { evidenceId: id }); const d = evidence(st, c, { evidenceId: id }); console.log(row(['misma evidencia repetida', st.xp, d.outcome])); assert.equal(st.xp, 30); }
{ const st = state(); const c = cfg(); console.log(row(['autorrevisión', evidence(st, c, { actorId: 'u' }).xp, '-'])); }
{ const st = state(); const c = cfg(); console.log(row(['con comentarios', evidence(st, c, { decision: 'con_comentarios' }).xp, '-'])); }

console.log('## orden: lectura validada y evidencia (hipotético)');
{ const st = state(); const c = cfg(); const a = decideRecognition({ evidence: { source: 'reading_completion', userId: 'u', evidenceId: 'l', workRef: 'w', at: T0, verdict: 'plausible', modality: 'pdf' }, subject, history: st.h, config: c, flags: { xpEarning: true } }); st.h = applyRecognition(st.h, a); const b = evidence(st, c, {}); console.log(row([a.xp, b.xp, a.xp + b.xp])); assert.equal(a.xp + b.xp, 30); }

console.log('## resumen para nivel y logros, 3 producciones aprobadas en 1 obra');
{ const st = state(); const c = cfg(); for (let i = 0; i < 3; i++) evidence(st, c, {}); const s = summarizeRecognition(st.h); console.log(row([s.xp, s.works, s.reflections, s.routes])); assert.equal(s.reflections, 2); }

console.log('## máximo alcanzable del piloto: obras elegibles x techo');
for (const n of [6, 20, 60]) console.log(row([n, n * 50]));
console.log('\naserciones: todas verdes');
