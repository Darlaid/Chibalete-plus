// V8.1-CLOSE-08A/09A — operador de supresión (G-05/G-08). Solo AT, en UNA réplica, ante una solicitud verificada (006 P06/P09).
// No se usa para bajas comerciales, desactivaciones temporales ni retiros de XP (PRIV-C7).
// ORDEN: 1) eliminar la cuenta con la operación existente (DELETE /api/users/:id); 2) este operador. Si la cuenta sigue
// en el padrón responde ACCOUNT_STILL_PRESENT y no escribe nada (cualquier escritura del padrón la volvería a espejar).
// stdin (JSON, una línea):
//   {"userId":"…","requestRef":"SOL-…","requestDay":"AAAA-MM-DD","capacity":"titular|legal_representative","mediator":false,
//    "hold":{"evidenceIds":["…"],"ref":"DIR-…","until":"AAAA-MM-DD"}}      ← hold solo con orden escrita de Dirección
// Modo conciliación tras restaurar respaldos (en CUARENTENA, nunca sobre los stores vivos): {"reconcileAfterRestore":true,"holds":{…}}.
//   Devuelve `accountsToDelete` (suprimidas: DELETE) y `accountsToDisable` (A1 revocada: /disable), solo en la terminal, y recuentos.
//   Repetir tras ejecutar esas acciones: la puerta de promoción exige listas vacías y `changes` = 0 en todo.
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
    const paths = S.residualPaths(process.env);
    const users = JSON.parse(fs.readFileSync(process.env.USERS_DB, 'utf8'));
    if (req.reconcileAfterRestore) {
        const { toDelete, toDisable } = S.restoreActions(users);
        const mook = await S.reapplyMookSuppressionsAfterRestore({ mookPath, holds: req.holds ?? {} });
        const subs = await S.reapplySubmissionSuppressionsAfterRestore({ submissionsPath });
        const residual = await S.reapplyResidualAfterRestore(paths, { extraIds: users.map((u) => u?.id) });
        // Las cuentas se listan por stdout para que AT las trate; no se guardan.
        console.log(JSON.stringify({ ok: true, accountsToDelete: toDelete, accountsToDisable: toDisable, mook, submissions: subs, residual }));
    } else {
        if (users.some((u) => u?.id === req.userId)) throw Object.assign(new Error(), { code: 'ACCOUNT_STILL_PRESENT' });
        const db = fs.existsSync(resolveGamificationDbPath()) ? getGamificationDb({ env: { ...process.env, GAMIFICATION_ENABLED: '1' } }) : null;
        const account = S.suppressAccount(db, req);
        const mook = await S.suppressMookParticipant({ mookPath, userId: req.userId, requestRef: req.requestRef, hold: req.hold ?? null });
        const subs = await S.suppressSubmissions({ submissionsPath, userId: req.userId, requestRef: req.requestRef });
        const residual = await S.suppressResidualSources(paths, req.userId);
        console.log(JSON.stringify({ ok: true, account, mook, submissions: subs, residual }));
    }
} catch (e) {
    console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' }));
    process.exitCode = 1;
}
