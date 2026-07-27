/**
 * verify-deploy-config.mjs — CHP-ID-DEPLOY-PREFLIGHT-01A.
 *
 * Falla si cualquier artefacto de despliegue VERSIONADO declara una fuente de
 * usuarios que no sea la canónica del contenedor:
 *
 *   /app/data-critical/usuarios_colegios_oro.json
 *
 * Motivos de fallo:
 *   - declara `data/users_db.json` (padrón LEGACY_NON_CANONICAL);
 *   - declara un USERS_DB distinto del canónico;
 *   - declara USERS_DB vacío;
 *   - declara una ruta relativa.
 *
 * Solo inspecciona archivos versionados: los artefactos ignorados
 * (`deployment_package/`, `_prod_snapshot_/`, `ops/`) son copias históricas que
 * este repositorio no gobierna, y se reportan como aviso sin bloquear.
 *
 *   node scripts/verify-deploy-config.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICAL = '/app/data-critical/usuarios_colegios_oro.json';
const LEGACY_BASENAME = 'users_db.json';

/** Artefactos que describen o construyen el runtime productivo. */
const DEPLOY_PATTERNS = [
    /^docker-compose[\w.-]*\.ya?ml$/i,
    /^Dockerfile[\w.-]*$/i,
    /^ecosystem\.config\.cjs$/i,
    /\.service$/i,
    /^\.env\.example$/i,
    /^scripts\/deploy-[\w-]+\.sh$/i,
    /^scripts\/backup-vps\.sh$/i,
    /^nginx[\w.-]*\.conf$/i,
    /^\.github\/workflows\/[\w-]+\.ya?ml$/i,
];

function trackedFiles() {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf8' });
    return out.split('\0').filter(Boolean);
}

const findings = [];
const add = (file, line, rule, detail) => findings.push({ file, line, rule, detail });

const inspected = [];
for (const rel of trackedFiles()) {
    const normalized = rel.split(path.sep).join('/');
    if (!DEPLOY_PATTERNS.some(p => p.test(normalized) || p.test(path.basename(normalized)))) continue;
    let src;
    try { src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'); } catch { continue; }
    inspected.push(normalized);

    src.split(/\r?\n/).forEach((raw, i) => {
        const lineNo = i + 1;
        const line = raw.trim();
        if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('*')) return;

        // 1. Cualquier mención al padrón legacy en un artefacto productivo.
        if (line.includes(LEGACY_BASENAME)) {
            add(normalized, lineNo, 'LEGACY_STORE_DECLARED',
                'declara el padrón LEGACY_NON_CANONICAL data/users_db.json');
        }

        // 2. Asignaciones explícitas de USERS_DB (YAML `KEY: valor`, env `KEY=valor`).
        const m = line.match(/(?:^|\s|["'])USERS_DB\s*[:=]\s*(.*)$/);
        if (!m) return;
        let value = m[1].trim().replace(/^["']|["'],?$/g, '').replace(/\s+#.*$/, '').trim();

        if (value === '' || value === '${USERS_DB}' || value === '$USERS_DB') {
            add(normalized, lineNo, 'USERS_DB_EMPTY', 'USERS_DB declarado sin valor efectivo');
            return;
        }
        if (!value.startsWith('/')) {
            add(normalized, lineNo, 'USERS_DB_RELATIVE', `ruta relativa: ${value}`);
            return;
        }
        if (value !== CANONICAL) {
            add(normalized, lineNo, 'USERS_DB_NOT_CANONICAL', `${value} != ${CANONICAL}`);
        }
    });
}

// El compose debe montar el directorio canónico donde el runtime lo espera.
const composeFiles = inspected.filter(f => /docker-compose[\w.-]*\.ya?ml$/i.test(f));
for (const rel of composeFiles) {
    const src = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    if (!src.includes('USERS_DB')) continue; // compose sin API (p. ej. solo front)
    const mounts = src.split(/\r?\n/).filter(l => l.includes('data-critical'));
    const target = mounts.find(l => /:\s*\/app\/data-critical(?::|$)/.test(l) || l.includes(':/app/data-critical:'));
    if (!target) {
        add(rel, 0, 'DATA_CRITICAL_MOUNT_MISPLACED',
            'el bind mount de data-critical no apunta a /app/data-critical');
    } else if (/:ro\s*$/.test(target.trim())) {
        add(rel, 0, 'DATA_CRITICAL_MOUNT_READONLY',
            'el padrón canónico está montado :ro; login y alta de usuarios necesitan escritura');
    }
}

// Aviso no bloqueante sobre copias históricas fuera de control de versiones.
const untrackedCopies = [];
for (const dir of ['deployment_package', '_prod_snapshot_']) {
    const abs = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const entry of fs.readdirSync(abs)) {
        if (!/docker-compose[\w.-]*\.ya?ml$/i.test(entry)) continue;
        const src = fs.readFileSync(path.join(abs, entry), 'utf8');
        if (src.includes('USERS_DB') && !src.includes(CANONICAL)) {
            untrackedCopies.push(`${dir}/${entry}`);
        }
    }
}

console.log(`verify-deploy-config — ${inspected.length} artefactos versionados inspeccionados`);
for (const f of inspected) console.log(`  · ${f}`);

if (untrackedCopies.length) {
    console.log('\n  AVISO (no bloqueante) — copias no versionadas con USERS_DB no canónico:');
    for (const f of untrackedCopies) console.log(`      ${f}`);
    console.log('      No se despliega desde estas rutas; se listan para trazabilidad.');
}

if (findings.length === 0) {
    console.log(`\nPASS — todos los artefactos versionados declaran ${CANONICAL}`);
    process.exit(0);
}

console.error(`\nFAIL — ${findings.length} hallazgos:`);
for (const f of findings) {
    console.error(`  ✗ ${f.file}${f.line ? `:${f.line}` : ''} [${f.rule}] ${f.detail}`);
}
process.exit(1);
