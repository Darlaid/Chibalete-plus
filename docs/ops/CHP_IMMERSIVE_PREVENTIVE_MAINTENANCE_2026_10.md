# CHP-MAINT-IMMERSIVE-2026-10 — Mantenimiento preventivo del Modo Inmersivo

Fecha: 2026-10-20 · Modo: auditoría READ-ONLY + dry-run · **Escrituras productivas: 0**

## Veredicto

`IMMERSIVE_PREVENTIVE_MAINTENANCE: STOP` en el gate de APPLY (§17), **sin escrituras**.

Hay 3 inconsistencias demostradas por hash. La reparación prevista por el contrato es re-ejecutar el job TTS existente (`POST /api/content/:id/retry`), y hoy no puede completarse:

- OpenAI TTS responde `429 You have no credits remaining`.
- El fallback Gemini es free tier, con un límite de 10 peticiones/día para `gemini-2.5-flash-tts`, y ya lo agota la lectura normal (log del 2026-10-19 19:33Z).
- Si el breaker salta, el job publica un manifest parcial (`ttsService.js`). Esto empeoraría Cavafis y además consumiría la cuota de la que depende el TTS on-demand de los 31 títulos sin audio por chunk.

## Baseline (verificada 2026-10-20 13:14Z)

| Ítem | Valor |
|---|---|
| Rama / HEAD | `chp/epub-mainfile-r1-release` / `cb8e19f` (= origin) |
| API | `chibalete/api:contentprotect-global-73f45d6` (`b5e6f59c60db`) en api_1 y api_2, healthy |
| Front | `chibalete/front:contentprotect-final-cbc8e2d` (`7265576a7feb`), healthy |
| Diferencia entre HEAD y el runtime | `73f45d6..cb8e19f`: en server/utils solo hay 1 test y `utils/epubAdmin.mjs` (copy admin de CP-4F en el front) más docs. Explicable. |
| LU publicada | 0.9.2 (`/uploads/chibalete-lu-0.9.2.apk`) |
| Flags | `SESSION_AUTH_MODE=enforce`, `UPLOADS_AUTHZ_MODE=strict`, `TTS_MODE=openai`, `ARCHIVE_ROTATION_ENABLED=1` (api_1) |
| Contenido | 109 títulos, 61 con `texto_plano_url` |
| Uploads | 5,7 GB / 3382 archivos; `audio/` 2,2 GB; `audio/immersive/` 362 MB / 1685 archivos |
| Disco | 94 G / 106 G (89 %) |

## Contrato actual (V1 productivo)

```
content.texto_plano_url (único criterio de disponibilidad de Inmersivo; ttsStatus no se lee en el front)
 → GET /api/content/:id/access (R6: StartupEngine.start() solo si allowed)
 → StartupEngine: manifest.json + anchors.json + TXT en paralelo
     · manifest v2 con entradas → el TEXTO MOSTRADO = sentences[] del manifest
     · manifest v1 con entradas → chunk.text
     · sin entradas → split del TXT crudo (fallback)
 → audio: mf[chunk].file (mp3 por chunk) || POST /api/tts (on-demand, caché audio/immersive/<hash>.wav|mp3)
 → progreso: POST /api/progress/:u/:c/sync {canonicalProgress.sentenceIndex, globalPercentage, lastInteractedMode:'immersive'}
```

- Canonical: el front de Inmersivo nunca lee `book.json`. Para EPUB, `texto_plano_url` = `canonical/book.txt`. Solo hay un título con canonical (`content-1765837262553`), y su `contentFingerprint` coincide con el TXT.
- Fingerprint: `contentFingerprint` (sha256 del texto normalizado) existe solo en 1 título. El manifest **no** guarda la huella del texto completo. La identidad del audio es por chunk: `md5(chunkText|es|alloy|provider|model)`, y está en el nombre del archivo.
- Por eso, la detección de stale de esta unidad recalcula `chunkText` y `generateHash` con el código del propio runtime (extraído de la imagen de prod) y compara cada entrada del manifest.
- LU no tiene Modo Inmersivo ni TTS. Usa `/api/offline/assignment` (TXT), `GET /api/progress/item` y `POST .../sync` (`globalPercentage`).

## Inventario (`docs/ops/tools/immersive_tts_inventory.mjs`, contenedor efímero `--network none`, mounts `:ro`)

| Clase | Títulos | Detalle |
|---|---|---|
| GREEN (TTS_SYNCED) | 27 | Todas las entradas coinciden en texto, hash e identidad de archivo; mp3 presente y > 0; sentences coherentes; `_meta` coherente. Son 25 MOOK más `content-1765837262553` y `content-1778608611968`. |
| MISSING_TTS (fallback funcional) | 31 | Manifest sin entradas: 11 son v1 `{}` con `ttsStatus=pendiente`, 19 son v2 solo `_meta` con `ttsStatus=listo` y 1 es v2 con `pendiente`. Inmersivo muestra el TXT completo y usa audio on-demand. |
| STRUCTURE_MISMATCH | 2 | Alicia y Una odisea marciana (abajo). |
| STALE_TTS | 1 | Cavafis (abajo). |
| MISSING_TEXT / BROKEN_REFERENCE | 0 | Los 61 TXT existen. Ningún mp3 referenciado falta ni está vacío. |

Ningún título supera el tope de 500 chunks. No hay archivos `.tmp-` a medias.

## Matriz de incidencias (sin aplicar)

| contentId | Título | Incidencia | Evidencia | Acción propuesta | Escrituras | Riesgo |
|---|---|---|---|---|---|---|
| content-1773325007384 | Alicia | STRUCTURE_MISMATCH (libro truncado en Inmersivo) | Manifest v2 con 10/103 chunks (`_meta.totalSentences=0`). Las 10 entradas coinciden por hash con el TXT actual. Inmersivo muestra solo 138 frases. Ya se había observado el 2026-09-23. | `POST /api/content/:id/retry` cuando haya cuota | manifest + ~88 mp3 nuevos | Medio. Hay 5 mp3 huérfanos = chunks 10–14 del texto actual: serán HIT, quedarán referenciados y la GC no los borra. |
| content-1789417845849 | Una odisea marciana | STRUCTURE_MISMATCH | Manifest v2 con 8/50 chunks. `ttsStatus=error_proveedor` (Gemini 429, 2026-09-14). Las 8 entradas coinciden por hash. | Igual | manifest + 42 mp3 | Medio |
| content-1779292030328 | Las ciudades que llevamos dentro | STALE_TTS | Las 46 entradas tienen **0/46** hashes que corresponden al texto actual. Las 46 contienen U+FFFD en `sentences` (texto mostrado), mientras que el TXT vigente tiene 0. La entrada 45 es mojibake y excede `totalChunks=45`. `ttsStatus=generando` desde 2026-05-29. El TXT vigente se subió el 2026-05-29; el audio es del 2026-05-20, generado sobre una versión mal codificada. | Igual. Las 46 referencias anteriores se conservan porque la GC respeta el manifest previo. | manifest + 45 mp3 | Alto si el job queda parcial, porque el manifest nuevo truncaría el libro. |

`IMMERSIVE_ORPHAN_ASSETS` (deuda, **no se borran**):

- Alicia: 5 mp3, que son audio válido de los chunks 10–14.
- La metamorfosis (`content-1765751139919`): 8 mp3 con manifest v1 vacío. ⚠️ Un futuro job TTS de ese título los borraría por GC si no resultan HIT.

## Validaciones

- **Autorización anónima (prod, 2026-10-20):**
  - TXT, manifest, mp3 de chunk, `canonical/book.json` y `/api/content/:id/access` → 401.
  - `POST /api/tts` → 401.
  - `audio/immersive/*.wav` → 403 (UNMAPPED).
  - `GET /api/content` → 401.
  - Actor sin acceso, actor autorizado y logout: código y runtime sin cambios desde CP-4F (verificado en vivo allí). No se repitió sesión con el operador porque no hubo escrituras.
- **R6/R7:** `pages/VisorInmersivo.tsx`, `engines/`, `hooks/useImmersivePlayback.ts` y `ImmersiveWrapper` no cambian entre el runtime (`73f45d6`/`cbc8e2d`) y HEAD. El visor solo usa sessionStorage para la memoria de Leo y no persiste el libro.
- **Tests locales (`test:immersive`, ejecutados uno por uno):** todo verde salvo 2 PREEXISTING_FAILURE:
  - `playbackTelemetryNonBlocking`: espera el header `x-user-id` (deuda conocida desde CP-3).
  - `playbackLifecycle` [A5]: la regex estructural del `return` con `<ImmersiveShell` ya falla en `631df93` (WCAG-01C), antes de CP-4.
- **Performance:** sin cambios de código ni de datos, así que no hay POST que comparar. El catálogo anónimo da 401 en ~0,45 s de ida y vuelta desde el cliente. La referencia autenticada de prod es la de CP-4E (p50 42 ms / p95 88 ms).

## Deudas

**Bloqueante para cerrar la sincronización**
- Restaurar créditos de OpenAI TTS (o cuota de pago de Gemini). Después, `retry` uno por uno: Cavafis → Odisea → Alicia, con backup structured + uploads previo y validación de hash por título usando la misma herramienta.

**Inmersivo, no bloqueantes**
- El job TTS publica un manifest parcial cuando salta el breaker, y StartupEngine lo trata como texto completo. Esa es la causa raíz de los 2 títulos truncados. Requiere una unidad propia: guard de manifest incompleto en el front, o no publicar manifests parciales.
- El TTS on-demand de 31 títulos depende hoy del free tier de Gemini, así que habrá frases sin audio cuando no estén en caché.
- `ttsStatus`/`processingStatus` no reflejan el estado real: 19 títulos están en `listo` con 0 chunks y Cavafis sigue en `generando`. Son solo metadatos, porque el front no los lee.
- El manifest no lleva `contentFingerprint`, y la sync de progreso del front envía `contentFingerprint:null`.
- El fallback de TXT crudo segmenta distinto que el servidor (sin protección de abreviaturas ni filtro de ≤5 caracteres).
- Las conocidas `GLOBAL_PERCENTAGE_SHARED_ACROSS_MODES` y `RESUME_READING_DEFAULTS_TO_IMMERSIVE` no cambian.

**Preexistentes ajenas**
- Disco al 89 %.
- Los 2 tests estructurales que fallan, mencionados arriba.

## Rollback

No aplica: 0 escrituras. La evidencia queda en el VPS, en `/root/chp-immersive-2026-10/` (`audit.mjs`, `inventory.json`).
