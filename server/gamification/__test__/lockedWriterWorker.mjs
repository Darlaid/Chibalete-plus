/**
 * lockedWriterWorker.mjs — CHP-GAMIFICACION-G4-XP-EMISSION-01.
 * Proceso SIN arnés, como producción: con flags y regla aprobada, el escritor no
 * debe escribir. Lo lanza xpPilotEmission.test.mjs.
 */
import '../../__test__/helpers/testMode.mjs';

const { getGamificationDb, closeGamificationDb } = await import('../db.mjs');
const { recordWorkRecognition } = await import('../ledger.mjs');

const db = getGamificationDb();
const r = recordWorkRecognition(db, { evidenceId: 'ev-sin-arnes', userId: 'lector', actorId: 'mediador', at: Date.now(), workRef: 'obra-a', decision: 'aprobado' });
const n = (t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
console.log(JSON.stringify({ ...r, facts: n('gm_source_facts'), cycles: n('gm_work_cycles'), entries: n('gm_xp_entries') }));
closeGamificationDb();
