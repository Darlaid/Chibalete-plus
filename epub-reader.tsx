// CHP-CONTENT-CANONICAL-2026-01 3E.3 — entrada del lector EPUB (epub-reader.html).
// Independiente de la SPA principal: su propio bundle, su propia CSP.
import React from 'react';
import ReactDOM from 'react-dom/client';
import './components/epub-reader/epubReader.css';
import EpubReaderApp from './components/epub-reader/EpubReaderApp';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
        <EpubReaderApp />
    </React.StrictMode>
);
