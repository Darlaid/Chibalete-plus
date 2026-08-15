# M1_IDENTITY_EVALUATION_01 — auditoría formal de cierre de M1 / Fase 1

Unidad: **CHP-IDDB-M1-EVALUATION-01** (2026-08-15, read-only, docs-only).
Veredicto: **AMBER — M1 READ AUTHORITY COMPLETE BUT IDENTITY GOVERNANCE GATES REMAIN.**

## 1. Baseline productivo (congelado, verificado)

- Runtime `chibalete/api:cf36852` en api_1/api_2, healthy, restarts=0.
- Flags: `SQLITE_ENABLED=1, DUAL_WRITE=1, IDENTITY_READ=json, IDENTITY_READ_DOMAINS` vacío,
  `SHADOW_COMPARE=1`. Official SQLite reads = 0 (users/groups/access).
- Canónico: 247 users / 4 instituciones / 4 groups (+15 legacy compat +1 sintético compat,
  UNKNOWN=0) / 227 memberships / 11 tombstones / 1 access rule (inactiva).
- LIVE=MATCH, journal PENDING=0 / FAILED=0, comparador estricto desplegado con
  unexpected=0 / security=0 / errors=0 y gaps exclusivamente atestados.

## 2. Modelo de autoridad vigente (deliberado, no deuda)

| Autoridad | Backend | Estado |
|---|---|---|
| User/group/access read candidate | SQLite | READY_FOR_CONTROLLED_CANARY (0 reads oficiales) |
| Login + credenciales | JSON físico | **diseño M1** (KEEP_JSON_AUTHORITY) |
| Mutaciones user/group | JSON físico | **diseño M1** (RMW seam probado) |
| Métricas legacy | JSON físico | **diseño M1** (denominador 647 intacto; 647→247 = Fase 2) |
| Sintéticos históricos | compat JSON explícita | atestada, disabled, sin access |
| Tombstones / unknown | NOT_FOUND / fail-closed | contrato desplegado |

## 3. Inventario de unidades M1 (todas las cerradas)

| Unidad | Estado | Ámbito | SHA | Cierra |
|---|---|---|---|---|
| 01A baseline / 01B cohorte / 01C instituciones / 01D huérfanos | GREEN | lab | — | censo, 4 instituciones válidas, exclusiones atestadas, tombstones |
| 02A schema+importer / 02B-A shadow / 02B-PATH / 02B-B(+H1/H2) / 02B-C / 02B-D(-A/-B) | GREEN | prod | `2945fa8`,`7a44d8f`,`ddfdc01`… | identity.db v2, dual-write simétrico, backup WAL |
| reconcile-live-sources / RMW-SEAM-01 | GREEN | prod | `eec39e9`,`89407f0` | reconcile live/frozen; mutaciones leen JSON físico fail-closed |
| 02C-A / 02C-B | AMBER/AMBER | prod | `2610d4c` | equivalencia de lectura probada; comparador sombra runtime |
| GAP4 access | GREEN | prod | `f885e31` | espejo de access rules, backfill 43.416 casos 0 mismatches |
| BACKUP-CAPACITY-01B | YELLOW (solo cap B2) | prod | `72d5f5e` | caché restic persistente, preflight, recovery-point |
| GAP1 retiro sintético + CLOSEOUT-R1 | GREEN | prod | `e998300` | 400 disabled, regla expirada, ventana transitoria auditada (220,8 s, 0 uso) |
| GAP3 groups | GREEN | prod | `967ddd5` | frontera CANONICAL/compat/UNKNOWN de groups, 4/15/1/0 |
| GAP2 users + strict comparator | GREEN | prod | `cf36852` | frontera de users 247/400/0, CREDENTIALS_IN_SQLITE=0, EXPECTED⇔atestación |
| M1 rehearsal + R1 | GREEN | lab | `9ae0099` | recetas de merge, fixture 19/19, estrictez `ba4fde3` |

Deudas remanentes por unidad: ver §8.

## 4. Matriz de gates M1 (definición vinculante, 16 puntos → 21 gates)

Pesos: 3 = crítico (session, tenant, membership governance, read authority/canaries);
2 = mayor; 1 = menor. Puntuación: GREEN=1, YELLOW=0.5, RED=0.

| Gate | Peso | Estado | Evidencia | ¿Blocker? | Unidad requerida |
|---|---|---|---|---|---|
| Identidad canónica | 2 | GREEN | 247 únicos, 0 emails duplicados (canónico y padrón), UNKNOWN live=0 | no | — |
| Aislamiento sintético | 2 | GREEN | 400 disabled/0 active, 0 memberships canónicas, access inactivo, fuera del universo operativo; permanencia física = compat histórica ACEPTADA (data preservation ≠ productive identity) | no | — |
| Autoridad institucional | 2 | YELLOW | 4 canónicas con id estable, cross-institución=0; PERO 141/247 users sin `organizationId` en JSON y 21 sin membership → vínculo institucional incompleto para un subconjunto (dormidos/externado). INSTITUTION_AUTHORITY_READY=true con reserva | no | M1-B (formalizar) |
| Autoridad de groups | 2 | GREEN | 4/15/1/0; compat NO contamina: 0 reglas de access sobre legacy, 227 memberships solo canónicas; legacy compat atestada ES aceptable dentro de M1 | no | — |
| Autoridad de memberships (datos) | 2 | GREEN | 227 activas, clave (grupo,usuario,rol), institución de membership == institución de grupo en 227/227 | no | — |
| **Gobernanza de memberships (actores)** | 3 | YELLOW | writes solo admin global (`requireAdminAccess`) o secret; self-join limitado a `club∧open`; actor logueado; PERO sin scoping institucional del actor, lifecycle solo `active`, sin autoridad delegada a mediadores | **sí (parcial)** | M1-B |
| Gobernanza de roles | 2 | YELLOW | fuente única users JSON (`roles[]`, espejo `global_role`: 1 admin/23 mediadores/223 lectores); mutación solo admin; sin admin por institución; IDOR de GETs autenticados abierto | sí (vía tenant) | M1-B |
| Autoridad de login | 2 | GREEN | bcrypt 647/647, gate active post-credencial, 401 genérico, limiter 10/IP/15min prod, credenciales solo-JSON, sanitización `CREDENTIAL_FIELDS` compartida. **LOGIN_AUTHORITY_SAFE_FOR_M1=true** | no | — |
| **Identidad de sesión** | 3 | **RED** | mecanismo productivo = header `x-user-id` **autoafirmado, sin firma, sin expiración, sin token de revocación** (revocación efectiva = disable de cuenta, verificada por request en la mayoría de middlewares; `requireProgressOwner` no verifica active). No limitado a edge interno: lo envía el navegador. Cualquier cliente puede afirmar el id de cualquier usuario activo | **SÍ** | M1-A |
| **Aislamiento tenant/institución** | 3 | **RED** | `GET /api/users` bajo `requireAuth` devuelve los 647 (sanitizados) a CUALQUIER usuario activo; los GET admin pasan por `allowAuthenticatedGetOrReject` sin rol ni scoping → CROSS_TENANT_READ_ALLOWED>0. Writes: admin GLOBAL sin scoping (modelo operador actual). Con sesión autoafirmada, el scoping además sería decorativo | **SÍ** | M1-A → M1-B |
| Autoridad de access | 2 | GREEN | GAP4 F27/F29, espejo MATCH=1, decisiones deterministas y logueadas (`ACCESS_DECISION`) | no | — |
| Semántica zero-rule | 2 | YELLOW | HOY los 247 reales operan vía `LEGACY_OPEN` (única regla = sintética inactiva): es el **modo catálogo-abierto deliberado** (`ACCESS_FALLBACK_MODE=open` explícito), capacidad igual para todo autenticado, sin expansión relativa. **ZERO_RULE_OPEN_FALLBACK_M1_BLOCKER=false**, condicionado a: (a) decisión registrada en el closeout como modelo vigente, (b) mecanismo DENY/fail-closed como criterio de salida (deuda CHP-SEC-ACCESS-ZERO-RULE-OPEN-FALLBACK-01) | no | M1-D (decisión) |
| **Fronteras de lectura + canaries** | 3 | YELLOW | implementación GREEN (3 dominios READY); verificación pendiente: 0 canaries ejecutados | no (gate de cierre) | M1-C |
| Comparador estricto | 2 | GREEN | desplegado (`ba4fde3`), runtime 0/0/0, gaps solo atestados (400/16 exactos) | no | — |
| Observabilidad de canary | 2 | GREEN | pino por request con userId, shadow-compare por dominio/clase/instancia, `identity_*_domain_reads_total`, `official_sqlite_responses`, journal, reconcile, edge logs. **CANARY_OBSERVABILITY_READY=true** | no | — |
| Rollback de canary | 2 | GREEN | flag por instancia (override env + recreate), sin mutación de datos ni restore; imagen como 2º nivel | no | — |
| Backup/recovery | 2 | GREEN | 01B desplegada (caché probada, preflight, recovery-point, 25 stores + identity.db). **BACKUP_READINESS_FOR_M1=true**. Cap B2 UNKNOWN = riesgo operativo con failure-policy definida, **no blocker** (canary no muta datos) | no | — |
| RMW / write authority | 2 | GREEN | **WRITE=JSON es válido para M1**: seam RMW probado (fixtures 647→647, 20→20), dual-write convergente (journal 0 PENDING/FAILED), reconcile estable. Write-cutover NO requerido | no | — |
| Autoridad de credenciales | 2 | GREEN | **KEEP_JSON_AUTHORITY correcto**: minimización (CREDENTIALS_IN_SQLITE=0 en 247/247), superficie de backup menor, autoridad única sin comparador falso | no | — |
| Aislamiento de métricas | 1 | GREEN | JSON_LEGACY por construcción; **METRICS_MIGRATION_M1_BLOCKER=false**; 647→247 = Fase 2 explícita | no | — |
| Release/CI | 1 | GREEN* | delta gate 7/7; heredados RED baseline-idénticos (excepción documentada); **CI_RELEASE_PROCESS_READY_FOR_M1=true**. *Deuda nueva: CHP-CI-PREFLIGHT-RUNNER-FLAKE-01 (waitHealthy 60 s, attempt-2 verde con árbol idéntico) | no | — |

## 5. Porcentajes (fórmula explícita)

Suma de pesos = 44. Puntos = Σ peso × score.

- **M1_IMPLEMENTATION_PERCENT ≈ 76 %** (33,5/44): RED session (−3) y tenant (−3);
  YELLOW a mitad: gobernanza memberships (−1,5), institucional (−1), roles (−1), zero-rule (−1).
  El eje de READ AUTHORITY está 100 % implementado (`M1_READ_AUTHORITY_IMPLEMENTATION_COMPLETE=true`).
- **M1_VERIFICATION_PERCENT ≈ 73 %** (32/44): lo anterior más canaries no ejecutados (−1,5 del gate de fronteras).
- **M1_OVERALL_PERCENT ≈ 75 %.** No se declara 100 % con dos gates críticos en RED.

## 6. Grafo de dependencias y plan de canary (NO ejecutar)

**Orden demostrado: GROUPS → ACCESS → USERS.**
- GROUPS primero: superficie de lectura mínima (≈7 GETs/48 h histórico), sin dependencia
  de authz entrante (la única regla de access está inactiva), composición 4+15+1 probada
  en 41 casos + fixture M1 + dry-run productivo; los otros dominios DEPENDEN de groups
  (authz usa groupIds; access usa scope de grupo) → validar la hoja compartida primero.
- ACCESS segundo: 1 regla inactiva espejada MATCH; toda decisión actual cae al fallback y
  el candidato SQLite produce el MISMO resultado (0 aplicables) → paridad semántica trivial
  de validar con tráfico alto real (preflight de cada visor).
- USERS último: mayor abanico de consumidores (authz, listados admin, Leo, membresías);
  login/credenciales quedan FUERA por diseño (LOGIN_SQLITE_LOOKUPS=0).

**Mecanismo (menor blast radius): E = A+B+D.** Una sola instancia (api_2) con
`IDENTITY_READ_DOMAINS=<dominio>` vía override de compose + recreate (config-only);
api_1 intacta como control; comparador sombra sigue activo en ambas.
- CANARY_ACTIVATION: drain api_2 → override env → recreate → validar → rejoin.
- CANARY_OBSERVATION: por dominio — `official_sqlite_responses>0` en api_2,
  unexpected=0/security=0/errors=0, paridad semántica (mismos conteos/estados que api_1),
  latencia p95 sin regresión (referencia 01I), login real 200/sintético 401 invariables,
  memberships resueltas, 0×5xx, restarts=0, journal sin FAILED, cero mutación de stores.
- Ventanas fundadas en tráfico histórico: GROUPS 24–72 h (tráfico bajo: exigir además
  N≥20 lecturas reales, generables por operación admin legítima); ACCESS 2–6 h
  (preflight por sesión de lectura); USERS 6–24 h. Mínimos: cada clase de consumidor
  ejercitada ≥1 vez.
- CANARY_ROLLBACK: **flag → JSON** (quitar domain del override + recreate api_2, ~30 s,
  sin data mutation/reconcile/restore). IMAGE ROLLBACK solo si el binario mismo
  regresionara (crash-loop, 5xx sistémico) — no esperado: la imagen ya corre en json.

**Elegibilidad: el canary ES elegible ya.** No amplía identidad de sesión ni authz
(sirve los mismos datos desde otro backend, con comparador estricto y rollback por flag);
los blockers de gobernanza (M1-A/M1-B) son blockers del **closeout**, no del canary.

## 7. Unidades restantes mínimas (4)

| Unidad | Objetivo | ¿Muta prod? | Dependencias | Exit gate |
|---|---|---|---|---|
| **CHP-IDDB-M1-C — CONTROLLED-READ-CANARY-01 (GROUPS, luego ACCESS y USERS)** | ejecutar los 3 canaries por instancia con los gates de §6 | flags/deploy config-only; 0 mutación identity | ninguna (elegible ya) | `official_sqlite_responses>0` + 0/0/0 + paridad por dominio |
| **CHP-IDDB-M1-A — SESSION-IDENTITY-01** | sesión firmada emitida en login (token con expiración + verificación server-side + revocación por estado/versión), migrando consumidores `x-user-id` con ventana de compat | código + deploy; 0 mutación identity | ninguna | 0 endpoints productivos con identidad no firmada (salvo internos demostrados); suite + smoke |
| **CHP-IDDB-M1-B — TENANT-AUTHZ-01** | scoping por institución en GETs autenticados (lector→lo suyo; mediador→sus grupos; admin explícito), gobernanza de membership por actor (mediador de su institución), cierra CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01 | código + deploy | **M1-A** (scoping sobre identidad autoafirmada es decorativo) | matriz A→B: CROSS_TENANT_READ=0 / WRITE=0 salvo admin explícito, probada |
| **CHP-IDDB-M1-D — CLOSEOUT-01** | matriz final, decisión formal zero-rule (modelo abierto vs fail-closed), declaración M1 | no | A+B+C | contrato §9 completo |

## 8. Triage de deudas de seguridad

| Deuda | Clase |
|---|---|
| Identidad de sesión autoafirmada (nueva: CHP-SEC-SESSION-SELF-ASSERTED-ID-01) | **BLOCKS_M1** (M1-A) |
| CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01 (IDOR GETs autenticados) | **BLOCKS_M1** (M1-B) |
| CHP-SEC-ACCESS-ZERO-RULE-OPEN-FALLBACK-01 | POST_M1 condicionado (decisión explícita en M1-D; salida = DENY mechanism) |
| Orden inseguro `rollbackRetirement()` (users→rule) | POST_M1 (prohibido su uso; corregir antes de cualquier rollback GAP1) |
| CHP-SEC-RATE-LIMIT-DISTRIBUTED-01 (limiters por instancia; bucket general keyed por x-user-id autoafirmado) | POST_M1 (parcialmente absorbida por M1-A) |
| CHP-OPS-PROCESS-DESCRIPTOR-01 | PHASE2+/OPS |
| gitleaks-history heredado (10 fingerprints, secretos rotados) / trivy-image (CVE no alcanzable + 2 HIGH del CVE-DB) | COSMETIC/OPS con excepción baseline |
| B2 account cap UNKNOWN (§9 runbook 01B pendiente de operador) | OPS, no blocker |
| CHP-CI-PREFLIGHT-RUNNER-FLAKE-01 (waitHealthy 60 s en runner; nueva) | OPS/CI |

## 9. Contrato de closeout M1 (criterios medibles para el futuro GREEN)

`GREEN — M1 IDENTITY, ACCESS AND MEMBERSHIP AUTHORITY COMPLETE` exigirá TODO lo siguiente:

1. Canaries GROUPS/ACCESS/USERS ejecutados: `official_sqlite_responses>0` por dominio con
   unexpected=0/security=0/errors=0 y paridad semántica documentada; rollback por flag probado.
2. Sesión: 100 % de requests productivas autenticadas con identidad FIRMADA verificada
   server-side (expiración + revocación); inventario de excepciones internas = explícito y justificado.
3. Tenant: matriz actor→recurso con CROSS_TENANT_READ_ALLOWED=0 y CROSS_TENANT_WRITE_ALLOWED=0
   salvo admin explícito, demostrada por suite reproducible.
4. Membership governance: capacidades por rol documentadas y probadas (crear/modificar/retirar),
   scoping institucional del actor, audit trail por operación.
5. Zero-rule: decisión formal registrada (modelo abierto deliberado O fail-closed) con owner y salida.
6. Invariantes permanentes: LIVE=MATCH, PENDING=0/FAILED=0, comparador 0/0/0 con gaps solo
   atestados, sintéticos 0 activos, tombstones NOT_FOUND, UNKNOWN fail-closed,
   CREDENTIALS_IN_SQLITE=0, denominadores de métricas intactos, backup GREEN ≤24 h.
7. Compatibilidades vivas (15+1 grupos, 400 users históricos, login/write/metrics JSON) listadas
   con WHY/OWNER/EXIT_CRITERIA — ninguna sin gobernar.

## 10. Impacto en plan maestro (Phase 1)

- ANTES de esta evaluación: «4 coverage gaps cerrados» podía leerse como M1 casi hecho.
- DESPUÉS: **read authority implementation = 100 %**, M1 real ≈ **75 %**; lo restante es
  gobernanza de identidad (sesión firmada, aislamiento tenant, gobernanza de membership)
  + verificación por canaries + closeout.
- Desbloquea hacia Phase 2 (tras M1-D): cutover oficial por dominio, exclusión estadística
  de cohorte sintética (decisión 647→247), credential store dedicado (Option B) si se decide,
  purga física `CHP-IDDB-PURGE-GROUPS-01`.

— Fin. Unidad siguiente exacta: **CHP-IDDB-M1-C — CONTROLLED-READ-CANARY-01 (GROUPS)**;
M1-A/M1-B obligatorias antes del closeout, no del canary.
