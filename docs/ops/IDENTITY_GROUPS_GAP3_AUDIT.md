# IDENTITY_GROUPS_GAP3_AUDIT — auditoría de cobertura de grupos (GAP-3)

Unidad: **CHP-IDDB-02C-GAP3-GROUPS-00** (read-only, 2026-08-13).
Baseline: producción `chibalete/api:f885e31`, 1/1/json, comparator ON,
LIVE=MATCH (access=1). **Cero mutación productiva.**
Evidencia: `/root/chp-iddb-gap3-groups-00/census.json` (0600) + artefactos
atestados de 01C-R1 y 02A.

## Veredicto

**GREEN — GAP3 GROUP COVERAGE ROOT CAUSE AND SAFE CLOSURE PATH DEFINED**

Los 16 grupos JSON-only están completamente clasificados con evidencia
recalculada HOY (no heredada), todas las dependencias cruzadas, la política
del comparador auditada como explícita (no permisiva), y el camino de cierre
definido. No hay ambigüedad funcional: la decisión humana relevante ya fue
tomada y atestada en 01C-R1; la ejecución futura conserva sus gates.

## Censo y cruce (F1–F2) — recalculado, no asumido

| Cruce | n |
|---|---|
| CANONICAL_MATCH (JSON ∩ SQLite, 0 divergencias semánticas) | 4 |
| JSON_ONLY | 16 |
| SQLITE_ONLY | 0 |
| SEMANTIC_MISMATCH | 0 |
| IDs duplicados | 0 |

Los 4 canónicos: 205 miembros reales + mediadores = **227 membresías SQLite
(91/90/39/7)**; 0 miembros sintéticos.

## Composición de los 16 (F3) — demostrada

**15 = LEGACY_TEST_GROUP_PENDING_RETIREMENT** (coincide 1:1 con el mapa
atestado 01C-R1 y con `migration_exclusions` de 02A, verificado por hash):
todos sin `organizationId` (UNRESOLVED_NO_ORG → no proyectables al modelo v2,
que exige institución), `grade` textual (5 con `gradeLevel` coherente, 0
conflictos), 0 `availableContentIds`, 0 ventanas de acceso, tipo `course`
(1 sin tipo).

**1 = SYNTHETIC_LOADTEST_EXCLUDED** (`GRP_0a98e5b5`): 400 miembros, todos de
la cohorte sintética `_loadtest_marker`; organización sintética (`lt-…`) no
registrada; marcadores propios.

## Membresías (F4) — hallazgo central

- **Las 227 membresías canónicas apuntan TODAS a los 4 grupos canónicos**
  (0 hacia JSON-only; comprobado, no asumido).
- Los 15 legacy contienen **17 lectores reales distintos** (10 grupos con
  1–3 miembros) + 7 identidades fuera del padrón (miembros/mediadores
  colgantes, ya censadas en el baseline de retiro 01C-R1 como
  `identitiesOutsidePadron`).
- Los 17: existen en identity.db como usuarios canónicos **sin ninguna
  membresía**, todos rol `lector` activo, **16 sin ningún login jamás y 1 con
  último login 2026-05**; ~0 progreso. Son remanentes dormidos, no actividad
  legacy. (Clasificación de uso: sin evidencia de uso en la ventana
  observable; no se afirma «nunca usado» — USAGE por debajo del umbral de
  detección.)
- 5 de los 15 grupos no tienen NINGÚN miembro real (solo referencias
  colgantes) — basura pura.

## Instituciones (F5)

15× UNRESOLVED_NO_ORG (sin referencia); 1× SYNTHETIC_ORG (`lt-…`, no
registrada). 0 referencias a las 4 instituciones canónicas desde JSON-only.
0 AMBIGUAS. No se creó ningún mapping.

## Consumidores runtime (F6) y tráfico (F7)

| Superficie | Sirve JSON-only | Visible | Authz | Tráfico 48h |
|---|---|---|---|---|
| `GET /api/groups` (listado completo, normalizado) | sí (los 20) | admin/mediador | no | 7 req |
| `GET /api/membership-governance/groups` | sí | admin | no | 1 req |
| `GET /api/content/:id/access` capa legacy de grupo | sí (en resolución) | lector | **sí** | (dentro del tráfico de access) |
| `accessService.resolveUserContentAccess` (scope group) | sí | — | **sí** | ídem |
| candidates/members/validate/diagnosis/students-status | por id | admin/mediador | no | 0 req |
| `POST /api/users`, `POST /api/invite-user` (resolución de grupo) | sí | — | indirecto | bajo |
| metrics legacy (`loadAndInitMetrics`, metricsProvider, comparability) | sí | informes | no | interno |
| `aulaViva/scopeAccess`, `cis.mjs` (authz v2 por organizationId) | los legacy quedan FUERA (sin org) | — | sí (v2) | interno |

Total API 48h: 1.396 requests. Ninguna operación por-grupo-legacy observada.
La ventana de logs es limitada: el listado sirve los 20, así que la
retirada visible requiere su propio gate (ver unidad 01).

**Capa legacy de acceso**: ningún grupo JSON-only puede conceder contenido
hoy — 0 `availableContentIds`, 0 `collectionIds`, 0 ventanas. La única vía de
concesión por grupo es la access rule (abajo).

## Política del comparador (F8) — AUDITADA, NO PERMISIVA

`makeAbsencePolicy().group()` solo clasifica `EXPECTED_COVERAGE_GAP:
LEGACY_GROUP` si: (a) el hash del grupo está en `migration_exclusions`
(exclusión ATESTADA de 02A), o (b) `projectGroups` lo rechaza
estructuralmente (p. ej. sin organizationId), o (c) su institución no está
registrada. **Una ausencia no explicada devuelve `null` → se cuenta
`MISSING_IN_SQLITE` como divergencia inesperada** (verificado en
`evalGroups`). Un grupo productivo legítimo faltante NO puede esconderse bajo
LEGACY_GROUP. Los 16 actuales cumplen (a) y además 15 cumplen (b) y 1 cumple
(c). **Sin STOP.**

## Grupo sintético (F9)

Demostrado: fuera del dominio canónico (excluido en 02A por hash), 0
participación en las 227 membresías, 400/400 miembros sintéticos, org
sintética. **No debe migrarse; debe continuar excluido.** Sin purga (fuera de
alcance; además tiene una dependencia activa, ver Access).

## Authz / Access (F13–F14)

- **Access**: la única regla (`lt-access-v2`, group-scope, 64 títulos,
  activa) referencia **al grupo sintético** → dependencia explícita
  registrada: `SECURITY_RELEVANT` (concede contenido a los 400 sintéticos,
  que hoy pueden autenticarse — GAP-1). **El grupo sintético no puede
  retirarse sin resolver la regla y la cohorte (GAP-1); ninguna regla
  referencia a los 15 legacy.**
- **Authz institucional (CIS/v2)**: los legacy quedan fuera por carecer de
  organizationId — no participan.
- Los 15 legacy no participan en NINGUNA decisión de autorización actual:
  sin reglas, sin contenido asignable, sin membresías canónicas.

## Calidad de datos (F15)

| Hallazgo | n | Clase |
|---|---|---|
| Grupos sin organizationId | 15 | HISTORICAL (decidido en 01C-R1) |
| Mediadores/miembros colgantes (fuera del padrón) | 7 identidades / 9 refs | HISTORICAL (censado en 01C-R1) |
| Grupos sin ningún miembro real | 5 | NON_BLOCKING |
| IDs duplicados / grupos semánticamente duplicados | 0 | — |
| grade vs gradeLevel en conflicto | 0 | — |
| Malformados | 0 | — |

Nada BLOCKING. Nada se corrigió.

## Matriz de decisión (F16) — reconcilia con JSON_ONLY=16

| CLASS | COUNT | MIEMBROS | MIEMBROS CANÓNICOS | CONSUMERS | AUTHZ | ACCESS | TARGET | EFECTO EN CUTOVER |
|---|---|---|---|---|---|---|---|---|
| LEGACY_TEST (con dormidos) | 10 | 17 reales dormidos | 0 | solo listados | no | no | **C: RETIRE_AFTER_ZERO_CONSUMERS** (vía CHP-IDDB-PURGE-GROUPS-01, ya atestada) | ninguno si el borde compat existe |
| LEGACY_TEST (solo refs colgantes) | 5 | 0 | 0 | solo listados | no | no | **C** ídem | ninguno |
| SYNTHETIC_LOADTEST | 1 | 400 sintéticos | 0 | listados + access rule | **sí** (vía regla) | **sí** (`lt-access-v2`) | **E: SYNTHETIC_EXCLUSION** (permanece; acoplado a GAP-1) | excluido por contrato |
| **TOTAL** | **16** | | | | | | | |

Sin AUTO_MERGE, sin dedupe por nombre (0 candidatos de todos modos).

## Semántica del cutover (F11) — respuesta demostrada

**NO (opción 2): GROUPS READY no exige 20/20 en SQLite.** Los 16 están
**contractualmente excluidos** por decisión humana atestada (01C-R1:
`importToIdentityDb=false`, `assignOrganizationId=false`,
`deleteFromLegacyNow=false`, referencias preservadas hasta
`CHP-IDDB-PURGE-GROUPS-01` con snapshot+dry-run+rollback obligatorios) y el
modelo v2 ni siquiera puede representarlos (sin institución). Lo que falta
para READY **no es cobertura: es el borde de compatibilidad explícito** — hoy
un cutover del dominio `groups` haría que `GET /api/groups` pasara de 20 a 4
en silencio y que 17 usuarios dormidos perdieran su única afiliación visible.

## Borde de compatibilidad (F12) — diseño conceptual

Separación propuesta (opción «domain classification», sin fallback
silencioso):

- **CANONICAL GROUP READ DOMAIN**: bajo cutover, servido desde SQLite.
- **LEGACY COMPATIBILITY DOMAIN**: los registros JSON cuyo hash esté en la
  **allowlist pinned = `migration_exclusions`** (los 16 atestados) se sirven
  vía canal compat EXPLÍCITO, cada lectura contada
  (`identity_read_compat_group_total{class}`) y etiquetada.
- **Deny-by-default**: un id ausente en SQLite y NO perteneciente a la
  allowlist compat → NOT_FOUND. Jamás `SQLite miss → JSON fallback` sin
  contrato: un grupo nuevo real solo puede existir vía dominio canónico.
- Alternativas evaluadas: endpoint legacy separado (rompe consumidores),
  migración canónica (violaría la atestación y el modelo v2), facade compat
  (elegida como composición dentro del seam actual).

## Opciones (F17)

**A — Migrar los 15+1 a canónico.** Rechazada: contradice la decisión
atestada, exige inventar instituciones (el modelo v2 exige org), contamina
denominadores institucionales, y el sintético jamás debe migrar. Seguridad ↓,
rollback complejo.

**B — Dominio canónico + compatibilidad explícita (allowlist atestada).**
Cierra GAP-3 sin tocar datos: cero mutación de stores, backward compatible
(la vista compuesta == vista JSON actual, probado por equivalencia), rollback
= flag off, tiempo corto. La retirada física queda donde ya estaba:
`CHP-IDDB-PURGE-GROUPS-01`, después y por separado.

**C — Mixto (retirar primero los 15, luego borde solo para el sintético).**
Más limpio a largo plazo pero: adelanta una mutación visible (listados 20→5)
que hoy no es necesaria para READY, exige su propia ventana con backup
(bloqueada por F27/cap B2) y acopla GAP-3 al calendario de purga. Mayor
tiempo hasta cerrar GAP-3.

**Recomendación: B.** Seguridad igual o mejor (deny-by-default explícito
donde hoy hay un JSON monolítico), complejidad baja, compatibilidad total,
membresías intactas, access intacto, rollback trivial, y deja la purga
(C) como continuación natural ya atestada.

## Unidad siguiente (F18) — CHP-IDDB-02C-GAP3-GROUPS-01

**No es «backfill de 16 grupos».** Scope exacto:

1. Clasificador de dominio en el facade de lectura de `groups`:
   canónico (SQLite) ∪ compat (JSON ∩ allowlist `migration_exclusions`),
   deny-by-default fuera de ambos; telemetría por clase; cero cambio con
   flags actuales (1/1/json ⇒ no-op).
2. Contrato de consumidores: `GET /api/groups` y superficies admin declaran
   la clase de cada grupo servido (aditivo, opcional en respuesta).
3. Tests (F19): grupo canónico servido de SQLite bajo cutover simulado;
   grupo sintético servido SOLO vía compat con telemetría; grupo legacy
   ídem; grupo desconocido → NOT_FOUND (sin fallback silencioso);
   membership lookup intacto; access group-scope intacto (regla sintética
   sigue resolviendo por compat); authz sin ampliación; clasificación del
   comparador sin cambios; equivalencia listado compuesto == listado JSON.
4. Gates: suites identity completas GREEN; image canary con cutover simulado
   de groups (4 canónicos desde SQLite + 16 compat + desconocido 404);
   dry-run de equivalencia sobre producción read-only; **backup pre/post
   (BLOQUEADO hasta F27 + BACKUP-CAPACITY-01B-DEPLOY)**.
5. Rollback: retirar flag/clasificador → lectura JSON pura (N-1 imagen).
6. Readiness esperado tras 01: **GROUPS = READY_FOR_CONTROLLED_CANARY**
   (canónico 4/4 + compat contractual explícita + memberships evidenciadas
   por el propio canary), con el sintético acoplado a GAP-1 y la purga
   física en `CHP-IDDB-PURGE-GROUPS-01`.

## Riesgos restantes

- La ventana de logs (48 h) no prueba ausencia de uso estacional de las
  superficies admin de grupos: el canary de 01 debe observar los listados.
- La regla `lt-access-v2` mantiene con acceso a 400 sintéticos que pueden
  autenticarse: sigue siendo materia de GAP-1/GAP-2, aquí solo queda
  registrada la dependencia.
- La purga física (cuando llegue) debe honrar
  `requireSnapshotDryRunRollbackBeforeDeletion=true` del baseline atestado.
