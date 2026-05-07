/**
 * useA11yReaderNavigation — estado y acciones de navegación del Modo accesible.
 *
 * Encapsula:
 *   - índice del párrafo actual (0-based, -1 si el libro está vacío)
 *   - índice derivado del capítulo
 *   - progreso (porcentaje basado en párrafo actual / total)
 *   - flags hasPrev/hasNext para deshabilitar botones extremos
 *   - acciones goToPrev/Next chapter/paragraph que mueven foco programático,
 *     scrollean el destino y emiten un anuncio al announcer-polite
 *
 * Filosofía: lectura pura. Sin overlays, sin Leo, sin paneles, sin animaciones.
 * Solo navegación textual entre capítulos y párrafos con feedback al lector
 * de pantalla.
 *
 * Foco programático: cuando el usuario hace click en "siguiente capítulo",
 * el foco se mueve al `<section id="chap-N">` del nuevo capítulo (que ya
 * tiene tabIndex=-1 en A11yDocument). Cuando hace click en "siguiente
 * párrafo", el foco se mueve al `<p id="p-N-M-K">` (los párrafos reciben
 * tabIndex=-1 desde el cambio de A11yDocument que acompaña este sprint).
 *
 * Anuncios: usa la región `#a11y-announcer-polite` montada por A11yLiveRegion
 * desde el primer render. Es el primer "escritor" real de esa región.
 *
 * Memoización del retorno: el objeto API se devuelve dentro de useMemo. Esto
 * blinda a futuros consumers que pongan el objeto entero en deps de
 * useEffect — no se reproducirá el bug de loop de cancel/refetch que
 * afectó a VisorAccesible cuando useA11yAnalytics retornaba un objeto sin
 * useMemo.
 *
 * Lo que NO hace:
 *   - No persiste posición en backend (analytics se mantiene intacto).
 *   - No detecta automáticamente "qué párrafo está leyendo el usuario" via
 *     IntersectionObserver — eso ya lo hace useA11yAnalytics independiente.
 *   - No abre overlays, no muestra modales, no llama a Leo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { A11yBook } from '../types/a11y';
import { findSegmentForParagraph, type ReadingSegment } from '../utils/readingSegments';

interface FlatParagraph {
    paragraphId: string;
    chapterIndex: number;
    chapterId: string;
}

export interface ReaderNavigationApi {
    /** 0-based índice global del párrafo. -1 si totalParagraphs===0. */
    currentParagraphIndex: number;
    /** 0-based índice del capítulo que contiene el párrafo actual. -1 si vacío. */
    currentChapterIndex: number;
    totalParagraphs: number;
    totalChapters: number;
    /** 0..100. Math.round((currentParagraphIndex+1) / total * 100). */
    progressPercent: number;
    /** Texto del heading h2 del capítulo actual. '' si vacío. */
    currentChapterTitle: string;
    hasPrevChapter: boolean;
    hasNextChapter: boolean;
    goToPrevChapter: () => void;
    goToNextChapter: () => void;

    // ── Segmentos (UX-4A) ─────────────────────────────────────────────────
    //
    // Los botones "Siguiente párrafo" / "Párrafo anterior" del UI navegan
    // entre ReadingSegment, no entre <p> HTML. Un segmento es una ventana
    // cognitiva: ~280 palabras desktop / ~150 palabras mobile, ajustado al
    // font-size. Mejora consistencia y reduce saltos arbitrarios cuando un
    // capítulo tiene párrafos de longitudes muy distintas.
    //
    // El nombre visible del UI sigue siendo "párrafo" por claridad infantil
    // — el spec lo permite — pero internamente la unidad de navegación es
    // el segmento. currentParagraphIndex / progressPercent siguen siendo
    // paragraph-based porque el scroll-sync y el progreso suave dependen
    // de eso (el segment-counter saltaría feo).
    /** 0-based índice del segmento actual. -1 si totalSegments===0. */
    currentSegmentIndex: number;
    /** Total de segmentos del libro con la config actual. */
    totalSegments: number;
    hasPrevSegment: boolean;
    hasNextSegment: boolean;
    goToPrevSegment: () => void;
    goToNextSegment: () => void;
    /**
     * Navegar a un capítulo por su id estable (ej: 'chap-3'). Usado por el
     * TOC para mantener sincronizado el state interno (currentParagraphIndex,
     * progreso, regla focal) cuando el user salta vía índice.
     *
     * Si el id no existe en el libro, no-op silencioso.
     */
    goToChapterById: (chapterId: string) => void;
    /**
     * Callback para que A11yDocument registre cada <p> con el observer
     * interno de sincronización con scroll natural. Acepta (el, id) en mount
     * y (null, id) en unmount, mismo contrato que useA11yAnalytics.observeParagraph.
     *
     * Internamente: IntersectionObserver detecta qué párrafo está más cerca
     * del centro del viewport y actualiza currentParagraphIndex
     * — pero ignora cambios durante 800ms tras un set programático
     * (botones / TOC) para evitar ping-pong scroll → setState → scroll.
     */
    observeParagraph: (el: Element | null, paragraphId: string) => void;
}

const ANNOUNCER_POLITE_ID = 'a11y-announcer-polite';

/**
 * Ventana en milisegundos durante la cual el IntersectionObserver de
 * sincronización IGNORA cambios de párrafo visible. Se inicia cada vez que
 * un cambio programático de currentParagraphIndex (botones, TOC, reset por
 * book change) dispara scrollIntoView — evita que el observer reaccione
 * al propio scroll programático y sobrescriba el destino que el setter
 * acababa de fijar (ping-pong).
 *
 * 500ms es suficiente para cubrir scroll suave en browsers modernos
 * (Chrome ≈300ms, Firefox ≈400ms). Si reduce-motion está activo, el scroll
 * es instantáneo y los 500ms solo introducen una pequeña latencia
 * irrelevante para el usuario.
 *
 * Configurable: si en el futuro se detecta que el guard es demasiado corto
 * o largo (por ejemplo, si scroll suave en algún browser es más lento),
 * cambiar este valor. NO inflar la constante con lógica condicional.
 */
const PROGRAMMATIC_GUARD_MS = 500;

/**
 * LIMITACIÓN CONOCIDA — sincronización con scroll natural.
 *
 * El IntersectionObserver de este hook depende de SCROLL FÍSICO del
 * viewport: solo detecta cuando el browser desplaza píxeles realmente.
 * Si el lector usa NAVEGACIÓN VIRTUAL del screen reader (NVDA flecha-abajo,
 * VoiceOver VO+→), el "punto de lectura virtual" del AT cambia sin que el
 * viewport se mueva — y el observer NO ve el cambio.
 *
 * Resultado en runtime con NVDA/VoiceOver virtual cursor:
 *   - currentParagraphIndex queda obsoleto.
 *   - Progreso, regla focal y orientación no avanzan automáticamente.
 *   - El user puede seguir usando los botones "Siguiente párrafo" para
 *     sincronizar manualmente, pero la auto-sincronización no funciona.
 *
 * Solución pendiente (Fase 3 — backlog):
 *   Detectar cambios de "AT focus virtual" via aria-current="true" cuando
 *   el AT pasa por un párrafo, o vía el evento focusin con guard de
 *   keyboard-source. Requiere validación con NVDA y VoiceOver reales.
 *
 * Por ahora documentamos el comportamiento y dejamos al user los botones
 * como mecanismo de sincronización manual.
 */

/**
 * Ratio del viewport donde debe quedar el TOP del segmento destino tras el
 * salto programático. UX-4B — reemplaza al previo `scrollIntoView({block:
 * 'center'})` que recentraba el segmento entero al medio del viewport,
 * produciendo "teletransporte" perceptual: aunque el destino ya estuviera
 * parcialmente visible, el browser lo movía al centro y el lector perdía
 * orientación.
 *
 * Con 0.20 (20% desde arriba) el segmento aterriza en la zona ALTA de la
 * ventana focal — coincide con la "Regla focal" del Modo accesible —
 * mientras las primeras líneas del segmento previo siguen visibles arriba
 * como ancla cognitiva. Sensación: "el texto bajó un poco", no "salté de
 * página".
 */
const VIEWPORT_TOP_OFFSET_RATIO = 0.20;

function smoothScrollToElement(el: HTMLElement): void {
    if (typeof window === 'undefined') return;

    // prefers-reduced-motion: usuarios con sensibilidad vestibular o
    // cognitiva. Hacemos el salto instantáneo (behavior:'auto') — la
    // animación de scroll, por suave que sea, es movimiento que la
    // preferencia del SO pide eliminar.
    const prefersReduced = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const rect    = el.getBoundingClientRect();
    const offset  = window.innerHeight * VIEWPORT_TOP_OFFSET_RATIO;
    const targetY = window.scrollY + rect.top - offset;

    window.scrollTo({
        top:      Math.max(0, targetY),
        behavior: prefersReduced ? 'auto' : 'smooth',
    });
}

function focusElementById(id: string): void {
    // Esperamos al siguiente frame para que el state recién seteado haya
    // disparado un render y el target existe en el DOM.
    requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        // preventScroll: el .focus() nativo dispararía su propio scroll
        // (típicamente al borde superior del elemento, sin offset). Lo
        // suprimimos para que el único movimiento de scroll sea el nuestro
        // — controlado, con offset y respetando reduce-motion.
        if (el instanceof HTMLElement) {
            el.focus({ preventScroll: true });
            smoothScrollToElement(el);
        } else {
            (el as HTMLElement).focus();
        }
    });
}

function announce(text: string): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById(ANNOUNCER_POLITE_ID);
    if (!el) return;
    // Limpiar primero fuerza re-anuncio si el mensaje es muy parecido al
    // anterior (algunos lectores ignoran textos idénticos en aria-live).
    el.textContent = '';
    setTimeout(() => { el.textContent = text; }, 50);
}

export function useA11yReaderNavigation(
    book: A11yBook | null,
    segments: ReadonlyArray<ReadingSegment>,
): ReaderNavigationApi {
    // Aplanamos book → lista global de párrafos. Mantiene los IDs estables
    // que ya genera el parser (p-{chap}-{sec}-{para}).
    const flat = useMemo<FlatParagraph[]>(() => {
        if (!book) return [];
        const out: FlatParagraph[] = [];
        book.chapters.forEach((ch, ci) => {
            for (const sec of ch.sections) {
                for (const p of sec.paragraphs) {
                    out.push({ paragraphId: p.id, chapterIndex: ci, chapterId: ch.id });
                }
            }
        });
        return out;
    }, [book]);

    // Índice global del primer párrafo de cada capítulo. Vacío si el capítulo
    // no tiene párrafos (caso edge: capítulo huérfano sin contenido).
    const firstParagraphOfChapter = useMemo(() => {
        const m = new Map<number, number>();
        flat.forEach((fp, i) => {
            if (!m.has(fp.chapterIndex)) m.set(fp.chapterIndex, i);
        });
        return m;
    }, [flat]);

    const totalParagraphs = flat.length;
    const totalChapters   = book?.chapters.length ?? 0;

    const [currentParagraphIndex, setCurrentParagraphIndex] = useState<number>(0);

    // Refs del observer interno (sincronización con scroll natural). El
    // observer detecta qué párrafo está más cerca del centro del viewport
    // y actualiza currentParagraphIndex sin causar ping-pong con cambios
    // programáticos (ver programmaticChangeAtRef).
    const observerRef          = useRef<IntersectionObserver | null>(null);
    const observedElementsRef  = useRef<Map<string, Element>>(new Map());
    const intersectionRatiosRef = useRef<Map<string, number>>(new Map());
    /**
     * Timestamp del último cambio programático de currentParagraphIndex
     * (botones nav, TOC, reset por book change). El observer ignora sus
     * propios entries durante una ventana de 800ms tras este timestamp para
     * evitar que un scrollIntoView programático se sobrescriba al observador.
     * 800ms es un margen seguro tras scroll suave en browsers modernos.
     */
    const programmaticChangeAtRef = useRef<number>(0);
    /**
     * Ref del flat actual para que el callback del observer (estable) lea la
     * última versión sin depender de él en sus deps.
     */
    const flatRef = useRef<FlatParagraph[]>(flat);
    flatRef.current = flat;

    // Reset cuando el libro cambia (otro contentId, otro idioma, o difiere el
    // total de párrafos por una recarga). Si no hay párrafos, dejamos el
    // índice en -1 explícito para que las flags hasPrev/hasNext sean false y
    // los botones queden deshabilitados.
    //
    // book?.language en deps: garantiza reset cuando el user cambia idioma
    // aunque por casualidad el conteo de párrafos coincida con el anterior.
    //
    // También marcamos "cambio programático" para que el observer ignore
    // los primeros entries que dispararía el primer párrafo al montar.
    useEffect(() => {
        setCurrentParagraphIndex(totalParagraphs > 0 ? 0 : -1);
        programmaticChangeAtRef.current = Date.now();
        intersectionRatiosRef.current.clear();
    }, [book?.contentId, book?.language, totalParagraphs]);

    const currentChapterIndex = totalParagraphs === 0
        ? -1
        : (flat[currentParagraphIndex]?.chapterIndex ?? -1);

    const currentChapter = book && currentChapterIndex >= 0
        ? book.chapters[currentChapterIndex]
        : null;
    const currentChapterTitle = currentChapter?.heading.text ?? '';

    const progressPercent = totalParagraphs > 0 && currentParagraphIndex >= 0
        ? Math.round(((currentParagraphIndex + 1) / totalParagraphs) * 100)
        : 0;

    const hasPrevChapter = currentChapterIndex > 0;
    const hasNextChapter = currentChapterIndex >= 0 && currentChapterIndex < totalChapters - 1;

    // ── Segmentos (UX-4A) ───────────────────────────────────────────────────
    //
    // currentSegmentIndex se DERIVA del currentParagraphIndex. La unidad
    // física que el observer rastrea sigue siendo el párrafo (suaviza el
    // progreso y permite scroll-sync fino); el segmento es la unidad
    // cognitiva con la que el usuario navega.
    //
    // El cálculo es O(N*M) en peor caso pero arranca del segmento donde
    // está el currentParagraphIndex y termina en cuanto encuentra. En
    // libros de 5000 párrafos / 100 segmentos esto son <100 comparaciones.
    const totalSegments = segments.length;
    const currentParagraphId = currentParagraphIndex >= 0
        ? (flat[currentParagraphIndex]?.paragraphId ?? null)
        : null;
    const currentSegmentIndex = useMemo<number>(() => {
        if (!currentParagraphId || totalSegments === 0) return -1;
        return findSegmentForParagraph(segments as ReadingSegment[], currentParagraphId);
    }, [currentParagraphId, segments, totalSegments]);
    const hasPrevSegment = currentSegmentIndex > 0;
    const hasNextSegment = currentSegmentIndex >= 0 && currentSegmentIndex < totalSegments - 1;

    // ── Acciones ────────────────────────────────────────────────────────────

    const goToChapter = useCallback((ci: number) => {
        if (!book) return;
        if (ci < 0 || ci >= book.chapters.length) return;
        const firstParaIdx = firstParagraphOfChapter.get(ci);
        if (firstParaIdx === undefined) return;
        const ch = book.chapters[ci];
        programmaticChangeAtRef.current = Date.now();
        setCurrentParagraphIndex(firstParaIdx);
        // Foco al <section id="chap-N"> que ya tiene tabIndex=-1 en
        // A11yDocument. NVDA leerá el h2 al recibir foco la sección.
        focusElementById(ch.id);
        announce(`Capítulo ${ci + 1} de ${book.chapters.length}. ${ch.heading.text}`);
    }, [book, firstParagraphOfChapter]);

    /**
     * Saltar a un capítulo por su id estable (chap-N). Resuelve el index
     * y delega en goToChapter. Es la API que consume el TOC.
     */
    const goToChapterById = useCallback((chapterId: string) => {
        if (!book) return;
        const ci = book.chapters.findIndex(ch => ch.id === chapterId);
        if (ci < 0) return;
        goToChapter(ci);
    }, [book, goToChapter]);

    // UX-4A/4B — Navegación por segmento. El usuario aprieta "Siguiente
    // párrafo" / "Párrafo anterior" (texto visible, regla de producto) pero
    // el sistema salta de ReadingSegment en ReadingSegment, no de <p> en
    // <p>. Cada segmento contiene N párrafos contiguos del mismo capítulo.
    // Aterrizamos en el PRIMER párrafo del segmento destino con
    // focusElementById, que ahora hace scroll suave con offset al ~20%
    // superior del viewport — cae en la ventana focal sin teletransporte.
    //
    // Anuncio polite: "Sección X de Y". El contador interno YA NO refleja
    // párrafos HTML — refleja secciones cognitivas (ReadingSegment), por lo
    // que llamarlo "párrafo" en el aria-live era incorrecto y confundía al
    // lector de pantalla. Los botones siguen diciendo "párrafo" por
    // claridad infantil; el announcer dice "sección" porque describe la
    // unidad real que avanzó.
    const goToSegment = useCallback((segIdx: number) => {
        if (totalSegments === 0) return;
        const clamped = Math.max(0, Math.min(segIdx, totalSegments - 1));
        const seg = segments[clamped];
        if (!seg || seg.paragraphIds.length === 0) return;
        const firstParaId = seg.paragraphIds[0];
        const paraIdx = flat.findIndex(fp => fp.paragraphId === firstParaId);
        if (paraIdx < 0) return;
        programmaticChangeAtRef.current = Date.now();
        setCurrentParagraphIndex(paraIdx);
        focusElementById(firstParaId);
        announce(`Sección ${clamped + 1} de ${totalSegments}`);
    }, [segments, totalSegments, flat]);

    const goToPrevSegment = useCallback(() => {
        if (!hasPrevSegment) return;
        goToSegment(currentSegmentIndex - 1);
    }, [hasPrevSegment, currentSegmentIndex, goToSegment]);

    const goToNextSegment = useCallback(() => {
        if (!hasNextSegment) return;
        goToSegment(currentSegmentIndex + 1);
    }, [hasNextSegment, currentSegmentIndex, goToSegment]);

    const goToPrevChapter = useCallback(() => {
        if (!hasPrevChapter) return;
        goToChapter(currentChapterIndex - 1);
    }, [hasPrevChapter, currentChapterIndex, goToChapter]);

    const goToNextChapter = useCallback(() => {
        if (!hasNextChapter) return;
        goToChapter(currentChapterIndex + 1);
    }, [hasNextChapter, currentChapterIndex, goToChapter]);

    // ── Sincronización con scroll natural ──────────────────────────────────
    //
    // IntersectionObserver propio del navigation hook. Independiente del
    // observer de useA11yAnalytics (ese tiene threshold 0.6 y emite progress
    // events; este elige el párrafo más cercano al centro del viewport).
    //
    // Política para evitar ping-pong con scroll programático:
    //   - Cualquier setter que dispare scrollIntoView (goToSegment,
    //     goToChapter, reset por book change) registra Date.now() en
    //     programmaticChangeAtRef.
    //   - El callback del observer ignora todos los entries que lleguen
    //     dentro de los PROGRAMMATIC_GUARD_MS posteriores (constante
    //     definida en módulo, default 500ms).
    //
    // Elección del "párrafo actual" entre los visibles: se calcula la
    // distancia entre el centro del bounding box de cada párrafo intersecting
    // y el centro del viewport. El menor gana. Esto coincide con la sensación
    // de "donde estoy leyendo" y no salta abruptamente al cambiar de scroll.
    //
    // Ver el comentario "LIMITACIÓN CONOCIDA — sincronización con scroll
    // natural" al inicio del módulo para el caso del cursor virtual de AT.
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        if (typeof window === 'undefined') return;

        const obs = new IntersectionObserver(
            (entries) => {
                // Actualizar el map de ratios con cada entry.
                for (const entry of entries) {
                    const id = (entry.target as HTMLElement).id;
                    if (!id) continue;
                    if (entry.isIntersecting) {
                        intersectionRatiosRef.current.set(id, entry.intersectionRatio);
                    } else {
                        intersectionRatiosRef.current.delete(id);
                    }
                }

                // Guard programático: si un setter recién scrolleó, no
                // sobreescribimos.
                if (Date.now() - programmaticChangeAtRef.current < PROGRAMMATIC_GUARD_MS) return;

                // Sin párrafos visibles, no hacemos nada.
                if (intersectionRatiosRef.current.size === 0) return;

                // Encontrar el párrafo intersecting cuyo centro está más
                // cerca del centro del viewport.
                const viewportCenter = window.innerHeight / 2;
                let bestId: string | null = null;
                let bestDistance = Infinity;
                for (const [id] of intersectionRatiosRef.current) {
                    const el = document.getElementById(id);
                    if (!el) continue;
                    const rect = el.getBoundingClientRect();
                    const elementCenter = rect.top + rect.height / 2;
                    const distance = Math.abs(elementCenter - viewportCenter);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestId = id;
                    }
                }
                if (!bestId) return;

                // Resolver el index global. Usa flatRef.current para leer la
                // última versión sin meter `flat` como dep del effect (que
                // recrearía el observer en cada cambio).
                const idx = flatRef.current.findIndex(fp => fp.paragraphId === bestId);
                if (idx === -1) return;

                // setState funcional: solo set si difiere — evita re-render
                // y posible loop.
                setCurrentParagraphIndex(prev => prev === idx ? prev : idx);
            },
            { threshold: [0, 0.25, 0.5, 0.75, 1] },
        );
        observerRef.current = obs;
        return () => {
            obs.disconnect();
            observerRef.current = null;
            observedElementsRef.current.clear();
            intersectionRatiosRef.current.clear();
        };
    }, []);

    /**
     * Callback expuesto a A11yDocument: registra/desregistra cada <p> en el
     * observer. Mismo contrato que useA11yAnalytics.observeParagraph.
     * (el, id) → mount; (null, id) → unmount.
     *
     * Si el observer aún no se creó (primer render antes del effect, o
     * entornos sin IntersectionObserver), salimos silenciosamente — no
     * lanzamos errores ni logs. La consecuencia es que el primer mount de
     * los <p> antes de que el observer exista no se registra; el cleanup
     * subsecuente tampoco. Es seguro: no hay state corrompido y los
     * <p> que se mantengan montados se observarán cuando el observer
     * exista (en la práctica, esto sucede en el mismo tick).
     */
    const observeParagraph = useCallback((el: Element | null, paragraphId: string): void => {
        const observer = observerRef.current;
        if (!observer) return;
        const map = observedElementsRef.current;
        const prev = map.get(paragraphId);
        if (prev) observer.unobserve(prev);
        if (prev) {
            map.delete(paragraphId);
            intersectionRatiosRef.current.delete(paragraphId);
        }
        if (el) {
            map.set(paragraphId, el);
            observer.observe(el);
        }
    }, []);

    // useMemo para que el objeto retornado sea ref-estable mientras no cambie
    // ningún campo derivado. Blinda contra loops si un consumer pone el
    // objeto entero en deps de useEffect.
    return useMemo<ReaderNavigationApi>(() => ({
        currentParagraphIndex,
        currentChapterIndex,
        totalParagraphs,
        totalChapters,
        progressPercent,
        currentChapterTitle,
        hasPrevChapter,
        hasNextChapter,
        goToPrevChapter,
        goToNextChapter,
        currentSegmentIndex,
        totalSegments,
        hasPrevSegment,
        hasNextSegment,
        goToPrevSegment,
        goToNextSegment,
        goToChapterById,
        observeParagraph,
    }), [
        currentParagraphIndex,
        currentChapterIndex,
        totalParagraphs,
        totalChapters,
        progressPercent,
        currentChapterTitle,
        hasPrevChapter,
        hasNextChapter,
        goToPrevChapter,
        goToNextChapter,
        currentSegmentIndex,
        totalSegments,
        hasPrevSegment,
        hasNextSegment,
        goToPrevSegment,
        goToNextSegment,
        goToChapterById,
        observeParagraph,
    ]);
}
