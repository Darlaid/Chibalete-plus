# GAMIFICACION-G4-04: alineación reducida de G3 con G4

**Fecha:** 2026-10-30 · **Base:** `c75808a` (G4-03 y la corrección de aislamiento publicados; CI 3/3 en verde) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance autorizado:** reducido. Sin esquema, migraciones, identificadores de obra ni escrituras personales nuevas. Ningún flag activo.

## 1. Qué cambió

| Archivo | Cambio |
|---|---|
| `server/gamification/db.mjs` | `isXpEarningEnabled` con `XP_EARNING_ENABLED`, hijo de `GAMIFICATION_ENABLED`, OFF por defecto. `PM_EARNING_ENABLED` ya solo gobierna PM |
| `server/gamification/policy.mjs` | `PM_LOCKED_SOURCES` y `XP_LOCKED_SOURCES`; `validateRules` rechaza reglas que emitan desde ellas; `decideEmission` aplica el bloqueo también a reglas ya guardadas |
| `server/gamification/ledger.mjs` | Lee los dos flags; retira `activeMinutes` y `mode` de las `features` persistibles |

**Sin cambios:** `recognition.mjs`, `mookSource.mjs`, `intake.mjs`, `reconcile.mjs`, el esquema, `progress.db`, MOOK y `server.js`.

## 2. Matriz de emisión vigente

| Fuente | XP | PM | Con ambos flags ON | Motivo |
|---|---|---|---|---|
| `reading_completion` | Bloqueado | Bloqueado | `observed` | A1; sigue en `LOCKED_SOURCES` |
| `mook_experience` | Según regla y flag | **Bloqueado siempre** | `awarded`, solo XP | Completar una ruta no demuestra comprensión |
| `mook_review` | Bloqueado | Bloqueado | `observed` | Sin cobertura de obra y ciclo |
| `offline_validation` | Bloqueado | Bloqueado | `observed` | Igual, y sin flujo |
| `mission` | Según regla y flag | Según regla y flag | Sin llamador | Fuera de los bloqueos autorizados |

**Decisión conservadora:** el encargo pedía deshabilitar PM de revisión y validación. También bloqueé su **XP**: sin obra asociada no se puede aplicar el techo por obra y ciclo de A4, y N producciones darían N veces XP. Cuando falta información, no se reconoce.

**Consecuencia:** hoy el único XP posible es el de ruta MOOK, y ningún PM es alcanzable desde una fuente conectada.

## 3. `mission` como banco de pruebas

Las suites de topes, idempotencia, concurrencia y saldo emitían PM por `mook_review`. Se movieron a `mission` para conservar esa cobertura **sin añadir un atajo de pruebas en producción**.

- `mission` tiene grado B y regla configurable, pero nada del producto registra esos hechos; hay una prueba que lo verifica.
- **Deuda:** la doctrina dice que las misiones no dan PM personales (D38). El bloqueo definitivo de `mission` queda para G7, o antes si se prefiere. Requiere otro banco de pruebas para la mecánica de PM.

## 4. Lo que no se alineó

Necesita decisiones que no existen todavía:

| Contrato | Falta |
|---|---|
| La política usa `decideRecognition` dentro de la transacción | `workRef`, ciclo e historial por obra |
| Unicidad de PM por usuario, obra y ciclo | Ídem |
| Techo de XP por obra y ciclo | Ídem |
| Comprensión verificable en `mook_review` | Saber qué obra evalúa una producción |
| PM de `offline_validation` | Flujo del mediador (G7 o G4-11) |

**Prerrequisitos:** definir la obra de una evidencia MOOK y aplicar `GAMIFICACION-PRIV-01` antes de escribir cualquier referencia de obra, porque `gm_source_facts` es append-only. PRIV-01 sigue siendo requisito previo a toda activación con usuarios reales.

## 5. Aislamiento de pruebas

- `mookHooksHttp` quedó aislado y con huella de stores reales (`c75808a`).
- **Otras 10 suites siguen lanzando `server.js` sin aislar.** Para validar esta unidad se ejecutaron con las rutas SQLite exportadas a temporales desde fuera, y la huella real quedó idéntica. Ejecutadas sin ese entorno siguen expuestas: necesitan su propia unidad.
- `server/leoMemoryService.js`, `leoICDLIBridge.js`, `analyticsShadow.mjs` y `lu_config.json` tienen ruta fija sin variable. No se pueden redirigir sin tocar el servidor; solo la huella los cubre.
