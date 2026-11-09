/**
 * a1SweepWorker.mjs — CHP-V8.1-CLOSE-06A (G-01).
 * Proceso hijo que simula una réplica: espera la barrera y ejecuta el barrido MOOK
 * real sobre la misma base, con la puerta A1 real (`CHP_TEST_A1=real` heredado).
 * Imprime el resultado. No es una prueba por sí mismo.
 */
import '../../__test__/helpers/testMode.mjs';
import fs from 'node:fs';

const [, , barrier, docPath, usersPath, sinceMs] = process.argv;
const D = await import('../db.mjs');
const M = await import('../mookSource.mjs');
const Store = await import('../../lib/experienceStore.js');
const env = { ...process.env, GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1' };
const db = D.getGamificationDb({ env });
const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));
const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
while (!fs.existsSync(barrier)) await new Promise((r) => setTimeout(r, 1));
let out;
try {
    out = M.recognizeMookWorks(db, doc, { workRefOf: Store.productionWorkRef, readRights: () => () => false, sinceMs: Number(sinceMs), env,
        resolveUser: M.makeResolveUser(users, () => true, () => false) });
} catch (e) { out = { error: e?.code || String(e) }; }
D.closeGamificationDb();
console.log(JSON.stringify(out));
