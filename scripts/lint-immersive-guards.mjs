#!/usr/bin/env node
/**
 * lint-immersive-guards.mjs — Static guards del Visor Inmersivo.
 *
 * Falla con exit 1 si el código del modo inmersivo contiene patrones
 * peligrosos que reabrirían los incidentes 1 y 2:
 *   - navigate() hacia /leer/inmersivo/ desde call sites no whitelisted
 *   - storage keys NO namespaced (immersiveProgress, currentContent, …)
 *   - setTimeout que llama setIdx/navigate/load sin guard de sesión
 *   - catch de /api/v1/events que muta playback
 *
 * Cómo correr:
 *   node scripts/lint-immersive-guards.mjs
 *   npm run lint:immersive-guards
 *
 * Para añadir un call site legítimo de navegación, agregar el regex a
 * ALLOWED_NAV_CALLSITES (cada entrada DEBE referenciar a
 * assertManualNavigation con reason whitelisted o ir acompañado del
 * comentario `// IMMERSIVE_NAV_OK: <reason>` en la misma línea o anterior).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ───────────────────────────────────────────────────────────────────────────
// Archivos a escanear
// ───────────────────────────────────────────────────────────────────────────
const IMMERSIVE_FILES = [
    'pages/VisorInmersivo.tsx',
    'hooks/useImmersivePlayback.ts',
    'engines/StartupEngine.ts',
    'engines/BlockEngine.ts',
    'engines/ContentQueue.ts',
    'engines/RewardEngine.ts',
    'engines/TranceEngine.ts',
    'components/ImmersiveShell.tsx',
    'hooks/useBackboneReadingSession.ts',
];

const ALL_FRONTEND_FILES = [];
const EXCLUDED_DIRS = new Set([
    'node_modules', 'dist', '_prod_snapshot_', 'deployment_package',
    'chibaleteplus', '.git', '.claude', '.vscode', 'coverage', 'build',
]);
function collectFiles(dir, exts) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collectFiles(full, exts);
        else if (exts.some(e => entry.name.endsWith(e))) ALL_FRONTEND_FILES.push(full);
    }
}
collectFiles(ROOT, ['.ts', '.tsx', '.js', '.jsx', '.mjs']);

// Subset de archivos donde la INVARIANTE 3 (storage namespacing) aplica
// estrictamente. VisorTexto, VisorPDF, etc. son modos paralelos con sus
// propias decisiones de storage — fuera del scope de este hardening.
const IMMERSIVE_FILES_ABS = IMMERSIVE_FILES.map(f => path.join(ROOT, f));
function isImmersiveScope(filePath) {
    return IMMERSIVE_FILES_ABS.includes(filePath);
}

// ───────────────────────────────────────────────────────────────────────────
// Violations registry
// ───────────────────────────────────────────────────────────────────────────
const violations = [];
function violation({ rule, file, line, snippet, hint }) {
    violations.push({ rule, file: path.relative(ROOT, file), line, snippet: snippet.trim(), hint });
}

// ───────────────────────────────────────────────────────────────────────────
// RULE 1 — navigate('/leer/inmersivo/...') solo desde call sites whitelisted
//
// El único path legítimo es:
//   (a) assertManualNavigation pasa primero y luego navigate
//   (b) handler de click en banner "Próximo →" o tarjeta de libro
//
// Detectamos navigate(...) cuyo argumento contenga '/leer/inmersivo/' y
// verificamos que la línea (o las 3 líneas anteriores) contengan o bien
// "assertManualNavigation" o el marker `// IMMERSIVE_NAV_OK:`.
// ───────────────────────────────────────────────────────────────────────────
const NAV_INMERSIVO_RX = /navigate\s*\(\s*[`'"][^`'"]*\/leer\/inmersivo\/[^`'"]*[`'"]/;
const ASSERTION_MARKER_RX = /(assertManualNavigation|IMMERSIVE_NAV_OK)/;

for (const filePath of IMMERSIVE_FILES.map(f => path.join(ROOT, f))) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (NAV_INMERSIVO_RX.test(lines[i])) {
            // Buscar marker en las 5 líneas anteriores o en la misma
            const ctx = lines.slice(Math.max(0, i - 5), i + 1).join('\n');
            if (!ASSERTION_MARKER_RX.test(ctx)) {
                violation({
                    rule: 'NAV_WITHOUT_GUARD',
                    file: filePath,
                    line: i + 1,
                    snippet: lines[i],
                    hint: 'INV-2: navigate hacia /leer/inmersivo/ requiere assertManualNavigation o comment "// IMMERSIVE_NAV_OK: <reason>"',
                });
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// RULE 2 — Storage keys NO namespaced
// ───────────────────────────────────────────────────────────────────────────
const FORBIDDEN_KEYS = [
    /['"`]immersiveProgress['"`]/,
    /['"`]currentContent['"`]/,
    /['"`]activeBook['"`]/,
    /['"`]lastPlayback['"`]/,
    /['"`]currentSentenceIndex['"`]/,
    /['"`]playbackState['"`]/,
    /['"`]selectedContent['"`]/,
    /['"`]lastReadContent['"`]/,
    // Legacy: leo_session_<contentId> sin userId (deprecated, migración ya hecha)
    /['"`]leo_session_\$\{[^}]*content[^}]*\.id\}['"`]/,
    /['"`]leo_session_\$\{[^}]*\.id\}['"`]/,
];

const STORAGE_API_RX = /(sessionStorage|localStorage)\.(setItem|getItem|removeItem)\s*\(/;

for (const filePath of ALL_FRONTEND_FILES) {
    // Excluir tests, el lint mismo, helper que define las keys, y todo lo
    // que no sea archivo del scope inmersivo (RULE 2 sólo aplica al visor
    // inmersivo; VisorTexto y otros modos tienen su propia decisión de storage).
    if (!isImmersiveScope(filePath)) continue;
    if (filePath.includes('__tests__') || filePath.includes('lint-immersive-guards.mjs') ||
        filePath.endsWith('immersiveSession.js')) continue;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
        // Solo escanear líneas que toquen storage API
        if (!STORAGE_API_RX.test(lines[i])) continue;
        for (const rx of FORBIDDEN_KEYS) {
            if (rx.test(lines[i])) {
                // Ignorar si la línea o las 3 anteriores tienen el comment LEGACY_MIGRATION_OK
                const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
                if (/LEGACY_MIGRATION_OK/.test(ctx)) continue;
                violation({
                    rule: 'STORAGE_KEY_NOT_NAMESPACED',
                    file: filePath,
                    line: i + 1,
                    snippet: lines[i],
                    hint: 'INV-3: usa buildNamespacedStorageKey(userId, contentId, subKey) en lugar de keys globales',
                });
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// RULE 3 — setTimeout en useImmersivePlayback que llame setIdx/navigate/load
// debe estar dentro de doAdvance/fencedAdvance o tener guards del token
// ───────────────────────────────────────────────────────────────────────────
const HOOK_PATH = path.join(ROOT, 'hooks/useImmersivePlayback.ts');
if (fs.existsSync(HOOK_PATH)) {
    const lines = fs.readFileSync(HOOK_PATH, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        // setTimeout(() => { ... setIdx/navigate/load ... }, X)
        if (/setTimeout\s*\(/.test(lines[i])) {
            // BLOCKER FINAL V2 — el trigger es una LLAMADA a setTimeout, no la
            // prosa. Una línea de comentario/JSDoc que MENCIONA "setTimeout("
            // (p.ej. "El visor lo dispara en setTimeout(1500ms)") NO es un
            // callback: scanearla genera falsos positivos cuando comentarios
            // vecinos describen setIdx/load. Esto NO debilita la regla — las
            // llamadas reales `x = setTimeout(fn, …)` no son comentarios y se
            // siguen escaneando (todas las del hook tienen guards). Alinea con
            // la doctrina M-5.4: ruido sin causa accionable es peor que nada.
            const codePart = lines[i].replace(/\/\/.*$/, '');
            const trimmed  = lines[i].trim();
            const isCommentLine =
                trimmed.startsWith('*')  ||
                trimmed.startsWith('//') ||
                trimmed.startsWith('/*') ||
                !/setTimeout\s*\(/.test(codePart); // el match vivía tras un //
            if (isCommentLine) continue;
            // Mirar las próximas 30 líneas para detectar el callback
            const block = lines.slice(i, Math.min(lines.length, i + 30)).join('\n');
            const calls = block.match(/(setIdx|navigate|load\s*\()/);
            if (calls) {
                const hasGuards = /(capturedToken\s*!==|loadToken\.current|statusRef\.current|unmountedRef\.current|assertImmersiveSessionActive)/.test(block);
                if (!hasGuards) {
                    violation({
                        rule: 'SETTIMEOUT_ADVANCE_WITHOUT_GUARD',
                        file: HOOK_PATH,
                        line: i + 1,
                        snippet: lines[i],
                        hint: 'INV-4: setTimeout que llama setIdx/navigate/load debe validar capturedToken, statusRef, unmountedRef antes de mutar',
                    });
                }
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// RULE 4 — catch de /api/v1/events que muta playback
// ───────────────────────────────────────────────────────────────────────────
const BACKBONE_PATH = path.join(ROOT, 'hooks/useBackboneReadingSession.ts');
if (fs.existsSync(BACKBONE_PATH)) {
    const src = fs.readFileSync(BACKBONE_PATH, 'utf8');
    // Buscar bloques `.catch(...)` y verificar que no contengan calls peligrosos
    const catchBlocks = src.match(/\.catch\s*\([\s\S]*?\)/g) ?? [];
    for (const block of catchBlocks) {
        const dangerous = /(setStatus|setIdx|navigate|reloadUsers|reset\b|pause\b|play\b)/.exec(block);
        if (dangerous) {
            // Localizar la línea
            const idx = src.indexOf(block);
            const lineNum = src.substring(0, idx).split('\n').length;
            violation({
                rule: 'EVENT_CATCH_MUTATES_PLAYBACK',
                file: BACKBONE_PATH,
                line: lineNum,
                snippet: block.split('\n')[0],
                hint: `INV-10: catch de /api/v1/events NO debe llamar ${dangerous[0]} — eventos son no bloqueantes`,
            });
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// RULE 5 — BlockEngine, ContentQueue, StartupEngine NO deben importar
// react-router-dom (no pueden navegar).
// ───────────────────────────────────────────────────────────────────────────
const PURE_ENGINES = [
    'engines/BlockEngine.ts',
    'engines/ContentQueue.ts',
    'engines/StartupEngine.ts',
    'engines/RewardEngine.ts',
    'engines/TranceEngine.ts',
];
for (const f of PURE_ENGINES) {
    const filePath = path.join(ROOT, f);
    if (!fs.existsSync(filePath)) continue;
    const src = fs.readFileSync(filePath, 'utf8');
    if (/from\s+['"]react-router-dom['"]/.test(src)) {
        violation({
            rule: 'ENGINE_IMPORTS_ROUTER',
            file: filePath,
            line: 1,
            snippet: 'import .. from "react-router-dom"',
            hint: 'INV-12: engines puros no deben importar react-router-dom',
        });
    }
    if (/\bnavigate\s*\(/.test(src) || /useNavigate/.test(src)) {
        violation({
            rule: 'ENGINE_USES_NAVIGATE',
            file: filePath,
            line: 1,
            snippet: '<navigate o useNavigate detectado>',
            hint: 'INV-12: engines puros no deben llamar navigate — política vive en el componente',
        });
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Reporte
// ───────────────────────────────────────────────────────────────────────────
if (violations.length === 0) {
    console.log('\n✓ lint-immersive-guards: 0 violaciones detectadas');
    console.log('  Reglas activas:');
    console.log('    R1 NAV_WITHOUT_GUARD              — INV-2');
    console.log('    R2 STORAGE_KEY_NOT_NAMESPACED     — INV-3');
    console.log('    R3 SETTIMEOUT_ADVANCE_WITHOUT_GUARD — INV-4');
    console.log('    R4 EVENT_CATCH_MUTATES_PLAYBACK   — INV-10');
    console.log('    R5 ENGINE_IMPORTS_ROUTER / USES_NAVIGATE — INV-12');
    console.log(`  Archivos escaneados: ${ALL_FRONTEND_FILES.length} (frontend) + ${IMMERSIVE_FILES.length} (immersive-specific)`);
    process.exit(0);
}

console.error(`\n✗ lint-immersive-guards: ${violations.length} violación(es) detectada(s)\n`);
for (const v of violations) {
    console.error(`  [${v.rule}] ${v.file}:${v.line}`);
    console.error(`    ${v.snippet}`);
    console.error(`    ↳ ${v.hint}\n`);
}
process.exit(1);
