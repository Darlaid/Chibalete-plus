
import React, { useState, useEffect } from 'react';
import { dataService } from '../services/dataService';
import ContentCard from '../components/ContentCard';
import type { Content } from '../types';
import { useAuth } from '../context/AuthContext';
import { Search as SearchIcon } from 'lucide-react';

const SearchResults: React.FC<{ results: Content[] }> = ({ results }) => {
    const chibaleteLibros = results.filter(c => c.editorial === 'Chibalete' && c.tipo === 'libro');
    const chibaleteMedia = results.filter(c => c.editorial === 'Chibalete' && (c.tipo === 'video' || c.tipo === 'podcast'));
    const aliadas = results.filter(c => c.editorial === 'Aliada X');
    const comunidad = results.filter(c => c.editorial === 'Comunidad');

    return (
        <div className="space-y-8">
            {chibaleteLibros.length > 0 && <SearchResultsGroup title="Libros del sello Chibalete" items={chibaleteLibros} />}
            {chibaleteMedia.length > 0 && <SearchResultsGroup title="Videos y podcasts de Chibalete" items={chibaleteMedia} />}
            {aliadas.length > 0 && <SearchResultsGroup title="Contenidos de editoriales aliadas" items={aliadas} />}
            {comunidad.length > 0 && <SearchResultsGroup title="Obras de la comunidad de escritores" items={comunidad} />}
        </div>
    );
};

const SearchResultsGroup: React.FC<{ title: string; items: Content[] }> = ({ title, items }) => (
    <section>
        <h2 className="text-xl font-bold mb-4">{title}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {items.map(item => <ContentCard key={item.id} content={item} />)}
        </div>
    </section>
);


const Busqueda: React.FC = () => {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Content[]>([]);
  const [hasSearched, setHasSearched] = useState(false);

  // Debounce Logic
  useEffect(() => {
      const delayDebounceFn = setTimeout(() => {
          if (query.length > 2 && user) {
              setResults(dataService.buscarContenido(query, user.roles));
              setHasSearched(true);
          } else if (query.length === 0) {
              setResults([]);
              setHasSearched(false);
          }
      }, 300); // Wait 300ms after user stops typing

      return () => clearTimeout(delayDebounceFn);
  }, [query, user]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
  };
  
  const handleTrendClick = (trend: string) => {
    setQuery(trend);
    // Immediate search for clicks
    if(user) {
        setResults(dataService.buscarContenido(trend, user.roles));
        setHasSearched(true);
    }
  }

  const tendencias = ['Ciencia Ficción', 'Misterio', 'Historia', 'Tecnología'];

  return (
    <div className="p-4 md:p-8">
      <h1 className="text-3xl font-bold mb-6">Buscar</h1>
      <div className="relative mb-8">
        <input
          type="text"
          placeholder="Busca en todo Chibalete+"
          value={query}
          onChange={handleSearchChange}
          className="w-full pl-12 pr-4 py-4 text-lg rounded-full bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm"
        />
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 w-6 h-6" />
      </div>
      
      {!hasSearched && (
        <div>
          <h2 className="text-xl font-bold mb-4">Tendencias</h2>
          <div className="flex flex-wrap gap-2">
            {tendencias.map(t => (
                <button key={t} onClick={() => handleTrendClick(t)} className="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded-full hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors">
                    {t}
                </button>
            ))}
          </div>
        </div>
      )}

      {hasSearched && results.length > 0 && <SearchResults results={results} />}
      {hasSearched && results.length === 0 && query.length > 2 && <p className="text-gray-500 text-center mt-8">No se encontraron resultados para "{query}".</p>}

    </div>
  );
};

export default Busqueda;
