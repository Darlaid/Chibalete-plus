import React from 'react';
import ContentCard from '../ContentCard';
import { LibraryEmpty, LibraryError, LibraryLoading } from './LibraryLayerStates';
import { layerReferences, layerViewState, LIBRARY_ERROR_TEXT } from '../../utils/libraryLayers.mjs';

/**
 * PersonalLibraryTab — CHP-V6-LIBRARY-INSTITUTIONAL-01 / 11B-3 §§6-9, 11.
 *
 * «Mi biblioteca» es CURADURÍA, no propiedad: la selección personal de
 * contenidos que ya están disponibles para esta cuenta. Por eso el vocabulario
 * evita «mis libros», «comprados», «licencias» y cualquier otra palabra que
 * insinúe un ownership que no existe.
 *
 * FUENTE ÚNICA: `GET /api/library/personal`. La vista que llega ya es
 * `curaduría ∩ entitlement` (11B-2); aquí NO se vuelve a cruzar con roles,
 * grupos, organización ni my-catalog. La consecuencia directa es §11: si un
 * entitlement expira, el servidor deja de devolver esa referencia y el libro
 * desaparece — el cliente no puede resucitarlo desde caché porque no guarda
 * ninguna.
 *
 * Quitar una referencia NO borra el contenido, NO cambia el acceso, NO borra
 * progreso y NO afecta a Descargados.
 */

export type PersonalLibraryState = {
    status: 'idle' | 'loading' | 'ready' | 'error';
    view: { collections: any[]; unassigned: any[] } | null;
};

const PersonalLibraryTab: React.FC<{
    state: PersonalLibraryState;
    onRemove: (referenceId: string) => void;
    onExplore: () => void;
    onRetry: () => void;
    pendingReferenceId?: string | null;
    actionMessage?: string | null;
}> = ({ state, onRemove, onExplore, onRetry, pendingReferenceId, actionMessage }) => {
    const phase = layerViewState(state);

    if (phase === 'loading') return <LibraryLoading label="Cargando Mi biblioteca" />;
    if (phase === 'error') return <LibraryError message={LIBRARY_ERROR_TEXT.unavailable} onRetry={onRetry} />;
    if (phase === 'empty') {
        return (
            <LibraryEmpty
                title="Tu biblioteca está lista para llenarse"
                description="Aquí puedes guardar los libros disponibles en Chibalete+ que quieras tener más a mano."
                actionLabel="Explorar libros"
                onAction={onExplore}
            />
        );
    }

    const refs = layerReferences(state.view).filter((r: any) => r && r.book);

    return (
        <div className="animate-in fade-in duration-500 mt-8">
            {actionMessage && (
                <p className="mb-4 text-sm text-amber-700 dark:text-amber-300" role="alert">{actionMessage}</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 items-start">
                {refs.map((ref: any) => (
                    <div key={ref.id} className="relative">
                        <ContentCard content={ref.book} />
                        <button
                            type="button"
                            onClick={() => onRemove(ref.id)}
                            disabled={pendingReferenceId === ref.id}
                            title="Quitar de Mi biblioteca"
                            aria-label={`Quitar ${ref.book?.titulo ?? 'este libro'} de Mi biblioteca`}
                            className="absolute top-2 right-2 bg-gray-900/75 hover:bg-gray-900 text-white rounded-full px-3 py-1.5 text-xs font-bold shadow-md transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                        >
                            Quitar
                        </button>
                    </div>
                ))}
            </div>
            <p className="mt-8 text-xs text-gray-400 dark:text-gray-500">
                Quitar un libro de aquí no lo elimina de Chibalete+ ni cambia tu acceso ni tu progreso.
            </p>
        </div>
    );
};

export default PersonalLibraryTab;
