/**
 * failRename.mjs — SEC-AUTH-ATOMIC-01.
 *
 * Fallo de persistencia inyectado en el proceso hijo, sin depender del nombre del
 * temporal: mientras exista `<destino>.fail`, reemplazar ese destino lanza EIO.
 * Solo para pruebas; no toca código de producto.
 *
 *   const injection = armRenameFailure(contentFile); // antes de arrancar el servidor
 *   injection.on(); ... injection.off();
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.env.CHP_TEST_FAIL_RENAME_TO;
if (target) {
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
        if (path.resolve(String(to)) === target && fs.existsSync(`${target}.fail`)) {
            throw Object.assign(new Error('fallo de escritura inyectado'), { code: 'EIO' });
        }
        return rename(from, to);
    };
}

export function armRenameFailure(file) {
    const resolved = path.resolve(file);
    process.env.CHP_TEST_FAIL_RENAME_TO = resolved;
    process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import ${import.meta.url}`.trim();
    return {
        on: () => fs.writeFileSync(`${resolved}.fail`, ''),
        off: () => fs.rmSync(`${resolved}.fail`, { force: true }),
    };
}
