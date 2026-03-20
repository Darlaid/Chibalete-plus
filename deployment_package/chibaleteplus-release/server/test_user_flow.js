
import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001/api';
const ADMIN_SECRET = 'chibalete-secure-upload-2025';

const HEADERS = {
    'Content-Type': 'application/json',
    'x-admin-secret': ADMIN_SECRET
};

const WAIT_TIME = 200;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
    console.log('--- STARTING USER MANAGEMENT TEST FLOW ---');
    let errors = 0;

    // 1. CLEAN UP (Delete test user if exists)
    const testUserEmail = 'test_auto_flow@example.com';
    let testUserId = null;

    console.log('\n[1] Check if test user exists and cleanup...');
    try {
        const res = await fetch(`${BASE_URL}/users`, { headers: HEADERS });
        const users = await res.json();
        const existing = users.find(u => u.email === testUserEmail);
        if (existing) {
            console.log(`User found (id: ${existing.id}), deleting...`);
            await fetch(`${BASE_URL}/users/${existing.id}`, {
                method: 'DELETE',
                headers: HEADERS
            });
            console.log('Cleanup done.');
        } else {
            console.log('No existing test user found.');
        }
    } catch (e) {
        console.error('Failed cleanup:', e.message);
    }

    await sleep(WAIT_TIME);

    // 2. CREATE USER
    console.log('\n[2] Creating new user...');
    const newUser = {
        email: testUserEmail,
        nombre_completo: 'Automated Test User',
        password: 'password123',
        roles: ['lector'],
        colegio: 'Test School'
    };

    try {
        const res = await fetch(`${BASE_URL}/users`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(newUser)
        });

        if (res.status === 200) {
            const data = await res.json();
            testUserId = data.id;
            console.log('SUCCESS: User created.', data.id);
        } else {
            const err = await res.json();
            console.error('FAIL: Could not create user.', res.status, err);
            errors++;
        }
    } catch (e) {
        console.error('FAIL: Exception during create.', e);
        errors++;
    }

    await sleep(WAIT_TIME);

    // 3. DUPLICATE CHECK
    console.log('\n[3] Testing duplicate creation...');
    try {
        const res = await fetch(`${BASE_URL}/users`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify(newUser)
        });

        if (res.status === 409) {
            console.log('SUCCESS: Duplicate rejected as expected (409).');
        } else {
            const data = await res.json();
            console.error('FAIL: Duplicate NOT rejected.', res.status, data);
            errors++;
        }
    } catch (e) {
        console.error('FAIL: Exception during duplicate check.', e);
        errors++;
    }

    await sleep(WAIT_TIME);

    // 4. UPDATE USER
    if (testUserId) {
        console.log('\n[4] Updating user...');
        const updates = { nombre_completo: 'Updated Name', roles: ['lector', 'mediador'] };
        try {
            const res = await fetch(`${BASE_URL}/users/${testUserId}`, {
                method: 'PUT',
                headers: HEADERS,
                body: JSON.stringify(updates)
            });

            if (res.status === 200) {
                const data = await res.json();
                if (data.nombre_completo === 'Updated Name' && data.roles.includes('mediador')) {
                    console.log('SUCCESS: User updated.');
                } else {
                    console.error('FAIL: User returned but data mismatch.', data);
                    errors++;
                }
            } else {
                console.error('FAIL: Update request failed.', res.status);
                errors++;
            }
        } catch (e) {
            console.error('FAIL: Exception during update.', e);
            errors++;
        }
    }

    await sleep(WAIT_TIME);

    // 5. LOGIN CHECK
    console.log('\n[5] Testing Login...');
    try {
        const res = await fetch(`${BASE_URL}/auth/login`, {
            method: 'POST',
            headers: HEADERS,
            body: JSON.stringify({ email: testUserEmail, password: 'password123' })
        });

        if (res.status === 200) {
            const data = await res.json();
            if (data.success) {
                console.log('SUCCESS: Login successful.');
            } else {
                console.error('FAIL: Login response failure.', data);
                errors++;
            }
        } else {
            console.error('FAIL: Login failed HTTP.', res.status);
            errors++;
        }
    } catch (e) {
        console.error('FAIL: Exception during login.', e);
        errors++;
    }

    // 6. DELETE (Cleanup)
    if (testUserId) {
        console.log('\n[6] Deleting user...');
        try {
            const res = await fetch(`${BASE_URL}/users/${testUserId}`, {
                method: 'DELETE',
                headers: HEADERS
            });
            if (res.status === 200) {
                console.log('SUCCESS: User deleted.');
            } else {
                console.error('FAIL: Delete failed.', res.status);
                errors++;
            }
        } catch (e) {
            console.error('FAIL: Exception during delete.', e);
            errors++;
        }
    }

    console.log('\n--- TEST SUMMARY ---');
    if (errors === 0) {
        console.log('ALL TESTS PASSED');
    } else {
        console.log(`${errors} TESTS FAILED`);
    }
}

runTests();
