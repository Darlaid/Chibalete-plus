/**
 * economicEpisodes.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A1.
 *
 * Motor puro de episodios económicos multimodo. Contrato canónico:
 * docs/royalties/PLAN_GENERAL_V1_1.md §4 y docs/royalties/DECISIONES_F0C.md.
 *
 * Puro: no lee disco, no abre bases, no usa red ni reloj del sistema y no
 * muta sus argumentos. Mismas entradas ⇒ misma salida, sin importar el orden
 * de las filas.
 *
 * ENTRADA — filas con la forma de `events.db`
 * -------------------------------------------
 *   { event_id, event, mode, user_id, content_id, session_id,
 *     client_ts, server_ts, payload_json | payload }
 *
 * Solo se usan dos eventos; el resto (métricas de producto) se ignora:
 *
 *   `<mode>.session_start`  payload.econAccess = { ruleId, commercialClass } | null
 *                           (atribución que el servidor registrará en F3-A2)
 *
 *   `econ_tick`             payload = {
 *                             windowMs,          // ms de reloj cubiertos desde el tick anterior
 *                             visible,           // pestaña visible durante toda la ventana
 *                             humanSignalAgoMs,  // ms desde la última señal humana (cualquier tipo,
 *                                                //   incluidas tecnologías de apoyo); null si no hubo
 *                             firstHumanSignalAgoMs, // opcional: primera señal dentro de la ventana;
 *                                                //   con ella los huecos entre ventanas son exactos
 *                             audio: null | { playing, gesture, mediaAdvancedMs, rate, muted }
 *                           }
 *
 * REGLAS (todas parametrizadas por el rule_set)
 * ---------------------------------------------
 *  - Identidad: (usuario, contentId). El modo nunca forma parte de la clave.
 *  - Vía visual: tramos entre señales humanas consecutivas separadas por
 *    ≤ pauseExclusionSeconds, intersectados con ventanas visibles. Un hueco
 *    mayor se excluye completo.
 *  - Vía de escucha: reproducción con gesto, no silenciada y con avance del
 *    medio; NO exige visibilidad. Se acredita min(ventana, avance ÷ rate).
 *    Pasado el tope de presencia se detiene la acreditación, no la escucha.
 *  - Unión temporal: pestañas, modos y dispositivos se unen, nunca se suman.
 *  - Franjas: solo se acreditan franjas cubiertas por completo (conservador).
 *  - Simultaneidad entre obras: una franja, una obra (señal humana más
 *    reciente; empate ⇒ ninguna).
 *  - Episodio: franjas de la misma obra con huecos ≤ resumeMergeMinutes.
 *  - Cualificación: ≥ qualifyingActiveSeconds, obra elegible, usuario no
 *    excluido y acceso pagado atribuido al iniciar el episodio.
 *  - Tope diario por (usuario, obra, día contractual).
 *  - R = mediana de min(cap, minutos activos ÷ minutos esperados de la obra).
 *    El progreso NUNCA interviene.
 */

/** rs-2026-01-v1 — copia literal de DECISIONES_F0C.md §3 (sin valores de negocio pendientes). */
export const RULE_SET_RS_2026_01_V1 = Object.freeze({
    id: 'rs-2026-01-v1',
    brdShareOfIns: 0.25,
    bgpShareOfBrd: 0.30,
    blcShareOfBrd: 0.70,
    blcFallbackToBgp: true,
    scoreFormula: 'sqrt(Q) * (0.40 + 0.60 * R)',
    retentionCap: 1.0,
    retentionAggregate: 'median_qualified_episodes',
    qualifyingActiveSeconds: 45,
    equivalentProgress: 'off',
    maxQualifiedEpisodesPerUserWorkDay: 3,
    resumeMergeMinutes: 30,
    pauseExclusionSeconds: 120,
    slotSeconds: 15,
    listeningPresenceCapMinutes: 20,
    crossWorkTieBreak: 'latest_human_signal_else_none',
    proseWordsPerMinute: 200,
    timezone: 'America/Bogota',
    includedModes: Object.freeze(['pdf', 'text', 'immersive', 'a11y', 'album', 'epub']),
    anomalyMaxEpisodesPerUserDay: 6,
    anomalyMaxConcurrentDevices: 3,
    payoutThresholdCop: 50000,
    rounding: 'cop_integer_largest_remainder',
});

/** Clases comerciales pagadas (DECISIONES_F0C.md P9). `promo_authorized` solo con fondo autorizado. */
export const PAID_CLASSES = Object.freeze(['paid_b2c', 'paid_institutional']);
export const PROMO_CLASS = 'promo_authorized';
export const ECON_TICK_EVENT = 'econ_tick';

const REQUIRED_RULE_KEYS = [
    'id', 'qualifyingActiveSeconds', 'equivalentProgress', 'maxQualifiedEpisodesPerUserWorkDay',
    'resumeMergeMinutes', 'pauseExclusionSeconds', 'slotSeconds', 'listeningPresenceCapMinutes',
    'crossWorkTieBreak', 'timezone', 'includedModes', 'retentionCap', 'retentionAggregate',
    'anomalyMaxEpisodesPerUserDay', 'anomalyMaxConcurrentDevices',
];

// ── utilidades de intervalos [a, b) ─────────────────────────────────────────

function mergeIntervals(list) {
    const xs = list.filter(([a, b]) => b > a).map(([a, b]) => [a, b]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const out = [];
    for (const [a, b] of xs) {
        const last = out[out.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], b);
        else out.push([a, b]);
    }
    return out;
}

function intersectIntervals(A, B) {
    const out = [];
    let i = 0, j = 0;
    while (i < A.length && j < B.length) {
        const a = Math.max(A[i][0], B[j][0]);
        const b = Math.min(A[i][1], B[j][1]);
        if (b > a) out.push([a, b]);
        if (A[i][1] < B[j][1]) i++; else j++;
    }
    return out;
}

/** Índices de franjas completamente cubiertas por intervalos ya fusionados. */
function fullSlots(merged, slotMs) {
    const out = [];
    for (const [a, b] of merged) {
        for (let k = Math.ceil(a / slotMs); (k + 1) * slotMs <= b; k++) out.push(k);
    }
    return out;
}

const isFiniteNum = (x) => typeof x === 'number' && Number.isFinite(x);
const toMap = (x) => (x instanceof Map ? x : new Map(Object.entries(x || {})));
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function parsePayload(row) {
    if (row.payload && typeof row.payload === 'object') return row.payload;
    if (typeof row.payload_json === 'string' && row.payload_json) {
        try { const p = JSON.parse(row.payload_json); return p && typeof p === 'object' ? p : null; } catch { return null; }
    }
    return {};
}

function median(sorted) {
    const n = sorted.length;
    if (n === 0) return null;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

function makeDayOf(timezone) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return (ms) => fmt.format(new Date(ms));
}

function validateContext(ctx) {
    if (!ctx || typeof ctx !== 'object') throw new TypeError('computeEconomicEpisodes: contexto obligatorio');
    const rs = ctx.ruleSet;
    if (!rs || typeof rs !== 'object') throw new TypeError('computeEconomicEpisodes: ruleSet obligatorio');
    for (const k of REQUIRED_RULE_KEYS) {
        if (rs[k] === undefined || rs[k] === null) throw new TypeError(`computeEconomicEpisodes: ruleSet.${k} obligatorio`);
    }
    if (rs.equivalentProgress !== 'off') {
        throw new Error('computeEconomicEpisodes: equivalentProgress distinto de "off" no está aprobado (P4)');
    }
    if (rs.crossWorkTieBreak !== 'latest_human_signal_else_none') {
        throw new Error(`computeEconomicEpisodes: crossWorkTieBreak "${rs.crossWorkTieBreak}" no soportado (P5)`);
    }
    if (rs.retentionAggregate !== 'median_qualified_episodes') {
        throw new Error(`computeEconomicEpisodes: retentionAggregate "${rs.retentionAggregate}" no soportado (P2)`);
    }
    // Tolerancias de reloj: exigidas por el contrato (F0-B §4) pero sin valor
    // congelado en rs-2026-01-v1 ⇒ obligatorias y explícitas, sin defaults.
    for (const k of ['clockSkewToleranceMs', 'maxIngestDelayMs']) {
        if (!isFiniteNum(ctx[k]) || ctx[k] < 0) throw new TypeError(`computeEconomicEpisodes: ${k} obligatorio (no está en el rule_set congelado)`);
    }
    if (ctx.eligibleContentIds == null) throw new TypeError('computeEconomicEpisodes: eligibleContentIds obligatorio');
}

/**
 * @param {Array<object>} rows  filas con forma de events.db (no se mutan)
 * @param {object} ctx
 * @param {object} ctx.ruleSet                      p. ej. RULE_SET_RS_2026_01_V1
 * @param {Iterable<string>} ctx.eligibleContentIds  obras con derechos vigentes (F2-A)
 * @param {Map|object} [ctx.expectedMinutesByContent] contentId → minutos esperados (P1)
 * @param {Map|object} [ctx.excludedUsers]          userId → código de motivo (P7)
 * @param {boolean} [ctx.promoFundAuthorized=false]
 * @param {number} ctx.clockSkewToleranceMs         client_ts puede adelantarse a server_ts hasta esto
 * @param {number} ctx.maxIngestDelayMs             server_ts puede retrasarse respecto a client_ts hasta esto
 * @param {{fromDay?: string, toDay?: string}} [ctx.period] días contractuales YYYY-MM-DD inclusivos
 */
export function computeEconomicEpisodes(rows, ctx) {
    validateContext(ctx);
    const rs = ctx.ruleSet;
    const slotMs = rs.slotSeconds * 1000;
    const pauseMs = rs.pauseExclusionSeconds * 1000;
    const resumeMs = rs.resumeMergeMinutes * 60_000;
    const capMs = rs.listeningPresenceCapMinutes * 60_000;
    const modes = new Set(rs.includedModes);
    const eligible = new Set(ctx.eligibleContentIds);
    const expected = toMap(ctx.expectedMinutesByContent);
    const excluded = toMap(ctx.excludedUsers);
    const paid = new Set(ctx.promoFundAuthorized ? [...PAID_CLASSES, PROMO_CLASS] : PAID_CLASSES);
    const dayOf = makeDayOf(rs.timezone);

    // ── 1. normalización, deduplicación y descarte auditable ────────────────
    const bodyOf = (r) => (typeof r.payload_json === 'string' ? r.payload_json : JSON.stringify(r.payload ?? null));
    const ordered = [...(rows || [])].sort((a, b) =>
        (a.server_ts - b.server_ts) || (a.client_ts - b.client_ts) || cmpStr(String(a.event_id), String(b.event_id))
        || cmpStr(String(a.event), String(b.event)) || cmpStr(bodyOf(a), bodyOf(b)));
    const seen = new Set();
    const invalid = [];
    const reject = (row, reason) => invalid.push({ eventId: row.event_id == null ? null : String(row.event_id), reason });
    const sessions = new Map();
    let ignoredNonEconomic = 0;

    for (const row of ordered) {
        const isTick = row.event === ECON_TICK_EVENT;
        const isStart = typeof row.event === 'string' && row.event.endsWith('.session_start');
        if (!isTick && !isStart) { ignoredNonEconomic++; continue; }
        if (row.event_id == null || row.event_id === '') { reject(row, 'malformed'); continue; }
        if (seen.has(String(row.event_id))) { reject(row, 'duplicate_event_id'); continue; }
        seen.add(String(row.event_id));
        if (!row.user_id || !row.content_id || !row.session_id) { reject(row, 'malformed'); continue; }
        if (String(row.session_id).startsWith('legacy-')) { reject(row, 'legacy_session'); continue; }
        if (!modes.has(row.mode)) { reject(row, 'mode_not_included'); continue; }
        if (!isFiniteNum(row.client_ts) || !isFiniteNum(row.server_ts)) { reject(row, 'malformed'); continue; }
        if (row.client_ts - row.server_ts > ctx.clockSkewToleranceMs
            || row.server_ts - row.client_ts > ctx.maxIngestDelayMs) { reject(row, 'clock_out_of_bounds'); continue; }
        const payload = parsePayload(row);
        if (payload === null) { reject(row, 'malformed'); continue; }

        const key = `${row.user_id}\u0000${row.content_id}\u0000${row.session_id}`;
        let s = sessions.get(key);
        if (!s) {
            s = { userId: String(row.user_id), contentId: String(row.content_id), sessionId: String(row.session_id),
                mode: row.mode, startT: null, attribution: undefined, ticks: [] };
            sessions.set(key, s);
        }
        if (row.mode !== s.mode) { reject(row, 'session_mode_mismatch'); continue; }
        if (isStart) {
            if (s.startT !== null) { reject(row, 'duplicate_session_start'); continue; }
            s.startT = row.client_ts;
            s.attribution = payload.econAccess ?? null;
        } else {
            s.ticks.push({ t: row.client_ts, p: payload });
        }
    }

    // ── 2. intervalos acreditados por sesión técnica ────────────────────────
    const sessionList = [...sessions.values()].sort((a, b) =>
        cmpStr(a.userId, b.userId) || cmpStr(a.contentId, b.contentId) || cmpStr(a.sessionId, b.sessionId));
    for (const s of sessionList) {
        s.ticks.sort((a, b) => a.t - b.t);
        const floor = s.startT ?? -Infinity;
        const signals = [];
        const visibleWins = [];
        const windows = [];
        let prevT = floor;
        for (const { t, p } of s.ticks) {
            const w = isFiniteNum(p.windowMs) && p.windowMs > 0 ? p.windowMs : 0;
            const start = Math.max(t - w, prevT, floor);
            windows.push([start, t, p]);
            if (p.visible === true && t > start) visibleWins.push([start, t]);
            for (const ago of [p.humanSignalAgoMs, p.firstHumanSignalAgoMs]) {
                if (!isFiniteNum(ago) || ago < 0) continue;
                const sig = t - ago;
                if (sig >= floor) signals.push(sig);
            }
            prevT = t;
        }
        const S = [...new Set(signals)].sort((a, b) => a - b);
        s.signals = S;
        s.lastT = s.ticks.length ? s.ticks[s.ticks.length - 1].t : s.startT;

        // Vía visual: pares de señales con hueco ≤ pausa + cola hasta la última observación.
        const visual = [];
        for (let i = 0; i + 1 < S.length; i++) {
            if (S[i + 1] - S[i] <= pauseMs) visual.push([S[i], S[i + 1]]);
        }
        if (S.length && s.lastT != null && s.lastT - S[S.length - 1] <= pauseMs) visual.push([S[S.length - 1], s.lastT]);
        const visualCredited = intersectIntervals(mergeIntervals(visual), mergeIntervals(visibleWins));

        // Vía de escucha: sin requisito de visibilidad. Solo dentro de la
        // presencia vigente: ∪ [señal, señal + tope]. Una señal nunca acredita
        // hacia atrás.
        const presence = mergeIntervals(S.map((x) => [x, x + capMs]));
        const audioRaw = [];
        for (const [start, t, p] of windows) {
            const a = p.audio;
            if (!a || a.playing !== true || a.gesture !== true || a.muted === true) continue;
            if (!isFiniteNum(a.mediaAdvancedMs) || a.mediaAdvancedMs <= 0 || !isFiniteNum(a.rate) || a.rate <= 0) continue;
            const credit = Math.min(t - start, a.mediaAdvancedMs / a.rate);
            if (credit > 0) audioRaw.push([t - credit, t]);
        }
        const audio = intersectIntervals(mergeIntervals(audioRaw), presence);
        // Pausa de reproducción ≤ pausa contractual seguida de reanudación: cuenta.
        const audioMerged = mergeIntervals(audio);
        const audioFilled = [];
        for (const iv of audioMerged) {
            const last = audioFilled[audioFilled.length - 1];
            if (last && iv[0] - last[1] <= pauseMs) last[1] = iv[1];
            else audioFilled.push([iv[0], iv[1]]);
        }
        s.credited = mergeIntervals([...visualCredited, ...audioFilled]);
    }

    // ── 3. franjas por (usuario, obra): unión, nunca suma ───────────────────
    const works = new Map(); // `${user}\0${content}` → { userId, contentId, sessions[], slots: Map<k, {sig, mode}> }
    for (const s of sessionList) {
        const k = `${s.userId}\u0000${s.contentId}`;
        if (!works.has(k)) works.set(k, { userId: s.userId, contentId: s.contentId, sessions: [] });
        works.get(k).sessions.push(s);
    }
    const lastSignalAtOrBefore = (S, t) => { let r = -Infinity; for (const x of S) { if (x <= t) r = x; else break; } return r; };
    const userSlots = new Map(); // userId → Map<slot, Array<{workKey, sig}>>
    const concurrency = new Map(); // userId → Map<slot, sessions>
    for (const [wk, w] of works) {
        const merged = mergeIntervals(w.sessions.flatMap((s) => s.credited));
        w.slots = new Map();
        for (const k of fullSlots(merged, slotMs)) {
            const a = k * slotMs, b = a + slotMs;
            let best = null;
            let covering = 0;
            for (const s of w.sessions) {
                if (!s.credited.some(([x, y]) => x < b && y > a)) continue;
                covering++;
                const sig = lastSignalAtOrBefore(s.signals, b);
                if (!best || sig > best.sig || (sig === best.sig && cmpStr(s.mode, best.mode) < 0)) best = { sig, mode: s.mode };
            }
            w.slots.set(k, best);
            if (!userSlots.has(w.userId)) { userSlots.set(w.userId, new Map()); concurrency.set(w.userId, new Map()); }
            const us = userSlots.get(w.userId);
            if (!us.has(k)) us.set(k, []);
            us.get(k).push({ workKey: wk, sig: best.sig });
            const uc = concurrency.get(w.userId);
            uc.set(k, (uc.get(k) || 0) + covering);
        }
    }

    // ── 4. simultaneidad entre obras: una franja, una obra ──────────────────
    let crossWorkDroppedSlots = 0;
    for (const [, slotMap] of userSlots) {
        for (const [k, cands] of slotMap) {
            if (cands.length < 2) continue;
            const top = Math.max(...cands.map((c) => c.sig));
            const winners = cands.filter((c) => c.sig === top);
            for (const c of cands) {
                if (winners.length === 1 && c === winners[0]) continue;
                works.get(c.workKey).slots.delete(k);
                crossWorkDroppedSlots++;
            }
        }
    }

    // ── 5. episodios ────────────────────────────────────────────────────────
    const episodes = [];
    for (const [, w] of [...works].sort((a, b) => cmpStr(a[0], b[0]))) {
        const ks = [...w.slots.keys()].sort((a, b) => a - b);
        let cur = null;
        const flush = () => { if (cur) episodes.push(cur); cur = null; };
        for (const k of ks) {
            const a = k * slotMs;
            if (cur && a - cur.endMs <= resumeMs) {
                cur.endMs = a + slotMs; cur.slots.push(k);
            } else {
                flush();
                cur = { userId: w.userId, contentId: w.contentId, startMs: a, endMs: a + slotMs, slots: [k], w };
            }
        }
        flush();
    }

    // ── 6. cualificación, procedencia del acceso y tope diario ──────────────
    for (const e of episodes) {
        e.day = dayOf(e.startMs);
        e.activeSeconds = e.slots.length * rs.slotSeconds;
        e.modeSeconds = {};
        for (const k of e.slots) {
            const m = e.w.slots.get(k).mode;
            e.modeSeconds[m] = (e.modeSeconds[m] || 0) + rs.slotSeconds;
        }
        const reasons = [];
        if (excluded.has(e.userId)) reasons.push(`user_excluded:${excluded.get(e.userId)}`);
        if (!eligible.has(e.contentId)) reasons.push('work_not_eligible');
        if (e.activeSeconds < rs.qualifyingActiveSeconds) reasons.push('below_min_active');
        const atStart = e.w.sessions.filter((s) => s.startT !== null && s.startT <= e.startMs + slotMs && s.lastT >= e.startMs);
        const classes = atStart.map((s) => s.attribution?.commercialClass ?? null);
        e.accessClasses = [...new Set(classes.map((c) => c ?? 'unattributed'))].sort();
        if (!classes.some((c) => paid.has(c))) {
            reasons.push(classes.some((c) => c !== null) ? 'access_not_paid' : 'access_unattributed');
        }
        e.reasons = reasons;
        e.flags = [];
    }
    const capGroups = new Map();
    for (const e of episodes) {
        if (e.reasons.length) continue;
        const g = `${e.userId}\u0000${e.contentId}\u0000${e.day}`;
        if (!capGroups.has(g)) capGroups.set(g, []);
        capGroups.get(g).push(e);
    }
    for (const list of capGroups.values()) {
        list.sort((a, b) => a.startMs - b.startMs);
        list.forEach((e, i) => { if (i >= rs.maxQualifiedEpisodesPerUserWorkDay) e.reasons.push('daily_cap'); });
    }
    for (const e of episodes) e.qualified = e.reasons.length === 0;

    // ── 7. anomalías: se señalan, nunca excluyen (P12) ──────────────────────
    const perUserDay = new Map();
    for (const e of episodes) {
        const g = `${e.userId}\u0000${e.day}`;
        perUserDay.set(g, (perUserDay.get(g) || 0) + 1);
    }
    for (const e of episodes) {
        if (perUserDay.get(`${e.userId}\u0000${e.day}`) > rs.anomalyMaxEpisodesPerUserDay) e.flags.push('anomaly_episodes_per_day');
        const uc = concurrency.get(e.userId);
        if (e.slots.some((k) => (uc.get(k) || 0) > rs.anomalyMaxConcurrentDevices)) e.flags.push('anomaly_concurrency');
    }

    // ── 8. Q y R por obra (sin identificadores de lectores) ─────────────────
    const inPeriod = (d) => (!ctx.period?.fromDay || d >= ctx.period.fromDay) && (!ctx.period?.toDay || d <= ctx.period.toDay);
    const workAgg = new Map();
    for (const e of episodes) {
        if (!inPeriod(e.day)) continue;
        if (!workAgg.has(e.contentId)) workAgg.set(e.contentId, { contentId: e.contentId, Q: 0, r: [], excludedByReason: {}, activeSecondsQualified: 0 });
        const a = workAgg.get(e.contentId);
        if (e.qualified) {
            a.Q++;
            a.activeSecondsQualified += e.activeSeconds;
            const exp = expected.get(e.contentId);
            if (isFiniteNum(exp) && exp > 0) a.r.push(Math.min(rs.retentionCap, (e.activeSeconds / 60) / exp));
        } else {
            for (const r of e.reasons) {
                const code = r.split(':')[0];
                a.excludedByReason[code] = (a.excludedByReason[code] || 0) + 1;
            }
        }
    }
    const worksOut = [...workAgg.values()].sort((a, b) => cmpStr(a.contentId, b.contentId)).map((a) => {
        const exp = expected.get(a.contentId);
        const hasExpected = isFiniteNum(exp) && exp > 0;
        const rSorted = [...a.r].sort((x, y) => x - y);
        return {
            contentId: a.contentId,
            Q: a.Q,
            R: hasExpected ? median(rSorted) : null,
            blockedReason: hasExpected ? null : 'expected_minutes_missing',
            activeSecondsQualified: a.activeSecondsQualified,
            excludedByReason: Object.fromEntries(Object.entries(a.excludedByReason).sort((x, y) => cmpStr(x[0], y[0]))),
        };
    });

    const episodesOut = episodes
        .filter((e) => inPeriod(e.day))
        .sort((a, b) => cmpStr(a.userId, b.userId) || cmpStr(a.contentId, b.contentId) || a.startMs - b.startMs)
        .map((e) => ({
            userId: e.userId,
            contentId: e.contentId,
            day: e.day,
            startMs: e.startMs,
            endMs: e.endMs,
            activeSeconds: e.activeSeconds,
            modeSeconds: Object.fromEntries(Object.entries(e.modeSeconds).sort((x, y) => cmpStr(x[0], y[0]))),
            accessClasses: e.accessClasses,
            qualified: e.qualified,
            reasons: e.reasons,
            flags: e.flags,
        }));

    const invalidByReason = {};
    for (const x of invalid) invalidByReason[x.reason] = (invalidByReason[x.reason] || 0) + 1;

    return {
        ruleSetId: rs.id,
        episodes: episodesOut,
        works: worksOut,
        audit: {
            invalidEvents: invalid.sort((a, b) => cmpStr(a.reason, b.reason) || cmpStr(String(a.eventId), String(b.eventId))),
            invalidByReason: Object.fromEntries(Object.entries(invalidByReason).sort((x, y) => cmpStr(x[0], y[0]))),
            ignoredNonEconomic,
            crossWorkDroppedSlots,
        },
    };
}
