/**
 * evidenceRatchet.test.mjs — El ratchet bloquea lo que debe y nada más.
 *
 *   §1  Positivos: cada patrón histórico se detecta
 *   §2  Negativos: los equivalentes seguros NO se detectan
 *   §3  El one-liner encadenado no se enmascara a sí mismo (segmentos)
 *   §4  El marcador de exención funciona, y exige motivo
 *   §5  Cobertura: toda regla declarada tiene caso positivo y negativo
 *   §6  El repositorio versionado está limpio (el gate real)
 *
 * Los patrones inseguros se ENSAMBLAN por fragmentos para que este mismo
 * archivo no dispare el ratchet al analizarse a sí mismo.
 *
 *   node scripts/security/__tests__/evidenceRatchet.test.mjs
 */

import { RULES, scanText, scanFiles, trackedFiles, splitCommandSegments } from '../evidence-ratchet.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};
const section = (n) => console.log(`\n${n}`);

const J = (...parts) => parts.join('');
const rulesOf = (text, path = 'muestra.sh') => scanText(text, path).map((v) => v.rule);

/** Cada caso: patrón inseguro (debe detectarse) y su equivalente seguro. */
const CASES = [
    {
        rule: 'docker-inspect-raw',
        bad: J('docker ', 'inspect chibalete_api_1 > /root/evidence/api1.json'),
        good: J('docker ', "inspect --format '{{.RestartCount}}' chibalete_api_1"),
    },
    {
        rule: 'compose-config-persisted',
        bad: J('docker ', 'compose config > /root/compose.effective.yml'),
        good: J('docker compose ', 'config -q && echo VALID'),
    },
    {
        rule: 'env-file-copy',
        bad: J('cp /opt/chibaleteplus/', '.env "$SNAP/configs/.env.original"'),
        good: "grep -oE '^[A-Za-z_][A-Za-z0-9_]*' /opt/chibaleteplus/.env > names.txt",
    },
    {
        rule: 'config-env-values',
        bad: J('docker ', "inspect --format '{{range .Config", ".Env}}{{println .}}{{end}}' api_1"),
        good: 'node scripts/security/safeOperationalEvidence.mjs environment-names chibalete_api_1',
    },
    {
        rule: 'secret-as-prompt',
        bad: J('read -r -s -p "', '$', 'GEMINI_VALUE" GEMINI_KEY'),
        good: J('read -r -s ', "-p 'Pega el valor y pulsa Enter: ' V"),
    },
    {
        rule: 'secret-in-argv',
        bad: J('curl -H "x-admin-secret: ', '$', 'SECRET" https://api/admin/validate'),
        good: 'curl --config "$CURLRC" https://api/admin/validate',
    },
    {
        rule: 'env-dump',
        bad: J('docker exec chibalete_api_1 ', 'env'),
        good: 'node scripts/security/safeOperationalEvidence.mjs environment-names chibalete_api_1',
    },
    {
        rule: 'unauthorized-evidence-helper',
        path: 'ops/mi-evidence-collector.sh',
        bad: J('docker ', "inspect --format '{{json .}}' chibalete_api_1"),
        good: 'node scripts/security/safeOperationalEvidence.mjs container-summary chibalete_api_1',
    },
];

// ── §1 y §2 ──────────────────────────────────────────────────────────────────
section('§1-§2 Positivos y negativos por regla');
for (const c of CASES) {
    const path = c.path ?? 'muestra.sh';
    ok(`[${c.rule}] detecta el patrón inseguro`, rulesOf(c.bad, path).includes(c.rule), c.bad);
    ok(`[${c.rule}] no molesta al equivalente seguro`, !rulesOf(c.good, path).includes(c.rule), c.good);
}

// ── §3 ───────────────────────────────────────────────────────────────────────
section('§3 One-liner encadenado');
// Reproduce el caso real: un `docker ps --format` seguro delante y un
// `docker inspect` crudo detrás, en la misma línea. Mirando la línea entera,
// el `--format` del primero tapaba al segundo.
const oneLiner = J(
    'docker ps --format "table {{.Names}}"; ',
    'for c in api_1 api_2; do docker ', 'inspect $c | jq -r ".[0].RestartCount"; done',
);
ok('el segmento crudo se detecta pese al --format previo',
    rulesOf(oneLiner).includes('docker-inspect-raw'));
ok('splitCommandSegments descarta los encabezados echo',
    // chp-evidence-ratchet: allow assert-sobre-el-propio-ratchet
    splitCommandSegments('echo "=== docker inspect x ==="').length === 0);
ok('un echo con el patrón dentro no es violación',
    // chp-evidence-ratchet: allow assert-sobre-el-propio-ratchet
    rulesOf('echo "=== docker inspect ${name} ==="').length === 0);

// ── §4 ───────────────────────────────────────────────────────────────────────
section('§4 Marcador de exención');
const bad = CASES[0].bad;
ok('sin marcador: violación', rulesOf(bad).length > 0);
ok('marcador en la misma línea: exento',
    rulesOf(`${bad}   # chp-evidence-ratchet: allow fixture-de-test`).length === 0);
ok('marcador en la línea anterior: exento',
    rulesOf(`# chp-evidence-ratchet: allow fixture-de-test\n${bad}`).length === 0);
ok('marcador sin motivo: NO exime',
    rulesOf(`# chp-evidence-ratchet: allow\n${bad}`).length > 0);
ok('el marcador solo cubre la línea siguiente, no todo el archivo',
    rulesOf(`# chp-evidence-ratchet: allow uno\n${bad}\n${bad}`).length === 1);

// ── §5 ───────────────────────────────────────────────────────────────────────
section('§5 Cobertura de reglas');
const covered = new Set(CASES.map((c) => c.rule));
for (const rule of RULES) {
    ok(`la regla ${rule.id} tiene caso positivo y negativo`, covered.has(rule.id));
    ok(`la regla ${rule.id} documenta motivo y arreglo`,
        typeof rule.why === 'string' && rule.why.length > 20 && typeof rule.fix === 'string');
}

// ── §6 ───────────────────────────────────────────────────────────────────────
section('§6 El repositorio versionado está limpio');
const files = trackedFiles();
const violations = scanFiles(files);
ok(`0 violaciones en ${files.length} archivos versionados`, violations.length === 0,
    violations.map((v) => `${v.file}:${v.line} [${v.rule}]`).join(', '));

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
