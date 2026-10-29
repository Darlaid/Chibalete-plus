/**
 * GamificacionG0Containment.structural.test.mjs — CHP-GAMIFICACION-G0-01.
 *
 * Contención de la gamificación simulada (sin nuevo sistema):
 *   [L] Leo: el Chatbot no concede puntos por tokens.
 *   [D] dataService: sumar/gastar/canjear/aprobar puntos es inerte.
 *   [T] Trivia: fuera de la navegación; la ruta no genera preguntas, ni puntos, ni premios.
 *   [A] Admin: sin aprobaciones simuladas ni «cupón generado»; historial intacto.
 *   [B] Biblioteca: sin etiqueta «N pts»; secciones y unlockCost intactos.
 *   [I] Visor inmersivo: el corte por tiempo no dice «¡Lectura Completada!» ni
 *       emite finalización; el fin real de la obra sigue igual.
 *   [M] MOOK / progreso canónico: el diff de G0 no los toca.
 *
 * Estructural (lee el código fuente). Tolera CRLF.
 * Cómo correr:  node pages/__tests__/GamificacionG0Containment.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

/** Cuerpo de un método de clase `name(...) { ... }` (llaves balanceadas). */
function methodBody(src, name) {
    // `[^\n]*\{` toma la última llave de la línea (el tipo de retorno puede tener llaves).
    const m = new RegExp(`\\n\\s{4}${name}\\([^)]*\\)[^\\n]*\\{[ \\t]*\\n`).exec(src);
    if (!m) return null;
    let i = m.index + m[0].length, depth = 1;
    const start = i;
    while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
    }
    return src.slice(start, i - 1);
}

const chatbot = read('components/Chatbot.tsx');
const ds = read('services/dataService.ts');
// Sin comentarios `//`: el comentario de cabecera documenta lo retirado por nombre.
const trivia = read('pages/Trivia.tsx').replace(/^\s*\/\/.*$/gm, '');
const navbar = read('components/Navbar.tsx');
const app = read('App.tsx');
const perms = read('config/routePermissions.ts');
const admin = read('pages/AdminRecompensas.tsx');
const home = read('pages/Home.tsx');
const tienda = read('pages/Tienda.tsx');
const biblio = read('pages/Biblioteca.tsx');
const visor = read('pages/VisorInmersivo.tsx');

console.log('\n[L] Leo / Chatbot');
ok('Chatbot no llama addPoints ni addPuntos', !/\.addPoints\(|\.addPuntos\(/.test(chatbot));
ok('Chatbot no anuncia «Has ganado … Puntos de Magia»', !/Has ganado|Puntos de Magia/.test(chatbot));
ok('Chatbot borra el token con el util compartido', /stripAwardPointsTokens\(text\)/.test(chatbot) && /utils\/leoActionTokens\.mjs/.test(chatbot));
ok('parseActions ya no expone points', !/points:\s*number/.test(chatbot));
ok('SAVE_VOCAB e INTERACTION_TYPE siguen procesándose', /\[SAVE_VOCAB:/.test(chatbot) && /\[INTERACTION_TYPE:/.test(chatbot));

console.log('\n[D] dataService inerte para puntos y canjes');
const bodies = Object.fromEntries(['addPuntos', 'canjearRecompensa', 'addPoints', 'redeemCoupon', 'processRewardRequest']
    .map(n => [n, methodBody(ds, n)]));
for (const [n, b] of Object.entries(bodies)) {
    ok(`${n}: localizable`, b !== null);
    ok(`${n}: no modifica puntos`, b !== null && !/\.puntos\s*[-+]?=/.test(b));
    ok(`${n}: no persiste estado`, b !== null && !/saveState\(/.test(b));
    ok(`${n}: no crea ni muta solicitudes`, b !== null && !/journalEntries|status\s*=/.test(b));
}
ok('canjearRecompensa devuelve false', /return false;/.test(bodies.canjearRecompensa || ''));
ok('redeemCoupon devuelve success:false con aviso veraz',
   /success:\s*false/.test(bodies.redeemCoupon || '') && /estarán disponibles cuando el sistema esté habilitado/.test(bodies.redeemCoupon || ''));
ok('addPoints ya no escribe nombre_usuario en consola', !/console\.log\([^)]*\[Points\]/.test(ds));
ok('getRewardRequests (historial) se conserva', /getRewardRequests\(filter/.test(ds));

console.log('\n[T] Trivia');
ok('Navbar sin enlaces a /trivia', !/['"]\/trivia['"]/.test(navbar));
ok('Navbar sin etiqueta Trívia', !/Tr[ií]via/.test(navbar));
ok('la ruta /trivia sigue protegida (sin 404 ni ruta abierta)',
   /path="\/trivia"[\s\S]{0,200}?ProtectedRoute access=\{getRouteAccess\('\/trivia'\)\}/.test(app) && /path: '\/trivia'/.test(perms));
ok('Trivia no genera preguntas', !/generarPreguntaTrivia/.test(trivia));
ok('Trivia no usa dataService (ni suma ni gasta)', !/dataService/.test(trivia));
ok('Trivia no muestra premios simulados', !/MOCK_REWARDS|picsum|Canjear|PTS|recompensa/i.test(trivia));
ok('Trivia muestra aviso veraz', /Trivia no disponible/.test(trivia) && /to="\/biblioteca"/.test(trivia));

console.log('\n[A] Administración de recompensas');
ok('sin botones Aprobar/Rechazar', !/>\s*Aprobar\b|>\s*Rechazar\b|<CheckCircle[^>]*\/> Aprobar/.test(admin));
ok('no invoca processRewardRequest', !/processRewardRequest/.test(admin));
ok('ningún mensaje afirma «cupón generado»', !/cup[oó]n generado/i.test(admin) && !/cup[oó]n generado/i.test(ds));
ok('aviso de canje no habilitado', /no está habilitado/.test(admin));
ok('historial sigue visible (pestañas y tabla)', /getRewardRequests\(filter\)/.test(admin) && /<table/.test(admin));
ok('Home ya no avisa «esperando aprobación de cupones»', !/aprobaci[oó]n de cupones/.test(home));
ok('Tienda sin redeemCoupon ni «te enviará el código»', !/redeemCoupon|te enviará el código/.test(tienda));
ok('Tienda conserva el catálogo y la CTA externa', /<CatalogSection state=\{catalogState\}/.test(tienda) && /getStoreCatalog\(\)/.test(tienda));

console.log('\n[B] Biblioteca');
ok('sin etiqueta «{sec.unlockCost} pts»', !/\{sec\.unlockCost\}\s*pts/.test(biblio));
ok('las secciones se siguen renderizando con su contenido', /sections\.map\(sec =>/.test(biblio) && /sectionIds\?\.includes\(sec\.id\)/.test(biblio));

console.log('\n[I] Visor inmersivo: corte por tiempo ≠ fin de la obra');
ok('estado sessionEndReason declarado', /useState<'timer' \| 'content_end'>\('content_end'\)/.test(visor));
const completeCase = (visor.match(/case 'complete':[\s\S]+?break;/) || [''])[0];
ok('case complete (BlockEngine) localizable', /BLOCK_COMPLETE_END_SESSION/.test(completeCase));
ok('corte por tiempo marca reason=timer antes de mostrar el overlay',
   /setSessionEndReason\('timer'\);\s*\n\s*setSessionComplete\(true\)/.test(completeCase));
ok('corte por tiempo no guarda progreso ni emite finalización',
   !/updateProgreso|session_completed|session_end|reading_completed|markCompleted|\/complete/.test(completeCase));
ok('fin real por audio marca reason=content_end',
   /onSessionEndRef\.current = \(\) => \{[\s\S]{0,900}?setSessionEndReason\('content_end'\);\s*\n\s*setSessionComplete\(true\)/.test(visor));
ok('sin siguiente contenido marca reason=content_end',
   /analyticsService\.flush\(\);\s*\n\s*setSessionEndReason\('content_end'\);\s*\n\s*setSessionComplete\(true\)/.test(visor));
const overlay = (visor.match(/\{sessionComplete && \([\s\S]+?\+5 Minutos/) || [''])[0];
ok('overlay: «¡Lectura Completada!» solo en la rama content_end',
   /sessionEndReason === 'timer' \? \([\s\S]+?Fin del tiempo de sesión[\s\S]+?\) : \([\s\S]+?¡Lectura Completada!/.test(overlay));
ok('overlay: la rama timer no dice «Lectura Completada»',
   !/Lectura Completada/i.test((overlay.match(/sessionEndReason === 'timer' \? \(([\s\S]+?)\) : \(/) || ['', 'x'])[1]));
ok('overlay: aria-label depende del motivo', /aria-label=\{sessionEndReason === 'timer' \? 'Fin del tiempo de sesión' : 'Lectura completada'\}/.test(visor));
ok('overlay: sigue siendo dialog modal con +5 Minutos y Salir',
   /role="dialog"/.test(overlay) && /aria-modal="true"/.test(overlay) && /\+5 Minutos/.test(visor) && /PB_BLOCK_EXIT/.test(visor));
ok('LEVELS y su duración por defecto sin cambios (40 s en nivel 1)', /1: \{ duration: 40, label: "Nivel 1: Novato" \}/.test(visor));

console.log('\n[M] MOOK y progreso canónico intactos (G0 no toca sus archivos)');
for (const p of ['server/server.js', 'server/progressService.js', 'server/experienceBackboneEmitter.mjs', 'hooks/useImmersivePlayback.ts', 'engines/RewardEngine.ts']) {
    const src = read(p);
    ok(`${p} sin marcas G0`, !/GAMIFICACION-G0|G0:/.test(src));
}

console.log(`\nCHP-GAMIFICACION-G0-01 (contención) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
