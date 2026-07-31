/**
 * geminiModelCompat.test.js — CHP-AI-RUNTIME-MODEL-COMPAT-01A.
 *
 * Google retiró `gemini-1.5-flash`: desaparece de ListModels y generateContent
 * devuelve 404. Con él caían text_light, el fallback Gemini de chat y
 * chat_visual — o sea, todo el camino de texto de Leo, porque el fallback
 * OpenAI está bloqueado por saldo. Estas pruebas fijan el modelo nuevo y el
 * contrato de resolución.
 *
 *   §1  Resolución del modelo (default, override, rechazos)
 *   §2  Cableado en AI_CONFIG y ausencia del modelo retirado en el runtime
 *   §3  TTS intacto
 *   §4  Invariantes que NO cambian (retries, timeout, breaker, cliente cacheado)
 *   §5  text_light — Gemini primary, OpenAI no invocado
 *   §6  chat — OpenAI 429 → fallback Gemini
 *   §7  chat_visual — imagen y systemInstruction preservados
 *   §8  tts — sin cambio de modelo ni de contrato binario
 *   §9  Fallos: 404, 429, safety block, timeout, vacío, ambos caídos
 *  §10  Contrato de Leo (puro y estructural) sin escribir stores
 *  §11  Ningún secreto en los logs
 *
 *   node server/__test__/geminiModelCompat.test.js
 *
 * Aislamiento: cero red. Los proveedores se inyectan con dobles mediante
 * `_setProviderClientsForTest`. No se escribe nada: §10 verifica que los 42
 * archivos de data/ quedan byte a byte iguales.
 */

// PRIMER import, siempre. Declara NODE_ENV=test y redirige los stores SQLite a
// un temporal ANTES de que cualquier módulo resuelva su configuración. Sin él,
// importar leoOrchestrator abre `data/progress.db` y `data-critical/events.db`
// REALES: better-sqlite3 los toca de forma nativa, fuera del alcance del guard
// de `fs`, y en un clone limpio directamente los crea.
import './helpers/testMode.mjs';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// leoOrchestrator arrastra config.js, que en import-time exige un padrón
// canónico. Se le da una fixture sintética en un directorio temporal (por eso
// ese import es dinámico, más abajo): el test no resuelve jamás a data/ ni a
// data-critical/ reales.
const _tmpIdentity = fs.mkdtempSync(path.join(os.tmpdir(), 'gemcompat_'));
process.env.USERS_DB = path.join(_tmpIdentity, 'usuarios_colegios_oro.json');
fs.writeFileSync(process.env.USERS_DB, '[]');

import {
    AI_CONFIG,
    GEMINI_TEXT_MODEL,
    GEMINI_TEXT_MODEL_DEFAULT,
    GEMINI_TTS_MODEL,
    resolveGeminiTextModel,
    runHybridTask,
    getGemini,
    _setProviderClientsForTest,
    _resetProviderClientsForTest,
    _resetBreakers,
    isBreakerOpen,
} from '../aiEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SERVER_DIR, '..');
const WATCHED_DIRS = ['data', 'data-critical', 'public/uploads'].map((d) => path.resolve(REPO_ROOT, d));

let pass = 0, fail = 0;
const ok = (label, cond, detail) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
};
const section = (n) => console.log(`\n${n}`);

/**
 * Huella de los stores reales vigilados. Cubre data/, data-critical/ y
 * public/uploads/ — los mismos que vigila scripts/verify-test-store-isolation.mjs.
 * Un archivo NUEVO también cambia la huella, que es el caso que se da en un
 * clone limpio de CI, donde esos directorios no existen.
 */
const dataFingerprint = () => {
    const h = crypto.createHash('sha256');
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { walk(p); continue; }
            if (!e.isFile()) continue;
            try {
                const st = fs.statSync(p);
                h.update(`${path.relative(REPO_ROOT, p)}:${st.size}:${st.mtimeMs}|`);
            } catch { /* ignorar */ }
        }
    };
    for (const d of WATCHED_DIRS) walk(d);
    return h.digest('hex');
};
const DATA_BEFORE = dataFingerprint();

// ── Dobles de proveedor ──────────────────────────────────────────────────────

/** Doble de Gemini: registra las llamadas y devuelve lo que se le indique. */
const geminiDouble = (impl) => {
    const calls = [];
    return {
        calls,
        models: {
            generateContent: async (req) => {
                calls.push(req);
                return impl(req, calls.length);
            },
        },
    };
};

/** Doble de OpenAI con la forma exacta que usa aiEngine. */
const openaiDouble = (chatImpl, speechImpl) => {
    const calls = [];
    return {
        calls,
        chat: { completions: { create: async (req) => { calls.push({ kind: 'chat', req }); return chatImpl(req, calls.length); } } },
        audio: { speech: { create: async (req) => { calls.push({ kind: 'speech', req }); return speechImpl(req, calls.length); } } },
    };
};

const geminiText = (text) => ({ text, candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
const openaiText = (content) => ({ choices: [{ message: { content } }] });
const quota429 = () => { const e = new Error('429 You have no credits remaining.'); e.code = 'credit_balance_exhausted'; return e; };
const notFound404 = () => new Error('{"error":{"code":404,"message":"models/x is not found for API version v1beta","status":"NOT_FOUND"}}');

const withDoubles = async ({ gemini = null, openai = null }, fn) => {
    _resetBreakers();
    _setProviderClientsForTest({ gemini, openai });
    try { return await fn(); }
    finally { _resetProviderClientsForTest(); _resetBreakers(); }
};

// Captura de logs para §11 y para comprobar procedencia.
const captureLogs = async (fn) => {
    const lines = [];
    const orig = console.log;
    console.log = (...args) => { lines.push(args.join(' ')); };
    try { return { result: await fn(), lines }; }
    finally { console.log = orig; }
};

const run = async () => {
    // ── §1 ───────────────────────────────────────────────────────────────────
    section('§1 Resolución del modelo');
    ok('default = gemini-3.6-flash', GEMINI_TEXT_MODEL_DEFAULT === 'gemini-3.6-flash', GEMINI_TEXT_MODEL_DEFAULT);
    ok('sin variable → default', resolveGeminiTextModel(undefined).model === GEMINI_TEXT_MODEL_DEFAULT);
    ok('sin variable → source=default', resolveGeminiTextModel(undefined).source === 'default');
    ok('override válido se acepta', resolveGeminiTextModel('gemini-3.7-flash').model === 'gemini-3.7-flash');
    ok('override válido → source=env', resolveGeminiTextModel('gemini-3.7-flash').source === 'env');
    ok('espacios alrededor se recortan', resolveGeminiTextModel('  gemini-3.7-flash  ').model === 'gemini-3.7-flash');

    const rechazos = [
        ['', 'vacio'],
        ['   ', 'vacio'],
        ['gemini-flash-latest', 'alias_latest_prohibido'],
        ['GEMINI-FLASH-LATEST', 'alias_latest_prohibido'],
        ['gemini-2.5-flash-preview-tts', 'modelo_tts_no_es_modelo_textual'],
        ['gemini-3.1-flash-tts-preview', 'modelo_tts_no_es_modelo_textual'],
        ['gemini-1.5-flash', 'modelo_retirado'],
        ['gemini-1.5-pro', 'modelo_retirado'],
        ['modelo con espacios', 'identificador_no_valido'],
        ['x', 'identificador_no_valido'],
        ['../../etc/passwd', 'identificador_no_valido'],
    ];
    for (const [value, reason] of rechazos) {
        const r = resolveGeminiTextModel(value);
        ok(`rechaza ${JSON.stringify(value)} (${reason})`,
            r.model === GEMINI_TEXT_MODEL_DEFAULT && r.rejected === reason, `rejected=${r.rejected}`);
    }
    ok('un valor no-string cae al default', resolveGeminiTextModel(42).model === GEMINI_TEXT_MODEL_DEFAULT);
    ok('un override inválido nunca deja el runtime sin modelo',
        rechazos.every(([v]) => typeof resolveGeminiTextModel(v).model === 'string'
            && resolveGeminiTextModel(v).model.length > 0));

    // ── §2 ───────────────────────────────────────────────────────────────────
    section('§2 Cableado y ausencia del modelo retirado');
    ok('text_light primary usa el modelo central', AI_CONFIG.text_light.primary.model === GEMINI_TEXT_MODEL);
    ok('chat fallback usa el modelo central', AI_CONFIG.chat.fallback.model === GEMINI_TEXT_MODEL);
    ok('chat_visual primary usa el modelo central', AI_CONFIG.chat_visual.primary.model === GEMINI_TEXT_MODEL);
    ok('el modelo efectivo es el default', GEMINI_TEXT_MODEL === 'gemini-3.6-flash', GEMINI_TEXT_MODEL);

    const runtimeFiles = ['aiEngine.js', 'server.js', 'leoOrchestrator.js', 'leoResponder.js',
        'ttsService.js', 'albumTtsService.js', 'immersiveTtsService.js'];
    const activeRefs = [];
    for (const f of runtimeFiles) {
        const p = path.join(SERVER_DIR, f);
        if (!fs.existsSync(p)) continue;
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
            if (!line.includes('gemini-1.5-flash')) return;
            const trimmed = line.trim();
            const esComentario = trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
            if (!esComentario) activeRefs.push(`${f}:${i + 1}`);
        });
    }
    ok('ninguna referencia ACTIVA a gemini-1.5-flash en el runtime', activeRefs.length === 0, activeRefs.join(', '));
    ok('los modelos de AI_CONFIG no contienen la familia retirada',
        !JSON.stringify(AI_CONFIG).includes('gemini-1.5'));
    ok('ningún modelo del runtime usa alias -latest',
        !/["']gemini[a-z0-9.\-]*-latest["']/.test(JSON.stringify(AI_CONFIG)));

    // ── §3 ───────────────────────────────────────────────────────────────────
    section('§3 TTS intacto');
    ok('tts primary sigue siendo openai tts-1',
        AI_CONFIG.tts.primary.provider === 'openai' && AI_CONFIG.tts.primary.model === 'tts-1');
    ok('tts fallback sigue siendo el modelo Gemini de audio',
        AI_CONFIG.tts.fallback.provider === 'gemini' && AI_CONFIG.tts.fallback.model === 'gemini-2.5-flash-preview-tts');
    ok('la constante TTS coincide', GEMINI_TTS_MODEL === 'gemini-2.5-flash-preview-tts');
    ok('el modelo TTS y el textual son distintos', GEMINI_TTS_MODEL !== GEMINI_TEXT_MODEL);
    ok('maxInputTokens de TTS sin cambio', AI_CONFIG.tts.maxInputTokens === 2000);

    // ── §4 ───────────────────────────────────────────────────────────────────
    section('§4 Invariantes no tocadas');
    ok('maxRetries = 2', AI_CONFIG.maxRetries === 2);
    ok('timeoutMs = 15000', AI_CONFIG.timeoutMs === 15000);
    ok('breakerCooldownMs = 300000', AI_CONFIG.breakerCooldownMs === 300000);
    ok('maxChunksPerJob = 500', AI_CONFIG.maxChunksPerJob === 500);
    ok('orden primary/fallback de chat sin cambio',
        AI_CONFIG.chat.primary.provider === 'openai' && AI_CONFIG.chat.fallback.provider === 'gemini');
    ok('orden primary/fallback de text_light sin cambio',
        AI_CONFIG.text_light.primary.provider === 'gemini' && AI_CONFIG.text_light.fallback.provider === 'openai');
    ok('orden primary/fallback de chat_visual sin cambio',
        AI_CONFIG.chat_visual.primary.provider === 'gemini' && AI_CONFIG.chat_visual.fallback.provider === 'openai');

    process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'SYNTHETIC-test-key-no-real';
    _resetProviderClientsForTest();
    const c1 = getGemini();
    const c2 = getGemini();
    ok('el cliente Gemini se cachea por proceso', c1 !== null && c1 === c2);
    _resetProviderClientsForTest();

    // ── §5 ───────────────────────────────────────────────────────────────────
    section('§5 text_light — Gemini primary');
    await withDoubles({
        gemini: geminiDouble(() => geminiText('resumen sintético')),
        openai: openaiDouble(() => { throw new Error('OpenAI NO debe invocarse'); }, () => { throw new Error('no'); }),
    }, async () => {
        const g = geminiDouble(() => geminiText('resumen sintético'));
        const o = openaiDouble(() => { throw new Error('OpenAI NO debe invocarse'); }, () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const r = await runHybridTask('text_light', { text: 'Resume esto.' });
        ok('provider = gemini', r.provider === 'gemini');
        ok('modelo enviado = gemini-3.6-flash', g.calls[0].model === 'gemini-3.6-flash', g.calls[0].model);
        ok('contenido devuelto', r.data === 'resumen sintético');
        ok('OpenAI no fue invocado', o.calls.length === 0);
        ok('el prompt llega íntegro', g.calls[0].contents === 'Resume esto.');
    });

    // ── §6 ───────────────────────────────────────────────────────────────────
    section('§6 chat — OpenAI 429 → fallback Gemini');
    await withDoubles({}, async () => {
        const g = geminiDouble(() => geminiText('respuesta de Leo'));
        const o = openaiDouble(() => { throw quota429(); }, () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const r = await runHybridTask('chat', {
            messages: [{ role: 'user', content: 'hola' }],
            systemInstruction: 'Eres Leo.',
        });
        ok('la respuesta llega igualmente', r.data === 'respuesta de Leo');
        ok('provider = gemini (fallback)', r.provider === 'gemini');
        ok('modelo del fallback = gemini-3.6-flash', r.model === 'gemini-3.6-flash', r.model);
        ok('OpenAI se intentó primero', o.calls.length >= 1);
        ok('OpenAI no reintenta tras un 429', o.calls.length === 1, `intentos=${o.calls.length}`);
        ok('el breaker de openai:chat queda abierto', isBreakerOpen('openai', 'chat') === true);
        ok('el breaker de gemini:chat sigue cerrado', isBreakerOpen('gemini', 'chat') === false);
        ok('systemInstruction llega a Gemini', g.calls[0].config?.systemInstruction === 'Eres Leo.');
        ok('el historial se convierte al formato de Gemini',
            g.calls[0].contents[0].role === 'user' && g.calls[0].contents[0].parts[0].text === 'hola');
    });

    // ── §7 ───────────────────────────────────────────────────────────────────
    section('§7 chat_visual — texto + imagen');
    await withDoubles({}, async () => {
        const g = geminiDouble(() => geminiText('veo un cangrejo'));
        const o = openaiDouble(() => { throw new Error('OpenAI NO debe invocarse'); }, () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const base64 = Buffer.from('imagen-sintetica').toString('base64');
        const r = await runHybridTask('chat_visual', {
            messages: [{ role: 'user', content: '¿Qué ves?' }],
            systemInstruction: 'Eres Leo en MODO ÁLBUM.',
            imageData: { base64, mimeType: 'image/png' },
        });
        const parts = g.calls[0].contents[0].parts;
        ok('provider = gemini', r.provider === 'gemini');
        ok('modelo = gemini-3.6-flash', g.calls[0].model === 'gemini-3.6-flash');
        ok('el texto viaja en la primera parte', parts[0].text === '¿Qué ves?');
        ok('la imagen viaja como inlineData', !!parts[1]?.inlineData);
        ok('el MIME se preserva', parts[1].inlineData.mimeType === 'image/png');
        ok('el base64 se preserva íntegro', parts[1].inlineData.data === base64);
        ok('systemInstruction preservado', g.calls[0].config?.systemInstruction === 'Eres Leo en MODO ÁLBUM.');
        ok('OpenAI no fue invocado', o.calls.length === 0);
        ok('respuesta válida', r.data === 'veo un cangrejo');
    });

    // ── §8 ───────────────────────────────────────────────────────────────────
    section('§8 tts — sin regresión');
    await withDoubles({}, async () => {
        const pcm = Buffer.alloc(200, 7).toString('base64');
        const g = geminiDouble(() => ({
            candidates: [{ content: { parts: [{ inlineData: { data: pcm, mimeType: 'audio/L16;codec=pcm;rate=24000' } }] } }],
        }));
        const o = openaiDouble(() => { throw new Error('no'); }, () => { throw quota429(); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const r = await runHybridTask('tts', { text: 'Hola' });
        ok('modelo TTS sin cambio', g.calls[0].model === 'gemini-2.5-flash-preview-tts', g.calls[0].model);
        ok('sigue devolviendo WAV envuelto', r.mimeType === 'audio/wav');
        ok('cabecera RIFF intacta', r.data.slice(0, 4).toString() === 'RIFF');
        ok('el contrato binario se mantiene', Buffer.isBuffer(r.data) && r.data.length === 44 + 200);
        ok('el modelo textual NO se coló en TTS', g.calls[0].model !== GEMINI_TEXT_MODEL);
        ok('config de voz preservada', g.calls[0].config?.responseModalities?.[0] === 'AUDIO');
    });

    // ── §9 ───────────────────────────────────────────────────────────────────
    section('§9 Modos de fallo');
    await withDoubles({}, async () => {
        const g = geminiDouble(() => { throw notFound404(); });
        const o = openaiDouble(() => openaiText('respuesta de OpenAI'), () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const r = await runHybridTask('text_light', { text: 'x' });
        ok('404 de Gemini → cae a OpenAI', r.provider === 'openai' && r.data === 'respuesta de OpenAI');
        ok('un 404 sí reintenta (no es error de cuota)', g.calls.length === 2, `intentos=${g.calls.length}`);
    });

    await withDoubles({}, async () => {
        const g = geminiDouble(() => { throw quota429(); });
        const o = openaiDouble(() => openaiText('ok'), () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        await runHybridTask('text_light', { text: 'x' });
        ok('429 de Gemini abre su breaker', isBreakerOpen('gemini', 'text_light') === true);
        ok('429 de Gemini no reintenta', g.calls.length === 1);
    });

    await withDoubles({}, async () => {
        // Safety block: candidato sin partes y sin texto.
        const g = geminiDouble(() => ({ text: undefined, candidates: [{ finishReason: 'SAFETY', content: {} }], promptFeedback: { blockReason: 'SAFETY' } }));
        const o = openaiDouble(() => openaiText('respuesta segura'), () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const r = await runHybridTask('text_light', { text: 'x' });
        ok('safety block no revienta el proceso', r !== null && r !== undefined);
        ok('safety block devuelve data vacía sin lanzar', r.provider === 'gemini' && (r.data ?? undefined) === undefined);
    });

    await withDoubles({}, async () => {
        const g = geminiDouble(async () => { const e = new Error('TimeoutError: request timed out'); throw e; });
        const o = openaiDouble(() => openaiText('respuesta tras timeout'), () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const r = await runHybridTask('text_light', { text: 'x' });
        ok('timeout de Gemini → fallback OpenAI', r.provider === 'openai');
        ok('timeout NO abre breaker (no es cuota)', isBreakerOpen('gemini', 'text_light') === false);
    });

    await withDoubles({}, async () => {
        const g = geminiDouble(() => geminiText(''));
        const o = openaiDouble(() => { throw new Error('no'); }, () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        const r = await runHybridTask('text_light', { text: 'x' });
        ok('respuesta vacía se devuelve como cadena vacía, sin lanzar', r.data === '');
    });

    await withDoubles({}, async () => {
        const g = geminiDouble(() => { throw notFound404(); });
        const o = openaiDouble(() => { throw quota429(); }, () => { throw new Error('no'); });
        _setProviderClientsForTest({ gemini: g, openai: o });
        let err = null;
        try { await runHybridTask('text_light', { text: 'x' }); } catch (e) { err = e; }
        ok('ambos caídos → error explícito', err !== null && /All providers failed/.test(err.message));
        ok('el error nombra ambas causas', /primary=/.test(err.message) && /fallback=/.test(err.message));
        ok('el error no filtra la clave', !err.message.includes(process.env.GEMINI_API_KEY));
    });

    // ── §10 ──────────────────────────────────────────────────────────────────
    section('§10 Contrato de Leo');
    const { normalizeRequest } = await import('../leoOrchestrator.js');
    const recap = normalizeRequest({ contentId: 'c1', tituloLibro: 'Pinocho', textoPagina: 'Geppetto talla.' }, 'recap', 'u1');
    ok('recap normaliza con interactionType recap', recap.interactionType === 'recap');
    ok('recap conserva tituloLibro', recap.tituloLibro === 'Pinocho');
    ok('recap no arrastra historial', recap.historial === null);
    const chatReq = normalizeRequest({ mensaje: 'hola', contentId: 'c1' }, 'chatbot', 'u1');
    ok('chatbot normaliza con interactionType chat', chatReq.interactionType === 'chat');

    const orch = fs.readFileSync(path.join(SERVER_DIR, 'leoOrchestrator.js'), 'utf8');
    ok('recap sigue usando text_light', /runHybridTask\('text_light'/.test(orch));
    ok('chat sigue eligiendo chat/chat_visual por degradationMode',
        /chatTaskType = degradationMode === DEGRADATION_MODE\.MULTIMODAL_FULL \? 'chat_visual' : 'chat'/.test(orch));
    ok('la respuesta enlatada sigue siendo solo para data vacía',
        /\(result\.data \?\? ''\)\.trim\(\) \|\|/.test(orch));

    await withDoubles({}, async () => {
        const g = geminiDouble(() => geminiText('¡Hola! Seguimos con Pinocho.'));
        _setProviderClientsForTest({ gemini: g, openai: openaiDouble(() => { throw quota429(); }, () => { throw new Error('no'); }) });
        const r = await runHybridTask('text_light', { text: 'prompt de recap' });
        const answer = (r.data ?? '').trim() || '¡Hola! 🦀 Hace días no te veía. ¿Listo para continuar donde lo dejamos?';
        ok('con Gemini vivo, la respuesta NO es la enlatada', answer === '¡Hola! Seguimos con Pinocho.');
    });

    // ── §11 ──────────────────────────────────────────────────────────────────
    section('§11 Sin secretos en los logs');
    const { lines } = await captureLogs(async () => {
        const g = geminiDouble(() => geminiText('ok'));
        _setProviderClientsForTest({ gemini: g, openai: null });
        try { await runHybridTask('text_light', { text: 'x' }); } finally { _resetProviderClientsForTest(); }
    });
    const joined = lines.join('\n');
    ok('los logs no contienen la clave Gemini', !joined.includes(process.env.GEMINI_API_KEY));
    ok('los logs solo publican booleanos de presencia de clave', /gemini_key=(true|false)/.test(joined));
    ok('los logs registran el identificador del modelo', /model=gemini-3\.6-flash/.test(joined));

    ok('stores reales intactos (data, data-critical, public/uploads)',
        dataFingerprint() === DATA_BEFORE);
    ok('los stores SQLite se resolvieron a un temporal, no al repositorio',
        !String(process.env.PROGRESS_SQLITE_PATH ?? '').startsWith(REPO_ROOT)
        && !String(process.env.EVENTS_SQLITE_PATH ?? '').startsWith(REPO_ROOT));
    fs.rmSync(_tmpIdentity, { recursive: true, force: true });
};

run().then(() => {
    console.log(`\n${fail === 0 ? 'GREEN' : 'RED'} — ${pass} ok, ${fail} fallos`);
    process.exit(fail === 0 ? 0 : 1);
}).catch((e) => {
    console.error('ERROR inesperado:', e);
    process.exit(1);
});
