/**
 * Hotfix: classic immersive resume index resolver.
 *
 * Run:
 *   node utils/__tests__/immersiveResume.test.mjs
 */
import { resolveImmersiveResumePosition } from '../immersiveResume.mjs';

let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
    if (condition) {
        console.log(`  ✓ ${label}`);
        pass++;
    } else {
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
        fail++;
    }
}

function section(label) {
    console.log(`\n${label}`);
}

console.log('immersiveResume — hotfix resume position');

section('[A] sin progreso');
{
    const r = resolveImmersiveResumePosition({ progress: undefined, totalSentences: 20 });
    ok('startIndex=0', r.startIndex === 0);
    ok('source=none', r.source === 'none');
    ok('clamped=false', r.clamped === false);
}

section('[B1] progreso con anchor sentence');
{
    const r = resolveImmersiveResumePosition({
        totalSentences: 100,
        progress: {
            porcentaje: 42,
            canonicalProgress: {
                anchor: { type: 'sentence', value: 37 },
                sentenceIndex: 12,
                lastInteractedMode: 'text',
            },
        },
    });
    ok('startIndex=37', r.startIndex === 37);
    ok('source=anchor', r.source === 'anchor');
}

section('[B2] progreso con sentenceIndex immersive');
{
    const r = resolveImmersiveResumePosition({
        totalSentences: 50,
        progress: {
            porcentaje: 10,
            canonicalProgress: {
                sentenceIndex: 19,
                lastInteractedMode: 'immersive',
            },
        },
    });
    ok('startIndex=19', r.startIndex === 19);
    ok('source=sentence', r.source === 'sentence');
}

section('[B3] progreso por porcentaje cross-mode');
{
    const r = resolveImmersiveResumePosition({
        totalSentences: 40,
        progress: {
            porcentaje: 50,
            canonicalProgress: {
                sentenceIndex: 19,
                lastInteractedMode: 'pdf',
            },
        },
    });
    ok('startIndex=20', r.startIndex === 20, `got ${r.startIndex}`);
    ok('source=percentage', r.source === 'percentage');
}

section('[D] progreso inválido cae controlado a 0');
{
    const r = resolveImmersiveResumePosition({
        totalSentences: 20,
        progress: {
            porcentaje: -12,
            canonicalProgress: {
                anchor: { type: 'sentence', value: Number.NaN },
                sentenceIndex: -4,
                lastInteractedMode: 'immersive',
            },
        },
    });
    ok('startIndex=0', r.startIndex === 0);
    ok('source=fallback_invalid', r.source === 'fallback_invalid');
}

section('[D2] progreso fuera de rango se clampa al último índice');
{
    const r = resolveImmersiveResumePosition({
        totalSentences: 10,
        progress: {
            porcentaje: 100,
            canonicalProgress: {
                anchor: { type: 'sentence', value: 999 },
            },
        },
    });
    ok('startIndex=9', r.startIndex === 9);
    ok('clamped=true', r.clamped === true);
}

console.log(`\nimmersiveResume — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
