/**
 * concurrencyWorker.mjs — CHP-GAMIFICACION-G3-01 / G3-02.
 *
 * Proceso hijo que simula UNA réplica de la API sobre la misma
 * gamification.db temporal (lo lanza ledgerConcurrency.test.mjs). Espera a la
 * barrera de arranque y ejecuta su carga según el rol; imprime un JSON.
 * No es una prueba por sí mismo.
 *
 * Roles: migrate-* (solo abrir/migrar) · api* (hechos compartidos y propios) ·
 * caps-* (muchos hechos del mismo usuario a la vez: XP acumulativo, sin topes) ·
 * recon-* (reconciliar el MOOK de CHP_FIXTURE) · crash (reconciliar y morir
 * abruptamente tras CHP_CRASH_AFTER hechos).
 */
import fs from 'node:fs';

const [, , role, barrier] = process.argv;
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const R = await import('../reconcile.mjs');

while (!fs.existsSync(barrier)) await new Promise((r) => setTimeout(r, 2));

const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: process.env.GAMIFICATION_DB };
const out = { role, inserted: 0, replayed: 0, xp: 0, decisions: {}, errors: [] };
const fact = (sourceEventId, userId) => ({ source: 'mission', sourceEventId, factType: 'mission_completed', userId,
    actorId: 'u-mediador', occurredAt: Date.now(), eligibility: 'eligible' });
const resolveUser = (id) => ({ exists: true, active: true, synthetic: id.startsWith('synthetic-') });
try {
    const db = D.getGamificationDb({ log: () => {} });
    if (role.startsWith('migrate')) {
        out.migrations = db.prepare('SELECT COUNT(*) n FROM _migrations').get().n;
    } else if (role.startsWith('api')) {
        // Los MISMOS 100 hechos compartidos (deben quedar 1 vez cada uno)
        // + 100 hechos propios, intercalados.
        for (let i = 0; i < 100; i++) {
            for (const ev of [`shared-${i}`, `${role}-own-${i}`]) {
                const r = L.recordFact(db, fact(ev, `u-${i % 5}`), { env });
                if (r.inserted) { out.inserted++; out.xp += r.xp; } else out.replayed++;
            }
        }
    } else if (role.startsWith('caps')) {
        for (let i = 0; i < 50; i++) {
            const r = L.recordFact(db, fact(`${role}-hot-${i}`, 'u-hot'), { env });
            out.xp += r.xp;
            out.decisions[r.decision] = (out.decisions[r.decision] || 0) + 1;
        }
    } else if (role.startsWith('recon') || role === 'crash') {
        const doc = JSON.parse(fs.readFileSync(process.env.CHP_FIXTURE, 'utf8'));
        const cands = [...R.mookReviewCandidates(doc), ...R.mookExperienceCandidates(doc)];
        const crashAfter = Number(process.env.CHP_CRASH_AFTER || 0);
        let n = 0;
        const res = R.reconcile(db, cands, { resolveUser, env, onFact: () => {
            if (role === 'crash' && ++n >= crashAfter) process.exit(137); // muere sin cerrar nada
        } });
        Object.assign(out, { recon: res });
    }
    D.closeGamificationDb();
} catch (e) {
    out.errors.push(`${e.code || ''} ${e.message}`);
}
process.stdout.write(JSON.stringify(out));
