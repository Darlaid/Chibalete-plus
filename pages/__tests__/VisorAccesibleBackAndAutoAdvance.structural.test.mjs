/**
 * VisorAccesibleBackAndAutoAdvance.structural.test.mjs
 * CHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 Fase 1.
 *
 * Contrato estructural del Modo Accesible:
 *   B1  "Volver a Biblioteca" vive en la zona persistente de la barra lateral.
 *   B2  el header ya no tiene botón Volver (un solo Volver).
 *   B3  el click navega a /biblioteca.
 *   B4  no usa fichaPath / navigate(-1).
 *   B5  con contexto MOOK aparece un control SEPARADO («Volver al MOOK»).
 *   B6  MookReturnButton conserva su destino (componente sin cambios de contrato).
 *   +   switch accesible (role, aria-checked, aria-disabled enfocable, hint).
 *   +   aislamiento: nada de esto toca Modo Guiado ni Modo Inmersivo.
 *
 * Correr:  node pages/__tests__/VisorAccesibleBackAndAutoAdvance.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const visor   = code(read('pages/VisorAccesible.tsx'));
const shell   = code(read('components/accesible/A11yShell.tsx'));
const sidebar = code(read('components/accesible/A11ySidebar.tsx'));
const mook    = read('components/MookReturn.tsx');

console.log('\n[VOLVER]');
{
    const zoneStart = sidebar.indexOf('data-a11y-persistent-zone');
    const zoneEnd = sidebar.indexOf('BLOQUE — Progreso') >= 0 ? sidebar.indexOf('BLOQUE — Progreso') : sidebar.indexOf('<A11yProgressSummary');
    const zone = sidebar.slice(zoneStart, zoneEnd);
    ok('B1 zona persistente sticky dentro del aside (-top-3 mobile cubre el pt del aside, md:top-0 desktop)',
        zoneStart > 0 && /'sticky -top-3 md:top-0 z-10'/.test(sidebar));
    ok('B1 "Volver a Biblioteca" está en la zona persistente', /Volver a Biblioteca/.test(zone) && /onClick=\{onBack\}/.test(zone));
    {
        // La zona es hija DIRECTA del <aside>, antes de cualquier bloque condicional.
        const asideOpen = sidebar.indexOf('<aside');
        const between = sidebar.slice(sidebar.indexOf('>', sidebar.indexOf("].join(' ')}", asideOpen)) + 1, zoneStart);
        ok('B1 la zona se renderiza siempre (no depende de book/loading/error)',
            zoneStart > asideOpen && /^(\s|\{\})*<div\s*$/.test(between), JSON.stringify(between));
    }
    ok('B1 el aside sigue siendo sticky (desktop) / fixed (mobile)', /'md:sticky md:top-4'/.test(sidebar) && /'fixed bottom-0 left-0 right-0 z-30'/.test(sidebar));
    ok('B2 el header no tiene botón Volver', !/onClick=\{onBack\}/.test(shell) && !/Volver a la página del libro/.test(shell));
    ok('B2 un solo "Volver" genérico en todo el visor',
        (sidebar.match(/Volver a Biblioteca/g) ?? []).length === 1 && !/Volver/.test(shell.replace(/Volver a Biblioteca/g, '')) );
    ok('B3 destino /biblioteca', /const LIBRARY_PATH = '\/biblioteca';/.test(visor) && /navigate\(LIBRARY_PATH\)/.test(visor));
    ok('B3 el shell entrega onBack a la barra lateral', /<A11ySidebar[\s\S]*?onBack=\{onBack\}/.test(shell));
    ok('B4 sin fichaPath', !/fichaPath|useFichaPath/.test(visor));
    ok('B4 sin navigate(-1) ni history.back', !/navigate\(-1\)|history\.back/.test(visor + shell + sidebar));
}

console.log('\n[MOOK]');
{
    ok('B5 «Volver al MOOK» es un control separado en la zona persistente', /<MookReturnButton/.test(sidebar));
    ok('B5 sin destino propio: el componente decide (no se le pasa `to`)', !/<MookReturnButton[^>]*\bto=/.test(sidebar));
    ok('B6 MookReturnButton: sin origen no se renderiza', /if \(!to\) return null;/.test(mook));
    ok('B6 MookReturnButton: destino = mookReturnPath(ctx)', /const to = mookReturnPath\(ctx\);/.test(mook));
    ok('B6 nombre accesible intacto', /aria-label="Volver al MOOK, al paso de origen"/.test(mook));
}

console.log('\n[SWITCH]');
{
    ok('role="switch"', /role="switch"/.test(sidebar));
    ok('aria-checked ligado a ACTIVE', /aria-checked=\{autoActive\}/.test(sidebar) && /autoAdvance\.status === 'ACTIVE'/.test(sidebar));
    ok('LOCKED usa aria-disabled (enfocable), NO disabled', /aria-disabled=\{autoLocked \|\| undefined\}/.test(sidebar)
        && !/id="a11y-autoadvance-switch"[\s\S]{0,400}\sdisabled=/.test(sidebar));
    ok('LOCKED describe la condición de desbloqueo', /aria-describedby=\{autoLocked \? AUTO_ADVANCE_HINT_ID : undefined\}/.test(sidebar)
        && /'Disponible después de 2 h de lectura'/.test(read('components/accesible/A11ySidebar.tsx')));
    ok('el ON/OFF visual es aria-hidden (el estado lo da aria-checked)', /<span aria-hidden="true"[^>]*>\s*\{autoActive \? 'ON' : 'OFF'\}/.test(sidebar));
    ok('foco visible (PixelButton focus-visible ring)', /focus-visible:ring-4/.test(read('components/accesible/pixel/PixelButton.tsx')));
    ok('el switch está en la zona persistente (apagado siempre visible)',
        sidebar.indexOf('a11y-autoadvance-switch') > sidebar.indexOf('data-a11y-persistent-zone')
        && sidebar.indexOf('a11y-autoadvance-switch') < sidebar.indexOf('<A11yProgressSummary'));
    ok('VisorAccesible crea el hook y lo pasa al shell', /useA11yAutoAdvance\(\{ userId: user\?\.id, navigation, segments \}\)/.test(visor) && /autoAdvance=\{autoAdvance\}/.test(visor));
    ok('reduced motion: el scroll respeta prefers-reduced-motion', /prefers-reduced-motion: reduce/.test(read('hooks/useA11yReaderNavigation.ts')));
}

console.log('\n[AISLAMIENTO]');
{
    for (const f of ['pages/VisorTexto.tsx', 'pages/VisorInmersivo.tsx', 'utils/syncStrategyExecutor.mjs']) {
        const s = read(f);
        ok(`${f} no importa nada del avance automático`, !/useA11yAutoAdvance|a11yAutoAdvance|advanceSegmentAuto/.test(s));
    }
}

console.log(`\nCHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01 (estructural) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
