# CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-B2 — Ambas APIs COMPAT + sesión cross-instance

**Veredicto:** `GREEN — M1-A B2 BOTH APIS COMPAT AND CROSS-INSTANCE SESSION AUTHORITY VERIFIED`

```
M1_A_DEPLOY_B2_GREEN=true
CROSS_INSTANCE_SESSION_TESTED=true
CROSS_INSTANCE_SESSION_GREEN=true
LOGIN_PRODUCTION_SMOKE_PENDING=true
PRODUCTION_LOGIN_ENDPOINT_WITH_REAL_CREDENTIAL_TESTED=false
```

- Fecha: 2026-08-16 (~16:45–16:50Z)

## Estado final

| Instancia | Imagen | SESSION_AUTH_MODE | IDENTITY_READ |
|---|---|---|---|
| api_1 | `0ff76b6` (`f2935d0f`) | **compat** | json |
| api_2 | `0ff76b6` (`f2935d0f`) | **compat** | json |

`sessions.db` compartida y healthy; frontend sin cambio; ref productiva `0ff76b6` sin avanzar.

## 1. Baseline

api_1 `0ff76b6` off/json/healthy/restarts=0; api_2 `0ff76b6` compat/json/healthy/restarts=0; ambas sin DOMAINS. Clave de firma 0400 root. `sessions.db` presente (WAL, integrity ok, 1 fila B1 revocada). Frontend `hf4a-r2-coherence-82fba6e`. `M1_A_DEPLOY_B1_GREEN=true`.

## 2. api_1 OFF→COMPAT (FASE 2)

`B2_CONFIG_DELTA`: solo la línea de `SESSION_AUTH_MODE` de api_1 (off→compat) en el override; imagen `0ff76b6` sin cambio. Recreate acotado de api_1 (drain→up→rejoin), StartedAt `2026-08-16T16:45:14Z`, restarts=0. **api_2 no tocada** (mismo StartedAt); frontend/edge sin restart.

## 3. Clave y store compartidos (FASE 3)

- Misma `session_signing_key` en ambos contenedores: SHA-256 `81a0361027ec…` **idéntico** (material nunca impreso).
- Misma `sessions.db`: device:inode `2049:578251` **idéntico** en api_1, api_2 y host → un único archivo vía bind mount.

## 4. Sesión cross-instance (FASE 4)

Emisión server-side (mismo mecanismo autorizado en B1: `createSessionAuth().issueSession` dentro del contenedor, sin cambio de código, token nunca impreso), validación HTTP entre instancias por DNS de contenedor (`chibalete_api_1/2:3000`):

| Dirección | `/auth/me` | id match | ruta normal (`/groups`) |
|---|---|---|---|
| sesión api_1 → validada en **api_2** | **200** | ✓ | **200** |
| sesión api_2 → validada en **api_1** | **200** | ✓ | **200** |

`api_1 → api_2 GREEN` y `api_2 → api_1 GREEN`.

## 5. Revocación cross-instance (FASE 5)

| Flujo | logout peer | store revocado | misma cookie en origen |
|---|---|---|---|
| mint@api_1 → logout@api_2 → reusar@api_1 | 200 | ✓ | **401 revoked** |
| mint@api_2 → logout@api_1 → reusar@api_2 | 200 | ✓ | **401 revoked** |

La revocación hecha en una instancia es visible al instante en la otra (store compartido). Solo se revocó el sid correspondiente — sin logout-all, sin `credentialVersion++`.

## 6. Seguridad COMPAT (FASE 6)

- cookie A + `x-user-id` B → **401** (`subject_mismatch`), probado una vez.
- legacy `x-user-id` sin cookie → **200** en ambas instancias (COMPAT temporal, ambas ahora en compat).
- sintético disabled → progress write **401**.

## 7. Invariantes de identidad (FASE 7)

`acceso001`: `credentialVersion` 0→0, hash bcrypt `1680aebeca6dbd20…` **byte-idéntico**, status active. Padrón 647=247+400 (400 disabled). memberships 227. Journal `APPLIED=100246 / NOOP=251 / PENDING=0 / FAILED=0`. `sessions.db`: 3 filas, **3 revocadas**, integrity ok. **`CANONICAL_IDENTITY_MUTATIONS=0`** — única mutación productiva: `sessions.db`.

## 8. Salud (FASE 8)

Ambas healthy, restarts=0, `unexpected_5xx=0` (APIs y edge), errores de firma/sessions-db=0, sin restart loops. `FRONTEND_RUNTIME_DELTA=0` (`hf4a-r2-coherence-82fba6e`, `9141cfb4…`).

## Telemetría

api_1: `legacy{browser}=2`, `subject_mismatch=0`, `revoked{logout}=1`. api_2: `legacy{browser}=9`, `subject_mismatch=2`, `revoked{logout}=2`. Revoked total = 3 logouts (B1 + 2 cross) = 3 filas revocadas; el mismatch de la RUN 1 se contó en api_2 (peer). Sin etiquetas de alta cardinalidad.

## 9. Deuda de login (sin resolver en B2)

`PRODUCTION_LOGIN_ENDPOINT_WITH_REAL_CREDENTIAL_TESTED=false`, `LOGIN_PRODUCTION_SMOKE_PENDING=true`. Bloquea el **cierre final** de M1-A, no B2. **0 intentos de contraseña** en esta unidad.

## Rollback

api_1 compat→off restaurando `override.pre-b2.yml` (misma imagen `0ff76b6`) + drain/recreate/rejoin de api_1. api_2 queda en estado B1-COMPAT known-good. No toca identidad. Copia en `/root/chp-m1-a-deploy-b2-01/override.pre-b2.yml`.

## Siguiente paso (NO ejecutar automáticamente)

`CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-C` — desplegar el frontend cookie-only (`PRODUCT_BROWSER_X_USER_ID_EMITTERS=0`) con **ambas APIs en COMPAT**, e iniciar la medición del drenaje de tráfico legacy del navegador. Sin ENFORCE, sin M1-B, sin M2.
