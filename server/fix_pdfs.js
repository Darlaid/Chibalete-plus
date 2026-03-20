import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Minimal Valid PDF (Base64) - A single blank page
const VALID_PDF_BASE64 = "JVBERi0xLjcKCjEgMCBvYmogICUgZW50cnkgcG9pbnQKPDwKICAvVHlwZSAvQ2F0YWxvZwogIC9QYWdlcyAyIDAgUgo+PgplbmRvYmoKCjIgMCBvYmogICUgcGFnZXM9MQo8PAogIC9UeXBlIC9QYWdlcwogIC9LaWRzIFsgMyAwIFIgXQogIC9Db3VudCAxCj4+CmVuZG9iagoKMyAwIG9iaiAgJSBwYWdlPTEKPDwKICAvVHlwZSAvUGFnZQogIC9QYXJlbnQgMiAwIFIKICAvTWVkaWFCb3ggWyAwIDAgNTAwIDgwMCBdCiAgL1Jlc291cmNlcyA8PAogICAgL0ZvbnQgPDwKICAgICAgL0YxIDQgMCBSC    +    I" // truncated for readability in this prompt, but I need the real full one.
// Let's use a simpler known valid one or constructs it safely.

// Actually, I can just use a helper to write the file directly in the script.
// Smallest Valid PDF:
const MINIMAL_PDF = Buffer.from(
    'JVBERi0xLjQKMSAwIG9iago8PC9UeXBlIC9DYXRhbG9nL1BhZ2VzIDIgMCBSPj4KZW5kb2JqCjIgMCBvYmoKPDwvVHlwZSAvUGFnZXMvS2lkc1szIDAgVl0vQ291bnQgMQo+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlIC9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNTk1IDg0Ml0vUmVzb3VyY2VzPDw+Pj4+CmVuZG9iagp4cmVmCjAgNAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTAgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTE3IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTk5CiUlRU9GCg==',
    'base64'
);

const paths = [
    'public/uploads/sim-book-1/book1.pdf',
    'public/uploads/sim-book-2/book2.pdf',
    'public/uploads/sim-book-3/book3.pdf'
];

paths.forEach(p => {
    const fullPath = path.join('d:/001 - app - Chibalete+', p);
    try {
        fs.writeFileSync(fullPath, MINIMAL_PDF);
        console.log(`Fixed: ${p}`);
    } catch (e) {
        console.error(`Error fixing ${p}:`, e);
    }
});
