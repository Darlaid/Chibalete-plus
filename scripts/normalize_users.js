import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USERS_DB = path.resolve(__dirname, '../data/users_db.json');
const DEV_SEEDS = path.resolve(__dirname, '../data/dev_seeds.json');

const rawData = fs.readFileSync(USERS_DB, 'utf-8');
const allUsers = JSON.parse(rawData);

const validUsers = [];
const devSeeds = Array.isArray(JSON.parse(fs.existsSync(DEV_SEEDS) ? fs.readFileSync(DEV_SEEDS, 'utf-8') : '[]')) 
    ? JSON.parse(fs.existsSync(DEV_SEEDS) ? fs.readFileSync(DEV_SEEDS, 'utf-8') : '[]') 
    : [];

for (const u of allUsers) {
    // Detect test/demo accounts
    if (u.email.startsWith('test') || u.email.startsWith('audit@')) {
        devSeeds.push(u);
    } else {
        // Normalize role
        if (u.roles && u.roles.includes('admin')) {
            u.roles = u.roles.map(r => r === 'admin' ? 'administrador' : r);
        }
        validUsers.push(u);
    }
}

// Ensure official demo users
const demoUsers = [
    {
        id: 'demo-admin',
        email: 'admin@demo.com',
        nombre_completo: 'Administrador Demo',
        password: 'admin123',
        roles: ['administrador']
    },
    {
        id: 'demo-profesor',
        email: 'profesor@demo.com',
        nombre_completo: 'Profesor Demo',
        password: 'profesor123',
        roles: ['profesor'],
        colegio: 'Colegio Demo'
    },
    {
        id: 'demo-lector',
        email: 'lector@demo.com',
        nombre_completo: 'Lector Demo',
        password: 'lector123',
        roles: ['lector'],
        colegio: 'Colegio Demo',
        nivel_lectura: 'Novato'
    }
];

demoUsers.forEach(demo => {
    const existingIdx = validUsers.findIndex(u => u.email === demo.email);
    if (existingIdx === -1) {
        validUsers.push(demo);
    } else {
        // Merge to keep id if exists, but ensure role is clean
        const existing = validUsers[existingIdx];
        if (existing.roles.includes('admin')) existing.roles = existing.roles.map(r => r === 'admin' ? 'administrador' : r);
    }
});

fs.writeFileSync(USERS_DB, JSON.stringify(validUsers, null, 2));
fs.writeFileSync(DEV_SEEDS, JSON.stringify(devSeeds, null, 2));

console.log(`Migrated ${devSeeds.length} users to dev_seeds.json`);
console.log(`Saved ${validUsers.length} users to users_db.json`);
