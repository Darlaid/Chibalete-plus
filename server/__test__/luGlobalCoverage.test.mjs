/**
 * luGlobalCoverage.test.mjs — CHP V9 65E-C3 (Bloque I). Cobertura de Lector Único (LU) en los indicadores GLOBALES.
 *
 * Los indicadores globales que miden la lectura de todos los modos (señales y perfil del materializador, cohorte activa
 * por grupo, ventanas de impacto de intervenciones, agregados diarios) leen events.db. La sesión de LU está allí como
 * hecho conservado (`lu.read_session_*`), fechado por recepción: no contaba como lectura, o contaba a medias y en el
 * día de la sincronización. Con un lector web (W), uno que solo lee en LU con la MISMA lectura (L), uno mixto (M), uno
 * cuya sesión de LU declara una fecha posterior a su recepción (F) y uno que no lee (N):
 *   [1] señales y perfil: L igual que W; fecha de la lectura, no de la sincronización
 *   [2] cohorte activa del grupo
 *   [3] sin duplicados: reenvío del mismo hecho, lector mixto, reconstrucción
 *   [4] lo que LU no emite no se le atribuye (abandono, término, persistencia)
 *   [5] fecha no creíble: no se acredita
 *   [6] ventanas de impacto y agregados diarios
 *   [7] el contexto pedagógico sigue excluyendo la copia (la une por su cuenta, con atribución temporal)
 * Bases temporales; nunca toca data/ ni data-critical/. Imprime `TABLA {…}`.
 *
 *   node server/__test__/luGlobalCoverage.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65ec3_glob_'));
process.env.EVENTS_SQLITE_PATH = path.join(tmp, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmp, 'insights.db');
process.env.GROUPS_DB = path.join(tmp, 'groups.json');
process.env.USERS_DB = path.join(tmp, 'users.json');
const READERS = ['W', 'L', 'M', 'F', 'N'];
fs.writeFileSync(process.env.USERS_DB, JSON.stringify(READERS.map((id) => ({ id, roles: ['lector'] })).concat([{ id: 'med', roles: ['mediador'] }])));
fs.writeFileSync(process.env.GROUPS_DB, JSON.stringify([{ id: 'g1', type: 'course', mediatorIds: ['med'], memberIds: READERS, studentIds: READERS }]));

const eventsService = await import('../eventsService.js');
const materializer = await import('../services/insightMaterializer.mjs');
const ext = await import('../db/insightsDbExt.mjs');
const outcome = await import('../services/outcomeEngine.mjs');
const rollups = await import('../services/rollupsEngine.mjs');
const rollupsExt = await import('../db/rollupsDbExt.mjs');
const mirror = await import('../analytics/luSessionMirror.mjs');
const { mirrorEventId } = mirror;
// En la línea base (antes de 65E-C3) estas dos funciones no existen: la suite corre igual y sus comprobaciones fallan.
const creditedReadingRow = mirror.creditedReadingRow ?? (() => undefined);
const windowMetrics = outcome.computeWindowMetrics ?? (() => ({ eventsCount: null }));

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 900)), fail++);
const section = (t) => console.log(`\n${t}`);
const TABLA = {};
const DAY = 86_400_000, MIN = 60_000, NOW = Date.now(), SYNC = NOW - 30 * MIN;
// La lectura de cada lector: tres sesiones en tres días distintos, dos obras, 30 minutos.
const PLAN = [[6, 'c1', 12], [3, 'cs', 8], [1, 'c1', 10]].map(([d, contentId, minutes]) => ({ startMs: NOW - d * DAY - 90 * MIN, contentId, minutes }));

eventsService.getEventCount();   // crea la tabla
const insert = (rows) => {
    const db = new Database(process.env.EVENTS_SQLITE_PATH);
    try {
        const ins = db.prepare(`INSERT OR IGNORE INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
            VALUES (@event_id, 1, @event, @mode, @user_id, @content_id, @session_id, @client_ts, @server_ts, @elapsed_ms, NULL, @payload_json, @server_ts)`);
        let n = 0;
        db.transaction(() => { for (const r of rows) n += ins.run(r).changes; })();
        return n;
    } finally { db.close(); }
};
/** Sesión web tal como la escribe el hook nativo: fechada por recepción (el servidor la recibe mientras ocurre). */
const webRows = (u, s, k) => {
    const sid = `web-${u}-${k}`, row = (event, ts, elapsed) => ({ event_id: `${sid}-${event}-${ts}`, event, mode: 'text', user_id: u, content_id: s.contentId, session_id: sid, client_ts: ts, server_ts: ts, elapsed_ms: elapsed, payload_json: '{}' });
    const out = [row('reading_started', s.startMs, null)];
    for (let m = 1; m < s.minutes; m++) out.push(row('session_heartbeat', s.startMs + m * MIN, m * MIN));
    out.push(row('session_ended', s.startMs + s.minutes * MIN, s.minutes * MIN));
    return out;
};
/** La misma sesión leída en LU sin conexión: hechos conservados, fecha del dispositivo y recepción al sincronizar. */
const luRows = (u, s, k, receivedAt = SYNC) => {
    const row = (action, ts, elapsed) => { const luId = `lu-${u}-${k}-${action}-${ts}`; return { event_id: mirrorEventId(u, luId), event: `lu.read_session_${action}`, mode: 'lu', user_id: u, content_id: s.contentId, session_id: 'lu-session',
        client_ts: ts, server_ts: receivedAt, elapsed_ms: elapsed, payload_json: JSON.stringify({ _source: 'lu_android', eventId: luId, ...(elapsed ? { elapsedMs: elapsed } : {}) }) }; };
    const out = [row('start', s.startMs, null)];
    for (let m = 1; m < s.minutes; m++) out.push(row('heartbeat', s.startMs + m * MIN, m * MIN));
    out.push(row('end', s.startMs + s.minutes * MIN, s.minutes * MIN));
    return out;
};
const sigOf = (u) => Object.fromEntries(ext.getInsightsExtDb().prepare(`SELECT signal_id, metric_value FROM signal_snapshots WHERE scope_type = 'user' AND scope_id = ?`).all(u).map((r) => [r.signal_id, r.metric_value]));
const profOf = (u) => ext.getStatements().getProfile.get(u) ?? null;
const SCORES = ['persistencia_score', 'diversidad_score', 'engagement_score', 'abandono_risk'];
const shape = (u) => { const p = profOf(u), s = sigOf(u); return JSON.stringify({ signals: Object.fromEntries(Object.entries(s).filter(([, v]) => typeof v === 'number').sort()), profile: p ? Object.fromEntries(SCORES.map((k) => [k, p[k] ?? null])) : null }); };
const brief = (u) => { const s = sigOf(u), p = profOf(u); return [s.tiempo_efectivo_lectura ?? null, typeof s.continuidad_semanal === 'number' ? Math.round(s.continuidad_semanal * 7) : null, s.diversidad_lectora ?? null, p?.engagement_score ?? null, p?.last_active_at ? Math.round((NOW - p.last_active_at) / DAY * 10) / 10 : null]; };
const groupMetric = (k) => ext.getInsightsExtDb().prepare(`SELECT metric_value v FROM cohort_rollups WHERE scope_type = 'group' AND scope_id = 'g1' AND metric_key = ?`).get(k)?.v ?? null;

try {
    const lu = PLAN.flatMap((s, k) => luRows('L', s, k));
    insert([...PLAN.flatMap((s, k) => webRows('W', s, k)), ...lu,
        // M: primera y tercera sesión en LU, la segunda en la web.
        ...luRows('M', PLAN[0], 0), ...webRows('M', PLAN[1], 1), ...luRows('M', PLAN[2], 2),
        // F: una sesión de LU que declara una fecha DOS DÍAS posterior a su recepción.
        ...luRows('F', { startMs: SYNC + 2 * DAY, contentId: 'c1', minutes: 9 }, 0)]);

    section('[1] señales y perfil globales');
    const r = materializer.runOnce({ nowTs: NOW, batchLimit: 50_000 });
    {
        TABLA['lector web [min, días, obras, engagement, última actividad (días)]'] = brief('W');
        TABLA['lector LU  [min, días, obras, engagement, última actividad (días)]'] = brief('L');
        ok('el materializador procesó el lote', r.ok === true && r.processed > 0, JSON.stringify(r));
        ok('lector web: 30 min, 3 días, 2 obras', JSON.stringify(brief('W').slice(0, 3)) === '[30,3,2]', JSON.stringify(brief('W')));
        ok('lector que solo lee en LU: las MISMAS señales y el mismo perfil que el lector web', shape('L') === shape('W') && sigOf('L').tiempo_efectivo_lectura === 30, `${shape('L')}\n${shape('W')}`);
        ok('…fechado cuando leyó (última actividad ayer), no cuando sincronizó (hace 30 minutos)', Math.abs((profOf('L')?.last_active_at ?? 0) - (PLAN[2].startMs + PLAN[2].minutes * MIN)) < 1000 && profOf('L').last_active_at === profOf('W').last_active_at, String(profOf('L')?.last_active_at));
    }

    section('[2] cohorte activa del grupo');
    {
        TABLA['grupo [lectores, activos]'] = [groupMetric('reader_cohort'), groupMetric('active_users')];
        ok('5 lectores; activos: el web, el de LU y el mixto (3). Ni el de fecha no creíble ni el que no lee', groupMetric('reader_cohort') === 5 && groupMetric('active_users') === 3, JSON.stringify([groupMetric('reader_cohort'), groupMetric('active_users')]));
    }

    section('[3] sin duplicados');
    {
        const again = insert(lu);
        ok('reenviar los mismos hechos de LU no crea filas (identificador derivado del evento)', again === 0, String(again));
        ok('lector mixto (dos sesiones en LU y una en la web): los mismos 30 min, 3 días y 2 obras', shape('M') === shape('W'), `${shape('M')}\n${shape('W')}`);
        const before = shape('L');
        const rb = materializer.rebuildInsights({ fromTs: NOW - 28 * DAY, toTs: NOW });
        ok('la reconstrucción desde la historia da lo mismo que el camino incremental', rb.ok === true && shape('L') === before && shape('L') === shape('W'), `${JSON.stringify(rb)} ${shape('L')}`);
    }

    section('[4] lo que LU no emite no se le atribuye');
    {
        const s = sigOf('L');
        ok('abandono temprano 0 de 3 inicios (LU no emite abandonos); persistencia sin valor (LU no emite reanudación ni término)', s.abandono_temprano === 0 && (s.persistencia === null || s.persistencia === undefined) && profOf('L').persistencia_score === null, JSON.stringify([s.abandono_temprano, s.persistencia, profOf('L').persistencia_score]));
        ok('las señales de experiencias siguen en 0 y las diferidas sin valor, como en la web', ['experiencias_iniciadas', 'evidencias_enviadas'].every((k) => s[k] === 0) && s.mediacion_leo === sigOf('W').mediacion_leo);
        const raw = { event: 'lu.app_open', mode: 'lu', user_id: 'L', content_id: null, client_ts: NOW, server_ts: NOW };
        ok('otra telemetría de LU (distribución de la app) se deja tal cual: no se convierte en lectura', creditedReadingRow(raw) === raw);
    }

    section('[5] fecha declarada posterior a la recepción');
    {
        TABLA['lector LU con fecha no creíble [min, días, obras, engagement, última actividad]'] = brief('F');
        ok('no se acredita: 0 minutos, 0 días, sin última actividad', sigOf('F').tiempo_efectivo_lectura === 0 && sigOf('F').continuidad_semanal === 0 && (profOf('F')?.last_active_at ?? null) === null, JSON.stringify(brief('F')));
        ok('…ni fechándola en la recepción', creditedReadingRow({ event: 'lu.read_session_start', client_ts: SYNC + 2 * DAY, server_ts: SYNC }) === null);
        ok('dentro de la tolerancia de reloj (5 min) sí, fechada en la recepción', creditedReadingRow({ event: 'lu.read_session_start', client_ts: SYNC + 2 * MIN, server_ts: SYNC })?.server_ts === SYNC);
    }

    section('[6] ventanas de impacto y agregados diarios');
    {
        const from = NOW - 14 * DAY;
        const w = windowMetrics('W', from, NOW), l = windowMetrics('L', from, NOW), m = windowMetrics('M', from, NOW);
        TABLA['ventana de 14 días · web / LU [eventos, continuidad, obras, completitud]'] = [[w.eventsCount, w.continuidad, w.diversidad, w.completitud], [l.eventsCount, l.continuidad, l.diversidad, l.completitud]];
        ok('ventana de impacto: el lector de LU mide lo mismo que el web (y el mixto)', JSON.stringify(l) === JSON.stringify(w) && JSON.stringify(m) === JSON.stringify(w) && w.eventsCount === 33, `${JSON.stringify(l)}\n${JSON.stringify(w)}`);
        const sync = windowMetrics('L', SYNC - 10 * MIN, NOW);
        ok('…y nada en la ventana del día de la sincronización (leyó antes)', sync.eventsCount === 0, JSON.stringify(sync));
        const f = windowMetrics('F', from, NOW + 5 * DAY);
        ok('…la sesión de fecha no creíble no entra en ninguna ventana', f.eventsCount === 0, JSON.stringify(f));
        outcome.closeOutcomesEventsRaw();
        const rr = rollups.runOnce({ forceRun: true, nowTs: NOW, granularities: ['daily'] });
        const daily = rollupsExt.getRollupsExtDb().prepare(`SELECT period_start, metric_key, metric_value FROM daily_rollups WHERE scope_type = 'all'`).all();
        const total = (k) => daily.filter((x) => x.metric_key === k).reduce((a, x) => a + x.metric_value, 0);
        const dayOf = (ts) => Math.floor(ts / DAY) * DAY;
        const at = (k, ts) => daily.find((x) => x.metric_key === k && x.period_start === dayOf(ts))?.metric_value ?? 0;
        TABLA['agregados diarios · sesiones iniciadas (total) / activos el día de la primera sesión'] = [total('sessions_started'), at('active_users', PLAN[0].startMs)];
        ok('agregados diarios: 9 sesiones iniciadas (3 web + 3 LU + 3 mixto), ninguna por la de fecha no creíble', rr.ok === true && total('sessions_started') === 9, `${JSON.stringify(rr)} ${total('sessions_started')}`);
        ok('…en el día en que se leyó: 3 lectores activos el día de la primera sesión', at('active_users', PLAN[0].startMs) === 3 && at('sessions_started', PLAN[0].startMs) === 3, JSON.stringify(daily.filter((x) => x.period_start === dayOf(PLAN[0].startMs))));
        rollups.closeRollupsEventsRaw();
    }

    section('[7] el contexto pedagógico no lee la copia por aquí');
    {
        const h = materializer.readOwnEventHistory('L', NOW - 28 * DAY);
        ok('la historia propia que usa el contexto pedagógico sigue sin los hechos de LU (los une aparte, con la atribución del curso)', h.length === 0, String(h.length));
        ok('…y la del lector mixto trae solo su sesión web', materializer.readOwnEventHistory('M', NOW - 28 * DAY).every((e) => e.mode === 'text'));
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    try { materializer.closeMaterializerEventsDb(); ext.closeInsightsExtDb(); rollupsExt.closeRollupsExtDb(); eventsService.closeDb(); } catch { /* */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\nluGlobalCoverage — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
