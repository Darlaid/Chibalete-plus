/**
 * releasePackage.test.mjs — CHP-ID-METRICS-DEPLOY-01A-R1.
 *
 * Cierra los dos bloqueos del intento anterior de despliegue:
 *
 *   §A  el manifiesto rebasado coincide con la fotografía productiva (647)
 *   §B  el usuario legítimo nuevo y su membresía quedan fuera del alcance
 *   §C  las operaciones siguen siendo exactamente tres
 *   §D  dry-run idempotente sobre fixtures que replican la foto actual
 *   §E  entrega de engines/: mount en TODAS las API, read-only, empaquetado
 *   §F  resolución ESM /app/server/metrics → /app/engines/metrics
 *   §G  inventario de release con sha256
 *   §H  trazabilidad de health: commit y deployed_at
 *
 * Fixtures sintéticas en mkdtemp. Ningún test toca stores reales.
 *
 *   node scripts/__test__/releasePackage.test.mjs
 */
import '../../server/__test__/helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const MIGRATION_DIR = path.join(REPO_ROOT, 'scripts', 'migrations', 'chp-id-recon-01b');
const MANIFEST_PATH = path.join(MIGRATION_DIR, 'manifest.json');

const { runMigration, MigrationStop } = await import(pathToFileURL(path.join(MIGRATION_DIR, 'migrate.mjs')).href);
const { splitComposeServices } = await import(pathToFileURL(path.join(REPO_ROOT, 'scripts', 'verify-deploy-config.mjs')).href)
    .catch(() => ({ splitComposeServices: null }));
const { assertHealthTraceability, getHealthDefaults } =
    await import(pathToFileURL(path.join(REPO_ROOT, 'server', 'healthHandler.js')).href);

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));

console.log('releasePackage — CHP-ID-METRICS-DEPLOY-01A-R1');

// ── §A Manifiesto rebasado ──────────────────────────────────────────────────
console.log('\n[A] manifiesto rebasado');
{
    ok('estado declara el rebase', manifest.status.includes('REBASED_AFTER_LEGITIMATE_USER_CREATION'));
    ok('sigue siendo DRY_RUN_ONLY y NOT_APPLIED',
        manifest.status.includes('DRY_RUN_ONLY') && manifest.status.includes('NOT_APPLIED'));
    const users = manifest.expectedInputs['data-critical/usuarios_colegios_oro.json'];
    ok('baseline de usuarios = 647', users.records === 647, String(users.records));
    ok('bytes de usuarios actualizados', users.bytes === 333011, String(users.bytes));
    ok('el hash de usuarios ya no es el caducado', !users.sha256.startsWith('43cf26f2'));
    const groups = manifest.expectedInputs['data/groups_db.json'];
    ok('grupos siguen siendo 20', groups.records === 20);
    ok('bytes de grupos actualizados', groups.bytes === 36868 && !groups.sha256.startsWith('870b4bfb'));
    const schools = manifest.expectedInputs['data/schools_db.json'];
    ok('instituciones intactas (hash sin cambio)',
        schools.sha256 === '7b7f269ff50e320e9f703c0c9b01ef6cd608642354c3767b03c18980ceef9e17'
        && schools.records === 3);
    ok('los tres sha256 son completos (64 hex)',
        Object.values(manifest.expectedInputs).every(v => /^[0-9a-f]{64}$/.test(v.sha256)));
    ok('queda registrada la evidencia del rebase',
        !!manifest.rebaseEvidence?.referenceSnapshot && !!manifest.rebaseEvidence.usersDelta);
}

// ── §B El usuario nuevo queda fuera del alcance ─────────────────────────────
console.log('\n[B] usuario legítimo preservado');
{
    const raw = JSON.stringify(manifest.operations);
    ok('ninguna operación toca groupIds', !/groupIds/.test(JSON.stringify(manifest.operations.map(o => o.set))));
    ok('ninguna operación toca memberIds ni studentIds',
        !/memberIds|studentIds/.test(JSON.stringify(manifest.operations.map(o => o.set))));
    ok('ninguna operación selecciona por id de usuario', !/"id"\s*:\s*"user-/.test(raw));
    ok('los invariantes declaran que el alta no se modifica',
        manifest.invariants.some(i => /no se modifica: ninguna operación lo selecciona/.test(i)));
    ok('los invariantes declaran que la membresía se preserva',
        manifest.invariants.some(i => /membresía añadida.*se preserva/i.test(i)));
    ok('explicitlyNotDone registra la decisión del rebase',
        manifest.explicitlyNotDone.some(x => x.decision === 'rebase-01A-R1' && x.affectedUsers === 1));
    ok('el manifiesto no contiene PII', !/@[\w.-]+\.\w{2,}/.test(fs.readFileSync(MANIFEST_PATH, 'utf8')));
}

// ── §C Alcance: exactamente tres operaciones ────────────────────────────────
console.log('\n[C] alcance sin ampliar');
{
    ok('exactamente 3 operaciones', manifest.operations.length === 3);
    ok('son las aprobadas',
        manifest.operations.map(o => o.id).join(',')
        === 'OP-A-EXTERNADO-REGISTRO,OP-B-EXTERNADO-MEDIADORES,OP-C-GRUPO-101-ID');
    ok('ninguna operación escribe schoolId', !/schoolId/.test(JSON.stringify(manifest.operations)));
    ok('ninguna operación elimina registros',
        manifest.operations.every(o => ['append', 'setFieldWhere'].includes(o.kind)));
}

// ── §D Dry-run idempotente sobre la foto rebasada ───────────────────────────
console.log('\n[D] dry-run');
function makeFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rel_fx_'));
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data-critical'), { recursive: true });
    // Réplica a escala: incluye el "usuario nuevo" con su membresía inversa.
    const schools = [{ id: 'org-a', name: 'Alfa', createdAt: '2026-01-01T00:00:00.000Z' }];
    const groups = [
        { name: 'Grupo 101', school: 'Colegio Test', grade: '10', teacherId: 'teacher-1', studentIds: [], memberIds: [] },
        { id: 'g-real', school: 'Alfa', organizationId: 'org-a', memberIds: ['u-nuevo'], studentIds: ['u-nuevo'] },
    ];
    const users = [
        { id: 'u-a', colegio: 'Externado', roles: ['mediador'], accountStatus: 'active' },
        { id: 'u-b', colegio: 'Externado', roles: ['mediador'], accountStatus: 'active' },
        { id: 'u-nuevo', colegio: 'Alfa', roles: ['mediador'], organizationId: 'org-a',
          groupIds: ['g-real'], accountStatus: 'active', lastLoginAt: '2026-07-27T12:00:00.000Z' },
    ];
    const w = (rel, d) => fs.writeFileSync(path.join(root, rel), JSON.stringify(d, null, 2) + '\n');
    w('data/schools_db.json', schools);
    w('data/groups_db.json', groups);
    w('data-critical/usuarios_colegios_oro.json', users);
    const m = JSON.parse(JSON.stringify(manifest));
    for (const rel of Object.keys(m.expectedInputs)) {
        const buf = fs.readFileSync(path.join(root, rel));
        m.expectedInputs[rel] = { sha256: sha256(buf), bytes: buf.length,
                                  records: JSON.parse(buf.toString('utf8')).length };
    }
    m.operations.find(o => o.id === 'OP-A-EXTERNADO-REGISTRO').guard.expectedRecordsBefore = 1;
    return { root, m };
}
{
    const { root, m } = makeFixture();
    const snap = () => Object.keys(m.expectedInputs).map(r => sha256(fs.readFileSync(path.join(root, r))));
    const before = snap();

    const r1 = runMigration({ root, manifest: m });
    ok('modo por defecto dry-run', r1.mode === 'DRY_RUN' && r1.applied === false);
    ok('3 operaciones y 4 registros', r1.diff.length === 3 && r1.totalChanges === 4, String(r1.totalChanges));
    ok('cero escrituras', r1.written.length === 0 && snap().join() === before.join());

    const r2 = runMigration({ root, manifest: m });
    ok('segundo dry-run determinístico', JSON.stringify(r1.diff) === JSON.stringify(r2.diff));

    // Apply sintético: comprobar que el usuario nuevo y su membresía sobreviven.
    const applied = runMigration({ root, manifest: m, apply: true, backupEvidence: 'GREEN' });
    ok('apply sintético ejecuta las 3 operaciones', applied.applied === true && applied.totalChanges === 4);
    const users = JSON.parse(fs.readFileSync(path.join(root, 'data-critical/usuarios_colegios_oro.json'), 'utf8'));
    const groups = JSON.parse(fs.readFileSync(path.join(root, 'data/groups_db.json'), 'utf8'));
    const nuevo = users.find(u => u.id === 'u-nuevo');
    ok('el usuario nuevo conserva TODOS sus campos',
        nuevo.colegio === 'Alfa' && nuevo.organizationId === 'org-a'
        && JSON.stringify(nuevo.groupIds) === JSON.stringify(['g-real'])
        && nuevo.lastLoginAt === '2026-07-27T12:00:00.000Z'
        && nuevo.accountStatus === 'active');
    ok('la membresía inversa sobrevive',
        groups.find(g => g.id === 'g-real').memberIds.includes('u-nuevo')
        && groups.find(g => g.id === 'g-real').studentIds.includes('u-nuevo'));
    ok('los conteos no cambian', users.length === 3 && groups.length === 2);
    ok('Grupo 101 recibió el id fijo',
        groups.find(g => g.name === 'Grupo 101').id === 'group-historical-grupo-101');
    const applied2 = runMigration({ root, manifest: { ...m, expectedInputs: Object.fromEntries(
        Object.keys(m.expectedInputs).map(rel => {
            const buf = fs.readFileSync(path.join(root, rel));
            return [rel, { sha256: sha256(buf), bytes: buf.length, records: JSON.parse(buf.toString('utf8')).length }];
        })) }, apply: true, backupEvidence: 'GREEN' });
    ok('segunda aplicación = cero cambios', applied2.totalChanges === 0 && applied2.idempotent === true);
    fs.rmSync(root, { recursive: true, force: true });
}

// ── §E Entrega de engines/ ──────────────────────────────────────────────────
console.log('\n[E] mount de engines');
{
    const composePath = path.join(REPO_ROOT, 'docker-compose.prod.yml');
    const src = fs.readFileSync(composePath, 'utf8');
    ok('el compose declara el mount de engines', /\/var\/www\/chibalete\/engines:\/app\/engines:ro/.test(src));

    ok('splitComposeServices está disponible', typeof splitComposeServices === 'function');
    const services = splitComposeServices(src);
    const apiServices = services.filter(([, b]) => /\bUSERS_DB\b/.test(b));
    ok('se detecta al menos un servicio API', apiServices.length >= 1);
    ok('TODOS los servicios API declaran el mount',
        apiServices.every(([, b]) => /:\s*\/app\/engines:ro/.test(b)),
        apiServices.map(([n]) => n).join(','));

    // El verificador debe FALLAR si falta el mount, si no es /app/engines o si no es ro.
    const run = (contents) => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'compose_'));
        const f = path.join(tmp, 'docker-compose.prod.yml');
        fs.writeFileSync(f, contents);
        const svc = splitComposeServices(contents).filter(([, b]) => /\bUSERS_DB\b/.test(b));
        const bad = svc.filter(([, b]) => {
            const lines = b.split('\n').filter(l => /\/engines\b/.test(l) && l.trim().startsWith('-'));
            const m = lines.find(l => /:\s*\/app\/engines(?::|$)/.test(l));
            return !m || !/:ro\s*$/.test(m.trim());
        });
        fs.rmSync(tmp, { recursive: true, force: true });
        return bad.length > 0;
    };
    ok('detecta mount ausente', run(src.replace(/\s*- \/var\/www\/chibalete\/engines:\/app\/engines:ro/, '')));
    ok('detecta destino incorrecto', run(src.replace('/app/engines:ro', '/engines:ro')));
    ok('detecta que no sea read-only', run(src.replace('/app/engines:ro', '/app/engines:rw')));

    // Topología real de producción: DOS API. Si el mount está solo en una, el
    // balanceador serviría v2 de forma intermitente según a quién enrutara.
    const dosApis = (segundaConMount) => [
        'services:',
        '  api_1:',
        '    environment:',
        '      USERS_DB: /app/data-critical/usuarios_colegios_oro.json',
        '    volumes:',
        '      - /var/www/chibalete/data-critical:/app/data-critical:rw',
        '      - /var/www/chibalete/engines:/app/engines:ro',
        '  api_2:',
        '    environment:',
        '      USERS_DB: /app/data-critical/usuarios_colegios_oro.json',
        '    volumes:',
        '      - /var/www/chibalete/data-critical:/app/data-critical:rw',
        ...(segundaConMount ? ['      - /var/www/chibalete/engines:/app/engines:ro'] : []),
        'volumes:',
        '  data-volume:',
    ].join('\n');
    ok('el parser detecta los dos servicios API',
        splitComposeServices(dosApis(true)).filter(([, b]) => /USERS_DB/.test(b)).length === 2);
    ok('detecta mount en una sola API', run(dosApis(false)));
    ok('acepta el mount en ambas API', run(dosApis(true)) === false);
}

// ── §F Resolución ESM y paquete ─────────────────────────────────────────────
console.log('\n[F] resolución de imports y empaquetado');
{
    const routerPath = path.join(REPO_ROOT, 'server', 'metrics', 'metricsRouterV2.mjs');
    const src = fs.readFileSync(routerPath, 'utf8');
    const specs = [...src.matchAll(/from\s+'(\.\.?\/[^']+)'/g)].map(m => m[1]);
    ok('el router importa engines/metrics', specs.some(s => s.includes('engines/metrics')));
    for (const spec of specs) {
        const resolved = path.resolve(path.dirname(routerPath), spec);
        ok(`resuelve ${spec}`, fs.existsSync(resolved));
        const top = path.relative(REPO_ROOT, resolved).split(path.sep)[0];
        ok(`${spec} vive en un directorio empaquetado (${top})`,
            ['server', 'utils', 'types', 'engines'].includes(top));
    }

    // Smoke de resolución que reproduce el layout del contenedor:
    // /app/server/metrics/metricsRouterV2.mjs → /app/engines/metrics/*
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'app_layout_'));
    for (const d of ['server/metrics', 'server/identity', 'server/aulaViva', 'engines/metrics', 'utils']) {
        fs.mkdirSync(path.join(appRoot, d), { recursive: true });
    }
    const copy = (rel) => fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(appRoot, rel));
    for (const rel of ['engines/metrics/eventContract.mjs', 'engines/metrics/referenceEngine.mjs']) copy(rel);
    // Un módulo mínimo que reproduce exactamente el import relativo del router.
    fs.writeFileSync(path.join(appRoot, 'server/metrics/probe.mjs'),
        "import { IDLE_MS } from '../../engines/metrics/eventContract.mjs';\n"
        + "import { CONTRACT_VERSION } from '../../engines/metrics/referenceEngine.mjs';\n"
        + "console.log(JSON.stringify({ idle: IDLE_MS, contract: CONTRACT_VERSION }));\n");
    const r = spawnSync(process.execPath, [path.join(appRoot, 'server/metrics/probe.mjs')], { encoding: 'utf8' });
    ok('el layout /app resuelve los imports del router',
        r.status === 0 && /"contract":2/.test(r.stdout), (r.stderr || '').split('\n')[0]);

    // Sin engines/ el mismo import falla: prueba de que el mount es necesario.
    fs.rmSync(path.join(appRoot, 'engines'), { recursive: true, force: true });
    const r2 = spawnSync(process.execPath, [path.join(appRoot, 'server/metrics/probe.mjs')], { encoding: 'utf8' });
    ok('sin engines/ el import falla (el mount NO es opcional)',
        r2.status !== 0 && /ERR_MODULE_NOT_FOUND|Cannot find module/.test(r2.stderr));
    fs.rmSync(appRoot, { recursive: true, force: true });

    // El release debe empaquetar engines.
    const deploySrc = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'deploy-backend.sh'), 'utf8');
    ok('deploy-backend copia engines/', /for d in server utils types engines/.test(deploySrc));
    ok('deploy-backend tarea engines/', /-C "\$pkg_root" server utils types engines/.test(deploySrc));
    ok('deploy-backend valida que los módulos del motor viajen',
        /paquete incompleto: falta \$f/.test(deploySrc));
    ok('deploy-backend sigue escribiendo .deploy-info', /\.deploy-info/.test(deploySrc));
}

// ── §G Inventario de release ────────────────────────────────────────────────
console.log('\n[G] inventario de release');
{
    const files = ['engines/metrics/eventContract.mjs', 'engines/metrics/referenceEngine.mjs'];
    const inv = files.map(rel => ({
        repo: rel,
        host: `/var/www/chibalete/${rel}`,
        container: `/app/${rel}`,
        sha256: sha256(fs.readFileSync(path.join(REPO_ROOT, rel))),
    }));
    ok('el inventario cubre los dos módulos del motor', inv.length === 2);
    ok('todos tienen sha256 de 64 hex', inv.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
    ok('las rutas de contenedor son /app/engines/metrics/*',
        inv.every(f => f.container.startsWith('/app/engines/metrics/')));
    ok('no se empaqueta ningún archivo de datos',
        inv.every(f => !/data\/|data-critical\/|uploads\//.test(f.repo)));
    for (const f of inv) console.log(`      ${f.repo} ${f.sha256.slice(0, 16)}…`);
}

// ── §H Trazabilidad de health ───────────────────────────────────────────────
console.log('\n[H] trazabilidad de health');
{
    const okCase = { commit: 'a1b2c3d4e5f6', deployed_at: '2026-07-27T12:00:00Z' };
    ok('commit y deployed_at válidos → trazable',
        assertHealthTraceability(okCase, { nodeEnv: 'production' }).traceable === true);
    ok('commit ausente → COMMIT_MISSING',
        assertHealthTraceability({ commit: null, deployed_at: okCase.deployed_at }, { nodeEnv: 'production' })
            .problems.includes('COMMIT_MISSING'));
    ok('deployed_at ausente → DEPLOYED_AT_MISSING',
        assertHealthTraceability({ commit: okCase.commit, deployed_at: null }, { nodeEnv: 'production' })
            .problems.includes('DEPLOYED_AT_MISSING'));
    ok('commit con formato inválido se detecta',
        assertHealthTraceability({ commit: 'no-es-un-sha', deployed_at: okCase.deployed_at }, { nodeEnv: 'production' })
            .problems.includes('COMMIT_INVALID_FORMAT'));
    ok('deployed_at inválido se detecta',
        assertHealthTraceability({ commit: okCase.commit, deployed_at: 'ayer' }, { nodeEnv: 'production' })
            .problems.includes('DEPLOYED_AT_INVALID'));
    ok('producción NO acepta commit null',
        assertHealthTraceability({ commit: null, deployed_at: null }, { nodeEnv: 'production' }).enforced === true);
    ok('desarrollo permite el fallback explícito',
        assertHealthTraceability({ commit: null, deployed_at: null }, { nodeEnv: 'development' }).enforced === false);

    const defaults = getHealthDefaults();
    ok('getHealthDefaults expone commit y deployed_at',
        'commit' in defaults && 'deployed_at' in defaults);
    ok('el payload de health no expone secretos',
        !/password|secret|token|apiKey/i.test(JSON.stringify(defaults)));
}

// ── §I Aislamiento ──────────────────────────────────────────────────────────
console.log('\n[I] aislamiento');
{
    for (const rel of ['data/users_db.json', 'data/groups_db.json']) {
        const p = path.join(REPO_ROOT, rel);
        ok(`ningún respaldo de migración sobre ${rel}`, !fs.existsSync(`${p}.pre-CHP-ID-RECON-01B`));
    }
    ok('el migrador sigue exigiendo --root', (() => {
        try { runMigration({}); return false; } catch (e) { return e instanceof MigrationStop && e.code === 'ROOT_REQUIRED'; }
    })());
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} ok, ${fail} fallidos`);
process.exit(fail === 0 ? 0 : 1);
