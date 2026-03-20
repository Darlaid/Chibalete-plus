import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Boundary for multipart data
const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

const postDataHead =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="parentId"\r\n\r\n` +
    `content-test-123\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="test-image.png"\r\n` +
    `Content-Type: image/png\r\n\r\n`;

const postDataTail = `\r\n--${boundary}--\r\n`;

// Create a dummy image buffer (small 1x1 png)
const imageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

const options = {
    hostname: 'localhost',
    port: 3001,
    path: '/api/upload?parentId=content-test-123',
    method: 'POST',
    headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'x-admin-secret': 'chibalete-secure-upload-2025',
        'Content-Length': Buffer.byteLength(postDataHead) + imageBuffer.length + Buffer.byteLength(postDataTail)
    }
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        console.log('Response Status:', res.statusCode);
        console.log('Response Body:', data);
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

// Write data
req.write(postDataHead);
req.write(imageBuffer);
req.write(postDataTail);
req.end();
