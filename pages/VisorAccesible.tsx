/**
 * VisorAccesible — página entry point del Modo accesible (mode='a11y').
 *
 * FASE 2 — Renderizado real del documento.
 * FASE 0 hardening — protegido por ProtectedRoute + AccessWrapper en App.tsx.
 *   El visor RECIBE el `content` ya validado contra el backend (preflight
 *   /api/content/:id/access). La búsqueda en `dataService` y la verificación
 *   de existencia ocurren en `AccessWrapper`, no acá.
 *
 * Sprint Data Backbone — Fase 1: telemetría unificada vía useA11yAnalytics.
 *
 * Responsabilidad:
 *   - Recibir `Content` ya autorizado por prop.
 *   - Descargar el texto plano de `content.texto_plano_url`.
 *   - Parsear el texto a A11yBook (utils/a11yDocumentParser).
 *   - Pasar { book, loading, error } a A11yShell.
 *   - Conectar telemetría al backbone v1:
 *       · session_start cuando el libro está parseado.
 *       · session_heartbeat / progress / session_end emitidos por el hook.
 *       · error cuando falla la carga o el parse.
 *
 * Casos manejados (con telemetría):
 *   1. Sin texto_plano_url                  → error UI + a11y.error('text_unavailable')
 *   2. fetch rechaza (network)              → error UI + a11y.error('network_error')
 *   3. HTTP no-OK                           → error UI + a11y.error('http_error', {status})
 *   4. HTML mal servido (DOCTYPE/<html>)    → error UI + a11y.error('invalid_format')
 *   5. Texto vacío (book con 0 párrafos)    → onBookReady + a11y.error('doc_empty')
 *   6. Componente desmontado mid-fetch      → AbortController, sin event
 *
 *   Los antiguos casos "id ausente" y "contenido no encontrado en cache"
 *   ya no llegan acá: el AccessWrapper los corta antes (redirect a `/`).
 *
 * Lo que NO hace en esta fase:
 *   - No persiste progreso en backend (events.db es la fuente vía backbone v1).
 *   - No carga audio.
 *   - No comparte hooks ni componentes con VisorTexto / VisorInmersivo.
 *
 * Identificador interno: 'a11y'. Nunca 'accessible' (legacy = Modo Guiado).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { parsePlainTextToA11yBook } from '../utils/a11yDocumentParser';
import A11yShell from '../components/accesible/A11yShell';
import { useA11yAnalytics } from '../hooks/useA11yAnalytics';
import { useA11yReaderNavigation } from '../hooks/useA11yReaderNavigation';
import { useA11yReadingSettings, type ReadingLanguage } from '../hooks/useA11yReadingSettings';
import { useReadingSegments } from '../hooks/useReadingSegments';
import type { A11yBook } from '../types/a11y';
import type { Content } from '../types';

// ── Resolución de idioma ────────────────────────────────────────────────────
//
// El setting `language` es preferencia GLOBAL del user. Cada libro puede o no
// tener traducción al inglés. Si la pref es 'en' pero el libro solo tiene
// español, hacemos FALLBACK silencioso a español. La pref no se cambia (sigue
// 'en' para el próximo libro que sí soporte).
//
// El radio "English" se renderiza disabled en el dropdown cuando no hay
// traducción — eso es UX correcta, pero el fallback runtime es la red de
// seguridad por si la pref llegara a 'en' antes de que el dropdown lo
// hubiera vetado (ej. localStorage cargado antes del primer render del libro).

interface ResolvedLanguage {
    /** Idioma efectivo que se está cargando ahora ('es' o 'en'). */
    effective: ReadingLanguage;
    /** URL del texto plano correspondiente. undefined si nada disponible. */
    url:       string | undefined;
}

function resolveLanguage(content: Content, requested: ReadingLanguage): ResolvedLanguage {
    if (requested === 'en' && content.texto_ingles_url) {
        return { effective: 'en', url: content.texto_ingles_url };
    }
    return { effective: 'es', url: content.texto_plano_url };
}

function getAvailableLanguages(content: Content): ReadonlyArray<ReadingLanguage> {
    const out: ReadingLanguage[] = [];
    if (content.texto_plano_url)   out.push('es');
    if (content.texto_ingles_url)  out.push('en');
    return out;
}

const HUMAN_LANGUAGE: Record<ReadingLanguage, string> = {
    es: 'español',
    en: 'inglés',
};

function announceLanguageChange(lang: ReadingLanguage): void {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('a11y-announcer-polite');
    if (!el) return;
    el.textContent = '';
    setTimeout(() => {
        el.textContent = `Idioma cambiado a ${HUMAN_LANGUAGE[lang]}`;
    }, 50);
}

interface VisorAccesibleProps {
    /** Contenido ya validado por AccessWrapper. Garantizado no-null. */
    content: Content;
}

const VisorAccesible: React.FC<VisorAccesibleProps> = ({ content }) => {
    const id = content.id;
    const { user } = useAuth();
    const navigate = useNavigate();
    const [book,       setBook]    = useState<A11yBook | null>(null);
    const [loading,    setLoading] = useState<boolean>(true);
    const [error,      setError]   = useState<string | null>(null);
    // UX-3B — token de retry: cualquier increment dispara el effect de carga
    // sin reload manual. Lo expone hacia el shell como `onRetryLoad`.
    const [retryNonce, setRetryNonce] = useState(0);
    const retryLoad = useCallback(() => setRetryNonce(n => n + 1), []);

    // Preferencias de lectura del usuario (fontFamily, fontSize, spacing,
    // theme, focusRule). Persisten en localStorage. El objeto cssVars que
    // expone se aplica vía `style={...}` en el div root del shell — todos
    // los descendientes heredan automáticamente sin re-render.
    //
    // UX-3A: la Regla focal ya NO depende de un hook que track párrafo
    // actual. Es un overlay viewport-band CSS-driven — A11yFocusRuleOverlay
    // dentro de A11yShell se activa solo via data-a11y-focus-rule="on".
    const settingsApi = useA11yReadingSettings();

    // UX-4A/4B — Segmentación adaptativa de lectura. Combina viewport +
    // font-size del usuario para producir ReadingSegment[] (ventanas
    // cognitivas de ~180 palabras desktop / ~100 mobile en medium,
    // reducidas con large/xl). useA11yReaderNavigation las consume para
    // que los botones "Siguiente párrafo / Párrafo anterior" salten de
    // sección en sección, no de <p> en <p>.
    const { segments } = useReadingSegments(book, settingsApi.settings.fontSize);

    // Navegación de lectura: estado del párrafo/capítulo + segmento actuales,
    // con acciones prev/next por capítulo o por segmento. ref-estable.
    const navigation = useA11yReaderNavigation(book, segments);

    // "Volver a la ficha del libro": navegación absoluta a /contenido/:id.
    // No usamos `navigate(-1)` (historia del browser) porque el libro
    // pudo haberse abierto desde un email o link externo — el destino
    // canónico es la ficha, no "lo anterior".
    const handleBack = useCallback(() => {
        navigate(`/contenido/${id}`);
    }, [navigate, id]);

    // SC 3.1.1 / 3.1.2 Language of Page / Parts.
    //
    // El idioma EFECTIVO se resuelve desde la preferencia global
    // (settingsApi.settings.language) más la disponibilidad real en el Content
    // (texto_plano_url para 'es', texto_ingles_url para 'en'). Con fallback
    // automático a 'es' si la traducción pedida no existe.
    const requestedLanguage = settingsApi.settings.language;
    const { effective: effectiveLanguage, url: effectiveUrl } = useMemo(
        () => resolveLanguage(content, requestedLanguage),
        [content, requestedLanguage],
    );

    // Disponibilidad real. El dropdown la usa para deshabilitar radios
    // de idiomas sin traducción para este libro.
    const availableLanguages = useMemo(
        () => getAvailableLanguages(content),
        [content],
    );

    // Track del idioma del último libro cargado. Sirve para anunciar SOLO
    // cuando el usuario cambia explícitamente de idioma — no en el initial
    // mount ni al cambiar de libro.
    const lastEffectiveLanguageRef = useRef<ReadingLanguage | null>(null);

    // SC 2.4.2 Page Titled — el <title> de la pestaña debe describir el libro
    // abierto, no el nombre genérico de la app. Se restaura "Chibalete+" al
    // desmontar para no contaminar otras pantallas.
    useEffect(() => {
        if (!book) return;
        const previous = document.title;
        document.title = `${book.title} — Chibalete+`;
        return () => { document.title = previous; };
    }, [book]);

    // Hook de telemetría — se inicializa con userId/contentId. Cuando alguno
    // cambia, el hook reinicia la sesión internamente (nuevo sessionId, etc.).
    // Si userId es undefined o 'guest', el hook hace no-op.
    const analytics = useA11yAnalytics({
        userId:    user?.id,
        contentId: id,
    });

    // IMPORTANTE: el objeto `analytics` es UNA NUEVA REFERENCIA en cada render
    // (el hook hace `return { onBookReady, onError, observeParagraph }` sin
    // useMemo). Los CALLBACKS individuales sí son estables (useCallback con
    // deps []). Al desestructurar acá, capturamos esas referencias estables
    // y las usamos en el array de deps del effect de fetch — evitando un loop
    // donde cada render invalida el effect, cancela el fetch en curso, y
    // arranca uno nuevo que también se cancela. Síntoma de la bug: el visor
    // queda en "Cargando libro accesible…" indefinidamente porque ningún
    // fetch llega a completarse.
    const { onBookReady, onError, observeParagraph: analyticsObserveParagraph } = analytics;
    const { observeParagraph: navObserveParagraph } = navigation;

    // Cada <p> del documento se registra en DOS observers independientes:
    //   · analytics.observeParagraph  → IntersectionObserver de telemetría
    //                                   (threshold 0.6, emite a11y.progress)
    //   · navigation.observeParagraph → IntersectionObserver de sincronización
    //                                   (threshold escalonado, elige el más
    //                                   cercano al centro del viewport y
    //                                   actualiza currentParagraphIndex)
    //
    // Combinarlos en UN SOLO callback memoizado evita que A11yDocument tenga
    // que conocer ambos hooks. Como cada callback subyacente es ref-estable
    // (useCallback con deps []), este combinedObserve también lo es —
    // A11yDocument NO se re-renderiza por esto.
    const combinedObserveParagraph = useCallback(
        (el: Element | null, paragraphId: string) => {
            analyticsObserveParagraph(el, paragraphId);
            navObserveParagraph(el, paragraphId);
        },
        [analyticsObserveParagraph, navObserveParagraph],
    );

    useEffect(() => {
        let cancelled = false;
        const abort = new AbortController();

        const load = async (): Promise<void> => {
            setLoading(true);
            setError(null);
            setBook(null);

            // Caso 1: el libro no tiene texto plano disponible en NINGÚN idioma.
            // (El fallback de inglés→español ya ocurrió en resolveLanguage; si
            // url sigue undefined, ni siquiera hay español.)
            if (!effectiveUrl) {
                if (!cancelled) {
                    setError('Este libro aún no tiene una versión accesible disponible.');
                    setLoading(false);
                    onError('text_unavailable', { contentId: id });
                }
                return;
            }

            try {
                const res = await fetch(effectiveUrl, { signal: abort.signal });

                // Caso 3: HTTP no-OK.
                if (!res.ok) {
                    if (!cancelled) {
                        setError(`No se pudo descargar el texto (código ${res.status}).`);
                        setLoading(false);
                        onError('http_error', { status: res.status });
                    }
                    return;
                }

                const text = await res.text();
                if (cancelled) return;

                // Caso 4: el servidor devolvió HTML por error (mismo guard que VisorTexto).
                const head = text.trimStart().slice(0, 200).toLowerCase();
                if (head.startsWith('<!doctype') || head.startsWith('<html')) {
                    setError('El archivo de texto del libro tiene un formato no válido.');
                    setLoading(false);
                    onError('invalid_format');
                    return;
                }

                // Parse. El parser nunca lanza para texto válido; siempre
                // produce un A11yBook estructuralmente correcto. El campo
                // `language` del A11yBook va al <article lang="..."> y los
                // lectores de pantalla cambian la pronunciación.
                const parsed = parsePlainTextToA11yBook({
                    contentId: content.id,
                    title:     content.titulo,
                    author:    content.autor,
                    language:  effectiveLanguage,
                    rawText:   text,
                });

                if (!cancelled) {
                    setBook(parsed);
                    setLoading(false);

                    // Anuncio de cambio de idioma (post-load): solo cuando el
                    // idioma EFECTIVO difiere del anterior. Si es initial mount
                    // (lastEffectiveLanguageRef.current === null) no se anuncia.
                    if (
                        lastEffectiveLanguageRef.current !== null &&
                        lastEffectiveLanguageRef.current !== effectiveLanguage
                    ) {
                        announceLanguageChange(effectiveLanguage);
                    }
                    lastEffectiveLanguageRef.current = effectiveLanguage;

                    // Telemetría: emitir session_start con stats reales del libro.
                    onBookReady({
                        totalChapters:   parsed.chapters.length,
                        totalParagraphs: parsed.totalParagraphs,
                    });

                    // Caso 5: libro estructuralmente válido pero sin párrafos.
                    if (parsed.totalParagraphs === 0) {
                        onError('doc_empty');
                    }
                }
            } catch (e: unknown) {
                if (cancelled) return;
                // Caso 6: aborto silencioso al desmontar.
                if (e instanceof DOMException && e.name === 'AbortError') return;
                // Caso 2: cualquier otro fallo de red.
                setError(
                    'No se pudo descargar el texto del libro. Verifica tu conexión e intenta de nuevo.'
                );
                setLoading(false);
                const errorMessage = e instanceof Error ? e.message : 'unknown';
                onError('network_error', { message: errorMessage });
            }
        };

        load();

        return () => {
            cancelled = true;
            abort.abort();
        };
    // Deps por campos PRIMITIVOS de content + el idioma EFECTIVO y la URL
    // resuelta (no el setting raw — eso forzaría re-fetch innecesario cuando
    // user cambia 'en' en un libro sin inglés y el fallback es el mismo
    // español que ya se está mostrando). callbacks de analytics son ref-estables
    // (useCallback con deps [] dentro del hook + useMemo del retorno).
    }, [
        content.id,
        content.titulo,
        content.autor,
        id,
        effectiveLanguage,
        effectiveUrl,
        onError,
        onBookReady,
        retryNonce,  // UX-3B: re-disparar el load sin reload manual
    ]);

    return (
        <A11yShell
            book={book}
            loading={loading}
            error={error}
            observeParagraph={combinedObserveParagraph}
            onBack={handleBack}
            onRetryLoad={retryLoad}
            navigation={navigation}
            settingsApi={settingsApi}
            availableLanguages={availableLanguages}
            segments={segments}
        />
    );
};

export default VisorAccesible;
