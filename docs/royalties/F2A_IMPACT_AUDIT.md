# CHP-EDITORIAL-ROYALTIES-2026-01 — F2-A · Auditoría de impacto de permisos

**Fecha:** 2026-10-22 · **Base:** `0e97b32` (rama `chp/epub-mainfile-r1-release`, árbol limpio, igual a origin) · **Plan:** V1.1 §3.3.5, §7 (F2-A) · **Decisiones:** P1, P10, P15 (§1.1)

Auditoría hecha **antes** de escribir código. Producción de referencia: F1-A (`royalties-f1a-a3b704d`, evidencia `F1A_PROD_EVIDENCE.md`).

## 1. Estado de partida

- `royalties.db` en producción: `_migrations` = `0001_publishers`; tabla `publishers` con 1 fila (`pub-chibalete-editores`). No existe `rights_versions`.
- Catálogo: 109 registros, todos con `publisherId = pub-chibalete-editores` (responsabilidad editorial **administrativa**, no titularidad económica). Ninguno tiene régimen de derechos.
- Ningún punto del servidor consulta hoy derechos por obra.

## 2. Regla de compatibilidad (P15 §1.1)

- Solo las obras **con al menos una versión registrada** en `rights_versions` quedan bajo régimen. Para ellas, la versión efectiva en el instante evaluado decide cada capacidad; si no hay versión efectiva (aún no activada, vencida, suspendida, revocada o en disputa), **todas** sus capacidades quedan denegadas. Una licencia vencida no devuelve la obra al comportamiento libre.
- Las obras **sin versión** conservan su comportamiento actual y **no son económicamente elegibles**.
- Activación por `RIGHTS_ENFORCEMENT_MODE`: `off` (por defecto, cero cambios), `shadow` (evalúa y registra lo que denegaría, sin denegar) y `enforce`.
- Los administradores y la autoridad de máquina quedan exentos (gestión y QA). Lectores y mediadores, no: la lectura por mediadores también es explotación.
- **Impacto en producción al desplegar:** `rights_versions` nace vacía → 0 obras bajo régimen → 0 cambios para los 109 contenidos en cualquier modo.

## 3. Inventario de puntos de autorización

| Capacidad | Punto actual | Atribuible a una obra | Enforcement en F2-A |
|---|---|---|---|
| Lectura por suscripción | `decideContentAccess` (autoridad única de `GET /api/content/:id/access`, `GET /api/content/:id/epub`, `catalogForViewer` y `/uploads` estricto) | Sí (`contentId`) | Sí, un único punto dentro de `decideContentAccess` (tras la exención de admin y la existencia del contenido). Se propaga a /access, EPUB, localizadores del catálogo, assets de `/uploads` y `POST /api/offline/assignment`. |
| TTS: audio pregenerado | `/uploads/audio/<id>/` vía `decideUploadAssetAccess` (modo `strict`) | Sí (segmento de ruta) | Sí, en `strictUploadVerdict` |
| TTS: generación al guardar / reintentar | `ttsQueue.enqueue` en `POST /api/content` y `POST /api/content/:id/retry` | Sí | Sí: no se encola |
| TTS: álbum | `POST /api/album/tts` (`contentId` opcional) | Sí, cuando llega `contentId` | Sí, cuando llega `contentId` |
| **TTS: bajo demanda** | `POST /api/tts` (VisorTexto, Inmersivo, Inmersivo V2) | **No**: el cuerpo solo trae `text` | **Dependencia documentada (§5)** |
| Leo / IA | `POST /api/leo/ask`, `POST /api/leo/chat`, `GET`/`POST /api/leo/memory/:userId/:contentId`, `POST /api/leo/ingest` | Sí (`contentId`) | Sí |
| **Leo: recapitulación** | `POST /api/leo/recap` | **No**: solo `textoPagina` y `tituloLibro` | **Dependencia documentada (§5)** |
| Offline | `POST`/`GET /api/offline/assignment` (LU) | Sí | Sí: alta denegada; un assignment vigente de una obra sin permiso se responde como ausente |
| Indexación y búsqueda | No existe endpoint de búsqueda en el servidor; el filtrado del catálogo es del cliente; la indexación de IA va por `leo/ingest` (cubierta por Leo) | — | Permiso registrado; **sin superficie propia que denegar hoy** |
| Fragmentos promocionales | No existe superficie que publique fragmentos de obras (el banner de landing usa imágenes propias; la tienda es WooCommerce externo) | — | Permiso registrado; **sin superficie que denegar hoy** |
| Cubierta y metadatos | `GET /api/content` (catálogo), `GET /api/content/my-catalog`, portada pública en `/uploads` | Sí | Sí: la obra se omite del catálogo y de my-catalog para no administradores, y su portada deja de ser pública |

Fuera de alcance por P10: LU/Android, MOOK, podcast y vídeo no son liquidables en V1, pero sus permisos no se presumen: si una de esas obras tuviera versión de derechos, el enforcement anterior le aplicaría igual.

## 4. Comportamiento actual frente a requisitos nuevos

| Aspecto | Hoy | Con F2-A |
|---|---|---|
| Obras sin versión de derechos (los 109) | Acceso por roles, reglas y fallback | **Idéntico** |
| Obras con versión y permiso concedido | — | Acceso por las reglas actuales (los derechos no conceden acceso: solo pueden restringirlo) |
| Obras con versión y permiso denegado | — | 403 `RIGHTS_NOT_AUTHORIZED` por capacidad (en `enforce`) |
| Elegibilidad económica | No existe | Predicado puro; `publisherId` por sí solo **nunca** la concede |

## 5. Dependencias que impiden enforcement completo (STOP parcial)

1. **`POST /api/tts` (TTS bajo demanda).** El cliente envía solo el texto. Para denegar TTS por obra haría falta que el cliente enviara `contentId` **y** que el servidor verificara que el texto pertenece a esa obra; si no, omitir el id evitaría el control. Exigir `contentId` hoy rompería VisorTexto e Inmersivo. **No se interviene en F2-A**. Riesgo acotado: solo afecta a obras bajo régimen con lectura permitida y TTS denegado (hoy, ninguna). Cualquier obra con TTS denegado debe registrarse sabiendo que el TTS bajo demanda sigue disponible hasta cerrar esta dependencia, antes de activar `enforce` para ella.
2. **`POST /api/leo/recap`.** Misma situación (texto libre sin `contentId`). Mismo tratamiento.

Ambas quedan como requisito previo a cualquier activación de `enforce` sobre obras con TTS o IA denegados.

## 6. Implementación local (resultado)

**Modelo.** Migración `0002_rights_versions` en `royalties.db` (mismo almacén, mismo runner, mismo respaldo). Una fila por versión: `content_id`, `version_no`, editorial responsable (`publisher_id`), Acta (`act_ref`, `act_signed_on`), vigencia (`valid_from`/`valid_until`, día Bogotá), `effective_at`, `legal_status`, `economic_status`, `settlement_class` (`liquidable` | `auxiliary` | `excluded`), `alpha`, `expected_minutes` (P1), matriz `shares` (titulares en puntos básicos, 10000 = 100 %) y siete permisos `perm_*` NOT NULL **sin valor por defecto**. Triggers bloquean `UPDATE` y `DELETE`; `UNIQUE(content_id, version_no)`.

**Reglas de alta** (`server/royalties/rightsStore.mjs`): obra existente; editorial existente, activa e igual a la responsable de la obra; los siete permisos declarados como booleanos; matriz sin titulares repetidos, todos existentes y activos, suma exacta 10000 si no está vacía. `liquidable` exige además tipo `libro`/`libro_album` independiente (no MOOK ni hijos, P10), matriz, `alpha` en (0, 1], minutos esperados y lectura autorizada.

**Elegibilidad económica** (`economicEligibility`, puro): obra disponible y de tipo económico; versión efectiva, jurídicamente activa y vigente; `economic_status = active`; `settlement_class = liquidable`; lectura autorizada; `alpha` y minutos válidos; editorial activa y coincidente con la ficha; matriz del 100 % con titulares activos. Devuelve todos los motivos de exclusión. `publisherId` sin versión → `NO_RIGHTS_VERSION`.

**API de administración** (sin `PUT` ni `DELETE`): `GET /api/admin/rights/:contentId`, `GET /api/admin/rights/:contentId/eligibility?at=`, `POST /api/admin/rights/:contentId/versions` (auditada). Lectura solo con `requireAdminRead`.

**Pruebas** (`npm run test:royalties`):

| Suite | Resultado |
|---|---|
| `rightsStore` (migración, historial, validación, vigencia, permisos, elegibilidad, guardia, respaldo/restauración) | 77 ✓, 0 ✗ |
| `rightsHttp` (servidor real en `off`, `enforce`, `shadow` y `off` sobre el mismo fixture) | 50 ✓, 0 ✗ |
| `publishersStore` (ratchet de tablas actualizado a `rights_versions`) / `publishersHttp` | 32 ✓ / 36 ✓ |
| `economicEpisodes` (F3-A1, sin cambios) | verde |
| Backup `test_suite.py` (RY04 ahora aplica todas las migraciones reales y compara `rights_versions`) | `SUITE_RESULT=GREEN` |

**Regresión.** `test:content-rmw`, `test:b2c` y `test:library` sin cambios respecto a la base. Las suites POSIX (`uploadsAuthzStrict`, `catalogResourceLocators`, `catalogAccessLogNoise`, `catalogAccessPerformance`, `b2cProvisioning.integration`, `sessionIdentity`) se ejecutaron en Linux sobre la imagen `royalties-f1a-a3b704d` (= servidor de HEAD) sin y con el `server/` de F2-A, y también con `RIGHTS_ENFORCEMENT_MODE=enforce`: mismos resultados en los tres casos. `libraryInstitutionalPersonal` mantiene su fallo preexistente («`/api/content` general NO cambia su política no-store»), idéntico en la base.

**Compatibilidad con los 109 contenidos.** `rights_versions` nace vacía en producción: ninguna obra queda bajo régimen y ninguna respuesta cambia, en cualquier modo. Ningún dato de catálogo, acceso, progreso ni evento se modifica. Frontend sin cambios.

## 7. Riesgos antes de desplegar o activar

1. **Dependencias §5** (`/api/tts`, `/api/leo/recap`): impiden activar `enforce` sobre obras con TTS o IA denegados mientras la lectura esté permitida.
2. **Caché del edge para portadas públicas** (`max-age` largo, `immutable`): denegar la cubierta de una obra cuya portada ya se sirvió exige purgar o versionar esa portada.
3. **`/uploads` solo se controla en modo `strict`** (el de producción). En `legacy`, assets y audio no pasan por el guard.
4. **LU offline:** un libro ya descargado sigue en el dispositivo; el control aplica a nuevas asignaciones y descargas.
5. **Sin UI de derechos** hasta F5-A: el alta es por API de administración.
6. **`/api/leo/ingest`** usa admin-secret; su guardia se revisó en código, no en la prueba HTTP.
7. Despliegue: la migración `0002` se aplica al arrancar (idempotente, segura con dos réplicas); `RIGHTS_ENFORCEMENT_MODE` ausente = `off`. Cualquier paso a `shadow`/`enforce` requiere auditoría de impacto sobre las obras con versión y autorización explícita (P15).
