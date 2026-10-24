/**
 * useEconomicTick — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A3.
 *
 * Instrumentación económica ÚNICA de los 6 modos (PLAN_GENERAL_V1_1.md §3.3.9):
 * emite `econ_tick` hacia POST /api/v1/events, donde F3-A2 los valida,
 * atribuye y guarda en `econ_events`. Las reglas de cada tick viven en el
 * núcleo puro `utils/economicTick.mjs`.
 *
 * Inerte por completo salvo que se cumplan TODAS:
 *  - el servidor declara `economicIngest: 'on'` en /api/runtime-config
 *    (`ECONOMIC_INGEST_MODE`; ausente ⇒ off ⇒ ni listeners, ni timers, ni red);
 *  - `enabled`, usuario autenticado (no 'guest') y `contentId`.
 *
 * Aditivo: no toca `session_heartbeat`, el progreso ni ninguna métrica
 * pedagógica; usa su propio buffer y sus propios envíos.
 *
 * Señales humanas: eventos de confianza (`isTrusted`) en captura sobre
 * `document` — puntero, teclado, rueda, toque, click (la activación de VoiceOver
 * y TalkBack llega como click) y foco (navegación por elementos con lector de
 * pantalla o teclado) — más `markHumanSignal()` para la navegación propia de un
 * visor que ocurre fuera de este documento (iframes del lector EPUB).
 * El scroll NO es señal: los visores lo provocan solos (auto-avance, sincronía
 * del inmersivo).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ulid } from '../utils/clientUlid';
import {
    ECON_TICK_PARAMS,
    createEconomicTickCore,
    createTickBuffer,
    econIngestEnabled,
    serverClockOffset,
} from '../utils/economicTick.mjs';

export type EconomicTickMode = 'pdf' | 'text' | 'immersive' | 'a11y' | 'album' | 'epub';

export interface UseEconomicTickConfig {
    enabled: boolean;
    userId: string | null | undefined;
    contentId: string | null | undefined;
    mode: EconomicTickMode;
    /** Medios de NARRACIÓN del visor (nunca ambiente ni efectos). */
    getNarrationMedia?: () => Array<HTMLMediaElement | null | undefined>;
}

const ENDPOINT = '/api/v1/events';
const SIGNAL_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'click', 'focusin'] as const;
const MEDIA_SAMPLE_MS = 1_000;

// Una sola consulta por página: el flag y el reloj del servidor.
let ingestModePromise: Promise<boolean> | null = null;
function loadIngestEnabled(): Promise<boolean> {
    if (!ingestModePromise) {
        ingestModePromise = fetch('/api/runtime-config', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((cfg) => econIngestEnabled(cfg))
            .catch(() => false);
    }
    return ingestModePromise;
}

let clockOffsetPromise: Promise<number> | null = null;
function loadClockOffset(): Promise<number> {
    if (!clockOffsetPromise) {
        const sentAt = Date.now();
        clockOffsetPromise = fetch('/api/server-time', { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => serverClockOffset(sentAt, Date.now(), j?.now))
            .catch(() => 0);
    }
    return clockOffsetPromise;
}

function postTicks(events: unknown[], keepalive: boolean): void {
    if (events.length === 0) return;
    try {
        fetch(ENDPOINT, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ events }),
            keepalive,
        }).catch(() => { /* la medición nunca interrumpe la lectura */ });
    } catch { /* idem */ }
}

export function useEconomicTick(config: UseEconomicTickConfig): { markHumanSignal: () => void } {
    const { enabled, userId, contentId, mode } = config;
    const [ingestOn, setIngestOn] = useState(false);
    const [clockOffset, setClockOffset] = useState<number | null>(null);
    const mediaRef = useRef(config.getNarrationMedia);
    mediaRef.current = config.getNarrationMedia;
    const signalRef = useRef<(() => void) | null>(null);

    const wanted = enabled && !!userId && userId !== 'guest' && !!contentId;

    useEffect(() => {
        if (!wanted) return;
        let alive = true;
        loadIngestEnabled().then((on) => {
            if (!alive || !on) return;
            loadClockOffset().then((off) => { if (alive) { setClockOffset(off); setIngestOn(true); } });
        });
        return () => { alive = false; };
    }, [wanted]);

    const active = wanted && ingestOn && clockOffset !== null;

    useEffect(() => {
        if (!active || !contentId) return;
        const now = () => Date.now() + (clockOffset ?? 0);
        const visibleNow = () => typeof document === 'undefined' || document.visibilityState === 'visible';
        const core = createEconomicTickCore({ mode, contentId, sessionId: ulid(), startedAt: now(), visible: visibleNow() });
        const buffer = createTickBuffer();

        const flush = (keepalive: boolean) => postTicks(buffer.drain(now()), keepalive);
        const tick = () => buffer.push(core.tick(now(), ulid()));
        const signal = () => core.humanSignal(now());
        signalRef.current = signal;

        const onTrusted = (e: Event) => { if (e.isTrusted) signal(); };
        const onVisibility = () => {
            const v = visibleNow();
            core.setVisible(v, now());
            if (!v) { tick(); flush(true); }
        };
        const onPageHide = () => { tick(); flush(true); };

        for (const name of SIGNAL_EVENTS) document.addEventListener(name, onTrusted, { capture: true, passive: true });
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);

        const tickTimer = window.setInterval(tick, ECON_TICK_PARAMS.tickIntervalMs);
        const flushTimer = window.setInterval(() => flush(false), ECON_TICK_PARAMS.flushIntervalMs);
        const sampleTimer = window.setInterval(() => {
            const getter = mediaRef.current;
            if (!getter) return;
            let els: Array<HTMLMediaElement | null | undefined> = [];
            try { els = getter() || []; } catch { return; }
            core.sampleMedia(now(), els.filter((el): el is HTMLMediaElement => !!el).map((el) => ({
                key: el,
                src: el.currentSrc || el.src || '',
                posMs: el.currentTime * 1000,
                paused: el.paused,
                ended: el.ended,
                muted: el.muted,
                volume: el.volume,
                rate: el.playbackRate,
            })));
        }, MEDIA_SAMPLE_MS);

        return () => {
            window.clearInterval(tickTimer);
            window.clearInterval(flushTimer);
            window.clearInterval(sampleTimer);
            for (const name of SIGNAL_EVENTS) document.removeEventListener(name, onTrusted, { capture: true });
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('pagehide', onPageHide);
            signalRef.current = null;
            // Tick final parcial (F3-A2 §3) y envío.
            tick();
            flush(true);
        };
    }, [active, clockOffset, userId, contentId, mode]);

    const markHumanSignal = useCallback(() => { signalRef.current?.(); }, []);
    return { markHumanSignal };
}
