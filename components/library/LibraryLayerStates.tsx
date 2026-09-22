import React from 'react';
import { AlertCircle, Library } from 'lucide-react';

/**
 * LibraryLayerStates — CHP-V6-LIBRARY-INSTITUTIONAL-01 / 11B-3 §24.
 *
 * Los cuatro estados de una pestaña de Biblioteca son DISTINTOS y se dibujan
 * distinto. En particular LOADING nunca se dibuja como EMPTY: anunciar «no hay
 * nada» mientras la respuesta está en vuelo es mentirle al usuario, y en la
 * capa PERSONAL —que en producción arranca vacía— sería además indistinguible
 * del estado real.
 *
 * El estado ERROR jamás ofrece una alternativa: no hay «ver el catálogo
 * mientras tanto». Degradar a otra fuente reintroduciría una política de
 * acceso en el navegador (§23, fail closed).
 */

export const LibraryLoading: React.FC<{ label: string }> = ({ label }) => (
    <div className="animate-in fade-in duration-300 mt-8" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">{label}</span>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                    <div className="bg-gray-200 dark:bg-gray-700 rounded-xl aspect-[2/3] mb-3" />
                    <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
                    <div className="h-3 bg-gray-100 dark:bg-gray-800 rounded w-1/2" />
                </div>
            ))}
        </div>
    </div>
);

export const LibraryError: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
    <div className="flex flex-col items-center justify-center py-20 text-center" role="alert">
        <AlertCircle size={44} className="mb-4 text-amber-500 opacity-70" />
        <p className="text-gray-600 dark:text-gray-300 max-w-md">{message}</p>
        {onRetry && (
            <button
                type="button"
                onClick={onRetry}
                className="mt-5 px-5 py-2.5 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-bold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700"
            >
                Reintentar
            </button>
        )}
    </div>
);

export const LibraryEmpty: React.FC<{
    title: string;
    description: string;
    actionLabel?: string;
    onAction?: () => void;
    children?: React.ReactNode;
}> = ({ title, description, actionLabel, onAction, children }) => (
    <div className="flex flex-col items-center justify-center py-20 text-center">
        <Library size={44} className="mb-4 text-gray-300 dark:text-gray-600" />
        <h3 className="text-lg font-bold text-gray-700 dark:text-gray-200">{title}</h3>
        <p className="mt-2 text-gray-500 dark:text-gray-400 max-w-md">{description}</p>
        {actionLabel && onAction && (
            <button
                type="button"
                onClick={onAction}
                className="mt-6 px-5 py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-md shadow-indigo-500/30 hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-700 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-900"
            >
                {actionLabel}
            </button>
        )}
        {children}
    </div>
);
