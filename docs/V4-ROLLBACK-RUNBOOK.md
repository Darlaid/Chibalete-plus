# V4 Rollback Runbook — comandos exactos

> Plan de rollback **escalonado** y **reversible**. Cada nivel es
> progresivamente más invasivo. **Empezar por el más leve.**
>
> **Regla absoluta**: datos NO se restauran salvo corrupción confirmada
> y aceptada por dirección. Pérdida de eventos recientes es preferible a
> sobrescribir state actual con backup viejo.

## 0. Decidir el tipo de problema

| Síntoma | Nivel rollback |
|---|---|
| Feature v4 mal comportada pero auth + lector OK | **Nivel 1 — flags OFF** |
| Backend devuelve 5xx en endpoints v4 (Aula Viva, Leo events) | **Nivel 1 + monitor** |
| Backend devuelve 5xx en endpoints core (auth, content, /api/users) | **Nivel 2 — revert backend** |
| Frontend roto (página blanca, crash) | **Nivel 3 — revert frontend** |
| Backend + frontend rotos | **Nivel 4 — revert ambos** |
| events.db corrupta o data inconsistente | **Nivel 5 — restaurar backup** (último recurso) |

## Nivel 1 — Apagar flags v4 (rollback instantáneo, sin redeploy)

**Tiempo estimado: 30 segundos**. No requiere swap de imagen ni de code.

```bash
ssh root@72.60.158.97 << 'EOF'
sudo -i
# Editar /opt/chibaleteplus/.env y poner OFF todos los flags v4:
sed -i.bak \
    -e 's/^LEO_EVENTS_BACKBONE_ENABLED=.*/LEO_EVENTS_BACKBONE_ENABLED=0/' \
    -e 's/^LEO_SIGNAL_EXTRACTION_ENABLED=.*/LEO_SIGNAL_EXTRACTION_ENABLED=0/' \
    -e 's/^AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED=.*/AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED=0/' \
    -e 's/^AULA_VIVA_AUDIT_EVENTS_ENABLED=.*/AULA_VIVA_AUDIT_EVENTS_ENABLED=0/' \
    -e 's/^AULA_VIVA_COHORT_SUMMARIES_ENABLED=.*/AULA_VIVA_COHORT_SUMMARIES_ENABLED=0/' \
    /opt/chibaleteplus/.env
diff /opt/chibaleteplus/.env /opt/chibaleteplus/.env.bak | head -10

# Si IMMERSIVE_V2 estaba activo y rompe, forzar killswitch:
grep -q 'IMMERSIVE_V2_KILLSWITCH' /opt/chibaleteplus/.env \
  || echo 'IMMERSIVE_V2_KILLSWITCH=1' >> /opt/chibaleteplus/.env

# Restart staggered
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_1
until curl -sf http://127.0.0.1:3001/api/health > /dev/null; do sleep 2; done
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_2
until curl -sf http://127.0.0.1:3002/api/health > /dev/null; do sleep 2; done
EOF
```

**Efecto:**
- `summaries[]` vuelve a vacío en `/api/aula-viva/students/:id/timeline`.
- Leo deja de emitir events (no se pierde nada, solo cesa el flujo).
- Audit events teacher_* dejan de emitir.
- Signal extraction Leo se detiene (snapshots existentes quedan).
- V2 inmersivo opcionalmente forzado a V1.

**No afecta:** events.db existente, signal_snapshots existentes, recomendaciones existentes, intervenciones, outcomes. Todo el state previo intacto.

## Nivel 2 — Revertir backend a tag/swap anterior

**Tiempo estimado: 2-3 minutos**. Restaura `server/` al estado pre-deploy.

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /var/www/chibalete

# 1. Listar swaps disponibles (creados por V4-DEPLOY-RUNBOOK §6)
ls -lt | grep '^d.*server'
# Esperado: server (actual)  +  server.old-<TAG_PREVIO>

# 2. Swap atómico inverso
mv server server.failed-$(date +%s)
mv server.old-<TAG_PREVIO> server         # reemplazar <TAG_PREVIO> con el real
ls server/ | head -5                       # validar

# 3. Restart staggered
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_1
until curl -sf http://127.0.0.1:3001/api/health > /dev/null; do sleep 2; done
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_2
until curl -sf http://127.0.0.1:3002/api/health > /dev/null; do sleep 2; done

# 4. Validar
curl -sf http://127.0.0.1:3001/api/health
curl -sf http://127.0.0.1:3002/api/health
EOF
```

## Nivel 3 — Revertir frontend a tag/imagen anterior

**Tiempo estimado: 1-2 minutos**. Recrea el container frontend con la imagen previa.

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus

# 1. Listar tags disponibles
docker images chibalete/front
# Esperado: chibalete/front:<TAG_V4>  +  chibalete/front:<TAG_PREVIO>

# 2. Restaurar tag previo en docker-compose.yml
# (el .bak fue creado por V4-DEPLOY-RUNBOOK §5)
mv docker-compose.yml docker-compose.yml.failed-$(date +%s)
mv docker-compose.yml.bak docker-compose.yml
grep 'chibalete/front:' docker-compose.yml

# 3. Recreate front
docker compose up -d --no-deps chibalete_front

# 4. Reload edge nginx
docker exec chibalete_edge nginx -t
docker exec chibalete_edge nginx -s reload

# 5. Validar
docker ps --filter name=chibalete_front
curl -sI https://chibaleteplus.chibaleteeditores.com/ | head -5
EOF
```

## Nivel 4 — Revertir ambos (backend + frontend)

Ejecutar **Nivel 2 luego Nivel 3**. No se puede en paralelo (api debe estar OK antes de cambiar front porque el front consume api).

## Nivel 5 — Restaurar backup de datos (último recurso)

**SOLO si hay corrupción confirmada de events.db, insights.db, users_db.json
o uploads que afecte operación.**

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail

# 1. Detener APIs escalonadamente (no down)
docker stop chibalete_api_1
docker stop chibalete_api_2

# 2. Confirmar backup disponible
ls -lh /opt/chibaleteplus/backups/ | tail -10
LATEST=$(ls -t /opt/chibaleteplus/backups/ | head -1)
echo "Restaurando desde: $LATEST"

# 3. Backup adicional del state actual (por si la restauración resulta peor)
cp -r /var/www/chibalete/data-critical /var/www/chibalete/data-critical.pre-restore-$(date +%s)

# 4. Restaurar SOLO el archivo corrupto identificado
# Ejemplo events.db (NO restaurar todo data-critical/ ciegamente):
tar xzf /opt/chibaleteplus/backups/$LATEST -C /tmp/restore-staging/
# Validar manualmente que el archivo restaurado es íntegro:
sqlite3 /tmp/restore-staging/data-critical/events.db 'PRAGMA integrity_check;'
# Si OK:
cp /tmp/restore-staging/data-critical/events.db /var/www/chibalete/data-critical/events.db
# Permisos correctos:
chown www-data:www-data /var/www/chibalete/data-critical/events.db
chmod 644 /var/www/chibalete/data-critical/events.db

# 5. Restart APIs
docker start chibalete_api_1
until curl -sf http://127.0.0.1:3001/api/health > /dev/null; do sleep 2; done
docker start chibalete_api_2
until curl -sf http://127.0.0.1:3002/api/health > /dev/null; do sleep 2; done

# 6. Documentar pérdida
# (eventos entre $LATEST y ahora se perdieron; ese es el costo del restore)
EOF
```

**Documentar inmediatamente:**
- Tabla restaurada
- Backup usado (timestamp)
- Ventana de pérdida (en horas/minutos)
- Razón del restore
- Responsable de la decisión

## Verificación post-rollback (cualquier nivel)

```bash
# Health
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health/ready
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health/analytics

# Login real
curl -X POST https://chibaleteplus.chibaleteeditores.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<ADMIN_REAL>","password":"<PASS_REAL>"}' | head -c 200

# Logs sin 500s recientes
ssh root@72.60.158.97 'docker logs chibalete_api_1 --since 5m | grep -E " 5[0-9]{2} " | head -5'
ssh root@72.60.158.97 'docker logs chibalete_api_2 --since 5m | grep -E " 5[0-9]{2} " | head -5'

# events.db crece normalmente (no parada total)
ssh root@72.60.158.97 'sqlite3 /var/www/chibalete/data-critical/events.db "SELECT COUNT(*) FROM events WHERE server_ts >= strftime(\"%s\",\"now\",\"-5 minutes\")*1000;"'
```

## Comandos PROHIBIDOS durante rollback

```
❌ docker compose down                       # NUNCA
❌ rm -rf data/ data-critical/ uploads/      # NUNCA (data del usuario)
❌ git reset --hard en el VPS                # NO se opera con git en el VPS
❌ docker rmi chibalete/front (sin tag)      # podría borrar el tag deseado
❌ npm run seed:admin-local                  # JAMÁS en VPS, ni siquiera en rollback
```

## Comunicación durante rollback

1. Anunciar en canal interno: "ROLLBACK Chibalete+ en curso — Nivel X"
2. Anotar timestamp inicio
3. Ejecutar runbook
4. Anotar timestamp fin
5. Reportar: nivel ejecutado, comandos clave, validaciones pasadas, observaciones
6. Crear ticket post-mortem en 24h si el rollback fue Nivel 3+
