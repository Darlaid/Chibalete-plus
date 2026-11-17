/**
 * V9 F7-C2R-U3B — procedencia registrada para una suite HTTP.
 *
 * Desde U3B, un mediador solo recibe como «del curso» la actividad FECHADA cuando la asociación obra–curso y la
 * membresía constan en el registro de procedencia. Una suite que prueba otra cosa (alcance por obra, aislamiento,
 * A2/C005) siembra aquí una línea base antigua con los grupos y reglas de SUS fixtures, y arranca sus réplicas con
 * `ledgerEnv` (registro encendido y almacén compartido). No toca data/ ni data-critical/.
 */
import fs from 'node:fs';

export async function seedContextLedger({ groupsPath, accessPath, insightsPath, daysAgo = 400 }) {
    process.env.INSIGHTS_SQLITE_PATH = insightsPath;
    process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
    const Ledger = await import('../../aulaViva/contextLedger.mjs');
    const groups = JSON.parse(fs.readFileSync(groupsPath, 'utf8'));
    const rules = JSON.parse(fs.readFileSync(accessPath, 'utf8'));
    const snapshot = groups.map((g) => ({
        groupId: String(g.id),
        works: g.availableContentIds === 'all' ? [Ledger.ALL_WORKS]
            : [...new Set(rules.filter((r) => r?.scope === 'group' && String(r.scopeId) === String(g.id)).flatMap((r) => r.titleIds || []).map(String))],
        members: [...new Set([...(g.memberIds || []), ...(g.studentIds || [])].map(String))],
    }));
    const seeded = Ledger.observeContext(snapshot, { nowTs: Date.now() - daysAgo * 86_400_000 });
    Ledger.closeContextLedger();
    return { seeded, ledgerEnv: { INSIGHTS_SQLITE_PATH: insightsPath, AULA_VIVA_CONTEXT_LEDGER_ENABLED: '1' } };
}
