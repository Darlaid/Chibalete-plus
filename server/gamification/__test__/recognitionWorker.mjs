/**
 * recognitionWorker.mjs — CHP-GAMIFICACION-G4-05A-3.
 * Una réplica que barre un documento MOOK sintético sobre la base temporal e
 * imprime su resultado. Lo lanza workRecognition.test.mjs.
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import fs from 'node:fs';

const { productionWorkRef } = await import('../../lib/experienceStore.js');
const { getGamificationDb, closeGamificationDb } = await import('../db.mjs');
const { recognizeMookWorks } = await import('../mookSource.mjs');

const { doc, since } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
try {
    const db = getGamificationDb();
    const everyone = () => ({ exists: true, active: true, synthetic: false });
    const result = recognizeMookWorks(db, doc, { workRefOf: productionWorkRef, readRights: () => () => false, resolveUser: everyone, sinceMs: since });
    console.log(JSON.stringify(result));
    closeGamificationDb();
} catch (e) {
    console.error(e?.code, e?.message);
    process.exit(1);
}
