import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// CHP-CONTENT-CANONICAL-2026-01 3E.2 — el lector EPUB usa vendor/foliate-js
// solo como motor EPUB. Su `./pdf.js` (adaptador PDF experimental) construye
// rutas que Vite no puede empaquetar y arrastraría pdfjs: se resuelve a un stub
// SOLO cuando lo importa vendor/foliate-js/view.js. El vendor no se modifica.
const foliatePdfDisabled = (): Plugin => ({
  name: 'chp-foliate-pdf-disabled',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source === './pdf.js' && importer && importer.replace(/\\/g, '/').endsWith('/vendor/foliate-js/view.js')) {
      return path.resolve(__dirname, 'components/epub-reader/foliatePdfDisabled.mjs');
    }
    return null;
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    server: {
      port: 5173,
      host: '0.0.0.0',
      proxy: {
        '/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        },
        '/uploads': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          secure: false,
        }
      }
    },
    plugins: [react(), foliatePdfDisabled()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'ui-vendor': ['lucide-react'],
            'genai-vendor': ['@google/genai']
          }
        }
      }
    }
  };
});
