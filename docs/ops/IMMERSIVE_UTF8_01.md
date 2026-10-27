# PROD / IMMERSIVE-UTF8-01 · Diagnóstico de caracteres acentuados dañados en Inmersivo

**Fecha:** 2026-10-27 (UTC) · **HEAD:** `3a67077` · **Producción:** api y front `regalias-c8f491e` (healthy)
**Solo diagnóstico, en modo lectura:** no se tocó ningún archivo, dato ni configuración de producción.

## A. Obra y formato fuente

- **Obra:** «Las ciudades que llevamos dentro» (Constantino Cavafis), `content-1779292030328`, tipo `libro`, `disponible`.
- **Fuente única: TXT** (`texto_plano_url = /uploads/content-1779292030328/cavafis_traduccion-1780090995078-919014078.txt`). No tiene PDF ni EPUB.
- **TTS:**
  - `ttsStatus: "generando"` y `processingStatus.status: "processing"` (100 %), parado desde **2026-05-29T21:43Z**;
  - 46 mp3 de Gemini, todos del **2026-05-20** (15:49–16:24Z);
  - `manifest.json` reescrito el **2026-05-29**.

## B. Primera etapa donde aparece U+FFFD

| Etapa | Resultado |
|---|---|
| 1. Fuente editorial original | **No disponible:** el TXT original (cargado el 2026-05-20) fue reemplazado el 2026-05-29 y no se conserva en `/uploads` |
| 2–3. Texto importado y persistido (TXT actual) | **Correcto.** 67 227 bytes, UTF-8 válido, sin BOM, CRLF, **0 × U+FFFD**. «Antolog**ía**» = `c3 ad`, «Pr**ó**logo» = `c3 b3`, «po**é**tica» = `c3 a9` |
| 4. API y entrega | El servidor sirve el TXT de `/uploads` sin transformarlo (no hay ruta `latin1` ni `iconv`) |
| 5. Lector Inmersivo (`StartupEngine`) | Carga el TXT con `fetch` + `res.text()` (siempre UTF-8, `engines/StartupEngine.ts:163`), pero **pinta las oraciones del manifest TTS v2** (`chunk.sentences`, `StartupEngine.ts:180-191`) |
| **Manifest TTS** (`/uploads/audio/content-1779292030328/manifest.json`) | **Primera aparición de U+FFFD:** 1 269 × `EF BF BD`. En los chunks, `text` es **correcto** («Antología poética… Prólogo I.»), pero **`sentences` está dañado** en 576 de 861 oraciones («Antolog�a po�tica… Pr�logo I.») |
| 6. Pantalla | Muestra las oraciones del manifest ⇒ «Antolog�a po�tica», «Pr�logo I.» |

## C. Causa raíz (demostrada por evidencia; la fuente original ya no existe)

1. **2026-05-20:** se subió un TXT que **no era UTF-8** (Windows-1252 o Latin-1). El job TTS lo lee con `fs.readFileSync(path, 'utf8')` (`server/ttsService.js:155`), así que cada byte acentuado se convirtió en U+FFFD.
   - **Firma:** un U+FFFD por cada letra acentuada (í, ó, é, ñ…) y también donde el original tenía **raya y comillas tipográficas** («�una vida… aguda�», «un poco �entre�»).
   - En el TXT actual esos caracteres son `-` y `"`. Una raya o unas comillas en Windows-1252 son un solo byte (0x97, 0x93/0x94, 0xAB/0xBB), inválido en UTF-8.
   - Con ese texto dañado se generaron las **oraciones** y **el audio**: el hash de 35 de 46 chunks coincide con el md5 de las oraciones unidas (el texto viejo) y el de **0 de 46** con el `text` actual.
2. **2026-05-29:** se reemplazó el TXT por uno UTF-8 correcto. La regeneración del TTS **no terminó** (quedó en «generando»). Aun así, el manifest se reescribió como un **híbrido**:
   - `text` nuevo (38 de 46 chunks coinciden con el TXT actual);
   - `sentences`, `hash` y audio de la generación vieja;
   - 46 entradas frente a `_meta.totalChunks: 45`.
   - Lo hizo el código de entonces. El actual (IMM-TTS-01, `validateManifestCandidate`) rechazaría hoy este manifest por `sentences ≠ split(text)` y no lo publicaría.
3. El lector Inmersivo confía en el manifest v2 y muestra `sentences`.

**Hipótesis pendiente, no verificable:** el charset exacto del TXT del 05-20 (Windows-1252 o Latin-1), porque el archivo original ya no está. La firma (un U+FFFD por byte, rayas y comillas afectadas) es compatible con Windows-1252.

## D. Alcance

| Pregunta | Respuesta |
|---|---|
| ¿Exclusivo de esta obra? | **Sí.** Barrido limitado a esta firma: **1 de 63** manifests TTS tiene U+FFFD (esta obra); **0 de 61** TXT del catálogo son UTF-8 inválido o tienen U+FFFD |
| ¿Exclusivo del modo Inmersivo? | **El texto dañado, sí.** Inmersivo pinta `sentences` del manifest. **Modo Guiado** toma el texto del TXT (`pages/VisorTexto.tsx:267`), que está bien, pero reproduce el **audio viejo**, generado sobre el texto dañado. **Accesible** lee el TXT. No hay PDF ni EPUB |
| ¿Compartido con otras obras del mismo flujo? | Hoy no hay otra obra afectada. **El flujo sigue expuesto:** la subida de TXT solo valida extensión, MIME y bytes nulos; no rechaza ni convierte un texto que no sea UTF-8 |
| ¿Específico de Safari/iOS? | **No.** El U+FFFD está en los datos (`manifest.json`); cualquier navegador muestra lo mismo |

## E. Reparación mínima recomendada (no ejecutada; requiere autorización)

1. **Regenerar el TTS de esta obra** desde el TXT actual (UTF-8 correcto) con el flujo existente de reintento de TTS.
   - Con el código actual, el manifest nuevo solo se publica si pasa `validateManifestCandidate`, con oraciones derivadas del `text` y audio nuevo.
   - Coste: ~45 chunks de TTS (Gemini/OpenAI, sujeto a cuota).
   - Antes: copia del `manifest.json` actual como evidencia.
   - Esto también desbloquea el `ttsStatus` parado en «generando».
2. **Alternativa sin coste** (no recomendada): reconstruir solo `sentences` desde `text`. El audio seguiría siendo el del texto viejo y no coincidiría con lo que se ve.
3. **Prevención** (cambio de código aparte):
   - en la subida, rechazar un TXT que no sea UTF-8 válido con un error claro, o convertir Windows-1252 de forma explícita y registrada;
   - opcional: que `StartupEngine` ignore un manifest cuyas `sentences` no salgan de su `text`, y use el TXT como si no hubiera manifest.

## F. Riesgos

- **Otros libros:** hoy ninguno afectado (1/63 y 0/61). El riesgo es **futuro**: una subida de TXT en Windows-1252 se repetiría (TTS e Inmersivo con U+FFFD; también Guiado y Accesible si el TXT no se reemplaza).
- **Contenido existente:** la reparación propuesta solo toca `/uploads/audio/content-1779292030328/` (manifest y mp3 nuevos), no el TXT ni otras obras. Derechos, estadísticas y progreso no se tocan. Los mp3 viejos quedarían huérfanos; su limpieza va aparte y con autorización.
- La lectura y el progreso de los usuarios no cambian: el TXT ya es correcto.

## G. Veredicto

**Causa raíz identificada con evidencia de bytes.**
- La primera aparición de U+FFFD está en **`sentences` del manifest TTS**, generado el 2026-05-20 a partir de un TXT que no era UTF-8, con audio sobre el texto dañado.
- El reemplazo del 2026-05-29 corrigió el TXT pero dejó un manifest híbrido que Inmersivo sigue mostrando.
- Afecta solo a esta obra, sobre todo en Inmersivo (y al audio de Guiado). No depende del navegador.
- No se reparó nada.

**Evidencia en el VPS (solo lectura):** script de alcance `/root/chp-accprod01/utf8_scope.py`. Las demás comprobaciones se hicieron con comandos de lectura (bytes, hashes y fechas) y no dejaron archivos.
