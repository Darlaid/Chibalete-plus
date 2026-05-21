/**
 * VisorInmersivoV2.tsx — Sprint Inmersivo V2 / Fase M-4 fix #2.
 *
 * Viewer LOCAL del runtime V2. Conectado al stack PRODUCTIVO real.
 *
 * Arquitectura M-4 fix #2 — Wrapper + Inner:
 *
 *   <VisorInmersivoV2>          ← bootstrap defensive (try/catch).
 *      │   Si crea stack OK → renderiza <VisorInmersivoV2Inner>.
 *      │   Si throws → renderiza <BootstrapFailureFallback> con error visible.
 *      ▼
 *   <VisorInmersivoV2Inner>     ← componente real con hooks que dependen
 *                                  de un stack ya válido (subscribe, etc.).
 *
 * Razón: hasta el fix #1, todo vivía en un solo componente. Si la creación
 * del stack throw síncrono, los hooks posteriores (useSyncExternalStore con
 * runtime.subscribe) crasheaban antes de poder mostrar fallback. La
 * separación garantiza que un bootstrap fail produce UI explícita en vez
 * de "opening 0/0" silencioso.
 *
 * Logs directos vía console.* (no via diagnostics): si el stack NO se crea,
 * el diagnostics tampoco existe; necesitamos visibilidad cruda.
 *
 * NO importa: useImmersivePlayback, immersivePlaybackMachine,
 *             activeSentenceBuffer, BlockEngine,
 *             RewardEngine, TranceEngine.
 * NO contiene: hardResync, polling, hacks de divergencia.
 *
 * M-5 (presentation layer): SÍ importa components/ImmersiveShell — es pure-render,
 *  zero deps V1, props-in JSX-out. El audit-v2-isolation.mjs lo whiteliste.
 *
 * NO está enrutado en producción. Acceso vía /visor-v2-local/:id (DEV ONLY).
 */

import React, {
    useCallback,
    useEffect, useRef, useState, useSyncExternalStore, useMemo,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import type { Content } from '../types';

// Adapters productivos M-3.1+
import { hydrateSentences }      from '../utils/immersiveV2/sentenceAdapter.mjs';
import { normalizeRaw }          from '../utils/immersiveV2/manifestAdapter.mjs';
import { restoreProgress, commitProgress } from '../utils/immersiveV2/progressAdapter.mjs';
import { createProductionRuntime } from '../utils/immersiveV2/createProductionRuntime.mjs';
import { createDiagnostics }     from '../engines/Diagnostics.mjs';

// Bridge dispatch helpers (M-2)
import {
    dispatchPlay,
    dispatchPause,
    dispatchResume,
    dispatchPrev,
    dispatchNext,
    dispatchGoTo,
    reportVisible,
} from '../utils/immersiveRuntimeV2Bridge.mjs';

// M-5: presentation layer — teleprompter cinematográfico desacoplado
import ImmersiveShell from '../components/ImmersiveShell';
import {
    ChevronLeft, Play, Pause, SkipForward, Plus, Minus,
} from 'lucide-react';

import type { ImmersiveRuntime } from '../engines/ImmersiveRuntime';
import type { ProductionRuntimeStack } from '../utils/immersiveV2/createProductionRuntime.mjs';

// StartupEngine: importado directo aquí (TS) para construir el engineFactory.
import { StartupEngine } from '../engines/StartupEngine';

const HYDRATION_TIMEOUT_MS = 15000;
const LEVEL_DURATIONS_S: Record<number, number> = {
    1: 40, 2: 180, 3: 300, 4: 1200, 5: Infinity,
};

// M-4 fix #4 — generationId monotonic counter para stacks creados por este
// módulo. Cada bootstrap incrementa el contador. Cleanup compara generationId
// para decidir si la mutación global le pertenece (defensa contra StrictMode
// dance + concurrent mounts hipotéticos).
//
// M-4 fix #5 — la metadata de generationId vive EXTERNAMENTE al stack vía
// WeakMap. El stack productivo (createProductionRuntime) devuelve objetos
// frozen/sealed: cualquier intento de mutarlos (e.g., assignar _generationId)
// lanza TypeError "object is not extensible" en strict mode. La WeakMap
// mantiene ownership tracking sin tocar el stack y se auto-limpia cuando el
// stack es garbage-collected (no requiere cleanup explícito).
let __v2StackGenCounter = 0;
const __nextV2StackGen = (): number => {
    __v2StackGenCounter += 1;
    return __v2StackGenCounter;
};
const __v2StackGenerationMap: WeakMap<object, number> = new WeakMap();

interface VisorInmersivoV2Props {
    content: Content;
    runtimeFactory?: (deps: {
        content: Content;
        userId: string;
        sentencesRef: { current: string[] };
        manifestRef: { current: { fileByKey: Readonly<Record<string, string>> } | null };
    }) => ProductionRuntimeStack;
    sentenceLoader?: (content: Content, signal?: AbortSignal) => Promise<{
        sentences: string[];
        rawManifest: unknown;
    }>;
    levelDurationS?: number;
}

const defaultSentenceLoader = async (
    content: Content,
    signal?: AbortSignal,
): Promise<{ sentences: string[]; rawManifest: unknown }> => {
    const result = await hydrateSentences({
        contentId: content.id,
        textUrl:   content.texto_plano_url,
        signal,
        timeoutMs: HYDRATION_TIMEOUT_MS,
        engineFactory: ({ contentId, textUrl, signal: s }) =>
            new StartupEngine(contentId, textUrl, s),
    });
    if (!result.ok) {
        const reason = 'reason' in result ? result.reason : 'unknown';
        const kind =
              reason === 'aborted'             ? 'aborted'
            : reason === 'hydration_timeout'   ? 'hydration_timeout'
            : reason === 'no_sources'          ? 'content_invalid'
            : 'content_invalid';
        throw Object.assign(new Error(`hydrate failed: ${reason}`), { kind });
    }
    return {
        sentences:   [...result.sentences],
        rawManifest: result.rawManifest,
    };
};

interface ViewerStackDeps {
    content: Content;
    userId:  string;
    sentencesRef: { current: string[] };
    manifestRef:  { current: { fileByKey: Readonly<Record<string, string>> } | null };
}

function defaultViewerStackBuilder(deps: ViewerStackDeps): ProductionRuntimeStack {
    const { content, userId, sentencesRef, manifestRef } = deps;
    const diagnostics = createDiagnostics();
    return createProductionRuntime({
        diagnostics,
        hydrateContent: async ({ contentId }) => {
            diagnostics.log({
                kind: 'viewer.hydrate.start',
                contentId,
                data: { textUrl: content.texto_plano_url ?? null, timeoutMs: HYDRATION_TIMEOUT_MS },
            });
            try {
                const loaded = await defaultSentenceLoader(content);
                sentencesRef.current = loaded.sentences;
                manifestRef.current = loaded.rawManifest
                    ? (() => {
                        const norm = normalizeRaw(loaded.rawManifest);
                        return norm.ok ? { fileByKey: norm.fileByKey } : null;
                    })()
                    : null;
                diagnostics.log({
                    kind: 'viewer.hydrate.done',
                    contentId,
                    data: {
                        totalIndices: loaded.sentences.length,
                        manifestKeys: manifestRef.current
                            ? Object.keys(manifestRef.current.fileByKey).length
                            : 0,
                    },
                });
                return { totalIndices: loaded.sentences.length };
            } catch (err: unknown) {
                const e = err as { kind?: string; message?: string };
                diagnostics.log({
                    kind: 'viewer.hydrate.fail',
                    contentId,
                    data: { kind: e?.kind ?? 'unknown', message: e?.message ?? String(err) },
                });
                throw err;
            }
        },
        getTextForIndex: (idx) => sentencesRef.current[idx] ?? null,
        getManifest:     () => manifestRef.current,
        getUserId:       () => userId,
        fetchImpl:       typeof window !== 'undefined' && typeof window.fetch === 'function'
            ? window.fetch.bind(window)
            : undefined,
        audioCtor:       typeof window !== 'undefined' && typeof window.Audio === 'function'
            ? window.Audio
            : undefined,
        idPrefix: 'v2prod',
    });
}

// ════════════════════════════════════════════════════════════════════════════
// WRAPPER — bootstrap defensive
// ════════════════════════════════════════════════════════════════════════════

const VisorInmersivoV2: React.FC<VisorInmersivoV2Props> = ({
    content,
    runtimeFactory,
    sentenceLoader,
    levelDurationS,
}) => {
    const { user } = useAuth();
    const userId = user?.id ?? '';

    const sentencesRef = useRef<string[]>([]);
    const manifestRef  = useRef<{ fileByKey: Readonly<Record<string, string>> } | null>(null);

    // Bootstrap state — refs porque el resultado debe persistir cross-render
    // sin causar re-render adicional (lo causaría useState).
    const stackRef = useRef<ProductionRuntimeStack | null>(null);
    const bootstrapErrorRef = useRef<Error | null>(null);
    // M-4 fix #4: generationId del stack actual (para guard de cleanup global).
    const generationIdRef = useRef<number | null>(null);
    // M-4 fix #4: handle del dispose diferido. setTimeout(0) en cleanup;
    // setup cancela si re-mount StrictMode lo demanda. Evita destruir runtime
    // viva por el dance unmount/remount simulado en dev.
    const pendingDisposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ── Bootstrap defensive — UNA SOLA VEZ por mount ────────────────────────
    //
    // M-4 fix #2: try/catch agresivo + console.* DIRECTOS (no diagnostics —
    // el stack podría no haberse creado aún). Si throw, marca error y el
    // wrapper renderiza fallback en lugar de propagar al hooks downstream.
    if (stackRef.current === null && bootstrapErrorRef.current === null) {
        // Log directo — visible incluso si toda la cadena de diagnostics falló.
        // eslint-disable-next-line no-console
        console.log('[V2] viewer.bootstrap.start', {
            contentId: content?.id ?? null,
            userId,
            hasRuntimeFactory: !!runtimeFactory,
        });
        try {
            let candidate: ProductionRuntimeStack;
            if (runtimeFactory) {
                candidate = runtimeFactory({ content, userId, sentencesRef, manifestRef });
            } else {
                candidate = defaultViewerStackBuilder({ content, userId, sentencesRef, manifestRef });
            }
            // Validación shape del candidate.
            if (!candidate
                || typeof (candidate as ProductionRuntimeStack)?.runtime?.subscribe !== 'function'
                || typeof (candidate as ProductionRuntimeStack)?.runtime?.getSnapshot !== 'function'
                || typeof (candidate as ProductionRuntimeStack)?.diagnostics?.log !== 'function') {
                throw new Error('createProductionRuntime returned invalid stack shape');
            }
            stackRef.current = candidate;
            // M-4 fix #5: ownership tracking via WeakMap externa (NO se muta
            // el stack — createProductionRuntime devuelve objetos frozen).
            const newGen = __nextV2StackGen();
            __v2StackGenerationMap.set(candidate as object, newGen);
            generationIdRef.current = newGen;
            // Diagnóstico positivo: si el stack es immutable, lo confirmamos.
            // NO es error — es señal de que la inmutabilidad funciona.
            if (typeof Object.isExtensible === 'function'
                && !Object.isExtensible(candidate as object)) {
                // eslint-disable-next-line no-console
                console.log('[V2] viewer.bootstrap.stack_immutable', {
                    generationId: newGen,
                    note: 'stack es frozen/sealed — ownership tracking vía WeakMap externa',
                });
            }
            // eslint-disable-next-line no-console
            console.log('[V2] viewer.bootstrap.stack_created', {
                generationId: newGen,
                stackKeys: Object.keys(candidate as object),
            });
            // Exposición inmediata a window — debe ocurrir ANTES del primer
            // useSyncExternalStore para que DevTools pueda inspeccionar.
            if (typeof window !== 'undefined') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__immersiveV2Stack = candidate;
                // eslint-disable-next-line no-console
                console.log('[V2] viewer.bootstrap.stack_exposed', {
                    generationId: newGen,
                    hint: 'window.__immersiveV2Stack listo. Inspeccioná: __immersiveV2Stack._state()',
                });
            }
            // Diagnostics evento (best-effort; silenciado si throw).
            try {
                candidate.diagnostics.log({
                    kind: 'viewer.stack.created',
                    contentId: content?.id ?? null,
                    data: { userId, hasContent: !!content, contentTitle: content?.titulo },
                });
            } catch { /* ignore */ }
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            // eslint-disable-next-line no-console
            console.error('[V2] viewer.bootstrap.fail', error, {
                contentId: content?.id ?? null,
                userId,
                hasRuntimeFactory: !!runtimeFactory,
                stack: error.stack,
            });
            bootstrapErrorRef.current = error;
        }
    }

    // ── Setup + Cleanup — defensive contra StrictMode dance (M-4 fix #4) ────
    //
    // ANTES (M-4 fix #2): cleanup llamaba dispose() y delete window
    // sincrónicamente. En StrictMode dev el dance unmount→remount efímero
    // disparaba dispose ANTES del re-setup, dejando la runtime muerta. Inner
    // quedaba con `stack1` capturado como prop pero el runtime estaba disposed:
    // openSession fallaba silenciosamente y snapshot se atascaba en idle 0/0.
    //
    // AHORA (M-4 fix #4) — dos cambios sincronizados:
    //
    //   1. SETUP cancela cualquier dispose deferred pendiente. Si StrictMode
    //      acaba de correr cleanup (que dejó un timeout 0ms armando dispose),
    //      el setup inmediato lo cancela y la runtime queda viva.
    //
    //   2. SETUP re-asserta window.__immersiveV2Stack si fue borrada por un
    //      cleanup previo (mismo generationId-match). Garantiza que mientras
    //      el viewer V2 esté montado, el global esté vivo y apunte a NUESTRA
    //      generation (no a un stack stale).
    //
    //   3. CLEANUP defer dispose vía setTimeout(0). Si es StrictMode dance,
    //      el siguiente tick trae el re-setup y cancela. Si es unmount real,
    //      el timeout corre y ejecuta dispose + cleanup global (sólo si
    //      window sigue apuntando a NUESTRA generation — guard explícito).
    useEffect(() => {
        // ── Setup ───────────────────────────────────────────────────────────
        if (pendingDisposeTimerRef.current !== null) {
            clearTimeout(pendingDisposeTimerRef.current);
            pendingDisposeTimerRef.current = null;
            // eslint-disable-next-line no-console
            console.log('[V2] viewer.bootstrap.dispose_cancelled', {
                reason: 'remount_or_strictmode_dance',
                generationId: generationIdRef.current,
            });
        }
        if (typeof window !== 'undefined' && stackRef.current) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const current = (window as any).__immersiveV2Stack;
            if (current !== stackRef.current) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).__immersiveV2Stack = stackRef.current;
                // eslint-disable-next-line no-console
                console.log('[V2] viewer.bootstrap.stack_reasserted', {
                    generationId: generationIdRef.current,
                    reason: current === undefined ? 'was_deleted' : 'was_overwritten',
                });
            }
        }

        // ── Cleanup ─────────────────────────────────────────────────────────
        return () => {
            const captured     = stackRef.current;
            const capturedGen  = generationIdRef.current;
            if (!captured) return;
            // Defer: si StrictMode re-monta inmediatamente, el setup cancela
            // este timeout y la runtime sigue viva. Si es unmount real, el
            // timeout corre tras el flush y ejecuta dispose limpio.
            pendingDisposeTimerRef.current = setTimeout(() => {
                pendingDisposeTimerRef.current = null;
                if (typeof window !== 'undefined') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const current = (window as any).__immersiveV2Stack;
                    // GUARD: sólo borrar si el global sigue apuntando a NUESTRA
                    // generation. Si un mount posterior asignó un stack más nuevo
                    // (concurrent V2 hipotético), respetamos su ownership.
                    // M-4 fix #5: lookup de generation vía WeakMap externa (no
                    // se accede a propiedades del stack, que es immutable).
                    const currentGen = current
                        ? __v2StackGenerationMap.get(current as object)
                        : undefined;
                    const isOurs = current
                        && (current === captured
                            || (capturedGen !== null
                                && currentGen === capturedGen));
                    if (isOurs) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        delete (window as any).__immersiveV2Stack;
                    }
                }
                stackRef.current = null;
                bootstrapErrorRef.current = null;
                generationIdRef.current = null;
                void captured.dispose('viewer_unmount').catch(() => { /* ignore */ });
                // Nota: la entry del WeakMap se auto-limpia cuando captured
                // sea garbage-collected. No requiere delete explícito.
            }, 0);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Render condicional al FINAL del wrapper ─────────────────────────────
    if (bootstrapErrorRef.current !== null) {
        return <BootstrapFailureFallback
                    error={bootstrapErrorRef.current}
                    contentId={content?.id ?? null}
                    userId={userId} />;
    }
    if (stackRef.current === null) {
        // Defensivo — no debería ocurrir, pero evita crash si por alguna razón
        // bootstrap completó sin error pero stackRef quedó null.
        return (
            <div data-testid="bootstrap-pending" style={{ padding: 40, fontFamily: 'monospace' }}>
                Bootstrap pending…
            </div>
        );
    }

    return (
        <VisorInmersivoV2Inner
            stack={stackRef.current}
            content={content}
            userId={userId}
            sentencesRef={sentencesRef}
            manifestRef={manifestRef}
            sentenceLoader={sentenceLoader}
            levelDurationS={levelDurationS}
        />
    );
};

// ════════════════════════════════════════════════════════════════════════════
// FALLBACK UI — cuando bootstrap throws
// ════════════════════════════════════════════════════════════════════════════

interface BootstrapFailureFallbackProps {
    error:     Error;
    contentId: string | null;
    userId:    string;
}
const BootstrapFailureFallback: React.FC<BootstrapFailureFallbackProps> = ({
    error, contentId, userId,
}) => {
    return (
        <div data-testid="bootstrap-failure" role="alert"
             style={{ padding: 40, fontFamily: 'monospace', background: '#fee', color: '#900',
                      maxWidth: 900, margin: '40px auto', borderRadius: 8 }}>
            <h1 style={{ fontSize: 22, marginBottom: 12 }}>Runtime bootstrap failed</h1>
            <p style={{ marginBottom: 12 }}>
                El stack productivo no pudo construirse. El visor V2 NO está activo.
                V1 sigue disponible en <code>/leer/inmersivo/{contentId}</code>.
            </p>
            <div style={{ background: '#fff', padding: 12, borderRadius: 4, marginBottom: 12 }}>
                <div><strong>contentId:</strong> {contentId ?? '(none)'}</div>
                <div><strong>userId:</strong> {userId || '(none)'}</div>
                <div><strong>error.message:</strong> <code data-testid="bootstrap-error-message">{error.message}</code></div>
            </div>
            <div style={{ background: '#fff', padding: 12, borderRadius: 4 }}>
                <div style={{ fontWeight: 'bold', marginBottom: 6 }}>error.stack:</div>
                <pre data-testid="bootstrap-error-stack"
                     style={{ whiteSpace: 'pre-wrap', fontSize: 11, overflow: 'auto', maxHeight: 300 }}>
                    {error.stack ?? '(stack not available)'}
                </pre>
            </div>
            <p style={{ marginTop: 16, color: '#666', fontSize: 12 }}>
                Revisa la consola: el log <code>[V2] viewer.bootstrap.fail</code> tiene contexto adicional.
            </p>
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// INNER — viewer real, garantizado a tener stack válido
// ════════════════════════════════════════════════════════════════════════════

interface VisorInmersivoV2InnerProps {
    stack:          ProductionRuntimeStack;
    content:        Content;
    userId:         string;
    sentencesRef:   { current: string[] };
    manifestRef:    { current: { fileByKey: Readonly<Record<string, string>> } | null };
    sentenceLoader?: VisorInmersivoV2Props['sentenceLoader'];
    levelDurationS?: number;
}

const VisorInmersivoV2Inner: React.FC<VisorInmersivoV2InnerProps> = ({
    stack, content, userId, sentencesRef, manifestRef, levelDurationS,
}) => {
    const { user } = useAuth();
    const runtime: ImmersiveRuntime = stack.runtime;

    const activeSessionRef = useRef<string | null>(null);
    const snapshot = useSyncExternalStore(
        runtime.subscribe,
        runtime.getSnapshot,
        runtime.getSnapshot,
    );

    // ── Snapshot tracer (M-4 fix #3) — log directo a console + diagnostics ─
    //
    // Cada cambio relevante del snapshot emite:
    //   - console.log [V2] viewer.runtime.snapshot {...}    (visible siempre)
    //   - diagnostics.log({kind:'viewer.runtime.snapshot', ...}) (en trace)
    //
    // Esto permite al smoke local correlacionar: si los logs PB_* aparecen
    // entre dos viewer.runtime.snapshot sin que `kind` sea V2, la fuente
    // externa queda evidenciada.
    useEffect(() => {
        // Sprint M-4.2 — snapshot tracer enriquecido con los 6 campos
        // diagnósticos nuevos. Visibles desde la primera transición sin
        // necesitar inspección manual de window.__immersiveV2Stack.
        const payload = {
            sessionId:           snapshot.sessionId,
            status:              snapshot.status,
            currentIndex:        snapshot.currentIndex,
            totalIndices:        snapshot.totalIndices,
            visualReady:         snapshot.visualReady,
            lastErrorKind:       snapshot.lastError?.kind ?? null,
            // M-4.2 diagnostic enrichments
            isPlaying:           snapshot.isPlaying,
            audioState:          snapshot.audioState,
            audioUrlLoaded:      snapshot.audioUrlLoaded,
            activeSentenceId:    snapshot.activeSentenceId,
            pendingTransition:   snapshot.pendingTransition,
            playbackGeneration:  snapshot.playbackGeneration,
        };
        // eslint-disable-next-line no-console
        console.log('[V2] viewer.runtime.snapshot', payload);
        try {
            stack.diagnostics.log({
                kind: 'viewer.runtime.snapshot',
                sessionId: snapshot.sessionId ?? null,
                contentId: snapshot.contentId ?? null,
                data: payload,
            });
        } catch { /* ignore */ }
    }, [
        snapshot.sessionId, snapshot.status, snapshot.currentIndex,
        snapshot.totalIndices, snapshot.visualReady, snapshot.lastError,
        snapshot.isPlaying, snapshot.audioState, snapshot.audioUrlLoaded,
        snapshot.activeSentenceId, snapshot.pendingTransition,
        snapshot.playbackGeneration, stack,
    ]);

    // ── Audio acquire tracer (M-4.3) — subscribe a diagnostics ─────────────
    //
    // El AudioRuntime emite eventos granulares audio.acquire.* durante el
    // pipeline preflight→factory→load→play. Subscribe al diagnostics y
    // re-emite cada audio.acquire.* como console.log [V2] audio.acquire.*
    // para que el smoke local lo vea sin necesidad de exportTrace.
    //
    // Lifecycle: subscribe en mount, unsubscribe en unmount. NO depende del
    // sessionId (subscribe global a la diagnostics del stack).
    useEffect(() => {
        if (!stack?.diagnostics?.subscribe) return; // backward compat defensive
        const unsubscribe = stack.diagnostics.subscribe((event) => {
            const kind = event?.kind ?? '';
            if (typeof kind !== 'string' || !kind.startsWith('audio.acquire.')) return;
            // Re-emit con prefix V2 y data plana. data ya está frozen por
            // Diagnostics.log — sólo lo logueamos.
            const payload = {
                sessionId: event.sessionId ?? null,
                contentId: event.contentId ?? null,
                ts:        event.ts,
                ...(event.data ?? {}),
            };
            // null_url / invalid_url / play_rejected / exception → warn
            // (señalan que algo NO está OK en el contrato).
            const isFail = kind.endsWith('.null_url')
                        || kind.endsWith('.invalid_url')
                        || kind.endsWith('.play_rejected')
                        || kind.endsWith('.exception');
            if (isFail) {
                // eslint-disable-next-line no-console
                console.warn(`[V2] ${kind}`, payload);
            } else {
                // eslint-disable-next-line no-console
                console.log(`[V2] ${kind}`, payload);
            }
        });
        return () => {
            try { unsubscribe(); } catch { /* ignore */ }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Playback lifecycle tracer (M-4.2) ──────────────────────────────────
    //
    // Observa transiciones del snapshot y emite logs [V2] playback.* para
    // facilitar el smoke de activación. NO muta runtime — sólo lee.
    //
    // Transiciones detectadas:
    //   status:  ready → playing             → playback.audio.play.start + .playing
    //   status:  playing → paused            → playback.pause
    //   status:  paused → playing            → playback.resume
    //   status:  playing → ready (autoavance)→ playback.audio.ended + .advance.next
    //   status:  * → closing / closed        → playback.stop / playback.close
    //   audio:   idle → playing (audioState) → playback.audio.acquire.success
    //   audio:   playing → idle              → playback.audio.released
    //   visualReady: false → true            → playback.visualReady.true
    //   visualReady: true → false            → playback.visualReady.false
    //   lastError nuevo                      → playback.audio.acquire.fail
    //                                          (cuando kind = audio_*)
    //
    // Refs paralelos preservan el estado previo SIN causar re-renders.
    const prevStatusRef        = useRef<string | null>(null);
    const prevIndexRef         = useRef<number | null>(null);
    const prevAudioStateRef    = useRef<string | null>(null);
    const prevVisualReadyRef   = useRef<boolean | null>(null);
    const prevErrorRefIdRef    = useRef<string | null>(null);
    useEffect(() => {
        const prevStatus      = prevStatusRef.current;
        const prevIndex       = prevIndexRef.current;
        const prevAudioState  = prevAudioStateRef.current;
        const prevVisualReady = prevVisualReadyRef.current;
        const prevErrId       = prevErrorRefIdRef.current;
        const nextStatus      = snapshot.status;
        const nextIndex       = snapshot.currentIndex;
        const nextAudioState  = snapshot.audioState;
        const nextVisualReady = snapshot.visualReady;
        // Error identity: contamos como "nuevo error" si cambia kind o aparece
        // un error nuevo donde antes no había.
        const nextErrId       = snapshot.lastError
            ? `${snapshot.lastError.kind}:${snapshot.playbackGeneration ?? ''}`
            : null;

        // ── Status transitions ──────────────────────────────────────────────
        if (prevStatus !== nextStatus) {
            if (prevStatus === 'ready' && nextStatus === 'playing') {
                // eslint-disable-next-line no-console
                console.log('[V2] playback.audio.play.start', {
                    sessionId: snapshot.sessionId, index: nextIndex,
                    playbackGeneration: snapshot.playbackGeneration,
                });
                // eslint-disable-next-line no-console
                console.log('[V2] playback.audio.playing', {
                    sessionId: snapshot.sessionId, index: nextIndex,
                });
            } else if (prevStatus === 'playing' && nextStatus === 'paused') {
                // eslint-disable-next-line no-console
                console.log('[V2] playback.pause', {
                    sessionId: snapshot.sessionId, index: nextIndex,
                    playbackGeneration: snapshot.playbackGeneration,
                });
            } else if (prevStatus === 'paused' && nextStatus === 'playing') {
                // eslint-disable-next-line no-console
                console.log('[V2] playback.resume', {
                    sessionId: snapshot.sessionId, index: nextIndex,
                    playbackGeneration: snapshot.playbackGeneration,
                });
            } else if (prevStatus === 'playing' && nextStatus === 'ready') {
                // Autoavance: audio terminó, runtime regresó a ready listo
                // para próximo play (o continúa con autoplay binder).
                // eslint-disable-next-line no-console
                console.log('[V2] playback.audio.ended', {
                    sessionId: snapshot.sessionId,
                    endedAtIndex: prevIndex,
                    nextIndex,
                });
            }
            if (nextStatus === 'closing') {
                // eslint-disable-next-line no-console
                console.log('[V2] playback.stop', {
                    sessionId: snapshot.sessionId,
                    fromStatus: prevStatus,
                    playbackGeneration: snapshot.playbackGeneration,
                });
            }
            if (nextStatus === 'closed') {
                // eslint-disable-next-line no-console
                console.log('[V2] playback.close', {
                    sessionId: snapshot.sessionId,
                    playbackGeneration: snapshot.playbackGeneration,
                });
            }
        }

        // ── currentIndex advance (separa autoavance vs goTo manual) ─────────
        if (prevIndex !== null && nextIndex !== prevIndex && nextStatus !== 'closed') {
            // eslint-disable-next-line no-console
            console.log('[V2] playback.advance.next', {
                sessionId: snapshot.sessionId,
                fromIndex: prevIndex,
                toIndex:   nextIndex,
                delta:     nextIndex - prevIndex,
                status:    nextStatus,
            });
        }

        // ── audioState transitions ──────────────────────────────────────────
        if (prevAudioState !== nextAudioState) {
            if (prevAudioState === 'idle' && nextAudioState === 'playing') {
                // eslint-disable-next-line no-console
                console.log('[V2] playback.audio.acquire.success', {
                    sessionId:      snapshot.sessionId,
                    index:          nextIndex,
                    audioUrlLoaded: snapshot.audioUrlLoaded,
                });
            } else if (prevAudioState === 'playing' && nextAudioState === 'idle'
                       && nextStatus !== 'closed' && nextStatus !== 'closing') {
                // Audio liberado pero la sesión sigue viva (ended / pause).
                // eslint-disable-next-line no-console
                console.log('[V2] playback.audio.released', {
                    sessionId: snapshot.sessionId, atIndex: nextIndex,
                });
            }
        }

        // ── visualReady transitions ─────────────────────────────────────────
        if (prevVisualReady !== nextVisualReady) {
            // eslint-disable-next-line no-console
            console.log(nextVisualReady
                ? '[V2] playback.visualReady.true'
                : '[V2] playback.visualReady.false', {
                sessionId: snapshot.sessionId,
                index:     nextIndex,
                status:    nextStatus,
            });
        }

        // ── Audio acquire failure ───────────────────────────────────────────
        if (prevErrId !== nextErrId && snapshot.lastError) {
            const kind = snapshot.lastError.kind;
            const isAudioErr = typeof kind === 'string' && kind.startsWith('audio_');
            if (isAudioErr) {
                // M-4.3: errorMeta ahora trae meta enriquecida de AudioRuntime
                // (reason, src, requestedIndex, browserError, playPromiseError,
                // readyState, networkState). Loggeamos campo por campo para que
                // sea inmediatamente legible en consola sin expandir objetos.
                const meta = (snapshot.lastError.meta ?? {}) as Record<string, unknown>;
                // eslint-disable-next-line no-console
                console.warn('[V2] playback.audio.acquire.fail', {
                    sessionId:           snapshot.sessionId,
                    index:               nextIndex,
                    errorKind:           kind,
                    reason:              meta.reason             ?? null,
                    requestedIndex:      meta.requestedIndex     ?? null,
                    requestedSessionId:  meta.requestedSessionId ?? null,
                    resolvedUrl:         meta.src                ?? null,
                    browserError:        meta.browserError       ?? null,
                    playPromiseError:    meta.playPromiseError   ?? null,
                    readyState:          meta.readyState         ?? null,
                    networkState:        meta.networkState       ?? null,
                });
            }
        }

        prevStatusRef.current      = nextStatus;
        prevIndexRef.current       = nextIndex;
        prevAudioStateRef.current  = nextAudioState;
        prevVisualReadyRef.current = nextVisualReady;
        prevErrorRefIdRef.current  = nextErrId;
    }, [
        snapshot.sessionId, snapshot.status, snapshot.currentIndex,
        snapshot.audioState, snapshot.audioUrlLoaded, snapshot.visualReady,
        snapshot.lastError, snapshot.playbackGeneration,
    ]);

    // ── Inner mount lifecycle — log directo (M-4 fix #4) ───────────────────
    //
    // Visibilidad cruda: si Inner NO monta, no se ve este log. Si monta pero
    // openSession effect NO corre (deps falsy), el inner.mounted aparece y
    // el openSession.effect.skipped emite warning con la causa.
    useEffect(() => {
        // M-4 fix #5: generationId via WeakMap externa — NO se accede a
        // propiedades del stack (es immutable, no se le pueden assignar tags).
        const genIdMount = __v2StackGenerationMap.get(stack as object) ?? null;
        // eslint-disable-next-line no-console
        console.log('[V2] viewer.inner.mounted', {
            contentId:    content?.id ?? null,
            userId,
            hasRuntime:   !!runtime,
            generationId: genIdMount,
        });
        return () => {
            const genIdUnmount = __v2StackGenerationMap.get(stack as object) ?? null;
            // eslint-disable-next-line no-console
            console.log('[V2] viewer.inner.unmounted', {
                contentId:    content?.id ?? null,
                userId,
                generationId: genIdUnmount,
            });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Stuck-idle watchdog (M-4 fix #4) ───────────────────────────────────
    //
    // 2s después de inner.mounted, si runtime.getSnapshot() sigue en idle 0/0,
    // emite warning. Detección temprana de openSession nunca llegando.
    // Lectura directa del snapshot (no closure-captured) para precisión.
    useEffect(() => {
        const watchdogId = setTimeout(() => {
            const current = runtime.getSnapshot();
            if (current.status === 'idle'
                && current.currentIndex === 0
                && current.totalIndices === 0) {
                // eslint-disable-next-line no-console
                console.warn('[V2] viewer.stuck.idle', {
                    snapshot: {
                        status:       current.status,
                        sessionId:    current.sessionId,
                        currentIndex: current.currentIndex,
                        totalIndices: current.totalIndices,
                    },
                    userId,
                    contentId:        content?.id ?? null,
                    runtimeExists:    !!runtime,
                    activeSession:    activeSessionRef.current,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    windowStackAlive: typeof window !== 'undefined' && !!(window as any).__immersiveV2Stack,
                });
            }
        }, 2000);
        return () => clearTimeout(watchdogId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // ── Restore + open session ──────────────────────────────────────────────
    //
    // M-4 fix #4: console.log directos en cada fase + skip diagnostic. Si el
    // effect NO corre por deps falsy, se ve [V2] viewer.openSession.effect.
    // skipped con la causa exacta (no_userId | no_contentId).
    useEffect(() => {
        // eslint-disable-next-line no-console
        console.log('[V2] viewer.openSession.effect.start', {
            userId,
            contentId:     content?.id ?? null,
            runtimeExists: !!runtime,
        });
        if (!userId || !content?.id) {
            // eslint-disable-next-line no-console
            console.warn('[V2] viewer.openSession.effect.skipped', {
                reason:        !userId ? 'no_userId' : 'no_contentId',
                userId,
                contentId:     content?.id ?? null,
                runtimeExists: !!runtime,
            });
            return;
        }
        let cancelled = false;

        stack.diagnostics.log({
            kind: 'viewer.openSession.start',
            contentId: content.id,
            data: { userId, contentTitle: content.titulo },
        });

        (async () => {
            // eslint-disable-next-line no-console
            console.log('[V2] viewer.openSession.restore.start', { userId, contentId: content.id });
            const restore = await restoreProgress({
                userId,
                contentId: content.id,
                dataService,
            });
            if (cancelled) {
                // eslint-disable-next-line no-console
                console.log('[V2] viewer.openSession.restore.cancelled', { contentId: content.id });
                return;
            }
            // eslint-disable-next-line no-console
            console.log('[V2] viewer.openSession.restore.done', {
                startIndex: restore.startIndex,
                source:     restore.source,
                clamped:    restore.clamped,
            });

            // eslint-disable-next-line no-console
            console.log('[V2] viewer.openSession.call', {
                contentId:  content.id,
                userId,
                startIndex: restore.startIndex,
            });
            const result = await runtime.openSession({
                contentId:  content.id,
                userId,
                startIndex: restore.startIndex,
            });
            if (cancelled) {
                // eslint-disable-next-line no-console
                console.log('[V2] viewer.openSession.call.cancelled', { contentId: content.id });
                return;
            }
            if (result.ok && result.session) {
                activeSessionRef.current = result.session.id;
                // eslint-disable-next-line no-console
                console.log('[V2] viewer.openSession.done', {
                    sessionId:  result.session.id,
                    contentId:  content.id,
                    startIndex: restore.startIndex,
                });
                stack.diagnostics.log({
                    kind: 'viewer.openSession.done',
                    sessionId: result.session.id,
                    contentId: content.id,
                    data: { startIndex: restore.startIndex, source: restore.source, clamped: restore.clamped },
                });
            } else {
                activeSessionRef.current = null;
                // eslint-disable-next-line no-console
                console.warn('[V2] viewer.openSession.fail', {
                    contentId: content.id,
                    errorKind: result.error?.kind ?? 'unknown',
                    errorMeta: result.error?.meta ?? null,
                });
                stack.diagnostics.log({
                    kind: 'viewer.openSession.fail',
                    contentId: content.id,
                    data: {
                        errorKind: result.error?.kind ?? 'unknown',
                        errorMeta: result.error?.meta ?? null,
                    },
                });
            }
        })().catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[V2] viewer.openSession.exception', err);
        });

        return () => {
            cancelled = true;
            // eslint-disable-next-line no-console
            console.log('[V2] viewer.openSession.effect.cleanup', {
                userId,
                contentId: content?.id ?? null,
            });
            activeSessionRef.current = null;
            void runtime.closeSession('unmount_or_content_change').catch(() => { /* ignore */ });
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content?.id, userId, runtime]);

    // ── Visibility report ──────────────────────────────────────────────────
    useEffect(() => {
        const sid = activeSessionRef.current;
        if (!sid) return;
        if (snapshot.sessionId !== sid) return;
        if (snapshot.status === 'closed' || snapshot.status === 'closing'
            || snapshot.status === 'error') return;
        const idx = snapshot.currentIndex;
        if (!Number.isInteger(idx) || idx < 0) return;
        if (sentencesRef.current.length > 0 && idx >= sentencesRef.current.length) return;
        reportVisible(runtime, sid, idx);
    }, [snapshot.sessionId, snapshot.status, snapshot.currentIndex, runtime, sentencesRef]);

    // ── Commit progress ────────────────────────────────────────────────────
    useEffect(() => {
        const sid = activeSessionRef.current;
        if (!sid || snapshot.sessionId !== sid) return;
        if (snapshot.status !== 'playing' && snapshot.status !== 'paused') return;
        if (!snapshot.visualReady) return;
        if (snapshot.currentIndex < 0) return;
        void commitProgress({
            sessionId: sid,
            userId,
            contentId: content.id,
            index:     snapshot.currentIndex,
            totalIndices: snapshot.totalIndices,
            dataService,
        }).catch(() => { /* ignore */ });
    }, [
        snapshot.sessionId, snapshot.currentIndex, snapshot.visualReady,
        snapshot.status, content.id, userId, snapshot.totalIndices,
    ]);

    // ── Timer minimal por nivel ────────────────────────────────────────────
    const computedDurationS = useMemo(() => {
        if (typeof levelDurationS === 'number') return levelDurationS;
        const lvl = (user?.immersive_level as 1 | 2 | 3 | 4 | 5) ?? 1;
        return LEVEL_DURATIONS_S[lvl] ?? LEVEL_DURATIONS_S[1];
    }, [levelDurationS, user?.immersive_level]);
    const [sessionComplete, setSessionComplete] = useState(false);
    const [timerStartTs, setTimerStartTs] = useState<number | null>(null);

    useEffect(() => {
        if (sessionComplete) return;
        if (computedDurationS === Infinity) return;
        if (snapshot.status !== 'playing') return;
        if (timerStartTs === null) {
            setTimerStartTs(Date.now());
            return;
        }
        const elapsedS = (Date.now() - timerStartTs) / 1000;
        const remainingMs = Math.max(0, (computedDurationS - elapsedS) * 1000);
        const id = setTimeout(() => {
            setSessionComplete(true);
            // eslint-disable-next-line no-console
            console.log('[V2] playback.start', {
                intent: 'pause', source: 'level_timer_expired',
                sessionId: activeSessionRef.current,
            });
            void dispatchPause(runtime);
        }, remainingMs);
        return () => clearTimeout(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [snapshot.status, sessionComplete, timerStartTs, computedDurationS, runtime]);

    function extendBlock5Min() {
        setSessionComplete(false);
        setTimerStartTs(Date.now());
        void dispatchResume(runtime);
    }

    // ── Dispatch wrappers con instrumentación (M-4.2) ──────────────────────
    //
    // Cada handler emite:
    //   - playback.start  (al disparar la intención + capturar generation)
    //   - playback.audio.acquire.start (sólo en play/resume — implica audio)
    //   - playback.<intent>.result (con OpResult del bridge)
    //
    // Las transiciones reales del runtime se observan vía snapshot tracer
    // (playback.audio.play.start, playback.pause, etc.). Estos logs son
    // SOBRE LA INTENCIÓN del cliente, complementarios al efecto observado.
    const logIntent = (intent: string, extra?: Record<string, unknown>): void => {
        // eslint-disable-next-line no-console
        console.log('[V2] playback.start', {
            intent,
            sessionId:          activeSessionRef.current,
            currentIndex:       snapshot.currentIndex,
            status:             snapshot.status,
            playbackGeneration: snapshot.playbackGeneration,
            ...(extra ?? {}),
        });
    };
    const logResult = (intent: string, result: { ok: boolean; error?: { kind?: string } | null }): void => {
        // eslint-disable-next-line no-console
        console.log(`[V2] playback.${intent}.result`, {
            ok:        !!result?.ok,
            errorKind: result?.error?.kind ?? null,
            sessionId: activeSessionRef.current,
        });
    };

    const onPlay = (): void => {
        logIntent('play');
        // eslint-disable-next-line no-console
        console.log('[V2] playback.audio.acquire.start', {
            sessionId: activeSessionRef.current,
            index:     snapshot.currentIndex,
        });
        dispatchPlay(runtime).then((r) => logResult('play', r)).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[V2] playback.play.exception', err);
        });
    };
    const onPause = (): void => {
        logIntent('pause');
        dispatchPause(runtime).then((r) => logResult('pause', r)).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[V2] playback.pause.exception', err);
        });
    };
    const onResume = (): void => {
        logIntent('resume');
        // eslint-disable-next-line no-console
        console.log('[V2] playback.audio.acquire.start', {
            sessionId: activeSessionRef.current,
            index:     snapshot.currentIndex,
        });
        dispatchResume(runtime).then((r) => logResult('resume', r)).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[V2] playback.resume.exception', err);
        });
    };
    const onPrev = (): void => {
        logIntent('prev');
        dispatchPrev(runtime).then((r) => logResult('prev', r)).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[V2] playback.prev.exception', err);
        });
    };
    const onNext = (): void => {
        logIntent('next');
        dispatchNext(runtime).then((r) => logResult('next', r)).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[V2] playback.next.exception', err);
        });
    };

    function onRecover() {
        void runtime.recoverFromError({ preserveIndex: true }).catch(() => { /* ignore */ });
    }
    const recoverableErrorKinds = new Set([
        'audio_autoplay_blocked',
        'audio_unavailable',
        'audio_failed',
        'audio_decode_failed',
    ]);
    const errorLabelByKind: Record<string, string> = {
        audio_autoplay_blocked: 'El navegador bloqueó la reproducción automática. Toca reanudar.',
        audio_unavailable:      'Audio no disponible para esta frase.',
        audio_failed:           'El audio falló. Reintentar.',
        audio_decode_failed:    'El audio no pudo decodificarse. Reintentar.',
        hydration_timeout:      'La carga del contenido tardó demasiado. Recargá la página.',
        content_invalid:        'El contenido no se pudo procesar (sin frases ni audio).',
        content_not_found:      'Contenido no encontrado.',
    };
    const hasError = snapshot.status === 'error' && snapshot.lastError !== null;
    const showRecover = hasError
        && recoverableErrorKinds.has(snapshot.lastError!.kind);
    const errorLabel = hasError
        ? (errorLabelByKind[snapshot.lastError!.kind] ?? `Error: ${snapshot.lastError!.kind}`)
        : null;

    const total = snapshot.totalIndices > 0
        ? snapshot.totalIndices
        : sentencesRef.current.length;
    const sentences = sentencesRef.current;
    const isAtStart = snapshot.currentIndex <= 0;
    const isAtEnd   = total > 0 && snapshot.currentIndex >= total - 1;

    // ════════════════════════════════════════════════════════════════════════
    // M-5 — PRESENTATION LAYER (no toca runtime, machine, ownership, audio)
    // ════════════════════════════════════════════════════════════════════════

    // ── Navegación volver atrás ─────────────────────────────────────────────
    const navigate = useNavigate();

    // ── Reading preferences (M-5.1) — defaults; settings menu vendrá en M-5.4
    const [theme]       = useState<'dark' | 'high-contrast'>('dark');
    const [fontSize]    = useState<'sm' | 'base' | 'lg' | 'xl'>('base');
    const [lineSpacing] = useState<'normal' | 'relaxed' | 'loose'>('relaxed');

    // ── Refs requeridos por ImmersiveShell (todos pure-render) ──────────────
    const containerRef        = useRef<HTMLDivElement>(null);
    const itemRefs            = useRef<(HTMLDivElement | null)[]>([]);
    const transformWrapperRef = useRef<HTMLDivElement | null>(null);
    const heightCache         = useRef<Map<number, number>>(new Map());
    const lastMeasuredHeight  = useRef<number>(0);

    // ── translateY — centra la frase activa en el viewport.
    // Estilo derivado de V1::VisorInmersivo (effect en line ~1884), mismo
    // cálculo: targetY = (containerHeight/2) - (elTop + elHeight/2).
    const [translateY, setTranslateY] = useState(0);
    const [containerResizeTick, setContainerResizeTick] = useState(0);
    useEffect(() => {
        if (!containerRef.current) return;
        const ro = new ResizeObserver(() => setContainerResizeTick((n) => n + 1));
        ro.observe(containerRef.current);
        return () => ro.disconnect();
    }, []);
    useEffect(() => {
        if (!containerRef.current) return;
        const items  = itemRefs.current;
        const active = items[snapshot.currentIndex];
        if (!active) return;
        const containerHeight = containerRef.current.clientHeight;
        if (active.clientHeight > 0 && !heightCache.current.has(snapshot.currentIndex)) {
            heightCache.current.set(snapshot.currentIndex, active.clientHeight);
        }
        const elTop    = active.offsetTop;
        const elHeight = active.clientHeight;
        setTranslateY((containerHeight / 2) - (elTop + (elHeight / 2)));
    }, [snapshot.currentIndex, sentences.length, containerResizeTick, fontSize, lineSpacing]);

    // ── Hydration indicator: pill mientras runtime carga ────────────────────
    const isHydrating = sentences.length === 0
        || (snapshot.status === 'opening' && !snapshot.isPlaying);

    // ── Click en frase del teleprompter → seek manual ───────────────────────
    const onClickSentence = useCallback((idx: number): void => {
        if (idx === snapshot.currentIndex) return;
        // eslint-disable-next-line no-console
        console.log('[V2] playback.start', {
            intent: 'goTo', index: idx,
            sessionId:    activeSessionRef.current,
            currentIndex: snapshot.currentIndex,
            status:       snapshot.status,
        });
        dispatchGoTo(runtime, idx, 'manual').then((r) => {
            // eslint-disable-next-line no-console
            console.log('[V2] playback.goTo.result', {
                ok: !!r?.ok, errorKind: r?.error?.kind ?? null,
                sessionId: activeSessionRef.current,
            });
        }).catch((err) => {
            // eslint-disable-next-line no-console
            console.error('[V2] playback.goTo.exception', err);
        });
    }, [snapshot.currentIndex, snapshot.status, runtime]);

    // ── Botón play: derivado del status del runtime ─────────────────────────
    const isLoadingPlay = snapshot.status === 'opening' || snapshot.status === 'idle';

    return (
        <div
            data-testid="visor-inmersivo-v2"
            className={`visor-inmersivo-v2 relative h-screen w-full overflow-hidden font-sans select-none
                ${theme === 'high-contrast' ? 'bg-black text-white' : 'bg-neutral-950 text-white'}`}
        >
            {/* HEADER — gradient + back/title/index */}
            <div className="visor-inmersivo-v2__header absolute top-0 left-0 right-0 z-20 p-6 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent pointer-events-none">
                <button
                    onClick={() => navigate(-1)}
                    aria-label="Volver"
                    className="p-2 bg-white/10 rounded-full hover:bg-white/20 pointer-events-auto transition-colors"
                >
                    <ChevronLeft size={20} />
                </button>
                <div className="flex items-center gap-3 pointer-events-auto">
                    <span data-testid="title" className="text-sm font-semibold text-white/80 truncate max-w-xs">
                        {content.titulo}
                    </span>
                    <span className="w-px h-4 bg-white/20" aria-hidden="true" />
                    <span data-testid="index" className="font-mono text-xs text-white/60">
                        {Math.min(snapshot.currentIndex + 1, total)}/{total}
                    </span>
                    {sessionComplete ? (
                        <span data-testid="session-complete" role="status"
                              className="ml-2 text-xs font-bold text-emerald-400 uppercase tracking-wider">
                            Sesión completada
                        </span>
                    ) : null}
                </div>
                {/* status: hidden visualmente, expuesto a a11y/tests */}
                <span data-testid="status" className="sr-only">{snapshot.status}</span>
            </div>

            {/* TELEPROMPTER — pure presentation via ImmersiveShell (M-5 whitelisted) */}
            <ImmersiveShell
                sentences={sentences}
                currentIndex={snapshot.currentIndex}
                isHydrating={isHydrating}
                translateY={translateY}
                containerRef={containerRef}
                itemRefs={itemRefs}
                theme={theme}
                fontSize={fontSize}
                lineSpacing={lineSpacing}
                onClickSentence={onClickSentence}
                heightCache={heightCache}
                lastMeasuredHeight={lastMeasuredHeight}
                transformWrapperRef={transformWrapperRef}
            />

            {/* CONTROLS — bottom-centered glass panel */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30">
                <div className="visor-inmersivo-v2__footer flex items-center gap-6 bg-neutral-900/80 backdrop-blur-xl border border-white/10 px-8 py-4 rounded-2xl shadow-2xl">
                    <button
                        onClick={onPrev}
                        disabled={isAtStart || sessionComplete}
                        data-testid="btn-prev"
                        aria-label="Anterior"
                        className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <ChevronLeft size={24} />
                    </button>

                    {sessionComplete ? (
                        <button
                            type="button"
                            onClick={extendBlock5Min}
                            data-testid="btn-extend-5min"
                            className="px-6 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold transition-colors shadow-lg"
                        >
                            +5 min
                        </button>
                    ) : snapshot.status === 'playing' ? (
                        <button
                            onClick={onPause}
                            data-testid="btn-pause"
                            aria-label="Pausar"
                            className="w-16 h-16 rounded-full flex items-center justify-center bg-white text-black transition-all shadow-lg hover:scale-105 active:scale-95"
                        >
                            <Pause size={32} className="fill-current" />
                        </button>
                    ) : snapshot.status === 'paused' ? (
                        <button
                            onClick={onResume}
                            data-testid="btn-resume"
                            aria-label="Reanudar"
                            className="w-16 h-16 rounded-full flex items-center justify-center bg-indigo-600 text-white shadow-indigo-500/50 transition-all shadow-lg hover:scale-105 active:scale-95"
                        >
                            <Play size={32} className="ml-1 fill-current" />
                        </button>
                    ) : (
                        <button
                            onClick={onPlay}
                            disabled={isLoadingPlay}
                            data-testid="btn-play"
                            aria-label="Reproducir"
                            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95
                                ${isLoadingPlay
                                    ? 'bg-indigo-400 text-white cursor-wait'
                                    : 'bg-indigo-600 text-white shadow-indigo-500/50'}`}
                        >
                            {isLoadingPlay
                                ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                : <Play size={32} className="ml-1 fill-current" />
                            }
                        </button>
                    )}

                    <button
                        onClick={onNext}
                        disabled={isAtEnd || sessionComplete}
                        data-testid="btn-next"
                        aria-label="Siguiente"
                        className="p-2 hover:bg-white/10 rounded-full transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                        <SkipForward size={24} />
                    </button>
                </div>
            </div>

            {/* RECOVERY BANNER — solo si error real */}
            {hasError ? (
                <div
                    role="alert"
                    data-testid="recovery-banner"
                    className="recovery-banner absolute top-24 left-1/2 -translate-x-1/2 z-40 bg-amber-900/90 border border-amber-500/30 backdrop-blur-md px-6 py-4 rounded-2xl shadow-2xl max-w-md text-white"
                >
                    <p className="text-sm font-semibold mb-2">{errorLabel}</p>
                    <p className="text-xs text-amber-200/70 font-mono mb-3">
                        kind: <code data-testid="error-kind">{snapshot.lastError!.kind}</code>
                    </p>
                    {showRecover ? (
                        <button
                            type="button"
                            onClick={onRecover}
                            data-testid="btn-recover"
                            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl text-sm transition-colors"
                        >
                            Reintentar
                        </button>
                    ) : null}
                </div>
            ) : null}

            <DevDiagnosticsPanel stack={stack} />
        </div>
    );
};

// ════════════════════════════════════════════════════════════════════════════
// DevDiagnosticsPanel — solo si window.__IMMERSIVE_V2_DEBUG__===true
// ════════════════════════════════════════════════════════════════════════════

interface DevDiagnosticsPanelProps {
    stack: ProductionRuntimeStack;
}
const DevDiagnosticsPanel: React.FC<DevDiagnosticsPanelProps> = ({ stack }) => {
    const enabled = typeof window !== 'undefined'
        && (window as unknown as { __IMMERSIVE_V2_DEBUG__?: boolean }).__IMMERSIVE_V2_DEBUG__ === true;
    const [, setTick] = useState(0);

    useEffect(() => {
        if (!enabled) return;
        // eslint-disable-next-line no-console
        console.groupCollapsed('[V2] DevDiagnosticsPanel attached');
        // eslint-disable-next-line no-console
        console.log('window.__immersiveV2Stack ya expuesto desde bootstrap del wrapper.');
        // eslint-disable-next-line no-console
        console.log('  __immersiveV2Stack._state()                       → counters');
        // eslint-disable-next-line no-console
        console.log('  __immersiveV2Stack.diagnostics.getRecentEvents()  → trace');
        // eslint-disable-next-line no-console
        console.log('  __immersiveV2Stack.runtime.getSnapshot()          → snapshot');
        // eslint-disable-next-line no-console
        console.groupEnd();
    }, [enabled]);

    useEffect(() => {
        if (!enabled) return;
        const id = setInterval(() => setTick((n) => n + 1), 500);
        return () => clearInterval(id);
    }, [enabled]);

    if (!enabled) return null;
    const events = stack.diagnostics.getRecentEvents(20);
    const counters = stack._state();
    return (
        <div data-testid="dev-diagnostics-panel"
             style={{ position: 'fixed', bottom: 0, right: 0, maxWidth: 480, maxHeight: 360,
                      overflow: 'auto', background: 'rgba(0,0,0,0.85)', color: '#0f0',
                      fontFamily: 'monospace', fontSize: 10, padding: 8, zIndex: 9999,
                      borderTopLeftRadius: 4 }}>
            <div style={{ fontWeight: 'bold', marginBottom: 4 }}>V2 SMOKE PANEL (M-4)</div>
            <div style={{ color: '#ff8', marginBottom: 6 }}>
                audios={counters.adapterState.audiosTracked}{' '}
                urls={counters.adapterState.totalUrls}{' '}
                preload={counters.adapterState.preloadCount}/{counters.adapterState.preloadReady}{' '}
                binder.disposed={String(counters.binderState.disposed)}
            </div>
            <div style={{ borderTop: '1px dashed #444', paddingTop: 4 }}>
                <div style={{ fontWeight: 'bold' }}>last 20 events:</div>
                {events.slice().reverse().map((e, i) => (
                    <div key={i}>
                        [{new Date(e.ts).toISOString().slice(11, 23)}] {e.kind}
                        {e.sessionId ? ` sid=${String(e.sessionId).slice(-6)}` : ''}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default VisorInmersivoV2;
