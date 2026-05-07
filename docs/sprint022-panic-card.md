# Chibalete+ — Panic Card (1-page)

> Una hoja. Sólo lo que el operador necesita en pantalla durante el deploy.
> Si necesitas más detalle: `docs/sprint022-runbook.md`. Pero NO durante un incidente.

---

## ANTES (T-1h)

```
[ ] dormí ≥ 7 h        [ ] segundo humano alcanzable
[ ] git status: clean  [ ] curl /api/health: status=ok
[ ] ssh OK             [ ] lock libre
[ ] disco > 5 GB       [ ] validate ok=true
```

---

## DURANTE — qué mirar (5 terminales)

```
T1 deploy log    | T2 api_1 errors  | T3 api_2 errors
T4 health loop   | T5 emergencia (preparado, NO enviar)
```

**Calma**: `[OK]` líneas verdes / logs T2-T3 quietos / uptime monotónico.
**Peligro**: ERROR storm / uptime resetea / app reportada caída.

---

## SI EL BANNER MUESTRA exit_code...

| exit | acción inmediata |
|---|---|
| 0 | NO cerrar 30 min. Hoja 2 verificación. |
| 1–5 | Nada tocado en VPS. Investigar log, fix, re-correr. |
| 6 | 🔴 ESTADO INCIERTO. Recovery manual: `ssh root@VPS 'cd /var/www/chibalete && OLD=$(ls -1dt server.old-* \| head -1) && mv "$OLD" server'` |
| 7–8 | Rollback automático YA hecho. Investigar logs api_X. NO actuar. |
| 9 | DECISIÓN HUMANA ≤ 5 min. Hoja 4 si decides rollback. |
| 11 | Lock activo. Confirmar con otro operador antes de `rm -rf`. |
| 12 | Watchdog. Inspeccionar VPS antes de re-correr. |
| 99 | 🔴🔴 ESCALAR. NO actuar solo. |

---

## DECISIONES BAJO PRESIÓN — regla de 5 minutos

> **Mínimo 5 min de observación antes de rollback no automático.**
> 1 ERROR ≠ rollback. ERROR storm sostenido = rollback.

| Síntoma | NO rollback | SÍ rollback |
|---|---|---|
| 1-2 ERROR pre-existentes | ✓ | — |
| ERROR nuevo no visto antes | — | ✓ |
| Uptime creciendo | ✓ | — |
| Uptime resetea ≥ 2 veces | — | ✓ |
| Counts diff ≤ 5 entries | ✓ | — |
| Counts diff > 10 sin explicación | — | ✓ |
| Latency 200-500ms ocasional | ✓ | — |
| Latency > 1s sostenido | — | ✓ |
| Reporte concreto de usuario | — | ✓ inmediato |

---

## ROLLBACK — un solo comando

```bash
bash scripts/rollback-drill.sh --execute
```

Confirma `[y/N]` por fase. Tarda ~2 min. Restaura código, NO data.

---

## SI PIERDES SSH MID-DEPLOY

1. **NO PÁNICO.** Watchdog matará el script local en `GLOBAL_TIMEOUT_S`.
2. Reconecta en otra terminal: `ssh root@72.60.158.97 "ls -la /var/www/chibalete/"`
3. Si `server/` existe → estado OK, ver logs api_X.
4. Si `server/` ausente → SIGUIENTE ACCIÓN exit 6 arriba.
5. Si lock orphan → `ssh root@VPS "rm -rf /var/run/chib-deploy.lock"` (sólo si confirmas que tu deploy murió).

---

## VERIFICACIÓN T+0 (justo después del banner ✅)

```bash
EXPECTED_SHA=$(git rev-parse HEAD)
RELEASE_TAG=rel-2026-05-XX-smoke-001
curl -s "$URL/api/health" | jq '{commit,version,deployed_at,instance}'
ssh root@72.60.158.97 "cat /var/www/chibalete/server/.release-marker"
ssh root@72.60.158.97 "tail -1 /root/deploys.log"
```

Los 4 deben coincidir con tu RELEASE_TAG/SHA. Si NO coinciden → investigar antes de declarar éxito.

---

## VERIFICACIÓN T+30min (cierre monitoring)

```bash
ssh root@72.60.158.97 "echo '$(date -u +%Y-%m-%dT%H:%M:%SZ) backend-stable-30m $RELEASE_TAG actor=$ACTOR' >> /root/deploys.log"
```

Sólo si: 0 ERROR/SECURITY nuevos, memoria estable, uptime sostenido, validate.ok=true, smoke A/B/C/D verde.

---

## NO HAGAS JAMÁS DURANTE EL DEPLOY

- ❌ `docker compose down` / `restart`
- ❌ `git push --force` / `git reset --hard` en el VPS
- ❌ `rm -rf /var/www/chibalete/data*`
- ❌ `docker stop` ambos api_X simultáneamente
- ❌ Editar archivos en VPS con `nano` / `docker exec`
- ❌ Restore data automático
- ❌ Decidir rollback en < 1 minuto sin leer logs
- ❌ `--yes` flag manualmente (sólo CI)

---

## TELÉFONO ROJO — si exit 99 o no sabes qué hacer

```
1) NO actuar solo
2) Mensajería al segundo humano
3) ssh root@72.60.158.97 "ls -la /var/www/chibalete/" → tomar foto
4) ssh root@72.60.158.97 "tail -50 /root/deploys.log" → tomar foto
5) NO restaurar data sin escritura humana documentada
```

---

> **Si lo único que recuerdas bajo presión es esta carta: alcanza.**
