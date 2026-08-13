# IDENTITY_USERS_AUTHORITY_GAP2_AUDIT — autoridades del dominio users

Unidad: **CHP-IDDB-02C-GAP2-USERS-AUTHORITY-00** (read-only, 2026-08-13).
Baseline: `f885e31`, users 647 JSON / 247 canónicos / 400 sintéticos
(GAP1-PREP GREEN sin desplegar) / 11 tombstones; 1/1/json, comparator ON,
`official_sqlite_responses=0`, PENDING=0. **Cero mutación.**

## Veredicto

**GREEN — USER READ AND CREDENTIAL AUTHORITIES SEPARATED AND SAFE CUTOVER
PATH DEFINED**

Las seis autoridades (read, credential, login, authz-lookup, synthetic-compat,
mutation) quedan separadas con evidencia; ninguna exige migrar junto a otra.
No hay STOP: un cutover de lecturas canónicas NO cambia semántica de
autenticación ni autorización (demostrado por diseño ya desplegado + suites).

## C. Inventario de lecturas de users (F1)

Tras RMW-SEAM-01, el universo de lecturas queda partido en dos planos:

| Plano | Sitios | Clases | Fuente | ¿Cutover-elegible? | ¿Credencial? |
|---|---|---|---|---|---|
| **Seam conmutable** (`readJSON(USERS_DB)`) | 20 en server.js + módulos (`adminAuth.readUsers`, `accessService`, `cis.mjs`, `metricsProvider`, `aulaViva/scopeAccess`) | API_RESPONSE (list/get/status), AUTHN-sesión (principal x-user-id), AUTHZ (rol admin, CIS org-scope, access engine), MEMBERSHIP, METRICS, ADMIN, LEGACY | seam (hoy JSON) | **SÍ** (ninguna necesita credenciales) | NO |
| **Físico** (`readCanonicalStoreForMutation`) | 13 + login | MUTATION_BASE, LOGIN, credential-verification, reset/invite | JSON físico SIEMPRE | fuera del cutover por diseño | SÍ (login/reset) |

`groupMembershipService` = solo scripts (BLOCKED_WHEN_DUAL_WRITE, sin
llamadores runtime).

## D. Cobertura del schema SQLite (F2)

Censo completo sobre los 247 `raw_json`: **idéntico campo a campo al padrón
real** (perfil: avatar/bio/curso/colegio/libros/seguidores; org; roles;
status; `groupIds`; social) **con la única excepción de `password` (247→0)**.
Columnas v2 además: `email_norm`, `global_role`, `status`,
`credential_excluded=1`, provenance. **SQLite contiene TODO lo necesario para
las lecturas normales de usuarios canónicos.** (El muestreo de 1 fila engaña:
existe exactamente 1 usuario sin campos de perfil — censar siempre agregado.)

Clases de campos: CANONICAL_IDENTITY (id/email/nombre), PROFILE (avatar…),
ORG_SCOPE (organizationId/colegio), ROLE (roles/mediatorKind), STATUS
(accountStatus), CREDENTIAL (password — **solo JSON**), LEGACY_ONLY (curso
textual), SYNTHETIC_ONLY (marker — solo JSON).

## E. Autoridad de credenciales (F3)

Credenciales = `password` bcrypt embebido en el registro JSON (647/647);
`resetToken/inviteToken`: 0 hoy, mismo store cuando existen; sin metadata de
algoritmo/versión aparte (el prefijo `$2` discrimina); auto-upgrade legacy
existe sin casos. **No hay ninguna razón de seguridad para copiar
credenciales a identity.db** — al contrario: `credential_excluded=1` es
diseño deliberado y correcto (minimización de secretos, superficie de backup,
un solo lugar que rotar). **Higiene detectada**: `sanitizeUser` del espejo
solo excluye `password/passwordHash`; si algún día existieran
`resetToken/inviteToken`, persistirían en `raw_json`. GAP2-01 debe ampliar la
lista de strip ANTES de cualquier canary de lectura.

## F. Login path (F4)

`POST /api/auth/login` → `readCanonicalStoreForMutation` (FÍSICO, fuera del
seam) → bcrypt → `isUserActive` → `lastLoginAt` (writeJSONAsync físico,
espejado). **`IDENTITY_READ=sqlite`+`DOMAINS=users` coexiste con
`LOGIN_AUTHORITY=JSON` sin acople**: ya probado por la suite RMW (login 200
con cutover simulado de los tres dominios) y re-probado en GAP1-PREP. La
independencia no es conceptual: está desplegada desde `89407f0`.

## G. Authz paths (F5)

Todos los lookups de authz son IDENTITY/ROLE (jamás credential): sesión
(`getRequestHasValidPrincipal`: id+`isUserActive`), rol admin (opción B),
CIS (organizationId), access engine (organizationId/groupIds). Campos
requeridos: `id, roles, rol, accountStatus, organizationId, groupIds` —
**todos presentes en `raw_json`**. Authz puede consumir SQLite canónico
mientras login sigue en JSON. **Cero blockers de campo.**

## H. Sintéticos post-retirement (F6)

Tras GAP1-DEPLOY (400 disabled, regla expirada, registros preservados):
- Sesión/authz: un x-user-id sintético falla por status en AMBAS fuentes
  (JSON: disabled; SQLite: ausente) — misma dirección DENY.
- Superficies que aún los ven: **admin listing / lookup histórico** (audit) y
  **métricas legacy** (denominadores). Producto operativo: ninguna necesidad.
- «Registro preservado» ≠ «visible en todas las APIs»: la visibilidad pasa a
  ser decisión de contrato por superficie (J/K).

## I. Modelo de dominios de user (F7) — patrón GAP3

`classifyUserReadDomain(userId)`:

| Clase | Fuente atestada | Comportamiento |
|---|---|---|
| `CANONICAL` | en SQLite (proyectable, no excluido) | SQLite bajo cutover |
| `ATTESTED_SYNTHETIC_COMPAT` | `migration_exclusions(user, SYNTHETIC_LOADTEST_QUARANTINED)` | JSON explícito SOLO en superficies admin/históricas; telemetría |
| `TOMBSTONED` | `identity_tombstones` (h16) | **NOT_FOUND explícito** (hoy también 404: no están en el padrón) |
| `UNKNOWN` | — | fail-closed |

Sintético disabled: **necesita compat runtime únicamente en admin/audit y
métricas** (hasta la unidad de exclusión estadística); el resto de
superficies puede ser canonical-only. Jamás `SQLite miss → JSON fallback`.

## J/K. Contratos de list y get (F8–F9)

| Superficie | canónico | sintético disabled | tombstone | unknown |
|---|---|---|---|---|
| Runtime producto (status, members, access, CIS) | ✔ | ausente (404/no-member) | 404 | 404 |
| `GET /api/users` operativo | 247 | **fuera** del listado operativo | — | — |
| Admin/auditoría (explícita) | ✔ | ✔ etiquetado `ATTESTED_SYNTHETIC_COMPAT` | ✔ como tombstone si se pide | 404 |
| Métricas legacy | ✔ | decisión acoplada a `CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01` — el cutover del seam CAMBIARÍA denominadores 647→247: debe ser explícito, no accidente | — | — |

Sin decisión unilateral aquí: los consumidores de `/api/users` (admin UI) se
revisan en GAP2-01; el diseño exige que el 647→247 operativo sea contractual.

## L. Tombstones (F10)

11 filas en `identity_tombstones` (identidades retiradas del padrón: NO están
en el JSON → hoy responden 404 en todo). Comparator: explican ausencias vía
`TOMBSTONED_IDENTITY`. Tras cutover: mismo 404, ahora clasificado
explícitamente (evita reuso de id). Nada que reactivar ni borrar.

## M. Status semantics (F11) — SEGURO

`userStatus`: vacío→'active' (mismo default que `isUserActive` en JSON:
semánticas idénticas), 'disabled'→'inactive', 'suspended'→'suspended',
desconocido→**REJECTED** (gap `STATUS_UNMAPPABLE`, jamás default). `raw_json`
conserva `accountStatus` VERBATIM → un canónico disabled servido desde SQLite
sigue siendo disabled para `isUserActive`. **Ningún camino convierte
disabled→active.** Sin STOP.

## N. Comparator readiness (F12)

Estado actual users: MATCH canónicos + gaps esperados `SYNTHETIC_USER=400` y
`CREDENTIAL_AUTHORITY=1` (marcador estructural por evaluación), 0 inesperadas.
**Post-GAP1 los mismos gaps siguen siendo legítimos** (registros presentes,
credenciales solo-JSON). USERS READY exigirá: 0 inesperadas ∧ gaps
exclusivamente atestados ∧ frontera desplegada — no solo «0 unexpected».

## O. Login comparator (F13)

**NO construir**: SQLite no contiene credenciales POR DISEÑO — comparar
outcomes de login sería una comparación falsa contra un espejo
deliberadamente incompleto. Decisión explícita:
**`LOGIN = KEEP_JSON_AUTHORITY`** (durable para Fase 1; solo se revisitaría
si algún día se construye el credential store separado de Option B).
Implicación para M1: M1 se define SIN cutover de login (V).

## P. Mutation authority (F14)

`WRITE=JSON` físico con RMW-SEAM intacto. Fase 1 NO necesita cambiarlo: el
dual-write mantiene el espejo, el guard impide RMW sobre SQLite, y el
comparador vigila. **Sí: M1 puede cerrarse con WRITE=JSON + LOGIN=JSON +
CANONICAL READS=SQLite.**

## Q. Matriz de autoridad final (F15)

| Surface | JSON | SQLite | AUTORIDAD FINAL (Fase 1) | Razón |
|---|---|---|---|---|
| canonical user read | espejo-fuente | servidor | **SQLite** (canary) | cobertura completa probada |
| user list operativo | fuente | servidor | **SQLite** (247) | contrato explícito J |
| get user runtime | fuente | servidor | **SQLite** | K |
| membership user resolution | fuente | servidor | **SQLite** | campos presentes |
| authz identity lookup | fuente | servidor | **SQLite** | G, sin credencial |
| login | **autoridad** | — | **JSON** | O |
| credential verification | **autoridad** | excluida | **JSON** | E |
| status | fuente | proyección fiel | **SQLite lee / JSON escribe** | M |
| user mutation | **autoridad** | espejo | **JSON** | P |
| synthetic historical lookup | fuente | excluido | **JSON vía compat explícita** | H |
| tombstone resolution | ausente | atestado | **SQLite (NOT_FOUND explícito)** | L |

## R. Security model (F16)

Minimización: credenciales en UN store (JSON físico), jamás duplicadas;
`sanitizeUser` a ampliar (tokens). Dual-source confusion: imposible por
frontera clasificada-antes-de-backend + guard RMW + marca de procedencia.
Stale status: `USERS_DB` sin caché + mirror con STALE_MS acotado + comparador.
Privilege expansion: estructura DENY-direction en todo camino (ausente ⇒
401/404; disabled proyectado fiel). Synthetic leakage: compat solo en
superficies admin etiquetadas. Enumeración: 404/401 uniformes ya existentes
se preservan. **Invariante garantizada: DENY/INACTIVE jamás se vuelve
ALLOW/ACTIVE por fallback — no existe fallback.**

## S/T/U. Opciones (F17–F19)

**A — Canonical reads SQLite + login/credenciales JSON + compat sintética
explícita solo donde hace falta.** Autoridades claras, cero duplicación de
secretos, rollback=flag, cierra M1. **RECOMENDADA.**
**B — Credential store separado** + login híbrido: mejora futura real
(rotación, aislamiento de secretos) pero NO requerida por M1; añade una
migración de secretos con su propia superficie de riesgo. Diferida
(post-M1, unidad propia si se decide).
**C — Users 100 % JSON por ahora**: no impide operar, pero deja M1 sin
cerrar (sin verificación de dominio users en runtime oficial), mantiene la
deuda de frontera y pospone la única pieza que falta con TODO el trabajo de
equivalencia ya pagado. No recomendada; no rechazada por preferencia sino
por coste/beneficio: el riesgo del canary de lectura es hoy mínimo y
reversible.

## V. Definición de M1 (F20)

**M1 — IDENTITY CANONICAL = 100 %** se declara cuando:

1. los 5 dominios (users/groups/memberships/institutions/access) están
   representados en identity.db con equivalencia runtime sostenida
   (comparador: 0 inesperadas, gaps solo atestados);
2. las fronteras explícitas de dominio están desplegadas (groups GAP3-01,
   users GAP2-01) con UNKNOWN fail-closed y compat atestada;
3. la cohorte sintética está funcionalmente retirada (GAP1);
4. existe capacidad demostrada de canary de lectura controlado por dominio
   (flags por dominio + rollback probado);
5. **WRITE=JSON, LOGIN=JSON y credenciales solo-JSON — explícitamente DENTRO
   del contrato de M1**, no una carencia.

Mejoras futuras (NO M1): credential store B, write-cutover, purgas físicas
(PURGE-GROUPS-01), exclusión estadística (Fase 2).

## W/X. Interacciones (F21–F22)

- **GAP1**: tras retirement, la frontera de users clasifica los 400 como
  `ATTESTED_SYNTHETIC_COMPAT` (disabled) — visibles solo en admin/audit;
  las suites de GAP2-01 heredan las aserciones post-retiro (login 401,
  sesión 401) como PRE-condición de fixture.
- **GAP3**: compartir el PATRÓN (fuente atestada única, deny-by-default,
  vocabulario de telemetría `identity_*_domain_reads_total{class}`) y el
  loader de exclusiones (`attestedUserExclusionHashes` ya existe en el tool
  de GAP1; consolidar en un módulo `identityDomainAttestations` pequeño) —
  SIN framework genérico. Ramas siguen separadas.

## Y. Mapa de readiness por superficie (F23)

| Superficie | Estado |
|---|---|
| canonical user read / get / list operativo | **BLOCKED_BY_GAP2** (frontera pendiente — única causa) |
| membership user resolution | BLOCKED_BY_GAP2 |
| authz identity lookup | BLOCKED_BY_GAP2 |
| login / credential verification | **KEEP_JSON_AUTHORITY** (explícito) |
| user mutation | KEEP_JSON_AUTHORITY (RMW-SEAM) |
| synthetic historical/admin | **COMPAT_REQUIRED** |
| métricas legacy (denominadores) | **INSUFFICIENT_EVIDENCE** (acoplado a Fase 2 stats; decidir en GAP2-01 con consumidores) |
| tombstone resolution | READY (semántica idéntica, clasificación explícita) |

## Z. Recomendación (F24)

**Option A**, implementada como una sola unidad de frontera (patrón GAP3-01
probado), con la higiene de `sanitizeUser` incluida y la decisión de
denominadores de métricas resuelta explícitamente dentro de la unidad.

## AA. Unidad exacta (F25) — CHP-IDDB-02C-GAP2-USERS-AUTHORITY-01

Una sola unidad (no hay razón para dividir):

1. `identityUserDomains` (clasificador atestado: CANONICAL /
   ATTESTED_SYNTHETIC_COMPAT / TOMBSTONED / UNKNOWN) + composición del seam
   users bajo cutover (canónico SQLite ∪ compat admin-only), consolidando el
   loader de atestaciones con GAP3 sin sobre-abstracción.
2. Ampliar `sanitizeUser` (resetToken/inviteToken/resetExpiresAt/
   inviteExpiresAt) + test de no-persistencia de secretos en raw_json.
3. Contratos de list/get por superficie (operativo 247; admin explícito) con
   revisión de consumidores reales del frontend admin.
4. Decisión explícita de métricas (denominadores) coordinada con
   `CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01`.
5. Tests: cutover simulado con server real (login JSON intacto, sesión/authz
   desde SQLite, disabled canónico sigue disabled, sintético 404 en runtime
   y visible en admin-compat, tombstone 404 clasificado, unknown
   fail-closed, RMW 647→647, comparador alineado); image canary y ventana
   runtime; rollback = flag off.
6. Readiness esperado: users (lecturas) = READY_FOR_CONTROLLED_CANARY;
   login/mutación = KEEP_JSON_AUTHORITY declarado. → M1 cerrable tras los
   deploys pendientes.

## AB. Orden productivo (F26)

**Sin cambios** — ninguna razón técnica encontrada contra el orden vigente:
GAP4 F27 → BACKUP-CAPACITY-01B-DEPLOY → GAP1 retirement → GAP3 deploy →
GAP2-01 (users boundary) → evaluación M1.

## AD. Riesgos

- Ampliar `sanitizeUser` cambia `raw_json` de 647 espejos en el próximo
  write → ola única de `write_propagation`/updates esperada (idéntica a
  cualquier resync; el comparador la clasifica).
- El cambio de denominadores de métricas debe ser decisión visible de
  producto/datos, no efecto colateral del seam.
- La superficie admin-compat de users no existe hoy como endpoint separado:
  el contrato debe definirse sin romper la UI admin actual (revisión de
  consumidores en GAP2-01).
