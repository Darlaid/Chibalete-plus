/**
 * mookWorker.mjs — CHP-GAMIFICACION-G3-03.
 *
 * Proceso hijo que simula UNA réplica ejecutando un barrido de reconciliación
 * MOOK (lo lanza mookSource.test.mjs). Espera la barrera e imprime un JSON.
 * No es una prueba por sí mismo.
 */
import fs from 'node:fs';

const [, , role, barrier] = process.argv;
const M = await import('../mookSource.mjs');

const doc = JSON.parse(fs.readFileSync(process.env.CHP_FIXTURE, 'utf8'));
const users = JSON.parse(fs.readFileSync(process.env.CHP_USERS, 'utf8'));
while (!fs.existsSync(barrier)) await new Promise((r) => setTimeout(r, 2));

const out = { role, runs: [] };
for (let i = 0; i < 5; i++) {
    out.runs.push(M.runMookReconcileOnce({
        readMook: () => doc, readUsers: () => users,
        isUserActive: (u) => !u.accountStatus || u.accountStatus === 'active',
        isSyntheticUser: (u) => !!u._loadtest_marker,
    }));
}
process.stdout.write(JSON.stringify(out));
