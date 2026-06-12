
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initMediaBaseUrl } from './utils/mediaBaseUrl';

// M3.1 — Fire-and-forget bootstrap del CDN base URL.
// Si /api/runtime-config no responde o mediaBaseUrl es null/vacío,
// las URLs /uploads/ siguen funcionando relativas vía VPS edge (default).
// NO bloquea el render.
initMediaBaseUrl();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
