/**
 * exclusionWorker.mjs — CHP-GAMIFICACION-PRIV-01D.
 * Réplica sintética: `ingest` registra hechos de un usuario en bucle; `exclude`
 * lo excluye en mitad de la ingesta. Base y registro llegan por entorno.
 */
import './helpers/pmMechanicsHarness.mjs';
import fs from 'node:fs';

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const E = await import('../erasure.mjs');

const [role, barrier, stop] = process.argv.slice(2);
const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: process.env.GAMIFICATION_DB };
const USER = process.env.CHP_EXCLUDED_USER;
const out = { role, inserted: 0, refused: 0, errors: [] };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
try {
    const db = D.getGamificationDb({ env });
    while (!fs.existsSync(barrier)) sleep(5);
    if (role === 'exclude') {
        sleep(120);
        Object.assign(out, { receipt: E.excludeUser(db, { userId: USER, env }) });
        fs.writeFileSync(stop, 'x');
    } else {
        const deadline = Date.now() + 15_000;
        for (let i = 0; Date.now() < deadline; i++) {
            const done = fs.existsSync(stop);
            try {
                const r = L.recordFact(db, { source: 'mission', sourceEventId: `${role}-${i}`, factType: 'mission_completed', userId: USER, occurredAt: Date.now(), eligibility: 'eligible' }, { env });
                if (r.inserted) out.inserted++;
                else if (r.decision === 'rejected_excluded_user') out.refused++;
            } catch (e) {
                if (!['SQLITE_BUSY', 'EXCLUSION_REPLAY_REQUIRED'].includes(e.code)) throw e;
            }
            if (done && out.refused >= 20) break;
        }
    }
    D.closeGamificationDb();
} catch (e) {
    out.errors.push(`${e.code || ''} ${e.message}`);
}
process.stdout.write(JSON.stringify(out));
