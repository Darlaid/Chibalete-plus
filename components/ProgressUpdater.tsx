
import React, { useState } from 'react';
import type { Content } from '../types';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { X } from 'lucide-react';

interface ProgressUpdaterProps {
  content: Content;
  onClose: (shouldRefresh: boolean) => void;
}

const ProgressUpdater: React.FC<ProgressUpdaterProps> = ({ content, onClose }) => {
  const { user } = useAuth();
  const [page, setPage] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pageNum = parseInt(page, 10);
    const totalPages = content.numero_paginas || 1;

    if (!user || isNaN(pageNum) || pageNum < 1 || pageNum > totalPages) {
      setError(`Por favor, introduce un número de página válido (1-${totalPages}).`);
      return;
    }
    
    setError('');
    dataService.updateProgreso(user.id, content.id, pageNum, totalPages);
    onClose(true);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Actualizar Progreso</h3>
          <button onClick={() => onClose(false)} className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
          Estás actualizando: <strong>{content.titulo}</strong>
        </p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="page-number" className="block text-sm font-medium mb-1">
            ¿En qué página vas? (de {content.numero_paginas || '?'})
          </label>
          <input
            type="number"
            id="page-number"
            value={page}
            onChange={(e) => setPage(e.target.value)}
            min="1"
            max={content.numero_paginas}
            className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600 focus:ring-indigo-500"
            required
            autoFocus
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
          <div className="mt-6 flex justify-end space-x-2">
            <button type="button" onClick={() => onClose(false)} className="px-4 py-2 rounded-md bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500">
              Cancelar
            </button>
            <button type="submit" className="px-4 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
              Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ProgressUpdater;
