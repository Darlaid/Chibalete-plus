import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Node 18+ has native fetch and FormData
// But native FormData in Node might require 'undici' or similar in some versions?
// Actually, 'content-type': 'multipart/form-data' with fetch requires a Boundary. 
// Using 'formData' object with fetch automatically sets boundary.
// Node's native 'FormData' was added recently. If not available, we need 'undici' or different approach.
// Let's check if FormData is global.

const PORT = 3001;
const API_BASE = `http://127.0.0.1:${PORT}/api`;

async function uploadFile(filename, content, contentType, parentId) {
    const boundary = '----WebKitFormBoundaryFetch';
    const pre = `--${boundary}\r\nContent-Disposition: form-data; name="parentId"\r\n\r\n${parentId}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`;
    const post = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
        Buffer.from(pre),
        Buffer.isBuffer(content) ? content : Buffer.from(content),
        Buffer.from(post)
    ]);

    const start = Date.now();
    const res = await fetch(`${API_BASE}/upload?parentId=${parentId}`, {
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'x-admin-secret': 'chibalete-secure-upload-2025'
        },
        body: body
    });

    const duration = Date.now() - start;
    if (!res.ok) {
        throw new Error(`Upload Failed: ${res.status} ${await res.text()}`);
    }
    const json = await res.json();
    return { ...json, duration };
}

async function saveContent(metadata) {
    const res = await fetch(`${API_BASE}/content`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': 'chibalete-secure-upload-2025'
        },
        body: JSON.stringify(metadata)
    });
    if (!res.ok) throw new Error(`Save Failed: ${res.status}`);
    return await res.json();
}

async function run() {
    console.log('--- STARTING SIMULATION (FETCH) ---');
    try {
        // Book 1
        console.log('Uploading Book 1...');
        const res1 = await uploadFile('book1.pdf', Buffer.from('%PDF 1.4'), 'application/pdf', 'sim-book-1');
        console.log(` > Book 1 PDF: ${res1.url}`);
        await saveContent({
            id: 'sim-book-1', titulo: 'Book 1 PDF', tipo: 'libro', editorial: 'Chibalete',
            url_recurso: res1.url, descripcion_corta: 'Desc', portada_url: '', etiquetas: [], metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos'
        });

        // Book 2
        console.log('Uploading Book 2...');
        const res2a = await uploadFile('book2.pdf', Buffer.from('%PDF 1.4'), 'application/pdf', 'sim-book-2');
        const res2b = await uploadFile('book2.txt', 'Accessible Text', 'text/plain', 'sim-book-2');
        console.log(` > Book 2 PDF: ${res2a.url}`);
        console.log(` > Book 2 TXT: ${res2b.url}`);
        await saveContent({
            id: 'sim-book-2', titulo: 'Book 2 Accessible', tipo: 'libro', editorial: 'Aliada X',
            url_recurso: res2a.url, texto_plano_url: res2b.url, descripcion_corta: 'Desc', portada_url: '', etiquetas: [], metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos'
        });

        // Book 3
        console.log('Uploading Book 3...');
        const res3a = await uploadFile('book3.pdf', Buffer.from('%PDF 1.4'), 'application/pdf', 'sim-book-3');
        const res3b = await uploadFile('book3.txt', 'Rich Text', 'text/plain', 'sim-book-3');
        const res3c = await uploadFile('cover.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'), 'image/png', 'sim-book-3');
        console.log(` > Book 3 All: ${res3a.url}, ${res3b.url}, ${res3c.url}`);
        await saveContent({
            id: 'sim-book-3', titulo: 'Book 3 Rich', tipo: 'libro', editorial: 'Comunidad',
            url_recurso: res3a.url, texto_plano_url: res3b.url, portada_url: res3c.url, descripcion_corta: 'Desc', etiquetas: [], metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos'
        });

        console.log('--- SIMULATION SUCCESS ---');
    } catch (e) {
        console.error('SIMULATION ERROR:', e);
    }
}

run();
