# IDENTITY_SYNTHETIC_USERS_GAP1_AUDIT — cohorte sintética y su dependencia activa

Unidad: **CHP-IDDB-02C-GAP1-SYNTHETIC-USERS-00** (read-only, 2026-08-13).
Baseline: `chibalete/api:f885e31`, users JSON=647 (400 sintéticos + 247
reales), canónico=247, LIVE=MATCH. **Cero mutación.**

## Veredicto

**GREEN — SYNTHETIC USER COVERAGE ROOT CAUSE AND SAFE CLOSURE PATH DEFINED**

con un **SECURITY_RELEVANT_FINDING** registrado (no un STOP: la capacidad
observada coincide exactamente con la atestada; lo que ha caducado es la
tolerancia al riesgo de esa atestación, ver §Seguridad).

## Atestación de la cohorte (F1) — `SYNTHETIC_COHORT_ATTESTED=true`

Doble identificación reproducible y CONCORDANTE (400=400):

1. **Marcador de registro**: `_loadtest_marker='__loadtest__'` en el padrón
   (el que usan comparador, live-sources y proyección).
2. **Exclusión atestada**: `migration_exclusions(entity='user',
   disposition='SYNTHETIC_LOADTEST_QUARANTINED')` ×400 en identity.db.

Nada depende de patrón de email, nombre, orden ni pertenencia a grupo.

## Censo actual (F2) — recalculado

400/400: `accountStatus=active`, rol `lector`, **password bcrypt presente**
(mismo esquema que los 247 reales: 647/647 bcrypt, **cero plaintext legacy**),
`colegio` textual, **0 organizationId, 0 groupIds, 0 lastLoginAt**. Relación
de grupo EXCLUSIVAMENTE por `memberIds` del grupo `lt-` (400/400, ninguno
fuera; cero referencias user-side). Sin dangling.

## Autenticabilidad (F3) — `SYNTHETIC_LOGIN_CURRENTLY_POSSIBLE=true`

Por código (sin login productivo): `POST /api/auth/login` lee el **JSON
físico** (`readCanonicalStoreForMutation`, RMW-SEAM-01) → bcrypt.compare →
`isUserActive` (400 activos: pasa) → sesión (patrón x-user-id) → endpoints
autenticados → títulos vía `lt-access-v2`. La suite RMW ya demostró en
fixture-server el login GREEN con el padrón 647 bajo cutover simulado.

## Uso real (F4)

- **Evidencia persistente (todo el histórico): `lastLoginAt` ausente en
  400/400** — ningún login sintético registrado desde que el campo existe.
- Progress sintético: 7.087/7.215 filas (98,2 %) en `progress.db`,
  **congelado desde 2026-04-19** (~4 meses sin crecer).
- Logs: 0 menciones `lt_user` en API (ventana corta: containers reiniciados
  hoy) y 0 en audit log; 28 logins totales en 48 h (reales). Ventanas
  declaradas; para actividad de red antigua: `USAGE_UNKNOWN` — pero la
  evidencia persistente (lastLoginAt + progress) cubre el histórico.

## Consumidores (F5)

La cohorte es un artefacto del **«Test 2.0» de carga**, con tooling completo
versionado en `scripts/loadtest/`: `seed_users.js` (creó los 400 con password
compartida documentada), `setup_school_session.mjs` (creó `lt-test-group-v2`
+ `lt-access-v2`), `k6_school_v2.js` (los usa), y **los cleanups existen y
nunca se ejecutaron**: `cleanup_school_session.mjs` (grupo+regla) y
`cleanup_users.js` (usuarios). CI no ejecuta load tests; sin dependencias de
QA/smoke/demo/monitoring encontradas; sin uso en runbooks vigentes.
Clasificación: **REPLACEABLE** (una campaña futura puede re-seedear con el
mismo tooling — idealmente contra un tenant/entorno no productivo, ver
Policy C) — ninguna función ACTIVE_REQUIRED.

## Credenciales (F6) — sin resolver GAP-2 aquí

Mismo esquema bcrypt que los reales; sin plaintext; el auto-upgrade legacy
existe pero ya no tiene casos; el login reescribe `lastLoginAt` (async,
store físico, espejado por el hook). **Hallazgo de seguridad**: la password
compartida de los 400 está **documentada en texto plano en el repo**
(`seed_users.js`) y `users.json`/`session_data.json` de la campaña están
versionados.

## Dependencia de access (F8) y contenido (F9)

`lt-access-v2`: scope group → grupo sintético, **activa** (sin expiración),
creada por `setup_school_session.mjs` tomando el catálogo real vía
`GET /api/content`. Sus 64 títulos existen 64/64 hoy = **96 % del catálogo
real (67)**. No es contenido de prueba: es el catálogo editorial. Ninguna
función de producto/demo vigente encontrada: exclusivamente load-test. Si el
grupo sintético desapareciera, la regla quedaría sin efecto (scope sin
miembros); la regla NO afecta a usuarios reales (ninguno es miembro).

## Seguridad (F11) — `SECURITY_RELEVANT_FINDING`

Capacidades del principal sintético: rol lector; sin org (fuera del scope
institucional/CIS); modo estricto por regla aplicada → exactamente los 64
títulos; sin capacidades admin; sujeto al IDOR conocido de GETs autenticados
(deuda `CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01`, que las 400 identidades
**amplifican**). Nada excede lo atestado → no aplica el STOP. **Pero**: 400
cuentas activas × credencial compartida versionada en git × 96 % del
catálogo real = superficie de exposición editorial sin función activa. Es el
motor principal de la recomendación de retiro.

## identity.db policy (F12)

Exclusión correcta y vigente (cuarentena 01B). Ningún requisito cambió:
**`SYNTHETIC_USERS_CANONICAL_TARGET=false`**.

## Login-cutover (F13) — hallazgo estructural

**USER READ DOMAIN y LOGIN AUTHORITY ya están separados**: desde RMW-SEAM-01
el login lee el JSON físico, no el seam conmutable. Bajo un cutover futuro de
lecturas de `users`, el login (real y sintético) seguiría funcionando
mientras las lecturas canónicas sirven 247. **GAP-2 queda reducido a una
decisión de AUTORIDAD de credenciales (dónde deben vivir), no a un bloqueo de
cableado.**

## Superficies de lectura de users (F14)

| Surface | Visible | Auth-sensitive | ¿Necesita compat sintética? |
|---|---|---|---|
| `GET /api/users` (list, admin UI) | admin | no | temporal (hoy muestra 647) |
| get user / students status | admin/mediador | no | temporal |
| group members (grupo lt) | admin | no | temporal (hasta purga del grupo) |
| login | — | **sí** | NO: lee físico (fuera del seam) |
| métricas legacy (progress 98 % sintético) | informes | no | NO: es exclusión estadística (Fase 2) |
| CIS/authz institucional | — | sí | NO: sin org, ya fuera |
| access engine | — | sí | solo mientras exista `lt-access-v2` |

## Matriz de decisión (F21)

| Aspecto | Estado | Dependencia activa | ¿Target canónico? | ¿Retirable? | ¿Compat? | Blocker | Policy |
|---|---|---|---|---|---|---|---|
| 400 users | activos, 0 logins ever | ninguna | NO (atestado) | SÍ (disable, no purge) | lectura temporal | ninguno | **A** |
| grupo sintético | compat GAP-3 | regla lt-access-v2 | NO | tras retirar regla | ya existe (GAP-3) | GAP-1 | A→GAP-3 signal |
| lt-access-v2 | activa | solo load-test | n/a | SÍ (expiresAt) | no | ninguno | **A** |
| credenciales | bcrypt, compartida en repo | — | GAP-2 | — | — | — | A reduce riesgo |
| contenido (64) | catálogo real | — | — | — | — | — | intacto |
| progress 7.087 | congelado 04-19 | métricas legacy infladas | NO | NO (preservar) | — | Fase 2 | intocado |
| login | físico, desacoplado | — | GAP-2 policy | — | NO | — | — |
| user reads | JSON 647 | — | 247 | — | frontera GAP2-boundary | — | **B (lecturas)** |

## Opciones (F22)

**A — RETIRE (autenticación + regla), preservando histórico.** Deshabilitar
`accountStatus` de los 400 y expirar `lt-access-v2` vía writers reales
(espejados por dual-write); sin purgar registros ni progress. Reversible al
100 % (status flip + re-upsert de la regla). Elimina la superficie de
seguridad, habilita la señal de retiro de `ATTESTED_SYNTHETIC_COMPAT`
(GAP-3 F19) y no toca Fase 2. Complejidad baja.

**B — Frontera explícita de LECTURA de users** (espejo de GAP3-01):
`classifyUserReadDomain → CANONICAL | ATTESTED_SYNTHETIC_COMPAT | UNKNOWN`,
jamás `SQLite miss → JSON fallback`. **No sustituye a A: es complementaria**
— es lo que hará READY el dominio de lecturas de `users` mientras los 400
sigan físicamente en el padrón (hasta purga futura).

**C — Aislamiento de identidades de test** (tenant/entorno no productivo o
cohortes efímeras con cleanup en el mismo runbook) para campañas FUTURAS.
Dirección correcta; no requiere construcción ahora.

**Recomendación: A ahora (GAP1-01), B como parte de la unidad de frontera de
users (con GAP-2), C como política para futuras campañas.** A y B no
compiten: A retira función y riesgo; B habilita el cutover de lecturas.

## Unidad siguiente (F23) — CHP-IDDB-02C-GAP1-SYNTHETIC-USERS-01

**Attested synthetic retirement** (no purga):

1. Expirar `lt-access-v2` con el writer real (`POST /api/access` upsert con
   `expiresAt` pasado — la semántica de expiración está probada en GAP-4;
   nota: no existe DELETE de reglas; verificar que `cleanup_school_session`
   no dependa de un endpoint inexistente).
2. Deshabilitar autenticación de los 400 (`accountStatus` no-activo) vía
   writer real en lote controlado (espejado por dual-write; `isUserActive`
   bloquea el login con 401 genérico).
3. Preservar: registros JSON (cuarentena), progress íntegro, grupo lt
   (su retiro sigue el camino GAP-3 → PURGE-GROUPS-01).
4. Gates: dry-run local + image canary (login sintético 401, login real 200,
   regla expirada no aplica, 0 cambios de cardinalidad), backup pre/post
   (**tras F27 + BACKUP-CAPACITY-01B-DEPLOY**), ventana runtime (0 intentos
   sintéticos esperados; contadores de login sin anomalías), rollback
   documentado (status flip + re-upsert con los valores actuales,
   registrados en el manifiesto), readiness update.

## Consecuencia de readiness (F24)

Cerrar GAP-1 **no hace READY a `users` por sí solo**: los 400 registros
siguen en el padrón (gap esperado `SYNTHETIC_USER` del comparador continúa,
correctamente atestado) y el cutover de lecturas exige la frontera
explícita (B). Tras GAP-1: `users` queda bloqueado únicamente por
**GAP-2 reducido** (autoridad de credenciales — decisión de política, no
cableado: F13) + la frontera de lectura pendiente. Camino: GAP1-01 (retiro) →
unidad users-boundary (B, patrón GAP3-01, incorporando la decisión GAP-2) →
USERS = READY_FOR_CONTROLLED_CANARY.

## Interacciones

- **GAP-2 (F18)**: separables. GAP-1 retira función sintética sin tocar
  login; GAP-2 decide autoridad de credenciales (el único acople real:
  ambos comparten el padrón físico y el hook de espejo).
- **GAP-3 (F19)**: `ATTESTED_SYNTHETIC_COMPAT` podrá retirarse cuando (regla
  expirada) ∧ (autenticación deshabilitada) ∧ (telemetría
  `compat_synthetic=0` en ventana) → entonces el grupo entra al camino de
  purga atestado.
- **Fase 2 (F20)**: `CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01` **sigue siendo
  necesaria** — el retiro de identidades NO limpia las 7.087 filas ni los
  denominadores; no se mezclan.

## Riesgos

- La password compartida versionada seguirá siendo válida hasta ejecutar
  GAP1-01 (mitigación interina posible y reversible: nada que hacer en esta
  unidad read-only; priorizar GAP1-01 tras la secuencia de backup).
- Retención de logs corta: la ausencia de intentos de login sintéticos
  recientes se apoya en `lastLoginAt` (histórico completo) más que en logs.
- `cleanup_school_session.mjs` puede referirse a endpoints ya inexistentes:
  GAP1-01 debe validar su vía o usar el upsert de expiración.
