# CHP-CONTENT-PROTECTION-2026-01 — CP-4A2: política de originales para contenido licenciado

> **`SUPERSEDED_BY_GLOBAL_POLICY` (CP-4D, 2026-10-19).** La política por título `contentProtectionPolicy` / `licensed_strict` se retiró del runtime: todos los contenidos reciben la misma protección de solo lectura. Ver `docs/ops/CHP_CONTENT_PROTECTION_GLOBAL_POLICY.md`. Documento histórico.


Fecha: 2026-10-19 · Local, sin deploy · Rama `chp/epub-mainfile-r1-release` · Base `7d8bb72` (CP-4A + CP-4A1)

```
CP4A2_EXTERNAL_CONTENT_POLICY:      GREEN_LOCAL
CONTENT_PROTECTION_POLICY:          IMPLEMENTED
DEFAULT_POLICY:                     STANDARD
LICENSED_STRICT_PUBLISH_GATE:       GREEN
LICENSED_STRICT_PDF_ORIGINAL:       DENIED_SERVER_SIDE
LICENSED_STRICT_EPUB_ORIGINAL:      DENIED_SERVER_SIDE
LICENSED_STRICT_CANONICAL_READING:  PRESERVED
STANDARD_BEHAVIOR:                  UNCHANGED
WATERMARK_POLICY:                   PROHIBITED
ACCESSIBILITY_REGRESSION:           ZERO
CATALOG_PERFORMANCE:                GREEN
PRODUCTION_CHANGE:                  ZERO
```

Ningún título real se marcó como `licensed_strict`. No hay migración: los registros existentes no llevan el campo y son `standard`.

## 1. Campo

```
contentProtectionPolicy?: "standard" | "licensed_strict"
```

| Entrada | Escritura (`POST /api/content`, solo administración) | Lectura |
|---|---|---|
| ausente | en un update **se conserva el valor guardado**: un cliente que no conoce el campo nunca degrada un título estricto; en un alta queda sin campo (= standard) | standard |
| `null` / `""` | standard (cambio explícito) | standard |
| `"standard"` | standard | standard |
| `"licensed_strict"` | licensed_strict (sujeto al gate del §2) | estricto |
| cualquier otro valor | **400** `invalid_content_protection_policy`; no se persiste nada | estricto (fail-closed; solo posible fuera de la API) |

- **Quién lo modifica:** solo la administración.
  - `POST /api/content` ya está detrás de `requireAdminRole`.
  - En el formulario de SubirContenido es el control «Protección del contenido», con las opciones Estándar y Licencia estricta.
- **Escrituras posteriores** (TTS, adjuntar EPUB, reprocesar): mutan el registro en el sitio (`list[i].x = …` o `{...list[i]}`), así que el campo no se pierde.
- **Store y modelo:** sin store ni tabla nuevos; el campo vive en `content.json`.

## 2. Gate de publicación

Un título `licensed_strict` debe poder leerse **sin** entregar el original. Antes de guardar se exige al menos una de estas representaciones, que ya existían:

| Representación | Cuenta |
|---|---|
| `texto_plano_url` (TXT, o rendición canónica de un EPUB fuente) | sí → Guiado / Accesible / Inmersivo |
| `album_data` con imágenes | sí → Álbum |
| `url_recurso` que no es PDF (audio, vídeo, enlace externo) | sí |
| solo PDF original | **no → 422** |
| solo EPUB original (edición adjunta sin texto) | **no → 422** |

Respuesta: `422 licensed_strict_requires_reading`, con el mensaje «Licencia estricta requiere una forma de lectura en Chibalete+ que no entregue el PDF ni el EPUB original (texto, álbum, audio o vídeo).».
- El rechazo ocurre antes de escribir: no se modifica ningún fichero ni registro.
- `standard` no tiene ninguna restricción nueva.

## 3. PDF original

- **Qué es:** el `url_recurso` del propio registro cuando apunta a un `.pdf` bajo `/uploads/`.
  - Es la relación del catálogo que ya usaban el Detalle (`Ver PDF Original`) y el visor.
  - No es un patrón global: otro PDF del mismo título, como un anexo en `mediaAssets`, no es «el original» y no se bloquea.
- **Enforcement en el servidor:** `decideUploadAssetAccess`. Es el mismo autorizador del edge (`/api/internal/uploads-authz`) y del guard de `express.static`. En el bucle de dueños:
  - Un dueño `licensed_strict` **no concede** su PDF original.
  - Si otro dueño `standard` referencia el mismo fichero y el usuario tiene derecho a ese título, se entrega, porque el contrato de ese título lo permite.
  - Si ningún dueño concede: `FORBIDDEN LICENSED_STRICT_ORIGINAL` → **403**, también con `Range`.
- **Administración:** conserva el acceso para gestionar el título; es su privilegio existente, no un bypass nuevo. El lector nunca recibe el PDF.
- **Modo legacy** (`UPLOADS_AUTHZ_MODE` ≠ strict; producción usa strict):
  - El PDF original de un título estricto también responde 403, en el edge y en Node, para todos.
  - Es fail-closed: legacy no resuelve derechos por usuario.

| | lector con acceso | lector sin acceso | sin sesión | administración |
|---|---|---|---|---|
| STANDARD PDF | 200 / 206 | 403 | 401 | 200 |
| STRICT PDF | **403** | 403 | 401 | 200 |

## 4. EPUB original

- **Sin cambios:**
  - `/uploads/*.epub` sigue siendo 403 para todos.
  - Foliate, la ingestión y los ficheros guardados no se tocan.
- **`GET /api/content/:id/epub`:** después del veredicto de acceso, si el título es `licensed_strict` y quien lo pide no es administración → **403** con `original_not_licensed`.
- **Sin acceso:** responde el mismo 403 de siempre, sin código, así que no revela la política a quien no tiene derecho.

| | lector con acceso | lector sin acceso | administración |
|---|---|---|---|
| STANDARD | 200 | 403 | 200 |
| STRICT | **403** `original_not_licensed` | 403 | 200 |

## 5. Catálogo y front

- **Catálogo (`catalogForViewer`):** si hay acceso y el título es estricto, se omiten `url_recurso` (PDF) y `epub_url`. Se conservan:
  - el texto canónico
  - las ilustraciones
  - `album_data` y `mediaAssets`
  - la portada
  - el propio campo de política
- **Sin acceso:** el contrato R2 de CP-3 no cambia.
- **Administración:** recibe el registro íntegro, para editarlo.
- **La seguridad no depende de esto:** el servidor ya devuelve 403.
- **Detalle y `ReaderModeSelector`:** ofrecen los modos según la presencia de campos (mecanismo de CP-3). Sin pantallas, banners ni mensajes nuevos. En estricto:
  - Desaparecen «Ver PDF Original» y «Ver EPUB original».
  - Quedan «Leer Ahora», Inmersivo, Guiado, Accesible y Galería.
- **Acceso directo por URL:**
  - `/leer/pdf/<strict>` → el visor muestra su error genérico de carga y no recibe bytes.
  - `epub-reader.html?contentId=<strict>` → la pantalla «no disponible» que ya existía.
- **Sin cambios:** audio, vídeo, la fricción de CP-4A y el Modo Accesible (copia permitida).

## 6. Matriz de seguridad

| Política | Acceso al título | PDF original | EPUB original | Canónico / TXT | Álbum / visual |
|---|---|---|---|---|---|
| STANDARD | sí | ALLOW | ALLOW | ALLOW | ALLOW |
| STANDARD | no | DENY | DENY | DENY | DENY |
| STRICT | sí | **DENY** | **DENY** | ALLOW | ALLOW |
| STRICT | no | DENY | DENY | DENY | DENY |

## 7. Evidencia

- **`server/__test__/contentProtectionPolicy.test.mjs` (nuevo, en `test:content-rmw`): 99/0.**
  - Funciones puras.
  - Contrato del campo (A–G), RMW y gate (A–E).
  - Catálogo por actor.
  - `/uploads` estricto: Node, edge, Range, PDF compartido, anexo no original, TTS, Álbum, administración.
  - Endpoint EPUB.
  - Modo legacy.
  - Pureza del catálogo.
  - Estructural del front.
  - Corre en Windows (`SESSION_AUTH_MODE=off`). En la imagen API la sección [7] se declara SKIP porque no hay `pages/`.
- **Contenedor Linux (imagen de producción + `server/` actual montado), todos verdes:**
  - catalogAccessPerformance 20/0
  - catalogResourceLocators 33/0
  - catalogAccessLogNoise 48/0
  - uploadsAuthzStrict 157/0
  - authzListingScope 79/0
  - leoMemoryOwnership 72/0
  - sessionIdentity 42/0
  - sessionIdentityIntegration 34/0
  - sessionBrowserCookieOnly 13/0
  - epubOriginalEndpoint 32/0
  - epubProgressSync 39/0
  - adminEpubAttach 42/0
  - adminEpubUpload 13/0
  - uploadDedupCanonical 10/0
  - uploadDedupOwnership 34/0
  - progressReadIdentity 27/0
- **Navegador** (Chrome headless, API en `enforce` + `strict` con el `server/` actual, fixture sintético):
  - Detalle estricto sin PDF ni EPUB; el estándar los conserva.
  - Bytes: PDF estricto 403, PDF estándar 200, TXT estricto 200, EPUB estricto 403, EPUB estándar 200.
  - Guiado, Accesible e Inmersivo del título estricto con texto real. Accesible mantiene 3 enlaces de salto y `lang="es"`.
  - Sin marca de agua ni banners.
  - Formulario de administración: control con etiqueta, opciones y ayuda (`aria-describedby`).
  - Gate 422 e inválido 400 desde la sesión de administración.

## 8. Qué podemos prometer (títulos `licensed_strict`)

Chibalete+ permite la lectura al usuario autorizado **sin entregar el PDF ni el EPUB original**:
- El acceso a cada título lo decide el servidor.
- El PDF original se bloquea en el servidor (403), aunque el usuario tenga derecho a leer el título.
- El EPUB original se bloquea en el servidor (403), aunque el usuario tenga derecho a leer el título.
- La interfaz no ofrece esos modos.
- La lectura continúa por las representaciones de Chibalete+: texto, Álbum, audio y vídeo.

## 9. Qué no podemos prometer

- El texto que se muestra puede extraerse técnicamente; Guiado, Accesible e Inmersivo reciben el texto íntegro.
- No se pueden impedir capturas de pantalla en la web.
- El Modo Accesible permite copiar.
- Un usuario técnico puede recuperar imágenes, audio y vídeo autorizados.
- No hay DRM.
- No hay marca de agua.

## 10. Deudas

- **CP-4A2, no bloqueantes:**
  - Acceso directo a `/leer/pdf/<strict>`: el visor muestra su error genérico; no se añadió una pantalla nueva.
  - Si un título estricto comparte el fichero PDF con un título estándar, quien tenga derecho al estándar lo recibe. Es lo que dice el contrato de ese título.
  - En legacy, el bloqueo del PDF estricto es para todos, incluida la administración.
- **Preexistentes:**
  - `libraryInstitutionalPersonal` («/api/content NO cambia su no-store», desde CP-3).
  - `b2cProvisioning.integration` se declara SKIP fuera del sandbox.
  - 12 errores de `tsc`.
