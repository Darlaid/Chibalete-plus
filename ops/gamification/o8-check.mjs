/**
 * o8-check.mjs — V8-GATE-CLOSE-02 (O8). Comprobación operativa de SOLO LECTURA de la
 * gamificación XP en una réplica.
 *
 * Uso dentro de una réplica (por stdin, sin imagen nueva):
 *   docker exec -i chibalete_api_1 node --input-type=module - < ops/gamification/o8-check.mjs
 * Variables opcionales: O8_EXPECT_RULE_VERSION, O8_EXPECT_RULES_SHA (las del acta O1),
 * O8_APP_ROOT (por defecto /app; las pruebas apuntan al repo), O8_KEY_PATH.
 *
 * Garantías:
 *  - no escribe, no migra, no crea la base ni sus `-wal`/`-shm`: solo abre una base VIVA
 *    en `readonly` + `query_only`, como `readMyProgress`;
 *  - nunca lee el valor de la clave de sujeto: solo existencia, modo, tamaño y enlace;
 *  - no imprime ids, claves HMAC, nombres ni valores de entorno: solo estados y recuentos.
 * Salida: una línea JSON por comprobación `{check, status: OK|WARN|FAIL, ...}` y un resumen.
 * Código de salida: 0 sin FAIL; 1 con algún FAIL.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.env.O8_APP_ROOT || '/app';
const env = process.env;
const on = (k) => ['1', 'true'].includes(String(env[k] ?? '').trim().toLowerCase());
const G = on('GAMIFICATION_ENABLED');
const XP = G && on('XP_EARNING_ENABLED');
const MODE = !G ? 'inerte' : XP ? 'xp' : 'g4_sin_xp';
const results = [];
const out = (check, status, extra = {}) => { const r = { check, status, ...extra }; results.push(r); console.log(JSON.stringify(r)); };

const DB = await import(path.join(ROOT, 'server/gamification/db.mjs'));
const SK = await import(path.join(ROOT, 'server/gamification/subjectKey.mjs'));
let keyLoaded = false;
const dbPath = DB.resolveGamificationDbPath(env);

// 1. Flags (solo nombres y modo; nunca valores).
out('flags', 'OK', { mode: MODE, pmFlagDefined: env.PM_EARNING_ENABLED !== undefined, mookSinceDefined: !!env.GAMIFICATION_MOOK_SINCE });
if (G && !env.GAMIFICATION_MOOK_SINCE) out('mook_since', 'FAIL', { reason: 'GAMIFICATION_ENABLED sin GAMIFICATION_MOOK_SINCE' });

// 2. Clave de sujeto: existencia y forma, sin leerla.
{
    const keyPath = env.O8_KEY_PATH || '/app/secrets/gamification_subject_key';
    let st = null;
    try { st = fs.lstatSync(keyPath); } catch { st = null; }
    if (!st) out('subject_key', G ? 'FAIL' : 'OK', { present: false });
    else {
        const mode = (st.mode & 0o777).toString(8);
        const bad = st.isSymbolicLink() || !st.isFile() || mode !== '400' || st.size < 32;
        // Carga real del motor (modo 0400, propietario, sin enlaces), en memoria: el valor no se imprime.
        let loadCode = null;
        try { await SK.loadSubjectKey({ path: keyPath }); keyLoaded = true; } catch (e) { loadCode = e?.code || 'ERROR'; }
        out('subject_key', bad || loadCode ? 'FAIL' : 'OK', { present: true, mode, sizeAtLeast32: st.size >= 32, symlink: st.isSymbolicLink(), loadable: !loadCode, ...(loadCode ? { code: loadCode } : {}) });
    }
}

// 3. Registro de exclusiones: archivo, independencia del directorio de la base.
const regPath = env.GAMIFICATION_EXCLUSION_REGISTRY;
if (!regPath) out('exclusion_registry', G ? 'FAIL' : 'OK', { configured: false });
else {
    let lines = null;
    try { lines = fs.readFileSync(regPath, 'utf8').split('\n').filter((l) => l.trim()).length; } catch { lines = null; }
    const independent = path.resolve(path.dirname(regPath)) !== path.resolve(path.dirname(dbPath));
    out('exclusion_registry', lines === null || !independent ? 'FAIL' : 'OK', { configured: true, readable: lines !== null, lines, independentFromDb: independent });
}

// 4. Base: existencia y vida (sin crear nada).
const exists = fs.existsSync(dbPath);
const live = exists && fs.existsSync(`${dbPath}-wal`) && fs.existsSync(`${dbPath}-shm`);
if (!exists) out('ledger_db', XP ? 'FAIL' : 'OK', { present: false });
else if (!live) out('ledger_db', XP ? 'WARN' : 'OK', { present: true, live: false, note: 'sin escritor vivo: no se abre para no crear -wal/-shm' });
else {
    const { default: Database } = await import(path.join(ROOT, 'node_modules/better-sqlite3/lib/index.js'));
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
        db.pragma('query_only = ON');
        db.transaction(() => {
            const one = (sql, ...a) => db.prepare(sql).get(...a);
            const n = (sql, ...a) => one(sql, ...a).n;
            const qc = db.pragma('quick_check', { simple: true });
            const migrations = n('SELECT COUNT(*) n FROM _migrations');
            out('ledger_integrity', qc === 'ok' && migrations === 3 ? 'OK' : 'FAIL', { quickCheck: qc, migrations });

            // Reglas: la vigente debe ser la del acta.
            const active = one('SELECT rule_version, rules_sha256, rules_json FROM gm_rule_sets WHERE effective_from <= ? ORDER BY effective_from DESC, created_at DESC, rule_version DESC LIMIT 1', Date.now());
            const wantV = env.O8_EXPECT_RULE_VERSION, wantS = env.O8_EXPECT_RULES_SHA;
            const rulesOk = !active ? !XP : (!wantV || active.rule_version === wantV) && (!wantS || active.rules_sha256 === wantS);
            out('rules', rulesOk ? 'OK' : 'FAIL', { ruleSets: n('SELECT COUNT(*) n FROM gm_rule_sets'), activeMatchesActa: active ? ((!wantV || active.rule_version === wantV) && (!wantS || active.rules_sha256 === wantS)) : null });
            const ceiling = active ? JSON.parse(active.rules_json)?.recognition?.xpCeilingPerWorkCycle ?? null : null;

            // PM: no debe existir ninguna fila.
            const pm = ['gm_pm_movements', 'gm_pm_balances', 'gm_redemptions', 'gm_redemption_transitions', 'gm_reward_grants'].reduce((s, t) => s + n(`SELECT COUNT(*) n FROM ${t}`), 0)
                + n('SELECT COUNT(*) n FROM gm_work_cycles WHERE pm <> 0');
            out('pm_absent', pm === 0 ? 'OK' : 'FAIL', { pmRows: pm });

            // Hechos y asientos: duplicados, fuentes, decisiones.
            const facts = n('SELECT COUNT(*) n FROM gm_source_facts');
            const badSources = n("SELECT COUNT(*) n FROM gm_source_facts WHERE source NOT IN ('mook_review','mook_experience')");
            const capped = n("SELECT COUNT(*) n FROM gm_source_facts WHERE decision <> 'awarded'");
            const noEntry = n("SELECT COUNT(*) n FROM gm_source_facts f WHERE NOT EXISTS (SELECT 1 FROM gm_xp_entries a WHERE a.fact_id = f.fact_id AND a.kind = 'award')");
            const multiEntry = n("SELECT COUNT(*) n FROM (SELECT fact_id FROM gm_xp_entries WHERE kind = 'award' GROUP BY fact_id HAVING COUNT(*) > 1)");
            const orphanEntry = n("SELECT COUNT(*) n FROM gm_xp_entries a WHERE a.kind = 'award' AND NOT EXISTS (SELECT 1 FROM gm_source_facts f WHERE f.fact_id = a.fact_id)");
            const dupKeys = n('SELECT COUNT(*) n FROM (SELECT source, source_event_id, fact_type FROM gm_source_facts GROUP BY 1,2,3 HAVING COUNT(*) > 1)');
            // V8.1-CLOSE-01 (G-03): cada anulación apunta a un `award` del mismo sujeto.
            const voids = n("SELECT COUNT(*) n FROM gm_xp_entries WHERE kind = 'void'");
            const badVoids = n("SELECT COUNT(*) n FROM gm_xp_entries v WHERE v.kind = 'void' AND NOT EXISTS (SELECT 1 FROM gm_xp_entries a WHERE a.entry_id = v.voids_entry_id AND a.kind = 'award' AND a.subject_ref = v.subject_ref)");
            const ok = badSources + capped + noEntry + multiEntry + orphanEntry + dupKeys + badVoids === 0;
            out('facts_entries', ok ? 'OK' : 'FAIL', { facts, xpEntries: n("SELECT COUNT(*) n FROM gm_xp_entries WHERE kind = 'award'"), badSources, nonAwarded: capped, factsWithoutEntry: noEntry, factsWithSeveralEntries: multiEntry, orphanEntries: orphanEntry, duplicateFactKeys: dupKeys, voids, badVoids });

            // Reconocimiento por obra: actos 10/20 como máximo y techo por obra y ciclo.
            const overAct = n("SELECT COUNT(*) n FROM gm_work_cycles WHERE (act = 'reading' AND xp > 10) OR (act = 'reflection' AND xp > 20)");
            const overCeiling = ceiling === null ? 0 : n('SELECT COUNT(*) n FROM (SELECT subject_ref, work_key, cycle FROM gm_work_cycles GROUP BY 1,2,3 HAVING SUM(xp) > ?)', ceiling);
            const cycleVsEntry = n("SELECT COUNT(*) n FROM (SELECT c.fact_id FROM gm_work_cycles c GROUP BY c.fact_id HAVING SUM(c.xp) <> (SELECT a.xp FROM gm_xp_entries a WHERE a.fact_id = c.fact_id AND a.kind = 'award'))");
            out('work_caps', overAct + overCeiling + cycleVsEntry === 0 ? 'OK' : 'FAIL', { actsOverAmount: overAct, cyclesOverCeiling: overCeiling, factsCycleXpMismatch: cycleVsEntry, ceiling });

            // Corte: ningún hecho anterior al día de GAMIFICATION_MOOK_SINCE (precisión de día del ledger).
            const since = Date.parse(env.GAMIFICATION_MOOK_SINCE ?? '');
            const before = Number.isFinite(since) ? n('SELECT COUNT(*) n FROM gm_source_facts WHERE occurred_at < ?', since - 86_400_000) : 0;
            out('cutoff', before === 0 ? 'OK' : 'FAIL', { factsBeforeCutoff: before });

            // D41 — aprobaciones anómalas (solo máximos, sin ids). Umbrales por defecto 40/100.
            const maxActor = Number(env.O8_MAX_APPROVALS_PER_MEDIATOR_DAY ?? 40), maxXp = Number(env.O8_MAX_XP_PER_READER_DAY ?? 100);
            const actorDay = one("SELECT COALESCE(MAX(c),0) n FROM (SELECT COUNT(*) c FROM gm_source_facts WHERE source = 'mook_review' AND actor_ref IS NOT NULL GROUP BY actor_ref, recorded_at)").n;
            const readerDay = one("SELECT COALESCE(MAX(x),0) n FROM (SELECT SUM(a.xp) x FROM gm_xp_entries a WHERE a.kind = 'award' GROUP BY a.subject_ref, a.created_at)").n;
            out('anomalies_d41', actorDay > maxActor || readerDay > maxXp ? 'WARN' : 'OK', { maxApprovalsPerMediatorDay: actorDay, maxXpPerReaderDay: readerDay, thresholds: [maxActor, maxXp] });

            // Exclusiones: recuentos (no ids) y alineación con el registro.
            out('erasures', 'OK', { erasures: n('SELECT COUNT(*) n FROM gm_erasures'), subjects: n('SELECT COUNT(*) n FROM gm_subjects') });
        })();
        if (regPath) {
            const X = await import(path.join(ROOT, 'server/gamification/exclusions.mjs'));
            let code = null;
            try { X.exclusionGate(db, env); } catch (e) { code = e?.code || 'ERROR'; }
            if (code === null && !keyLoaded && fs.readFileSync(regPath, 'utf8') !== '') code = 'SUBJECT_KEY_UNAVAILABLE';
            out('registry_alignment', code ? 'FAIL' : 'OK', code ? { code } : {});
        }
    } finally {
        db.close();
    }
}

const fails = results.filter((r) => r.status === 'FAIL').length;
const warns = results.filter((r) => r.status === 'WARN').length;
console.log(JSON.stringify({ summary: fails ? 'FAIL' : warns ? 'WARN' : 'OK', mode: MODE, fails, warns }));
process.exit(fails ? 1 : 0);
