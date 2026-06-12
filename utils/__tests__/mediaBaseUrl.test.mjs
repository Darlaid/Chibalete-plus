/**
 * mediaBaseUrl.test.mjs — M3.1
 *
 * Tests del helper centralizado de resolución CDN.
 * Cómo correr:
 *   node utils/__tests__/mediaBaseUrl.test.mjs
 */

import {
    resolveMediaUrl,
    uploadsUrl,
    _setMediaBaseUrlForTests,
    _resetForTests,
    getMediaBaseUrlInfo,
} from '../mediaBaseUrl.js';

let pass = 0;
let fail = 0;
const test = (label, actual, expected) => {
    const ok = actual === expected;
    console.log(`  ${ok ? '✓' : '✗'} ${label}: ${ok ? 'OK' : `got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`}`);
    if (ok) pass++; else fail++;
};

console.log('\n[1] Default (sin MEDIA_BASE_URL): pasa-through');
_resetForTests();
test('relative /uploads/ pasa', resolveMediaUrl('/uploads/foo.mp3'), '/uploads/foo.mp3');
test('absoluta http pasa', resolveMediaUrl('http://x.com/foo'), 'http://x.com/foo');
test('absoluta https pasa', resolveMediaUrl('https://x.com/foo'), 'https://x.com/foo');
test('null pasa', resolveMediaUrl(null), null);
test('undefined pasa', resolveMediaUrl(undefined), undefined);
test('empty string pasa', resolveMediaUrl(''), '');
test('non-uploads path pasa', resolveMediaUrl('/api/foo'), '/api/foo');

console.log('\n[2] Con MEDIA_BASE_URL set: prefija /uploads/');
_setMediaBaseUrlForTests('https://cdn.example.com');
test('uploads se prefija', resolveMediaUrl('/uploads/foo.mp3'), 'https://cdn.example.com/uploads/foo.mp3');
test('absoluta no se toca', resolveMediaUrl('https://x.com/foo'), 'https://x.com/foo');
test('relativa no-uploads no se toca', resolveMediaUrl('/api/foo'), '/api/foo');
test('null sigue null', resolveMediaUrl(null), null);

console.log('\n[3] Trailing slash en MEDIA_BASE_URL se normaliza');
_setMediaBaseUrlForTests('https://cdn.example.com/');
test('trailing / stripped', resolveMediaUrl('/uploads/foo.mp3'), 'https://cdn.example.com/uploads/foo.mp3');
_setMediaBaseUrlForTests('https://cdn.example.com//');
test('múltiples trailing stripped', resolveMediaUrl('/uploads/foo.mp3'), 'https://cdn.example.com/uploads/foo.mp3');

console.log('\n[4] uploadsUrl: composer para paths relativos sin /uploads');
_setMediaBaseUrlForTests('https://cdn.example.com');
test('audio/foo prefija', uploadsUrl('audio/foo.mp3'), 'https://cdn.example.com/uploads/audio/foo.mp3');
test('uploads/foo se normaliza', uploadsUrl('uploads/foo.mp3'), 'https://cdn.example.com/uploads/foo.mp3');
test('absoluta pasa', uploadsUrl('https://x.com/y'), 'https://x.com/y');
test('null pasa', uploadsUrl(null), null);
test('empty pasa', uploadsUrl(''), '');

console.log('\n[5] Reset → vuelve a default');
_resetForTests();
test('uploads vuelve relativo', resolveMediaUrl('/uploads/foo.mp3'), '/uploads/foo.mp3');
test('getInfo.cdnActive false', getMediaBaseUrlInfo().cdnActive, false);

console.log('\n[6] Sanidad final con info');
_setMediaBaseUrlForTests('https://media.test');
const info = getMediaBaseUrlInfo();
test('info.baseUrl correcto', info.baseUrl, 'https://media.test');
test('info.cdnActive true', info.cdnActive, true);
test('info.initialized true', info.initialized, true);

console.log(`\nmediaBaseUrl — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
