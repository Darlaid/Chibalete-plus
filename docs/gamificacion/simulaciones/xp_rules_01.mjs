/**
 * xp_rules_01.mjs — simulación de XP-RULES-01. Solo memoria: sin bases ni stores.
 * Usa decideRecognition real. Los importes son exclusivamente de simulación.
 *
 *   node docs/gamificacion/simulaciones/xp_rules_01.mjs
 */
import { decideRecognition, applyRecognition } from '../../../server/gamification/recognition.mjs';

const DAY = 86_400_000;
const T0 = Date.UTC(2027, 1, 1, 15);
const SCENARIOS = {
    conservador: { reading: 5, reflection: 10, ceiling: 25 },
    equilibrado: { reading: 10, reflection: 20, ceiling: 50 },
    generoso: { reading: 15, reflection: 30, ceiling: 75 },
};
const config = (s, xpFactors = [0.5, 0.25], windowDays = 30) => ({
    amounts: { xp: { reading: s.reading, reflection: s.reflection, validated: 0, route: 0 }, pm: { reviewed: 0, validated: 0 } },
    xpCeilingPerWorkCycle: s.ceiling, reread: { windowDays, xpFactors, pmFactors: xpFactors.map(() => 0) },
});
const subject = { exists: true, active: true, synthetic: false };
const FLAGS = { xpEarning: true, pmEarning: false };
let seq = 0;
function step(state, cfg, evidence) {
    const d = decideRecognition({ evidence: { userId: 'u', evidenceId: `e${++seq}`, ...evidence }, subject, history: state.h, config: cfg, flags: FLAGS });
    state.h = applyRecognition(state.h, d);
    state.xp += d.xp;
    return d;
}
const review = (work, day, over = {}) => ({ source: 'mook_review', actorId: 'm', decision: 'aprobado', workRef: work, at: T0 + day * DAY, ...over });
const reading = (work, day, modality) => ({ source: 'reading_completion', workRef: work, at: T0 + day * DAY, verdict: 'plausible', modality });
const fresh = () => ({ h: [], xp: 0 });

// 1. Perfiles: obras con evidencia y reflexiones por obra
function profile(s, works, share, perWork) {
    const st = fresh(); const cfg = config(s);
    const withEvidence = Math.round(works * share);
    for (let w = 0; w < withEvidence; w++) for (let r = 0; r < perWork; r++) step(st, cfg, review(`w${w}`, w * 7 + r));
    return st.xp;
}
// 2. Relectura hipotética: el canal MOOK actual no declara recorrido nuevo
function reread(s, cycles, cfg = config(s)) {
    const st = fresh();
    const out = [];
    for (let c = 0; c < cycles; c++) { const before = st.xp; step(st, cfg, review('w', c * 40, c ? { newTraversal: true } : {})); out.push(st.xp - before); }
    return { perCycle: out, total: st.xp };
}
function rereadMax(s, cycles, cfg = config(s)) {
    const st = fresh();
    for (let c = 0; c < cycles; c++) for (let r = 0; r < 30; r++) step(st, cfg, review('w', c * 40 + r / 100, r === 0 && c ? { newTraversal: true } : {}));
    return st.xp;
}
// 3. Acumulación mecánica
function spamOneWork(s, n) { const st = fresh(); const cfg = config(s); for (let i = 0; i < n; i++) step(st, cfg, review('w', 0)); return st.xp; }
function spamSameDayNoSpacing(s) { const st = fresh(); const cfg = config(s); step(st, cfg, review('w', 0)); for (let i = 0; i < 5; i++) step(st, cfg, review('w', 1, { newTraversal: true })); return st.xp; }
const selfReview = (s) => { const st = fresh(); return step(st, config(s), review('w', 0, { actorId: 'u' })).xp; };
// 4. Equidad: con telemetría frente a sin ella, según cobertura de MOOK
function equity(s, works, coverage, modality) {
    const st = fresh(); const cfg = config(s);
    for (let w = 0; w < works; w++) {
        step(st, cfg, reading(`w${w}`, w * 7, modality));
        if (w < Math.round(works * coverage)) step(st, cfg, review(`w${w}`, w * 7 + 1));
    }
    return { xp: st.xp, works: new Set(st.h.filter((e) => e.act === 'reading' && e.xp > 0).map((e) => e.workRef)).size };
}
// 5. Tope semanal hipotético: lote aprobado de una vez
function weekly(s, cap, evidences) {
    const st = fresh(); const cfg = config(s); const pending = [];
    for (let i = 0; i < evidences; i++) pending.push(`w${i}`);
    const weeks = []; let spent;
    for (let wk = 0; pending.length; wk++) {
        spent = 0;
        for (let i = 0; i < pending.length;) {
            const probe = { h: st.h, xp: 0 };
            const d = decideRecognition({ evidence: { userId: 'u', evidenceId: `w-${pending[i]}`, ...review(pending[i], wk * 7) }, subject, history: st.h, config: cfg, flags: FLAGS });
            if (spent + d.xp > cap) { i++; continue; }
            st.h = applyRecognition(st.h, d); st.xp += d.xp; spent += d.xp; pending.splice(i, 1);
        }
        weeks.push(spent);
        if (wk > 40) break;
    }
    return { weeks: weeks.length, total: st.xp };
}

const row = (cells) => `| ${cells.join(' | ')} |`;
const names = Object.keys(SCENARIOS);
console.log('## perfiles (XP total)');
for (const works of [1, 5, 10, 20]) for (const [share, perWork, label] of [[0.25, 1, 'baja'], [0.5, 1, 'media'], [1, 1, 'alta'], [1, 2, 'muy alta'], [1, 4, 'máxima']]) {
    console.log(row([works, label, ...names.map((n) => profile(SCENARIOS[n], works, share, perWork))]));
}
console.log('## relectura');
for (const n of names) { const r = reread(SCENARIOS[n], 4); console.log(row([n, r.perCycle.join(' / '), r.total, rereadMax(SCENARIOS[n], 4)])); }
console.log('## relectura factores alternativos (equilibrado, ciclo1/2/3/4, total)');
for (const f of [[0.5], [0.5, 0.25], [0.75, 0.5, 0.25], [0.25]]) { const c = config(SCENARIOS.equilibrado, f); const r = reread(SCENARIOS.equilibrado, 4, c); console.log(row([JSON.stringify(f), r.perCycle.join(' / '), r.total, rereadMax(SCENARIOS.equilibrado, 4, c)])); }
console.log('## mecánica');
for (const n of names) console.log(row([n, spamOneWork(SCENARIOS[n], 20), spamOneWork(SCENARIOS[n], 200), spamSameDayNoSpacing(SCENARIOS[n]), selfReview(SCENARIOS[n])]));
console.log('## equidad 10 obras (equilibrado)');
for (const c of [0, 0.2, 0.5, 1]) { const a = equity(SCENARIOS.equilibrado, 10, c, 'pdf'); const b = equity(SCENARIOS.equilibrado, 10, c, 'epub'); console.log(row([`${c * 100} %`, a.xp, a.works, b.xp, b.works, b.xp && a.xp ? (b.xp / a.xp).toFixed(2) : '0'])); }
console.log('## tope semanal (lote de 8 obras con una reflexión)');
for (const n of names) { const s = SCENARIOS[n]; const fp = s.reading + s.reflection; for (const mult of [2, 4]) { const r = weekly(s, s.ceiling * mult, 8); console.log(row([n, s.ceiling * mult, fp, r.weeks, r.total])); } }
console.log('## ruta (XP_RUTA) sobre 10 obras, 1 reflexión');
for (const n of names) { const s = SCENARIOS[n]; const base = profile(s, 10, 1, 1); for (const rt of [0, Math.floor(s.reading / 2), s.reading]) console.log(row([n, rt, base, base + 10 * rt, `${Math.round((10 * rt) / (base + 10 * rt) * 100)} %`])); }
