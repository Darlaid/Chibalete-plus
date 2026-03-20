
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '../data/users_db.json');

const ADMIN_SECRET = 'chibalete-secure-upload-2025';
const API_URL = 'http://localhost:3001/api';

async function testPersistence() {
    console.log('--- STARTING PERSISTENCE TEST ---');

    console.log(`Checking DB file at: ${DB_PATH}`);
    if (!fs.existsSync(DB_PATH)) {
        console.error('DB File not found!');
        process.exit(1);
    }

    const testUser = {
        id: `user-${Date.now()}`,
        email: `test_persist_${Date.now()}@example.com`,
        nombre_completo: 'Test Persistence User',
        password: 'password123',
        roles: ['admin']
    };

    try {
        // 1. CREATE USER
        console.log('1. Attempting to create user via API...');
        const createRes = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-secret': ADMIN_SECRET
            },
            body: JSON.stringify(testUser)
        });

        if (!createRes.ok) {
            const err = await createRes.text();
            throw new Error(`Create failed: ${createRes.status} ${err}`);
        }
        const createdUser = await createRes.json();
        console.log('   User created successfully via API:', createdUser.id);

        // 2. VERIFY IN FILE
        console.log('2. Verifying persistence in JSON file...');
        // allow a window for file write and potential server restart (nodemon)
        await new Promise(r => setTimeout(r, 4000));

        const fileContent = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        const foundInFile = fileContent.find(u => u.id === createdUser.id);

        if (foundInFile) {
            console.log('   STRICT PERSISTENCE CHECK PASSED: User found in users_db.json');
        } else {
            console.error('   STRICT PERSISTENCE CHECK FAILED: User NOT found in users_db.json');
            process.exit(1);
        }

        // 3. DELETE USER
        console.log('3. Cleanup: Deleting user...');
        const deleteRes = await fetch(`${API_URL}/users/${createdUser.id}`, {
            method: 'DELETE',
            headers: { 'x-admin-secret': ADMIN_SECRET }
        });

        if (!deleteRes.ok) {
            throw new Error('Delete failed');
        }
        console.log('   User deleted via API.');

        // 4. VERIFY DELETION
        const finalContent = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        const stillThere = finalContent.find(u => u.id === createdUser.id);
        if (!stillThere) {
            console.log('   Deletion Verified: User removed from file.');
        } else {
            console.error('   Deletion Failed: User still in file.');
        }

        console.log('--- TEST COMPLETED SUCCESSFULLY ---');

    } catch (e) {
        if (e.code === 'ECONNREFUSED') {
            console.error('CONNECTION REFUSED. Is the server running on port 3001?');
            console.error('Please run "node server/server.js" in another terminal.');
        } else {
            console.error('TEST FAILED:', e);
        }
    }
}

testPersistence();
