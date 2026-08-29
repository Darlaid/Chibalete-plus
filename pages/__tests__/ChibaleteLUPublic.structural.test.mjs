/**
 * ChibaleteLUPublic.structural.test.mjs — CHP-IDENTITY-FIELD-PUBLIC-DOWNLOAD-PAGE-01B.
 *
 * `/chibalete-lu` pasa a ser la URL pública y estable de campaña. Este test
 * bloquea las tres cosas que la hacen segura: que sea pública, que se renderice
 * AISLADA (sin Navbar ni Chatbot) y que el destino del APK esté validado.
 *
 * Tests estructurales del router/guard/copy + tests behavioral de `isSafeApkUrl`
 * (pure function; se porta inline igual que en EditorialCover.structural, y §4
 * fija en el .tsx las reglas que el port replica, para que no puedan divergir en
 * silencio).
 *
 *   §1  routePermissions: /chibalete-lu es 'public' y nada más cambió
 *   §2  App.tsx: ruta sin <Layout> (ni Navbar ni Chatbot) y con el guard puesto
 *   §3  guard intacto: authenticated / admin / no registrada siguen protegidas
 *   §4  isSafeApkUrl existe en el .tsx con las reglas que este test replica
 *   §5  isSafeApkUrl acepta lo válido
 *   §6  isSafeApkUrl rechaza lo inseguro
 *   §7  sin destino válido no se renderiza <a download>, y queda el reintento
 *   §8  copy de actualización obligatorio
 *   §9  config.notes NO se renderiza
 *  §10  flujo anónimo no emite telemetría
 *
 *   node pages/__tests__/ChibaleteLUPublic.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root        = path.join(__dirname, '..', '..');
const tsxPath     = path.join(root, 'pages', 'ChibaleteLU.tsx');
const appPath     = path.join(root, 'App.tsx');
const permsPath   = path.join(root, 'config', 'routePermissions.ts');
const guardPath   = path.join(root, 'components', 'ProtectedRoute.tsx');
const analytics   = path.join(root, 'hooks', 'useLuAnalytics.ts');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('ChibaleteLU — página pública de descarga (01B)');

const src      = fs.readFileSync(tsxPath, 'utf8');
const appSrc   = fs.readFileSync(appPath, 'utf8');
const permsSrc = fs.readFileSync(permsPath, 'utf8');
const guardSrc = fs.readFileSync(guardPath, 'utf8');

// Bloque de la entrada /chibalete-lu en routePermissions.
const luPermBlock = (permsSrc.match(/\{[^{}]*path:\s*'\/chibalete-lu'[^{}]*\}/) || [''])[0];
// Bloque JSX de la <Route path="/chibalete-lu"> en App.tsx.
const luRouteBlock = (appSrc.match(/<Route path="\/chibalete-lu"[\s\S]*?\/>/) || [''])[0];

// ── §1 ─────────────────────────────────────────────────────────────────────
section('[1] routePermissions: /chibalete-lu público');
ok('la entrada existe',                       luPermBlock.length > 0);
ok("access: 'public'",                        /access:\s*'public'/.test(luPermBlock));
ok('ya no es authenticated',                  !/access:\s*'authenticated'/.test(luPermBlock));
ok('la descripción la marca como pública',    /p[úu]blica/i.test(luPermBlock));
// Ninguna otra ruta se volvió pública: solo /bienvenida, /auth y /chibalete-lu.
const publicPaths = [...permsSrc.matchAll(/path:\s*'([^']+)',\s*\n\s*access:\s*'public'/g)].map(m => m[1]).sort();
ok('exactamente 3 rutas públicas',            publicPaths.length === 3, `encontradas: ${publicPaths.join(', ')}`);
ok('son /auth, /bienvenida y /chibalete-lu',  publicPaths.join(',') === '/auth,/bienvenida,/chibalete-lu', publicPaths.join(','));

// ── §2 ─────────────────────────────────────────────────────────────────────
section('[2] App.tsx: ruta pública aislada');
ok('la <Route> existe',                       luRouteBlock.length > 0);
ok('conserva el guard con getRouteAccess',    /ProtectedRoute access=\{getRouteAccess\('\/chibalete-lu'\)\}/.test(luRouteBlock));
ok('NO envuelve en <Layout>',                 !/<Layout>/.test(luRouteBlock));
ok('NO monta Navbar directamente',            !/<Navbar/.test(luRouteBlock));
ok('NO monta Chatbot directamente',           !/<Chatbot/.test(luRouteBlock));
ok('renderiza <ChibaleteLU />',               /<ChibaleteLU\s*\/>/.test(luRouteBlock));
ok('contenedor con min-h-screen',             /min-h-screen/.test(luRouteBlock));
ok('fondo definido en claro y oscuro',        /bg-gray-100/.test(luRouteBlock) && /dark:bg-gray-900/.test(luRouteBlock));
ok('texto definido en claro y oscuro',        /text-gray-900/.test(luRouteBlock) && /dark:text-white/.test(luRouteBlock));
ok('ancho responsive (w-full)',               /w-full/.test(luRouteBlock));

// ── §3 ─────────────────────────────────────────────────────────────────────
section('[3] no regresión del guard');
ok('ProtectedRoute mantiene rama public',     /effectiveAccess\.type === 'public'/.test(guardSrc));
ok('sin sesión redirige a /bienvenida',       /Navigate to="\/bienvenida"/.test(guardSrc));
ok('rutas no registradas → deny',             /return \{ type: 'deny' \}/.test(guardSrc));
ok('deny redirige y no renderiza',            /effectiveAccess\.type === 'deny'/.test(guardSrc));
ok('roles se verifican con canAccessAny',     /canAccessAny\(user, effectiveAccess\.roles\)/.test(guardSrc));
// Rutas privadas de muestra siguen protegidas en routePermissions.
for (const [p, level] of [['/biblioteca', 'authenticated'], ['/aula-viva', 'authenticated'], ['/admin-dashboard', 'admin']]) {
    const block = (permsSrc.match(new RegExp(`\\{[^{}]*path:\\s*'${p}'[^{}]*\\}`)) || [''])[0];
    ok(`${p} sigue en '${level}'`,            new RegExp(`access:\\s*'${level}'`).test(block), block.slice(0, 80));
}
// Todas las rutas de App.tsx salvo las públicas siguen envueltas en Layout.
const layoutCount = (appSrc.match(/<Layout>/g) || []).length;
ok('el resto de rutas conserva <Layout>',     layoutCount >= 20, `<Layout> encontrados: ${layoutCount}`);

// ── §4 ─────────────────────────────────────────────────────────────────────
section('[4] isSafeApkUrl: contrato fijado en el .tsx');
ok('exporta isSafeApkUrl',                    /export function isSafeApkUrl/.test(src));
ok('compara origin contra el de la página',   /target\.origin !== base\.origin/.test(src));
ok('exige https salvo localhost',             /protocol !== 'https:'/.test(src) && /isLocalhost/.test(src));
ok('rechaza credenciales',                    /username !== ''/.test(src) && /password !== ''/.test(src));
ok('rechaza query y fragmento',               /search !== ''/.test(src) && /hash !== ''/.test(src));
ok('exige /uploads/ o /downloads/',           /'\/uploads\/'/.test(src) && /'\/downloads\/'/.test(src));
ok('exige sufijo .apk',                       /endsWith\('\.apk'\)/.test(src));

// Port inline del validador (mismas reglas que el .tsx; §4 las fija allí).
function isSafeApkUrl(rawUrl, pageOrigin) {
    if (typeof rawUrl !== 'string' || rawUrl.trim() === '') return false;
    let base, target;
    try {
        base = new URL(pageOrigin);
        target = new URL(rawUrl, base);
    } catch { return false; }
    if (target.origin !== base.origin) return false;
    const isLocalhost = target.hostname === 'localhost' || target.hostname === '127.0.0.1';
    if (target.protocol !== 'https:' && !isLocalhost) return false;
    if (target.username !== '' || target.password !== '') return false;
    if (target.search !== '' || target.hash !== '') return false;
    const p = target.pathname;
    if (!p.startsWith('/uploads/') && !p.startsWith('/downloads/')) return false;
    if (!p.toLowerCase().endsWith('.apk')) return false;
    return true;
}

const PROD = 'https://chibaleteplus.chibaleteeditores.com';

// ── §5 ─────────────────────────────────────────────────────────────────────
section('[5] acepta destinos válidos');
ok('valor productivo actual (relativo)',      isSafeApkUrl('/uploads/chibalete-lu-0.9.0.apk', PROD) === true);
ok('absoluto same-origin https',              isSafeApkUrl(`${PROD}/uploads/chibalete-lu-0.9.0.apk`, PROD) === true);
ok('/downloads/ también permitido',           isSafeApkUrl('/downloads/chibalete-lu.apk', PROD) === true);
ok('http en localhost (desarrollo)',          isSafeApkUrl('/uploads/x.apk', 'http://localhost:5173') === true);

// ── §6 ─────────────────────────────────────────────────────────────────────
section('[6] rechaza destinos inseguros');
ok('dominio externo',                         isSafeApkUrl('https://evil.example/uploads/x.apk', PROD) === false);
ok('protocol-relative //host',                isSafeApkUrl('//evil.example/uploads/x.apk', PROD) === false);
ok('javascript:',                             isSafeApkUrl('javascript:alert(1)', PROD) === false);
ok('data:',                                   isSafeApkUrl('data:application/vnd.android.package-archive;base64,AA', PROD) === false);
ok('http externo',                            isSafeApkUrl('http://evil.example/uploads/x.apk', PROD) === false);
ok('http same-host no localhost',             isSafeApkUrl('http://chibaleteplus.chibaleteeditores.com/uploads/x.apk', PROD) === false);
ok('ruta fuera de uploads/downloads',         isSafeApkUrl('/api/lu/version', PROD) === false);
ok('ruta hermana (/uploadsX/)',               isSafeApkUrl('/uploadsX/x.apk', PROD) === false);
ok('traversal que escapa del prefijo',        isSafeApkUrl('/uploads/../etc/passwd.apk', PROD) === false);
ok('extensión distinta de .apk',              isSafeApkUrl('/uploads/manual.pdf', PROD) === false);
ok('query string',                            isSafeApkUrl('/uploads/x.apk?redir=evil', PROD) === false);
ok('fragmento',                               isSafeApkUrl('/uploads/x.apk#frag', PROD) === false);
ok('credenciales embebidas',                  isSafeApkUrl('https://u:p@chibaleteplus.chibaleteeditores.com/uploads/x.apk', PROD) === false);
ok('cadena vacía',                            isSafeApkUrl('', PROD) === false);
ok('no-string (null)',                        isSafeApkUrl(null, PROD) === false);
ok('no-string (objeto)',                      isSafeApkUrl({ toString: () => '/uploads/x.apk' }, PROD) === false);
ok('origen de página inválido → fail closed', isSafeApkUrl('/uploads/x.apk', '') === false);

// ── §7 ─────────────────────────────────────────────────────────────────────
section('[7] enlace solo si el destino es válido');
ok('el <a> se renderiza condicionado',        /apkHrefIsSafe \?/.test(src));
ok('el guard usa el origen de la página',     /isSafeApkUrl\(config\.apkUrl, pageOrigin\)/.test(src));
ok('fail closed sin window',                  /typeof window !== 'undefined'/.test(src));
ok('rama insegura conserva reintento',        /apkHrefIsSafe \?[\s\S]*onClick=\{fetchConfig\}[\s\S]*Intentar de nuevo/.test(src));
// apkUrl solo puede aparecer en el JSX como href; la rama de error nunca lo imprime.
ok('solo hay un href al APK',                 (src.match(/href=\{config\.apkUrl\}/g) || []).length === 1);
ok('el error no revela el valor rechazado',   (src.match(/\{config\.apkUrl\}/g) || []).length === 1);

// ── §8 ─────────────────────────────────────────────────────────────────────
section('[8] copy de actualización');
ok('versión disponible visible',              /Versión disponible/.test(src) && /\{config\.version\}/.test(src));
ok('instalar encima',                         /instálalo encima de la aplicación/i.test(src));
ok('no desinstalar',                          /No desinstales Chibalete LU/i.test(src));
ok('no borrar datos',                         /no borres sus datos/i.test(src));
ok('abrir con internet',                      /abre Chibalete LU con internet/i.test(src));
ok('reautenticación es normal',               /Es normal que te pida iniciar sesión de nuevo/i.test(src));
ok('tener la credencial a mano',              /ten a mano la contraseña/i.test(src));
ok('abrir una lectura para confirmar',        /Abre una lectura para confirmar/i.test(src));
ok('bloque de primera instalación',           /Si es tu primera instalación/i.test(src));
ok('autorizar instalación en Android',        /autoriza la instalación cuando Android/i.test(src));
ok('ayuda sin canal inventado',               /Si aparece un error, no desinstales la aplicación\. Contacta a la persona que te envió este enlace\./.test(src));
// La página pública jamás debe pedir permisos de depuración: eso fue del banco de pruebas.
for (const forbidden of ['opciones de desarrollador', 'depuración USB', 'ADB', 'instalación vía USB']) {
    ok(`no instruye "${forbidden}"`,          !new RegExp(forbidden, 'i').test(src));
}

// ── §9 ─────────────────────────────────────────────────────────────────────
section('[9] config.notes no se renderiza');
ok('no hay {config.notes} en el JSX',         !/\{config\.notes\}/.test(src));
ok('notes sigue en el contrato LUConfig',     /notes:\s*string/.test(src));
ok('el componente nunca lee config.notes',    (src.match(/config\.notes/g) || []).length === 0);
ok('notes solo alimenta el flag de analytics', /releaseNotesAvailable:\s*typeof data\.notes === 'string'/.test(src));

// ── §10 ────────────────────────────────────────────────────────────────────
section('[10] flujo anónimo sin telemetría');
const analyticsSrc = fs.readFileSync(analytics, 'utf8');
ok('la página pasa enabled: !!user?.id',      /enabled:\s*!!user\?\.id/.test(src));
ok('el hook corta sin userId',                /if \(!enabled \|\| !userId \|\| userId === 'guest'\) return;/.test(analyticsSrc));
ok('emit() corta sin uid',                    /if \(!uid \|\| uid === 'guest'\) return;/.test(analyticsSrc));
ok('el endpoint de eventos es el esperado',   /const ENDPOINT\s*=\s*'\/api\/v1\/events'/.test(analyticsSrc));
ok('la página no llama a /api/v1/events',     !/api\/v1\/events/.test(src));
ok('la página solo llama a /api/lu/version',  (src.match(/fetch\('([^']+)'\)/g) || []).join() === "fetch('/api/lu/version')");

// ── resumen ────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? 'OK' : 'FAIL'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
