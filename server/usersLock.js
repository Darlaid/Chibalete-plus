/**
 * usersLock.js — Exclusive write lock for any DB file across processes/containers.
 * Uses POSIX O_EXCL (atomic on shared bind-mounted filesystem).
 * v3: withFileLock generic export; withUsersLock is a named alias.
 */
import fs from 'fs';

const LOCK_TIMEOUT_MS = 8_000;
const LOCK_RETRY_MS   = 40;
const LOCK_STALE_MS   = 15_000;

function lockPath(dbFile) { return dbFile + '.lock'; }

async function acquireLock(dbFile, label = 'fileLock') {
    const lp       = lockPath(dbFile);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    const started  = Date.now();
    let   attempts = 0;
    while (Date.now() < deadline) {
        attempts++;
        try {
            const fd = fs.openSync(lp, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY);
            fs.writeSync(fd, String(process.pid));
            fs.closeSync(fd);
            const waited = Date.now() - started;
            if (waited > 200) {
                console.warn(`[${label}] acquired after ${waited}ms (${attempts} attempts) pid=${process.pid}`);
            }
            return lp;
        } catch (err) {
            if (err.code !== 'EEXIST') throw err;
            try {
                const st = fs.statSync(lp);
                if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
                    console.warn(`[${label}] removing stale lock (age=${Date.now()-st.mtimeMs}ms) path=${lp}`);
                    fs.unlinkSync(lp);
                    continue;
                }
            } catch (_) {}
            await new Promise(r => setTimeout(r, LOCK_RETRY_MS));
        }
    }
    const err = Object.assign(
        new Error(`[${label}] lock timeout (${LOCK_TIMEOUT_MS}ms) pid=${process.pid} attempts=${attempts}`),
        { code: 'ELOCKTIMEOUT' }
    );
    console.error(`[${label}] TIMEOUT:`, err.message);
    throw err;
}

function releaseLock(lp) {
    try { fs.unlinkSync(lp); } catch (_) {}
}

/**
 * withFileLock(dbFile, fn, label?) — Exclusive cross-process lock for any DB file.
 * fn() must re-read dbFile inside to get the latest state before writing.
 */
export async function withFileLock(dbFile, fn, label = 'fileLock') {
    const lp = await acquireLock(dbFile, label);
    const t0 = Date.now();
    try {
        const result = await fn();
        const ms = Date.now() - t0;
        if (ms > 500) console.warn(`[${label}] slow write: ${ms}ms`);
        return result;
    } finally {
        releaseLock(lp);
    }
}

/**
 * withUsersLock(dbFile, fn) — Named alias kept for backward compat.
 */
export async function withUsersLock(dbFile, fn) {
    return withFileLock(dbFile, fn, 'usersLock');
}
