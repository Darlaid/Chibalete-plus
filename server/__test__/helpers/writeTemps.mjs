/**
 * writeTemps.mjs — SEC-AUTH-ATOMIC-01.
 *
 * Temporales de escritura de un store. Cada escritura usa un nombre propio, así
 * que comprobar `${file}.tmp` ya no demostraría nada.
 */
import fs from 'node:fs';
import path from 'node:path';

export const writeTempsOf = (file) => fs.readdirSync(path.dirname(file))
    .filter((f) => f.startsWith(`${path.basename(file)}.`) && f.endsWith('.tmp'));
