/**
 * A11yDocument — render documental del libro.
 *
 * Convierte un A11yBook en HTML semántico estructurado:
 *   <article aria-labelledby="a11y-book-title" lang={book.language}>
 *     <h1 id="a11y-book-title">{book.title}</h1>
 *     {author && <p class="a11y-byline">de {author}</p>}
 *     <section id="chap-1" aria-labelledby="chap-1-h" tabindex="-1">
 *       <h2 id="chap-1-h">Capítulo 1</h2>
 *       <section aria-labelledby="sec-1-1-h">
 *         <h3 id="sec-1-1-h">Subtítulo</h3>
 *         <p id="p-1-1-1">…</p>
 *       </section>
 *       <p id="p-1-2-1">Párrafo huérfano sin sección…</p>
 *     </section>
 *   </article>
 *
 * Reglas:
 *   - Una sola <h1> en toda la página (este es ese único h1).
 *   - Capítulos como <section> con <h2>, focuseables programáticamente
 *     (tabIndex=-1) para ser destino de los enlaces del TOC.
 *   - Secciones con heading se envuelven en <section> propio.
 *   - Secciones sin heading: párrafos directos bajo el capítulo, sin <section>
 *     adicional (mantiene el árbol semántico limpio para el lector de pantalla).
 *   - Texto siempre como nodo React. Nunca dangerouslySetInnerHTML.
 *   - Si totalParagraphs === 0: mensaje accesible dentro del article.
 *
 * Cumple WCAG 2.2 AA: 1.3.1, 1.3.2, 2.4.6, 4.1.2.
 *
 * Sprint Data Backbone — Fase 1 (analytics):
 *   Para que useA11yAnalytics pueda observar la visibilidad de cada párrafo
 *   con IntersectionObserver, A11yDocument acepta un callback opcional
 *   `observeParagraph(el, paragraphId)`. Lo expone vía un Context interno
 *   para evitar prop-drilling Chapter→Section→Paragraph. Si no se pasa,
 *   ParagraphView no monta ningún observer — el componente sigue siendo
 *   utilizable sin telemetría (zero-impact opt-out).
 */

import React, { createContext, useContext, useEffect, useRef } from 'react';
import type { A11yBook, A11yChapter, A11yParagraph, A11ySection } from '../../types/a11y';

type ParagraphRefCallback = (el: Element | null, paragraphId: string) => void;

// Context interno (alcance: subárbol de A11yDocument). NO es estado global.
const ParagraphTrackingContext = createContext<ParagraphRefCallback | null>(null);

interface A11yDocumentProps {
    book: A11yBook;
    /**
     * Opcional. Si se pasa, cada <p> registra su elemento al montar y lo
     * desregistra al desmontar para alimentar el IntersectionObserver de
     * useA11yAnalytics. Sin este callback, el documento se renderiza igual
     * pero no produce eventos de progreso.
     */
    observeParagraph?: ParagraphRefCallback;
}

const ParagraphView: React.FC<{ paragraph: A11yParagraph }> = ({ paragraph }) => {
    const ref = useRef<HTMLParagraphElement | null>(null);
    const observe = useContext(ParagraphTrackingContext);

    useEffect(() => {
        if (!observe) return;
        const el = ref.current;
        if (!el) return;
        observe(el, paragraph.id);
        return () => observe(null, paragraph.id);
    }, [observe, paragraph.id]);

    return (
        <p
            ref={ref}
            id={paragraph.id}
            lang={paragraph.lang}
            tabIndex={-1}
            className="my-4 leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2 focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2"
        >
            {paragraph.text}
        </p>
    );
};

const SectionView: React.FC<{ section: A11ySection }> = ({ section }) => {
    // Sin heading: párrafos huérfanos (al principio del capítulo, antes de un h3).
    // Renderizamos los párrafos sin <section> envolvente para no introducir
    // un landmark sin etiqueta que confunda al lector de pantalla.
    if (!section.heading) {
        return (
            <>
                {section.paragraphs.map(p => (
                    <ParagraphView key={p.id} paragraph={p} />
                ))}
            </>
        );
    }

    const HeadingTag = `h${section.heading.level}` as 'h3' | 'h4' | 'h5' | 'h6';

    return (
        <section id={section.id} aria-labelledby={section.heading.id} className="mt-8">
            <HeadingTag id={section.heading.id} className="text-lg font-semibold mt-6 mb-3">
                {section.heading.text}
            </HeadingTag>
            {section.paragraphs.map(p => (
                <ParagraphView key={p.id} paragraph={p} />
            ))}
        </section>
    );
};

const ChapterView: React.FC<{ chapter: A11yChapter }> = ({ chapter }) => (
    <section
        id={chapter.id}
        aria-labelledby={chapter.heading.id}
        tabIndex={-1}
        className="mt-10 mb-12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2 focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2"
    >
        <h2 id={chapter.heading.id} className="text-2xl font-bold mt-10 mb-4 border-b border-gray-300 dark:border-gray-700 pb-2">
            {chapter.heading.text}
        </h2>
        {chapter.sections.map(s => (
            <SectionView key={s.id} section={s} />
        ))}
    </section>
);

const A11yDocument: React.FC<A11yDocumentProps> = ({ book, observeParagraph }) => {
    const hasContent = book.totalParagraphs > 0;

    return (
        <ParagraphTrackingContext.Provider value={observeParagraph ?? null}>
            <article aria-labelledby="a11y-book-title" lang={book.language}>
                <h1 id="a11y-book-title" className="text-3xl font-bold mb-2">
                    {book.title}
                </h1>
                {book.author && (
                    <p className="text-base text-gray-600 dark:text-gray-400 mb-6">
                        de {book.author}
                    </p>
                )}

                {!hasContent && (
                    <p
                        role="status"
                        className="my-8 p-4 border border-gray-300 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300"
                    >
                        Este libro no tiene texto disponible para mostrar en este momento.
                    </p>
                )}

                {hasContent && book.chapters.map(c => <ChapterView key={c.id} chapter={c} />)}
            </article>
        </ParagraphTrackingContext.Provider>
    );
};

export default A11yDocument;
