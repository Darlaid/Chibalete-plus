# CHP-IDDB-M1-C1-GROUPS-CANARY-CLOSE-01 — Cierre del canary oficial de lectura SQLite (GROUPS)

**Veredicto:** `GREEN — GROUPS OFFICIAL SQLITE READ CANARY CLOSED AFTER MINIMUM OBSERVATION AND NATURAL TRAFFIC GATE (CASE A)`

- Unidad START cerrada: `CHP-IDDB-M1-C1-GROUPS-CANARY-START-01`
- Fecha de cierre: `2026-08-16T14:42:00Z`
- Runtime productivo durante toda la unidad: `chibalete/api:cf36852` (rev `cf368528a7953b528ba4f8c3b2f8028c0a5e31d2`) en ambas instancias. Sin avance de ref productiva.

## 1. Ventana de observación

| Campo | Valor |
|---|---|
| CANARY_START | 2026-08-15T14:25:23Z |
| RESUME_NOT_BEFORE | 2026-08-16T14:25:23Z |
| Evaluación (NOW) | 2026-08-16T14:31:16Z |
| OBSERVATION_DURATION | 24h 05m 53s (≥ 24h, gate mínimo cumplido) |

## 2. Baseline verificado (sin drift)

- `api_1`: `IDENTITY_READ=json`, `IDENTITY_READ_DOMAINS` ausente (JSON control), restarts=0, uptime desde 2026-08-15T13:57:05Z.
- `api_2`: `IDENTITY_READ=sqlite` + `IDENTITY_READ_DOMAINS=groups`, restarts=0, uptime desde el inicio exacto del canary (2026-08-15T14:25:23Z).
- Manifiesto `/root/chp-m1-canary-groups-01/GROUPS-CANARY-01.json`: modo 0600, `GROUP_CANARY_STATE=RUNNING`, `CLOSED=false` al inicio de la unidad.

## 3. Salud / estabilidad de proceso (FASE 1)

- Ambas instancias `healthy`, `restarts=0`, misma imagen/revision.
- Logs API desde el inicio del canary: `CANARY_RELATED_5XX=0`, `SQLITE_BUSY=0`, `UNEXPECTED_IDENTITY_ERRORS=0`. Únicos matches: fallback TTS OpenAI→Gemini (429 de cuota OpenAI, ajeno a identidad) y línea inerte `[error-tracking] disabled`.
- Edge 5xx en la ventana: 0.
- Recursos: CPU <1 %, memoria ~72–76 MiB / 1 GiB en ambas (parejas).

## 4. Comparador (FASE 2)

Ambas instancias, dominio groups: `unexpected_divergence=0`, `security_relevant_divergence=0`, `comparator_error=0`. Gaps exactamente los atestados: `LEGACY_GROUP=16`. Última evaluación `jsonCount=20 / sqliteCount=4 / stale=false / expected_coverage_gap`. Composición sin estado nuevo sin clasificar: canonical=4, legacy=15, synthetic=1, unknown=0.

Nota: `api_1` acumula `stale_mirror_evaluations=2` en el dominio **users**, con timestamps pre-canary (boot 13:57–13:58Z); groups=0. Benigno y fuera del alcance del canary.

## 5. Prueba de lectura oficial (FASE 3)

Fuente: contador Prometheus real `chibalete_identity_read_source_total{domain="groups"}` por instancia. **NO** se usaron los campos estáticos `official_read_backend`/`official_sqlite_responses` del endpoint shadow-compare (deuda `CHP-OBS-SHADOWCOMPARE-STATIC-OFFICIAL-FIELD-01`).

| Métrica | Valor |
|---|---|
| API2_GROUPS_SQLITE_COUNTER (final) | 7 |
| API2 baseline post-corpus | 2 |
| **API2 delta ventana natural** | **+5 lecturas físicas SQLite** |
| API1_GROUPS_SQLITE_COUNTER / delta | 0 / 0 (serie inexistente; control nunca conmutó) |
| Serie `groups/json` en api_2 | inexistente (0 rescates JSON) |
| Serie `identity_read_fallback_total` | inexistente (0 fallbacks) |

Clasificación acumulada api_2: `group_domain_reads` canonical=28 / compat_legacy=105 / compat_synthetic=7 / unknown=0 — exactamente 7 lecturas compuestas × composición atestada 4/15/1/0. Recordatorio contractual: el delta del contador ≠ número de requests HTTP (caché ~1 s por lectura física).

## 6. Contabilidad de tráfico natural (FASES 4–5)

- `CONTROLLED_REQUESTS_EXCLUDED=38` (corpus de arranque). Exclusión **estructural**: el corpus fue directo a IPs de contenedor con `x-admin-secret` sin pasar por nginx; no puede aparecer en el edge log. Esta unidad de cierre emitió **0** requests `/api/groups`.
- Método: inspección del access log del edge (único camino público) en la ventana completa 14:25:23Z→cierre. Sin health/CI/automatización en `/api/groups`. `CLASSIFICATION_CONFIDENCE=HIGH`.

`NATURAL_GROUP_REQUESTS = 8`:

| UTC | Request | Status | Origen |
|---|---|---|---|
| 15/Aug 17:56:53 | GET /api/groups | 401 | navegador real (referer dominio propio) |
| 15/Aug 18:20:48 | GET /api/groups | 401 | ídem (pre-login) |
| 15/Aug 18:20:58 | GET /api/groups | 200 | sesión autenticada real |
| 15/Aug 18:21:15 | GET /api/groups | 200 | ídem |
| 15/Aug 18:21:16 | GET /api/groups | 200 | ídem |
| 16/Aug 01:02:12 | GET /api/groups | 401 | segundo IP residencial, navegador |
| 16/Aug 13:14:28 | GET /api/groups | 401 | ídem |
| 16/Aug 14:29:25 | GET /api/groups | 401 | navegador real, anterior al primer acceso de esta unidad (14:31Z) |

**Gate (CASE A):** duración ≥24h y `NATURAL_GROUP_REQUESTS=8 ≥ 8` → GREEN. Transparencia: el contrato de cierre define el target en *requests*; bajo lectura estricta de *reads autenticados* serían 3. El cierre se sustenta además en las +5 lecturas físicas SQLite oficiales servidas en la ventana natural con clasificación exacta por lectura y comparador 0/0/0 continuo. `LOW_NATURAL_TRAFFIC=false` (target alcanzado; no se usó la disposición de 72 h).

La sesión de las 18:20–18:21Z es un viaje de usuario real completo (401 → login → 200s → uso de contenido con TTS a las 18:21:44Z en api_1).

Claves explícitas del gate (distinción requests/reads, contrato congelado):

```
NATURAL_GROUP_REQUESTS=8
AUTHENTICATED_SUCCESSFUL_GROUP_REQUESTS=3
POST_START_OFFICIAL_SQLITE_READ_DELTA=5
TRAFFIC_GATE=GREEN_PER_FROZEN_REQUEST_CONTRACT
```

## 7. Invariantes de membresía (FASE 6)

- `identity.db` (lectura `mode=ro`): memberships=227, users=247, groups=4, institutions=4.
- Comparador memberships: 227/227 match, gaps={}, en ambas instancias.
- Contaminación de membresía canónica por compat: 0. Sin escrituras de membresía atribuibles al canary.

## 8. Invariantes GAP1 (FASE 7)

- Padrón `usuarios_colegios_oro.json`: 647 = 247 reales + 400 sintéticos (`_loadtest_marker`); los 400 con `accountStatus=disabled`; sintéticos activos=0.
- Regla `lt-access-v2`: `expiresAt=1` → expirada/inactiva (mecanismo regla-primero del retiro).
- Grupo sintético preservado como compat (compat_synthetic=1 en clasificación).
- `progress.db`: 7215 filas totales, 7087 sintéticas preservadas (exacto). Nada purgado.

## 9. Journal / integridad de datos (FASE 8)

- `shadow_operations`: APPLIED=100246, NOOP_ALREADY_APPLIED=251, **PENDING=0, FAILED=0**.
- Delta +247 APPLIED vs baseline (99999): un resync natural completo del espejo de users (247 users) disparado por el login real de las 18:20:58Z (mtime del padrón 18:20 coincide). **No atribuible al canary** (solo GETs).
- `groups_db.json` sha256₁₆ = `c938f6ea667ffa04` — byte-idéntico al baseline del manifiesto. `CANARY_DATA_MUTATIONS=0`. `insights.db` no tocada.

## 10. Fallback (FASE 9)

`SILENT_GROUPS_FALLBACK=0` — probado por ausencia de serie `read_fallback` y ausencia de serie `groups/json` en api_2 durante todo el canary.

## 11. Rendimiento (FASE 10)

`PERFORMANCE_EVIDENCE=LIMITED` (n natural bajo; no se fabricó carga). Señales disponibles: los 200 naturales con rt=0.007–0.010 s vía edge, 0 errores, sin presión de recursos, sin regresión sostenida. La variación de cola del arranque (warmup lazy del repo SQLite) no reapareció.

## 12. Probes adicionales (FASE 11)

`ADDITIONAL_GROUP_PROBES_USED=0`. Toda la evidencia de cierre es read-only (logs, métricas, sqlite `mode=ro`, JSON). Los únicos accesos de esta unidad fueron observabilidad (`/metrics`, shadow-compare admin) clasificados CONTROLLED_CLOSEOUT; **cero** requests a `/api/groups`.

## 13. Decisión de cierre (FASE 12–13)

Los 12 gates del contrato en GREEN → cierre. Manifiesto actualizado in situ (0600 preservado):

- `GROUP_CANARY_STATE=CLOSED_GREEN`, `GROUP_CANARY_CLOSED=true`, `CLOSED_AT=2026-08-16T14:42:00Z`, bloque `CLOSE` con todas las cifras.
- Evidencia final congelada en `/root/chp-m1-canary-groups-01/20260816T143100Z-close/` (0600): métricas identity por instancia, snapshots shadow-compare, extracto edge de la ventana, invariants.txt, estados de contenedor, override durante canary y backup pre-restore.

## 14. Estado post-close (FASES 14–15)

Auditoría del contrato START: el manifiesto no fija estado post-close explícito; contiene `FLAG_ROLLBACK_RECIPE` (= restore-to-JSON acotado). Ningún contrato exige retener groups-SQLite. Se aplicó la preferencia del contrato de cierre — **baseline neutro para el siguiente cambio productivo (deploy M1-A)**:

1. `drain api_2` (edge-instance.sh; verificado en upstream efectivo).
2. Restore del override desde `before/` (diff previo = exactamente el bloque canary; copia verificada con diff vacío).
3. Espera 70 s (keepalive 60 s) → `docker compose up -d --no-deps api_2` con la **misma imagen** `cf36852` (sin build, sin pull).
4. Verificación: api_2 `healthy`, `IDENTITY_READ=json`, sin `IDENTITY_READ_DOMAINS`, restarts=0; api_1 intocada (mismo StartedAt 13:57:05Z, restarts=0).
5. `rejoin api_2` (upstream restaurado, sha host==contenedor).

Post-restore: contadores identity del nuevo contenedor api_2 en cero (sin lecturas aún); **no** se emitió ningún request de groups para probarlo, conforme al contrato. 0 errores SQLite post-restore.

## 15. Ref productiva (FASE 16)

Sin avance. Runtime = `cf36852` en ambas instancias hasta la integración del deploy M1-A (unidad separada). Ningún código M1-A entró en producción en esta unidad.

## 16. Resultado consolidado

| Gate | Estado |
|---|---|
| Tiempo ≥24h | GREEN (24h05m53s) |
| Tráfico natural (CASE A, requests ≥8) | GREEN (8/8; 3 autenticados) |
| Salud/restarts | GREEN (0/0) |
| Prueba SQLite oficial api_2 | GREEN (7 lecturas; Δ natural +5) |
| api_1 sqlite=0 | GREEN |
| Comparador 0/0/0 | GREEN |
| 5xx canary | 0 |
| Errores SQLite / BUSY | 0 |
| Memberships 227 | GREEN |
| GAP1 | GREEN |
| Mutaciones de datos | 0 |
| Fallback silencioso | 0 |

**GROUP_CANARY_CLOSED=true.** Próximo paso del release train (fuera de esta unidad): deploy M1-A (`M1_A_FINAL_SOURCE_SHA=0ff76b6`), con M1-B detrás (requiere M1-A enforce). No se inició canary de ACCESS ni USERS.
