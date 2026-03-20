
import fetch from 'node-fetch'; // We might need to handle this if node-fetch isn't installed, but let's try native fetch if node 18+
// Node 18+ has native fetch.

const BASE_URL = 'http://localhost:3001/api';
const SECRET_HEADER = { 'x-admin-secret': 'chibalete-secure-upload-2025', 'Content-Type': 'application/json' };

async function runTests() {
    console.log('--- STARTING USER/GROUP TESTS ---');

    console.log('1. Health Check');
    try {
        const h = await fetch(`${BASE_URL}/health`);
        const hJson = await h.json();
        console.log('Health:', hJson);
    } catch (e) {
        console.error('Server not reachable. Make sure it is running.');
        process.exit(1);
    }

    // --- USER TESTS ---
    console.log('\n2. Create User');
    const testUser = {
        email: 'test@chibalete.com',
        nombre_completo: 'Test User',
        roles: ['lector'],
        password: 'password123',
        colegio: 'Colegio Test'
    };

    let userId = null;

    try {
        const res = await fetch(`${BASE_URL}/users`, {
            method: 'POST',
            headers: SECRET_HEADER,
            body: JSON.stringify(testUser)
        });
        const json = await res.json();
        console.log('Create User Status:', res.status);
        console.log('User Created:', json.email);
        if (json.id) userId = json.id;
    } catch (e) { console.error('Create User Failed', e); }

    console.log('\n3. Login');
    try {
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: SECRET_HEADER,
            body: JSON.stringify({ email: 'test@chibalete.com', password: 'password123' })
        });
        const json = await res.json();
        console.log('Login Success:', json.success);
        if (json.user && json.user.password) console.error('SECURITY WARNING: Password returned in login!');
    } catch (e) { console.error('Login Failed', e); }

    if (userId) {
        console.log('\n4. Update User');
        try {
            const res = await fetch(`${BASE_URL}/users/${userId}`, {
                method: 'PUT',
                headers: SECRET_HEADER,
                body: JSON.stringify({ ...testUser, nombre_completo: 'Updated Name', id: userId })
            });
            const json = await res.json();
            console.log('Update User Name:', json.nombre_completo);
        } catch (e) { console.error('Update Failed', e); }
    }

    // --- GROUP TESTS ---
    console.log('\n5. Create Group');
    let groupId = null;
    const testGroup = {
        name: 'Grupo 101',
        school: 'Colegio Test',
        grade: '10',
        teacherId: userId || 'teacher-1',
        studentIds: []
    };

    try {
        const res = await fetch(`${BASE_URL}/groups`, {
            method: 'POST',
            headers: SECRET_HEADER,
            body: JSON.stringify(testGroup)
        });
        const json = await res.json();
        console.log('Create Group Status:', res.status);
        if (json.id) groupId = json.id;
    } catch (e) { console.error('Create Group Failed', e); }

    // --- CLEANUP ---
    console.log('\n6. Cleanup (Delete)');
    if (userId) {
        await fetch(`${BASE_URL}/users/${userId}`, { method: 'DELETE', headers: SECRET_HEADER });
        console.log('User Deleted');
    }
    if (groupId) {
        await fetch(`${BASE_URL}/groups/${groupId}`, { method: 'DELETE', headers: SECRET_HEADER });
        console.log('Group Deleted');
    }

    console.log('\n--- TESTS COMPLETED ---');
}

runTests();
