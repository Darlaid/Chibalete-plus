# CHP V9 · Bloque III · F5-DP — Privacidad administrativa y visibilidad institucional

Estado: implementado y probado en laboratorio. **Sin desplegar.** Solo APP. Cierra las observaciones O1, O2 y O3 de `CHP_V9_BIII_F5D_INSTITUTIONAL_ACCESS.md`.

## A. Administración y lectura personal

**Lectura personal** es (1) toda la lectura de una cuenta personal (compra B2C, sin institución; adulta o de un menor representado) y (2) la lectura que un lector de colegio hace de una obra que tiene solo por una compra propia.

| Qué | Antes | Ahora |
|---|---|---|
| Gestión de cuentas (lista de usuarios, desactivar, reinvitar, representación) | Sí | Sí |
| Gestión de suscripciones (qué acceso tiene una cuenta: `GET /api/access/by-user/:id`) | Sí | Sí |
| Operaciones institucionales (grupos, nóminas, traslados, métricas globales) | Sí | Sí |
| Seguimiento individual de un lector de colegio, obras del colegio | Sí | Sí |
| Seguimiento individual de una cuenta personal (progreso, obras, Leo, notas, producciones, indicadores) | Sí | **No** (403) |
| Lectura de la obra comprada por un lector de colegio | Sí | **No**: la obra no aparece; pedida por su nombre, 403 `personal_reading_withheld` |

- Rige igual para el rol administrador con sesión y para la autoridad de máquina.
- No existe un mecanismo de soporte individual con finalidad y constancia de cada consulta. Mientras no exista, ese acceso se niega; no se creó ninguno.
- El titular conserva todo lo suyo, incluida la exportación de sus producciones.
- Dónde se decide: la política de administración del servicio de identidad (`platform_admin_full_institutional_read`) es de lectura **institucional** y ya no alcanza el ámbito `user` de una cuenta personal; `personalReadingBoundary` en `server.js` para las cuatro rutas de progreso, las notas de seguimiento, la exportación y Leo.
- Los registros del servidor no contienen la lectura consultada.

Límite conocido (cerrado en F5-DP2, ver `CHP_V9_BIII_F5DP2_DERIVED_PRIVACY.md`): los indicadores derivados globales de un lector de **colegio** (estado, línea de tiempo, perfil) incluían, mezclada y sin identificarla, su lectura personal.

## B. Qué recibe un lector

| Lista | Antes | Ahora |
|---|---|---|
| `GET /api/users` | Perfil público de todos los lectores de su institución | Su cuenta, las personas con quienes comparte un grupo (curso o club) y quienes median esos grupos |
| `GET /api/groups` | Todos los grupos de su institución, con sus nóminas | Sus grupos completos; de su institución, solo los clubes abiertos, sin participantes (`memberCount`, `membersWithheld`) |
| Otros cursos | Listados, con nómina | No se listan |
| Otra institución, cuentas personales | Aisladas | Aisladas |

Al unirse a un club abierto recibe a sus participantes; al salir deja de recibirlos de inmediato. Mediadores y administración no cambian.

## C. Política de caché

Toda respuesta de `/api` sale con `Cache-Control: private, no-store`, incluidas las negativas (401, 403, 404). Excepciones deliberadas:

- `GET /api/content` y `GET /api/sections`: catálogo editorial, conservan su política (revalidación por ETag).
- Una ruta que declara la suya la conserva (por ejemplo, el audio de síntesis: `public, max-age`).
- `/uploads` (recursos editoriales) y el modo sin conexión no pasan por `/api`: el service worker nunca guarda `/api`.

El edge no cachea `/api`. Con `no-store`, ni el navegador ni un intermediario pueden reutilizar una respuesta entre personas.

## Pruebas

`server/__test__/privacyScopeHttp.test.mjs` — servidor real, dos réplicas, sesiones reales; en `test:v81` (CI). Nueve suites existentes que afirmaban el contrato anterior se actualizaron, cada una con su comentario.

## Pendiente de decisión

- **Soporte individual autorizado.** Si Dirección quiere que soporte pueda consultar la lectura de una cuenta personal a petición de su titular, hace falta definir: quién lo autoriza, con qué finalidad, por cuánto tiempo y dónde queda la constancia de cada consulta. Hasta entonces, negado.
- ~~Indicadores derivados mezclados~~ de lectores de colegio con compras propias: resuelto en F5-DP2.
