/**
 * contentAdapter.test.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Tests reales con dataService stubbed. Cubren válido, content faltante,
 * campos inválidos, args inválidos, dataService throws.
 *
 * Cómo correr:
 *   node utils/immersiveV2/__tests__/contentAdapter.test.mjs
 */

import { resolveContent } from '../contentAdapter.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('contentAdapter — Sprint M-3.1');

// ─────────────────────────────────────────────────────────────────────────────
section('[1] content válido');
{
    const ds = { getContenidoById: (id) => ({ id, titulo: 'Alicia en el País', autor: 'Carroll' }) };
    const r = resolveContent({ contentId: 'c1', dataService: ds });
    ok('ok=true',                 r.ok === true);
    ok('content.id=c1',           r.content?.id === 'c1');
    ok('content.titulo presente', r.content?.titulo === 'Alicia en el País');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[2] content inexistente → content_not_found');
{
    const ds = { getContenidoById: () => undefined };
    const r = resolveContent({ contentId: 'cMissing', dataService: ds });
    ok('ok=false',                       r.ok === false);
    ok('error.kind=content_not_found',   r.error?.kind === 'content_not_found');
    ok('error.reason=not_found',         r.error?.reason === 'not_found');
    ok('error.meta.contentId=cMissing',  r.error?.meta?.contentId === 'cMissing');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[3] dataService.getContenidoById throws → content_not_found');
{
    const ds = { getContenidoById: () => { throw new Error('cache miss'); } };
    const r = resolveContent({ contentId: 'cBoom', dataService: ds });
    ok('ok=false',                            r.ok === false);
    ok('error.kind=content_not_found',        r.error?.kind === 'content_not_found');
    ok('error.reason=getContenidoById_throw', r.error?.reason === 'getContenidoById_throw');
    ok('error.meta.error tiene mensaje',      typeof r.error?.meta?.error === 'string');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[4] content sin id → content_invalid');
{
    const ds = { getContenidoById: () => ({ titulo: 'Sin ID' }) };
    const r = resolveContent({ contentId: 'cNoId', dataService: ds });
    ok('ok=false',                       r.ok === false);
    ok('error.kind=content_invalid',     r.error?.kind === 'content_invalid');
    ok('error.reason=missing_id',        r.error?.reason === 'missing_id');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[5] content sin titulo → content_invalid');
{
    const ds = { getContenidoById: (id) => ({ id, autor: 'Anonimo' }) };
    const r = resolveContent({ contentId: 'cNoTitle', dataService: ds });
    ok('ok=false',                       r.ok === false);
    ok('error.kind=content_invalid',     r.error?.kind === 'content_invalid');
    ok('error.reason=missing_titulo',    r.error?.reason === 'missing_titulo');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[6] titulo string vacío → content_invalid');
{
    const ds = { getContenidoById: (id) => ({ id, titulo: '' }) };
    const r = resolveContent({ contentId: 'cEmpty', dataService: ds });
    ok('ok=false',                       r.ok === false);
    ok('error.reason=missing_titulo',    r.error?.reason === 'missing_titulo');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[7] args inválidos: contentId vacío');
{
    const ds = { getContenidoById: () => ({ id: 'x', titulo: 'y' }) };
    const r = resolveContent({ contentId: '', dataService: ds });
    ok('ok=false',                          r.ok === false);
    ok('error.kind=invariant_violated',     r.error?.kind === 'invariant_violated');
    ok('error.reason=invalid_contentId',    r.error?.reason === 'invalid_contentId');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[8] args inválidos: contentId no string');
{
    const ds = { getContenidoById: () => ({ id: 'x', titulo: 'y' }) };
    const r = resolveContent({ contentId: 123, dataService: ds });
    ok('ok=false',                       r.ok === false);
    ok('error.reason=invalid_contentId', r.error?.reason === 'invalid_contentId');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[9] dataService inválido');
{
    const r1 = resolveContent({ contentId: 'c1' });
    ok('sin dataService → invariant_violated',
       r1.ok === false && r1.error?.kind === 'invariant_violated');
    const r2 = resolveContent({ contentId: 'c1', dataService: {} });
    ok('dataService sin getContenidoById → invariant_violated',
       r2.ok === false && r2.error?.reason === 'invalid_dataService');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[10] content devuelve null explícito → content_not_found');
{
    const ds = { getContenidoById: () => null };
    const r = resolveContent({ contentId: 'cNull', dataService: ds });
    ok('ok=false',                       r.ok === false);
    ok('error.kind=content_not_found',   r.error?.kind === 'content_not_found');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[11] no se invoca dataService dos veces');
{
    let calls = 0;
    const ds = { getContenidoById: (id) => { calls++; return { id, titulo: 't' }; } };
    resolveContent({ contentId: 'c1', dataService: ds });
    ok('1 sola llamada a getContenidoById', calls === 1);
}

console.log(`\ncontentAdapter — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
