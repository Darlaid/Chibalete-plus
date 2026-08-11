/**
 * prunePolicy.test.mjs — guarda estatica de la limpieza automatica de Docker.
 *
 * Inspecciona el fichero VERSIONADO real (ops/maintenance/docker-image-prune),
 * no una copia inventada. Nunca ejecuta un prune.
 *
 * Existe porque el 2026-08-11 la tarea automatica, que llevaba `-a`, borro
 * `chibalete/api:2945fa8` — la imagen de rollback del despliegue vivo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CRON = path.join(HERE, '..', 'docker-image-prune');

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.log(`  ✗ ${label}${hint ? ` — ${hint}` : ''}`); fail++; }
};

console.log('§1 El fichero versionado existe y es la fuente de verdad');
ok('ops/maintenance/docker-image-prune está versionado', fs.existsSync(CRON));
const raw = fs.readFileSync(CRON, 'utf8');
/** Lineas efectivas: sin comentarios ni vacias. */
const lines = raw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
ok('declara exactamente una tarea', lines.length === 1, `hay ${lines.length}`);
const job = lines[0] ?? '';

console.log('\n§2 Prohibiciones duras');
// `-af`, `-a`, `--all` en cualquier posicion del comando de prune.
ok('no usa `image prune -a` ni `--all`',
    !/image\s+prune\b[^|;]*(\s-\w*a\w*\b|--all\b)/.test(job),
    job);
ok('no usa `docker system prune`', !/system\s+prune/.test(job), job);
ok('no usa `container prune`', !/container\s+prune/.test(job), job);
ok('no usa `builder prune`', !/builder\s+prune/.test(job), job);
ok('no usa `volume prune` ni `--volumes`',
    !/volume\s+prune/.test(job) && !/--volumes\b/.test(job), job);
// Ningun prune puede tocar rutas de datos.
for (const p of ['data/', 'data-critical/', 'uploads', 'identity']) {
    ok(`no menciona ${p}`, !job.includes(p), job);
}

console.log('\n§3 La politica permitida conserva imagenes etiquetadas');
ok('es un `docker image prune`', /docker\s+image\s+prune\b/.test(job), job);
ok('lleva `-f` (no interactivo)', /\s-f\b|\s--force\b/.test(job), job);
ok('acota por antiguedad con --filter until=',
    /--filter\s+"?until=/.test(job), job);
// Sin `-a`, docker elimina SOLO imagenes dangling: las etiquetadas sobreviven.
ok('sin `-a`, el alcance queda limitado a imagenes dangling',
    /docker\s+image\s+prune\b/.test(job) && !/(\s-\w*a\w*\b|--all\b)/.test(job.split('--filter')[0]),
    job);

console.log('\n§4 Formato de cron.d valido');
ok('tiene 5 campos de schedule más usuario y comando',
    /^(\S+\s+){5}root\s+docker\b/.test(job), job);
ok('el usuario es root', /\sroot\s+docker\b/.test(job), job);

console.log('\n§5 El motivo queda documentado en el propio fichero');
ok('explica por que no lleva `-a`', /no\s+lleva\s+`?-a`?|por\s+que\s+NO/i.test(raw));
ok('nombra el incidente que lo motivo', raw.includes('2945fa8'));
ok('remite a la unidad', raw.includes('CHP-OPS-ROLLBACK-IMAGE-RETENTION-01'));

console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
