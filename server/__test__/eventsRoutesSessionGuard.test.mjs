/**
 * eventsRoutesSessionGuard.test.mjs — CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01.
 *
 * Guard estructural (patrón browserNoXUserIdGuard): las CUATRO rutas de
 * escritura de eventos (incluido el alias legacy /api/events) deben registrar
 * `requireEventsWriteAuth` como middleware. Antes del fix este test FALLA
 * (demuestra el bug: rutas sin middleware de sesión cuya identidad sale del
 * header crudo vía reqUserId).
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js');
const src = fs.readFileSync(serverPath, 'utf8');

const ROUTES = ['/api/v1/events', '/api/playback-events', '/api/analytics/events', '/api/events'];

for (const route of ROUTES) {
    const lines = src.split('\n').filter(l => l.includes(`app.post('${route}'`));
    assert.equal(lines.length, 1, `registro de ${route} no encontrado (o duplicado)`);
    assert.ok(
        lines[0].includes('requireEventsWriteAuth'),
        `${route} debe registrar requireEventsWriteAuth antes del handler (gap cookie-auth)`
    );
}

// El guard debe instanciarse desde la factoría del lib (no auth paralela ad-hoc).
assert.ok(
    src.includes("from './lib/eventsWriteAuth.js'") && src.includes('createEventsWriteAuth({'),
    'server.js debe instanciar createEventsWriteAuth del lib'
);

console.log('eventsRoutesSessionGuard.test.mjs OK — 4 rutas con guard de sesión');
