// V8.1-CLOSE-08A — operador de supresión (G-05/G-08). Solo AT, en UNA réplica, ante una solicitud verificada (006 P06/P09).
// No se usa para bajas comerciales ni desactivaciones temporales.
// stdin (JSON, una línea):
//   {"userId":"…","requestRef":"SOL-…","requestDay":"AAAA-MM-DD","capacity":"titular|legal_representative","mediator":false,
//    "hold":{"evidenceIds":["…"],"ref":"DIR-…","until":"AAAA-MM-DD"}}      ← hold solo con orden escrita de Dirección
// Modo conciliación tras restaurar respaldos: {"reconcileAfterRestore":true,"holds":{…}}. Devuelve los ids de cuentas a desactivar (solo en la terminal) y recuentos.
// Después: eliminar la cuenta con la operación existente (DELETE /api/users/:id) y registrar G.1 (pendientes en respaldos según C11).
// Salida: acuses agregados, sin contenidos; los ids solo en el modo conciliación.
const S = await import('/app/server/privacy/suppression.mjs');
const { loadA2Key } = await import('/app/server/privacy/a2Registry.mjs');
const { getGamificationDb, resolveGamificationDbPath } = await import('/app/server/gamification/db.mjs');
const fs = await import('node:fs');
const DATA = process.env.CHP_DATA_DIR || '/app/data';
let input = '';
for await (const chunk of process.stdin) input += chunk;
try {
    const req = JSON.parse(input);
    await loadA2Key();
    const mookPath = `${DATA}/mook_db.json`, submissionsPath = `${DATA}/submissions_db.json`;
    if (req.reconcileAfterRestore) {
        const users = JSON.parse(fs.readFileSync(process.env.USERS_DB, 'utf8'));
        const restrict = S.accountsToRestrictAfterRestore(users);
        const mook = await S.reapplyMookSuppressionsAfterRestore({ mookPath, holds: req.holds ?? {} });
        const subs = await S.reapplySubmissionSuppressionsAfterRestore({ submissionsPath });
        // Las cuentas a desactivar se listan por stdout para que AT las desactive con /disable; no se guardan.
        console.log(JSON.stringify({ ok: true, accountsToDisable: restrict, mook, submissions: subs }));
    } else {
        const db = fs.existsSync(resolveGamificationDbPath()) ? getGamificationDb({ env: { ...process.env, GAMIFICATION_ENABLED: '1' } }) : null;
        const account = S.suppressAccount(db, req);
        const mook = await S.suppressMookParticipant({ mookPath, userId: req.userId, requestRef: req.requestRef, hold: req.hold ?? null });
        const subs = await S.suppressSubmissions({ submissionsPath, userId: req.userId, requestRef: req.requestRef });
        console.log(JSON.stringify({ ok: true, account, mook, submissions: subs }));
    }
} catch (e) {
    console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' }));
    process.exitCode = 1;
}
