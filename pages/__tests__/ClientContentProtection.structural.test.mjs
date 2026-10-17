/**
 * ClientContentProtection.structural.test.mjs
 * CHP-CONTENT-PROTECTION-2026-01 CP-3 (R6/R7).
 *
 * Ratchet estructural: el Inmersivo no arranca su StartupEngine (TXT, manifest,
 * anchors) sin veredicto positivo de /access; Guiado no copia el libro a
 * localStorage; el logout vacía los stores editoriales del navegador sin
 * tocar preferencias. El comportamiento real se verificó en navegador.
 *
 * Sin red. 0 lecturas y 0 escrituras de stores reales.
 *
 *   node pages/__tests__/ClientContentProtection.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

// Sin comentarios de línea: un '// engine.start()' explicativo no cuenta.
const immersive = read('pages/VisorInmersivo.tsx').replace(/^\s*\/\/.*$/gm, '');
const texto = read('pages/VisorTexto.tsx');
const auth = read('context/AuthContext.tsx');
const storage = read('utils/clientEditorialStorage.ts');

section('[R6] Inmersivo: ningún byte editorial antes de /access allowed');
{
    const starts = immersive.match(/\bengine(Ref\.current\?)?\.start\(\)/g) || [];
    ok('una sola llamada a start() del StartupEngine', starts.length === 1, starts.join(','));
    ok('esa llamada es engineRef.current?.start() gateada por accessAllowedFor === content.id',
        /if \(accessAllowedFor !== content\.id\) return;\s*engineRef\.current\?\.start\(\);/.test(immersive));
    ok('el efecto de arranque depende del veredicto y del contenido',
        /engineRef\.current\?\.start\(\);\s*\}, \[accessAllowedFor, content\.id\]\);/.test(immersive));
    ok('accessAllowedFor solo se fija con allowed === true',
        /if \(data\.allowed !== true\) \{[\s\S]{0,200}?\} else \{\s*setAccessAllowedFor\(content\.id\);/.test(immersive)
        && (immersive.match(/setAccessAllowedFor\(/g) || []).length === 1);
    ok('sigue sin endpoint nuevo: un único fetch a /access', (immersive.match(/\/access\?userId=/g) || []).length === 1);
    ok('sin fetch directo de texto_plano_url en el visor', !/fetch\([^)]*texto_plano_url/.test(immersive));
}

section('[R7] Guiado: el texto no se persiste en el navegador');
ok('VisorTexto no importa offlineTextCache', !/offlineTextCache/.test(texto));
ok('VisorTexto no escribe en localStorage el texto', !/saveOfflineText|localStorage\.setItem\([^)]*texto/.test(texto));

section('[R7] logout');
ok('logout llama a clearEditorialClientStorage', /const logout = \(\) => \{[\s\S]*?clearEditorialClientStorage\(\);[\s\S]*?window\.location\.replace/.test(auth));
ok('arranque purga chibalete_offline_texto heredado', /initAuth = async \(\) => \{\s*[\s\S]{0,300}?clearOfflineText\(\);/.test(auth));
for (const k of ["'chibalete_content'", "'gemini_cache_'", "'leo_session_'", "'leo-chat-'"]) {
    ok(`store editorial cubierto: ${k}`, storage.includes(k));
}
ok('incluye chibalete_offline_texto (clearOfflineText)', /clearOfflineText\(\)/.test(storage));
ok('no borra todo el storage (preferencias y cola de progreso se conservan)', !/localStorage\.clear\(\)|sessionStorage\.clear\(\)/.test(storage));
for (const k of ['chibalete_failed_syncs', 'chibalete_progress', 'theme']) {
    ok(`no toca ${k}`, !storage.includes(`'${k}'`));
}

console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
