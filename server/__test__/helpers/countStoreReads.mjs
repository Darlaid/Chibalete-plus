/**
 * countStoreReads.mjs — CHP-CONTENT-PROTECTION-2026-01 CP-3D (solo tests).
 *
 * Precarga (`node --import`) que cuenta las lecturas físicas de stores JSON
 * (`fs.readFileSync` de archivos *.json) por nombre de archivo y vuelca los
 * contadores a CHP_STORE_READ_COUNT_FILE. No altera ninguna lectura: delega
 * siempre en el readFileSync original.
 *
 *   node --import ./server/__test__/helpers/countStoreReads.mjs server/server.js
 */
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.CHP_STORE_READ_COUNT_FILE;
if (OUT) {
    const counts = {};
    let dirty = false;
    const original = fs.readFileSync;
    fs.readFileSync = function patchedReadFileSync(file, ...rest) {
        if (typeof file === 'string' && file.endsWith('.json')) {
            const k = path.basename(file);
            counts[k] = (counts[k] || 0) + 1;
            dirty = true;
        }
        return original.call(this, file, ...rest);
    };
    const writeFile = fs.writeFileSync;
    setInterval(() => {
        if (!dirty) return;
        dirty = false;
        writeFile(OUT, JSON.stringify(counts));
    }, 20).unref();
}
