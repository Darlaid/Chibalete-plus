#!/usr/bin/env node
/**
 * a11yLabBattery.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A3 / A11Y-AUTO-04.
 *
 * Batería integral contra el laboratorio aislado (`a11yLab.mjs`): servidor,
 * ingesta F3-A2 y motor F3-A1 REALES; el núcleo REAL del cliente
 * (`utils/economicTick.mjs`) emite los ticks EN TIEMPO REAL, como el hook en
 * el navegador, y cada tick se envía al llegar (el servidor exige reloj real:
 * ±10 min). Corre dentro del contenedor del laboratorio, sin red:
 *
 *   docker run -d --name chp-a11ylab-test --network none chp-a11ylab:local
 *   docker cp scripts/royalties/. chp-a11ylab-test:/app/scripts/royalties/
 *   docker exec chp-a11ylab-test node scripts/royalties/a11yLabBattery.mjs
 *
 * Carriles en paralelo: como mucho 2 por cuenta (≤ 8 ticks/min por usuario,
 * por debajo del tope de 12) y nunca dos a la vez sobre la misma obra y cuenta.
 * Cada escenario se evalúa aislado (sus sesiones) con el mismo motor.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createEconomicTickCore } from '/app/utils/economicTick.mjs';
import { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1 } from '/app/server/royalties/economicEpisodes.mjs';
import { engineClockContext, excludedUsersFromRows } from '/app/server/royalties/econEvents.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const L = path.join(os.tmpdir(), 'chp_a11ylab_battery');
const API = 'http://127.0.0.1:3000';
const O = { origin: 'http://localhost:5173', 'content-type': 'application/json' };
const MIN = 60_000;
const LAB = (args) => execFileSync(process.execPath, ['scripts/royalties/a11yLab.mjs', ...args], { cwd: '/app' }).toString();
const checks = [];
const check = (label, cond, detail = '') => { checks.push({ label, ok: !!cond, detail }); console.log(`${cond ? '  ✓' : '  ✗'} ${label}${detail ? ` — ${detail}` : ''}`); };

// ── laboratorio ────────────────────────────────────────────────────────────
const seedOut = LAB(['seed', '--dir', L, '--origin', 'http://localhost:5173']);
const pwOf = (email) => seedOut.split('\n').find((l) => l.includes(`Cuenta: ${email} `)).match(/contraseña: (\S+)/)[1];
let srv = null, log = '';
async function startLab(ingest = 'on') {
    srv = spawn(process.execPath, ['scripts/royalties/a11yLab.mjs', 'start', '--dir', L, '--ingest', ingest], { cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'] });
    srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`${API}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(500); }
    throw new Error('el laboratorio no arrancó');
}
async function stopLab() {
    if (!srv) return;
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await sleep(250);
    srv = null; await sleep(1500);
}
async function login(email) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: O, body: JSON.stringify({ email, password: pwOf(email) }) });
    return ((r.headers.get('set-cookie') || '').match(/chp_session=[^;]+/) || [null])[0];
}
const econRows = () => {
    const p = path.join(L, 'events.db'); if (!fs.existsSync(p)) return [];
    const d = new Database(p, { readonly: true });
    try { return d.prepare("SELECT name FROM sqlite_master WHERE name='econ_events'").get() ? d.prepare('SELECT * FROM econ_events ORDER BY id').all() : []; } finally { d.close(); }
};
const ENGINE_CTX = { ruleSet: RULE_SET_RS_2026_01_V1, eligibleContentIds: ['lab-largo', 'lab-corto', 'lab-epub'], expectedMinutesByContent: { 'lab-largo': 20, 'lab-corto': 1, 'lab-epub': 23 } };
const evaluate = (sessionIds) => {
    const rs = econRows().filter((r) => sessionIds.includes(r.session_id));
    return computeEconomicEpisodes(rs, { ...ENGINE_CTX, excludedUsers: excludedUsersFromRows(rs), ...engineClockContext() });
};

// ── carriles en tiempo real ────────────────────────────────────────────────
let seq = 0; const base = String(Date.now()).slice(-9);
const ulidish = () => `01J${base}${String(++seq).padStart(14, '0')}`;
const narration = ({ from = 2_000, to = Infinity, rate = 1 } = {}) => { let pos = 0; return (dt) => { const p = dt >= from && dt < to; if (p) pos += 1000 * rate; return [{ key: 'N', src: 'narr.mp3', posMs: pos, paused: !p, ended: false, muted: false, volume: 1, rate }]; }; };
const results = [];

async function runScenario(cookie, sc) {
    const t0 = Date.now();
    const sessionId = ulidish();
    const vis = (dt) => (sc.visible ? sc.visible(dt) : true);
    const core = createEconomicTickCore({ mode: sc.mode, contentId: sc.contentId, sessionId, startedAt: t0, visible: vis(0) });
    if (sc.scroll) core.scrollObserved(t0, { position: 0, auto: true });
    let lastVis = vis(0), pos = 0, sent = 0, stored = 0;
    const responses = new Set();
    const post = async (e) => {
        if (!e) return;
        sent++;
        const r = await fetch(`${API}/api/v1/events`, { method: 'POST', headers: { ...O, cookie }, body: JSON.stringify({ events: [e] }) });
        const j = await r.json().catch(() => ({}));
        stored += j.accepted ?? 0;
        if (j.errors?.length) j.errors.forEach((x) => responses.add(x.code ?? x.error));
        if (!r.ok) responses.add(`http_${r.status}`);
    };
    for (let k = 1; k * 1000 <= sc.durMs; k++) {
        const target = t0 + k * 1000;
        const wait = target - Date.now(); if (wait > 0) await sleep(wait);
        const t = Date.now(), dt = k * 1000;
        const v = vis(dt);
        if (v !== lastVis) { core.setVisible(v, t); if (!v) await post(core.tick(t, ulidish())); lastVis = v; }
        if (v && sc.signals?.(dt)) core.humanSignal(t);
        const so = sc.scroll?.(dt); if (so) { pos += so.step ?? 0.05; core.scrollObserved(t, { position: pos, minAdvance: 0.02, ...so }); }
        if (sc.media) core.sampleMedia(t, sc.media(dt));
        if (dt % 15_000 === 0) await post(core.tick(t, ulidish()));
    }
    await post(core.tick(Date.now(), ulidish()));
    return { sessionId, sent, stored, responses: [...responses] };
}
async function lane(cookie, scenarios) {
    for (const sc of scenarios) {
        const parts = sc.parts ?? [sc];
        const runs = [];
        for (const p of parts) runs.push(await runScenario(cookie, { ...sc, ...p }));
        const r = evaluate(runs.map((x) => x.sessionId));
        const secs = r.episodes.reduce((s, e) => s + e.activeSeconds, 0);
        const res = { id: sc.id, label: sc.label, mode: parts.map((p) => p.mode ?? sc.mode).join('→'), sent: runs.reduce((s, x) => s + x.sent, 0),
            stored: runs.reduce((s, x) => s + x.stored, 0), responses: [...new Set(runs.flatMap((x) => x.responses))], secs,
            episodes: r.episodes.length, qualified: r.episodes.filter((e) => e.qualified).length, Q: r.works.reduce((s, w) => s + w.Q, 0),
            modeSeconds: r.episodes.map((e) => e.modeSeconds), sessions: runs.map((x) => x.sessionId) };
        res.pass = sc.expect(res);
        results.push(res);
        console.log(`  ${res.pass ? '✓' : '✗'} ${sc.id} ${sc.label}: enviados ${res.sent}, guardados ${res.stored}, ${secs} s, episodios ${res.episodes} (cualificados ${res.qualified}), Q ${res.Q} ${JSON.stringify(res.modeSeconds)} ${res.responses.length ? `respuestas ${res.responses.join(',')}` : ''} — esperado: ${sc.expectText}`);
    }
}
const every = (ms, off = 3_000) => (dt) => dt % ms === off % ms;
const between = (a, b, f) => (dt) => dt >= a && dt < b && f(dt);
const scroll40 = (extra = {}) => (dt) => (dt % 40_000 === 10_000 ? extra : null);
const inRange = (a, b) => (r) => r.secs >= a && r.secs <= b;

// ── escenarios ─────────────────────────────────────────────────────────────
const W1 = (LE, AV) => [
    lane(LE, [{ id: 'A2', label: 'lectura activa 10 min (interacción cada 20 s)', mode: 'a11y', contentId: 'lab-largo', durMs: 10 * MIN, signals: every(20_000),
        expect: (r) => inRange(555, 600)(r) && r.qualified === 1, expectText: '555–600 s, 1 episodio cualificado' }]),
    lane(LE, [{ id: 'A3', label: 'lectura continua 10 min: una interacción y desplazamiento real cada 40 s', mode: 'a11y', contentId: 'lab-epub', durMs: 10 * MIN,
        signals: (dt) => dt === 2_000, scroll: scroll40(), expect: (r) => inRange(555, 600)(r) && r.qualified === 1, expectText: '555–600 s' }]),
    lane(AV, [
        { id: 'A1', label: 'lectura activa 5 min (interacción cada 20 s)', mode: 'a11y', contentId: 'lab-largo', durMs: 5 * MIN, signals: every(20_000),
            expect: (r) => inRange(255, 300)(r) && r.qualified === 1, expectText: '255–300 s, 1 episodio cualificado' },
        { id: 'A4', label: 'una interacción y 5 min sin desplazamiento (lectura sin señales)', mode: 'a11y', contentId: 'lab-largo', durMs: 5 * MIN, signals: (dt) => dt === 2_000,
            expect: (r) => r.secs <= 120 && r.sent <= 10, expectText: '≤ 120 s; el cliente deja de emitir' },
    ]),
    lane(AV, [
        { id: 'A5', label: 'pestaña oculta de 2 a 4 min y retorno (6 min, interacción cada 20 s con la pestaña visible)', mode: 'a11y', contentId: 'lab-corto', durMs: 6 * MIN,
            signals: every(20_000), visible: (dt) => dt < 2 * MIN || dt >= 4 * MIN, expect: inRange(195, 245), expectText: '≈ 4 min visibles (195–245 s); 0 mientras está oculta' },
        { id: 'A6', label: 'sesión sin interacción inicial con desplazamientos reales, 4 min', mode: 'a11y', contentId: 'lab-corto', durMs: 4 * MIN, scroll: scroll40(),
            expect: (r) => r.sent === 0 && r.episodes === 0, expectText: '0 ticks, 0 episodios' },
    ]),
];
const W2 = (LE, AV) => [
    lane(LE, [{ id: 'A7', label: 'pausa de 3 min y retorno (interacción 0–2 min y 5–7 min)', mode: 'a11y', contentId: 'lab-largo', durMs: 7 * MIN,
        signals: (dt) => (dt < 2 * MIN || dt >= 5 * MIN) && every(20_000)(dt), expect: inRange(195, 250), expectText: '≈ 4 min (195–250 s): la pausa > 120 s no cuenta' }]),
    lane(LE, [{ id: 'E1', label: 'misma obra en dos modos: Accesible 3 min → Guiado 3 min', contentId: 'lab-corto', durMs: 3 * MIN, signals: every(20_000),
        parts: [{ mode: 'a11y' }, { mode: 'text' }],
        expect: (r) => r.episodes === 1 && r.Q === 1 && r.secs >= 315 && r.secs <= 360 && Object.keys(r.modeSeconds[0] ?? {}).sort().join() === 'a11y,text',
        expectText: '1 episodio, Q = 1, 315–360 s, a11y+text' }]),
    lane(AV, [
        { id: 'E2', label: 'lectura corta de 40 s', mode: 'a11y', contentId: 'lab-largo', durMs: 40_000, signals: every(10_000),
            expect: (r) => r.episodes === 1 && r.qualified === 0, expectText: '1 episodio NO cualificado (< 45 s)' },
        { id: 'E3', label: 'obra sin regla de acceso (denegación por defecto)', mode: 'a11y', contentId: 'lab-historial-sintetico', durMs: 45_000, signals: every(10_000),
            expect: (r) => r.sent > 0 && r.stored === 0 && r.episodes === 0, expectText: 'ticks rechazados por el servidor, 0 guardados' },
        { id: 'M-pdf', label: 'PDF: paso de página cada 30 s, 5 min', mode: 'pdf', contentId: 'lab-largo', durMs: 5 * MIN, signals: every(30_000, 5_000),
            expect: inRange(255, 300), expectText: '255–300 s' },
    ]),
    lane(AV, [{ id: 'M-epub', label: 'EPUB paginado: paso de página cada 30 s, 5 min', mode: 'epub', contentId: 'lab-epub', durMs: 5 * MIN, signals: every(30_000, 5_000),
        expect: inRange(255, 300), expectText: '255–300 s' }]),
];
const W3 = (LE, AV) => [
    lane(LE, [{ id: 'M-text', label: 'Guiado con TTS: gesto y escucha 5 min, sin más interacción', mode: 'text', contentId: 'lab-largo', durMs: 5 * MIN,
        signals: (dt) => dt === 1_000, media: narration(), expect: inRange(255, 300), expectText: '255–300 s (vía de escucha)' }]),
    lane(LE, [{ id: 'M-immersive', label: 'Inmersivo: gesto y narración 5 min con la pestaña OCULTA', mode: 'immersive', contentId: 'lab-corto', durMs: 5 * MIN,
        signals: (dt) => dt === 1_000, visible: (dt) => dt < 1_500, media: narration(), expect: inRange(255, 300), expectText: '255–300 s (escucha sin visibilidad)' }]),
    lane(AV, [{ id: 'M-album', label: 'Libro-Álbum: gesto y narración de región 5 min', mode: 'album', contentId: 'lab-largo', durMs: 5 * MIN,
        signals: (dt) => dt === 1_000, media: narration(), expect: inRange(255, 300), expectText: '255–300 s' }]),
    lane(AV, [{ id: 'M-a11y', label: 'Accesible: una interacción y desplazamiento real cada 40 s, 5 min', mode: 'a11y', contentId: 'lab-corto', durMs: 5 * MIN,
        signals: (dt) => dt === 2_000, scroll: scroll40(), expect: inRange(255, 300), expectText: '255–300 s' }]),
];
const W4 = (LE, AV) => [
    lane(LE, [{ id: 'B1', label: 'desplazamiento automático (auto-avance) 4 min tras una interacción', mode: 'a11y', contentId: 'lab-largo', durMs: 4 * MIN,
        signals: (dt) => dt === 2_000, scroll: scroll40({ auto: true }), expect: (r) => r.secs <= 120, expectText: '≤ 120 s' }]),
    lane(LE, [{ id: 'B2', label: 'desplazamiento propio del visor hace 1 s (ventana de 1,5 s), 4 min', mode: 'a11y', contentId: 'lab-corto', durMs: 4 * MIN,
        signals: (dt) => dt === 2_000, scroll: scroll40({ sinceProgrammaticMs: 1_000 }), expect: (r) => r.secs <= 120, expectText: '≤ 120 s' }]),
    lane(AV, [{ id: 'B3', label: 'avance menor que ¼ de pantalla cada 40 s, 4 min', mode: 'a11y', contentId: 'lab-largo', durMs: 4 * MIN,
        signals: (dt) => dt === 2_000, scroll: scroll40({ step: 0.005 }), expect: (r) => r.secs <= 120, expectText: '≤ 120 s' }]),
    lane(AV, [{ id: 'B4', label: 'desplazamiento continuo cada 1 s, 4 min (tope: 1 señal cada 15 s)', mode: 'a11y', contentId: 'lab-corto', durMs: 4 * MIN,
        signals: (dt) => dt === 2_000, scroll: (dt) => (dt >= 5_000 ? { step: 0.01 } : null),
        expect: (r) => inRange(195, 240)(r), expectText: 'continuidad mantenida (195–240 s), sin sumar de más' }]),
];

// ── ejecución ──────────────────────────────────────────────────────────────
console.log('[seguridad] arranque y aislamiento');
await startLab('on');
try {
    const child = execFileSync('pgrep', ['-f', 'server/server.js']).toString().trim().split('\n')[0];
    const senv = Object.fromEntries(fs.readFileSync(`/proc/${child}/environ`, 'utf8').split('\0').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    check('sin credenciales productivas en el entorno del servidor', !('ADMIN_SECRET' in senv) && senv.OPENAI_API_KEY === '' && senv.GEMINI_API_KEY === '' && senv.NODE_ENV === 'test');
    check('todos los almacenes dentro del laboratorio', ['USERS_DB', 'ACCESS_DB', 'CONTENT_DB', 'EVENTS_SQLITE_PATH', 'ARCHIVE_SQLITE_PATH', 'SESSIONS_DB', 'ROYALTIES_DB', 'PROGRESS_SQLITE_PATH', 'LEO_EVIDENCE_DB', 'CHP_DATA_DIR', 'UPLOADS_ROOT'].every((k) => senv[k]?.startsWith(L + '/')));
    let egress = 'ok'; try { await fetch('https://chibaleteplus.chibaleteeditores.com/api/health', { signal: AbortSignal.timeout(4000) }); } catch (e) { egress = e.cause?.code || e.name; }
    check('sin salida hacia producción', egress !== 'ok', egress);
    const LE = await login('lector@a11y-lab.test'), AV = await login('lector-avance@a11y-lab.test');
    check('login de las dos cuentas sintéticas', !!LE && !!AV);

    for (const [name, wave] of [['W1 actividad e inactividad (10 min)', W1], ['W2 contrato y pausas (7 min)', W2], ['W3 seis modos (5 min)', W3], ['W4 accesibilidad simulada (4 min)', W4]]) {
        console.log(`[${name}]`);
        await Promise.all(wave(LE, AV));
        await sleep(61_000);   // ventana de 12 ticks/min por cuenta antes de la siguiente ola
    }

    console.log('[contrato] comparación entre modos y estado sintético');
    const modeSecs = ['M-pdf', 'M-epub', 'M-text', 'M-immersive', 'M-album', 'M-a11y'].map((id) => results.find((r) => r.id === id)?.secs ?? -1);
    check('equivalencia entre los 6 modos (misma lectura de 5 min, diferencia ≤ 30 s)', Math.max(...modeSecs) - Math.min(...modeSecs) <= 30 && Math.min(...modeSecs) > 0, modeSecs.join(' / '));
    const all = econRows();
    check('ningún tick económico de la obra del historial pedagógico', all.every((r) => r.content_id !== 'lab-historial-sintetico'));
    const hdb = new Database(path.join(L, 'events.db'), { readonly: true });
    let hist; try { hist = hdb.prepare("SELECT * FROM events WHERE content_id = 'lab-historial-sintetico'").all(); } finally { hdb.close(); }
    check('el historial pedagógico sintético no produce episodios', hist.length === 4 && computeEconomicEpisodes(hist, { ...ENGINE_CTX, ...engineClockContext() }).episodes.length === 0);
    const effAv = await (await fetch(`${API}/api/reading/my-effective-time`, { headers: { cookie: AV } })).json();
    const effLe = await (await fetch(`${API}/api/reading/my-effective-time`, { headers: { cookie: LE } })).json();
    check('auto-avance: desbloqueado en la cuenta de avance, bloqueado en la normal', effAv.autoAdvanceUnlocked === true && effLe.autoAdvanceUnlocked === false, `${effAv.effectiveReadingMs} / ${effLe.effectiveReadingMs}`);
    const { AUTO_ADVANCE_UNLOCK_MS } = await import('/app/utils/a11yAutoAdvance.mjs');
    const rs = RULE_SET_RS_2026_01_V1;
    check('contrato intacto (rs-2026-01-v1: pausa 120, 45 s, tope 20 min, franja 15 s, 25 % BRD, reparto 30/70, 3 episodios/día) y umbral de 120 min',
        rs.pauseExclusionSeconds === 120 && rs.qualifyingActiveSeconds === 45 && rs.listeningPresenceCapMinutes === 20 && rs.slotSeconds === 15 && rs.brdShareOfIns === 0.25
        && rs.bgpShareOfBrd === 0.30 && rs.blcShareOfBrd === 0.70 && rs.maxQualifiedEpisodesPerUserWorkDay === 3 && rs.resumeMergeMinutes === 30 && AUTO_ADVANCE_UNLOCK_MS === 120 * MIN);

    console.log('[ingesta apagada]');
    const before = econRows().length;
    await stopLab(); await startLab('off');
    const cfgOff = await (await fetch(`${API}/api/runtime-config`)).json();
    const LE2 = await login('lector@a11y-lab.test');
    const core = createEconomicTickCore({ mode: 'a11y', contentId: 'lab-largo', sessionId: ulidish(), startedAt: Date.now() - 20_000, visible: true });
    core.humanSignal(Date.now() - 18_000);
    const offResp = await fetch(`${API}/api/v1/events`, { method: 'POST', headers: { ...O, cookie: LE2 }, body: JSON.stringify({ events: [core.tick(Date.now(), ulidish())] }) });
    const offBody = await offResp.text();
    check('ingesta apagada: runtime-config "off" y ningún tick económico guardado', cfgOff.economicIngest === 'off' && econRows().length === before, `${offResp.status} ${offBody.slice(0, 120)}`);
} finally {
    await stopLab();
    let up = true; try { await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) }); } catch { up = false; }
    let left = ''; try { left = execFileSync('pgrep', ['-fa', 'server/server.js']).toString().trim(); } catch { left = ''; }
    check('parada limpia (puerto cerrado, sin procesos)', !up && left === '', left);
    const outside = ['/app/data', '/app/data-critical', '/app/public/uploads', '/app/.env'].filter((p) => fs.existsSync(p));
    check('ninguna escritura fuera del laboratorio', outside.length === 0, outside.join(','));
    check('sin errores de almacenamiento en el log', !/Cannot open database|ENOENT/.test(log));
    const scen = results.filter((r) => r.pass).length;
    console.log(`\nescenarios ${scen}/${results.length} · comprobaciones ${checks.filter((c) => c.ok).length}/${checks.length}`);
    fs.writeFileSync('/tmp/battery_results.json', JSON.stringify({ results, checks, at: new Date().toISOString() }, null, 2));
    process.exit(scen === results.length && checks.every((c) => c.ok) ? 0 : 1);
}
