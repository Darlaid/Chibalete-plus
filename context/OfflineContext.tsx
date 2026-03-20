
import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import type { Content } from '../types';
import { offlineService } from '../services/offlineService';

const DOWNLOAD_LIMIT = 3;

interface OfflineContextType {
    downloadedContent: Content[];
    isDownloaded: (contentId: string) => boolean;
    downloadBook: (content: Content) => Promise<void>;
    removeBook: (contentId: string) => Promise<void>;
    isLoading: boolean;
    downloadLimit: number;
}

const OfflineContext = createContext<OfflineContextType | undefined>(undefined);

export const OfflineProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [downloadedContent, setDownloadedContent] = useState<Content[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const refreshDownloadedContent = useCallback(async () => {
        setIsLoading(true);
        try {
            const books = await offlineService.getDownloadedBooks();
            setDownloadedContent(books);
        } catch (error) {
            console.error("Failed to refresh offline content:", error);
            // If offline DB fails, we still let the app run with an empty list.
            setDownloadedContent([]);
        } finally {
            // This is critical to prevent the app from getting stuck on a loading screen.
            setIsLoading(false);
        }
    }, []);
    
    useEffect(() => {
        refreshDownloadedContent();
    }, [refreshDownloadedContent]);

    const isDownloaded = (contentId: string): boolean => {
        return downloadedContent.some(c => c.id === contentId);
    };

    const downloadBook = async (content: Content): Promise<void> => {
        if (downloadedContent.length >= DOWNLOAD_LIMIT) {
            alert('Has alcanzado el límite de 3 descargas. Por favor, elimina un libro para descargar otro.');
            return Promise.reject(new Error('Límite de descargas alcanzado.'));
        }

        try {
            const response = await fetch(content.url_recurso);
            if (!response.ok) {
                throw new Error('Error al descargar el archivo.');
            }
            const pdfData = await response.arrayBuffer();
            await offlineService.saveBook(content, pdfData);
            await refreshDownloadedContent();
        } catch (error) {
            console.error('Error en la descarga:', error);
            alert('No se pudo descargar el libro. Inténtalo de nuevo.');
            throw error;
        }
    };
    
    const removeBook = async (contentId: string): Promise<void> => {
        try {
            await offlineService.deleteBook(contentId);
            await refreshDownloadedContent();
        } catch(error) {
            console.error('Error al eliminar libro:', error);
            alert('No se pudo eliminar el libro. Inténtalo de nuevo.');
        }
    };

    return (
        <OfflineContext.Provider value={{ downloadedContent, isDownloaded, downloadBook, removeBook, isLoading, downloadLimit: DOWNLOAD_LIMIT }}>
            {children}
        </OfflineContext.Provider>
    );
};

export const useOffline = (): OfflineContextType => {
    const context = useContext(OfflineContext);
    if (context === undefined) {
        throw new Error('useOffline must be used within an OfflineProvider');
    }
    return context;
};
