# GAMIFICACION — Contratos de eventos, progresión y API V1

**Unidad:** GAMIFICACION-G2-01 · **Fecha:** 2026-10-29 · **Baseline:** `ce450ea`.
**Estado:** PROPUESTA técnica para G3–G5. No hay código.
**Relacionados:** [ADR G2](GAMIFICACION_ADR_G2_V1.md), [Modelo de datos V1](GAMIFICACION_MODELO_DATOS_V1.md) y [Contratos funcionales V1](GAMIFICACION_CONTRATOS_V1.md).

---

## 1. Principio de autoridad

- **Nada del navegador llega al motor como hecho.**
  - Los hechos los produce el **servidor** en el punto donde ya validó algo (una revisión MOOK con sesión y alcance, un `/complete` con `requireProgressOwner`).
  - Se entregan al motor con una **función interna dentro del proceso**.
- **No existe `POST /api/gamification/events/ingest`.** La fuente doctrinal lo proponía «solo para fuentes internas»; se sustituye por la función interna, porque todas las fuentes viven en el mismo proceso Express.
- **Ningún endpoint HTTP acepta montos de XP ni de PM**, salvo el ajuste administrativo (§5.3), que exige un motivo y queda auditado.

## 2. Contrato interno de hechos de fuente

```js
// server/gamification/intake.mjs (G3). Firma propuesta.
recordSourceFact({
  source,          // 'mook_review' | 'mook_experience' | 'reading_completion' | 'offline_validation' | 'mission'
  sourceEventId,   // id estable de la fuente (ver tabla); nunca Date.now()
  factType,        // ver tabla
  userId,          // sujeto: siempre del registro de la fuente, nunca del body
  actorId,         // quien validó (revisor, sistema)
  occurredAt,      // reloj del servidor (ms)
  features,        // resumen mínimo para auditar la decisión (sin texto libre)
}) → { decision, factId, xp?, pm? }
```

**Garantías:**
- es síncrono y una sola transacción `IMMEDIATE`;
- es idempotente por `(source, sourceEventId, factType)`;
- **nunca lanza hacia el llamador**: el gancho lo envuelve (§6).

| Fuente | `sourceEventId` | `factType` | Punto del gancho (aditivo) | Evidencia previa que ya garantiza el servidor |
|---|---|---|---|---|
| `mook_review` | `evidenceId` | `evidence_reviewed` | Después de `mutateMook(reviewEvidence)` en `POST /api/experiences/review/:evidenceId` (`server.js:3039`) | Sesión firmada, `requireReviewScope` y transición única a `REVIEWED` (`ALREADY_REVIEWED`) |
| `mook_experience` | `${userId}:${experienceVersionId}` | `experience_completed` | Donde el servidor marca la experiencia completada (punto exacto por fijar en G4-2) | Progreso de nodos en el servidor (`mutateMook`) |
| `reading_completion` | `${userId}:${contentId}:${windowKey}`. `windowKey` es la ventana de relectura de D08 (CONFIGURABLE), calculada por el servidor. **No se usa un contador por llamada**: repetir `/complete` dentro de la misma ventana colapsa en un solo hecho | `reading_completed` | Después de `upsertProgress` en `POST /api/progress/:userId/:contentId/complete` (`server.js:5195`) | **Solo** el dueño de la sesión; la finalización **la declara el cliente** (§3) |
| `offline_validation` | id de la validación docente | `offline_activity_validated` | G7 | Mediador con alcance |
| `mission` | `${orgId}:${missionId}:${period}` | `mission_completed` | G7 | Agregados institucionales |

## 3. Las tres restricciones verificadas

### 3.1 La finalización de lectura no es evidencia A: validador en modo observación (G4-1)

- **Hecho verificado:** `/complete` hace `isCompleted=true` y `globalPercentage=100` por declaración del cliente.
- **Señales canónicas de lectura en `events.db`:**
  - `reading_started`, `reading_progress`, `session_heartbeat`, `session_ended` y `reading_completed` (`server/analytics/eventRegistry.js:47-57`);
  - **las origina el cliente**, pero llegan con sesión firmada y con el `server_ts` del servidor.

**Diseño:**

1. **Entrada:** el hecho `reading_completion`, más lecturas de **solo lectura** de:
   - `progress.db`: el historial de sesiones del registro, hasta 20 entradas;
   - `events.db`: los eventos canónicos de ese usuario y esa obra en una ventana acotada, con `server_ts`;
   - los metadatos de longitud de la obra (`totalSentences` / `wordCount`) cuando existan.
2. **Características** calculadas con el reloj del servidor:
   - tiempo activo (heartbeats unidos, nunca sumados entre pestañas; mismo criterio de unión temporal que la doctrina de regalías, **reimplementado y sin importarlo**);
   - número de sesiones y días distintos;
   - avance máximo observado y si fue monotónico;
   - ritmo implícito (unidades de texto por minuto activo) frente a la longitud;
   - huecos.
3. **Veredicto:**
   - `plausible`;
   - `implausible`, con motivos (`too_fast`, `no_activity`, `jump_to_end` y similares);
   - `insufficient_data`, con motivos (`no_length_metadata`, `events_unavailable`, `mode_not_instrumented`).
4. **Modo observación** (`READING_VALIDATOR_MODE=observe`, por defecto): se registra `gm_source_facts.decision='observed'` con el veredicto y las características. **No se emite ni XP ni PM por lectura.**
5. **Paso a emisión:** solo tras una calibración con datos reales, aceptada por Producto y Pedagogía (umbral de falsos rechazos acordado, Implementación V1, STOP de G4).
   - Aun así: `insufficient_data` **nunca** cuenta como A, e `implausible` nunca emite.
6. **Límite honesto:** el validador demuestra **plausibilidad**, no lectura. Por eso, aunque se active, la lectura emite PM con **rendimiento decreciente y topes** (D08), y MOOK revisado sigue siendo la fuente de mayor peso.
7. **Aislamiento:** el validador se ejecuta **después** de responder al cliente (§6). `/complete` responde igual con o sin motor.

**Dependencias abiertas:**
- (a) Hay que inventariar los metadatos de longitud por modo (PDF, EPUB, texto, álbum, inmersivo); los modos sin longitud quedan como `insufficient_data`.
- (b) Hay que verificar en G4-1 que cada visor emite los eventos canónicos que el validador necesita.

### 3.2 Q/R/S: fuera del motor

- Q y R son agregados **por obra, sin identificador de lector** (`economicEpisodes.mjs:413`), se calculan bajo demanda y solo con `ECONOMIC_INGEST_MODE=on`.
- **Contrato:** el módulo `server/gamification/**` no importa nada de `server/royalties/**` y no lee `econ_events`. D07 queda GATED y no hay ningún gancho previsto.
- Si en el futuro un contrato formal admitiera una señal económica como elegibilidad, entraría como **una fuente nueva** con su propia unidad, nunca como lectura directa del motor económico.

### 3.3 Leo: sin emisión; integración futura solo por evento estructurado

- **Hoy:** G0 elimina `[AWARD_POINTS]` en el servidor y en el cliente (`server/leoAwardTokens.js`). El motor **no tiene fuente `leo`**.
- **Futuro (D10-B, GATED):** una fuente `leo_activity` solo si:
  1. hay un evento estructurado `leo_*` emitido por el **servidor**, con `LEO_EVENTS_BACKBONE_ENABLED`;
  2. un validador determinista (no un LLM) decide la elegibilidad;
  3. la cantidad la fija `rule_version`, **nunca el modelo**;
  4. el texto del modelo jamás se interpreta como instrucción de emisión. Hay una prueba de que un `[AWARD_POINTS:n]` o cualquier variante en la respuesta no produce ningún hecho.

## 4. Habilitación inicial de fuentes

| Fuente | XP | Logros | PM | Estado inicial (G3/G4) |
|---|---|---|---|---|
| MOOK revisado (`mook_review`) | ✅ | ✅ | ✅ con topes | **Habilitable** detrás de flags. **Pendiente:** si `con_comentarios` cuenta como aprobado (Doctrina §6-8). Hasta decidirlo, **solo `aprobado` emite** y `con_comentarios` se registra como `observed` |
| MOOK, experiencia completada | ✅ | ✅ | ✅ con menor peso | Habilitable en G4-2 |
| Lectura terminada | 🔶 | 🔶 | 🔶 | **Solo observación** hasta calibrar el validador |
| Hitos de lectura | — | — | — | Deshabilitado; se define en G4 |
| Validación offline del docente | — | — | — | Deshabilitado hasta G7 |
| Misiones | — | Institucionales | **Nunca personales** | G7 |
| Leo | ❌ | ❌ | ❌ | Deshabilitado (D10) |
| Oralidad | ❌ | Según D11 | ❌ | Deshabilitado |
| Q/R/S | ❌ | ❌ | ❌ | Fuera del motor (D07) |
| Grado D (bloques inmersivos, tiempo, clics) | ❌ | ❌ | ❌ | Nunca (P4) |

**Reglas de elegibilidad comunes**, evaluadas en la transacción del hecho:
- Hay **exclusión** si el sujeto es sintético o de QA (`isSyntheticUser`, `server/identity/organizationScope.mjs:62`) o está en la lista `GAMIFICATION_EXCLUDED_USER_IDS`. Se registra como `rejected_excluded_user`.
- **Hallazgo G2: no hay autorrevisión.** `reviewEvidence` no impide que el revisor sea el autor, y un administrador puede revisar cualquier evidencia. El motor exige `actorId ≠ userId`; si no, registra `rejected_self_review` y no emite. MOOK no se modifica.
- Las cuentas desactivadas no emiten (`rejected_inactive_account`).

## 5. API HTTP

**Convenciones** (comunes a todos los endpoints):
- Base `/api/gamification/`.
- `Cache-Control: no-store`.
- Identidad **solo de la sesión** (`requireUserAuth` → `req.user`), nunca de la ruta ni del body, salvo en los endpoints de administración.
- Errores con la forma `{ error, code }` (igual que MOOK).
- Paginación por cursor opaco.

**Si el flag padre está en OFF:** `GAMIFICATION_ENABLED=0` responde `404 { code: 'GAMIFICATION_DISABLED' }` en todos los endpoints.

### 5.1 Consulta (lector), G3/G4

| Método y ruta | Flag | Respuesta | Notas |
|---|---|---|---|
| `GET /me` | `GAMIFICATION_ENABLED` | `{ xp, level: { id, label, next }, pm: { available, reserved } \| null, achievementsCount, flags: { earning, redemption } }` | `pm` es `null` si la UI de PM no está habilitada; la UI no anuncia lo que no existe (P7) |
| `GET /me/ledger?cursor=` | ídem | `{ items: [{ movementId, kind, amount, reasonCode, source, createdAt, status }], nextCursor }` | Explicación por `reasonCode` (D32); sin datos de terceros |
| `GET /me/achievements` | ídem | `{ items: [{ achievementId, awardedAt, voided }] }` | — |
| `GET /me/xp?cursor=` | ídem | Asientos de XP con su motivo | — |

### 5.2 Recompensas (G5-A; contenido G5-B; cupones G6)

| Método y ruta | Flag | Contrato |
|---|---|---|
| `GET /rewards` | `GAMIFICATION_ENABLED` | Solo las recompensas **entregables ahora**. Si `PM_REDEMPTION_ENABLED` está en OFF, la lista va vacía con `reason: 'redemption_disabled'`. Los cupones no aparecen salvo con `COMMERCIAL_REWARDS_ENABLED` y `WOO_COUPONS_ENABLED` |
| `POST /redemptions` | `PM_REDEMPTION_ENABLED` (+ comerciales) | Body `{ rewardId }` con cabecera **`Idempotency-Key`** obligatoria. **El precio lo fija el servidor**; cualquier `amount` en el body se ignora y se registra. Respuestas: `201 { redemptionId, state }` / `200` (reintento) / `409 INSUFFICIENT_BALANCE` / `409 LIMIT_REACHED` / `403 ADULT_AUTHORIZATION_REQUIRED` / `503 GAMIFICATION_BUSY` / `503 REDEMPTION_DISABLED` |
| `GET /redemptions/:id` | ídem | Solo del propio usuario: estado de la saga y, si se entregó, la referencia visible (código de cupón solo al titular) |

### 5.3 Administración (G3)

| Método y ruta | Autorización | Contrato |
|---|---|---|
| `POST /admin/adjustments` | Sesión de `administrador` (vía de autorización de administración existente) | `{ userId, amount (≠0, entero, con un tope por operación CONFIGURABLE), reasonCode (enumerado), relatedMovementId?, note? }` + `Idempotency-Key`. **Crea un movimiento `adjustment`**; nunca fija un saldo. El snapshot no puede quedar negativo por un ajuste. `note` es texto breve para auditoría interna, no visible para el menor y sin PII |
| `GET /admin/users/:userId/ledger` | `administrador` | Lectura de soporte; queda registrada en la auditoría |
| `POST /admin/reconcile` | `administrador` | Ejecuta el reconciliador de sagas (ADR §6); es idempotente |

**No existe ningún endpoint de mediador** que conceda XP o PM (D36). Las vistas de docente y coordinador (agregados, D37) se definen en G7.

## 6. Ganchos y comportamiento ante fallos

```js
// Patrón del gancho (aditivo, una línea en server.js tras el éxito de la operación original)
void gamification.onMookReviewed(ev, req).catch(e => log(`[gamification] ${e.code || e.message}`, 'WARN'));
```

- El gancho se invoca **después** de que la operación original confirmó y, en rutas HTTP, **después de construir la respuesta** (`res.json(...)` ya ejecutado). Su latencia y sus errores no afectan a la respuesta.
- Con `GAMIFICATION_ENABLED` en OFF, el gancho retorna antes de abrir la base (coste: leer una variable de entorno).
- Si la base no abre o está corrupta: se registra un log `WARN` y se desactiva la apertura durante un intervalo de reintento. La lectura, el progreso y MOOK siguen igual.
- **Hechos perdidos** (proceso caído entre la respuesta y el gancho, o `SQLITE_BUSY`): se recuperan con un **reprocesado idempotente** desde las fuentes (`mook_db.json` en estado `REVIEWED` y `progress.db` con `isCompleted`), gracias a I1. Lo lanza el administrador o se ejecuta al activar el flag.

| Falla | Lectura, progreso, MOOK y biblioteca | Gamificación |
|---|---|---|
| Motor o base caídos | **Sin cambios** | `GET /me` responde `503`; la UI muestra «no disponible» |
| WooCommerce caído | Sin cambios | Canje de cupón en `RELEASED`, PM intactos |
| `events.db` no disponible | Sin cambios | El validador devuelve `insufficient_data` (no emite) |
| Flag de emisión en OFF | Sin cambios | Hechos registrados como `disabled_source` (auditables, sin emisión ni efecto retroactivo, D48) |

## 7. Seguridad y RBAC

| Tema | Contrato |
|---|---|
| Identidad | Sesión firmada (`requireUserAuth`). El `userId` de la ruta solo se acepta en `/admin/*` |
| Colegios y alcance | Los mediadores no tienen endpoints de emisión. Las vistas agregadas de G7 usan `resolveScope` / `authorizeScope` (`server/identity/cis.mjs:230,259`), con el mismo modelo que Aula Viva |
| Menores | Perfil privado; sin rankings; sin datos de terceros en ninguna respuesta; el código de cupón solo lo ve su titular; logs sin PII (`server/lib/logPrivacy.js`) |
| Comercio de menores | `403 ADULT_AUTHORIZATION_REQUIRED` mientras no exista un vínculo verificable entre adulto y menor (D35, GATED). **Hallazgo vigente:** `mediatorKind='parent'` no está vinculado a ningún alumno, así que **no sirve** como autorización |
| Validación de evidencia | Solo los hechos de §2. Autorrevisión rechazada; usuarios sintéticos excluidos |
| Límites | Tope diario por fuente, tope diario global, tope semanal y bolsa mensual (D13 y D46). Se evalúan **dentro** de la transacción. Si se excede, se emite parcial hasta el tope y se registra la decisión `capped` |
| Montos | Ningún endpoint de lector acepta montos. El precio sale del catálogo del servidor |
| Idempotencia | Hechos: `(source, sourceEventId, factType)`. Canjes: `(userId, Idempotency-Key)`. Ajustes: `(actorId, Idempotency-Key)` |
| Concurrencia | `BEGIN IMMEDIATE` en toda escritura (ADR §4) |
| Abuso de tasa | Límite de solicitudes por usuario en `POST /redemptions` (CONFIGURABLE) |

## 8. Flags

| Flag | Por defecto | Efecto |
|---|---|---|
| `GAMIFICATION_ENABLED` | OFF | Padre: sin base, endpoints `404` y ganchos inertes |
| `PM_EARNING_ENABLED` | OFF | Sin él, los hechos quedan como `disabled_source` (el XP también, hasta que se apruebe una emisión de XP independiente) |
| `READING_VALIDATOR_MODE` | `observe` | `observe` \| `enforce`; `enforce` requiere la aprobación de G4 |
| `PM_REDEMPTION_ENABLED` | OFF | Sin canjes ni reconciliador |
| `COMMERCIAL_REWARDS_ENABLED` | OFF | Sin recompensas con coste comercial |
| `WOO_COUPONS_ENABLED` | OFF | Sin llamadas a `wc/v3` |
| `SCHOOL_MISSIONS_ENABLED` | OFF | Sin capa institucional |

Se leen **por llamada**, igual que `econIngestMode()`. La jerarquía es estricta: un flag hijo en ON con el padre en OFF equivale a OFF.

## 9. Invariantes verificables y pruebas para G3

| # | Invariante | Prueba en G3 |
|---|---|---|
| E1 | El mismo hecho 100 veces produce 1 hecho y 1 movimiento | `idempotency.test.mjs` |
| E2 | Ningún endpoint de lector acepta montos; un `amount` en el body se ignora | `sourceAuthority.test.mjs` (servidor efímero, sesiones de lector, mediador y administrador) |
| E3 | Con el motor que lanza error o la base corrupta, `/complete` y la revisión MOOK responden igual (estado, cuerpo y escritura) que sin motor | `readingIsolation.test.mjs`, `mookIsolation.test.mjs` |
| E4 | `/complete` en modo `observe` produce `decision='observed'` y 0 XP y 0 PM | `readingValidatorObserve.test.mjs` |
| E5 | Autorrevisión → `rejected_self_review`; `con_comentarios` → `observed` (hasta que se decida); usuario sintético → `rejected_excluded_user` | `mookEligibility.test.mjs` |
| E6 | Un texto de Leo con `[AWARD_POINTS:n]` (y variantes) no genera ningún hecho; no existe una fuente `leo` | `leoNoAward.test.mjs` (reutiliza los casos de G0) |
| E7 | `server/gamification/**` no importa `server/royalties/**` ni lee `econ_events` | `royaltyIsolation.test.mjs` (estructural) |
| E8 | Flags en OFF: endpoints `404`, ganchos inertes y sin archivo; un hijo en ON con el padre en OFF equivale a OFF | `flags.test.mjs` |
| E9 | RBAC: el lector solo ve lo suyo; el mediador no tiene emisión; el ajuste es solo para el administrador y necesita motivo | `rbac.test.mjs` |
| E10 | Los topes se respetan con concurrencia entre dos réplicas | `capsConcurrency.test.mjs` |
| E11 | Reprocesar desde las fuentes después de una pérdida no duplica | `replayIdempotency.test.mjs` |
| E12 | Ninguna respuesta incluye datos de otro usuario ni PII en los logs | `privacyResponses.test.mjs` |
