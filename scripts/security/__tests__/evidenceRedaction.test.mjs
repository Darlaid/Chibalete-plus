/**
 * evidenceRedaction.test.mjs — Contrato de evidencia operativa segura.
 *
 *   §1  Escáner: encuentra los 9 secretos sintéticos en el artefacto ORIGINAL
 *       (si esto fallara, todo lo demás sería un falso GREEN)
 *   §2  Docker inspect sintético → container-summary sin secretos
 *   §3  environment-names publica nombres y solo los valores de la allowlist
 *   §4  Compose sintético → compose-summary sin secretos
 *   §5  JSON: anidados, arrays, duplicados, mayúsculas, Config.Env
 *   §6  YAML: sigue siendo válido y pierde todos los valores sensibles
 *   §7  ENV: modo names y modo redacted
 *   §8  Texto libre: best-effort, marcado como tal
 *   §9  La entrada nunca se muta
 *  §10  La herramienta no admite ningún modo crudo
 *  §11  Campos permitidos preservados (ImageID, health, banderas)
 *  §12  Cero archivos temporales con material sensible
 *
 *   node scripts/security/__tests__/evidenceRedaction.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    SECRETS, allSecretValues, envFixture, dockerInspectFixture, composeJsonFixture,
    yamlFixture, jsonFixture, textFixture, makeTmpDir, writeTmp, cleanup,
} from './syntheticFixtures.mjs';
import { scanArtifact } from '../scanArtifact.mjs';
import { redactJson, redactEnvText, redactYaml, redactText, envNames } from '../redact.mjs';
import {
    containerSummary, composeSummary, environmentNames, mountSummary,
    healthSummary, imageSummary, assertNoUnsafeFlags,
} from '../safeOperationalEvidence.mjs';

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};
const section = (n) => console.log(`\n${n}`);

const NEEDLES = allSecretValues();
/** Devuelve los ids de secreto presentes en un artefacto de salida. */
const leaks = (out) => {
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    return [...new Set(scanArtifact(text, NEEDLES).map((f) => f.id))].sort();
};

const TMP = makeTmpDir();

try {
    // ── §1 ───────────────────────────────────────────────────────────────────
    section('§1 El escáner encuentra los secretos en la ENTRADA (anti falso GREEN)');
    const envText = envFixture();
    const foundEnv = leaks(envText);
    ok('el .env sintético delata sus 6 secretos', foundEnv.length === 6, `encontrados: ${foundEnv.join(',')}`);

    const inspectText = JSON.stringify(dockerInspectFixture());
    // chp-evidence-ratchet: allow etiqueta-de-test-sobre-fixture-sintetica
    ok('el docker inspect sintético delata sus secretos', leaks(inspectText).length >= 6, leaks(inspectText).join(','));

    const yamlText = yamlFixture();
    ok('el YAML sintético delata sus secretos', leaks(yamlText).length >= 5, leaks(yamlText).join(','));

    ok('la clave con PUNTO se detecta en la entrada',
        leaks(SECRETS.GEMINI_API_KEY).includes('GEMINI_API_KEY'));
    ok('varios secretos en un mismo archivo se detectan a la vez',
        leaks(envText).includes('OPENAI_API_KEY') && leaks(envText).includes('GEMINI_API_KEY')
        && leaks(envText).includes('ADMIN_SECRET'));

    // ── §2 ───────────────────────────────────────────────────────────────────
    section('§2 container-summary');
    const inspected = dockerInspectFixture();
    const summary = containerSummary(inspected);
    ok('sin secretos en la salida', leaks(summary).length === 0, leaks(summary).join(','));
    ok('no aparece Config.Cmd', !JSON.stringify(summary).includes('server/server.js'));
    ok('no aparece la IP del contenedor', !JSON.stringify(summary).includes('172.18.0.5'));
    ok('el label no permitido sale solo por nombre',
        JSON.stringify(summary).includes('build.ci.token')
        && summary.containers[0].labels.allowed['build.ci.token'] === undefined);
    ok('la ruta de mount desconocida se sanea',
        !JSON.stringify(summary).includes('cliente-privado'));

    // ── §3 ───────────────────────────────────────────────────────────────────
    section('§3 environment-names');
    const envSummary = environmentNames(inspected);
    const entries = envSummary.variables[0].entries;
    ok('sin secretos', leaks(envSummary).length === 0, leaks(envSummary).join(','));
    ok('los nombres sí se publican', entries.some((e) => e.name === 'OPENAI_API_KEY'));
    ok('el valor de una bandera permitida se publica',
        entries.find((e) => e.name === 'LEGACY_METRICS_REQUEST_CONTEXT')?.value === 'off');
    ok('METRICS_ENGINE=legacy visible', entries.find((e) => e.name === 'METRICS_ENGINE')?.value === 'legacy');
    ok('la variable sin nombre sospechoso también se redacta (CHIB_ROTOR)',
        entries.find((e) => e.name === 'CHIB_ROTOR')?.value === '[REDACTED]');

    // ── §4 ───────────────────────────────────────────────────────────────────
    section('§4 compose-summary');
    const compose = composeSummary(composeJsonFixture());
    ok('sin secretos', leaks(compose).length === 0, leaks(compose).join(','));
    ok('conserva imagen y servicio', compose.services[0].image === 'chibalete/api:83489ce');
    ok('conserva la bandera permitida',
        compose.services[0].environment.find((e) => e.name === 'LEGACY_METRICS_REQUEST_CONTEXT')?.value === 'off');
    ok('declara el env_file sin leerlo', compose.services[0].envFiles.includes('.env'));

    // ── §5 ───────────────────────────────────────────────────────────────────
    section('§5 redactJson');
    const jsonIn = jsonFixture();
    const jsonOut = redactJson(jsonIn);
    ok('sin secretos', leaks(jsonOut).length === 0, leaks(jsonOut).join(','));
    ok('sigue siendo JSON válido', typeof JSON.parse(JSON.stringify(jsonOut)) === 'object');
    ok('Config.Env conserva nombres', JSON.stringify(jsonOut).includes('OPENAI_API_KEY=[REDACTED]'));
    ok('Config.Env conserva valores permitidos', JSON.stringify(jsonOut).includes('NODE_ENV=production'));
    ok('anidado profundo redactado', jsonOut.credenciales.nested.deep.API_KEY === '[REDACTED]');
    ok('array de tokens redactado', jsonOut.tokens.every((t) => t === '[REDACTED]'));
    ok('clave en minúsculas también (cookie)', jsonOut.cabeceras[1].cookie === '[REDACTED]');
    ok('clave camelCase también (adminSecret)', jsonOut.credenciales.adminSecret === '[REDACTED]');
    ok('clave con guiones también (x-admin-secret)', jsonOut.credenciales['x-admin-secret'] === '[REDACTED]');
    ok('dsn redactado', jsonOut.dsn === '[REDACTED]');
    ok('banderas no sensibles intactas', jsonOut.flags.METRICS_ENGINE === 'legacy');

    // ── §6 ───────────────────────────────────────────────────────────────────
    section('§6 redactYaml');
    const yamlOut = redactYaml(yamlText);
    ok('sin secretos', leaks(yamlOut).length === 0, leaks(yamlOut).join(','));
    ok('mismo número de líneas (estructura intacta)',
        yamlOut.split('\n').length === yamlText.split('\n').length);
    ok('conserva la imagen', yamlOut.includes('image: chibalete/api:83489ce'));
    ok('conserva la bandera permitida', yamlOut.includes('LEGACY_METRICS_REQUEST_CONTEXT: "off"'));
    ok('redacta el mapa environment', yamlOut.includes('OPENAI_API_KEY: [REDACTED]'));
    ok('redacta la lista - NAME=value', yamlOut.includes('- ADMIN_SECRET=[REDACTED]'));
    ok('conserva NODE_ENV en lista', yamlOut.includes('- NODE_ENV=production'));
    ok('redacta el bloque secrets', /db_password:\s*\[REDACTED\]/.test(yamlOut));
    ok('redacta cabecera authorization', /authorization:\s*\[REDACTED\]/.test(yamlOut));
    ok('la indentación se conserva', yamlOut.split('\n')[7].startsWith('      '));

    // ── §7 ───────────────────────────────────────────────────────────────────
    section('§7 redactEnvText');
    const namesOut = redactEnvText(envText, { mode: 'names' });
    ok('modo names: sin secretos', leaks(namesOut).length === 0, leaks(namesOut).join(','));
    ok('modo names: sin ningún signo igual', !namesOut.includes('='));
    ok('modo names: lista los nombres', namesOut.split('\n').includes('GEMINI_API_KEY'));
    const redOut = redactEnvText(envText, { mode: 'redacted' });
    ok('modo redacted: sin secretos', leaks(redOut).length === 0, leaks(redOut).join(','));
    ok('modo redacted: conserva banderas', redOut.includes('METRICS_ENGINE=legacy'));
    ok('modo redacted: redacta la desconocida', redOut.includes('CHIB_ROTOR=[REDACTED]'));
    ok('modo redacted: redacta con comillas simples', redOut.includes('DB_PASSWORD=[REDACTED]'));
    ok('envNames reconoce `export`', envNames(envText).includes('TTS_MODE'));

    // ── §8 ───────────────────────────────────────────────────────────────────
    section('§8 redactText (best-effort)');
    const t = redactText(textFixture(), { literals: [SECRETS.GEMINI_API_KEY] });
    ok('marcado como best-effort', t.bestEffort === true);
    ok('sin secretos con literales conocidos', leaks(t.text).length === 0, leaks(t.text).join(','));
    ok('el unicode alrededor no lo despista', t.text.includes('🦀'));
    ok('la prosa no sensible sobrevive', t.text.includes('status: ok'));

    // ── §9 ───────────────────────────────────────────────────────────────────
    section('§9 Inmutabilidad de la entrada');
    ok('redactJson no muta', jsonIn.credenciales.adminSecret === SECRETS.ADMIN_SECRET);
    // chp-evidence-ratchet: allow assert-de-inmutabilidad-sobre-fixture
    ok('containerSummary no muta el inspect', inspected[0].Config.Env.some((e) => e.includes(SECRETS.OPENAI_API_KEY)));

    // ── §10 ──────────────────────────────────────────────────────────────────
    section('§10 Sin modo crudo');
    for (const flag of ['--raw', '--full', '--no-redact', '--unsafe']) {
        let threw = false;
        try { assertNoUnsafeFlags(['container-summary', flag]); } catch { threw = true; }
        ok(`${flag} es un error duro`, threw);
    }

    // ── §11 ──────────────────────────────────────────────────────────────────
    section('§11 Campos permitidos preservados');
    const health = healthSummary(inspected);
    const image = imageSummary(inspected);
    const mounts = mountSummary(inspected);
    ok('health', health.containers[0].health === 'healthy');
    ok('restartCount', health.containers[0].restartCount === 0);
    ok('el log del healthcheck sale solo como conteo', health.containers[0].healthLogEntries === 1
        && leaks(health).length === 0);
    ok('ImageID completo', image.containers[0].imageId.startsWith('sha256:3d0085d96547'));
    ok('imageRef', image.containers[0].imageRef === 'chibalete/api:83489ce');
    ok('label permitido con valor', image.containers[0].labels.allowed['chibalete.commit'] === '83489ce');
    ok('mount conocido legible', mounts.containers[0].mounts[0].destination === '/app/data');
    ok('mount readOnly correcto', mounts.containers[0].mounts[1].readOnly === true);

    // ── §12 ──────────────────────────────────────────────────────────────────
    section('§12 Sin residuos temporales');
    const outFile = writeTmp(TMP, 'evidencia.json', containerSummary(inspected));
    ok('el artefacto escrito está limpio', leaks(fs.readFileSync(outFile, 'utf8')).length === 0);
    const dirty = fs.readdirSync(TMP).filter((f) => leaks(fs.readFileSync(path.join(TMP, f), 'utf8')).length > 0);
    ok('ningún archivo del directorio de trabajo contiene material', dirty.length === 0, dirty.join(','));
} finally {
    cleanup(TMP);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
