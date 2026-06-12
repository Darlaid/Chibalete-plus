# 72h Observation Playbook — Post-Cloudflare Activation

**Cuándo arrancar:** inmediatamente después de Fase 2 completa (Cloudflare delante + MEDIA_BASE_URL configurado opcionalmente).
**Tiempo total:** 72h continuas
**Acción en caso de incidente:** rollback documentado en `CLOUDFLARE-CLICK-BY-CLICK.md` paso 12 + `fase2-activate-media-base-url.sh --rollback`

---

## Cadencia de chequeos

| Tiempo | Quién | Qué |
|---|---|---|
| T+0 (post-activación) | operator | Smoke test inmediato (sección 1) |
| T+30 min | operator | Check first cache HIT (sección 2) |
| T+2h | operator | Mini-bench + Grafana review (sección 3) |
| T+12h | operator | Hit ratio + bandwidth review (sección 4) |
| T+24h | operator | Day-1 health check (sección 5) |
| T+48h | operator | Day-2 stability (sección 6) |
| T+72h | operator | Go/no-go decision M3.1 deploy (sección 7) |

---

## 1. Smoke test inmediato (T+0)

```bash
# Desde tu máquina:
BASE=https://chibaleteplus.chibaleteeditores.com

# 1.1 - Cloudflare está delante
curl -sI $BASE/api/health | grep -iE "server|cf-ray"
# Esperar: server: cloudflare, cf-ray: ...

# 1.2 - API funciona
curl -s $BASE/api/health | jq
# Esperar: {"status":"ok","uptime":...}

# 1.3 - Asset cachea
curl -sI $BASE/uploads/audio/content-1776006983915/album/a30ae164a424.mp3 | grep -iE "cf-cache-status|content-length"
# Primera vez: MISS o EXPIRED
# Segunda vez: HIT

# 1.4 - /api/ no cachea
curl -sI $BASE/api/health | grep -i cf-cache-status
# Esperar: DYNAMIC o BYPASS

# 1.5 - App abre en browser
# Abrir https://chibaleteplus.chibaleteeditores.com
# Ver biblioteca, abrir 1 libro, validar
```

Si CUALQUIER paso falla → consultar `CLOUDFLARE-CLICK-BY-CLICK.md` paso 12 (Pause Cloudflare).

---

## 2. Cache HIT check (T+30 min)

```bash
ssh root@72.60.158.97 'curl -sI https://chibaleteplus.chibaleteeditores.com/uploads/audio/content-1776006983915/album/a30ae164a424.mp3 | grep cf-cache-status'
```

Esperar: `cf-cache-status: HIT` o `cf-cache-status: REVALIDATED`.

En Cloudflare dashboard → Analytics → Cache: revisar "Cached Bandwidth" vs "Total Bandwidth". Ratio inicial esperado 30-60%.

---

## 3. Mini-bench + Grafana (T+2h)

```bash
ssh root@72.60.158.97 'wrk -t2 -c30 -d20s --latency https://chibaleteplus.chibaleteeditores.com/uploads/audio/content-1776006983915/album/a30ae164a424.mp3 2>&1 | tail -15'
```

Comparar con baseline M2 (`docs/M2-final.md` o memoria: 90 MB/s pre-CDN).

Grafana queries (vía http://localhost:3001 tunnel):

```promql
# VPS bandwidth últimos 2h - debe haber caída visible si Cloudflare cachea
rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*|br-.*"}[5m])

# API request rate - sin cambio (Cloudflare no cachea /api/*)
sum(rate(chibalete_http_requests_total[5m]))

# /uploads/ requests al backend - debe ser CERO si Cloudflare cachea bien
sum(rate(chibalete_http_requests_total{route="/uploads/"}[5m]))
```

Snapshot esperado: si CDN cachea, **VPS bandwidth cae 50%+** y `/uploads/` requests al backend = 0 (siempre va via edge, no api).

---

## 4. Hit ratio + bandwidth (T+12h)

Cloudflare → Analytics → Cache:
- **Cache Hit Ratio:** esperado >70% día 1
- **Origin Requests:** esperado <30% del total
- **Bandwidth Saved:** verificable en GB

Grafana queries:

```promql
# Comparar vs baseline pre-CDN (carpeta: /opt/chibaleteplus/m3-snapshot-*/baseline-pre-cdn-*/metrics/)
# Pre-CDN VPS TX: 236 Bps (idle) o 67 MB/s (bench)
rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*|br-.*"}[1h])
```

**Criterio T+12h:** VPS bandwidth promedio post-CDN < 50% del baseline pre-CDN bajo carga similar.

---

## 5. Day-1 health check (T+24h)

```bash
ssh root@72.60.158.97 'echo "=== Containers ==="; docker ps --format "table {{.Names}}\t{{.Status}}"; echo; echo "=== Active alerts ==="; curl -s http://127.0.0.1:9093/api/v2/alerts | jq "length"; echo; echo "=== 5xx last hour ==="; curl -sG --data-urlencode "query=sum(rate(chibalete_http_requests_total{status_class=\"5xx\"}[1h]))" http://127.0.0.1:9090/api/v1/query | jq ".data.result"; echo; echo "=== Restart count ==="; for c in chibalete_edge chibalete_front chibalete_api_1 chibalete_api_2; do echo -n "$c: "; docker inspect $c | jq -r ".[0].RestartCount"; done; echo; echo "=== Swap usage ==="; swapon --show; free -h | head -2'
```

**Criterio T+24h** (todos deben ser true):
- [ ] 4/4 main containers healthy + 4-5 obs containers healthy (cadvisor sin healthcheck)
- [ ] Active alerts == 0
- [ ] 5xx rate < 0.1/s
- [ ] Restart count NO incrementó vs baseline
- [ ] Swap < 100MB (incremento normal por presión leve)

Si algo falla → investigar logs, NO rollback automático (1 incidente aislado no justifica revertir CDN).

---

## 6. Day-2 stability (T+48h)

Repetir todo de T+24h. Adicionalmente:

```bash
# Comparar HIT ratio dia 2 vs dia 1
# (debería crecer porque cache se warmed up)
```

Cloudflare dashboard:
- HIT ratio día 2: esperado >80%
- Origin requests día 2: <20%

**Criterio T+48h** (CRÍTICO):
- [ ] HIT ratio > 75%
- [ ] Cero incidentes que requirieron intervención
- [ ] Cero reportes de usuarios sobre audio/PDF degradado
- [ ] Grafana: VPS bandwidth promedio < 50% del baseline

Si algún criterio falla → considerar:
- Ajustar Cache Rules en Cloudflare
- Verificar que immutable headers efectivamente se respetan
- NO deployear M3.1 hasta estabilizar

---

## 7. T+72h: Decisión Go/No-Go M3.1

**Criterios para GO (deployear M3.1 frontend):**
- [ ] HIT ratio > 80%
- [ ] VPS bandwidth promedio cayó > 60% vs baseline
- [ ] 0 incidentes que requirieron rollback
- [ ] Audio/PDF/álbum funcionan sin reportes de usuarios
- [ ] App responde con latencia equivalente o mejor que pre-CDN
- [ ] Costo Cloudflare $0 (plan Free) o aceptable

**Si GO:** seguir `M31-FRONTEND-DEPLOY-GUIDE.md` para build + deploy v4.0.8

**Si NO-GO:**
- Documentar qué falló (HIT ratio bajo, bandwidth no bajó, regressions, etc.)
- Decidir: ajustar Cloudflare config y reset 72h, o rollback CDN completo
- M3.1 frontend queda en branch local listo para deploy futuro

---

## 8. Métricas a archivar (post-72h decision)

Crear `/opt/chibaleteplus/m3-snapshot-*/72h-observation-final.md` con:

```
=== T+72h Observation Final ===

Activación CDN: <fecha>
Decisión: GO | NO-GO | CONDITIONAL

Métricas finales:
- HIT ratio: X%
- VPS bandwidth pre: X Mbps avg / Y MB total/día
- VPS bandwidth post: X Mbps avg / Y MB total/día
- Reducción: X%
- p95 latency pre: X ms
- p95 latency post: X ms
- Incidentes durante 72h: lista
- Cache rules ajustadas: lista
- Costo Cloudflare: $X/mes estimado

Próximo paso aprobado: M3.1 deploy | seguir observando | rollback parcial
```

---

## 9. Comandos de emergency rollback

### A. Pause Cloudflare (mantiene DNS, desactiva proxy)

Dashboard Cloudflare → Site → Overview → "Pause Cloudflare on Site" (botón abajo derecha).

Tiempo: ~1 minuto.
Efecto: tráfico vuelve directo al origin (VPS 72.60.158.97). DNS sigue resolviendo a Cloudflare pero ellos pasan-through.

### B. Quitar MEDIA_BASE_URL (si se activó Opción B en Fase 2)

```bash
ssh root@72.60.158.97
/opt/chibaleteplus/scripts/fase2-activate-media-base-url.sh --rollback
```

Tiempo: ~3 minutos.
Efecto: APIs vuelven a devolver URLs relativas. App funciona idéntica a pre-M3.

### C. Remover Cloudflare completo (revertir nameservers)

Solo si todo lo demás falla:
1. Cloudflare → Overview → "Remove Site"
2. Ir al registrador del dominio → restore nameservers originales del registrador
3. Esperar 24h propagación DNS
4. App funciona idéntico a pre-Cloudflare

---

## 10. Métricas en Cloudflare a documentar al final

Screenshot estos paneles en Cloudflare dashboard al T+72h para archivar:

1. **Analytics → Traffic** (últimas 72h):
   - Requests total
   - Bandwidth total
   - Top URLs
   - Status codes

2. **Analytics → Cache** (últimas 72h):
   - Cache Hit Ratio
   - Cached Bandwidth
   - Top cached resources

3. **Security → Events** (últimas 72h):
   - Bot Fight Mode blocks
   - WAF events
   - Challenge passes

4. **Speed → Performance** (últimas 72h):
   - Origin response time
   - Edge response time

Estos screenshots forman parte del informe Fase 10.
