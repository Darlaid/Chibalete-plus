# Sprint 022 — Runbook Operacional

> **Documento canónico** de **deploy y validación operacional del backend**
> Chibalete+ (modelo bind-mount).
> Si la realidad del VPS difiere de este runbook, se resuelve a favor
> de la realidad y se actualiza este documento inmediatamente.

> **Hermano operacional:** `docs/sprint022-frontend-deploy.md` (deploy
> frontend image-based). Son **stacks paralelos y distintos** —
> mecanismo, payload, rollback y tooling no se comparten. Ver
> `docs/operational-architecture-summary.md` para el modelo completo.
> No mezclar ambos procedimientos en la misma release window sin razón
> documentada.

---

## 0. Propósito de este runbook

Sprint 022 entregó la infraestructura operacional de Chibalete+:
`backup-vps.sh`, `deploy-backend.sh`, `/api/health` enriquecido,
`.deploy-info`, lock, watchdog, restart staggered, rollback de código.

**Este runbook NO es para nuevas features.** Es para **demostrar que
el pipeline funciona realmente sobre producción**, mediante:

1. Un **smoke release** trivial e inocuo
2. Un **drill de rollback** controlado
3. Una **failure injection matrix** documentada
4. Checklists pre/durante/post

> Filosofía: el primer deploy real no debe estar probando lógica de
> negocio. Debe estar probando que la infraestructura sobrevive
> producción.

---

## 0.5. First-time setup (UNA SOLA VEZ por VPS)

> Esta sección sólo aplica al **PRIMER deploy backend canónico** después de Sprint 022.
> Si ya hubo un deploy con `deploy-backend.sh` exitoso antes, saltar a §1.

Antes del primer smoke release, el operador debe asegurarse de que el VPS
tiene la infraestructura mínima esperada por `deploy-backend.sh`. El
script asume que estos componentes existen y falla si no.

### 0.5.1 Transferir scripts canónicos al VPS

```bash
# Desde local, una vez:
ssh root@72.60.158.97 'mkdir -p /root/scripts'
scp scripts/backup-vps.sh root@72.60.158.97:/root/scripts/
ssh root@72.60.158.97 'chmod 700 /root/scripts/backup-vps.sh'

# Verificar:
ssh root@72.60.158.97 'sha256sum /root/scripts/backup-vps.sh'
sha256sum scripts/backup-vps.sh
# Los dos hashes deben coincidir.
```

> `deploy-backend.sh` también vive en local — NO se transfiere al VPS porque
> orquesta DESDE el operador.

### 0.5.2 Crear deploys.log vacío

```bash
ssh root@72.60.158.97 '
  if [ ! -f /root/deploys.log ]; then
    touch /root/deploys.log
    chmod 600 /root/deploys.log
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deploys.log inicializado pre-Sprint-022.9 actor=$(whoami)" >> /root/deploys.log
  else
    echo "deploys.log ya existe — saltando inicialización"
    tail -3 /root/deploys.log
  fi
'
```

### 0.5.3 Verificar permisos de los paths críticos

```bash
ssh root@72.60.158.97 'stat -c "%a %U %G %n" \
  /var/www/chibalete \
  /var/www/chibalete/server \
  /var/www/chibalete/data \
  /var/www/chibalete/data-critical \
  /var/www/chibalete/public/uploads \
  /opt/chibaleteplus/docker-compose.yml \
  /root \
  /root/backups 2>/dev/null'
# Esperado: todos accesibles por root (uid 0). Containers escriben con uid del proceso Node.
```

### 0.5.4 Crear /root/backups/chibalete/ si falta

```bash
ssh root@72.60.158.97 'mkdir -p /root/backups/chibalete && chmod 700 /root/backups/chibalete'
```

(`backup-vps.sh` también lo crea automáticamente, pero mejor pre-crearlo
con perms correctos antes del primer run.)

### 0.5.5 ssh key auth (no password prompt durante deploy)

```bash
# Verificar que ssh funciona sin prompt:
ssh -o BatchMode=yes root@72.60.158.97 "echo OK"
# Si falla con "Permission denied (publickey)":
#   ssh-copy-id root@72.60.158.97
#   o configurar ~/.ssh/config con IdentityFile correcta
```

`deploy-backend.sh` usa `BatchMode=yes` — falla rápido si pide password.

### 0.5.6 Confirmar que `/var/www/chibalete/server` es el código actual

Antes del primer smoke deploy, ese directorio contiene el código en producción.
**No tocar manualmente.** El primer deploy lo renombrará automáticamente a
`server.old-<TS>` y pondrá el nuevo en su lugar. Verificación:

```bash
ssh root@72.60.158.97 '
  ls -la /var/www/chibalete/server/server.js
  stat -c "%s bytes" /var/www/chibalete/server/server.js
  test -f /var/www/chibalete/server/.deploy-info && cat /var/www/chibalete/server/.deploy-info || echo "(.deploy-info ausente — esperado en primer deploy canónico)"
'
```

### 0.5.7 ADMIN_SECRET local

```bash
# En la máquina del operador:
grep -E '^ADMIN_SECRET=' .env
# Esperado: una línea con valor no vacío.

# El script load_secrets() lo lee de .env si no está en env.
# Verificar que pasa al header sin caracteres extraños:
echo "$ADMIN_SECRET" | wc -c   # esperado: longitud razonable
```

### 0.5.8 Validar conectividad y baseline

```bash
# Health endpoint debe responder
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health | head
# Validate ok=true (BLOQUEANTE para el deploy)
curl -sH "x-admin-secret: $ADMIN_SECRET" \
  https://chibaleteplus.chibaleteeditores.com/api/admin/membership/validate \
  | grep -E '"ok":true' && echo "✓ baseline OK" || echo "✗ ABORT primero limpiar drift"
```

> Si `ok=false` antes del primer deploy → STOP. No iniciar deploy hasta que
> `syncGroupMembership` u otra herramienta limpie el drift histórico.

---

## 1. Prerrequisitos absolutos

Antes de tocar nada, los siguientes ítems deben estar TODOS verdes:

| # | Item | Verificación |
|---|---|---|
| 1 | `npm run verify` pasa | `npm run verify` (debe terminar exit 0) |
| 2 | `npm run validate:local` pasa | `npm run validate:local` |
| 3 | Working tree limpio | `git status --porcelain` vacío |
| 4 | `ADMIN_SECRET` accesible | `grep ADMIN_SECRET .env` o `echo $ADMIN_SECRET` |
| 5 | ssh a VPS funciona | `ssh root@72.60.158.97 "echo OK"` |
| 6 | `backup-vps.sh` presente en VPS | `ssh root@72.60.158.97 "test -f /root/scripts/backup-vps.sh && echo OK"` |
| 7 | 4 containers UP | `ssh root@72.60.158.97 "docker ps \| grep chibalete"` (esperado: edge, front, api_1, api_2) |
| 8 | No hay deploy lock activo | `ssh root@72.60.158.97 "test -d /var/run/chib-deploy.lock && echo LOCK_PRESENT \|\| echo NO_LOCK"` |
| 9 | Disco VPS con > 5 GB libres | `ssh root@72.60.158.97 "df -BG /var"` |
| 10 | `validate ok=true` baseline | `curl -sH "x-admin-secret: $S" $URL/api/admin/membership/validate \| grep '"ok":true'` |

**Si cualquiera falla → NO proceder.** No hay excepciones de "pero esta vez es diferente".

---

## 2. Estrategia de smoke release

### 2.1 Qué archivo se toca

**Únicamente** `server/.release-marker`.

| Atributo | Valor |
|---|---|
| Path | `server/.release-marker` |
| Naturaleza | Texto plano ASCII |
| Leído por código de runtime | **NO** (sólo evidencia humana) |
| Tamaño esperado | ~300 bytes |
| Tracked en git | Sí |
| Sobrescrito en cada smoke | Sí |
| Riesgo de side-effect | **CERO** |

### 2.2 Cómo garantizar cero impacto funcional

1. El archivo `server/.release-marker` no es importado por ningún módulo de `server/`.
2. `healthHandler.js` lee `server/.deploy-info`, **NO** `.release-marker`.
3. Cualquier parser inválido en `.release-marker` no afecta startup de Express.
4. El cambio entra en el tarball que `deploy-backend.sh` arma — viaja por el flujo normal.
5. Se valida con `tar -tzf` post-empaquetado (B1 sanity).

### 2.3 Ejecución del smoke release

```bash
# 1) Preparar el cambio (genera tag automático y commit)
bash scripts/deploy-smoke-release.sh

# (Opcional) Push para trazabilidad remota
git push origin HEAD

# 2) Ejecutar el deploy (toma 5–10 min nominal)
bash scripts/deploy-backend.sh --release-tag rel-2026-05-08-smoke-001

# 3) Verificación post-deploy (5 puntos)
RELEASE_TAG=rel-2026-05-08-smoke-001
EXPECTED_SHA=$(git rev-parse HEAD)
curl -s "$PUBLIC_URL/api/health" | jq '{commit, version, deployed_at}'
#   → commit debe ser $EXPECTED_SHA
#   → version debe ser $RELEASE_TAG
#   → deployed_at debe ser ~ahora

ssh root@72.60.158.97 "cat /var/www/chibalete/server/.release-marker"
#   → release_tag=$RELEASE_TAG
#   → git_sha=$EXPECTED_SHA

curl -sH "x-admin-secret: $S" "$PUBLIC_URL/api/admin/membership/validate" | jq '.ok'
#   → true
```

### 2.4 Verificación visual del cambio

```bash
# 3 puntos críticos para "el deploy realmente cambió algo":
#
# A) /api/health.commit (cambia con cada deploy)
diff <(curl -s "$PUBLIC_URL/api/health" | jq -r .commit) \
     <(echo "$EXPECTED_SHA")
#
# B) /api/health.deployed_at (cambia con cada deploy exitoso)
curl -s "$PUBLIC_URL/api/health" | jq .deployed_at
#   → ISO 8601 ~now (within 10 minutes)
#
# C) /var/www/chibalete/server/.release-marker (visual, en VPS)
ssh root@72.60.158.97 "head -10 /var/www/chibalete/server/.release-marker"
```

---

## 3. Checklist Pre-Deploy

Ejecutar **antes** de `deploy-backend.sh`:

```
LOCAL
[ ] git status --porcelain    → vacío
[ ] git rev-parse HEAD         → SHA capturado mentalmente
[ ] git fetch --all            → up-to-date con origin
[ ] npm run verify             → exit 0
[ ] npm run validate:local     → exit 0

REPO PREP (smoke release específico)
[ ] bash scripts/deploy-smoke-release.sh           → tag generado
[ ] cat server/.release-marker                     → release_tag, git_sha visibles
[ ] git log --oneline -1                           → commit "chore(release): rel-..."

VPS PRE-CHECK
[ ] ssh root@72.60.158.97 "echo OK"
[ ] ssh root@72.60.158.97 "df -BG /var"            → > 5 GB libres
[ ] ssh root@72.60.158.97 "docker ps | wc -l"      → ≥ 5 (4 chib + header)
[ ] ssh root@72.60.158.97 "docker ps | grep chibalete | wc -l"  → 4
[ ] ssh root@72.60.158.97 "test -d /var/run/chib-deploy.lock"   → exit ≠ 0 (no lock)
[ ] curl -sH "x-admin-secret: $S" $URL/api/admin/membership/validate
        | jq '.ok'                                  → true
[ ] curl -s $URL/api/health | jq '.commit'         → SHA actual capturado para comparación

OPERACIÓN
[ ] terminal con docker logs -f chibalete_api_1 abierta
[ ] terminal con docker logs -f chibalete_api_2 abierta
[ ] navegador con la app abierta (lista para smoke manual post)
[ ] hora actual en mente: deploy debe completar en < 10 min nominal
```

Si **algún ítem falla → ABORT.** Investigar antes de proceder.

---

## 4. Logs esperados durante el deploy

Lo que un operador VERÁ en su terminal mientras `deploy-backend.sh` corre:

### 4.1 Apertura

```
[2026-05-08T10:00:01Z] [INFO]  watchdog activo — timeout global 1800s (PID=12345)
[2026-05-08T10:00:01Z] [INFO]  Chibalete+ deploy-backend.sh — inicio
[2026-05-08T10:00:01Z] [INFO]    RELEASE_TAG = rel-2026-05-08-smoke-001
[2026-05-08T10:00:01Z] [INFO]    ACTOR       = nicolas.jimenez.a@gmail.com
[2026-05-08T10:00:01Z] [INFO]    VPS_HOST    = root@72.60.158.97
[2026-05-08T10:00:01Z] [INFO]    DRY_RUN     = 0
[2026-05-08T10:00:01Z] [INFO]    TIMEOUT     = 1800s
[2026-05-08T10:00:01Z] [INFO]  intentando adquirir lock en root@72.60.158.97:/var/run/chib-deploy.lock
[2026-05-08T10:00:02Z] [OK]    lock adquirido
```

### 4.2 Por fase

| Fase | Tiempo nominal | Logs clave esperados | NORMAL |
|---|---|---|---|
| **B0** preflight local | ~2 min | `git status limpio`, `npm run verify OK`, `npm run validate:local OK`, `RELEASE_TAG ... GIT_SHA ...` | npm run verify imprime sus propios logs (cientos de líneas) |
| **B1** empaquetado | ~5 s | `tarball: /tmp/chib-server-...`, `size: 250–300 KB`, `sha256: <16-char prefix>...`, `server/.deploy-info presente en tarball` | Tarball entre 200–500 KB |
| **B2** transferencia | ~30 s | `scp ...`, `checksum verificado en VPS`, `backup-vps.sh en VPS coincide con repo` | sha256 mismatch sería WARN serio |
| **B3** preflight remoto + backup | ~30–60 s | `4 containers UP`, `compose presente`, `server/ existe`, `/var ... GB libres`, `validate pre-deploy ok=true`, `BACKUP_TS=...`, `metadata.status=ok`, `7 artefactos backup presentes` | El backup-vps.sh imprime sus propias líneas dentro de este step |
| **B4** staging | ~10 s | `archivos canónicos presentes`, `server.js size=...`, `.deploy-info válido`, `perms server.js: ...` | Sólo si server.js es < 50KB se considera anomalía |
| **B5** ⚠ swap | < 1 s | `swap mv`, `server/ NUEVO en disco`, `server.old=...` | Si tarda > 5 s, FS está raro |
| **B6** restart api_1 | ~30 s | `docker stop`, `docker start`, `healthy: chibalete_api_1 (Xs)`, `validate aislado en api_1`, `api_1 validate ok=true`, `api_1 reporta commit=...` | Health típicamente en < 10 s |
| **B7** restart api_2 | ~30 s | igual que B6 pero api_2 | Igual |
| **B8** post-validate edge | ~5 s | `health edge ok`, `validate edge ok=true`, `counts == baseline` (o WARN si difiere) | Counts diff es WARN, no fatal — escrituras legítimas son posibles |
| **B9** smoke logs | ~5 s | `logs últimos 5min: 0 ERROR/SECURITY`, `memoria api_1: ...`, `deploys.log actualizado` | > 0 ERRORS = WARN; investigar pero no abortar |
| **B10** cleanup | ~3 s | `tarball remoto eliminado`, `staging dir eliminado`, `retention server.old-* (keep 3)`, `retention server.staging-* (keep 2)`, `retention server.failed-* (keep 5)` | Cleanup nunca debe borrar BACKUP_TS recién creado |

### 4.3 Cierre

```
═════ FASE B10 — Cleanup remoto ═════
[2026-05-08T10:08:55Z] [OK]    cleanup completado
[2026-05-08T10:08:55Z] [INFO]  lock liberado

╔═════════════════════════════════════════════════════════════════╗
║                  ✅ DEPLOY BACKEND EXITOSO                       ║
╠═════════════════════════════════════════════════════════════════╣
║ release_tag: rel-2026-05-08-smoke-001                          ║
║ git_sha:     a1b2c3d                                            ║
║ actor:       nicolas.jimenez.a@gmail.com                        ║
║ backup_ts:   2026-05-08T10-00-30Z                               ║
║ state:       done                                               ║
║ exit_code:   0                                                  ║
║ elapsed:     534s                                               ║
╠═════════════════════════════════════════════════════════════════╣
║ B0 ✓  preflight local — RELEASE_TAG=... GIT_SHA=...            ║
║ B1 ✓  tarball 255KB sha=...                                    ║
║ B2 ✓  tarball + backup-vps.sh en VPS                            ║
║ B3 ✓  backup OK — BACKUP_TS=...                                 ║
║ B4 ✓  staging extraído en ...                                   ║
║ B5 ✓  swap completo (server.old-... preservado)                 ║
║ B6 ✓  api_1 NUEVO healthy + validated                           ║
║ B7 ✓  api_2 NUEVO healthy + validated                           ║
║ B8 ✓  validate edge OK                                          ║
║ B9 ✓  registrado en /root/deploys.log                           ║
║ B10 ✓  cleanup completado                                       ║
╚═════════════════════════════════════════════════════════════════╝
```

---

## 5. Checklist Post-Deploy

Tras el cierre del banner ✅:

```
HEALTH ENDPOINTS
[ ] curl -s $URL/api/health | jq .commit       → coincide con git rev-parse HEAD
[ ] curl -s $URL/api/health | jq .version      → coincide con RELEASE_TAG
[ ] curl -s $URL/api/health | jq .deployed_at  → ISO 8601 dentro de últimos 10 min
[ ] curl -s $URL/api/health | jq .instance     → "chibalete_api_1" o "chibalete_api_2"
                                                  (cualquiera, depende de routing edge)
[ ] curl -s $URL/api/health | jq .uptime       → < 600 (api se reinició recién)

VALIDATE + COUNTS
[ ] curl -sH "x-admin-secret: $S" $URL/api/admin/membership/validate | jq .ok
        → true
[ ] counts comparados con baseline pre-deploy → coinciden o difieren por escrituras
        legítimas (lectores marcando progreso, etc.)

VPS DIRECTO
[ ] ssh root@72.60.158.97 "cat /var/www/chibalete/server/.release-marker"
        → release_tag, git_sha del smoke
[ ] ssh root@72.60.158.97 "tail -1 /root/deploys.log"
        → línea con backend $RELEASE_TAG sha=... actor=... backup=...
[ ] ssh root@72.60.158.97 "ls -1dt /var/www/chibalete/server.old-*"
        → primer item es server.old-$BACKUP_TS recién creado
[ ] ssh root@72.60.158.97 "ls /root/backups/chibalete/$BACKUP_TS"
        → 7 archivos esperados

LOGS api_X
[ ] docker logs --since 10m chibalete_api_1 | grep -cE 'ERROR|SECURITY'   → 0
[ ] docker logs --since 10m chibalete_api_2 | grep -cE 'ERROR|SECURITY'   → 0
[ ] docker logs --tail 50 chibalete_api_1 | grep -i "listening on"        → presente

SMOKE FUNCIONAL (manual, en navegador, 2 min)
[ ] login con cuenta admin                       → OK
[ ] abrir Aula Viva                              → carga, ve grupos
[ ] abrir un Visor (texto/PDF/album)             → carga
[ ] abrir Bitacora                               → carga
[ ] abrir un libro y leer 1 minuto               → progreso se sincroniza
```

Si **TODO verde**: ✅ smoke release exitoso. Sprint 022 validado operacionalmente.
Si **algún punto falla**: ver §7 (decision tree).

---

## 6. Failure injection matrix

Pruebas controladas para validar que el sistema falla **de manera segura**.
**NO ejecutar en producción real durante horario de tráfico.**

| # | Inyección | Cómo simular | Estado esperado | Rollback esperado | Recovery |
|---|---|---|---|---|---|
| F1 | `validate ok=false` pre-deploy | Editar manualmente `users_db.json` para crear orphan_studentId, luego correr deploy | B3 captura ok=false → exit 4 | NO se ejecuta swap | `syncGroupMembership` para limpiar drift, deshacer edición manual |
| F2 | `npm run verify` falla | Romper un test temporalmente | B0 exit 1 | NO toca VPS | Revertir cambio de test |
| F3 | Disk full mid-deploy | `dd if=/dev/zero of=/var/full bs=1M count=N` para llenar disco a < 5 GB | B3 detecta `< MIN_FREE_GB_REMOTE` → exit 4 | NO swap | `rm /var/full`; reintentar |
| F4 | Lock contention | Dos terminales ejecutan `deploy-backend.sh` simultáneamente | Segundo: exit 11, muestra owner.txt | Primero continúa normal | Esperar primero o `rm -rf /var/run/chib-deploy.lock` si es residual |
| F5 | sha256 mismatch tarball | Manualmente corromper el tarball en VPS entre B2 y B3 (no ejecutable en práctica con BatchMode ssh) | B2 detecta mismatch → exit 3 | Nada en VPS aún cambió | Re-correr |
| F6 | api_1 no llega healthy | Push código que crashea Express al startup | B6 health poll timeout 30s → `rollback_code("api1_failed_health")` → exit 7 | Auto: server VIEJO restaurado, api_1 vuelve a healthy con código viejo | Revisar logs; fix; re-deploy |
| F7 | api_2 no llega healthy | Igual pero variable que sólo se cae en api_2 | B7 → `rollback_code("api2_failed_health")` → exit 8 | Auto: server VIEJO restaurado en AMBOS, restart staggered de ambos | Igual que F6 |
| F8 | validate edge ok=false post-deploy | Difícil de simular limpiamente; equivale a "deploy escribió mal en JSONs" | B8 exit 9 | **NO automático** — decisión humana | Revisar issues; decidir rollback de código solo o restore data desde backup (último recurso) |
| F9 | Watchdog timeout | `GLOBAL_TIMEOUT_S=10 bash deploy-backend.sh ...` → corte forzado | trap EXIT corre, exit 12, lock posiblemente residual | Indeterminado dependiendo de fase | Inspeccionar manualmente; limpiar lock; recovery según fase |
| F10 | Partial swap (server/ ausente) | `ssh root@VPS "mv /var/www/chibalete/server /tmp/manual-test"` antes de deploy | B3 hardening detecta `server/` ausente → exit 4 con instrucciones de recovery | NO swap | Restaurar server/ con `mv /tmp/manual-test /var/www/chibalete/server` |
| F11 | Backup falla (backup-vps.sh exit ≠ 0) | Cambiar permisos de `/root/backups/chibalete/` a 000 | B3 detecta exit code, exit 4 | Nada tocado | Restaurar permisos |
| F12 | ssh disconnect mid-deploy | Cortar la red local mientras corre B6 | Watchdog dispara en HEALTH_TIMEOUT_S, `ssh` falla, ERR trap, exit dependiente de fase | Si DEPLOY_STATE=swapped o api1_new → rollback corre vía ssh; si ssh sigue caído, exit 99 | Reconectar, inspeccionar estado, recovery manual |

**Cómo correr una inyección de forma controlada**:

1. Asegurar que estás en horario de tráfico bajo (idealmente: ningún tráfico).
2. Anunciar internamente: "Voy a inyectar fallo F<N> para validar pipeline".
3. Snapshot de estado pre: `curl /api/health > pre-injection.json; ssh root@VPS "ls /var/www/chibalete/" > pre-injection.txt`.
4. Inyectar.
5. Capturar logs del deploy + estado post.
6. Restaurar precondiciones si la inyección las cambió.
7. Documentar en `/root/deploys.log` con prefijo `INJECTION-DRILL`.

---

## 7. Decision tree: cuándo abortar / rollback / decisión humana

```
                     ┌───────────────────────────┐
                     │  Fallo detectado en fase  │
                     └────────────┬──────────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
        Pre-B5                  B5                    B6/B7
       (B0–B4)             (swap atómico)         (restart staggered)
            │                     │                     │
            ▼                     ▼                     ▼
      ABORT seguro           ABORT INCIERTO        ROLLBACK AUTO
       Nada tocado.          (ver §10 mid-swap     server.old-* →
       Re-correr tras         recovery)            server. Restart.
       fix.                                        Validate post.
                                                          │
                                                          ▼
                                                  ┌───────────────┐
                                                  │   B8 fallo    │
                                                  └───────┬───────┘
                                                          │
                                                          ▼
                                              DECISIÓN HUMANA
                                              ¿código nuevo correcto
                                              y data driftada?
                                              o ¿código nuevo introdujo
                                              drift?
                                                          │
                                              ┌───────────┴───────────┐
                                              │                       │
                                       Drift pre-existente     Drift introducido
                                              │                       │
                                              ▼                       ▼
                                       Aceptar / fix con         Rollback código
                                       sync-membership           SIN restore data
                                                                        │
                                                                        ▼
                                                                 Si validate sigue
                                                                 ok=false → opción
                                                                 EXTREMA: restore
                                                                 data desde backup
                                                                 (retrocede ops
                                                                 legítimas)
```

### Cuándo hacer rollback automático (lo hace el script)
- B6 fail (api_1 no healthy o validate ok=false)
- B7 fail (api_2 no healthy)

### Cuándo NO se hace automático
- B8 fail (post-validate edge): `exit 9`, escala a humano. El código nuevo PUEDE estar bien.
- B5 fail: estado incierto, requiere inspección manual.
- Rollback fallido: `exit 99`, escalar.

### Cuándo el operador hace rollback manual
1. Notó algo raro post-deploy (smoke funcional malo, métricas raras, reportes de usuario)
2. → `bash scripts/rollback-drill.sh` (discovery)
3. → confirma decisión
4. → `bash scripts/rollback-drill.sh --execute`

---

## 8. Rollback Drill — walkthrough completo

Objetivo: demostrar que `rollback_code()` funciona realmente, sin esperar a un incidente real.

### 8.1 Setup (estado A: producción actual)

```bash
# Capturar estado A
curl -s $URL/api/health > pre-drill-state.json
ssh root@72.60.158.97 "ls /var/www/chibalete/server.old-* | head -3" > pre-drill-old-list.txt
```

### 8.2 Smoke release (estado A → B)

```bash
bash scripts/deploy-smoke-release.sh
# → genera rel-YYYY-MM-DD-smoke-001 y commit
git push origin HEAD                                         # opcional pero recomendado
bash scripts/deploy-backend.sh --release-tag rel-YYYY-MM-DD-smoke-001
# → deploy completo en ~5 min

# Verificar B activado
curl -s $URL/api/health | jq '.commit'                       # debe ser nuevo SHA
ssh root@72.60.158.97 "cat /var/www/chibalete/server/.release-marker"  # debe ser nuevo
```

### 8.3 Drill discovery (sin tocar nada)

```bash
bash scripts/rollback-drill.sh
# → imprime estado actual, server.old-* candidatos, plan de rollback
# → exit 0 sin tocar VPS
```

### 8.4 Drill ejecución (estado B → A)

```bash
bash scripts/rollback-drill.sh --execute
# → confirma con operador antes de cada fase
# → snapshot del código current → server.failed-drill-<TS>
# → restaura server.old-<TS> → server
# → restart staggered api_1 (poll health)
# → restart staggered api_2 (poll health)
# → valida vía edge
# → registra entry "DRILL-ROLLBACK ..." en /root/deploys.log
```

### 8.5 Verificación post-drill (¿estado A restaurado?)

```bash
# health debe reflejar el commit anterior al smoke
curl -s $URL/api/health | jq '.commit'
# → coincide con pre-drill-state.json.commit

# .release-marker debe ser el del release ANTERIOR al smoke
ssh root@72.60.158.97 "head -10 /var/www/chibalete/server/.release-marker"

# validate sigue ok=true
curl -sH "x-admin-secret: $S" $URL/api/admin/membership/validate | jq '.ok'

# data, data-critical, uploads NO modificados (invariante del drill)
ssh root@72.60.158.97 "ls -la /var/www/chibalete/data/users_db.json"
# → mtime sin cambios respecto a antes del drill
```

### 8.6 Cleanup post-drill

```bash
# El server.failed-drill-<TS> queda preservado por 7 días (cleanup retention)
# Si quieres limpiarlo manualmente:
ssh root@72.60.158.97 "rm -rf /var/www/chibalete/server.failed-drill-<TS>"

# El smoke release puede quedar revertido (estado A) o re-aplicarse
# (deploy normal hacia adelante con MISMO o NUEVO tag).
```

---

## 9. Qué es NORMAL / qué NO es normal

### NORMAL durante deploy
- ✅ Logs `[INFO]` cada 1–10 segundos
- ✅ B0 imprime cientos de líneas de tests (npm run verify, validate:local)
- ✅ B6/B7 toma ~30 s cada uno (docker stop graceful + start + health poll)
- ✅ Counts cambian ligeramente entre B3 baseline y B8 post (escrituras legítimas)
- ✅ `[OK]` líneas verdes al final de cada fase
- ✅ Banner `✅ DEPLOY BACKEND EXITOSO` al final

### NORMAL pero merece atención
- ⚠️ Más de 0 líneas ERROR/SECURITY en últimos 5min (B9 imprime WARN). Pueden ser pre-existentes.
- ⚠️ Counts difieren significativamente. Investigar pero no necesariamente rollback.
- ⚠️ Backup-vps.sh exit 3 (retention falló pero backup OK). Aceptable.

### NO normal — investigar inmediatamente
- 🔴 SHA256 mismatch en B2 (red corrompió el tarball)
- 🔴 Un container faltante en B3 (caído pre-deploy)
- 🔴 Lock activo cuando no debería (otro deploy concurrente o orphan)
- 🔴 `validate ok=false` en B3 (drift pre-existente bloquea deploy)

### Anómalo — abort + rollback
- 🔴🔴 B6: api_1 no healthy en 30 s con código nuevo (script auto-rollback)
- 🔴🔴 B7: api_2 no healthy en 30 s (script auto-rollback)
- 🔴🔴 Watchdog dispara timeout (script termina con exit 12)

### Crítico — escalar
- 🔴🔴🔴 Rollback falló (exit 99)
- 🔴🔴🔴 server.old-$BACKUP_TS no existe cuando se necesita
- 🔴🔴🔴 `validate ok=false` post-rollback (posible corrupción de data)

---

## 10. Recovery: estados intermedios

### 10.1 Mid-swap state recovery (server/ ausente)

**Síntoma**:
```bash
ssh root@VPS "ls -la /var/www/chibalete/" 
# → server/ NO listado, server.old-<TS> y server.staging-<TAG>/server presentes
```

**Causa**: deploy-backend.sh murió entre los dos `mv` de B5 (ssh disconnect, kill, etc.).

**Recovery (orden de preferencia)**:
```bash
# 1) Restaurar desde server.old más reciente (más conservador)
ssh root@VPS 'mv /var/www/chibalete/server.old-$(ls -1dt /var/www/chibalete/server.old-* | head -1 | xargs basename | sed s/server.old-//) /var/www/chibalete/server'

# o más simple:
ssh root@VPS 'cd /var/www/chibalete && OLD=$(ls -1dt server.old-* | head -1) && mv "$OLD" server'

# 2) Restart staggered manual (NO ambos a la vez):
ssh root@VPS 'docker stop chibalete_api_1 --time=30 && docker start chibalete_api_1'
# Esperar healthy (la imagen NO incluye curl; usar node):
ssh root@VPS "docker exec -i chibalete_api_1 node -e 'require(\"http\").get(\"http://localhost:3000/api/health\",r=>r.pipe(process.stdout))'"

ssh root@VPS 'docker stop chibalete_api_2 --time=30 && docker start chibalete_api_2'
ssh root@VPS "docker exec -i chibalete_api_2 node -e 'require(\"http\").get(\"http://localhost:3000/api/health\",r=>r.pipe(process.stdout))'"

# 3) Validate
curl -sH "x-admin-secret: $S" $URL/api/admin/membership/validate | jq '.ok'

# 4) Anotar en deploys.log:
ssh root@VPS "echo '$(date -u +%Y-%m-%dT%H:%M:%SZ) RECOVERY-MID-SWAP rolled-back-to <OLD_TS> actor=...' >> /root/deploys.log"
```

### 10.2 Lock orphan recovery

**Síntoma**: deploy aborta con exit 11, owner.txt muestra PID/actor previo, pero ese deploy ya terminó.

**Recovery**:
```bash
# Verificar que el operador del lock NO está ejecutando deploy actualmente
# (preguntar por canal interno antes de tocar)
ssh root@VPS "cat /var/run/chib-deploy.lock/owner.txt"

# Si confirmado orphan:
ssh root@VPS "rm -rf /var/run/chib-deploy.lock"

# Re-correr deploy normalmente
```

### 10.3 server.failed-* lleno de evidencia

**Síntoma**: `ls /var/www/chibalete/server.failed-*` muestra muchos.

**Acción**:
- Si > 5 (CLEANUP_KEEP_FAILED): el próximo deploy exitoso los reduce automáticamente en B10.
- Si quieres conservar uno específico para post-mortem: `cp -a server.failed-<TS> /root/forensics/`.

---

## 11. Métricas mínimas que el operador debe observar

| Métrica | Cómo capturar | Threshold normal |
|---|---|---|
| Uptime de api_1/api_2 | `curl /api/health \| jq .uptime` | > 60 s post-deploy; sostenido sin reseteos |
| Memoria api_X | `docker stats --no-stream chibalete_api_1` | < 500 MB cada uno (JSONs no crecen mucho) |
| Errores en logs últimos 10min | `docker logs --since 10m \| grep -cE 'ERROR\|SECURITY'` | 0–5 (puntos pre-existentes); > 50 = anómalo |
| Validate counts | `curl /api/admin/membership/validate \| jq .counts` | Variación < 10% entre deploys |
| Disk free /var | `df -BG /var` | > 5 GB |
| Disk free /root (backups) | `df -BG /root` | > 10 GB para 7 días retention |

---

## 12. Lista de comandos copy-paste para emergencia

### Estado completo en una sola línea
```bash
ssh root@72.60.158.97 'echo "--- docker ps ---"; docker ps --format "{{.Names}}\t{{.Status}}"; echo "--- df ---"; df -h /var /root; echo "--- lock ---"; ls /var/run/chib-deploy.lock 2>&1; echo "--- last deploy ---"; tail -5 /root/deploys.log; echo "--- last backup ---"; ls -1dt /root/backups/chibalete/ | head -3'
```

### Health de las dos instancias
```bash
ssh root@72.60.158.97 "for c in chibalete_api_1 chibalete_api_2; do echo \"--- \$c \---\"; docker exec -i \"\$c\" node -e 'require(\"http\").get(\"http://localhost:3000/api/health\",r=>r.pipe(process.stdout))' 2>&1; echo; done"
```

### Validate edge + counts
```bash
curl -sH "x-admin-secret: $ADMIN_SECRET" "https://chibaleteplus.chibaleteeditores.com/api/admin/membership/validate" | jq '{ok, counts, issuesCount: (.issues | length)}'
```

### Rollback inmediato (smoke release fallido)
```bash
bash scripts/rollback-drill.sh --execute
```

---

---

## 13. Post-deploy monitoring window (30 minutos)

> El deploy NO termina cuando `deploy-backend.sh` imprime ✅.
> Termina cuando 30 minutos después el sistema sigue estable.

### 13.1 Por qué 30 minutos

- **0–2 min**: si Express crashea al startup, lo detecta `B6/B7` (ya manejado).
- **2–5 min**: bugs de inicialización lazy (config cache, modules cargados on-demand) emergen aquí.
- **5–15 min**: memory leaks típicamente medibles. Cada request mal liberado se acumula.
- **15–30 min**: timers, schedulers, retry loops empiezan a ejecutarse. Bugs de lógica programada aparecen.
- **>30 min**: lo que no falla aquí, no falla por causas del deploy.

### 13.2 Qué vigilar (en orden de impacto)

```
TERMINAL 1 — logs en tiempo real (api_1)
  ssh root@72.60.158.97 'docker logs --since 1m -f chibalete_api_1' \
    | grep -iE 'error|warn|exception|trace'

TERMINAL 2 — logs api_2
  ssh root@72.60.158.97 'docker logs --since 1m -f chibalete_api_2' \
    | grep -iE 'error|warn|exception|trace'

TERMINAL 3 — health spot-checks cada 5 min
  while true; do
    curl -s https://chibaleteplus.chibaleteeditores.com/api/health \
      | jq -c '{instance, uptime, commit, deployed_at}'
    sleep 300
  done

TERMINAL 4 — uptime loop sobre validate
  while true; do
    curl -sH "x-admin-secret: $ADMIN_SECRET" \
      https://chibaleteplus.chibaleteeditores.com/api/admin/membership/validate \
      | jq -c '{ok, counts}'
    sleep 600
  done

TERMINAL 5 — memoria de containers
  ssh root@72.60.158.97 'docker stats --no-stream chibalete_api_1 chibalete_api_2'
  # repetir cada ~5 min; si una crece linealmente sin techo → memory leak nuevo
```

### 13.3 Patrones de comportamiento

| Patrón observado | Interpretación | Acción |
|---|---|---|
| Logs fluyen tranquilos, 0 ERROR | Deploy OK | Esperar a los 30 min, declarar éxito |
| 1–2 ERROR esporádicos pero el sistema sigue respondiendo | Probablemente errores pre-existentes que pasan tráfico real (ej: usuarios con datos malformados que ahora se loguean) | Monitorear, no rollback inmediato |
| Memoria sube linealmente sin techo en 15 min | Memory leak introducido por el deploy | **ROLLBACK**. Investigar después. |
| api_1 reinicia solo (uptime resetea) sin que tú hayas tocado nada | Crash + restart automático docker | **ROLLBACK**. Express crashea con el código nuevo |
| validate.ok pasa de true a false sin tu intervención | Drift inducido por el deploy | **ROLLBACK + investigar issues** |
| Latencia /api/health > 1 s sostenida | Algo bloquea el event loop | **ROLLBACK** |
| Logs llenos de un mismo error nuevo no visto antes | Bug del código nuevo | **ROLLBACK** |

### 13.4 Decisión a los 30 minutos

```
30 min post-deploy:

  ┌─────────────────────────────┐
  │ ¿Cero ERROR/SECURITY nuevos?│
  │ ¿Memoria estable?           │
  │ ¿Uptime sostenido?          │
  │ ¿validate.ok=true?          │
  └──────────────┬──────────────┘
                 │
        ┌────────┴────────┐
        │                 │
       SÍ                NO
        │                 │
        ▼                 ▼
   Declarar           Decidir:
   ✅ éxito          rollback inmediato
   en deploys.log:   o investigar más?
   "30min-stable"
                     Si dudas → ROLLBACK
                     ("podemos siempre redeployar")
```

### 13.5 Anotación post-validación

```bash
ssh root@72.60.158.97 \
  "echo '$(date -u +%Y-%m-%dT%H:%M:%SZ) backend-stable-30m $RELEASE_TAG actor=...' >> /root/deploys.log"
```

Eso deja huella explícita de que el deploy se validó por 30 min de tráfico
real, no sólo que pasó B0–B10.

---

## 14. Incident response — postmortem template

Si el primer deploy real (o cualquier futuro) revela un problema, NO buscar
culpables. Documentar el incidente para hardening derivado.

### 14.1 Postmortem template (markdown, blameless)

```markdown
# Incident YYYY-MM-DD-<short-slug>

**Severidad**: SEV-1 (downtime > 5 min) / SEV-2 (degradación) / SEV-3 (cosmético)
**Duración**: <inicio detection> → <recovery confirmed>
**Impacto observable**: <qué vieron los usuarios, si algo>
**RELEASE_TAG involucrado**: rel-...
**BACKUP_TS pre-incidente**: <TS>

---

## Timeline (UTC)

| Hora | Evento | Fuente |
|---|---|---|
| HH:MM | deploy-backend.sh iniciado por <actor> | terminal local |
| HH:MM | B5 swap completado | log |
| HH:MM | B6 api_1 health OK | log |
| HH:MM | <síntoma observado> | <quién lo notó> |
| HH:MM | rollback-drill.sh --execute iniciado | log |
| HH:MM | rollback completado, validate ok=true | log |
| HH:MM | sistema estable confirmado por monitoreo | logs + health |

---

## Detection

¿Cómo se detectó?
- ¿Alerta automática? (no tenemos hoy — sólo human-eyeball)
- ¿Operador monitoreando logs vio X?
- ¿Reporte de usuario?
- ¿Métrica fuera de rango?

¿Tiempo desde el primer síntoma hasta detección? (TTD)

---

## Blast radius

¿Qué se afectó?
- ¿Cuántos usuarios? (estimar)
- ¿Qué endpoints?
- ¿Qué duración?
- ¿Hubo data loss? (esperamos no — invariante I1–I3)
- ¿Hubo data corruption? (verificar con validate)

---

## Root cause

(escribir DESPUÉS de investigación, no en caliente)

¿Qué línea de código / configuración / infraestructura causó esto?

¿Por qué no se detectó pre-deploy?
- ¿Faltaba un test?
- ¿Se ejecutó el test pero pasó por suerte?
- ¿npm run verify cubrió esto y aún así no se detectó?
- ¿Era detectable solo en producción real?

¿Por qué el deploy llegó hasta donde llegó antes de fallar?
- ¿B6 health pasó pero validate fallaría con tráfico real?
- ¿B8 detectó counts diff pero como WARN se ignoró?

---

## Recovery

- ¿Rollback automático funcionó? (B6/B7) o ¿manual? (B8/B9)
- ¿Cuánto tardó el rollback?
- ¿`rollback_code()` o `rollback-drill.sh`?
- ¿Hubo recovery manual fuera de los scripts?
- ¿Se restauró data? (esperamos no)

---

## Follow-up actions

| # | Acción | Responsable | Deadline | Sprint |
|---|---|---|---|---|
| 1 | Agregar test que detecte X pre-deploy | | | 023 |
| 2 | Mejorar mensaje de log Y para próxima ocasión | | | 023 |
| 3 | Documentar en runbook §6 (failure injection) | | | 022.9 |

---

## Hardening derivado

¿Qué cambia en el sistema operacional para prevenir / detectar más rápido?

- [ ] Test agregado a `npm run verify` (commit: <SHA>)
- [ ] Aserción agregada a `validate-local.mjs` (commit: <SHA>)
- [ ] Mensaje de log mejorado en deploy-backend.sh (commit: <SHA>)
- [ ] Sección agregada a runbook (commit: <SHA>)
- [ ] Alerta agregada (cuando exista alerting — P1)

---

## Lecciones (sin culpas)

¿Qué aprendimos como sistema operacional?
¿Qué demostró que YA funcionaba?
¿Qué reveló como falso supuesto?
¿Qué runbook fue útil? ¿Cuál hizo falta?
```

### 14.2 Reglas de cultura postmortem

1. **Foco en sistema, no en personas.** Cualquier humano cansado a las 3 a.m. comete errores. El sistema debe asumirlo.
2. **El operador que detecta y reporta el incidente NO es el culpable. Es el héroe.**
3. **El postmortem se escribe ANTES de cerrar el ticket**, no después.
4. **El follow-up tiene deadline real**, no "algún día".
5. **El postmortem se VINCULA a un commit/PR de hardening derivado**, sino no cierra.
6. **Si el mismo tipo de incidente ocurre dos veces sin hardening en medio**, eso es el bug crítico.

### 14.3 Quién escribe el postmortem

- Operador del deploy (responsable primario)
- Otra persona técnica que revise (idealmente)
- Plazo: 48 h desde recovery confirmed

### 14.4 Dónde vive el postmortem

```
docs/incidents/YYYY-MM-DD-<slug>.md
```

(Crear `docs/incidents/` cuando ocurra el primero. No pre-crear vacío.)

---

> Última actualización: Sprint 022 / Fase 2B.9.
> Si la operación real revela que algo de este runbook no refleja la realidad
> del VPS, **se actualiza este documento inmediatamente** — la doc y la
> realidad son una sola cosa.
