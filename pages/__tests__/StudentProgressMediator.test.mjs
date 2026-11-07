/**
 * StudentProgressMediator.test.mjs — CHP-V8-UNIFIED-XP-01.
 *
 * Vista mínima del progreso individual en Aula Viva (mediador):
 *   [V] utils/studentProgressView.mjs: traduce, no calcula; respuestas raras ⇒ nada
 *   [C] StudentProgressBlock.tsx: accesible (región etiquetada, dl, estado anunciado),
 *       sin rankings ni comparaciones, sin almacenamiento en el navegador
 *   [A] AulaViva: solo con el bloque de reconocimiento (XP encendido), sin panel nuevo
 *   [S] dataService: sesión por cookie, ids codificados, sin x-user-id
 *
 *   node pages/__tests__/StudentProgressMediator.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const V = await import(pathToFileURL(path.join(ROOT, 'utils', 'studentProgressView.mjs')).href);

console.log('\n[V] vista');
const good = { xp: 50, level: { id: 'brote' }, recognizedWorks: 1, achievements: ['primera-obra', 'mirada-profunda', 'inventado'] };
const v = V.buildStudentProgressView(good);
ok('traduce xp, nivel y obras tal cual vienen del servidor', v?.xp === 50 && v.levelName === 'Brote' && v.recognizedWorks === 1);
ok('logros conocidos con su título; los desconocidos no se muestran', JSON.stringify(v?.achievements) === '["Primera obra","Mirada profunda"]', JSON.stringify(v?.achievements));
ok('Semilla con cero', V.buildStudentProgressView({ xp: 0, level: { id: 'semilla' }, recognizedWorks: 0, achievements: [] })?.levelName === 'Semilla');
for (const [l, b] of [['nivel no aprobado (raiz)', { ...good, level: { id: 'raiz' } }], ['xp negativo', { ...good, xp: -1 }], ['xp no entero', { ...good, xp: 1.5 }],
    ['sin obras', { ...good, recognizedWorks: undefined }], ['vacío', null]]) {
    ok(`respuesta inválida (${l}) ⇒ null`, V.buildStudentProgressView(b) === null);
}
ok('200 válido ⇒ ok', V.classifyStudentProgress(200, good).kind === 'ok');
ok('200 inválido ⇒ unavailable (nunca 0 inventado)', V.classifyStudentProgress(200, { xp: 'x' }).kind === 'unavailable');
for (const s of [404, 403, 401]) ok(`${s} ⇒ hidden (no se pinta nada)`, V.classifyStudentProgress(s, null).kind === 'hidden');
for (const s of [0, 500, 503]) ok(`${s} ⇒ unavailable`, V.classifyStudentProgress(s, null).kind === 'unavailable');
ok('la vista no calcula: no importa deriveLevel ni umbrales', !/deriveLevel|xpTarget|PROPOSED_LEVELS|30|50/.test(code(read('utils/studentProgressView.mjs')).replace(/\/\/.*$/gm, '')));

console.log('\n[C] componente');
const comp = code(read('components/aula-viva/StudentProgressBlock.tsx'));
ok('región con encabezado propio (aria-labelledby → h3)', /aria-labelledby="av-progreso-individual"/.test(comp) && /<h3 id="av-progreso-individual"/.test(comp));
ok('datos como lista de definición (dt/dd)', /<dl/.test(comp) && /<dt/.test(comp) && /<dd/.test(comp));
ok('carga y error anunciados (role="status", aria-busy)', (comp.match(/role="status"/g) ?? []).length >= 2 && /aria-busy=/.test(comp));
ok('icono decorativo oculto a lectores de pantalla', /<span aria-hidden/.test(comp));
ok('contraste en modo oscuro (clases dark:)', /dark:text-white/.test(comp) && /dark:bg-gray-800/.test(comp));
ok('hidden ⇒ no pinta nada', /state\.kind === 'hidden'\) return null/.test(comp));
ok('sin rankings, posiciones, promedios ni comparaciones', !/rank|posici|puesto|promedio|percentil|mejor que|top/i.test(comp));
ok('sin almacenamiento en el navegador', !/localStorage|sessionStorage|indexedDB/.test(comp));
ok('no muestra «Puntos» ni PM', !/Puntos|\bPM\b/.test(comp));

console.log('\n[A] Aula Viva');
const av = read('pages/AulaViva.tsx');
ok('el bloque vive junto al panel del estudiante (sin panel ni ruta nuevos)', /<StudentProgressBlock groupId=\{selectedGroup\} studentId=\{selectedStudent\.id\} \/>/.test(av)
    && av.indexOf('<StudentStatusPanel') < av.indexOf('<StudentProgressBlock'));
ok('solo si el resumen del grupo trae `recognition` (XP encendido)', /groupAnalytics\.status === 'ready'\s*\n?\s*&& \(groupAnalytics\.summary as \{ recognition\?: unknown \}\)\.recognition != null/.test(av));
ok('App.tsx no registra rutas nuevas para esto', !/StudentProgress/.test(read('App.tsx')));
const grb = read('components/aula-viva/GroupRecognitionBlock.tsx');
ok('el bloque agregado sigue sin datos individuales', /sin XP, niveles ni comparaciones entre estudiantes/.test(grb));

console.log('\n[S] dataService');
const ds = read('services/dataService.ts');
const m = ds.match(/async getStudentProgress\([\s\S]*?\n {4}\}\n/)?.[0] ?? '';
ok('existe getStudentProgress', m.length > 0);
ok('ids codificados en la ruta', /encodeURIComponent\(groupId\)/.test(m) && /encodeURIComponent\(studentId\)/.test(m));
ok('sesión por cookie, sin x-user-id ni caché', /credentials: 'include'/.test(m) && /cache: 'no-store'/.test(m) && !/x-user-id/i.test(m));

console.log(`\nStudentProgressMediator (V8-UNIFIED-XP-01): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
