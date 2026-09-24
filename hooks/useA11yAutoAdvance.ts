/**
 * useA11yAutoAdvance — avance automático del Modo Accesible.
 * CHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01.
 *
 * Responsabilidades EXCLUSIVAS de este hook:
 *   - estado LOCKED / AVAILABLE_OFF / ACTIVE;
 *   - observaciones de ritmo de la sesión y su mediana;
 *   - cálculo de la espera por segmento y el temporizador;
 *   - pausa con la pestaña oculta o la ventana sin foco;
 *   - vigilancia de inactividad (10 avances automáticos sin interacción);
 *   - fin del libro.
 *
 * NO navega por su cuenta: el único que mueve la lectura es
 * useA11yReaderNavigation (`advanceSegmentAuto`, que reutiliza la misma
 * selección y el mismo scroll que "Siguiente párrafo", sin foco ni anuncio).
 *
 * Reglas de producto:
 *   - desbloqueado ≠ activado. El desbloqueo lo decide el SERVIDOR
 *     (GET /api/reading/my-effective-time, 120 min de lectura efectiva); si la
 *     consulta falla, el control queda LOCKED.
 *   - ON/OFF NO se persiste (dispositivos compartidos en el colegio): cada
 *     apertura del visor arranca en OFF. Tampoco se persiste el ritmo.
 *   - el usuario manda: cualquier navegación manual reinicia el reloj y
 *     cualquier interacción humana reinicia la vigilancia de inactividad.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReaderNavigationApi } from './useA11yReaderNavigation';
import type { ReadingSegment } from '../utils/readingSegments';
import {
    createPausableTimer,
    deriveAutoAdvanceStatus,
    inactivityLimitReached,
    personalWpm,
    pushObservation,
    segmentDurationMs,
    type AutoAdvanceStatus,
} from '../utils/a11yAutoAdvance.mjs';

export type { AutoAdvanceStatus };

export const MY_EFFECTIVE_TIME_PATH = '/api/reading/my-effective-time';

export const AUTO_ADVANCE_END_MESSAGE        = 'Has llegado al final. Avance automático desactivado.';
export const AUTO_ADVANCE_INACTIVITY_MESSAGE = 'Avance automático pausado por inactividad.';

export interface AutoAdvanceApi {
    status: AutoAdvanceStatus;
    /** Cambia OFF ↔ ON. No-op mientras está LOCKED. */
    toggle: () => void;
}

interface Observation { words: number; durationMs: number }

const ANNOUNCER_POLITE_ID = 'a11y-announcer-polite';

function announce(text: string): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(ANNOUNCER_POLITE_ID);
    if (!el) return;
    el.textContent = '';
    setTimeout(() => { el.textContent = text; }, 50);
}

/** Pestaña visible Y ventana con foco: solo entonces corre el reloj. */
function isForeground(): boolean {
    if (typeof document === 'undefined') return false;
    if (document.visibilityState !== 'visible') return false;
    return typeof document.hasFocus === 'function' ? document.hasFocus() : true;
}

export function useA11yAutoAdvance(args: {
    userId: string | undefined;
    navigation: ReaderNavigationApi;
    segments: ReadonlyArray<ReadingSegment>;
}): AutoAdvanceApi {
    const { userId, navigation, segments } = args;

    const [unlocked, setUnlocked] = useState<boolean>(false);
    // Nunca se lee de storage: cada apertura del visor arranca en OFF.
    const [enabled, setEnabled]   = useState<boolean>(false);

    const status = deriveAutoAdvanceStatus({ unlocked, enabled });

    // Refs para que los callbacks del temporizador lean siempre lo último.
    const navRef      = useRef(navigation);
    navRef.current    = navigation;
    const segmentsRef = useRef(segments);
    segmentsRef.current = segments;
    const enabledRef  = useRef(false);
    enabledRef.current = enabled;

    const timerRef = useRef<ReturnType<typeof createPausableTimer> | null>(null);
    if (timerRef.current === null) timerRef.current = createPausableTimer();

    const observationsRef      = useRef<Observation[]>([]);
    const autoCountRef         = useRef(0);          // avances automáticos desde la última interacción humana
    const pendingAutoTargetRef = useRef<number | null>(null);
    const prevSegmentRef       = useRef<number | null>(null);
    const segmentEnteredAtRef  = useRef<number>(Date.now());
    const lastHumanInputAtRef  = useRef<number>(0);
    // Permanencia ACTIVA (visible + con foco) en el segmento actual.
    const activeAccumRef       = useRef(0);
    const activeSinceRef       = useRef<number | null>(isForeground() ? Date.now() : null);

    // ── Desbloqueo: autoridad del servidor, fail-closed ─────────────────────
    useEffect(() => {
        setUnlocked(false);
        if (!userId) return;
        const abort = new AbortController();
        fetch(MY_EFFECTIVE_TIME_PATH, { credentials: 'include', cache: 'no-store', signal: abort.signal })
            .then(res => (res.ok ? res.json() : null))
            .then((body: { autoAdvanceUnlocked?: unknown } | null) => {
                if (!abort.signal.aborted) setUnlocked(body?.autoAdvanceUnlocked === true);
            })
            .catch(() => { /* red caída / abortado: sigue LOCKED */ });
        return () => abort.abort();
    }, [userId]);

    // ── Temporizador ─────────────────────────────────────────────────────────
    const stop = useCallback((message?: string) => {
        enabledRef.current = false;
        timerRef.current!.cancel();
        pendingAutoTargetRef.current = null;
        setEnabled(false);
        if (message) announce(message);
    }, []);

    const onTimerFired = useCallback(() => {
        if (!enabledRef.current) return;
        const nav = navRef.current;
        if (!nav.hasNextSegment) {
            stop(AUTO_ADVANCE_END_MESSAGE);
            return;
        }
        pendingAutoTargetRef.current = nav.currentSegmentIndex + 1;
        if (!nav.advanceSegmentAuto()) {
            pendingAutoTargetRef.current = null;
            stop(AUTO_ADVANCE_END_MESSAGE);
            return;
        }
        autoCountRef.current += 1;
        if (inactivityLimitReached(autoCountRef.current)) {
            stop(AUTO_ADVANCE_INACTIVITY_MESSAGE);
        }
        // Si sigue activo, el effect de cambio de segmento programa la próxima espera.
    }, [stop]);

    const scheduleFor = useCallback((segIdx: number) => {
        const timer = timerRef.current!;
        const seg = segIdx >= 0 ? segmentsRef.current[segIdx] : undefined;
        if (!enabledRef.current || !seg) { timer.cancel(); return; }
        const { wpm } = personalWpm(observationsRef.current);
        timer.start(segmentDurationMs(seg.estimatedWords, wpm), onTimerFired, { paused: !isForeground() });
    }, [onTimerFired]);

    // ── Cambio de segmento: manual (botones, índice, scroll) o automático ────
    const currentSegmentIndex = navigation.currentSegmentIndex;
    useEffect(() => {
        const prev = prevSegmentRef.current;
        prevSegmentRef.current = currentSegmentIndex;
        if (prev === currentSegmentIndex) return;

        const now = Date.now();
        const dwellMs = activeAccumRef.current
            + (activeSinceRef.current !== null ? now - activeSinceRef.current : 0);
        const humanSinceEntry = lastHumanInputAtRef.current >= segmentEnteredAtRef.current;
        const isAuto = pendingAutoTargetRef.current === currentSegmentIndex;
        pendingAutoTargetRef.current = null;

        // Observación de ritmo: SOLO un avance manual al segmento siguiente,
        // hecho por una persona. Los saltos automáticos nunca alimentan el ritmo.
        if (!isAuto && prev !== null && prev >= 0 && currentSegmentIndex === prev + 1 && humanSinceEntry) {
            const words = segmentsRef.current[prev]?.estimatedWords ?? 0;
            observationsRef.current = pushObservation(observationsRef.current, { words, durationMs: dwellMs });
        }

        segmentEnteredAtRef.current = now;
        activeAccumRef.current = 0;
        activeSinceRef.current = isForeground() ? now : null;

        if (enabledRef.current) scheduleFor(currentSegmentIndex);
    }, [currentSegmentIndex, scheduleFor]);

    // ── Encender / apagar ────────────────────────────────────────────────────
    useEffect(() => {
        if (enabled) {
            autoCountRef.current = 0;
            scheduleFor(navRef.current.currentSegmentIndex);
        } else {
            timerRef.current!.cancel();
            pendingAutoTargetRef.current = null;
        }
    }, [enabled, scheduleFor]);

    // Si el desbloqueo desaparece (otro usuario), nada puede quedar corriendo.
    useEffect(() => {
        if (!unlocked && enabledRef.current) stop();
    }, [unlocked, stop]);

    const toggle = useCallback(() => {
        if (!unlocked) return;
        setEnabled(v => {
            const next = !v;
            enabledRef.current = next;
            return next;
        });
    }, [unlocked]);

    // ── Interacción humana: reinicia la vigilancia de inactividad ────────────
    // `scroll` NO cuenta: el scroll programático del propio avance lo dispara.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onHuman = () => {
            lastHumanInputAtRef.current = Date.now();
            autoCountRef.current = 0;
        };
        const opts: AddEventListenerOptions = { passive: true, capture: true };
        window.addEventListener('pointerdown', onHuman, opts);
        window.addEventListener('keydown',     onHuman, opts);
        window.addEventListener('wheel',       onHuman, opts);
        window.addEventListener('touchstart',  onHuman, opts);
        return () => {
            window.removeEventListener('pointerdown', onHuman, opts);
            window.removeEventListener('keydown',     onHuman, opts);
            window.removeEventListener('wheel',       onHuman, opts);
            window.removeEventListener('touchstart',  onHuman, opts);
        };
    }, []);

    // ── Pestaña oculta / ventana sin foco: el reloj se congela ───────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const sync = () => {
            const now = Date.now();
            if (isForeground()) {
                if (activeSinceRef.current === null) activeSinceRef.current = now;
                timerRef.current!.resume();
            } else {
                if (activeSinceRef.current !== null) {
                    activeAccumRef.current += now - activeSinceRef.current;
                    activeSinceRef.current = null;
                }
                timerRef.current!.pause();
            }
        };
        document.addEventListener('visibilitychange', sync);
        window.addEventListener('blur',  sync);
        window.addEventListener('focus', sync);
        return () => {
            document.removeEventListener('visibilitychange', sync);
            window.removeEventListener('blur',  sync);
            window.removeEventListener('focus', sync);
        };
    }, []);

    // Desmontaje: ninguna espera sobrevive al visor.
    useEffect(() => () => { timerRef.current?.cancel(); }, []);

    return useMemo(() => ({ status, toggle }), [status, toggle]);
}
