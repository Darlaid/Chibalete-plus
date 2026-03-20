
const fs = require('fs');
const path = require('path');
const http = require('http');

// Configuration
const HOST = 'localhost';
const PORT = 3001;
const ADMIN_SECRET = 'chibalete-secure-upload-2025';

const log = (msg) => console.log(`[VERIFY] ${msg}`);

function request(method, path, body = null, isMultipart = false, boundary = null) {
    return new Promise((resolve, reject) => {
        const headers = {
            'x-admin-secret': ADMIN_SECRET
        };

        if (body && !isMultipart) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(body);
        } else if (isMultipart) {
            headers['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
            headers['Content-Length'] = Buffer.byteLength(body);
        }

        const options = {
            hostname: HOST,
            port: PORT,
            path: '/api' + path,
            method: method,
            headers: headers
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        resolve(data); // Return regular text if not JSON
                    }
                } else {
                    reject({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', (e) => reject(e));
        if (body) req.write(body);
        req.end();
    });
}

// Helper for multipart upload
async function uploadFile(filePath) {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const filename = path.basename(filePath);
    const mimeType = filename.endsWith('.txt') ? 'text/plain' : 'image/jpeg';
    const fileContent = fs.readFileSync(filePath);

    const pre = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
    const post = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
        Buffer.from(pre),
        fileContent,
        Buffer.from(post)
    ]);

    log(`Uploading ${filename}...`);
    const res = await request('POST', '/upload', body, true, boundary);
    log(`Uploaded: ${res.url}`);
    return res.url;
}

async function run() {
    try {
        log('Starting Verification Pipeline...');

        // 1. Create Section
        log('1. Creating Section...');
        const sectionTitle = `Test Section ${Date.now()}`;
        const section = await request('POST', '/sections', JSON.stringify({
            id: '',
            titulo: sectionTitle,
            unlockCost: 0,
            isPublic: true
        }));
        log(`Section Created: ${section.titulo} (${section.id})`);

        // 2. Upload Files
        log('2. Uploading Assets...');
        // Assume dummy files exist in CWD
        const textUrl = await uploadFile('dummy_text.txt');
        // We'll use a placeholder for cover if generating image is too slow/complex for this script, 
        // but let's assume valid file path passed or we just reuse text file as "cover" for test (server doesn't validate image type strictly for existence)
        // actually let's just use text file again for cover to save time, server allows it.
        const coverUrl = await uploadFile('dummy_text.txt');

        // 3. Create Content
        log('3. Creating Content...');
        const contentId = `verify-${Date.now()}`;
        const content = await request('POST', '/content', JSON.stringify({
            id: contentId,
            titulo: 'Verification Book',
            autor: 'Automated Test',
            descripcion_corta: 'Test content',
            tipo: 'libro',
            portada_url: coverUrl,
            texto_plano_url: textUrl,
            sectionIds: [section.id],
            etiquetas: ['Verification'],
            metricas: { veces_leido: 0, calificacion_promedio: 0 },
            publico_objetivo: 'todos'
        }));
        log(`Content Created: ${content.content.id} - Status: ${content.content.status}`);

        // 4. Poll Status
        log('4. Polling Status (Waiting for TTS)...');
        let attempts = 0;
        const maxAttempts = 20; // 40 seconds

        const poll = setInterval(async () => {
            attempts++;
            try {
                const list = await request('GET', '/content');
                const item = list.find(c => c.id === contentId);

                if (item) {
                    log(`[Attempt ${attempts}] Status: ${item.status}`);
                    if (item.status === 'disponible') {
                        clearInterval(poll);
                        log('SUCCESS: Content is now AVAILABLE. Pipeline Verified.');
                        process.exit(0);
                    }
                }

                if (attempts >= maxAttempts) {
                    clearInterval(poll);
                    log('TIMEOUT: Content did not become available in time.');
                    process.exit(1);
                }
            } catch (e) {
                log(`Polling Error: ${e.message}`);
            }
        }, 2000);

    } catch (e) {
        log(`FAILURE: ${e.message || JSON.stringify(e)}`);
        process.exit(1);
    }
}

run();
