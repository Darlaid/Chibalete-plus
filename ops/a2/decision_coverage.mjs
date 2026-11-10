// V8.1-PROD-02C — cobertura de decisiones, SOLO LECTURA y agregada (sin ids, nombres ni correos).
// Mide, antes de desplegar, a cuántas cuentas activas afectaría cada puerta del 004/005:
//   lectores: A1, A2, A3 (Leo / IA) y A5 (transcripción de voz); mediadores: C005.
// No escribe nada: no crea registros, decisiones ni claves; no concede nada por uso anterior.
//
// Uso en una réplica, con la imagen que se va a desplegar (por stdin, sin red ni montajes nuevos):
//   docker exec -i chibalete_api_1 node --input-type=module - < ops/a2/decision_coverage.mjs
// Variables: DC_APP_ROOT (por defecto /app; las pruebas apuntan al repositorio).
// Salida: una línea JSON con recuentos por tipo y estado, e impacto: cuántos lectores activos
// perderían Leo o la transcripción de voz con la release que exige A3/A5.
// Código de salida: 0 con registro verificable; 1 si el registro o la clave no están disponibles.
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.DC_APP_ROOT || '/app';
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
try {
    const C = await imp('server/config.js');
    const R = await imp('server/privacy/a2Registry.mjs');
    const A = await imp('server/privacy/acceptance.mjs');
    await R.loadA2Key();
    const gate = R.decisionGate();
    const raw = JSON.parse(fs.readFileSync(C.USERS_DB, 'utf8'));
    const users = (Array.isArray(raw) ? raw : []).filter((u) => u?.id && (u.accountStatus ?? 'active') === 'active');
    const mediators = users.filter((u) => A.isMediatorAccount(u));
    const readers = users.filter((u) => !A.isMediatorAccount(u) && !A.isAdminAccount(u));
    const tally = (list, kind) => {
        const out = {};
        for (const u of list) { const s = gate.status(kind, u.id); out[s] = (out[s] ?? 0) + 1; }
        return out;
    };
    const effective = (list, kind) => list.filter((u) => gate.effective(kind, u.id)).length;
    const result = {
        ok: true,
        activeReaders: readers.length,
        activeMediators: mediators.length,
        readers: { A1: tally(readers, 'A1'), A2: tally(readers.filter(A.isInstitutionalReader), 'A2'), A3: tally(readers, 'A3'), A5: tally(readers, 'A5') },
        mediators: { C005: tally(mediators, 'C005') },
        impact: {
            leoClosedReaders: readers.length - effective(readers, 'A3'),
            voiceTranscriptionClosedReaders: readers.length - effective(readers, 'A5'),
            mediatorsWithoutIndividualAccess: mediators.length - effective(mediators, 'C005'),
        },
    };
    console.log(JSON.stringify(result));
} catch (e) {
    console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' }));
    process.exitCode = 1;
}
