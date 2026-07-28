#!/usr/bin/env node
/**
 * verify-image-integrity.mjs — CHP-RELEASE-IMAGE-01A.
 *
 * Verifica que la imagen API sea COMPLETA, REPRODUCIBLE y LIMPIA.
 *
 * Dos modos:
 *
 *   node scripts/verify-image-integrity.mjs
 *       Sólo el contrato ESTÁTICO (Dockerfile.api + .dockerignore + lockfile).
 *       No requiere Docker: corre en cualquier runner.
 *
 *   node scripts/verify-image-integrity.mjs <imagen>
 *       Además inspecciona la imagen construida: código presente, dependencias
 *       resolubles y versiones alineadas con el lockfile, ausencia de stores y
 *       de secretos. Requiere Docker.
 *
 * Motivación (por qué existe este test):
 *   La imagen `chibalete/api:af319ca` se construía con `npm install` copiando
 *   sólo package.json, sin lockfile, y sin copiar `utils/` ni `engines/`.
 *   Quedó con multer 2.1.1 (el lockfile fija 2.2.0), sin @opentelemetry/core y
 *   sin código que el backend importa en runtime. Sólo arrancaba gracias a
 *   bind mounts de código. Este verificador impide que eso vuelva a ocurrir.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Builtins de Node. Parte del código los importa sin el prefijo `node:`
 *  (`import fs from 'fs'`), que es válido y NO implica una dependencia npm. */
const BUILTINS = new Set(builtinModules);

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE = process.argv[2] || null;

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => {
    if (cond) { console.log('  ✓', label); pass++; }
    else { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
};
const section = (t) => console.log(`\n${t}`);

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ───────────────────────── 1. Contrato del Dockerfile ──────────────────────
section('[1] Dockerfile.api — contrato de build');

const dockerfile = read('Dockerfile.api');
// Líneas efectivas: sin comentarios, que es donde viven las instrucciones.
const instr = dockerfile
    .split('\n')
    .filter(l => !l.trimStart().startsWith('#'))
    .join('\n');

ok('usa `npm ci` (instalación reproducible)', /\bnpm\s+ci\b/.test(instr));
ok('NO usa `npm install` en el build', !/\bnpm\s+install\b/.test(instr),
    'npm install ignora el lockfile y produce imágenes no reproducibles');
ok('copia package-lock.json', /COPY\s+[^\n]*package-lock\.json/.test(instr),
    'sin lockfile en el contexto, npm ci no puede correr');

for (const dir of ['server/', 'utils/', 'engines/']) {
    ok(`copia ${dir} (import de runtime)`,
        new RegExp(`COPY\\s+${dir.replace('/', '\\/')}`).test(instr),
        'el backend lo importa en runtime; sin él la imagen depende de bind mounts');
}

// Directorios que jamás pueden entrar en la imagen.
for (const forbidden of ['data/', 'data-critical/', 'public/uploads', '.env']) {
    const re = new RegExp(`^\\s*COPY\\s+[^\\n]*${forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm');
    ok(`NO copia ${forbidden}`, !re.test(instr));
}

// scripts/ trae ~76 archivos ad-hoc ignorados por git: copiarlo hornea material
// untracked en la imagen y nada del runtime lo importa.
ok('NO copia scripts/', !/^\s*COPY\s+scripts\//m.test(instr),
    'scripts/ contiene archivos untracked; ningún módulo de runtime lo importa');

ok('no bootstrapea stores JSON dentro de la imagen',
    !/\/app\/data\/[a-z_]+\.json/.test(instr),
    'los stores llegan por bind mount; hornearlos crea stores fantasma');

// Base pinneada por digest — nada de tags flotantes.
const froms = [...instr.matchAll(/^\s*FROM\s+(\S+)/gm)].map(m => m[1]);
ok('todas las bases pinneadas por digest', froms.every(f => f.includes('@sha256:')),
    `FROM sin digest: ${froms.filter(f => !f.includes('@sha256:')).join(', ')}`);
const digests = new Set(froms.map(f => f.split('@sha256:')[1]).filter(Boolean));
ok('builder y runtime comparten la misma base (ABI musl compatible)', digests.size === 1,
    `digests distintos: ${[...digests].join(', ')}`);

ok('define HEALTHCHECK', /^\s*HEALTHCHECK/m.test(instr));
ok('define ENTRYPOINT', /^\s*ENTRYPOINT/m.test(instr));
ok('crea el punto de montaje /app/secrets', /mkdir\s+-p\s+\/app\/secrets/.test(instr));
ok('NO hornea ningún admin_secret', !/admin_secret/.test(instr) || !/COPY[^\n]*admin_secret/.test(instr));

// ───────────────────────── 2. .dockerignore ────────────────────────────────
section('[2] .dockerignore — higiene del build context');
const dockerignore = read('.dockerignore').split('\n').map(l => l.trim()).filter(Boolean);
for (const entry of ['data', 'data-critical', 'public/uploads', '.env', 'ops']) {
    ok(`excluye ${entry}`, dockerignore.includes(entry));
}

// ───────────────────────── 3. Lockfile determinístico ──────────────────────
section('[3] package-lock.json — determinismo');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

ok('lockfileVersion >= 3', lock.lockfileVersion >= 3, `v${lock.lockfileVersion}`);
ok('el lockfile describe el árbol completo', Object.keys(lock.packages || {}).length > 100);

// Toda dependencia de producción declarada debe estar fijada en el lockfile.
const missing = [];
for (const dep of Object.keys(pkg.dependencies || {})) {
    if (!lock.packages?.[`node_modules/${dep}`]) missing.push(dep);
}
ok('todas las dependencias de producción están en el lockfile', missing.length === 0,
    missing.join(', '));

// Ningún paquete no-opcional puede excluir linux: rompería npm ci en alpine.
const nonLinux = Object.entries(lock.packages || {})
    .filter(([, v]) => v.os && !v.os.includes('linux') && !v.optional && !v.dev)
    .map(([k]) => k);
ok('ningún paquete obligatorio excluye linux', nonLinux.length === 0, nonLinux.join(', '));

const lockedVersion = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? null;

// ───────────────────────── 4. Imports externos de runtime ──────────────────
section('[4] Imports externos declarados');

const RUNTIME_DIRS = ['server', 'utils', 'engines'];
const EXT_RE = /(?:^|\s)(?:import\s[^'"]*from\s*|import\s*|export\s[^'"]*from\s*)['"]([^'".][^'"]*)['"]|require\(\s*['"]([^'".][^'"]*)['"]\s*\)/g;

function walk(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'node_modules' || e.name === '__test__' || e.name === '__tests__') continue;
            walk(p, acc);
        } else if (/\.(js|mjs|cjs)$/.test(e.name)) acc.push(p);
    }
    return acc;
}

const externals = new Set();
for (const d of RUNTIME_DIRS) {
    const abs = path.join(REPO_ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs)) {
        const src = fs.readFileSync(file, 'utf8');
        for (const m of src.matchAll(EXT_RE)) {
            const spec = m[1] || m[2];
            if (!spec || spec.startsWith('node:') || spec.startsWith('.') || spec.startsWith('/')) continue;
            // paquete raíz: 'a/b/c' → 'a'; '@scope/pkg/sub' → '@scope/pkg'
            const parts = spec.split('/');
            const root = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
            if (BUILTINS.has(root)) continue; // builtin sin prefijo node:
            externals.add(root);
        }
    }
}
const externalList = [...externals].sort();
console.log(`  · ${externalList.length} paquetes externos importados en runtime`);

const notLocked = externalList.filter(n => !lockedVersion(n));
ok('todo import externo de runtime está en el lockfile', notLocked.length === 0, notLocked.join(', '));

// ───────────────────────── 5. Imagen construida ────────────────────────────
if (!IMAGE) {
    section('[5] Imagen — OMITIDO (no se pasó tag)');
    console.log('  · ejecuta: node scripts/verify-image-integrity.mjs <imagen>');
} else {
    section(`[5] Imagen construida — ${IMAGE}`);

    const inImage = (shellCmd) => {
        try {
            return execFileSync('docker',
                ['run', '--rm', '--entrypoint', 'sh', IMAGE, '-c', shellCmd],
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        } catch (e) {
            return `__ERR__${(e.stdout || '') + (e.stderr || e.message)}`;
        }
    };

    // 5.1 código completo
    const listing = inImage('ls /app');
    ok('/app/server presente', /(^|\n)server(\n|$)/.test(listing), listing);
    ok('/app/utils presente', /(^|\n)utils(\n|$)/.test(listing), listing);
    ok('/app/engines presente', /(^|\n)engines(\n|$)/.test(listing), listing);
    ok('/app/node_modules presente', /(^|\n)node_modules(\n|$)/.test(listing));
    ok('package-lock.json embarcado', /(^|\n)package-lock\.json(\n|$)/.test(listing));

    const engineFiles = inImage('ls /app/engines/metrics 2>/dev/null');
    ok('engines/metrics/referenceEngine.mjs presente', engineFiles.includes('referenceEngine.mjs'), engineFiles);
    ok('engines/metrics/eventContract.mjs presente', engineFiles.includes('eventContract.mjs'), engineFiles);

    const entry = inImage('test -f /app/server/server.js && echo yes || echo no');
    ok('entrypoint server/server.js presente', entry === 'yes');

    // 5.2 ningún directorio protegido ni material untracked dentro de la imagen
    for (const p of ['/app/data', '/app/data-critical', '/app/public/uploads', '/app/scripts']) {
        const r = inImage(`test -e ${p} && echo present || echo absent`);
        ok(`${p} NO está en la imagen`, r === 'absent',
            r === 'present' ? 'un store horneado en la imagen es un store fantasma' : r);
    }

    // 5.3 ausencia de secretos
    const envFile = inImage('test -e /app/.env && echo present || echo absent');
    ok('/app/.env ausente', envFile === 'absent');
    const secretContent = inImage('ls -A /app/secrets 2>/dev/null | wc -l');
    ok('/app/secrets vacío (el secreto llega por mount)', secretContent === '0', secretContent);
    const keyFiles = inImage("find /app -maxdepth 3 -name '*.pem' -o -maxdepth 3 -name '*.key' -o -maxdepth 3 -name 'admin_secret' 2>/dev/null | head -5");
    ok('sin material criptográfico embarcado', keyFiles === '' || keyFiles.startsWith('__ERR__') === false && keyFiles.length === 0, keyFiles);

    // 5.4 versiones alineadas con el lockfile
    const CHECK_VERSIONS = ['multer', '@opentelemetry/core', 'express', 'better-sqlite3', 'zod', 'helmet'];
    for (const name of CHECK_VERSIONS) {
        const expected = lockedVersion(name);
        if (!expected) continue;
        const actual = inImage(`node -p "require('/app/node_modules/${name}/package.json').version" 2>/dev/null`);
        ok(`${name} == ${expected} (lockfile)`, actual === expected, `imagen: ${actual}`);
    }

    // 5.5 todos los imports externos resolubles DENTRO de la imagen
    const probe = externalList
        .map(n => `(async()=>{try{await import('${n}');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND'&&!/Cannot find (module|package)/.test(e.message)){return;}console.log('MISSING:${n}');}})()`)
        .join(';');
    const missingInImage = inImage(
        `cd /app && node --input-type=module -e "${probe.replace(/"/g, '\\"')}" 2>/dev/null | grep '^MISSING:' || true`
    );
    ok('todos los imports externos resuelven en la imagen',
        missingInImage === '' || !missingInImage.includes('MISSING:'),
        missingInImage);

    // 5.6 sin npm en runtime
    const npmGone = inImage('command -v npm >/dev/null 2>&1 && echo present || echo absent');
    ok('npm removido del runtime', npmGone === 'absent');
}

// ───────────────────────── Resultado ───────────────────────────────────────
console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — image-integrity: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
