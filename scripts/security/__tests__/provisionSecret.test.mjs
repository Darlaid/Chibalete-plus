/**
 * provisionSecret.test.mjs — Provisión humana sin filtraciones.
 *
 * Reproduce el incidente de CHP-SEC-AI-PROVIDER-KEYS-ROTATE-01A: la clave
 * nueva acabó en `/root/.bash_history` porque el operador la metió dentro del
 * prompt de `read`. Aquí se prueba que el procedimiento recomendado no puede
 * repetirlo.
 *
 *   §1  El valor entra por stdin y no aparece en stdout ni stderr
 *   §2  El valor nunca viaja por argv
 *   §3  `--value` y familia son un error duro
 *   §4  El historial de shell del procedimiento recomendado queda limpio
 *   §5  El patrón histórico inseguro SÍ es detectado (el test no miente)
 *   §6  El archivo se crea con su modo final y el contenido exacto
 *   §7  No sobrescribe sin --force
 *   §8  Los metadatos emitidos no contienen el valor
 *   §9  Validación de forma sin revelar contenido
 *
 *   node scripts/security/__tests__/provisionSecret.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanArtifact } from '../scanArtifact.mjs';
import { SECRETS, makeTmpDir, writeTmp, cleanup } from './syntheticFixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', 'provisionSecret.mjs');
const VALUE = SECRETS.GEMINI_API_KEY;          // el que contiene un punto
const NEEDLES = [{ id: 'GEMINI_API_KEY', value: VALUE }];

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};
const section = (n) => console.log(`\n${n}`);
const leaks = (text) => scanArtifact(String(text ?? ''), NEEDLES).length > 0;

const TMP = makeTmpDir('chp-provision-');

try {
    // ── §1 y §2 ──────────────────────────────────────────────────────────────
    section('§1-§2 stdin como único canal');
    const out = path.join(TMP, 'gemini.new');
    const argv = ['--out', out, '--mode', '0400', '--expect-prefix', 'AQ.'];
    const r = spawnSync(process.execPath, [SCRIPT, ...argv], { input: VALUE, encoding: 'utf8' });
    ok('exit 0', r.status === 0, r.stderr);
    ok('stdout sin el valor', !leaks(r.stdout), 'el valor apareció en stdout');
    ok('stderr sin el valor', !leaks(r.stderr));
    ok('argv sin el valor', !leaks([SCRIPT, ...argv].join(' ')));
    ok('el valor sí llegó al archivo', fs.readFileSync(out, 'utf8') === VALUE);

    // ── §3 ───────────────────────────────────────────────────────────────────
    section('§3 Sin secretos por línea de comandos');
    for (const flag of ['--value', '--secret', '--key', '--token', '--password']) {
        const bad = spawnSync(process.execPath, [SCRIPT, '--out', path.join(TMP, 'x'), flag, VALUE],
            { input: '', encoding: 'utf8' });
        ok(`${flag} rechazado`, bad.status === 1 && /no existe/.test(bad.stderr));
        ok(`${flag}: el mensaje de error no repite el valor`, !leaks(bad.stderr));
    }

    // ── §4 y §5 ──────────────────────────────────────────────────────────────
    section('§4-§5 Historial de shell');
    // Lo que un shell registraría del procedimiento RECOMENDADO: la línea de
    // comando no contiene el valor, solo el prompt literal fijo.
    const historialSeguro = [
        'set +o history',
        "read -r -s -p 'Pega el valor y pulsa Enter: ' V",
        'printf %s "$V" | node scripts/security/provisionSecret.mjs --out /root/incoming/gemini.new --mode 0400',
        'unset V',
        'set -o history',
    ].join('\n');
    const histSeguro = writeTmp(TMP, 'bash_history_seguro', historialSeguro);
    ok('el historial del procedimiento recomendado está limpio',
        !leaks(fs.readFileSync(histSeguro, 'utf8')));

    // Lo que ocurrió de verdad el 2026-07-31 (línea 1979): el valor DENTRO del
    // prompt. Si el test no detectara esto, no estaría probando nada.
    // chp-evidence-ratchet: allow reproduccion-del-incidente-en-fixture
    const historialInseguro = `read -r -s -p "${VALUE}" GEMINI_KEY`;
    const histInseguro = writeTmp(TMP, 'bash_history_inseguro', historialInseguro);
    ok('el patrón histórico inseguro SÍ se detecta',
        leaks(fs.readFileSync(histInseguro, 'utf8')));

    // ── §6 ───────────────────────────────────────────────────────────────────
    section('§6 Modo y contenido');
    const st = fs.statSync(out);
    ok('modo 0400 en POSIX', process.platform === 'win32' || (st.mode & 0o777) === 0o400,
        (st.mode & 0o777).toString(8));
    ok('sin salto de línea final', fs.readFileSync(out, 'utf8').endsWith(VALUE));
    ok('tamaño exacto', st.size === Buffer.byteLength(VALUE));

    // ── §7 ───────────────────────────────────────────────────────────────────
    section('§7 No sobrescribe por accidente');
    const dup = spawnSync(process.execPath, [SCRIPT, '--out', out], { input: VALUE, encoding: 'utf8' });
    ok('segundo intento falla', dup.status === 1 && /ya existe/.test(dup.stderr));
    ok('el mensaje no filtra el valor', !leaks(dup.stderr));

    // ── §8 ───────────────────────────────────────────────────────────────────
    section('§8 Metadatos y manifiesto');
    const meta = JSON.parse(r.stdout);
    ok('metadatos sin el valor', !leaks(JSON.stringify(meta)));
    ok('reporta modo, longitud y huella',
        typeof meta.mode === 'string' && meta.length === VALUE.length && meta.fingerprint.length === 16);
    const manifest = writeTmp(TMP, 'manifest.json', { provision: meta, contexto: 'rotación sintética' });
    ok('el manifiesto resultante está limpio', !leaks(fs.readFileSync(manifest, 'utf8')));
    const logLine = `[provision] archivo=${meta.path} modo=${meta.mode} huella=${meta.fingerprint}`;
    ok('una línea de log construida con los metadatos está limpia', !leaks(logLine));

    // ── §9 ───────────────────────────────────────────────────────────────────
    section('§9 Validación de forma');
    const corto = spawnSync(process.execPath, [SCRIPT, '--out', path.join(TMP, 'corto'), '--min-length', '99'],
        { input: VALUE, encoding: 'utf8' });
    ok('rechaza por longitud', corto.status === 1 && /demasiado corto/.test(corto.stderr));
    const prefijo = spawnSync(process.execPath, [SCRIPT, '--out', path.join(TMP, 'pref'), '--expect-prefix', 'sk-'],
        { input: VALUE, encoding: 'utf8' });
    ok('rechaza por prefijo', prefijo.status === 1 && /prefijo esperado/.test(prefijo.stderr));
    ok('los rechazos no filtran el valor', !leaks(corto.stderr + prefijo.stderr));
    const espacios = spawnSync(process.execPath, [SCRIPT, '--out', path.join(TMP, 'esp')],
        { input: 'con espacio adentro', encoding: 'utf8' });
    ok('rechaza valores con espacios', espacios.status === 1);

    // Barrido final del directorio: solo el archivo de destino puede contenerlo.
    const sucios = fs.readdirSync(TMP).filter((f) => {
        const p = path.join(TMP, f);
        return fs.statSync(p).isFile() && leaks(fs.readFileSync(p, 'utf8'));
    });
    ok('solo el archivo de destino y la fixture del patrón inseguro contienen el valor',
        sucios.sort().join(',') === 'bash_history_inseguro,gemini.new', sucios.join(','));
} finally {
    cleanup(TMP);
}

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
