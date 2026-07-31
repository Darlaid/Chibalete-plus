/**
 * scanArtifact.test.mjs — El escáner no puede dar un GREEN falso.
 *
 *   §1  Regresión histórica: el tokenizador antiguo NO veía la clave con punto
 *   §2  El escáner nuevo la ve, y ve las demás formas problemáticas
 *   §3  Codificaciones: JSON escapado, base64, percent, comillas YAML, escapes
 *   §4  Valor partido en varias líneas (multilínea controlado)
 *   §5  Varios secretos y valores duplicados en un mismo artefacto
 *   §6  Unicode alrededor del valor no lo oculta
 *   §7  El escáner nunca imprime el valor
 *   §8  Artefacto limpio → sin hallazgos (sin falsos positivos)
 *   §9  Carga de patrones desde archivo, con y sin etiqueta
 *
 *   node scripts/security/__tests__/scanArtifact.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { scanArtifact, loadNeedles, fingerprint } from '../scanArtifact.mjs';
import { SECRETS, allSecretValues, makeTmpDir, writeTmp, cleanup } from './syntheticFixtures.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};
const section = (n) => console.log(`\n${n}`);

const NEEDLES = allSecretValues();
const ids = (findings) => [...new Set(findings.map((f) => f.id))].sort();
const TMP = makeTmpDir('chp-scan-');

try {
    // ── §1 ───────────────────────────────────────────────────────────────────
    section('§1 Regresión: el tokenizador antiguo era ciego a la clave con punto');
    // Reproducción exacta del escáner de CHP-SEC-AI-PROVIDER-KEYS-ROTATE-01A.
    const OLD_TOKENIZER = /[A-Za-z0-9_\-]{20,300}/g;
    const oldScan = (text, value) => {
        const target = createHash('sha256').update(value).digest('hex');
        return (text.match(OLD_TOKENIZER) ?? [])
            .some((tok) => createHash('sha256').update(tok).digest('hex') === target);
    };
    const artefacto = `GEMINI_API_KEY=${SECRETS.GEMINI_API_KEY}\n`;
    ok('el tokenizador antiguo NO encuentra la clave con punto (bug histórico)',
        oldScan(artefacto, SECRETS.GEMINI_API_KEY) === false);
    ok('el tokenizador antiguo SÍ encontraba las claves sin punto',
        oldScan(`OPENAI_API_KEY=${SECRETS.OPENAI_API_KEY}`, SECRETS.OPENAI_API_KEY) === true);

    // ── §2 ───────────────────────────────────────────────────────────────────
    section('§2 El escáner nuevo la encuentra');
    ok('clave con punto', ids(scanArtifact(artefacto, NEEDLES)).includes('GEMINI_API_KEY'));
    for (const [id, value] of Object.entries(SECRETS)) {
        ok(`encuentra ${id}`, ids(scanArtifact(`x ${value} y`, NEEDLES)).includes(id));
    }

    // ── §3 ───────────────────────────────────────────────────────────────────
    section('§3 Codificaciones');
    const v = SECRETS.DATABASE_URL;
    const cases = {
        'json escapado': JSON.stringify({ dsn: v }),
        'percent-encoded': `url=${encodeURIComponent(v)}`,
        base64: `blob: ${Buffer.from(v, 'utf8').toString('base64')}`,
        base64url: `blob: ${Buffer.from(v, 'utf8').toString('base64url')}`,
        'entre comillas dobles': `dsn: "${v}"`,
    };
    for (const [name, text] of Object.entries(cases)) {
        ok(name, ids(scanArtifact(text, NEEDLES)).includes('DATABASE_URL'), text.slice(0, 40));
    }
    const q = SECRETS.DB_PASSWORD;
    ok('comilla simple duplicada de YAML',
        ids(scanArtifact(`pw: '${q.split("'").join("''")}'`, NEEDLES)).includes('DB_PASSWORD'));
    ok('escapado con barras (sed/heredoc)',
        ids(scanArtifact(SECRETS.GEMINI_API_KEY.replace(/\./g, '\\.'), NEEDLES)).includes('GEMINI_API_KEY'));

    // ── §4 ───────────────────────────────────────────────────────────────────
    section('§4 Multilínea controlado');
    const partido = SECRETS.OPENAI_API_KEY.slice(0, 20) + '\\\n' + SECRETS.OPENAI_API_KEY.slice(20);
    ok('valor con continuación de línea', ids(scanArtifact(partido, NEEDLES)).includes('OPENAI_API_KEY'));
    const envuelto = SECRETS.ADMIN_SECRET.slice(0, 30) + '\n' + SECRETS.ADMIN_SECRET.slice(30);
    ok('valor envuelto por la terminal', ids(scanArtifact(envuelto, NEEDLES)).includes('ADMIN_SECRET'));

    // ── §5 ───────────────────────────────────────────────────────────────────
    section('§5 Varios secretos y duplicados');
    const multi = Object.values(SECRETS).join('\n') + '\n' + SECRETS.ADMIN_SECRET;
    const found = ids(scanArtifact(multi, NEEDLES));
    ok('los 9 secretos se detectan', found.length === 9, `detectados ${found.length}: ${found.join(',')}`);
    const dupFindings = scanArtifact(multi, NEEDLES).filter((f) => f.id === 'ADMIN_SECRET');
    ok('el duplicado no oculta al primero', dupFindings.length >= 1);

    // ── §6 ───────────────────────────────────────────────────────────────────
    section('§6 Unicode alrededor');
    ok('acentos y emoji pegados al valor',
        ids(scanArtifact(`ñá🦀${SECRETS.SESSION_TOKEN}🦀üö`, NEEDLES)).includes('SESSION_TOKEN'));
    ok('artefacto leído como Buffer (UTF-8 real)',
        ids(scanArtifact(Buffer.from(`🦀 ${SECRETS.COOKIE_VALUE} 🦀`, 'utf8'), NEEDLES)).includes('COOKIE_VALUE'));

    // ── §7 ───────────────────────────────────────────────────────────────────
    section('§7 El escáner no filtra el valor');
    const findings = scanArtifact(multi, NEEDLES);
    const serialized = JSON.stringify(findings);
    const filtra = Object.values(SECRETS).some((s) => serialized.includes(s));
    ok('ningún valor aparece en los hallazgos', filtra === false);
    ok('el hallazgo lleva huella no reversible',
        findings[0].fingerprint === fingerprint(SECRETS[findings[0].id]));

    // ── §8 ───────────────────────────────────────────────────────────────────
    section('§8 Sin falsos positivos');
    const limpio = 'NODE_ENV=production\nMETRICS_ENGINE=legacy\nLEGACY_METRICS_REQUEST_CONTEXT=off\n';
    ok('artefacto limpio → 0 hallazgos', scanArtifact(limpio, NEEDLES).length === 0);
    ok('un prefijo del secreto no cuenta como hallazgo',
        scanArtifact(SECRETS.OPENAI_API_KEY.slice(0, 12), NEEDLES).length === 0);

    // ── §9 ───────────────────────────────────────────────────────────────────
    section('§9 Carga de patrones desde archivo');
    const needleFile = writeTmp(TMP, 'needles.txt', [
        '# patrones sintéticos',
        '',
        `GEMINI=${SECRETS.GEMINI_API_KEY}`,
        SECRETS.ADMIN_SECRET,
    ].join('\n'));
    const loaded = loadNeedles(needleFile);
    ok('ignora comentarios y vacías', loaded.length === 2);
    ok('respeta la etiqueta id=valor', loaded[0].id === 'GEMINI');
    ok('etiqueta por defecto para líneas sin id', loaded[1].id === 'needle-2');
    ok('los patrones cargados funcionan',
        ids(scanArtifact(artefacto, loaded)).includes('GEMINI'));
    ok('el modo 0600 del archivo de patrones se respeta al crearlo',
        (fs.statSync(needleFile).mode & 0o777) === 0o600 || process.platform === 'win32');
} finally {
    cleanup(TMP);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
