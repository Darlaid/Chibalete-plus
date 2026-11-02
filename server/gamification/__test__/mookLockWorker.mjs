/**
 * mookLockWorker.mjs — CHP-GAMIFICACION-G4-PERF-01B-CLOSE.
 *
 * Proceso hijo que actúa como OTRA réplica sobre el lock de reconciliación
 * (lo lanza mookReconcileLock.test.mjs). No es una prueba por sí mismo.
 *  steal <lock>            toma el lock con el `tryLock` real (si está obsoleto,
 *                          lo libera y lo toma); imprime {pid, token}
 *  release <lock> <token>  libera el lock con el `unlock` real
 */
const [, , role, lockFile, token] = process.argv;
const M = await import('../mookSource.mjs');
const L = M.__reconcileLockForTest;

if (role === 'steal') {
    process.stdout.write(JSON.stringify({ pid: process.pid, token: L.tryLock(lockFile, Date.now()) }));
} else if (role === 'release') {
    L.unlock(lockFile, token);
    process.stdout.write(JSON.stringify({ pid: process.pid, released: true }));
}
