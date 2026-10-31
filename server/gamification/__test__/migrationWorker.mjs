/**
 * migrationWorker.mjs — CHP-GAMIFICACION-G4-05A-2.
 * Abre una base temporal por el camino normal, como una réplica al arrancar, e
 * imprime las versiones aplicadas. Lo lanza workCyclesMigration.test.mjs.
 */
import '../../__test__/helpers/testMode.mjs';

const { getGamificationDb, closeGamificationDb } = await import('../db.mjs');
try {
    const db = getGamificationDb();
    console.log(db.prepare('SELECT version FROM _migrations ORDER BY version').all().map((r) => r.version).join());
    closeGamificationDb();
} catch (e) {
    console.error(e?.code, e?.message);
    process.exit(1);
}
