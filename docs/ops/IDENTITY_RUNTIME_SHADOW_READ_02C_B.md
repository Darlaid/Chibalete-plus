# CHP-IDDB-02C-B — Comparación runtime JSON ↔ SQLite en modo sombra

**Unidad:** CHP-IDDB-02C-B
**Base:** `89407f0` (RMW-SEAM-01)
**Naturaleza:** observabilidad. JSON sigue siendo la autoridad de respuesta,
autenticación, autorización y mutación. **Ninguna respuesta SQLite llega al
usuario.**

## Qué hace

Para cada lectura de identidad elegible, después de que el resultado oficial ya
existe, se calcula en paralelo la respuesta que daría el espejo SQLite y se
comparan **semánticamente**. Solo se emiten contadores.

```
lectura JSON  → RESULTADO OFICIAL (respuesta, authn, authz, mutación)
lectura SQLite → resultado sombra  → comparador → telemetría agregada
```

`observeIdentityShadowRead()` recibe el resultado oficial por referencia,
devuelve `undefined`, no lo muta y **nunca lanza**. Si algo falla dentro, se
cuenta `COMPARATOR_ERROR` y el runtime continúa idéntico.

## Interruptor propio (no reutiliza el del cutover)

| Variable | Default | Efecto |
|---|---|---|
| `IDENTITY_SHADOW_COMPARE` | *(off)* | activa la comparación |
| `IDENTITY_SHADOW_COMPARE_DOMAINS` | `users,groups,institutions,memberships,access` | allowlist del observador |
| `IDENTITY_SHADOW_COMPARE_TTL_MS` | `1000` | ventana de memoización de la huella de fuentes |
| `IDENTITY_SHADOW_COMPARE_STALE_MS` | `5000` | gracia máxima de propagación del dual-write (`0` la desactiva) |

`IDENTITY_READ` / `IDENTITY_READ_DOMAINS` son **otro eje**: este módulo no los
lee ni los escribe. Encender el comparador no puede cambiar el backend oficial;
apagarlo es el rollback primario y no toca el dual-write.

## Taxonomía

| Clasificación | Significado |
|---|---|
| `MATCH` | JSON y SQLite equivalentes bajo el contrato |
| `EXPECTED_COVERAGE_GAP` | diferencia prevista por una política conocida |
| `UNEXPECTED_DIVERGENCE` | diferencia que ninguna política explica |
| `SECURITY_RELEVANT_DIVERGENCE` | podría cambiar authn/authz/scope/rol/membresía |
| `COMPARATOR_ERROR` | el observador no pudo calcular |

Precedencia por lectura: `error > security > unexpected > gap > match`.

Es `SECURITY_RELEVANT` toda entidad presente **solo** en el espejo (dirección
conceder), toda membresía extra o duplicada, y toda divergencia en campos que
alimentan autorización (`roles`, `accountStatus`, `organizationId`, `groupIds`,
`colegio`, `type`, `memberIds`, `mediatorIds`, `teacherId`, `school`,
`titleIds`, `collectionIds`).

## Contrato de comparación

Reutiliza el de 02C-A. **No** se comparan credenciales ni sus hashes,
timestamps internos, `provenance`, `source_version`, contabilidad del espejo ni
el orden de arrays de ids (se comparan como conjuntos). Sí se compara todo campo
funcional del registro.

## Política de gaps — por regla, jamás por lista de IDs

Una ausencia en el espejo solo es esperada si **la misma regla que usa el
espejo** la explica: `projectUsers`/`projectGroups` la rechazan, está en
`migration_exclusions`, es un tombstone, o su institución no está registrada.
Si el espejo no sabe explicar la ausencia → `UNEXPECTED_DIVERGENCE`.

| Clase | Origen |
|---|---|
| `SYNTHETIC_USER` | GAP-1 — `_loadtest_marker` (misma regla que `projectUsers`) |
| `LEGACY_GROUP` | GAP-3 — exclusión de migración / no proyectable / institución no registrada |
| `CREDENTIAL_AUTHORITY` | GAP-2 — el espejo nunca guarda credenciales (1 entrada por evaluación, no por usuario) |
| `ACCESS_RULES` | GAP-4 — dominio sin backfill |

Cualquier otra clase (`TOMBSTONED_IDENTITY`, `EXCLUDED_BY_DISPOSITION`,
`NOT_PROJECTABLE_BY_POLICY`, `WRITE_PROPAGATION`) se publica en
`gaps_outside_approved`: es una ausencia explicada por política pero **no
prevista**, y exige investigación.

### Ventana de propagación del dual-write (hallazgo del image canary)

El primer image canary reportó dos `UNEXPECTED_DIVERGENCE` en `users`. La causa,
reproducida y aislada: un login escribe `lastLoginAt` en el JSON y el espejo
aplica esa instantánea unos milisegundos después; una lectura en medio ve una
diferencia **real pero transitoria** que se cura sola.

Se detecta a coste cero: `shadow_state.last_source_seq` guarda el `mtime` que
tenía el JSON cuando el hook espejó esa instantánea, y el `mtime` actual ya se
lee para la huella. Si el fichero es más nuevo **y la escritura acaba de
ocurrir** (≤ `STALE_MS`), el espejo no está equivocado: va por detrás. Esas
diferencias se cuentan como `WRITE_PROPAGATION` (`stale_mirror_evaluations`,
`stale_mirror_entities`), conservando en la muestra la forma original
(`shape`), y el veredicto **no se memoiza** para que la siguiente lectura mire
de nuevo ya asentado.

La gracia está **acotada en el tiempo a propósito**: pasado ese plazo, que el
espejo siga por detrás ya no es latencia sino divergencia real. Sin ese límite,
una edición fuera de banda del JSON (script, restore) dejaría al comparador
ciego para siempre.

### Retención de muestras

El mismo canary destapó un segundo defecto: el muestrario se sustituía en cada
evaluación, así que una evaluación limpia posterior **borraba la evidencia** de
la divergencia anterior (`samples: []` justo cuando había 2 divergencias
contadas). Ahora las muestras se retienen por gravedad a lo largo de todas las
evaluaciones, con marca temporal, cupo para los gaps de volumen y desalojo
únicamente de muestras menos graves.

## Coste y memoización (no oculta divergencias)

Evaluar 647 usuarios campo a campo en cada request sería inaceptable. Se memoiza
el veredicto por dominio, invalidado por la huella de **ambas** fuentes
(mtime+size del JSON, versión de `shadow_state` y cardinalidad de la tabla),
re-sondeada como mucho una vez por TTL. Consecuencias exactas:

- toda lectura elegible se clasifica → `comparisons`;
- la evaluación completa solo se repite si alguna fuente cambió o expiró el TTL
  → `evaluations`;
- una divergencia que aparece en T se detecta como muy tarde en T+TTL.

Ambos contadores se publican por separado: nada se declara "comparado" sin decir
cuántas evaluaciones reales lo respaldan.

## Telemetría

- Prometheus: `chibalete_identity_shadow_compare_total{domain,surface,result}`,
  `..._entities_total{domain,gap}`, `..._duration_seconds{domain}`.
  Cardinalidad fija: 5 dominios × 2 superficies × 5 resultados.
- Ruta operacional **secret-only** (mismo guard y las mismas razones que la de
  request-context): `GET /api/admin/system/identity/shadow-compare`.

Nunca se registran nombres, correos, contraseñas, tokens, ids crudos ni
payloads: las referencias van hasheadas (`h16` = sha256 truncado). El muestrario
prioriza por gravedad, de modo que cientos de gaps esperados no pueden desplazar
a la única muestra de seguridad.

## Superficies observadas

| Superficie | Dominios | Clase |
|---|---|---|
| `seam` (`readJSON` de server.js + `accessService`) | users, groups, access, institutions | respuesta + authn + authz |
| `cis` (`readIdentityArray` de `identity/cis.mjs`) | users, groups, institutions | authz de `/api/v2/metrics` |

Las **26 lecturas base de mutación** ya no atraviesan el seam desde `89407f0`
(leen el JSON físico), así que el comparador no puede observarlas ni
contaminarlas. `memberships` se deriva del mismo array de grupos ya leído.

## Rendimiento (sandbox, corpus 647/20, 300 iteraciones)

| Superficie | OFF p50/p95/p99 (ms) | ON ttl=1000 p50/p95/p99 (ms) |
|---|---|---|
| `GET /api/users` | 4.34 / 5.46 / 7.22 | 4.06 / 4.88 / 7.35 |
| `GET /api/groups` | 2.37 / 3.44 / 4.56 | 2.01 / 2.71 / 3.25 |
| `GET /api/groups/:id/members` | 3.30 / 4.18 / 4.88 | 3.06 / 4.09 / 5.57 |
| `GET /api/students/:id/status` | 4.28 / 5.10 / 5.74 | 4.23 / 5.21 / 6.38 |

Con TTL=1000 los deltas quedan dentro del ruido (varios negativos). En el peor
caso medido (TTL=0, sonda de huella en cada lectura) el sobrecoste es ≤0.8 ms
p50 y ≤1.7 ms p99. RSS +6…8 MB. **Por eso no se implementa sampling:** comparar
el 100 % es barato; `comparison_rate` = 1.0.

## Rollback

`IDENTITY_SHADOW_COMPARE=OFF` (default) → el observador desaparece sin tocar
`IDENTITY_DUAL_WRITE` ni `IDENTITY_READ`. Rollback de imagen: `89407f0`.

## Lo que esta unidad NO hace

No activa `IDENTITY_READ=sqlite`, no añade dominios al backend oficial, no
sirve respuestas SQLite, no cambia la autoridad de login ni de authz, y no
resuelve GAP-1..4. El mapa de readiness derivado de la ventana productiva dice
qué dominios podrían optar a un canary futuro y cuáles siguen bloqueados.
