/**
 * testA2.mjs — CHP-V8.1-CLOSE-02.
 *
 * Solo pruebas: registro A2 sintético para las suites cuyos mediadores consultan
 * o revisan a lectores sintéticos. Por defecto no hay registro (fallo cerrado);
 * una suite que lo necesita lo pide de forma explícita con `grantA2(ids)`.
 * Fija `CHP_A2_REGISTRY` en `process.env` para que lo hereden los servidores
 * que la suite lance con `...process.env`. Requiere la clave de prueba de
 * `testMode.mjs`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendA2Decision } from '../../privacy/a2Registry.mjs';

export function a2RegistryPath() {
    if (!process.env.CHP_A2_REGISTRY) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_test_a2_'));
        process.env.CHP_A2_REGISTRY = path.join(dir, 'a2.jsonl');
        fs.writeFileSync(process.env.CHP_A2_REGISTRY, '');
    }
    return process.env.CHP_A2_REGISTRY;
}

/** A2 = Sí para cada id (o el estado indicado). */
export function grantA2(ids, status = 'granted') {
    const env = { CHP_A2_REGISTRY: a2RegistryPath() };
    for (const userId of ids) appendA2Decision({ userId, status, requestRef: `A2-SINT-${String(userId).replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 100)}` }, { env });
    return env.CHP_A2_REGISTRY;
}
