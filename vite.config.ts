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

// CHP-CONTENT-CANONICAL-2026-01 3E.3 — CSP específica de la entrada del lector
// EPUB (no de la SPA). Solo en build: en dev el preámbulo inline de React Refresh
// la rompería. Los documentos blob: del libro heredan esta política, así que
// ningún script del EPUB puede ejecutarse (script-src 'self', sin blob:).
export const EPUB_READER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' blob: https://fonts.googleapis.com",
  "img-src 'self' blob: data:",
  "font-src 'self' blob: data: https://fonts.gstatic.com",
  "connect-src 'self' blob: data:",
  "frame-src blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const epubReaderCsp = (): Plugin => ({
  name: 'chp-epub-reader-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler(html, ctx) {
      if (!ctx.filename.replace(/\\/g, '/').endsWith('/epub-reader.html')) return html;
      return html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${EPUB_READER_CSP}" />`);
    },
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
    plugins: [react(), foliatePdfDisabled(), epubReaderCsp()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    },
    build: {
      rollupOptions: {
        // 3E.3: la SPA y el lector EPUB son entradas separadas (foliate nunca
        // entra en el bundle de la SPA).
        input: {
          index: path.resolve(__dirname, 'index.html'),
          'epub-reader': path.resolve(__dirname, 'epub-reader.html'),
        },
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
