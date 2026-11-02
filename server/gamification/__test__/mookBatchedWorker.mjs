/**
 * mookBatchedWorker.mjs — CHP-GAMIFICACION-G4-PERF-01B.
 *
 * Proceso hijo que simula UNA réplica con el barrido por lotes (lo lanza
 * mookReconcileBatched.test.mjs). No es una prueba por sí mismo.
 *  replica <barrera>   espera la barrera y barre 3 veces; imprime los resultados
 *  kill <marca>        barre con lotes lentos y escribe la marca tras 3 cesiones:
 *                      el padre lo mata con SIGKILL a mitad del barrido
 * Libera `mook_review` solo en este proceso, como el resto de pruebas de obra.
 */
import './helpers/xpRecognitionHarness.mjs';
import fs from 'node:fs';
import { isSyntheticUser, isUserActive } from './helpers/mookSweepFixture.mjs';

const [, , role, signal] = process.argv;
const M = await import('../mookSource.mjs');
const Store = await import('../../lib/experienceStore.js');

const doc = JSON.parse(fs.readFileSync(process.env.CHP_FIXTURE, 'utf8'));
const users = JSON.parse(fs.readFileSync(process.env.CHP_USERS, 'utf8'));
const deps = { readMook: () => doc, readUsers: () => users, isUserActive, isSyntheticUser, workRefOf: Store.productionWorkRef, readRights: () => () => false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (role === 'replica') {
    while (!fs.existsSync(signal)) await sleep(2);
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await M.runMookReconcileBatched(deps, { sliceMax: 15 }));
    process.stdout.write(JSON.stringify({ role, runs }));
} else if (role === 'kill') {
    let pauses = 0;
    await M.runMookReconcileBatched(deps, { sliceMax: 10, onPause: async () => {
        if (++pauses === 3) fs.writeFileSync(signal, 'en curso');
        await sleep(5);
    } });
    process.stdout.write('terminó sin ser interrumpido');
}
