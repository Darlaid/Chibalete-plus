/**
 * PublisherCatalogPanel — PLAN-EDITORIALES-INFORMES-01 / EDITORIALES-CATALOGO-01.
 *
 * «Catálogo editorial» dentro de la ficha de una editorial (/admin/editoriales).
 * Libros agrupados por sello (utils/publisherCatalog.mjs) sobre el catálogo
 * canónico; cada libro abre sus fichas administrativas existentes (editor de
 * /subir-contenido y derechos). Solo lectura: refleja la atribución ACTUAL
 * (editorial y sello de hoy), no la de cierres históricos.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, ChevronDown, ChevronRight, Edit2, Scale, X } from 'lucide-react';
import type { Content, Publisher } from '../../types';
import { publisherCatalog, isbnOf } from '../../utils/publisherCatalog.mjs';

const STATUS_LABEL: Record<string, string> = { disponible: 'Disponible', procesando: 'Procesando', error: 'Con error' };
const STATUS_STYLE: Record<string, string> = {
    disponible: 'bg-green-100 text-green-800', procesando: 'bg-amber-100 text-amber-800', error: 'bg-red-100 text-red-800',
};

const PublisherCatalogPanel: React.FC<{ publisher: Publisher; contents: Content[] | null; onClose: () => void }> = ({ publisher, contents, onClose }) => {
    const catalog = useMemo(() => (contents ? publisherCatalog(contents, publisher) : null), [contents, publisher]);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const name = publisher.tradeName || publisher.legalName;
    const headingRef = useRef<HTMLHeadingElement>(null);
    // Al abrir otra editorial, el panel (arriba de la tabla) recibe el foco y queda a la vista.
    useEffect(() => { headingRef.current?.focus(); headingRef.current?.scrollIntoView({ block: 'start' }); }, [publisher.id]);
    const toggle = (key: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

    return (
        <section aria-labelledby="ed-catalogo-title" className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 md:p-6 min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div className="min-w-0">
                    <h2 id="ed-catalogo-title" ref={headingRef} tabIndex={-1} className="text-lg font-bold flex items-center focus:outline-none"><BookOpen size={18} className="mr-2" aria-hidden="true" /> Catálogo editorial · {name}</h2>
                    {catalog && (
                        <p className="text-sm text-gray-600 dark:text-gray-300">
                            <strong>{catalog.books}</strong> {catalog.books === 1 ? 'libro' : 'libros'}
                            {catalog.resources > 0 && (
                                <> · <Link to={`/subir-contenido?editorial=${encodeURIComponent(publisher.id)}&clase=recursos`} className="underline">
                                    {catalog.resources} {catalog.resources === 1 ? 'recurso asociado' : 'recursos asociados'}</Link> (no se cuentan como libros)</>
                            )}
                        </p>
                    )}
                    <p className="text-xs text-gray-500">Atribución actual del catálogo: editorial responsable y sello de cada obra hoy. Los informes de cierres conservan la del periodo.</p>
                </div>
                <button type="button" onClick={onClose} aria-label="Cerrar catálogo" className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700"><X size={18} /></button>
            </div>

            {!catalog ? <p className="text-gray-500">Cargando catálogo…</p> : (
                <>
                    {publisher.bookCount != null && publisher.bookCount !== catalog.books && (
                        <p role="status" className="mb-3 p-2 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm">
                            El registro de editoriales cuenta {publisher.bookCount} libros y el catálogo cargado {catalog.books}. Recarga la página para sincronizar.
                        </p>
                    )}
                    {catalog.books === 0 && <p className="mb-3 text-sm text-gray-500">Esta editorial todavía no tiene libros asociados.</p>}
                    <div className="space-y-3">
                        {catalog.groups.map((g) => {
                            const open = !collapsed.has(g.key);
                            const label = g.imprint ?? 'Sin sello asignado';
                            const panelId = `ed-sello-${encodeURIComponent(g.key)}`;
                            return (
                                <div key={g.key} className="border border-gray-200 dark:border-gray-700 rounded-lg">
                                    <button type="button" aria-expanded={open} aria-controls={panelId} onClick={() => toggle(g.key)}
                                        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                                        <span className="flex items-center font-semibold min-w-0">
                                            {open ? <ChevronDown size={16} className="mr-1 shrink-0" aria-hidden="true" /> : <ChevronRight size={16} className="mr-1 shrink-0" aria-hidden="true" />}
                                            <span className="truncate">{label}</span>
                                            {!g.registered && <span className="ml-2 text-xs font-normal text-amber-700">(no figura en los sellos de la editorial)</span>}
                                        </span>
                                        <span className="text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">{g.books.length} {g.books.length === 1 ? 'título' : 'títulos'}</span>
                                    </button>
                                    {open && (
                                        <div id={panelId}>
                                            {g.books.length === 0 ? (
                                                <p className="px-3 py-2 text-sm text-gray-500">{g.imprint ? 'Sello registrado sin títulos.' : 'Todos los libros tienen sello.'}</p>
                                            ) : (
                                                <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                                                    {g.books.map((b: Content) => {
                                                        const isbn = isbnOf(b);
                                                        return (
                                                            <li key={b.id} className="flex flex-wrap items-start gap-3 px-3 py-2">
                                                                {b.portada_url
                                                                    ? <img src={b.portada_url} alt="" loading="lazy" className="w-10 h-14 object-cover rounded bg-gray-100 shrink-0" />
                                                                    : <div className="w-10 h-14 rounded bg-gray-100 dark:bg-gray-700 shrink-0" aria-hidden="true" />}
                                                                <div className="min-w-0 flex-1 basis-48">
                                                                    <p className="font-medium text-gray-900 dark:text-gray-100 break-words">{b.titulo || b.id}</p>
                                                                    <p className="text-xs text-gray-600 dark:text-gray-300">{b.autor || 'Autoría sin registrar'}</p>
                                                                    <p className="text-xs text-gray-500 break-all">
                                                                        {isbn ? <>ISBN {isbn}</> : <>Sin ISBN</>} · <span className="font-mono">ID {b.id}</span>
                                                                        {b.tipo === 'libro_album' && <> · Libro álbum</>}
                                                                    </p>
                                                                </div>
                                                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLE[b.status as string] || 'bg-gray-200 text-gray-700'}`}>
                                                                    {STATUS_LABEL[b.status as string] ?? (b.status || 'Sin estado')}
                                                                </span>
                                                                <span className="flex flex-wrap gap-2 text-sm">
                                                                    <Link to={`/subir-contenido?editar=${encodeURIComponent(b.id)}`} className="inline-flex items-center text-indigo-600 dark:text-indigo-400 hover:underline"
                                                                        aria-label={`Abrir la ficha de ${b.titulo || b.id}`}><Edit2 size={14} className="mr-1" aria-hidden="true" /> Ficha</Link>
                                                                    <Link to={`/admin/derechos/${encodeURIComponent(b.id)}`} className="inline-flex items-center text-indigo-600 dark:text-indigo-400 hover:underline"
                                                                        aria-label={`Derechos de ${b.titulo || b.id}`}><Scale size={14} className="mr-1" aria-hidden="true" /> Derechos</Link>
                                                                </span>
                                                            </li>
                                                        );
                                                    })}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <p className="mt-3 text-xs text-gray-500">El sello se asigna en la ficha de cada libro («Ficha»); los sellos de la editorial, con «Editar».</p>
                </>
            )}
        </section>
    );
};

export default PublisherCatalogPanel;
