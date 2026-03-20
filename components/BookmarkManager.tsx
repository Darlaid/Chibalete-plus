
import React, { useState } from 'react';
import { dataService } from '../services/dataService';
import type { Bookmark } from '../types';

const BookmarkManager: React.FC = () => {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => dataService.getBookmarks());
  const [newBookmarkName, setNewBookmarkName] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'image/png') {
        setError('El archivo debe ser de tipo PNG.');
        setSelectedFile(null);
        return;
      }
      
      // Simulate checking dimensions
      const img = new Image();
      img.src = URL.createObjectURL(file);
      img.onload = () => {
          if (img.width !== 600 || img.height !== 600) {
              setError('La imagen debe ser de 600x600 píxeles.');
              setSelectedFile(null);
              URL.revokeObjectURL(img.src);
          } else {
              setError('');
              setSelectedFile(file);
          }
      }
    }
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBookmarkName || !selectedFile) {
        setError('Todos los campos son obligatorios.');
        return;
    }
    setError('');
    
    // Simulate upload and adding to data service
    const newBookmark = dataService.addBookmark({
        nombre: newBookmarkName,
        imagen_url: URL.createObjectURL(selectedFile) // In a real app, this would be a URL from a storage service
    });

    setBookmarks(prev => [...prev, newBookmark]);
    setNewBookmarkName('');
    setSelectedFile(null);
    (e.target as HTMLFormElement).reset();
    setSuccess(`Marcador "${newBookmark.nombre}" añadido con éxito.`);
    setTimeout(() => setSuccess(''), 3000);
  };

  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-xl font-semibold mb-4">Marcadores Existentes</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {bookmarks.map(bm => (
            <div key={bm.id} className="text-center">
              <img src={bm.imagen_url} alt={bm.nombre} className="w-full aspect-square object-cover rounded-lg shadow-md" />
              <p className="mt-2 text-sm font-medium">{bm.nombre}</p>
            </div>
          ))}
        </div>
      </div>
      
      <div>
        <h3 className="text-xl font-semibold mb-4">Subir Nuevo Marcador</h3>
        <form onSubmit={handleSubmit} className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow space-y-4">
          <div>
            <label htmlFor="bookmark-name" className="block text-sm font-medium mb-1">Nombre del Marcador</label>
            <input 
                type="text" 
                id="bookmark-name" 
                value={newBookmarkName}
                onChange={e => setNewBookmarkName(e.target.value)}
                className="w-full p-2 border rounded-md bg-gray-50 dark:bg-gray-700 border-gray-300 dark:border-gray-600"
                required
            />
          </div>
          <div>
            <label htmlFor="bookmark-file" className="block text-sm font-medium mb-1">Archivo de Imagen (PNG, 600x600px)</label>
            <input 
                type="file" 
                id="bookmark-file" 
                accept="image/png"
                onChange={handleFileChange}
                className="w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                required
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          {success && <p className="text-green-500 text-sm">{success}</p>}
          <button type="submit" className="w-full py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Subir Marcador</button>
        </form>
      </div>
    </div>
  );
};

export default BookmarkManager;
