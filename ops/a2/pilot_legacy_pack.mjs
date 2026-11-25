// V9R-DEP1 — carga de la condición PILOT_LEGACY (continuidad de los pilotos anteriores a V9). Solo Administración (AT).
//
// PILOT_LEGACY no es un consentimiento, ni una autorización parental, ni un compromiso 005. Constata que una
// pertenencia (grupo + cuenta) existía en el corte del inventario, y solo conserva, dentro de ese grupo:
//   mediador ⇒ la nómina y el resumen de ese curso; lector ⇒ figurar en esa nómina; lector con seguimiento ⇒ además
//   su seguimiento individual por ese mediador. Nunca abre Leo (A3), voz (A5) ni XP (A1).
//
// Modos (PILOT_MODE):
//   emit    por stdout, una línea JSON por pertenencia y, al final, el SELLO. Se pasa tal cual, en el mismo paso, al
//           operador de decisiones (`decision_operator.mjs`): todas las líneas o ninguna. Tras el sello el régimen
//           queda cerrado: no admite cuentas, cursos ni instituciones nuevas. No escribe nada por sí mismo.
//   verify  solo lectura y agregado (sin ids): cuántas pertenencias de hoy tienen la condición vigente, por grupo.
//
// Variables (ninguna tiene valor por defecto: todo sale de la decisión de Dirección):
//   PILOT_GROUPS       ids de los grupos del piloto, separados por comas (emit)
//   PILOT_FOLLOWUP     `none` | `all` | ids de grupo separados por comas: en qué grupos los lectores conservan el
//                      seguimiento individual (emit). Es una decisión expresa; no se presume.
//   PILOT_CUTOFF_DAY   AAAA-MM-DD del inventario (día del acto; nunca futuro) (emit)
//   PILOT_REF          referencia opaca de la decisión de Dirección que lo ordena (emit)
//   PILOT_VALID_UNTIL  AAAA-MM-DD opcional: el régimen entero caduca solo ese día (emit)
//   DC_APP_ROOT        raíz de la aplicación (por defecto /app; las pruebas apuntan al repositorio)
// Uso, en un contenedor efímero sin red de la imagen desplegada, con `ops/a2/` montado en solo lectura:
//   node pilot_legacy_pack.mjs | node decision_operator.mjs        (PILOT_MODE=emit)
// La salida de `emit` lleva identificadores de cuenta: no se guarda en disco ni en evidencias.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// La salida de `emit` se entuba al operador: nada más puede escribir en stdout (tampoco el aviso de dotenv).
process.env.DOTENV_CONFIG_QUIET = 'true';
const ROOT = process.env.DC_APP_ROOT || '/app';
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const fail = (code) => { console.error(JSON.stringify({ ok: false, code })); process.exit(1); };
const arr = (x) => (Array.isArray(x) ? x : []);
const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const DAY_RX = /^\d{4}-\d{2}-\d{2}$/;

try {
    const C = await imp('server/config.js');
    const R = await imp('server/privacy/a2Registry.mjs');
    const A = await imp('server/privacy/acceptance.mjs');
    const { resolveGroupLectorCohort } = await imp('server/analytics/groupAnalyticsSummary.mjs');
    const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
    const users = arr(read(C.USERS_DB)), groups = arr(read(C.GROUPS_DB));
    const byId = new Map(users.filter((u) => u?.id).map((u) => [u.id, u]));
    const active = (id) => { const u = byId.get(id); return !!u && (u.accountStatus ?? 'active') === 'active'; };
    const mediatorsOf = (g) => [...new Set(arr(g.mediatorIds))].filter((id) => active(id) && A.isMediatorAccount(byId.get(id)));
    const readersOf = (g) => [...new Set(resolveGroupLectorCohort(g, users, groups))].filter((id) => active(id) && !A.isMediatorAccount(byId.get(id)) && !A.isAdminAccount(byId.get(id)));
    const mode = process.env.PILOT_MODE;

    if (mode === 'verify') {
        await R.loadA2Key();
        const gate = R.decisionGate();
        const rows = groups.map((g) => ({ grupo: g.id, mediadores: mediatorsOf(g).filter((id) => gate.pilot('mediator', g.id, id)).length,
            lectoresEnNomina: readersOf(g).filter((id) => gate.pilot('reader', g.id, id)).length,
            lectoresConSeguimiento: readersOf(g).filter((id) => gate.pilot('followup', g.id, id)).length })).filter((r) => r.mediadores + r.lectoresEnNomina > 0);
        const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
        console.log(JSON.stringify({ ok: true, sellado: gate.status(R.PILOT_KIND, R.PILOT_SEAL_SUBJECT) !== 'pending', grupos: rows.length,
            pertenenciasDeMediador: sum('mediadores'), pertenenciasDeLector: sum('lectoresEnNomina'), conSeguimiento: sum('lectoresConSeguimiento') }));
        for (const r of rows) console.log(JSON.stringify(r));
    } else if (mode === 'emit') {
        const ids = list(process.env.PILOT_GROUPS), follow = String(process.env.PILOT_FOLLOWUP ?? '').trim();
        const cutoff = process.env.PILOT_CUTOFF_DAY, ref = process.env.PILOT_REF, until = process.env.PILOT_VALID_UNTIL || null;
        if (!ids.length) fail('PILOT_GROUPS_REQUIRED');
        if (!follow) fail('PILOT_FOLLOWUP_REQUIRED');
        if (!DAY_RX.test(String(cutoff)) || cutoff > R.dayOf(Date.now())) fail('PILOT_CUTOFF_DAY_INVALID');
        if (!ref) fail('PILOT_REF_REQUIRED');
        if (until !== null && (!DAY_RX.test(until) || until < cutoff)) fail('PILOT_VALID_UNTIL_INVALID');
        const followGroups = follow === 'all' ? new Set(ids) : follow === 'none' ? new Set() : new Set(list(follow));
        if ([...followGroups].some((g) => !ids.includes(g))) fail('PILOT_FOLLOWUP_OUTSIDE_PILOT');
        const line = (subjectId, capacity) => ({ subjectId, kind: R.PILOT_KIND, status: 'granted', actDay: cutoff, version: R.PILOT_VERSION, medium: R.PILOT_MEDIUM,
            capacity, verification: R.PILOT_VERIFICATION, requestRef: ref, validUntil: until });
        const out = [], counts = [];
        for (const id of ids) {
            const g = groups.find((x) => x?.id === id);
            if (!g) fail('PILOT_GROUP_NOT_FOUND');
            const meds = mediatorsOf(g), readers = readersOf(g);
            if (!meds.length) fail('PILOT_GROUP_WITHOUT_MEDIATOR');
            for (const m of meds) out.push(line(R.pilotSubject(id, m), 'pilot_mediator'));
            for (const r of readers) out.push(line(R.pilotSubject(id, r), followGroups.has(id) ? 'pilot_reader_followup' : 'pilot_reader'));
            counts.push({ grupo: id, mediadores: meds.length, lectores: readers.length, seguimiento: followGroups.has(id) });
        }
        out.push(line(R.PILOT_SEAL_SUBJECT, 'pilot_seal'));
        // Recuentos por stderr (sin ids), para cotejarlos con el inventario del corte antes de cargar.
        console.error(JSON.stringify({ ok: true, lineas: out.length, grupos: counts }));
        for (const d of out) console.log(JSON.stringify(d));
    } else {
        fail('PILOT_MODE_REQUIRED');
    }
} catch (e) {
    fail(e?.code || 'ERROR');
}
