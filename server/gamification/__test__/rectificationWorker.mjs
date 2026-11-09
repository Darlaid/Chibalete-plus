/**
 * rectificationWorker.mjs — CHP-V8.1-CLOSE-01 (G-03).
 *
 * Proceso hijo que simula UNA réplica: espera la barrera y anula la misma
 * evidencia que su gemelo (lo lanza xpRectification.test.mjs). Imprime el acuse
 * o el código de error. No es una prueba por sí mismo.
 */
import fs from 'node:fs';

const [, , barrier, userId, evidenceId, requestRef] = process.argv;
const D = await import('../db.mjs');
const RX = await import('../rectification.mjs');
const env = { ...process.env, GAMIFICATION_ENABLED: '1' };
const db = D.getGamificationDb({ env });
while (!fs.existsSync(barrier)) await new Promise((r) => setTimeout(r, 1));
let out;
try {
    out = RX.voidRecognition(db, { userId, evidenceId, reason: 'rectification_request', requestRef, actorId: 'adm-op' }, { env });
} catch (e) {
    out = { error: e?.code || String(e) };
}
D.closeGamificationDb();
console.log(JSON.stringify(out));
