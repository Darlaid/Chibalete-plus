#!/usr/bin/env node
/**
 * bloque1-readonly.mjs — CHP V9 65E-C. Comprobación de SOLO LECTURA previa al despliegue del Bloque I.
 *
 * Desde 65E-B la administración y quien media ven, de un curso, solo la actividad de las obras ASOCIADAS a él. Un curso
 * sin ninguna obra asociada muestra cifras en cero con el aviso «este curso no tiene obras asociadas». Este script
 * dice, ANTES de desplegar, cuántos cursos están en ese caso y cuánto alcanza la telemetría heredada conservada, para
 * que la decisión se tome con datos. No modifica matrículas, asociaciones ni ningún archivo: solo abre en lectura los
 * archivos que se le indican y escribe el resultado por la salida estándar.
 *
 * La regla de asociación es la del servidor (`groupsContentScope`): reglas de acceso vigentes de ámbito `group`
 * (títulos y colecciones) y, en datos heredados, `availableContentIds` / `collectionIds` del grupo dentro de su vigencia.
 *
 * Uso (rutas explícitas; nunca se infieren):
 *   node ops/preflight/bloque1-readonly.mjs --groups <groups_db.json> --access <access_db.json>
 *        [--content <content.json>] [--analytics <analytics_db.json>] [--json]
 *
 * Salida: recuentos, y por cada curso sin obras su id, nombre, tipo y número de miembros (ningún dato de personas).
 * Código de salida: 0 siempre que pudo leer; 2 si falta o no se puede leer un archivo obligatorio.
 */
import fs from 'node:fs';

export const ROLLING_EVENT_CAP = 50_000;

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/** Cursos y clubes con y sin obras asociadas. `content` (opcional) resuelve las colecciones a títulos. */
export function coursesWithoutWorks(groups, accessRules, content = null, now = Date.now()) {
    const within = (start, end) => (!start || now >= new Date(start).getTime()) && (!end || now <= new Date(end).getTime());
    const childrenOf = (collections) => (Array.isArray(content) ? content.filter((c) => c?.parentId && collections.has(String(c.parentId))).length : null);
    const out = [];
    for (const g of Array.isArray(groups) ? groups : []) {
        if (!g || typeof g.id !== 'string') continue;
        const titles = new Set(), collections = new Set();
        let all = false;
        for (const rule of Array.isArray(accessRules) ? accessRules : []) {
            if (rule?.scope !== 'group' || String(rule.scopeId) !== g.id) continue;
            if (typeof rule.expiresAt === 'number' && Number.isFinite(rule.expiresAt) && now > rule.expiresAt) continue;
            (rule.titleIds || []).forEach((id) => titles.add(String(id)));
            (rule.collectionIds || []).forEach((id) => collections.add(String(id)));
        }
        if (within(g.accessStartsAt, g.accessEndsAt)) {
            if (g.availableContentIds === 'all') all = true;
            else if (Array.isArray(g.availableContentIds)) g.availableContentIds.forEach((id) => titles.add(String(id)));
            (g.collectionIds || []).forEach((id) => collections.add(String(id)));
        }
        const fromCollections = collections.size > 0 ? childrenOf(collections) : 0;
        const members = new Set([...(Array.isArray(g.memberIds) ? g.memberIds : []), ...(Array.isArray(g.studentIds) ? g.studentIds : [])]).size;
        // Con colecciones y sin catálogo no se puede saber si resuelven a algún título: se informa aparte.
        const state = all || titles.size > 0 || (fromCollections ?? 0) > 0 ? 'with_works' : collections.size > 0 && fromCollections === null ? 'collections_unresolved' : 'without_works';
        out.push({ id: g.id, name: typeof g.name === 'string' ? g.name : null, type: g.type === 'club' ? 'club' : 'course', school: typeof g.school === 'string' ? g.school : null, members, state });
    }
    return out;
}

/** Cuánto alcanza la telemetría heredada conservada (memoria rodante). Solo recuentos y fechas. */
export function telemetryCoverage(events, cap = ROLLING_EVENT_CAP) {
    const list = Array.isArray(events) ? events : [];
    const arrival = (e) => (Number.isFinite(e?.receivedAt) ? e.receivedAt : Number.isFinite(e?.timestamp) ? e.timestamp : null);
    const first = list.length ? arrival(list[0]) : null, last = list.length ? arrival(list[list.length - 1]) : null;
    const days = first !== null && last !== null && last > first ? (last - first) / 86_400_000 : null;
    return {
        events: list.length, cap, full: list.length >= cap,
        oldest_arrival: first !== null ? new Date(first).toISOString() : null,
        newest_arrival: last !== null ? new Date(last).toISOString() : null,
        span_days: days !== null ? Math.round(days * 10) / 10 : null,
        events_per_day: days ? Math.round(list.length / days) : null,
        without_server_receipt: list.filter((e) => !Number.isFinite(e?.receivedAt)).length,
        lu_without_server_receipt: list.filter((e) => e?.source === 'lu_android' && !Number.isFinite(e?.receivedAt)).length,
        session_starts: list.filter((e) => e?.event === 'session_start').length,
    };
}

function main(argv) {
    const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
    const paths = { groups: arg('--groups'), access: arg('--access'), content: arg('--content'), analytics: arg('--analytics') };
    if (!paths.groups || !paths.access) { console.error('uso: --groups <groups_db.json> --access <access_db.json> [--content <content.json>] [--analytics <analytics_db.json>] [--json]'); return 2; }
    let groups, access, content = null, analytics = null;
    try { groups = readJson(paths.groups); access = readJson(paths.access); } catch (e) { console.error(`no se pudo leer: ${e.code || e.message}`); return 2; }
    try { if (paths.content) content = readJson(paths.content); } catch (e) { console.error(`catálogo no legible (${e.code || e.message}): las colecciones quedan sin resolver`); }
    try { if (paths.analytics) analytics = readJson(paths.analytics); } catch (e) { console.error(`telemetría no legible (${e.code || e.message})`); }
    const courses = coursesWithoutWorks(groups, access, content);
    const without = courses.filter((c) => c.state === 'without_works'), unresolved = courses.filter((c) => c.state === 'collections_unresolved');
    const result = {
        generated_at: new Date().toISOString(), read_only: true,
        courses: { total: courses.length, with_works: courses.filter((c) => c.state === 'with_works').length, without_works: without.length, collections_unresolved: unresolved.length,
            without_works_with_members: without.filter((c) => c.members > 0).length },
        without_works: without.map(({ state, ...c }) => c), collections_unresolved: unresolved.map(({ state, ...c }) => c),
        telemetry: analytics ? telemetryCoverage(analytics) : null,
    };
    if (argv.includes('--json')) { console.log(JSON.stringify(result, null, 2)); return 0; }
    console.log(`Cursos y clubes: ${result.courses.total} · con obras asociadas: ${result.courses.with_works} · SIN obras asociadas: ${result.courses.without_works} (${result.courses.without_works_with_members} con miembros)${unresolved.length ? ` · solo colecciones sin resolver: ${unresolved.length}` : ''}`);
    for (const c of result.without_works) console.log(`  sin obras · ${c.id} · ${c.name ?? '(sin nombre)'} · ${c.type} · ${c.school ?? '—'} · ${c.members} miembros`);
    for (const c of result.collections_unresolved) console.log(`  colecciones sin resolver (indique --content) · ${c.id} · ${c.name ?? '(sin nombre)'}`);
    if (result.telemetry) {
        const t = result.telemetry;
        console.log(`Telemetría heredada: ${t.events} de ${t.cap} eventos${t.full ? ' (memoria LLENA: lo anterior ya rodó)' : ''} · de ${t.oldest_arrival ?? '—'} a ${t.newest_arrival ?? '—'} (${t.span_days ?? '—'} días, ~${t.events_per_day ?? '—'} eventos/día) · sin constancia de recepción: ${t.without_server_receipt} (de LU: ${t.lu_without_server_receipt})`);
    }
    return 0;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) process.exit(main(process.argv.slice(2)));
