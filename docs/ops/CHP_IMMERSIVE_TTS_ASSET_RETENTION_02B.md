# CHP-MAINT-IMMERSIVE-TTS-2026-10 · IMM-TTS-02B — Retención no destructiva de audio TTS

Fecha: 2026-10-20 · Estado: **GREEN_LOCAL**, sin deploy · Llamadas TTS reales: **0** · Producción: **sin cambios**

## Comportamiento previo (en producción, `acbfaee`)

| Ruta | Qué borraba | Cuándo |
|---|---|---|
| `server/ttsService.js` · `generateAudioForContent()` · bloque «GARBAGE COLLECTION» | todo `.mp3` del directorio del título no referenciado por el manifest nuevo ni por el anterior (`fs.unlinkSync`) | tras cada publicación correcta |
| `server/immersiveTtsService.js` · `getOrGenerateImmersiveAudio()` | audio **válido** de la extensión opuesta (`.wav` ↔ `.mp3`) al regenerar | en cada miss con cambio de proveedor |
| ídem | sidecar corrupto, audio de 0 bytes, sidecar sin audio | al leer la caché |
| `server/server.js` → `albumTtsService.cleanupAlbumCache(30)` | audio de Modo Álbum con más de 30 días | **automático**: en cada arranque y cada 24 h |

Una regeneración correcta podía borrar:

- **La metamorfosis:** sus 8 huérfanos, que no están referenciados por ningún manifest.
- **Cavafis:** en una **segunda** regeneración, el audio original, que entonces ya no figura en el manifest «anterior».
- **Cualquier título:** el audio de las versiones V(n-2).

Reproducción PRE (`ttsAssetRetention`, proveedor doble, sin red): **16 ✗**. Entre ellos:

- V1 → V2 → V3 borra los mp3 de V1.
- El escenario Alicia borra el mp3 ajeno.
- El escenario Cavafis borra el audio original en la segunda regeneración.
- El escenario Metamorfosis borra los 8 huérfanos.

## Contrato

```
TTS_ASSET_RETENTION_CONTRACT
A. Publicar el manifest nuevo: permitido si está completo y validado (IMM-TTS-01).
B. Escribir mp3 nuevos: permitido (temporal + rename).
C. Audio existente: PRESERVED (no se borra, mueve ni trunca).
D. Audio no referenciado: se cuenta y se registra ([TTS_ORPHAN_AUDIO], result.orphanAudioFiles).
E. Eliminación automática: PROHIBITED.
F. Limpieza futura: solo mediante una unidad explícita con autorización humana específica.
TTS_AUTOMATIC_ASSET_DELETION: ZERO
```

Solo se reemplaza de forma atómica, con temporal + rename y sin borrado previo, lo que es **la misma identidad** republicada:

- `manifest.json`: publicación de la versión completa.
- El sidecar `.json` de la caché bajo demanda.
- La entrada de caché del **mismo hash de texto** cuando estaba rota: 0 bytes o sidecar corrupto o ausente. Es el contrato existente de `immersiveTtsCache` [4][5].

## Implementación

| Archivo | Cambio | Razón |
|---|---|---|
| `server/ttsService.js` | Retirada la GC; detección read-only de huérfanos solo tras publicar (log `[TTS_ORPHAN_AUDIO] … action=retained` + `orphanAudioFiles` en el resultado). Retirada también la lectura del manifest anterior, que solo servía para la GC | C, D, E |
| `server/immersiveTtsService.js` | Retirados los 4 `unlinkSync`; el sidecar se escribe con temporal + rename; el audio de la extensión opuesta se conserva (el sidecar decide qué se sirve) | C, E |
| `server/server.js` | Retirada la programación automática de `cleanupAlbumCache(30)` (arranque + 24 h). Siguen los endpoints admin explícitos `POST /api/admin/album-cache/gc` y `DELETE /api/admin/album-cache/:contentId` | E, F |
| `server/__test__/ttsAssetRetention.test.mjs` | Nuevo (37 aserciones en POSIX; en win32 la sección [L] hace SKIP porque `config.js` falla cerrado) | ratchet |
| `server/__test__/ttsAtomicManifest.test.mjs` | El ratchet «la GC solo corre si se publicó» pasa a «la detección solo corre si se publicó y no hay unlink» | la GC ya no existe |
| `package.json` | `ttsAssetRetention` en `test:content-rmw` | CI |

Sin papelera, sin directorio de archivo, sin scheduler, sin registro de assets y sin mover archivos.

## Auditoría de borrado (tras el cambio)

- **`ttsService.js`:** 0 `unlink`/`rm`/`truncate`. Un único `renameSync(tmpPath, filePath)`, que es publicación atómica.
- **`immersiveTtsService.js`:** 0 `unlink`/`rm`. Dos `renameSync`, ambos desde `.tmp-`.
- **Ruta automática restante:** ninguna. `cleanupAlbumCache` y `purgeAlbumCacheForContent` solo se invocan desde endpoints admin.
- **`DELETE /api/content/:id` (`server.js`, `rmSync` del directorio del título y de su audio):** es la acción explícita de un administrador al eliminar un contenido. No es un job TTS y queda fuera de alcance, registrada como deuda.

En el test, un espía de `fs` (unlink, rm, rmdir y truncate, en sus variantes sync/async/promises, y rename desde un no temporal) registra **0 operaciones destructivas** en los escenarios Alicia, Cavafis, Metamorfosis y caché bajo demanda.

## Escenarios

| Escenario | Assets previos | Assets nuevos | Borrados PRE | Borrados POST |
|---|---|---|---|---|
| V1 → V2 → V3 | 4 (V1) + 2 (V2) | 2 + 2 | 2 (V1 c, d) | 0; 4 huérfanos informados |
| Alicia: manifest 10/103 + mp3 válidos 10–14 + 1 ajeno | 16 | 88 (15 reutilizados) | 1 | 0 |
| Cavafis: manifest stale 46 → texto nuevo 45 → otra regeneración | 46 | 45 + 45 | 46 en la segunda regeneración | 0 |
| Metamorfosis: manifest `{}` + 8 huérfanos | 8 | 3 | 8 | 0; 8 informados |
| fallo 429 | 3 | 0 | 0 (IMM-TTS-01) | 0 |
| caché bajo demanda: `.wav` → regeneración `.mp3` | 1 `.wav` | 1 `.mp3` | 1 (`.wav`) | 0 |

## Huérfanos conocidos en producción (preservados, no tocados)

- **Alicia:** 5 mp3 (chunks 10–14, válidos para el texto actual: el retry los reutilizará).
- **La metamorfosis:** 8 mp3.
- **Audio del caché de álbum:** 2 archivos.

`TTS_ORPHAN_ASSETS` puede crecer, y eso se acepta.

## Tests

Ver el reporte de la unidad. NEW_FAILURE: ninguno.

## Producción y proveedores

Sin deploy y sin tocar manifests ni mp3 de producción. OpenAI = 0 y Gemini = 0: solo dobles inyectados.

## Rollback lógico

Revertir el commit restaura la GC.

## Estado de rollout

**NOT_DEPLOYED.** El intento 1 de IMM-TTS-02C (2026-10-20, 15:20–15:25Z) terminó en `ROLLED_BACK_PROCEDURAL_GATE_BREACH`: el smoke reanudó Inmersivo a mitad de chunk y provocó TTS por frase contra los proveedores. No fue una regresión del fix. Producción sigue en `acbfaee`. Ver `CHP_IMMERSIVE_TTS_ASSET_RETENTION_ROLLOUT_02C.md`, que incluye el runbook de smoke corregido.
