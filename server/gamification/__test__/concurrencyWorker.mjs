/**
 * concurrencyWorker.mjs — CHP-GAMIFICACION-G3-01.
 *
 * Proceso hijo que simula UNA réplica de la API sobre la misma
 * gamification.db temporal (lo lanza ledgerConcurrency.test.mjs). Espera a la
 * barrera de arranque y ejecuta su carga; imprime un JSON con el resultado.
 * No es una prueba por sí mismo.
 */
import fs from 'node:fs';

const [, , role, barrier] = process.argv;
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');

while (!fs.existsSync(barrier)) await new Promise((r) => setTimeout(r, 2));

const out = { role, inserted: 0, replayed: 0, adjustments: 0, rejected: {}, errors: [] };
try {
    const db = D.getGamificationDb({ log: () => {} });
    if (role.startsWith('migrate')) {
        out.migrations = db.prepare('SELECT COUNT(*) n FROM _migrations').get().n;
    } else {
        const RV = 'gm-conc-v1';
        // Cada réplica: los MISMOS 100 hechos compartidos (deben quedar 1 vez cada uno)
        // + 100 hechos propios + 50 ajustes propios, intercalados.
        for (let i = 0; i < 100; i++) {
            for (const ev of [`shared-${i}`, `${role}-own-${i}`]) {
                const r = L.recordFact(db, { source: 'mook_review', sourceEventId: ev, factType: 'evidence_reviewed',
                    userId: `u-${i % 5}`, actorId: 'u-mediador', occurredAt: Date.now(), grade: 'A', decision: 'awarded',
                    ruleVersion: RV, xp: 3, pm: { amount: 7, reasonCode: 'mook_approved' } });
                if (r.inserted) out.inserted++; else out.replayed++;
            }
            if (i % 2 === 0) {
                try {
                    L.appendAdjustment(db, { userId: `u-${i % 5}`, amount: -3, reasonCode: 'support', actorId: `admin-${role}`,
                        idempotencyKey: `adj-${i}`, ruleVersion: RV });
                    out.adjustments++;
                } catch (e) {
                    out.rejected[e.code] = (out.rejected[e.code] || 0) + 1;
                    if (e.code !== 'INSUFFICIENT_BALANCE') throw e;
                }
            }
        }
    }
    D.closeGamificationDb();
} catch (e) {
    out.errors.push(`${e.code || ''} ${e.message}`);
}
process.stdout.write(JSON.stringify(out));
