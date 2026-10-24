# SEC-ACCOUNT-01 — Cambio de contraseña propia · Preflight y GO técnico

**Fecha:** 2026-10-24 · **Código:** `91634d2` (`a15d9a1` funcionalidad, `eadb56c` dependencias, `91634d2` base del front) · **Estado:** GO técnico, **sin desplegar** (requiere autorización expresa de Dirección)

## A. Baseline

- Producción: `api_1`/`api_2` `chibalete/api:secusers-a-2ec37f7` (`f2a3e5118108`), front `chibalete/front:secusers-a-2ec37f7` (`055537dbbdd1`), `SESSION_AUTH_MODE=enforce`, override `6557ba3f…`.
- Antes de esta unidad solo un administrador podía fijar una contraseña (`PUT /api/users/:id`), y la interfaz no ofrecía el cambio de la propia contraseña a ningún rol.

## B. Endpoint `POST /api/auth/change-password`

- Identidad **solo** por sesión firmada verificada (`authMethod === 'session'` con `sessionId`); en `enforce` un `x-user-id` sin cookie da 401 y uno divergente de la sesión también. Un `id`/`userId`/`email` en el cuerpo se ignora.
- Exige `currentPassword`, `newPassword` y `confirmPassword`. Orden: confirmación → mínimo 12 → máximo 72 bytes (límite de bcrypt) → política existente (`checkNewPassword`: predeterminadas, formato hash, igual al email) → contraseña actual (bcrypt) → reutilización.
- Hash generado en el servidor (`hashNewPassword`, bcrypt coste 10). Bajo el lock del padrón se confirma que hash y `credentialVersion` no cambiaron mientras se hasheaba (si no, 409 `concurrent_change`); después, `credentialVersion++`, se anula un reset pendiente y se revocan **todas** las sesiones (incluida la actual). Se borra la cookie.
- Respuesta `{ success, reauthRequired }`, `no-store`, sin credenciales, hashes ni tokens. Auditoría `change_own_password` (actor = titular, sin detalles); log solo con el id.
- Tope de intentos: por IP (20 / 15 min en producción) y por cuenta, contando solo contraseñas actuales incorrectas (5 / 15 min por réplica).
- La cuenta principal protegida puede usarlo: es su propia credencial. Las demás protecciones no cambian.

## C. Interfaz

Perfil → pestaña **Seguridad**, solo en el perfil propio y para todos los roles. Tres campos con mostrar/ocultar accesible (`aria-pressed`), validación de cortesía (mínimo 12, confirmación, reutilización), errores con `role="alert"`. Tras el éxito muestra la confirmación y cierra la sesión local (`logout`) para volver a entrar con la nueva contraseña. Sin almacenamiento local ni registros de los valores.

## D. Pruebas

| Suite | Resultado |
|---|---|
| `selfPasswordChange` (dos réplicas reales en `enforce` que comparten padrón, sesiones y clave) | 65/65 — roles administrador, mediador y lector; principal protegida; actual incorrecta, confirmación distinta, corta, predeterminada, formato hash, >72 bytes, igual al email, reutilización; nunca de terceros; revocación entre réplicas; `credentialVersion`; bcrypt del servidor; reset pendiente anulado; tope por cuenta; concurrencia (mismo usuario en dos réplicas → un solo 200; dos usuarios → ninguna escritura perdida); CSRF; sin secretos en respuestas, logs ni auditoría |
| `PerfilSecurityPassword.structural` | 16/16 |
| Regresión en `node:20-bookworm` (`content-rmw`, `credential-reset`, `auth-reset`, `session-browser`, `zod-exposure`, `identity`, `memberships`, `library`, `mook`, `b2c`, `royalties`, `store`, `evidence`, `lint:evidence`, `image-integrity`, `store-isolation`) | Igual al baseline `04f887f`: solo `test:library` (1 caso de `no-store`) y `test:store-isolation` fallan, idénticos en el baseline |
| Sandbox local de producción (imágenes candidatas, `NODE_ENV=production`, `enforce`, front como proxy) | Smoke API 18/18 con cuentas sintéticas; recorrido en navegador de Perfil → Seguridad (error visible, cambio, cierre de sesión, la anterior deja de valer) |
| CI | `identity-preflight` (incluye `test:self-password`), `content-rmw`, `osv-scanner`, `trivy`, `trivy-image` api/front, `image-integrity`, `gitleaks-head`, `evidence-hardening` en verde; `gitleaks-history` rojo conocido (Lote F) |

## E. Dependencias y bases (cambios de la unidad)

- `eadb56c`: body-parser 2.3.0 → 2.4.0 (GHSA-27r3-jxmh-p828) y multer 2.4.0 → 2.5.0 (GHSA-q7qp-rjg7-q26m; nuestros `fileFilter` son síncronos, no alcanzable). Publicados el 2026-10-23; ponían OSV en rojo con el lockfile sin cambios. qs 6.16.0 → 6.16.1 transitivo.
- `91634d2`: front exige `brotli-libs >= 1.2.1-r0` (CVE-2026-111497, HIGH) sobre la base nginx pinneada.
- Las imágenes incluyen además las bases del Lote E (`b2f7065`), que no se habían desplegado: OpenSSL ≥ 3.5.8 en la API y nginx 1.30 en el front.

## F. Imágenes candidatas

| Imagen | ID | Tarball sha256 | Verificación |
|---|---|---|---|
| `chibalete/api:selfpw-91634d2` | `042eb8bf11a2` | `c75fdcc0…` | image-integrity 51/0; Trivy HIGH/CRITICAL 0; dentro de la imagen (local y VPS) `selfPasswordChange` 65/0 y `userCredentialReset` 83/0; body-parser 2.4.0, multer 2.5.0 |
| `chibalete/front:selfpw-91634d2` | `368267b53bbf` | `eaa1be26…` | Trivy 0; nginx 1.30.6; `nginx -t` correcto con los upstreams de compose; bundle con Perfil → Seguridad |

Cargadas en el VPS con `sha256sum -c` correcto e IDs iguales a los locales.

## G. Preflight productivo (solo lectura salvo etiquetas y copias)

- Salud: `api_1`/`api_2` ready 200 en `enforce`; front 200; edge healthy.
- Disco: 91 % (11 GB libres) antes de cargar; 92 % (9,5 GB) con las candidatas cargadas.
- Ensayo de restauración aislada del snapshot estructurado `04950bd7` (`structured-20261024T000016Z-4c2ef881`): padrón 658 (649 bcrypt), principal activa; `groups_db`/`access_db` con el mismo SHA-256 que en vivo; `identity.db` y `progress.db` `integrity_check ok`. Copia de ensayo eliminada.
- Rollback preparado: `chibalete/api:rollback-pre-selfpw` (`f2a3e511`), `chibalete/front:rollback-pre-selfpw` (`055537db`), copia del override y plan por componente en `/root/chp-selfpw/` (0700).

## H. Plan de despliegue (pendiente de autorización)

1. Respaldo estructurado JIT (`structured-backup.service`) + restauración aislada + copia consistente de `sessions.db`.
2. `api_1`: solo la línea 40 del override → `docker compose up -d --no-deps api_1`; healthy, ready 200, `enforce`; smoke dentro de la réplica con cuentas sintéticas `@smoke.chibaleteplus.invalid`; logs sin errores ni secretos.
3. `api_2`: línea 85, mismo gate en paso separado, más revocación cruzada entre réplicas.
4. Front: línea 130; recreate de `front` y reload del edge; bundle público con la pestaña.
5. Cierre: cuentas sintéticas desactivadas; datos reales iguales al PRE; respaldo POST.

No se modifica ninguna cuenta real durante el despliegue. El cambio de contraseña de la cuenta administrativa lo hace su titular después, desde Perfil → Seguridad.
