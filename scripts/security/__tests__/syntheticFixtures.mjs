/**
 * Fixtures sintéticas para los tests de evidencia segura.
 *
 * REGLA: nada de esto se versiona como archivo con aspecto de secreto. Los
 * valores se ENSAMBLAN en tiempo de ejecución a partir de fragmentos inertes y
 * los archivos se escriben en `os.tmpdir()`. Así:
 *
 *   - gitleaks y Trivy no tienen que llevar excepciones nuevas;
 *   - el repositorio nunca contiene una cadena con forma de credencial;
 *   - cada test parte de un artefacto limpio y lo borra al terminar.
 *
 * Todos los valores llevan el marcador SYNTHETIC dentro: si uno apareciera en
 * un incidente real, se sabría de inmediato que salió de aquí.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const S = 'SYNTHETIC';
const filler = (n, seed) => Array.from({ length: n }, (_, i) => 'abcdefghijkmnopqrstuvwxyz0123456789'[(i * 7 + seed) % 35]).join('');

/**
 * Nueve secretos sintéticos que cubren las formas que rompieron a las
 * herramientas anteriores.
 */
export const SECRETS = Object.freeze({
    // Formato clásico OpenAI: guiones, sin puntos.
    OPENAI_API_KEY: ['sk', '-proj-', S, '-', filler(48, 3)].join(''),
    // Formato Google v2: CONTIENE UN PUNTO. Es el que la tokenización anterior
    // partía en dos, dando un falso GREEN.
    GEMINI_API_KEY: ['AQ', '.', S, '_', filler(40, 5)].join(''),
    // Secreto administrativo: hex largo.
    ADMIN_SECRET: [S.toLowerCase(), filler(56, 11)].join(''),
    // Contraseña con símbolos y comillas: rompe los redactores por regex naíf.
    DB_PASSWORD: [S, "-p'a\"ss:", filler(12, 2)].join(''),
    // JWT: tres segmentos separados por puntos.
    SESSION_TOKEN: ['eyJ', filler(20, 1), '.', 'eyJ', filler(24, 4), '.', filler(32, 6)].join(''),
    // Cookie de sesión con signos igual y punto y coma alrededor.
    COOKIE_VALUE: ['sid', '.', S, '.', filler(30, 8)].join(''),
    // DSN completo: esquema, credenciales embebidas, barras y dos puntos.
    DATABASE_URL: ['postgres://', S, ':', filler(16, 9), '@db.internal:5432/chibalete'].join(''),
    // Cabecera Authorization.
    AUTH_HEADER_VALUE: ['Bearer ', S, '-', filler(36, 7)].join(''),
    // El caso difícil: nombre SIN pista alguna de que es un secreto.
    CHIB_ROTOR: [S, '-', filler(44, 13)].join(''),
});

/** Todos los valores, para el escáner. */
export const allSecretValues = () => Object.entries(SECRETS).map(([id, value]) => ({ id, value }));

// ── Constructores de artefactos ──────────────────────────────────────────────

export const envFixture = () => [
    '# .env sintético — CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B',
    'NODE_ENV=production',
    'METRICS_ENGINE=legacy',
    'LEGACY_METRICS_REQUEST_CONTEXT=off',
    `OPENAI_API_KEY=${SECRETS.OPENAI_API_KEY}`,
    `GEMINI_API_KEY=${SECRETS.GEMINI_API_KEY}`,
    // Ensamblado por concatenación, no por plantilla: una plantilla dejaría en
    // el código la forma literal `NOMBRE="…"` que gitleaks marca como secreto
    // embebido, y este archivo no puede necesitar excepciones en el escáner.
    'ADMIN_SECRET=' + JSON.stringify(SECRETS.ADMIN_SECRET),
    'DB_PASSWORD=' + "'" + SECRETS.DB_PASSWORD + "'",
    `DATABASE_URL=${SECRETS.DATABASE_URL}`,
    `CHIB_ROTOR=${SECRETS.CHIB_ROTOR}`,
    'export TTS_MODE=openai',
    '',
].join('\n');

export const dockerInspectFixture = () => ([{
    Id: 'c0ffee'.repeat(10),
    Name: '/chibalete_api_1',
    Created: '2026-07-30T15:30:38Z',
    RestartCount: 0,
    Image: 'sha256:3d0085d96547857a694a3549c1f65beb504dc3dccc3701b1ba185075812ddefc',
    State: {
        Status: 'running',
        StartedAt: '2026-07-31T17:29:00Z',
        // chp-evidence-ratchet: allow fixture-sintetica-de-healthcheck-contaminado
        Health: { Status: 'healthy', Log: [{ Output: `curl -H "Authorization: ${SECRETS.AUTH_HEADER_VALUE}"` }] },
    },
    Config: {
        Image: 'chibalete/api:83489ce',
        WorkingDir: '/app',
        Cmd: ['node', 'server/server.js', '--token', SECRETS.SESSION_TOKEN],
        Entrypoint: null,
        Labels: {
            'com.docker.compose.service': 'api_1',
            'chibalete.commit': '83489ce',
            'build.ci.token': SECRETS.SESSION_TOKEN,
        },
        Env: [
            'NODE_ENV=production',
            'METRICS_ENGINE=legacy',
            'LEGACY_METRICS_REQUEST_CONTEXT=off',
            `OPENAI_API_KEY=${SECRETS.OPENAI_API_KEY}`,
            `GEMINI_API_KEY=${SECRETS.GEMINI_API_KEY}`,
            `ADMIN_SECRET=${SECRETS.ADMIN_SECRET}`,
            `CHIB_ROTOR=${SECRETS.CHIB_ROTOR}`,
            `DATABASE_URL=${SECRETS.DATABASE_URL}`,
        ],
    },
    HostConfig: {
        Memory: 1073741824,
        MemoryReservation: 268435456,
        NanoCpus: 1000000000,
        RestartPolicy: { Name: 'unless-stopped' },
        Binds: ['/var/www/chibalete/data:/app/data:rw'],
    },
    Mounts: [
        { Type: 'bind', Source: '/var/www/chibalete/data', Destination: '/app/data', RW: true },
        { Type: 'bind', Source: '/home/cliente-privado/secretos', Destination: '/app/secrets', RW: false },
    ],
    NetworkSettings: {
        Networks: { chibalete_net: { IPAddress: '172.18.0.5', Aliases: ['api_1'] } },
    },
}]);

export const composeJsonFixture = () => ({
    services: {
        api_1: {
            image: 'chibalete/api:83489ce',
            container_name: 'chibalete_api_1',
            restart: 'unless-stopped',
            env_file: ['.env'],
            environment: {
                METRICS_ENGINE: 'legacy',
                LEGACY_METRICS_REQUEST_CONTEXT: 'off',
                OPENAI_API_KEY: SECRETS.OPENAI_API_KEY,
                GEMINI_API_KEY: SECRETS.GEMINI_API_KEY,
                CHIB_ROTOR: SECRETS.CHIB_ROTOR,
            },
            volumes: ['/var/www/chibalete/data:/app/data:rw'],
            networks: ['chibalete_net'],
            ports: ['3000:3000'],
        },
    },
    networks: { chibalete_net: { driver: 'bridge' } },
});

export const yamlFixture = () => [
    'version: "3.8"',
    'services:',
    '  api_1:',
    '    image: chibalete/api:83489ce',
    '    environment:',
    '      METRICS_ENGINE: legacy',
    '      LEGACY_METRICS_REQUEST_CONTEXT: "off"',
    `      OPENAI_API_KEY: ${SECRETS.OPENAI_API_KEY}`,
    `      GEMINI_API_KEY: ${SECRETS.GEMINI_API_KEY}`,
    `      CHIB_ROTOR: ${SECRETS.CHIB_ROTOR}`,
    '    labels:',
    '      - "chibalete.commit=83489ce"',
    '  worker:',
    '    image: chibalete/api:83489ce',
    '    environment:',
    `      - ADMIN_SECRET=${SECRETS.ADMIN_SECRET}`,
    '      - NODE_ENV=production',
    '    headers:',
    `      authorization: ${SECRETS.AUTH_HEADER_VALUE}`,
    'secrets:',
    `  db_password: ${SECRETS.DB_PASSWORD}`,
    '',
].join('\n');

export const jsonFixture = () => ({
    servicio: 'chibalete-api',
    // Mayúsculas mezcladas a propósito.
    Config: { Env: [`OPENAI_API_KEY=${SECRETS.OPENAI_API_KEY}`, 'NODE_ENV=production'] },
    credenciales: {
        adminSecret: SECRETS.ADMIN_SECRET,
        'x-admin-secret': SECRETS.ADMIN_SECRET,      // valor duplicado a propósito
        nested: { deep: { API_KEY: SECRETS.GEMINI_API_KEY } },
    },
    cabeceras: [{ Authorization: SECRETS.AUTH_HEADER_VALUE }, { cookie: SECRETS.COOKIE_VALUE }],
    tokens: [SECRETS.SESSION_TOKEN, SECRETS.SESSION_TOKEN],
    dsn: SECRETS.DATABASE_URL,
    flags: { METRICS_ENGINE: 'legacy', LEGACY_METRICS_REQUEST_CONTEXT: 'off' },
});

export const textFixture = () => [
    'Nota de incidente — 2026-07-31 (texto libre, último recurso)',
    'El operador ejecutó: curl -H "Authorization: ' + SECRETS.AUTH_HEADER_VALUE + '" https://api',
    'ADMIN_SECRET=' + SECRETS.ADMIN_SECRET,
    'Contexto: acentos y emoji alrededor del valor → ñ á ü 🦀 ' + SECRETS.GEMINI_API_KEY + ' 🦀 fin',
    'status: ok  latencia: 12ms',
].join('\n');

// ── Directorio temporal ──────────────────────────────────────────────────────

export const makeTmpDir = (prefix = 'chp-evidence-') => fs.mkdtempSync(path.join(os.tmpdir(), prefix));

export const writeTmp = (dir, name, content) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content, null, 2), { mode: 0o600 });
    return p;
};

export const cleanup = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };
