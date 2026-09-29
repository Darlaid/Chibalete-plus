/**
 * syncB2cTitles.mjs — CHP-B2C-PROVISIONING-01. Copia la lista maestra B2C (`access-b2c-lectores`) a las
 * reglas personales de suscripción vigentes. Idempotente. Uso (dentro del contenedor de la API):
 *   node scripts/b2c/syncB2cTitles.mjs            # informe, no escribe
 *   node scripts/b2c/syncB2cTitles.mjs --apply    # escribe access_db.json (con copia previa)
 * Imprime solo recuentos: nunca usuarios ni correos.
 */
import fs from 'node:fs'; import path from 'node:path';
import { planTitleSync } from '../../server/b2c/b2cProvisioning.mjs';
const DATA_DIR = process.env.CHP_DATA_DIR || '/app/data';
const ACCESS_DB = process.env.ACCESS_DB || path.join(DATA_DIR, 'access_db.json');
const apply = process.argv.includes('--apply');
const rules = JSON.parse(fs.readFileSync(ACCESS_DB, 'utf8'));
const { updated, rules: next } = planTitleSync({ rules, nowMs: Date.now() });
console.log(`reglas B2C vigentes a actualizar: ${updated}`);
if (apply && updated > 0) {
    const backup = `${ACCESS_DB}.pre-b2c-sync-${Date.now()}`;
    fs.copyFileSync(ACCESS_DB, backup);
    fs.writeFileSync(ACCESS_DB + '.tmp', JSON.stringify(next, null, 2)); fs.renameSync(ACCESS_DB + '.tmp', ACCESS_DB);
    console.log(`escrito; copia previa: ${path.basename(backup)}`);
}
