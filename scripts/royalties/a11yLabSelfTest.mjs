// Prueba previa del laboratorio A11Y-LAB-02 (se ejecuta dentro del contenedor, /app).
import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { createEconomicTickCore } from '/app/utils/economicTick.mjs';
import { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1 } from '/app/server/royalties/economicEpisodes.mjs';
import { engineClockContext, excludedUsersFromRows } from '/app/server/royalties/econEvents.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (l, c, h = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${l}${h ? ` — ${h}` : ''}`); };
const L = path.join(os.tmpdir(), 'chp_a11ylab');
const API = 'http://127.0.0.1:3000';
const O = { origin: 'http://localhost:5173', 'content-type': 'application/json' };

console.log('[0] seed / start');
const seedOut = execFileSync(process.execPath, ['scripts/royalties/a11yLab.mjs', 'seed', '--dir', L, '--origin', 'http://localhost:5173'], { cwd: '/app' }).toString();
const pw = seedOut.match(/contraseña: (\S+)/)[1];
ok('seed en el temporal del sistema con marcador', fs.existsSync(path.join(L, 'CHP_A11Y_LAB')) && L.startsWith('/tmp/'));
let refused = false;
try { execFileSync(process.execPath, ['scripts/royalties/a11yLab.mjs', 'seed', '--dir', '/app/data/x', '--origin', 'http://a:1'], { cwd: '/app', stdio: 'pipe' }); } catch { refused = true; }
ok('seed rechaza directorios fuera del temporal', refused);
const srv = spawn(process.execPath, ['scripts/royalties/a11yLab.mjs', 'start', '--dir', L], { cwd: '/app', stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', (d) => log += d); srv.stderr.on('data', (d) => log += d);
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${API}/api/health`)).ok) break; } catch { /* arrancando */ } await sleep(500); }

try {
    const cfg = await (await fetch(`${API}/api/runtime-config`)).json();
    ok('runtime-config del laboratorio: economicIngest = on', cfg.economicIngest === 'on');
    const child = execFileSync('pgrep', ['-f', 'server/server.js']).toString().trim().split('\n')[0];
    const senv = Object.fromEntries(fs.readFileSync(`/proc/${child}/environ`, 'utf8').split('\0').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    ok('servidor con entorno mínimo: sin ADMIN_SECRET, claves de IA vacías, NODE_ENV=test', !('ADMIN_SECRET' in senv) && senv.OPENAI_API_KEY === '' && senv.GEMINI_API_KEY === '' && senv.NODE_ENV === 'test');
    ok('almacenes del servidor dentro del laboratorio', [senv.USERS_DB, senv.ACCESS_DB, senv.CONTENT_DB, senv.EVENTS_SQLITE_PATH, senv.SESSIONS_DB, senv.ROYALTIES_DB, senv.PROGRESS_SQLITE_PATH, senv.LEO_EVIDENCE_DB, senv.CHP_DATA_DIR, senv.UPLOADS_ROOT].every((p) => p && p.startsWith(L + '/')));
    let egress = 'ok';
    try { await fetch('https://chibaleteeditores.com', { signal: AbortSignal.timeout(4000) }); } catch (e) { egress = e.cause?.code || e.name; }
    ok('sin salida a internet desde el laboratorio', egress !== 'ok', egress);

    const lr = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: O, body: JSON.stringify({ email: 'lector@a11y-lab.test', password: pw }) });
    const cookie = ((lr.headers.get('set-cookie') || '').match(/chp_session=[^;]+/) || [null])[0];
    ok('login de la cuenta sintética con cookie de sesión', lr.status === 200 && !!cookie, String(lr.status));
    const store = await fetch(`${API}/api/store/catalog`, { headers: { cookie } });
    ok('Tienda: no contacta el catálogo real (no disponible en el laboratorio)', store.status >= 500, String(store.status));
    const noAuth = await fetch(`${API}/api/v1/events`, { method: 'POST', headers: O, body: JSON.stringify({ events: [] }) });
    ok('ingesta sin sesión rechazada', noAuth.status === 401, String(noAuth.status));

    // Escenarios: el cliente real (núcleo) genera los ticks; el servidor real los valida y guarda.
    let n = 0; const base = String(Date.now()).slice(-9);
    const id = () => `01J${base}${String(++n).padStart(14, '0')}`;
    const sim = ({ mode, durMs, signals = () => false, scroll = null }) => {
        const t0 = Date.now() - durMs - 1_000;
        const core = createEconomicTickCore({ mode, contentId: 'lab-largo', sessionId: id(), startedAt: t0, visible: true });
        if (scroll) core.scrollObserved(t0, { position: 0, auto: true });
        const evs = []; let pos = 0;
        for (let t = t0 + 1000; t <= t0 + durMs; t += 1000) {
            const dt = t - t0;
            if (signals(dt)) core.humanSignal(t);
            const s = scroll?.(dt); if (s) { pos += 0.05; core.scrollObserved(t, { position: pos, minAdvance: 0.02, ...s }); }
            if (dt % 15_000 === 0) { const e = core.tick(t, id()); if (e) evs.push(e); }
        }
        const last = core.tick(t0 + durMs + 500, id()); if (last) evs.push(last);
        return evs;
    };
    let firstResp = null;
    const send = async (evs) => {
        let accepted = 0;
        for (let i = 0; i < evs.length; i += 12) {
            const r = await fetch(`${API}/api/v1/events`, { method: 'POST', headers: { ...O, cookie }, body: JSON.stringify({ events: evs.slice(i, i + 12) }) });
            const txt = await r.text(); if (!firstResp) firstResp = `${r.status} ${txt.slice(0, 200)}`;
            if (i + 12 < evs.length) await sleep(61_000);
        }
        await sleep(61_000); // ventana de 12 ticks/min por usuario antes del siguiente escenario
        const ids = new Set(evs.map((e) => e.eventId));
        accepted = rows().filter((r) => ids.has(r.event_id)).length;
        return { accepted };
    };
    const rows = () => { const p = path.join(L, 'events.db'); if (!fs.existsSync(p)) return []; const d = new Database(p, { readonly: true }); try { return d.prepare('SELECT * FROM econ_events ORDER BY id').all(); } catch { return []; } finally { d.close(); } };
    const eng = (sessions) => {
        const rs = rows().filter((r) => sessions.includes(r.session_id));
        return computeEconomicEpisodes(rs, { ruleSet: RULE_SET_RS_2026_01_V1, eligibleContentIds: ['lab-largo'], expectedMinutesByContent: { 'lab-largo': 20 }, excludedUsers: excludedUsersFromRows(rs), ...engineClockContext() });
    };
    const scenario = async (label, parts) => {
        const evs = parts.map(sim).flat();
        const res = await send(evs);
        const r = eng([...new Set(evs.map((e) => e.sessionId))]);
        const secs = r.episodes.reduce((s, e) => s + e.activeSeconds, 0);
        console.log(`    ${label}: ticks ${evs.length}, guardados ${res.accepted}, episodios ${r.episodes.length}, activos ${secs} s, Q ${r.works[0]?.Q ?? 0}, por modo ${JSON.stringify(r.episodes.map((e) => e.modeSeconds))}`);
        return { evs, res, r, secs };
    };

    console.log('[1] lectura normal (a11y, 4 min, interacción cada 20 s)');
    const s1 = await scenario('normal', [{ mode: 'a11y', durMs: 240_000, signals: (dt) => dt % 20_000 === 3_000 }]);
    console.log(`    primera respuesta de la ingesta: ${firstResp}`);
    ok('eventos registrados en econ_events', s1.res.accepted === s1.evs.length, `${s1.res.accepted}/${s1.evs.length}`);
    ok('1 episodio cualificado ≈ 4 min', s1.r.episodes.length === 1 && s1.r.episodes[0].qualified && s1.secs >= 210 && s1.secs <= 240);

    console.log('[2] sin actividad (una interacción y 5 min sin nada, pestaña visible)');
    const s2 = await scenario('inactiva', [{ mode: 'a11y', durMs: 300_000, signals: (dt) => dt === 2_000 }]);
    ok('el cliente deja de emitir y no acumula tiempo (≤ 120 s)', s2.secs <= 120 && s2.evs.length <= 9, `${s2.secs} s, ${s2.evs.length} ticks`);

    console.log('[3] desplazamiento automático (auto-avance) durante 5 min');
    const s3 = await scenario('auto', [{ mode: 'a11y', durMs: 300_000, signals: (dt) => dt === 2_000, scroll: (dt) => (dt % 40_000 === 10_000 ? { auto: true } : null) }]);
    ok('el desplazamiento automático no acredita (≤ 120 s)', s3.secs <= 120, `${s3.secs} s`);

    console.log('[4] lectura con lector de pantalla: una interacción y desplazamiento real cada 40 s, 5 min');
    const s4 = await scenario('lector', [{ mode: 'a11y', durMs: 300_000, signals: (dt) => dt === 2_000, scroll: (dt) => (dt % 40_000 === 10_000 ? {} : null) }]);
    ok('la lectura accesible con señales verificables acredita ≈ 5 min', s4.secs >= 270 && s4.secs <= 300, `${s4.secs} s`);

    console.log('[5] cambio de modo (a11y 2,5 min → text 2,5 min)');
    const s5 = await scenario('modos', [
        { mode: 'a11y', durMs: 300_000, signals: (dt) => dt <= 150_000 && dt % 20_000 === 3_000 },
        { mode: 'text', durMs: 145_000, signals: (dt) => dt % 20_000 === 3_000 },
    ]);
    ok('una misma lectura en dos modos = 1 episodio, Q = 1, minutos ≤ reales', s5.r.episodes.length === 1 && s5.r.works[0]?.Q === 1 && s5.secs <= 300
        && Object.keys(s5.r.episodes[0]?.modeSeconds ?? {}).sort().join() === 'a11y,text', JSON.stringify(s5.r.episodes.map((e) => e.modeSeconds)));

    console.log('[6] report del laboratorio');
    console.log(execFileSync(process.execPath, ['scripts/royalties/a11yLab.mjs', 'report', '--dir', L], { cwd: '/app' }).toString().split('\n').map((l) => `    ${l}`).join('\n'));
    ok('parámetros económicos congelados intactos', RULE_SET_RS_2026_01_V1.pauseExclusionSeconds === 120 && RULE_SET_RS_2026_01_V1.qualifyingActiveSeconds === 45
        && RULE_SET_RS_2026_01_V1.listeningPresenceCapMinutes === 20 && RULE_SET_RS_2026_01_V1.slotSeconds === 15 && RULE_SET_RS_2026_01_V1.brdShareOfIns === 0.25);
} finally {
    console.log('[7] parada');
    srv.kill('SIGTERM');
    for (let i = 0; i < 40 && srv.exitCode === null && srv.signalCode === null; i++) await sleep(250);
    await sleep(1500);
    let up = true; try { await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(1500) }); } catch { up = false; }
    let left = ''; try { left = execFileSync('pgrep', ['-fa', 'server/server.js']).toString().trim(); } catch { left = ''; }
    ok('el laboratorio se detiene limpiamente (puerto cerrado, sin procesos del servidor)', !up && left === '', left);
    const outside = ['/app/data', '/app/data-critical', '/app/public/uploads'].filter((p) => fs.existsSync(p));
    ok('ninguna escritura fuera del laboratorio (sin data/, data-critical/ ni uploads en /app)', outside.length === 0, outside.join(','));
    ok('sin errores de almacenamiento en el log del servidor', !/Cannot open database|ENOENT/.test(log), (log.match(/.*(Cannot open database|ENOENT).*/) || [''])[0].slice(0, 160));
    if (fail) console.log(log.slice(-1500));
    console.log(`\na11yLab e2e — ${pass} ✓, ${fail} ✗`);
    process.exit(fail ? 1 : 0);
}
