# V4 Smoke Checklist — pre y post deploy

> Checklist canónico de smoke manual. **Cada ítem PASA / FALLA**. Si
> algún P0 falla → NO-GO o rollback inmediato.

## A. Pre-deploy smoke (workstation local)

Tiempo estimado: 20 minutos.

### A.1 Local stack

- [ ] `npm ci` exit 0
- [ ] `npm run test:analytics` → 15 suites verdes, 771 ✓
- [ ] `npm run test:reading-runtime` → 5 suites verdes, 162 ✓
- [ ] `npm run test:seed-local-admin` → 40 ✓
- [ ] `npm run typecheck:baseline` → solo error pre-existente de `useImmersivePlayback` (canStartAudio), NO nuevos errores de v4
- [ ] `npm run build` → exit 0, `dist/` generado con todos los chunks esperados
- [ ] `npm run seed:admin-local` → `Action: noop` o `created` (sin errores)

### A.2 Smoke manual local con admin@chibaleteeditores.com / admin123

(Solo si el operador hizo run local del stack)

```bash
npm run server &
SERVER_PID=$!
npm run dev &
DEV_PID=$!
# Abrir http://localhost:5173
```

| # | Surface | Acción | Esperado | Pass/Fail |
|---|---|---|---|---|
| 1 | Login | admin@chibaleteeditores.com + admin123 | Entra como admin | |
| 2 | Biblioteca | cargar | Lista de libros con cubiertas | |
| 3 | Cubierta portrait | inspeccionar | Sin crop, aspect ratio 2:3 preservado | |
| 4 | Cubierta landscape (si hay) | inspeccionar | Sin crop, mostrada apaisada | |
| 5 | Cubierta square (si hay) | inspeccionar | Sin crop, mostrada cuadrada | |
| 6 | Visor Inmersivo | abrir un libro | Audio + texto sincronizados | |
| 7 | Visor Texto (Modo Guiado) | abrir | Texto + TTS funcionan | |
| 8 | Visor Accesible | navegar a `/leer/accesible/<id>` | A11yShell carga | |
| 9 | VisorPDF | abrir PDF | Páginas renderizan, nav | |
| 10 | VisorAlbum | abrir álbum | Hotspots + audio funcionan | |
| 11 | Leo (companion) | abrir desde visor | Responde sin error | |
| 12 | Aula Viva Operacional | navegar a `/aula-viva/operacional` | Queue + recomendaciones cargan | |
| 13 | Seleccionar estudiante | click en attention queue | Recomendaciones + timeline aparecen | |
| 14 | Cohort comparison | scroll abajo | Sparklines visibles | |
| 15 | Logout + Login | repetir | Sesión persiste tras refresh | |

```bash
kill $SERVER_PID $DEV_PID
```

## B. Post-deploy smoke (producción real)

Tiempo estimado: 30 minutos. **Usar cuenta admin REAL de producción, NUNCA `admin@chibaleteeditores.com/admin123`.**

### B.1 Healthchecks técnicos (P0)

```bash
# Todas deben responder 200
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health/ready
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health/analytics
curl -sf https://chibaleteplus.chibaleteeditores.com/metrics | grep "^chibalete_" | head -10
```

- [ ] `/api/health` → 200 + body parseable
- [ ] `/api/health/ready` → 200 + `ready: true`
- [ ] `/api/health/analytics` → 200 + `degraded: false` (o `degraded: true` con razón aceptada)
- [ ] `/metrics` → 200 + counters `chibalete_*` visibles

### B.2 Smoke funcional (mismo orden que A.2, en producción)

- [ ] Login admin real → success
- [ ] Biblioteca carga lista de libros
- [ ] Cubiertas se ven correctas (sin crop excesivo)
- [ ] VisorInmersivo abre y reproduce
- [ ] VisorTexto abre y reproduce TTS
- [ ] VisorAccesible abre
- [ ] VisorPDF abre
- [ ] VisorAlbum abre + hotspots
- [ ] Leo responde
- [ ] Aula Viva Operacional carga sin 500
- [ ] Seleccionar estudiante muestra timeline
- [ ] Cohort comparison renderiza
- [ ] Logout + relogin OK

### B.3 events.db recibe data (si Fase A de flags activa)

```bash
ssh root@72.60.158.97 << 'EOF'
sqlite3 /var/www/chibalete/data-critical/events.db <<SQL
.headers on
SELECT mode, event, COUNT(*) AS n
FROM events
WHERE server_ts >= (strftime('%s','now','-10 minutes') * 1000)
GROUP BY mode, event
ORDER BY n DESC
LIMIT 20;
SQL
EOF
```

- [ ] Hay rows con `mode='leo'` (si flag ON)
- [ ] Hay rows con `mode='aula_viva'` (si flag ON y mediador hizo click)
- [ ] NO hay errores `__validation_failed` en payload_json (`SELECT COUNT(*) FROM events WHERE payload_json LIKE '%__validation_failed%';` debe ser 0)

### B.4 Sin 500s recientes

```bash
ssh root@72.60.158.97 'docker logs chibalete_api_1 --since 10m 2>&1 | grep -cE " 5[0-9]{2} " || echo 0'
ssh root@72.60.158.97 'docker logs chibalete_api_2 --since 10m 2>&1 | grep -cE " 5[0-9]{2} " || echo 0'
```

- [ ] `chibalete_api_1` 5xx count ≤ baseline esperado (0-2/h)
- [ ] `chibalete_api_2` 5xx count ≤ baseline esperado

## C. Playwright matrix recomendada (NO implementada en este sprint)

El prompt 5.2 pide matriz Playwright. **No se construyó suite Playwright** porque:
1. La matriz es de ~50+ casos, requiere 2-3 días de trabajo dedicado.
2. Implementarla mal sería peor que confiar en el smoke manual + suites node (973 ✓).
3. La matriz queda documentada acá como guía para implementación dedicada en sprint posterior.

**Cuando se construya**, prioridad por leverage:

### Desktop (Chromium)
- [ ] Login + nav básica (`/`, `/biblioteca`, `/aula-viva/operacional`)
- [ ] Cubiertas portrait/landscape/square: snapshot test con 3 covers de aspect-ratio distinto
- [ ] VisorInmersivo: abrir + scrub
- [ ] VisorTexto: abrir + TTS play/pause
- [ ] VisorAlbum: abrir + click hotspot
- [ ] Leo: open modal + send message
- [ ] AulaVivaOperacional: select student → timeline visible

### Mobile (Chromium 375x812 + Safari iOS emul)
- [ ] Biblioteca scroll sin overflow
- [ ] VisorTexto reading con una mano (botones ≥44px touch)
- [ ] AulaVivaOperacional compactness
- [ ] LeoCompanion modal full-screen mobile

### Runtime
- [ ] Cambio libro rápido (open A → open B → no listeners orphan)
- [ ] Reload mid-session (snapshot restore)
- [ ] Backgrounding tab + return (no audio doble)

### Offline
- [ ] DevTools offline → reading desde cache
- [ ] Reconnect → queue retry (si existe)

### Reduced motion
- [ ] `prefers-reduced-motion: reduce` emulado → confetti silenciado en VisorAlbum
- [ ] `prefers-reduced-motion: reduce` → ContentCard hover no escala

## D. Torture testing (NO implementada en este sprint)

Similar a Playwright. La matriz queda documentada como guía:

| Test | Métrica clave | Threshold |
|---|---|---|
| Long session 30min simulada | memory growth | < 50 MB |
| Rapid mode switching (10x/min × 5min) | orphan listeners | 0 |
| Rapid book switching (5x/min × 5min) | duplicate audio | 0 |
| Mount/unmount cycle (100x) | leak | < 1 MB/cycle |
| Reconnect storm (offline/online × 20) | queue corruption | 0 |
| Audio interrupt (pause/resume × 50) | desync | < 100ms |
| Leo repeated (20 messages back-to-back) | rate limit | applied |
| Aula Viva polling (3 panels × 30 segundos) | SQLite busy errors | 0 |

**Hoy**: las suites node existentes (`test:reading-runtime`, `test:analytics`) cubren parcialmente: anti-stale callbacks, dedup ULID, idempotencia de scheduler, defensive parsing, etc. **973 ✓** asserts en total. Para torture real se necesita Playwright + sustained load.
