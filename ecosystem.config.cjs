/* eslint-disable */
// ═══════════════════════════════════════════════════════════════════════
// ⚠️  CHIBALETE+ — ECOSYSTEM PM2 — LOCAL ONLY  ⚠️
// ═══════════════════════════════════════════════════════════════════════
//
// 🔴 PM2 NO GOBIERNA PRODUCCIÓN.
//
// Producción de Chibalete+ corre como Docker Compose con containers
// `chibalete_edge`, `chibalete_front`, `chibalete_api_1`, `chibalete_api_2`.
// El compose canónico vive en /opt/chibaleteplus/docker-compose.yml en el
// VPS. Ver deployment_guide.md (sección 4.4) para la topología completa.
//
// ESTE ARCHIVO ES PARA DESARROLLO LOCAL EXCLUSIVAMENTE.
// Permite levantar el backend con `pm2 start ecosystem.config.cjs` durante
// debugging local cuando es más conveniente que `node server/server.js`.
//
// ─── Si intentas correrlo en el VPS de producción ──────────────────────
//
// El bloque fail-fast de abajo aborta la carga del config con
// `process.exit(1)` cuando detecta marcadores de filesystem que SOLO
// existen en producción VPS. Esto evita el escenario silencioso donde un
// `pm2 start` en VPS spawnea un tercer proceso backend paralelo a
// `chibalete_api_1` y `chibalete_api_2`, contaminando logs, ocupando
// memoria, y compitiendo por `withFileLock` sobre los mismos JSONs.
//
// Si por alguna razón excepcional necesitas correr PM2 en una máquina
// que casualmente tiene esos paths (ej. test ambient en mismo VPS):
//
//     ALLOW_PM2_LOCAL_ONLY=1 pm2 start ecosystem.config.cjs
//
// Sólo deberías necesitar esto durante un incidente de migración. En
// uso normal de producción, NO se override este guard.
//
// ─── Por qué el archivo no se renombró a `.local-only.cjs` ─────────────
//
// 1. Renombrar rompe el contrato estándar PM2 (`pm2 start ecosystem.config.cjs`
//    es el comando documentado universalmente).
// 2. Renombrar no agrega seguridad: cualquiera puede tipear el nuevo nombre.
// 3. La defensa real es runtime (este fail-fast), no nominal.
//
// Ver Sprint 022 Fase 2B.2 para la decisión arquitectónica completa.
// ═══════════════════════════════════════════════════════════════════════

'use strict';

const fs = require('fs');

// Marcadores de producción: rutas que SOLO existen en el VPS Docker.
// Si cualquiera está presente Y el override no está activo → abort.
const PRODUCTION_MARKERS = [
    '/opt/chibaleteplus/docker-compose.yml',
    '/var/www/chibalete/data',
    '/var/www/chibalete/server',
];

const ALLOW_OVERRIDE = process.env.ALLOW_PM2_LOCAL_ONLY === '1';

if (!ALLOW_OVERRIDE) {
    const detectedMarkers = PRODUCTION_MARKERS.filter(p => {
        try { return fs.existsSync(p); } catch { return false; }
    });

    if (detectedMarkers.length > 0) {
        // Salida en stderr para que sea inmediatamente visible. El mensaje
        // está pensado para un operador que acabó de tipear `pm2 start` y
        // necesita entender:
        //   1. Qué pasó (PM2 abortó).
        //   2. Por qué (es producción, esto rompería).
        //   3. Qué hacer (consultar deployment_guide.md).
        //   4. Cómo override si realmente lo necesita (env var).
        const lines = [
            '',
            '═══════════════════════════════════════════════════════════════',
            '🔴 [FATAL] PM2 NO GOBIERNA PRODUCCIÓN',
            '═══════════════════════════════════════════════════════════════',
            '',
            'Detectada producción VPS de Chibalete+ por los siguientes',
            'marcadores de filesystem:',
            ...detectedMarkers.map(m => `   - ${m}`),
            '',
            'Producción corre como Docker Compose. Levantar PM2 acá',
            'spawnearía un tercer proceso backend paralelo a',
            'chibalete_api_1 y chibalete_api_2, generando:',
            '',
            '   ❌ logs duplicados (Docker + PM2 escribiendo en paralelo)',
            '   ❌ memoria adicional ocupada permanentemente',
            '   ❌ tres procesos compitiendo por withFileLock sobre los',
            '      mismos JSONs en /var/www/chibalete/data',
            '   ❌ drift de versiones si el código en bind mount es nuevo',
            '      pero los containers aún cargan la versión vieja en RAM',
            '   ❌ falsa sensación de "deploy exitoso" (pm2 status online)',
            '      cuando el edge no rutea tráfico al proceso PM2',
            '',
            'Cómo desplegar correctamente:',
            '   👉 Ver deployment_guide.md (sección 12 — flujo backend)',
            '',
            'Cómo override si realmente sabes lo que estás haciendo:',
            '   👉 ALLOW_PM2_LOCAL_ONLY=1 pm2 start ecosystem.config.cjs',
            '      (DOCUMENTAR el motivo en /root/deploys.log)',
            '',
            '═══════════════════════════════════════════════════════════════',
            '',
        ];
        console.error(lines.join('\n'));
        process.exit(1);
    }
}

// ─── Configuración PM2 (solo válida en dev local) ──────────────────────
//
// Usado para `pm2 start ecosystem.config.cjs` durante debugging local.
// Equivalente a `node server/server.js` con auto-restart en crash.
//
// En dev local NO hay /opt/chibaleteplus/ ni /var/www/chibalete/, así que
// el fail-fast de arriba no se dispara y este config se carga.
//
// ⚠️  NO añadir aquí `max_memory_restart`, healthchecks o cluster mode
// pensando en producción. Producción ignora este archivo. Cualquier
// hardening de procesos backend va en docker-compose.yml.

module.exports = {
    apps: [{
        name: "chibalete-app-local",
        script: "./server/server.js",
        env: {
            NODE_ENV: "development",
            PORT: 3000,
        },
    }],
};
