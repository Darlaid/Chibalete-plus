import React, { useState } from 'react';
import ContentCard from '../ContentCard';
import { LibraryEmpty, LibraryError, LibraryLoading } from './LibraryLayerStates';
import { layerViewState, LIBRARY_ERROR_TEXT } from '../../utils/libraryLayers.mjs';
import { Eye, EyeOff, Plus } from 'lucide-react';

/**
 * InstitutionalLibraryTab — CHP-V6-LIBRARY-INSTITUTIONAL-01 / 11B-3 §§12-19.
 *
 * La biblioteca institucional es CURADURÍA COMÚN, no entitlement. De ahí la
 * consecuencia que §18 declara esperada y que aquí se asume sin disculparse:
 * un mediador puede añadir un libro a la curaduría y un lector de su misma
 * organización puede no verlo, porque el servidor intersecta la curaduría con
 * el entitlement de CADA lector. No es una inconsistencia: es el contrato.
 *
 * FUENTE ÚNICA: `GET /api/library/institutional`. La UI no filtra entitlement.
 *
 * AUTORIDAD (§15): `canManage` decide únicamente si se DIBUJAN los controles.
 * No autoriza nada. El backend responde 403 pase lo que pase aquí, y ante la
 * duda se muestra lectura, no gestión. Por eso, cuando una escritura falla, la
 * UI muestra el error del servidor en vez de presumir éxito (§IUI6).
 *
 * FUENTE PARA CURAR (§17): `catalog` es el conjunto autorizado del propio
 * actor (my-catalog), nunca el catálogo general. El mediador no puede ni
 * ofrecerse a curar algo fuera de su propio entitlement.
 */

export type InstitutionalLibraryState = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    view: { collections: any[]; unassigned: any[] } | null;
};

const AddBookControl: React.FC<{
    catalog: { id: string; titulo: string }[];
    onAdd: (bookId: string) => void;
    label: string;
}> = ({ catalog, onAdd, label }) => {
    const [selected, setSelected] = useState('');
    if (catalog.length === 0) return null;
    return (
        <div className="flex flex-wrap items-center gap-2 mt-4">
            <label className="sr-only" htmlFor={`add-${label}`}>{label}</label>
            <select
                id={`add-${label}`}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm max-w-xs"
            >
                <option value="">Elige un libro…</option>
                {catalog.map(c => <option key={c.id} value={c.id}>{c.titulo}</option>)}
            </select>
            <button
                type="button"
                disabled={!selected}
                onClick={() => { onAdd(selected); setSelected(''); }}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700"
            >
                <Plus size={16} /> Añadir
            </button>
        </div>
    );
};

const NewCollectionControl: React.FC<{ onCreate: (name: string) => void }> = ({ onCreate }) => {
    const [name, setName] = useState('');
    return (
        <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="new-institutional-collection">Nombre de la colección</label>
            <input
                id="new-institutional-collection"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nombre de la colección"
                className="px-4 py-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm"
            />
            <button
                type="button"
                disabled={!name.trim()}
                onClick={() => { onCreate(name.trim()); setName(''); }}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold disabled:opacity-40 hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700"
            >
                <Plus size={16} /> Crear colección
            </button>
        </div>
    );
};

const InstitutionalLibraryTab: React.FC<{
    state: InstitutionalLibraryState;
    canManage: boolean;
    catalog: { id: string; titulo: string }[];
    actionMessage?: string | null;
    onRetry: () => void;
    onCreateCollection: (name: string) => void;
    onTogglePublished: (collectionId: string, published: boolean) => void;
    onAddReference: (bookId: string, collectionId: string | null) => void;
    onRemoveReference: (referenceId: string) => void;
}> = ({ state, canManage, catalog, actionMessage, onRetry, onCreateCollection, onTogglePublished, onAddReference, onRemoveReference }) => {
    const phase = layerViewState(state);

    if (phase === 'loading') return <LibraryLoading label="Cargando la biblioteca institucional" />;
    if (phase === 'error') return <LibraryError message={LIBRARY_ERROR_TEXT.unavailable} onRetry={onRetry} />;

    const notice = actionMessage
        ? <p className="mb-4 text-sm text-amber-700 dark:text-amber-300" role="alert">{actionMessage}</p>
        : null;

    if (phase === 'empty') {
        // §13/§14 — un empty state NEUTRO. No distingue «tu cuenta no tiene
        // organización» de «tu organización aún no ha organizado nada», y no
        // nombra organizaciones, grupos ni identificadores de ningún tipo.
        return (
            <div className="mt-8">
                {notice}
                <LibraryEmpty
                    title="Aún no hay una biblioteca institucional que mostrar"
                    description="Cuando tu institución organice sus lecturas, aparecerán aquí."
                >
                    {canManage && (
                        <div className="mt-8">
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                                Puedes empezar a organizarla creando una colección.
                            </p>
                            <NewCollectionControl onCreate={onCreateCollection} />
                        </div>
                    )}
                </LibraryEmpty>
            </div>
        );
    }

    const view = state.view!;
    const withBook = (refs: any[]) => (refs ?? []).filter((r: any) => r && r.book);

    return (
        <div className="animate-in fade-in duration-500 space-y-12 mt-8">
            {notice}

            {canManage && (
                <div className="rounded-2xl border border-dashed border-gray-200 dark:border-gray-700 p-5">
                    <h3 className="text-sm font-bold text-gray-700 dark:text-gray-200 mb-3">Organizar la biblioteca</h3>
                    <NewCollectionControl onCreate={onCreateCollection} />
                    <AddBookControl catalog={catalog} label="suelto" onAdd={(bookId) => onAddReference(bookId, null)} />
                    <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                        Añadir un libro aquí lo organiza para tu institución. No concede acceso:
                        cada lector lo verá solo si ya tiene acceso a ese libro.
                    </p>
                </div>
            )}

            {view.collections.map((col: any) => (
                <div key={col.id}>
                    <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">{col.name}</h3>
                        {canManage && (
                            <button
                                type="button"
                                onClick={() => onTogglePublished(col.id, !col.published)}
                                className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700"
                            >
                                {col.published ? <><Eye size={14} /> Visible</> : <><EyeOff size={14} /> Borrador</>}
                            </button>
                        )}
                    </div>
                    {col.description && <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{col.description}</p>}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 mt-4 items-start">
                        {withBook(col.references).map((ref: any) => (
                            <div key={ref.id} className="relative">
                                <ContentCard content={ref.book} />
                                {canManage && (
                                    <button
                                        type="button"
                                        onClick={() => onRemoveReference(ref.id)}
                                        aria-label={`Quitar ${ref.book?.titulo ?? 'este libro'} de la biblioteca institucional`}
                                        className="absolute top-2 right-2 bg-gray-900/75 hover:bg-gray-900 text-white rounded-full px-3 py-1.5 text-xs font-bold shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                                    >
                                        Quitar
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                    {canManage && (
                        <AddBookControl catalog={catalog} label={col.id} onAdd={(bookId) => onAddReference(bookId, col.id)} />
                    )}
                </div>
            ))}

            {withBook(view.unassigned).length > 0 && (
                <div>
                    <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-4">Otras lecturas de la institución</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 items-start">
                        {withBook(view.unassigned).map((ref: any) => (
                            <div key={ref.id} className="relative">
                                <ContentCard content={ref.book} />
                                {canManage && (
                                    <button
                                        type="button"
                                        onClick={() => onRemoveReference(ref.id)}
                                        aria-label={`Quitar ${ref.book?.titulo ?? 'este libro'} de la biblioteca institucional`}
                                        className="absolute top-2 right-2 bg-gray-900/75 hover:bg-gray-900 text-white rounded-full px-3 py-1.5 text-xs font-bold shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                                    >
                                        Quitar
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default InstitutionalLibraryTab;
