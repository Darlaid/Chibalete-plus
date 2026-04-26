/**
 * leoOrchestrator.js — Leo Unified Interaction Nucleus (D1–D3)
 *
 * Single decision point for all Leo surfaces.
 *
 * PUBLIC API:
 *   normalizeRequest(rawBody, surface, userId) → LeoInteractionRequest
 *   dispatchInteraction(req)                   → Promise<{ answer: string }>
 *
 * INTERNAL HANDLERS (not exported):
 *   _handleCompanion(req)  — delegates to leoEngine pipeline
 *   _handleChat(req)       — chatbot: catalog + 8-obj prompt + runHybridTask
 *   _handleRecap(req)      — re-engagement greeting + runHybridTask
 *
 * CONSTRAINTS:
 *   - ESM pure
 *   - No circular deps with server.js
 *   - leoEngine.js, leoPolicy.js, leoContextBuilder.js, leoGuard.js untouched
 *   - No new dependencies
 *
 * FUTURE HOOKS: search "EVIDENCE_HOOK" for D4 insertion points.
 * FUTURE SURFACES: add case to dispatchInteraction and a new _handle* function.
 */

import { processLeoRequest } from './leoEngine.js';
import { runHybridTask } from './aiEngine.js';
import { resolveLeoState, recordInteraction } from './leoMemoryService.js';
import { getLeoICDLISnapshot, resolveLeoPedagogicalAdjustment } from './leoICDLIBridge.js';
import { buildLeoEvidenceEntry, persistLeoEvidence } from './leoEvidenceService.js';
import { resolveSequenceContext, commitSequenceState, buildSequencePromptSection } from './leoSequenceService.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename  = fileURLToPath(import.meta.url);
const __dirname   = path.dirname(__filename);
const _DB_FILE    = path.resolve(__dirname, '../data/content.json');
const _PUBLIC_DIR = path.resolve(__dirname, '../public');

// ── Constants ─────────────────────────────────────────────────────────────────

const VALID_SURFACES = ['companion', 'chatbot', 'recap'];

// ── Private helpers ───────────────────────────────────────────────────────────

const _ts = () => new Date().toISOString();

function _log(msg, level = 'INFO') {
    console.log(`[${_ts()}] [leoOrchestrator] [${level}] ${msg}`);
}

async function _readJSON(file) {
    let raw;
    try {
        raw = await fs.promises.readFile(file, 'utf8');
    } catch {
        // File absent or unreadable — not an application error; caller receives []
        _log(`DB file not found: ${file}`, 'WARN');
        return [];
    }
    try {
        if (!raw.trim()) return [];
        return JSON.parse(raw);
    } catch (e) {
        _log(`Error parsing ${file}: ${e.message}`, 'ERROR');
        return [];
    }
}

function _err(message, statusCode) {
    const e = new Error(message);
    e.statusCode = statusCode;
    return e;
}

/**
 * _buildInteractionMeta — extracts canonical interaction metadata from a
 * LeoInteractionRequest. Used for consistent logging and as the D4 evidence
 * insertion point.
 *
 * D4: add { answer, evidence, icdliDimension } after the handler resolves,
 * then persist via the evidence service.
 *
 * @param {LeoInteractionRequest} req
 * @returns {{ surface, interactionType, userId, contentId, ts }}
 */
function _buildInteractionMeta(req) {
    return {
        surface:         req.surface         ?? 'unknown',
        interactionType: req.interactionType ?? 'unknown',
        userId:          req.userId          ?? 'anon',
        contentId:       req.contentId       ?? 'global',
        ts:              _ts(),
    };
}

/**
 * _injectSequenceIntoLeoContext — appends an active sequence instruction to
 * the existing leoContext string so the companion pipeline picks it up.
 * Returns the original leoContext untouched when no sequence is active.
 */
function _injectSequenceIntoLeoContext(leoContext, sequenceCtx) {
    if (!sequenceCtx?.isActive || !sequenceCtx?.promptInstruction) return leoContext ?? null;
    const block = `INSTRUCCIÓN INTERNA DE SECUENCIA (no compartir con el estudiante):\n${sequenceCtx.promptInstruction}`;
    return leoContext ? `${leoContext}\n\n${block}` : block;
}

// ── normalizeRequest ──────────────────────────────────────────────────────────

/**
 * Converts a raw HTTP body into a LeoInteractionRequest.
 * This is the compatibility bridge — it maps the existing per-route body shapes
 * into a single unified shape without changing the HTTP contract.
 *
 * Companion fields (contentId, chunkIndex, payload, exactSentence,
 * interactionType) are passed through as-is — leoGuard will validate them.
 *
 * @param {object} rawBody  — req.body from Express
 * @param {string} surface  — 'companion' | 'chatbot' | 'recap'
 * @param {string} [userId] — from req.headers['x-user-id']
 * @returns {LeoInteractionRequest}
 * @throws {Error} with .statusCode if surface unknown or required field missing
 */
export function normalizeRequest(rawBody, surface, userId) {
    if (!VALID_SURFACES.includes(surface)) {
        throw _err(`Superficie desconocida: ${surface}`, 400);
    }

    // Fields shared across all surfaces
    const base = {
        surface,
        userId:           userId           ?? null,
        contentId:        rawBody.contentId        ?? null,
        sessionMemory:    rawBody.sessionMemory     ?? null,
        readerProfile:    rawBody.readerProfile     ?? null,
        pedagogicalStage: rawBody.pedagogicalStage  ?? null,
        difficultyLevel:  rawBody.difficultyLevel   ?? null,
        leoContext:       rawBody.leoContext         ?? null,
    };

    // ── companion ─────────────────────────────────────────────────────────────
    // Contract: { contentId, chunkIndex, interactionType, payload, exactSentence }
    //   + optional: { sessionMemory, difficultyLevel, pedagogicalStage,
    //                 readerProfile, leoContext }
    //
    // Surface-level validation: none intentional here.
    // All field validation (presence, type, allowed interactionType values,
    // payload length) is owned by leoGuard.validateLeoRequest() inside
    // processLeoRequest(). If leoGuard throws, the error message drives the
    // HTTP status classification in the /api/leo/ask handler.
    //
    // Chatbot-only fields are explicitly null so handlers can assert on shape.
    if (surface === 'companion') {
        return {
            ...base,
            interactionType: rawBody.interactionType ?? null,
            chunkIndex:      rawBody.chunkIndex      ?? null,
            payload:         rawBody.payload         ?? null,
            exactSentence:   rawBody.exactSentence   ?? null,
            historial:       null,
            contenidoPagina: null,
            visualContext:   null,
            tituloLibro:     null,
        };
    }

    // ── chatbot ───────────────────────────────────────────────────────────────
    // Contract: { mensaje } required + { historial?, contentId?, contenidoPagina?,
    //   visualContext?, readerProfile?, sessionMemory? } optional
    //
    // Surface-level validation (owned here, not by leoGuard):
    //   - mensaje: non-empty string, max 1000 chars
    //   - historial: coerced to [] if absent or not an array
    //   - visualContext / contenidoPagina: passed through as-is (prompt builder
    //     uses them safely with optional chaining)
    //
    // interactionType is fixed to 'chat' — the chatbot surface has no variants.
    if (surface === 'chatbot') {
        const mensaje = rawBody.mensaje;
        if (!mensaje || typeof mensaje !== 'string' || !mensaje.trim()) {
            throw _err('mensaje es obligatorio', 400);
        }
        if (mensaje.length > 1000) {
            throw _err('Mensaje excede longitud permitida', 400);
        }
        return {
            ...base,
            interactionType: 'chat',
            chunkIndex:      null,
            payload:         mensaje,
            exactSentence:   null,
            historial:       Array.isArray(rawBody.historial) ? rawBody.historial : [],
            contenidoPagina: rawBody.contenidoPagina ?? null,
            visualContext:   rawBody.visualContext   ?? null,
            tituloLibro:     null,
        };
    }

    // ── recap ─────────────────────────────────────────────────────────────────
    // Contract: { tituloLibro } required + { textoPagina? } optional
    //
    // Surface-level validation (owned here):
    //   - tituloLibro: non-empty string (used verbatim in the AI prompt)
    //   - textoPagina: optional; truncated to 500 chars before being stored
    //     in payload to prevent prompt bloat
    //
    // Companion/chatbot fields are null — recap has no content chunk or history.
    if (surface === 'recap') {
        const { tituloLibro, textoPagina } = rawBody;
        if (!tituloLibro || typeof tituloLibro !== 'string') {
            throw _err('tituloLibro es obligatorio', 400);
        }
        return {
            ...base,
            interactionType: 'recap',
            chunkIndex:      null,
            payload:         (textoPagina || '').toString().substring(0, 500),
            exactSentence:   null,
            historial:       null,
            contenidoPagina: null,
            visualContext:   null,
            tituloLibro,
        };
    }
}

// ── dispatchInteraction ───────────────────────────────────────────────────────

/**
 * Routes a LeoInteractionRequest to the appropriate internal handler.
 * This is the single decision point for all Leo surfaces.
 *
 * Logs dispatch, success, and error with consistent metadata.
 * On error: logs then re-throws so the route handler controls HTTP response.
 *
 * @param {LeoInteractionRequest} req
 * @returns {Promise<{ answer: string }>}
 */
export async function dispatchInteraction(req) {
    const meta = _buildInteractionMeta(req);
    _log(`dispatch  surface=${meta.surface} type=${meta.interactionType} userId=${meta.userId} contentId=${meta.contentId}`);

    // D2: Resolve effective Leo state from backend memory.
    // Backend values win over frontend hints per merge rules in leoMemoryService.
    const leoState = resolveLeoState({
        userId:                 req.userId,
        contentId:              req.contentId,
        incomingSessionMemory:  req.sessionMemory,
        incomingReaderProfile:  req.readerProfile,
    });

    // D3: ICDLI snapshot and pedagogical adjustment.
    // getLeoICDLISnapshot returns null (no userId) or { hasData: false } (new user) — both safe.
    // resolveLeoPedagogicalAdjustment falls back to D2 state when no ICDLI data available.
    const icdliSnapshot = getLeoICDLISnapshot(req.userId);
    const adjustment    = resolveLeoPedagogicalAdjustment(icdliSnapshot, leoState.sessionMemory, leoState.readerProfile);

    // Replace incoming frontend memory with backend-authoritative state + ICDLI adjustments.
    // difficultyLevel: ICDLI wins when hasData; otherwise D2 session value.
    // pedagogicalStage: session memory is authoritative — ICDLI never overrides book position.
    // readerProfile.preferredSupportType: ICDLI alert mapping wins; falls back to D2 counter value.
    const enrichedReq = {
        ...req,
        sessionMemory: leoState.sessionMemory,
        readerProfile: {
            ...leoState.readerProfile,
            preferredSupportType: adjustment.preferredSupportType ?? leoState.readerProfile.preferredSupportType,
        },
        difficultyLevel:  adjustment.difficultyLevel,
        pedagogicalStage: leoState.sessionMemory.pedagogicalStage ?? req.pedagogicalStage ?? null,
        icdliSnapshot,
    };

    // D5: Resolve micro-sequence context for this interaction.
    // Returns null (no sequence) or a LeoSequenceContext (sequence step to execute).
    // Injected into enrichedReq so handlers and evidence service can consume it.
    const sequenceContext = resolveSequenceContext({
        sessionMemory: enrichedReq.sessionMemory,
        readerProfile: enrichedReq.readerProfile,
        icdliSnapshot: enrichedReq.icdliSnapshot,
        surface:       enrichedReq.surface,
    });
    enrichedReq.sequenceContext = sequenceContext;

    try {
        let result;
        switch (enrichedReq.surface) {
            case 'companion': result = await _handleCompanion(enrichedReq); break;
            case 'chatbot':   result = await _handleChat(enrichedReq);      break;
            case 'recap':     result = await _handleRecap(enrichedReq);     break;
            default:          throw _err(`Superficie no soportada: ${enrichedReq.surface}`, 400);
        }

        // D5: Persist sequence state (before D2 recordInteraction so the sequence
        // fields land in the DB before the interactionCount increment overwrites nothing).
        // Fire-and-forget: commitSequenceState never throws.
        commitSequenceState({
            userId:                  req.userId,
            contentId:               req.contentId,
            sequenceCtx:             sequenceContext,
            currentInteractionCount: enrichedReq.sessionMemory.interactionCount ?? 0,
        });

        // D2: Persist interaction into backend memory (session + profile counters).
        // Fire-and-forget: write errors are caught inside recordInteraction.
        recordInteraction({
            userId:          req.userId,
            contentId:       req.contentId,
            surface:         req.surface,
            interactionType: req.interactionType,
            chunkIndex:      req.chunkIndex ?? null,
        });

        _log(`success   surface=${meta.surface} type=${meta.interactionType} userId=${meta.userId} contentId=${meta.contentId}`);

        // D4: Build and persist structured pedagogical evidence.
        // Fire-and-forget: evidence write errors are caught inside persistLeoEvidence
        // and must never block or alter the response.
        try {
            const evidenceEntry = buildLeoEvidenceEntry(enrichedReq, result);
            persistLeoEvidence(evidenceEntry);
        } catch (evidenceError) {
            _log(`evidence hook failed: ${evidenceError.message}`, 'WARN');
        }

        return result;
    } catch (error) {
        _log(`error     surface=${meta.surface} type=${meta.interactionType} userId=${meta.userId} contentId=${meta.contentId} msg=${error.message}`, 'WARN');
        throw error;
    }
}

// ── _handleCompanion ──────────────────────────────────────────────────────────

async function _handleCompanion(req) {
    // D5: If a sequence is active, append the step instruction to leoContext.
    // leoContext is already forwarded as-is through leoGuard → leoContextBuilder.
    // Appending here keeps leoEngine/leoGuard/leoPolicy untouched.
    const leoContext = _injectSequenceIntoLeoContext(req.leoContext, req.sequenceContext);

    // Full pipeline: leoGuard → leoContextBuilder → leoPolicy → leoResponder → runHybridTask
    const result = await processLeoRequest(
        req.contentId,
        req.chunkIndex,
        req.interactionType,
        req.payload,
        req.exactSentence,
        req.sessionMemory    ?? null,
        req.difficultyLevel  ?? null,
        req.pedagogicalStage ?? null,
        req.readerProfile    ?? null,
        leoContext,
    );

    return { answer: result.answer };
}

// ── _handleChat ───────────────────────────────────────────────────────────────

// ── Image loading constants and helpers ──────────────────────────────────────

// Hard cap before base64-encoding. Gemini's inline limit is 20 MB; staying at
// 10 MB gives headroom and avoids slow encoding of oversized illustrations.
const _MAX_IMAGE_BYTES  = 10 * 1024 * 1024; // 10 MB
// Remote fetch timeout — prevents a slow/unreachable CDN from stalling the
// entire Leo chat request handler indefinitely.
const _FETCH_TIMEOUT_MS = 5000;

// Structured fallback reason enum — every image-load failure maps to exactly one
// of these values so callers can log, route, and respond uniformly.
const IMAGE_LOAD_FAILURE = Object.freeze({
    NO_IMAGE_URL:       'no_image_url',       // visualContext present but imageUrl missing/falsy
    MISSING_LOCAL_FILE: 'missing_local_file',
    REMOTE_TIMEOUT:     'remote_timeout',
    REMOTE_NON_OK:      'remote_non_ok',
    REMOTE_FETCH_ERROR: 'remote_fetch_error',
    IMAGE_TOO_LARGE:    'image_too_large',
    UNSUPPORTED_SCHEME: 'unsupported_scheme',
});

// First-class degradation mode — describes Leo's visual capability for a given turn.
//   multimodal_full     — image loaded; Gemini receives inlineData.
//   album_text_fallback — album context present but image unavailable; text-only.
//   plain_chat          — no visualContext at all; standard chatbot mode.
const DEGRADATION_MODE = Object.freeze({
    MULTIMODAL_FULL:     'multimodal_full',
    ALBUM_TEXT_FALLBACK: 'album_text_fallback',
    PLAIN_CHAT:          'plain_chat',
});

/**
 * _fetchImageBase64(imageUrl) — STRICT INTERNAL CONTRACT
 *
 * Always returns { imageData, fallbackReason }. Never throws. Never returns a
 * partial structure. Callers can destructure unconditionally.
 *
 *   imageData      — { mimeType, base64 } ready for Gemini inlineData, or null.
 *   fallbackReason — IMAGE_LOAD_FAILURE constant on any failure, null on success.
 *
 * Resolution strategy:
 *   1. '/uploads/*' → fs.promises.stat (size guard), then fs.promises.readFile.
 *   2. http(s):// → Content-Length pre-check, AbortController timeout, body buffer.
 *
 * Every failure path maps to exactly one IMAGE_LOAD_FAILURE value — no fallthrough,
 * no undefined. Unexpected errors fall back to REMOTE_FETCH_ERROR.
 *
 * @param {string} imageUrl
 * @returns {Promise<{ imageData: { mimeType: string, base64: string } | null, fallbackReason: string | null }>}
 */
async function _fetchImageBase64(imageUrl) {
    // Defensive guard — callers should use NO_IMAGE_URL before calling this function
    // when imageUrl is absent. This path is a last-resort safety net.
    if (!imageUrl) return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.NO_IMAGE_URL };

    const _extToMime = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg',
        png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    };

    function _mimeFromPath(p) {
        const ext = p.split('.').pop()?.toLowerCase() ?? '';
        return _extToMime[ext] ?? 'image/jpeg';
    }

    try {
        // ── Local file: pre-stat for size, then async read ────────────────────
        if (imageUrl.startsWith('/uploads/')) {
            const filePath = path.join(_PUBLIC_DIR, imageUrl);
            let stat;
            try {
                stat = await fs.promises.stat(filePath);
            } catch {
                _log(`[LEO_ALBUM] event=missing_local_file url=${imageUrl}`, 'WARN');
                return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.MISSING_LOCAL_FILE };
            }
            if (stat.size > _MAX_IMAGE_BYTES) {
                _log(`[LEO_ALBUM] event=image_too_large sizeMb=${(stat.size / 1e6).toFixed(1)} url=${imageUrl}`, 'WARN');
                return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.IMAGE_TOO_LARGE };
            }
            const buffer = await fs.promises.readFile(filePath);
            return { imageData: { mimeType: _mimeFromPath(imageUrl), base64: buffer.toString('base64') }, fallbackReason: null };
        }

        // ── Remote fetch: Content-Length pre-check + AbortController timeout ──
        if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), _FETCH_TIMEOUT_MS);
            let response;
            try {
                response = await fetch(imageUrl, { signal: controller.signal });
            } catch (fetchErr) {
                if (fetchErr.name === 'AbortError') {
                    _log(`[LEO_ALBUM] event=remote_timeout ms=${_FETCH_TIMEOUT_MS} url=${imageUrl}`, 'WARN');
                    return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.REMOTE_TIMEOUT };
                }
                _log(`[LEO_ALBUM] event=remote_fetch_error err=${fetchErr.message} url=${imageUrl}`, 'WARN');
                return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.REMOTE_FETCH_ERROR };
            } finally {
                clearTimeout(timer); // always release, even on success
            }
            if (!response.ok) {
                _log(`[LEO_ALBUM] event=remote_non_ok status=${response.status} url=${imageUrl}`, 'WARN');
                return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.REMOTE_NON_OK };
            }
            // Content-Length pre-check: avoid buffering an oversized body entirely.
            const clHeader = parseInt(response.headers.get('content-length') ?? '0', 10);
            if (clHeader > _MAX_IMAGE_BYTES) {
                _log(`[LEO_ALBUM] event=image_too_large_header sizeMb=${(clHeader / 1e6).toFixed(1)} url=${imageUrl}`, 'WARN');
                return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.IMAGE_TOO_LARGE };
            }
            const contentType = response.headers.get('content-type') ?? 'image/jpeg';
            const mimeType    = contentType.split(';')[0].trim();
            const arrayBuffer = await response.arrayBuffer();
            // Post-buffer size guard (server may omit Content-Length)
            if (arrayBuffer.byteLength > _MAX_IMAGE_BYTES) {
                _log(`[LEO_ALBUM] event=image_too_large_buffer sizeMb=${(arrayBuffer.byteLength / 1e6).toFixed(1)} url=${imageUrl}`, 'WARN');
                return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.IMAGE_TOO_LARGE };
            }
            return { imageData: { mimeType, base64: Buffer.from(arrayBuffer).toString('base64') }, fallbackReason: null };
        }

        _log(`[LEO_ALBUM] event=unsupported_scheme url=${imageUrl}`, 'WARN');
        return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.UNSUPPORTED_SCHEME };
    } catch (e) {
        _log(`[LEO_ALBUM] event=unexpected_error err=${e.message} url=${imageUrl}`, 'WARN');
        return { imageData: null, fallbackReason: IMAGE_LOAD_FAILURE.REMOTE_FETCH_ERROR };
    }
}

// ── Album mode system prompt builder ─────────────────────────────────────────

/**
 * Builds the MODO ÁLBUM section injected into Leo's system prompt.
 * Includes structured identifiers and pedagogical context from 2.0-A fields.
 *
 * Behavior is driven exclusively by degradationMode — never re-derived from imageData:
 *   MULTIMODAL_FULL     — image attached; Leo may reference visuals confidently.
 *   ALBUM_TEXT_FALLBACK — no image; Leo is forbidden from inventing visual elements.
 *
 * INVARIANT: only called when degradationMode !== PLAIN_CHAT.
 *
 * @param {object} vc              visualContext object from the request
 * @param {string} degradationMode DEGRADATION_MODE constant
 */
function _buildAlbumSystemSection(vc, degradationMode) {
    const pageLabel = vc.pageId ? `id="${vc.pageId}"` : `posición ${(vc.pageIndex ?? 0) + 1}`;
    const pageType  = vc.pageType ?? 'single';
    // regionId is null in overview mode (no region focused). Do not fabricate a
    // zone label or force a regionType — that would tell Leo a region is active
    // when the student is looking at the full page.
    const hasRegion = vc.regionId != null;

    let section = `\n\n*** MODO ÁLBUM ILUSTRADO ***`;
    section += `\nLibro: "${vc.bookTitle}" | Página ${pageLabel} (${pageType})`;
    if (hasRegion) {
        section += ` | zona "${vc.regionId}" (${vc.regionType ?? 'focus'}).`;
    } else {
        section += ` | vista general de la página.`;
    }

    // regionText is a TEXT TRANSCRIPTION extracted from the page — never a visual
    // description. Label it correctly and never present it as visual evidence.
    if (hasRegion && vc.regionText) {
        section += `\nTexto de la zona: "${vc.regionText}"`;
    } else if (!hasRegion && vc.regionText) {
        section += `\nTexto de la página: "${vc.regionText}"`;
    }

    if (degradationMode === DEGRADATION_MODE.MULTIMODAL_FULL) {
        // Image attached — Leo may make confident, direct visual references.
        section += `\n[Tienes acceso a la imagen de esta página. Puedes hacer referencias visuales concretas a lo que observas en ella.]`;
    } else {
        // ALBUM_TEXT_FALLBACK: image unavailable. Strict epistemic boundary enforced
        // here and must not be removed. regionText above is a text transcription —
        // not a visual description — and must not be treated as visual evidence.
        section += `\n[NOTA: En este turno no tienes acceso a la imagen. Basa tu respuesta en el texto transcrito, los metadatos de zona y tu conocimiento del género álbum. El texto de zona es una transcripción de texto visible — no es una descripción de elementos visuales. No infieras ni inventes detalles visuales que no estén explícitamente descritos.]`;
    }

    // Pedagogical objective — two separate objMaps keep visual specificity in
    // MULTIMODAL_FULL without contaminating ALBUM_TEXT_FALLBACK with visual phrasing.
    const obj = vc.pedagogicalObjective;
    if (obj) {
        const objMap = degradationMode === DEGRADATION_MODE.MULTIMODAL_FULL
            ? {
                literal:     'Haz UNA pregunta de comprensión literal sobre algo concreto que se observa en la imagen.',
                inferential: 'Invita al estudiante a inferir algo que la imagen sugiere pero no muestra explícitamente.',
                reflective:  'Invita al estudiante a reflexionar críticamente sobre lo que ve en la imagen.',
                writing:     'Invita al estudiante a producir brevemente (2 oraciones) a partir de lo que observa.',
            }
            : {
                literal:     'Haz UNA pregunta de comprensión literal sobre lo descrito en esta página.',
                inferential: 'Invita al estudiante a inferir algo que no está dicho explícitamente.',
                reflective:  'Invita al estudiante a reflexionar críticamente sobre lo que lee y observa.',
                writing:     'Invita al estudiante a producir brevemente (2 oraciones) a partir de esta página.',
            };
        section += `\nObjetivo pedagógico: ${obj}. ${objMap[obj] ?? ''}`;
    } else {
        section += `\nAplica los objetivos 2 (Inferir) y 8 (Disfrutar) en relación con esta página del álbum.`;
    }

    // Optional mediator hint — internal directive, never shown to student
    if (vc.leoHint) {
        section += `\n[Pista del mediador: "${vc.leoHint}"]`;
    }

    section += `\nIMPORTANTE: Responde de manera adecuada para el nivel lector. No describas la imagen si el estudiante no lo pide. Espera su pregunta o iniciativa.`;

    return section;
}

async function _handleChat(req) {
    const { contentId, payload: mensaje, historial, contenidoPagina, visualContext, sessionMemory, readerProfile } = req;

    // Catalog — used for context injection and plot-point enrichment
    const contentList = await _readJSON(_DB_FILE);
    const catalogo = contentList
        .map(c => `Título: ${c.titulo}, Autor: ${c.autor}, Temas: ${(c.etiquetas || []).join(', ')}`)
        .join('\n');

    const contentItem = contentId ? contentList.find(c => c.id === contentId) : null;
    const plotPoints  = contentItem?.plotPoints || [];
    let criticalContext = '';
    if (plotPoints.length > 0) {
        const pts = plotPoints.map(p =>
            `- En capítulo/página ${p.pageOrChapter}: ${p.title}. Análisis: ${p.insight} (${p.type})`
        ).join('\n');
        criticalContext = `\nHITOS CRÍTICOS Y CONTEXTUALES DE ESTE LIBRO (GUÍA DE LECTURA):\n${pts}\n\nINSTRUCCIÓN CLAVE: Si el usuario menciona algo relacionado con estos hitos, ¡USA ESTA INFORMACIÓN! Ofrece datos curiosos sobre el autor, contexto histórico o estilo literario.`;
    }

    // System prompt: base + optional adaptive + optional context sections
    let systemInstruction = _buildChatSystemPrompt(catalogo);

    const progress     = sessionMemory?.sessionReadingProgress ?? 0;
    const anchorsCount = (sessionMemory?.recentAnchors || []).length;
    const hasSignals   = progress > 0 || !!sessionMemory?.pedagogicalStage || !!readerProfile?.preferredSupportType;
    if (hasSignals) {
        systemInstruction += _buildAdaptiveSection(progress, anchorsCount, sessionMemory, readerProfile);
    }

    // Resolve album image (async, before building system prompt so we know if it loaded).
    // fallbackReason is set eagerly when visualContext exists but imageUrl is absent so
    // logs never show reason=none for a fallback turn (Task 1 — SAFE BASE requirement).
    let imageData = null;      // { mimeType, base64 } | null
    let fallbackReason = (visualContext && !visualContext.imageUrl)
        ? IMAGE_LOAD_FAILURE.NO_IMAGE_URL
        : null;
    if (visualContext?.imageUrl) {
        ({ imageData, fallbackReason } = await _fetchImageBase64(visualContext.imageUrl));
    }

    // Degradation mode — first-class concept driving task routing and Leo's instructions.
    const degradationMode = !visualContext
        ? DEGRADATION_MODE.PLAIN_CHAT
        : imageData
            ? DEGRADATION_MODE.MULTIMODAL_FULL
            : DEGRADATION_MODE.ALBUM_TEXT_FALLBACK;

    // Structured observability log for every album turn (success and fallback alike).
    // PLAIN_CHAT produces no [LEO_ALBUM] log — it is not an album interaction.
    // INVARIANT: degradationMode is computed once above and drives all routing below.
    if (degradationMode !== DEGRADATION_MODE.PLAIN_CHAT) {
        _log(
            `[LEO_ALBUM] mode=${degradationMode}` +
            ` contentId=${contentId ?? 'none'}` +
            ` pageId=${visualContext.pageId ?? 'unknown'}` +
            ` regionId=${visualContext.regionId ?? 'none'}` +
            ` reason=${fallbackReason ?? 'none'}`,
            degradationMode === DEGRADATION_MODE.ALBUM_TEXT_FALLBACK ? 'WARN' : 'INFO'
        );
    }

    // INVARIANT: visualContext governs album mode — _buildAlbumSystemSection is
    // only called when degradationMode !== PLAIN_CHAT (equivalent condition).
    //
    // ARCHITECTURAL DECISION (Sprint 2.0-A.2): criticalContext (plot-point guidance)
    // is intentionally excluded from album turns. Album mode provides per-page context
    // (pageId, regionText, pedagogicalObjective, leoHint) that is already richer and
    // more specific than chapter-level plot-point summaries. Mixing them would create
    // competing directives and dilute the per-page pedagogical focus. If plot guidance
    // is needed for a specific album book, encode it as leoHint per region instead.
    if (degradationMode !== DEGRADATION_MODE.PLAIN_CHAT) {
        systemInstruction += _buildAlbumSystemSection(visualContext, degradationMode);
    } else {
        systemInstruction += criticalContext;
    }

    // D3: ICDLI mediation hint (internal context — never shown to student)
    if (req.icdliSnapshot?.hasData) {
        systemInstruction += _buildICDLIHint(req.icdliSnapshot);
    }

    // D5: Sequence instruction (internal directive — never shown to student).
    // Appended last so it takes priority over generic adaptive hints.
    systemInstruction += buildSequencePromptSection(req.sequenceContext ?? null);

    if (contentItem && degradationMode === DEGRADATION_MODE.PLAIN_CHAT) {
        const snippet = contenidoPagina ? String(contenidoPagina).substring(0, 500) : 'N/A';
        systemInstruction += `\n\nCONTEXTO DE LECTURA (TEXTO):\nLibro: "${contentItem.titulo}" de ${contentItem.autor}.\nDescripción: ${contentItem.descripcion_corta}\nTexto visible ahora: "${snippet}..."\n\nUsa este texto para formular preguntas específicas sobre la trama y estructura.`;
    }

    // Multi-turn messages. Normalize 'model' → 'assistant' for OpenAI compat;
    // aiEngine.js Gemini branch converts 'assistant' → 'model' internally.
    const messages = [
        ...(historial || []).slice(-10).map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.text || m.content || '',
        })),
        { role: 'user', content: mensaje },
    ];

    // Leo invariant: systemInstruction must always be present for chat turns.
    // _buildChatSystemPrompt always returns a non-empty string, so this assertion only
    // fires if a future refactor accidentally skips the build step — fail fast rather
    // than send an instruction-free request that silently produces off-policy responses.
    if (!systemInstruction) {
        throw _err('systemInstruction vacío en turno Leo chat — aborting to prevent context loss', 500);
    }

    // chatTaskType is driven exclusively by degradationMode — never by a direct
    // imageData null-check so the routing logic stays in one canonical place.
    // MULTIMODAL_FULL → chat_visual (Gemini primary, inlineData attached).
    // ALBUM_TEXT_FALLBACK / PLAIN_CHAT → chat (OpenAI primary, no image).
    // When album text-fallback, the system prompt already contains the MODO ÁLBUM
    // section with the no-visual-access instruction, so album context is preserved
    // even without the image.
    const chatTaskType = degradationMode === DEGRADATION_MODE.MULTIMODAL_FULL ? 'chat_visual' : 'chat';
    // EVIDENCE_HOOK: { surface:'chatbot', userId, contentId, mensaje, degradationMode, fallbackReason, answer, ts }
    const result = await runHybridTask(chatTaskType, { messages, systemInstruction, imageData });
    const answer = (result.data ?? '').trim() ||
        '¡Hola! Soy Leo 🦀. Estoy releyendo un clásico. ¿En qué puedo ayudarte con tu lectura?';

    return { answer };
}

// ── _handleRecap ──────────────────────────────────────────────────────────────

async function _handleRecap(req) {
    const { tituloLibro, payload: snippet } = req;

    const prompt = `Eres Leo 🦀, el asistente amigable de la biblioteca Chibalete.
El usuario ha dejado de leer el libro "${tituloLibro}" hace unos días.

Tu misión: Darle una cálida bienvenida en el chat y recordarle brevemente dónde quedó.

Texto donde quedó: "${snippet}..."

Genera un mensaje de chat corto (máx 3 oraciones) que empiece con "¡Hola! 🦀 Hace días no te veía..." y luego resuma en una línea qué estaba pasando, invitando a seguir.
Sé entusiasta y motivador.`;

    const result = await runHybridTask('text_light', { text: prompt });
    const answer = (result.data ?? '').trim() ||
        '¡Hola! 🦀 Hace días no te veía. ¿Listo para continuar donde lo dejamos?';

    // EVIDENCE_HOOK: { surface:'recap', userId:req.userId, contentId:req.contentId, tituloLibro, answer, ts:_ts() }

    return { answer };
}

// ── Private prompt builders ───────────────────────────────────────────────────

function _buildChatSystemPrompt(catalogo) {
    return `Eres "Leo", el Mediador Pedagógico Virtual de Chibalete+.
Tu misión es conversar con los estudiantes guiándote EXCLUSIVAMENTE por los 8 Objetivos Pedagógicos de la plataforma.

TUS 8 OBJETIVOS DE MEDIACIÓN (ÚSALOS EN CADA INTERACCIÓN):
1. COMPRENDER (Global): Haz preguntas sobre la estructura del texto y su significado general. Pide que lo expliquen con sus palabras.
2. INFERIR (Implícito): Lanza preguntas tipo "¿Qué crees que pensaba este personaje?" o "¿Por qué pasó esto si no lo dice?".
3. EVALUAR (Crítico): Propón debates. "¿Estás de acuerdo?", "¿Qué sesgo ves aquí?". Detecta falacias.
4. INTEGRAR (Fuentes): Ayuda a conectar dos textos del catálogo. "¿En qué se parece esto al otro libro que leíste?".
5. CONECTAR (Vida/Contexto): Pregunta "¿Has vivido algo así?", "¿Cómo se ve esto en tu barrio?".
6. VOCABULARIO/METACOGNICIÓN: Define palabras por contexto. Pregunta "¿Qué hiciste para entender esa parte difícil?".
7. EXPRESAR (Creación): Invita a escribir finales alternativos o cartas. "¿Qué le dirías al autor?".
8. DISFRUTAR (Estético): Celebra el avance. Pregunta sobre emociones. "¿Qué sentiste en esa escena?".

SISTEMA DE PREMIOS (PUNTOS DE MAGIA):
Si el estudiante muestra una reflexión profunda, conecta ideas, o demuestra entusiasmo genuino, PUEDES PREMIARLO.
Para hacerlo, escribe en una línea nueva al final de tu mensaje: [AWARD_POINTS: 5] (Máximo 5 puntos por interacción).
Dile explícitamente "Te he dado 5 puntos de magia por esa gran respuesta".
Úsalo con moderación (solo cuando sea muy bueno).

REGLA DE ORO DE CONTENIDO:
Toda la conversación debe surgir y volver a los contenidos de la App (los libros del catálogo).
NO hables de cosas externas a menos que sea para conectarlas con un libro de la biblioteca.
Si el usuario habla de un tema X, busca en el catálogo un libro relacionado y recomiéndalo.

CATÁLOGO DE LA BIBLIOTECA (TUS HERRAMIENTAS):
${catalogo}

TOKENS DE ACCIÓN (invisibles al estudiante — añádelos solo al final de tu respuesta cuando aplique):
[INTERACTION_TYPE:vocab] — tu respuesta explicó vocabulario.
[INTERACTION_TYPE:inferential] — hiciste preguntas de inferencia o interpretación.
[INTERACTION_TYPE:reflection] — invitaste a reflexión personal o evaluación crítica.
[SAVE_VOCAB:palabra] — para guardar una palabra clave en el glosario del lector (máx 1 por respuesta).
Nunca menciones estos tokens al estudiante.`;
}

/**
 * Builds an internal mediation hint from an ICDLI snapshot.
 * This block is appended to the chatbot system prompt but explicitly
 * instructed not to be shared with the student — it adjusts Leo's style.
 *
 * @param {LeoICDLISnapshot} snapshot — must have hasData === true
 * @returns {string}
 */
function _buildICDLIHint(snapshot) {
    const lines = [`Nivel lector: ${snapshot.levelLabel} (score ${snapshot.composite}/100).`];
    if (snapshot.dominantAlerts.length > 0) {
        lines.push(`Áreas débiles a apoyar: ${snapshot.dominantAlerts.join(' y ')}.`);
    }
    if (snapshot.dominantStrengths.length > 0) {
        lines.push(`Fortalezas del lector: ${snapshot.dominantStrengths.join(' y ')}.`);
    }
    if (snapshot.recommendedDose === 'guided') {
        lines.push('Mediación guiada: preguntas simples, confirma comprensión frecuentemente.');
    } else if (snapshot.recommendedDose === 'light') {
        lines.push('Mediación autónoma: puedes plantear preguntas complejas con poco andamiaje.');
    }
    return `\n\nGUÍA INTERNA DE MEDIACIÓN (NO compartir con el estudiante — solo para ajustar tu estilo):\n${lines.join(' ')}`;
}

function _buildAdaptiveSection(progress, anchorsCount, sessionMemory, readerProfile) {
    const stage = sessionMemory?.pedagogicalStage ?? (
        progress >= 85 ? 'creation' :
        progress >= 60 || anchorsCount >= 5 ? 'reflection' :
        progress >= 25 || anchorsCount >= 2 ? 'interpretation' :
        'comprehension'
    );
    const stageHints = {
        comprehension:  'Prioriza comprensión literal (Obj.1) y vocabulario (Obj.6).',
        interpretation: 'Prioriza inferencia (Obj.2) y conexión entre textos (Obj.4).',
        reflection:     'Prioriza evaluación crítica (Obj.3) y conexión personal (Obj.5).',
        creation:       'Prioriza expresión creativa (Obj.7) e invita al estudiante a producir.',
    };
    const supportHints = {
        vocabulary:  'Este lector prefiere apoyo de vocabulario — explica palabras difíciles en contexto.',
        inferential: 'Este lector responde bien a preguntas de inferencia — formula preguntas implícitas.',
        reflection:  'Este lector reflexiona bien — invita a conectar el texto con experiencias propias.',
    };
    const lines = [`Etapa: ${stage}. ${stageHints[stage] ?? ''}`];
    if (readerProfile?.preferredSupportType && supportHints[readerProfile.preferredSupportType]) {
        lines.push(supportHints[readerProfile.preferredSupportType]);
    }
    return `\n\nADAPTACIÓN PEDAGÓGICA:\n${lines.join('\n')}`;
}
