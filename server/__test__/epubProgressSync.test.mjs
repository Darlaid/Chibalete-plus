/**
 * epubProgressSync.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.6.
 *
 * `canonicalProgress.epub` en el registro de progreso EXISTENTE, con merge
 * server-side (POST …/sync y POST /api/progress/my/:contentId):
 *   A. guardado de Guiado → epub byte-idéntico;
 *   B. guardado de PDF / Inmersivo / LU (/my) → epub byte-idéntico;
 *   C. guardado EPUB → sentenceIndex, totalSentences, anchor, viewportHint,
 *      contentAnchor, contentFingerprint legacy, lastInteractedMode intactos;
 *   D. dos guardados EPUB → solo cambian epub + globalPercentage (+ updatedAt);
 *      isCompleted e historial intactos;
 *   E/F. CFI inválido o > 4096 → 400, nunca truncado, store sin cambios;
 *   K. Guiado después de EPUB recupera su posición (anchor/viewportHint);
 *   J/K acceso: GET progress/item del dueño → 200 con epub; sin acceso → 403.
 * Identidad/autorización intactas (modo off, x-user-id; la cookie la cubre
 * progressReadIdentity). Servidor REAL sobre stores temporales.
 *
 *   node server/__test__/epubProgressSync.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEpubProgress, mergeCanonicalProgress, EPUB_CFI_MAX_LENGTH } from '../lib/epubProgress.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const C1 = 'content-alicia', C2 = 'content-otro';
const FP = `sha256:${'c'.repeat(64)}`;
const CFI = 'epubcfi(/6/18!/4/2/10,/1:0,/1:42)';
const EPUB = { cfi: CFI, sectionIndex: 8, fraction: 0.5077, contentFingerprint: FP };

// ── Unidad: validación + merge puros ────────────────────────────────────────
{
    console.log('[0] lib/epubProgress — validación y merge');
    ok('válido → ok', validateEpubProgress(EPUB).ok);
    ok('E. CFI sin epubcfi( → epub_cfi_invalid', validateEpubProgress({ ...EPUB, cfi: '/6/18!/4' }).reason === 'epub_cfi_invalid');
    ok('E. CFI no string → epub_cfi_invalid', validateEpubProgress({ ...EPUB, cfi: 42 }).reason === 'epub_cfi_invalid');
    const atLimit = `epubcfi(${'/'.repeat(EPUB_CFI_MAX_LENGTH - 9)})`;
    ok('CFI de exactamente 4096 → válido y sin recortar', atLimit.length === 4096 && validateEpubProgress({ ...EPUB, cfi: atLimit }).value?.cfi === atLimit);
    ok('F. CFI de 4097 → epub_cfi_too_long', validateEpubProgress({ ...EPUB, cfi: `${atLimit}x` }).reason === 'epub_cfi_too_long');
    ok('sectionIndex negativo / no entero → rechazado', !validateEpubProgress({ ...EPUB, sectionIndex: -1 }).ok && !validateEpubProgress({ ...EPUB, sectionIndex: 1.5 }).ok);
    ok('fraction fuera de 0–1 / NaN → rechazado', !validateEpubProgress({ ...EPUB, fraction: 1.01 }).ok && !validateEpubProgress({ ...EPUB, fraction: -0.1 }).ok && !validateEpubProgress({ ...EPUB, fraction: NaN }).ok);
    ok('fingerprint no sha256:<64 hex> → rechazado', !validateEpubProgress({ ...EPUB, contentFingerprint: 'sha256:ABC' }).ok && !validateEpubProgress({ ...EPUB, contentFingerprint: null }).ok);
    ok('campos extra del cliente no se persisten', JSON.stringify(validateEpubProgress({ ...EPUB, evil: 1 }).value) === JSON.stringify(EPUB));
    const norm = (p) => ({ sentenceIndex: p?.sentenceIndex ?? 0, globalPercentage: Number(p?.globalPercentage ?? 0), lastInteractedMode: p?.lastInteractedMode ?? 'text' });
    const m = mergeCanonicalProgress(undefined, { globalPercentage: 12, epub: EPUB }, { normalize: norm, updatedAt: 'T' });
    ok('sin registro previo → base normalizada + epub', m.ok && m.epubSave && m.canonicalProgress.epub.updatedAt === 'T' && m.canonicalProgress.globalPercentage === 12);
}

// ── Integración: servidor real ──────────────────────────────────────────────
const USERS = [
    { id: 'OWN', email: 'own@fx.test', roles: ['lector'], accountStatus: 'active' },
    { id: 'NOACC', email: 'noacc@fx.test', roles: ['lector'], accountStatus: 'active' },
];
const ACCESS = [
    { id: 'r-own', scope: 'user', scopeId: 'OWN', titleIds: [C1], collectionIds: [], expiresAt: Date.now() + 86400000 },
    { id: 'r-noacc', scope: 'user', scopeId: 'NOACC', titleIds: [C2], collectionIds: [], expiresAt: Date.now() + 86400000 },
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_epubprog_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json'), groups: path.join(tmp, 'groups.json'), progress: path.join(tmp, 'progress.db') };
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.content, JSON.stringify([{ id: C1, titulo: 'Alicia', tipo: 'libro' }, { id: C2, titulo: 'Otro', tipo: 'libro' }]));
fs.writeFileSync(P.access, JSON.stringify(ACCESS));
fs.writeFileSync(P.groups, '[]');
fs.writeFileSync(path.join(tmp, 'schools.json'), '[]');

const PORT = 6200 + (process.pid % 50);
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT), SESSION_AUTH_MODE: 'off',
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted',
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress,
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let out = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { out += d; });
const base = `http://127.0.0.1:${PORT}`;
const req = async (p, { method = 'GET', user = 'OWN', body } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'x-user-id': user, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* */ }
    return { status: r.status, json };
};
let tick = Date.parse('2026-10-16T10:00:00.000Z');
const nextTs = () => new Date(tick += 60000).toISOString();
const sync = (cp, extra = {}, p = `/api/progress/OWN/${C1}/sync`) => req(p, { method: 'POST', body: { canonicalProgress: cp, updatedAt: nextTs(), ...extra } });
const item = async () => (await req(`/api/progress/item/OWN/${C1}`)).json?.progress;
const S = (o) => JSON.stringify(o);
const LEGACY_KEYS = ['sentenceIndex', 'totalSentences', 'anchor', 'viewportHint', 'contentAnchor', 'contentFingerprint', 'lastInteractedMode'];
const pickLegacy = (cp) => Object.fromEntries(LEGACY_KEYS.map(k => [k, cp?.[k]]));

// Payloads reales que hoy construye dataService.updateProgreso.
const GUIADO = { sentenceIndex: 0, totalSentences: 0, globalPercentage: 42, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'text', anchor: { type: 'text', value: 42 }, viewportHint: 42.73 };
const PDF = { sentenceIndex: 0, totalSentences: 0, globalPercentage: 30, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'pdf', anchor: { type: 'page', value: 12 } };
const INMERSIVO = { sentenceIndex: 120, totalSentences: 500, globalPercentage: 24, contentAnchor: null, contentFingerprint: null, lastInteractedMode: 'immersive', anchor: { type: 'sentence', value: 120 } };

try {
    for (let i = 0; i < 600 && !/Server running on port/.test(out); i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${out.slice(-1500)}`);
        await sleep(200);
    }
    if (!/Server running on port/.test(out)) throw new Error(`server no arrancó\n${out.slice(-1500)}`);

    console.log('[1] estado Guiado previo');
    ok('Guiado sync → 200', (await sync(GUIADO, { session: { sessionId: 's-guiado', durationSec: 30 } })).status === 200);
    const g0 = await item();
    ok('… guarda su anchor/viewportHint', g0?.canonicalProgress?.viewportHint === 42.73 && g0?.canonicalProgress?.anchor?.value === 42);

    console.log('[C] guardado EPUB conserva los campos legacy');
    const e1 = await sync({ globalPercentage: 50.77, epub: EPUB });
    ok('EPUB sync → 200', e1.status === 200, S(e1.json));
    const p1 = await item();
    ok('C. sentenceIndex/totalSentences/anchor/viewportHint/contentAnchor/contentFingerprint/lastInteractedMode intactos',
        S(pickLegacy(p1.canonicalProgress)) === S(pickLegacy(g0.canonicalProgress)), `${S(pickLegacy(p1.canonicalProgress))} vs ${S(pickLegacy(g0.canonicalProgress))}`);
    ok('C. lastInteractedMode NO pasa a epub', p1.canonicalProgress.lastInteractedMode === 'text');
    ok('epub persistido = {cfi, sectionIndex, fraction, contentFingerprint, updatedAt}',
        S(Object.keys(p1.canonicalProgress.epub).sort()) === S(['cfi', 'contentFingerprint', 'fraction', 'sectionIndex', 'updatedAt']) && p1.canonicalProgress.epub.cfi === CFI && p1.canonicalProgress.epub.updatedAt === p1.updatedAt);
    ok('globalPercentage = porcentaje del EPUB', p1.canonicalProgress.globalPercentage === 50.77);
    ok('isCompleted intacto (false) e historial intacto', p1.isCompleted === false && S(p1.history) === S(g0.history));

    console.log('[D] dos guardados EPUB');
    const EPUB2 = { ...EPUB, cfi: 'epubcfi(/6/22!/4/2/6,/1:0,/1:10)', sectionIndex: 10, fraction: 0.62 };
    ok('segundo EPUB sync → 200', (await sync({ globalPercentage: 62, epub: EPUB2 })).status === 200);
    const p2 = await item();
    ok('D. epub actualizado al segundo CFI', p2.canonicalProgress.epub.cfi === EPUB2.cfi && p2.canonicalProgress.epub.sectionIndex === 10 && p2.canonicalProgress.epub.fraction === 0.62);
    ok('D. … solo cambian epub + globalPercentage', S({ ...p2.canonicalProgress, epub: 0, globalPercentage: 0 }) === S({ ...p1.canonicalProgress, epub: 0, globalPercentage: 0 }));
    ok('D. historial e isCompleted sin cambios', S(p2.history) === S(p1.history) && p2.isCompleted === false);
    const ep2 = S(p2.canonicalProgress.epub);

    console.log('[A/K] Guiado después de EPUB');
    ok('Guiado sync → 200', (await sync({ ...GUIADO, globalPercentage: 44, anchor: { type: 'text', value: 44 }, viewportHint: 44.1 })).status === 200);
    const p3 = await item();
    ok('A. epub byte-idéntico tras guardar Guiado', S(p3.canonicalProgress.epub) === ep2, S(p3.canonicalProgress.epub));
    ok('K. Guiado recupera su posición (anchor/viewportHint propios)', p3.canonicalProgress.viewportHint === 44.1 && p3.canonicalProgress.anchor?.value === 44);
    ok('… y sigue sin campo epub en lastInteractedMode', p3.canonicalProgress.lastInteractedMode === 'text');

    console.log('[B] PDF / Inmersivo / LU después de EPUB');
    ok('PDF sync → 200 y epub byte-idéntico', (await sync(PDF)).status === 200 && S((await item()).canonicalProgress.epub) === ep2);
    ok('Inmersivo sync → 200 y epub byte-idéntico', (await sync(INMERSIVO)).status === 200 && S((await item()).canonicalProgress.epub) === ep2);
    const pi = await item();
    ok('Inmersivo conserva su comportamiento (sentenceIndex 120/500)', pi.canonicalProgress.sentenceIndex === 120 && pi.canonicalProgress.totalSentences === 500);
    ok('LU /api/progress/my → 200 y epub byte-idéntico', (await sync(GUIADO, {}, `/api/progress/my/${C1}`)).status === 200 && S((await item()).canonicalProgress.epub) === ep2);
    ok('EPUB después de Inmersivo conserva sentenceIndex 120 (G)', (await sync(INMERSIVO)).status === 200
        && (await sync({ globalPercentage: 63, epub: EPUB2 })).status === 200 && (await item()).canonicalProgress.sentenceIndex === 120);

    console.log('[E/F] rechazos sin escritura');
    const before = S(await item());
    const bad = await sync({ globalPercentage: 70, epub: { ...EPUB, cfi: '/6/18!/4' } });
    ok('E. CFI inválido → 400', bad.status === 400 && bad.json?.reason === 'epub_cfi_invalid', S(bad.json));
    const long = `epubcfi(${'/4'.repeat(2100)})`;
    const tooLong = await sync({ globalPercentage: 70, epub: { ...EPUB, cfi: long } });
    ok('F. CFI > 4096 → 400 epub_cfi_too_long', tooLong.status === 400 && tooLong.json?.reason === 'epub_cfi_too_long');
    ok('F. LU /my con CFI largo → 400', (await sync({ epub: { ...EPUB, cfi: long } }, {}, `/api/progress/my/${C1}`)).status === 400);
    ok('E/F. registro intacto tras los rechazos (nada truncado)', S(await item()) === before);

    console.log('[isCompleted]');
    ok('EPUB sync con isCompleted:true no completa', (await sync({ globalPercentage: 99, epub: EPUB }, { isCompleted: true })).status === 200 && (await item()).isCompleted === false);

    console.log('[J/K] identidad y acceso (sin cambios)');
    const own = await req(`/api/progress/item/OWN/${C1}`);
    ok('K. dueño con acceso → 200 con epub', own.status === 200 && own.json?.progress?.canonicalProgress?.epub?.cfi === EPUB.cfi);
    ok('J. usuario sin acceso al título → 403', (await req(`/api/progress/item/NOACC/${C1}`, { user: 'NOACC' })).status === 403);
    ok('J. otro usuario sobre el progreso ajeno → 403 (GET) / 401 (sync)',
        (await req(`/api/progress/item/OWN/${C1}`, { user: 'NOACC' })).status === 403
        && (await req(`/api/progress/OWN/${C1}/sync`, { method: 'POST', user: 'NOACC', body: { canonicalProgress: { epub: EPUB } } })).status === 401);
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { child.kill(); await sleep(300); fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nepubProgressSync — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
