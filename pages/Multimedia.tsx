
import React, { useState, useEffect } from 'react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import ContentCard from '../components/ContentCard';
import type { Content } from '../types';
import { Search, PlayCircle, Mic, FileText, Layers } from 'lucide-react';

const Multimedia: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('todos');
  const [mediaContent, setMediaContent] = useState<Content[]>([]);

  useEffect(() => {
    if (user) {
      const allContent = dataService.getContenidos(user.roles, user.id);
      // Filter out 'libro' to show only multimedia and resources
      const multimedia = allContent.filter(c => ['video', 'podcast', 'guia', 'actividad'].includes(c.tipo));
      setMediaContent(multimedia);
    }
  }, [user]);
  
  const handleTabChange = (tab: string) => {
      setActiveTab(tab);
  };
  
  const TabButton: React.FC<{tab: string, label: string, icon: React.ReactNode}> = ({ tab, label, icon }) => (
      <button 
          onClick={() => handleTabChange(tab)}
          className={`flex items-center px-4 py-2 font-semibold rounded-full text-sm transition-colors ${activeTab === tab ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
      >
          <span className="mr-2">{icon}</span>
          {label}
      </button>
  );

  const renderContent = () => {
    let items = mediaContent;

    if (activeTab !== 'todos') {
        items = mediaContent.filter(c => {
            if (activeTab === 'videos') return c.tipo === 'video';
            if (activeTab === 'podcasts') return c.tipo === 'podcast';
            if (activeTab === 'recursos') return c.tipo === 'guia' || c.tipo === 'actividad';
            return true;
        });
    }
    
    if (items.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-gray-500">
                <PlayCircle size={48} className="mb-4 opacity-20"/>
                <p>No hay contenido multimedia disponible en esta categoría.</p>
            </div>
        )
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-8">
            {items.map(content => (
                <ContentCard key={content.id} content={content} />
            ))}
        </div>
    )
  };

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center mb-6">
        <div className="p-3 bg-indigo-100 dark:bg-indigo-900 rounded-full mr-4">
            <PlayCircle className="text-indigo-600 dark:text-indigo-400" size={32}/>
        </div>
        <div>
            <h1 className="text-3xl font-bold">Multimedia y Recursos</h1>
            <p className="text-gray-500 dark:text-gray-400">Explora videos, audios y guías interactivas.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pb-2">
        <TabButton tab="todos" label="Todo" icon={<Layers size={16}/>} />
        <TabButton tab="videos" label="Videos" icon={<PlayCircle size={16}/>} />
        <TabButton tab="podcasts" label="Podcasts" icon={<Mic size={16}/>} />
        <TabButton tab="recursos" label="Guías y Actividades" icon={<FileText size={16}/>} />
      </div>
      
      {renderContent()}

    </div>
  );
};

export default Multimedia;
