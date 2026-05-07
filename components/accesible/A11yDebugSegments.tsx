/**
 * A11yDebugSegments — overlay de diagnóstico de segmentación (UX-4B).
 *
 * Modo debug. Solo se monta cuando la URL trae `?a11ydebug=1`. Su único
 * propósito es auditar visualmente la calibración de ReadingSegment durante
 * desarrollo: detectar mega-segmentos, micro-segmentos redundantes, fusiones
 * agresivas o continuidad rota.
 *
 * No es accesible al lector de pantalla (aria-hidden) — ruido para el árbol
 * de accesibilidad. No es un componente de producto. No persiste estado.
 *
 * Decisiones de diseño:
 *   - Panel fijo bottom-right, ancho 320px, scroll interno.
 *   - El segmento ACTUAL se resalta. Los oversize se marcan rojo.
 *   - Preview del primer párrafo: 80 chars máx para no saturar.
 *   - Toggle minimizado (chip flotante) para no cubrir contenido durante
 *     pruebas de scroll/regla focal.
 *   - aria-hidden="true": no participa en el flujo de lectura del AT.
 */

import React, { useMemo, useState } from 'react';
import type { A11yBook, A11yParserWarning } from '../../types/a11y';
import type { ReadingSegment } from '../../utils/readingSegments';

interface A11yDebugSegmentsProps {
    book: A11yBook | null;
    segments: ReadonlyArray<ReadingSegment>;
    currentSegmentIndex: number;
}

/**
 * Devuelve true si la query string actual incluye `a11ydebug=1`. SSR-safe:
 * en server / sin window devuelve false.
 */
export function isA11yDebugEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const params = new URLSearchParams(window.location.search);
        return params.get('a11ydebug') === '1';
    } catch {
        return false;
    }
}

/** Mapa { paragraphId -> { chapterIndex, paragraphText } } pre-aplanado. */
function indexBookParagraphs(book: A11yBook | null): Map<string, { chap: number; text: string }> {
    const m = new Map<string, { chap: number; text: string }>();
    if (!book) return m;
    book.chapters.forEach((ch, ci) => {
        for (const sec of ch.sections) {
            for (const p of sec.paragraphs) {
                m.set(p.id, { chap: ci, text: p.text });
            }
        }
    });
    return m;
}

function preview(text: string, max: number): string {
    const t = text.replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    return t.slice(0, max - 1).trimEnd() + '…';
}

const A11yDebugSegments: React.FC<A11yDebugSegmentsProps> = ({ book, segments, currentSegmentIndex }) => {
    const [collapsed, setCollapsed] = useState(false);

    const paraIndex = useMemo(() => indexBookParagraphs(book), [book]);

    const stats = useMemo(() => {
        if (segments.length === 0) {
            return { count: 0, totalWords: 0, avg: 0, min: 0, max: 0, oversize: 0 };
        }
        let totalWords = 0;
        let minW = Infinity;
        let maxW = 0;
        let oversize = 0;
        for (const seg of segments) {
            totalWords += seg.estimatedWords;
            if (seg.estimatedWords < minW) minW = seg.estimatedWords;
            if (seg.estimatedWords > maxW) maxW = seg.estimatedWords;
            if (seg.oversize) oversize++;
        }
        return {
            count:      segments.length,
            totalWords,
            avg:        Math.round(totalWords / segments.length),
            min:        minW === Infinity ? 0 : minW,
            max:        maxW,
            oversize,
        };
    }, [segments]);

    // UX-4C — bloque "Parser stats" tomado del campo opcional book.parserStats.
    // Ausente si el libro fue parseado por un parser previo (parserVersion <
    // 'a11y-parser-v2'). En ese caso ocultamos el bloque sin error.
    const parserStats = book?.parserStats;
    const parserVersion = book?.parserVersion;

    // Tooltips para los códigos estables de warning. Se renderizan como
    // `title=` para no requerir librería de tooltips. Solo en debug.
    const WARNING_HINTS: Record<A11yParserWarning, string> = {
        LOW_CHAPTER_COUNT:        'El libro parece largo pero no se detectaron capítulos explícitos.',
        LOW_PARAGRAPH_COUNT:      'Muy pocos párrafos para el total de palabras del libro.',
        HIGH_OVERSIZE_PARAGRAPHS: '>10% de los párrafos superan 500 palabras (mega-bloques).',
        VERY_LONG_PARAGRAPH:      'Hay al menos un párrafo > 1000 palabras — revisar formato fuente.',
        MIXED_FORMAT_BLOCK:       'Algún bloque tuvo señales contradictorias (avg vs puntuación).',
    };

    if (collapsed) {
        return (
            <button
                type="button"
                aria-hidden="true"
                onClick={() => setCollapsed(false)}
                style={{
                    position:        'fixed',
                    right:           12,
                    bottom:          12,
                    zIndex:          9999,
                    padding:         '6px 10px',
                    fontSize:        11,
                    fontFamily:      'ui-monospace, SFMono-Regular, monospace',
                    background:      '#111827',
                    color:           '#fff',
                    border:          '1px solid #374151',
                    borderRadius:    4,
                    cursor:          'pointer',
                }}
            >
                a11ydebug · {stats.count} secs
                {parserStats && parserStats.warnings.length > 0 ? (
                    <span style={{ color: '#fbbf24', marginLeft: 6 }}>
                        ⚠{parserStats.warnings.length}
                    </span>
                ) : null}
            </button>
        );
    }

    return (
        <aside
            aria-hidden="true"
            style={{
                position:        'fixed',
                right:           12,
                bottom:          12,
                width:           320,
                maxHeight:       '50vh',
                zIndex:          9999,
                background:      'rgba(17, 24, 39, 0.96)',
                color:           '#e5e7eb',
                border:          '1px solid #374151',
                borderRadius:    4,
                fontSize:        11,
                lineHeight:      1.4,
                fontFamily:      'ui-monospace, SFMono-Regular, monospace',
                display:         'flex',
                flexDirection:   'column',
                overflow:        'hidden',
                boxShadow:       '0 8px 24px rgba(0, 0, 0, 0.4)',
            }}
        >
            <header
                style={{
                    padding:         '6px 10px',
                    background:      '#1f2937',
                    borderBottom:    '1px solid #374151',
                    display:         'flex',
                    justifyContent:  'space-between',
                    alignItems:      'center',
                }}
            >
                <span style={{ fontWeight: 600 }}>a11ydebug · segmentación</span>
                <button
                    type="button"
                    onClick={() => setCollapsed(true)}
                    style={{
                        background:   'transparent',
                        color:        '#9ca3af',
                        border:       'none',
                        cursor:       'pointer',
                        fontSize:     14,
                        lineHeight:   1,
                    }}
                    aria-label="Minimizar diagnóstico"
                >
                    ×
                </button>
            </header>

            <div style={{ padding: '6px 10px', borderBottom: '1px solid #374151', color: '#9ca3af' }}>
                <div style={{ color: '#a78bfa', fontWeight: 600, marginBottom: 2 }}>Segmentos</div>
                <div>secs: <strong style={{ color: '#fff' }}>{stats.count}</strong> · words: {stats.totalWords}</div>
                <div>avg/min/max: {stats.avg} / {stats.min} / {stats.max}</div>
                <div>oversize: <strong style={{ color: stats.oversize > 0 ? '#f87171' : '#10b981' }}>{stats.oversize}</strong></div>
            </div>

            {/* UX-4C — Parser stats. Solo se muestra si el libro trae el
                campo `parserStats` (libros parseados con a11y-parser-v2 o
                superior). Para libros legacy (sin el campo) el bloque se
                oculta — equivalente a 'unknown', no error. */}
            {parserStats && (
                <div style={{ padding: '6px 10px', borderBottom: '1px solid #374151', color: '#9ca3af' }}>
                    <div style={{ color: '#fbbf24', fontWeight: 600, marginBottom: 2 }}>
                        Parser <span style={{ color: '#6b7280', fontWeight: 400 }}>· {parserVersion ?? 'legacy'}</span>
                    </div>
                    <div>chapters: <strong style={{ color: '#fff' }}>{parserStats.chaptersCount}</strong> · paragraphs: <strong style={{ color: '#fff' }}>{parserStats.paragraphsCount}</strong></div>
                    <div>words: {parserStats.totalWords} · avg/max p: {parserStats.avgWordsPerParagraph} / {parserStats.maxWordsPerParagraph}</div>
                    <div>
                        oversize p (&gt;500w): <strong style={{ color: parserStats.oversizeParagraphsCount > 0 ? '#f87171' : '#10b981' }}>
                            {parserStats.oversizeParagraphsCount}
                        </strong>
                    </div>
                    <div style={{ marginTop: 2, color: '#6b7280', fontSize: 10 }}>
                        format: line={parserStats.detectedFormat.lineParagraphs} ·
                        wrap={parserStats.detectedFormat.wrappedParagraphs} ·
                        single={parserStats.detectedFormat.singleLine} ·
                        chap={parserStats.detectedFormat.chapterHeadings}
                    </div>
                    {parserStats.warnings.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                            {parserStats.warnings.map(w => (
                                <span
                                    key={w}
                                    title={WARNING_HINTS[w] ?? w}
                                    style={{
                                        display:      'inline-block',
                                        padding:      '1px 5px',
                                        marginRight:  4,
                                        marginBottom: 2,
                                        background:   '#7c2d12',
                                        color:        '#fed7aa',
                                        borderRadius: 2,
                                        fontSize:     9,
                                        cursor:       'help',
                                    }}
                                >
                                    {w}
                                </span>
                            ))}
                        </div>
                    )}
                    {parserStats.suspiciouslyLongParagraphs.length > 0 && (
                        <div style={{ marginTop: 4, color: '#fca5a5', fontSize: 10 }}>
                            top long:{' '}
                            {parserStats.suspiciouslyLongParagraphs.slice(0, 3).map(p => (
                                <span key={p.id} style={{ marginRight: 6 }}>
                                    {p.id}({p.words}w)
                                </span>
                            ))}
                        </div>
                    )}
                </div>
            )}

            <ol
                style={{
                    margin:    0,
                    padding:   0,
                    overflowY: 'auto',
                    flex:      1,
                    listStyle: 'none',
                }}
            >
                {segments.map((seg, idx) => {
                    const first    = paraIndex.get(seg.paragraphIds[0]);
                    const last     = paraIndex.get(seg.paragraphIds[seg.paragraphIds.length - 1]);
                    const isCurrent = idx === currentSegmentIndex;
                    const previewText = first ? preview(first.text, 80) : '(sin texto)';
                    return (
                        <li
                            key={seg.id}
                            style={{
                                padding:    '6px 10px',
                                borderBottom: '1px solid #1f2937',
                                background: isCurrent ? '#1e3a8a' : 'transparent',
                                color:      seg.oversize ? '#fca5a5' : (isCurrent ? '#fff' : '#d1d5db'),
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span><strong>#{idx + 1}</strong> · ch{seg.chapterIndex}</span>
                                <span>{seg.estimatedWords}w · {seg.paragraphIds.length}p{seg.oversize ? ' · OVS' : ''}</span>
                            </div>
                            <div style={{ color: '#9ca3af', fontSize: 10 }}>
                                {seg.paragraphIds[0]}{last && last !== first ? `…${seg.paragraphIds[seg.paragraphIds.length - 1]}` : ''}
                            </div>
                            <div style={{ marginTop: 2 }}>{previewText}</div>
                        </li>
                    );
                })}
            </ol>
        </aside>
    );
};

export default A11yDebugSegments;
