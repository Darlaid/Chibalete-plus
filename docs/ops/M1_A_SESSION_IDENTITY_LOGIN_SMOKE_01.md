# CHP-IDDB-M1-A-SESSION-IDENTITY-LOGIN-SMOKE-01 — Login real productivo (cierre de deuda)

**Veredicto:** `GREEN — REAL PRODUCTION LOGIN COOKIE ISSUANCE VERIFIED`

```
PRODUCTION_LOGIN_ENDPOINT_WITH_REAL_CREDENTIAL_TESTED=true
PRODUCTION_LOGIN_COOKIE_ISSUANCE_GREEN=true
LOGIN_PRODUCTION_SMOKE_PENDING=false
M1_A_DEPLOY_C_GATE_OPEN=true
```

- Fecha: 2026-08-16 (~17:31–17:40Z). Sin deploy, sin cambio de config/flags/imagen, sin recreate.

## 1. Baseline

api_1 y api_2 en `0ff76b6` **COMPAT**/json, healthy, restarts=0; clave de firma 0400; `sessions.db` compartida (3 filas, integrity ok); frontend `hf4a-r2-coherence-82fba6e` (`9141cfb4`). `M1_A_DEPLOY_B2_GREEN=true`, `CROSS_INSTANCE_SESSION_GREEN=true`.

## 2. Credencial

Cuenta activa `user-1781223323090`, credencial provista por el operador vía `/root/login-smoke.env` (opaca). **Salvaguarda:** verificación offline con **un único bcrypt** contra el padrón → `MATCH` **antes** de tocar el endpoint (0 intentos de login consumidos en la comprobación). Sin adivinar, sin múltiples intentos, sin reset, sin crear usuario, sin cambio de `credentialVersion`.

## 3. Login real (FASE 3)

Un login por la ruta HTTPS productiva (edge):

| Campo | Resultado |
|---|---|
| `login_status` | **200** |
| Set-Cookie presente | ✓ |
| HttpOnly / Secure / SameSite=Strict / Path=/ | ✓ / ✓ / ✓ / ✓ |
| token en el body | no |
| subject del body | **MATCH** (`user-1781223323090`) |

(token/cookie nunca impresos ni guardados.)

## 4. Cookie-only (FASE 4)

- `GET /api/auth/me` cookie-only (sin x-user-id) → **200**, id == subject.
- ruta normal cookie-only (`GET /api/groups`) → **200**.

Esta es la evidencia de emisión de cookie por el endpoint de login que Deploy C necesitaba.

## 5. Logout y revocación (FASE 5)

`POST /api/auth/logout` → **200**, cookie limpiada; misma cookie → `/api/auth/me` → **401 revoked**. La fila del smoke (`user-1781223323090`) queda **revocada**.

Invariantes canónicos de la cuenta: `credentialVersion` 0→0, hash bcrypt `8d075d985a78dd10…` **byte-idéntico**, status active. `lastLoginAt` se actualizó — efecto **esperado e inherente** de un login real (no es campo de autoridad de identidad). `CANONICAL_IDENTITY_AUTHORITY_MUTATIONS=0`. Padrón 647=247+400, memberships 227.

## sessions.db y journal (contexto)

`sessions.db` 3→**5 filas (4 revocadas)**: la fila del smoke (revocada) + **una fila viva de `user-1774362611303`**, que es un **usuario real distinto** con login natural concurrente (el edge registra 2 logins 200 en la ventana; en COMPAT cada login mintea cookie aunque el frontend legacy la ignore). No proviene del smoke. Journal `APPLIED 100246→100740 (+494)` = resync de `lastLoginAt` de 2 logins (~247 c/u); `PENDING=0 FAILED=0`. Ninguna mutación de autoridad canónica.

## 6. Salud (FASE 6)

Ambas healthy, restarts=0, `unexpected_5xx=0` (APIs y edge), errores de sesión=0, sin restart loops. `FRONTEND_RUNTIME_DELTA=0`.

## 7. Higiene

No se guardaron contraseña, cookie, token ni sid. `/root/login-smoke.env` eliminado (`shred`+`rm`) → ausente.

## Siguiente paso (NO ejecutar automáticamente)

Deuda de login **cerrada**. `M1_A_DEPLOY_C_GATE_OPEN=true`. Siguiente unidad: `CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-C` — frontend cookie-only (`PRODUCT_BROWSER_X_USER_ID_EMITTERS=0`) con ambas APIs en COMPAT, e inicio de la medición del drenaje de tráfico legacy del navegador.
