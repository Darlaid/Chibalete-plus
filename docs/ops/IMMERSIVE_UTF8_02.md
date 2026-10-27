# PROD / IMMERSIVE-UTF8-02 · Regeneración de la voz de «Las ciudades que llevamos dentro»

**Fecha:** 2026-10-27 (UTC) · **HEAD:** `7ede61f` · **Obra:** `content-1779292030328` · **Diagnóstico:** `IMMERSIVE_UTF8_01.md`
**Autorización:** reparar solo esta obra con el flujo TTS existente, sin reintentos adicionales si falla.

**Veredicto:** **YELLOW.** La regeneración **no se completó** porque **los dos proveedores de TTS no tienen cuota**:
- OpenAI: sin créditos;
- Gemini: cuota excedida tras 1 bloque.

**No se declara éxito: el lector Inmersivo sigue mostrando «�»**. Todo lo anterior quedó **conservado e intacto** y el estado colgado «generando» se corrigió a uno real.

## A. Estado inicial y respaldo

- **Servicios:** api_1/api_2/front `regalias-c8f491e`, healthy, 0 reinicios. Las réplicas arrancaron a las 22:49–22:50Z sin ningún job TTS de esta obra, así que el «generando» del 2026-05-29 era un estado muerto.
- **Sesión:** administración autenticada en Chrome mediante el flujo normal (`/api/auth/me` → `administrador`).
- **Ensayo en laboratorio** (contenedor sin red, imagen de producción, TTS en modo mock, copia del TXT): 45 bloques y 852 oraciones, **0 × U+FFFD**, manifest publicado (pasa `validateManifestCandidate`). Primera oración: «Las ciudades que llevamos dentro Antología poética Constantino Cavafis Prólogo I.»
- **Respaldo** en `/root/chp-utf8-02/backup/`:
  - tar de la carpeta de audio (manifest + 46 mp3, 230 MB, sha256 `6358138120e428eb…`);
  - `audio-files.sha256` con las 47 huellas por archivo;
  - `content-record.json` (estado TTS previo);
  - `txt.sha256`.
  - **Restauración de prueba en un directorio temporal: idéntica al original** (47/47).

## B. Cambio puntual del estado TTS

- Script de uso único `unblock_tts.mjs`, dentro de `withFileLock(content.json,'contentLock')`, el mismo lock que las réplicas:
  - comprueba que `content.json` mantiene el formato de `writeJSON`;
  - cambia solo `content-1779292030328.ttsStatus` de `generando` a `pendiente`, y solo si `processingStatus.lastUpdated` seguía siendo el del job muerto;
  - el mismo script verifica que los otros 108 registros y los demás campos de este quedan idénticos.
- **Ejecución:** dry-run y luego apply a las 23:22:22Z. 1 registro modificado; `content.json` pasó de `9faaf685…` a `9a3eb1fe…`.
- Espera de más de 30 s por la caché de las réplicas.

## C. Solicitud de regeneración

- **Una sola** llamada a `POST /api/content/content-1779292030328/retry` desde la sesión de administración (23:23:12Z) → **200** `success: true`. No se repitió.
- Job en api_1: «Total chunks: 45».

## D. Bloques y proveedor

| Bloque | Proveedor | Resultado |
|---|---|---|
| 1/45 | OpenAI `tts-1` (primario) | **429 «You have no credits remaining»** ⇒ breaker de OpenAI abierto 5 min |
| 1/45 | **Gemini** `gemini-2.5-flash-preview-tts` (respaldo) | **Generado** (23:24:09Z) ⇒ `chunk_cb85cc616172d7e12730780c26b8bb11_gemini_…mp3` |
| 2/45 | Gemini | **429 «You exceeded your current quota»** (2 intentos) ⇒ «All providers failed» ⇒ **circuit breaker del job**, abortado (23:24:10Z) |

- Registro del job: `Created: 1, Skipped: 0, Errors: 1`; `[TTS_MANIFEST_NOT_PUBLISHED] reason=entries 1/45 previous_manifest_kept=true`; `[RETRY_FAIL] reason=provider_abort`.
- **Consumo:** 1 síntesis de Gemini (~1 400 caracteres). OpenAI no facturó nada (rechazo por créditos).

## E. Integridad del manifest y los audios

- **No se publicó ningún manifest nuevo** (contrato `MANIFEST_PUBLISH_CONTRACT`), así que no hay mezcla de sincronización vieja y nueva.
- **Los 47 archivos previos (manifest + 46 mp3) son byte a byte idénticos al respaldo.**
- Se añadió 1 mp3 nuevo (bloque 1 del texto UTF-8 correcto). **Se conserva**: el próximo intento lo reutilizará por identidad sin volver a sintetizarlo.
- El manifest vigente es el mismo híbrido diagnosticado en UTF8-01: Inmersivo sigue mostrando «Antolog�a po�tica».

## F. Comprobación visual y auditiva

**No aplica:** sin manifest nuevo no hay nada que validar. Los modos siguen exactamente como antes, porque no cambió ningún archivo que lean:
- Inmersivo con «�»;
- Guiado con el texto correcto y el audio viejo;
- Accesible correcto.

No se afirma ninguna corrección.

## G. Datos antes y después

- **`content.json`** frente a la restauración POST de DEPLOY-01: 109 = 109 registros, mismo orden; **0 registros ajenos cambiados**. En esta obra solo cambiaron `ttsStatus` y `processingStatus`.
- **Estado final de la obra:** `ttsStatus: "error_proveedor"`, `processingStatus.status: "error_proveedor"` (2 %, bloque 1/45, error del proveedor). **Ya no está colgada en «generando»** y el estado refleja el resultado real.
- TXT idéntico (`sha256sum -c` OK).
- `royalties.db` y `events.db` idénticos.
- **Padrón:** 0 altas y 0 bajas; solo `lastLoginAt` de 3 cuentas (administración, mediación y lectura: las sesiones abiertas por la titular hoy).
- Derechos, progreso y otros libros sin tocar. api_1 y api_2 healthy, 0 reinicios.

## H. Riesgos y archivos conservados

- **Bloqueo externo:** sin cuota en OpenAI ni en Gemini no se puede regenerar el TTS de ninguna obra, y el TTS bajo demanda solo funciona con lo que ya está en caché. Afecta a cualquier generación nueva, no solo a esta.
- **Conservado en el VPS:**
  - carpeta de audio original intacta + 1 mp3 nuevo;
  - respaldo y huellas en `/root/chp-utf8-02/backup/`;
  - scripts `unblock_tts.mjs` y `lab_mock.mjs`;
  - ensayo en `/root/chp-utf8-02/lab/` (416 KB);
  - huella `snapshot-post.json`.
  - No se borró nada.
- **Para completar la reparación**, cuando haya cuota (recargar créditos de OpenAI o ampliar la cuota de Gemini):
  - repetir **solo** el `POST …/retry` desde una sesión de administración (el estado ya no lo bloquea, porque `error_proveedor` ≠ `generando`);
  - después, validar como pide la unidad: «Antología poética» y «Prólogo I.», 0 × U+FFFD, correspondencia entre texto, oraciones y audio, y reproducción en Inmersivo, Guiado y Accesible.
  - Coste esperado: 44 bloques (el 1 ya existe).
- La prevención de futuras subidas de TXT mal codificadas queda para una unidad independiente, como indicó Dirección.

## I. Veredicto

**YELLOW.** Reparación **no completada** por falta de cuota en los dos proveedores, sin ningún daño: versión anterior íntegra, ningún manifest mezclado, ninguna otra obra tocada. Además, el estado «generando» colgado desde mayo quedó corregido a `error_proveedor`.
