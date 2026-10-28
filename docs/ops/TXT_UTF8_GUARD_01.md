# TXT-UTF8-GUARD-01 · Validación de codificación en archivos TXT

**Estado:** YELLOW (CI 9/10: `content-rmw` sin reproducirse en Linux; pendiente de re-ejecutar el job) · **Fecha:** 2026-10-27 · **Baseline:** `2d0a947` · **Antecedentes:** `IMMERSIVE_UTF8_01/02/03.md`
Sin migraciones, regeneraciones TTS, reimportaciones, limpiezas ni despliegue. No se tocó ningún archivo de libros ni ningún dato.

## A. Baseline

- HEAD = remoto = `2d0a947`, árbol limpio; CI 10/10 en el último commit de código (`a6fda3b`).
- **Causa que se cierra:**
  - un TXT en Windows-1252 entró por la subida (solo se miraban bytes nulos en los primeros 4 KB);
  - el job TTS lo leyó con `fs.readFileSync(…, 'utf8')`, que **sustituye en silencio** cada byte inválido por U+FFFD;
  - la sincronización salió con «�».

## B. Puntos de entrada protegidos

| Entrada | Uso | Antes | Ahora |
|---|---|---|---|
| `POST /api/upload` (`.txt`) | TXT de libros: alta y **sustitución** (se sube un archivo nuevo y después se guarda la ficha con su URL) | Bytes nulos en los primeros 4 KB | **Todo el archivo:** UTF-8 estricto, sin bytes nulos, no vacío |
| `POST /api/leo/ingest` (`.txt`) | Documentos de Leo | Igual que arriba | Igual que arriba |
| Job TTS (`generateAudioForContent`) | Lectura del TXT para la sincronización | `readFileSync(…, 'utf8')` (U+FFFD silencioso) | `readUtf8Strict`: si no es UTF-8, el job termina en `error_proveedor` sin sintetizar ni publicar |

- **No se aplica** a PDF, EPUB, imágenes, audio ni vídeo: siguen con su validación de categoría o EPUB, sin cambios.
- El TXT canónico que genera la importación EPUB (`canonical/book.txt`) lo escribe el servidor en UTF-8, así que no es una entrada externa.

## C. Validación implementada

**`server/lib/textEncoding.js`** (nuevo, sin dependencias):
- **`inspectTextFile(path)`:** lectura por bloques de 64 KB con `TextDecoder('utf-8', { fatal: true })` en modo stream.
  - Detecta secuencias inválidas, truncadas (también al final), sobrelargas y sustitutos.
  - Acepta un carácter multibyte partido entre dos bloques.
  - Códigos: `TXT_NOT_UTF8`, `TXT_EMPTY`, `TXT_BINARY` (bytes nulos; también UTF-16).
  - **No convierte ni reemplaza nada.**
- **`readUtf8Strict(path)`:** lanza `TXT_NOT_UTF8` en vez de devolver «�».
- **Mensaje para la administración** (415, `code: TXT_NOT_UTF8`): «El archivo de texto no está en UTF-8. Guárdalo con codificación «UTF-8» (en el Bloc de notas: Guardar como → Codificación: UTF-8) y vuelve a subirlo.» `TXT_EMPTY`: «El archivo de texto está vacío.»

**`server/server.js`:**
- `isTextFileSafe` delega en `inspectTextFile` y devuelve el detalle.
- En `/api/upload` y `/api/leo/ingest`, un `TXT_NOT_UTF8` o `TXT_EMPTY` responde 415 con el código y el mensaje, **antes de mover el archivo a uploads**: el temporal se borra, no hay deduplicación, ni ficha, ni TTS.
- El caso binario conserva el mensaje anterior.

**`server/ttsService.js`:**
1. Lectura estricta del TXT.
2. **Corrección de un defecto latente.** El `catch` del job referenciaba `chunks`, declarado con `let` dentro del `try`. Cualquier excepción previa a la división del texto (p. ej. «Text file not found») acababa en `ReferenceError: chunks is not defined`, `onProgress('error_proveedor')` no se llamaba y la obra **quedaba en «generando»**. Ahora informa `totalSentences: 0` y termina en `error_proveedor`.

**Sustitución rechazada:** el archivo nuevo se rechaza antes de persistirlo y la ficha no se guarda, así que el TXT vigente y su sincronización quedan intactos.

## D. Pruebas y CI

- **`server/__test__/txtUtf8Guard.test.mjs`: 26/0** (añadido a `test:content-rmw`, que corre en CI).
  - **Válidos:**
    - UTF-8 con tildes, ñ y diéresis;
    - raya, comillas, `…`, «»;
    - emoji y caracteres de 4 bytes;
    - BOM;
    - más de 64 KB con «í» partido en la frontera de bloque.
  - **Rechazados:**
    - Windows-1252;
    - Latin-1;
    - secuencias truncadas al final y en medio;
    - byte de continuación suelto;
    - sobrelarga;
    - sustituto;
    - más de 64 KB con un byte Windows-1252 al final;
    - vacío;
    - byte nulo;
    - UTF-16.
  - **`readUtf8Strict`:** nunca devuelve «�» (el contraste con `readFileSync(…,'utf8')` sí lo produce).
  - **TTS:**
    - un TXT en Windows-1252 da `success:false`, **0 llamadas al proveedor**, termina en `error_proveedor` y **el manifest anterior queda intacto byte a byte**;
    - un TXT ausente termina en `error_proveedor`;
    - un TXT UTF-8 válido publica un manifest sin «�», con tildes y raya.
  - **Contraprueba:** con el `ttsService.js` anterior, la misma prueba da **5 ✗**: el TXT en Windows-1252 se sintetizaba y publicaba, y el TXT ausente lanzaba `ReferenceError: chunks is not defined`.
- **`canonicalBookEpubIngestion.test.mjs`: 96/0** (servidor real):
  - UTF-8 con tildes, ñ, signos y emoji → 200;
  - Windows-1252 → 415 `TXT_NOT_UTF8` con mensaje;
  - truncado → 415;
  - vacío → 415 `TXT_EMPTY`;
  - **sustitución con Latin-1 → 415 y el TXT vigente de la obra queda byte a byte, sin archivos nuevos**;
  - ningún rechazo deja archivos;
  - TXT binario sigue rechazado;
  - **EPUB, imágenes y la importación TXT/EPUB sin regresión**.
- `test:content-rmw` completo rc = 0; `test:royalties` rc = 0; `typecheck:baseline` sin regresiones.
- **Libros existentes:** el barrido de IMMERSIVE-UTF8-01 encontró 0 de 61 TXT del catálogo con UTF-8 inválido, así que ninguno queda bloqueado por la nueva regla.
- **CI en `89d8015`: 9/10.** `content-rmw` falló en el paso «Gate — pérdida de escrituras entre réplicas» (= `npm run test:content-rmw`). Sin sesión de GitHub no se puede leer el log. Diagnóstico:
  - **reproducción exacta en Linux** (`git archive 89d8015`, Node 20, con las devDependencies de `npm ci`, sin red): **`test:content-rmw` completo rc = 0, 28 de 28 suites**, incluidas `txtUtf8Guard` 26/0 y `canonicalBookEpubIngestion` 96/0;
  - **precedente:** este mismo gate falló de forma intermitente en F1-A y en F2-B (el usuario lo re-ejecutó y salió verde sin cambios), y `identity-preflight` siguió el mismo patrón en U4;
  - pendiente: **re-ejecutar el job** (run `40607925033`, «Re-run failed jobs»), lo que requiere la sesión de Dirección.

## E. Riesgos residuales

1. **`POST /api/leo/ingest`** usa el mismo validador (revisado en el código), pero no tiene una prueba HTTP propia; la cubre la prueba unitaria del validador.
2. Un TXT vacío ahora se rechaza (antes se aceptaba). No hay ningún uso legítimo conocido.
3. **TXT ya existentes en disco:** la regla no los revisa al guardar una ficha (la URL apunta a un archivo ya subido). Si alguno no fuera UTF-8, el job TTS lo detendría sin «�» (`error_proveedor`). Hoy hay 0.
4. La subida desde la interfaz mostrará el `error` del servidor tal cual; el texto está pensado para la administración.
5. Requiere desplegar el API para tener efecto en producción (no se despliega en esta unidad).

## F. Commits

- `89d8015`: validador, protección TTS, pruebas e informe.
- Este commit: registro de CI.

## G. Veredicto

**YELLOW.** Implementado y validado en local y en Linux (suite completa en verde); CI 9/10 por `content-rmw`, sin reproducirse. Pasa a **GREEN_LOCAL+CI** si la re-ejecución sale en verde. Sin despliegue.
