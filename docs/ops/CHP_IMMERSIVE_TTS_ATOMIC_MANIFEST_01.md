# CHP-MAINT-IMMERSIVE-TTS-2026-10 · IMM-TTS-01 — Publicación atómica del manifest TTS

Fecha: 2026-10-20 · Estado: **GREEN_LOCAL**, sin deploy · Llamadas TTS reales: **0** · Producción: **sin cambios**

## Causa raíz

`server/ttsService.js` → `generateAudioForContent()`:

- Construye el manifest v2 nuevo en memoria y lo escribe UNA vez, de forma atómica (tmp + rename), al terminar el bucle de chunks.
- Escribía **siempre**, sin comprobar que el candidato estuviera completo:
  - **429/quota/403/404:** el circuit breaker deja de generar y el bucle solo recoge HITs. El manifest se publicaba con K < N entradas y `abortedByProvider`. Así quedaron Alicia (10/103) y Una odisea marciana (8/50).
  - **5xx, timeout, excepción del proveedor:** se contaba `errorCount++` y se seguía. El manifest se publicaba **con huecos** y se devolvía `success: true`, así que el llamador marcaba `ttsStatus = listo`.
  - **Todos los chunks fallidos:** se publicaba un manifest solo con `_meta` y `success: true`. Esto explica los 19 títulos de producción en `listo` con 0 entradas.
- Después la GC borraba los mp3 no referenciados por el manifest nuevo ni por el anterior, también en un job fallido.
- Como `StartupEngine` muestra el texto del manifest cuando tiene entradas, un manifest parcial equivale a un libro truncado en Inmersivo.

## Contrato

```
MANIFEST_PUBLISH_CONTRACT
El manifest activo solo cambia cuando TODOS los chunks esperados de esta
versión están resueltos y el candidato pasa validateManifestCandidate().
Si no pasa: no se publica nada, no corre la GC, el job termina con
success:false (abortedByProvider en 429/quota, incomplete en el resto) y
emite error_proveedor. El manifest previo sigue activo; sin manifest previo,
el lector usa el TXT completo + TTS bajo demanda (fallback existente).
PARTIAL_MANIFEST_PUBLICATION: IMPOSSIBLE_BY_CONTRACT
```

`validateManifestCandidate(manifest, expectedChunks, audioDir, contentId)` (exportada) exige:

- `_meta` v2 / splitVersion 1 / `totalChunks` = número de chunks esperados;
- número de entradas = esperado;
- índices contiguos `0..N-1`;
- `text` = chunk esperado;
- `hash` = `generateHash(text, es, alloy, provider, model)`;
- `file` = `audio/<id>/chunk_<hash>_<provider>_<model>.mp3`, que existe y pesa > 0;
- `sentences` = `splitSentencesFromChunk(text)`;
- `sentenceStart` acumulado;
- `_meta.totalSentences` = suma.

No cambia el formato del manifest v2, ni el reader, ni el proveedor, ni la cola, ni la reutilización por identidad.

## Implementación

| Archivo | Cambio |
|---|---|
| `server/ttsService.js` | `validateManifestCandidate`. `saveManifest()` solo si `publish.ok`, y GC solo si `publish.ok`. Si el job queda incompleto sin breaker: `error_proveedor` + `{ success:false, incomplete:true }`. |
| `server/__test__/ttsAtomicManifest.test.mjs` | Nuevo, 42 aserciones con proveedor doble (sin red). En el baseline fallan 11. |
| `server/__test__/ttsCacheIdentity.test.mjs` | El bloque «[extra] circuit breaker» asertaba la publicación parcial `["0","2","3"]`. Ahora exige el manifest anterior byte a byte y su audio en disco. |
| `server/__test__/ttsProgressRace.test.mjs` | El fixture sembraba la caché por índice (sin HIT desde CANONICAL 1A) y solo pasaba gracias al defecto (todo fallido → `listo`). Ahora siembra por identidad. Pasa 26/0 con el baseline y con el fix. |
| `package.json` | `ttsAtomicManifest` añadido a `test:content-rmw`. |

`server.js` no cambia: los llamadores ya tratan `success:false` como fallo y no marcan `listo`.

## Matriz de fallos (tras el fix)

| Fallo | Manifest activo | Audio generado | Lector |
|---|---|---|---|
| 429 / quota | sin cambios | conservado (sin GC) | manifest previo, o TXT completo + bajo demanda |
| 5xx / timeout | sin cambios | conservado | igual |
| excepción del proveedor | sin cambios | conservado | igual |
| excepción del job (texto ilegible) | sin cambios (no llega a publicar) | — | igual |
| reintento completo | publica N/N de forma atómica | reutiliza HITs y genera solo lo pendiente | libro completo |

## Tests

- `ttsAtomicManifest`: 42/0 (baseline: 11 ✗, que reproducen el defecto).
- `ttsCacheIdentity`: 39/0.
- `ttsProgressRace`: 26/0.
- `test:content-rmw` y `test:immersive`: ver el reporte de la unidad. Las únicas excepciones son las 2 PREEXISTING_FAILURE de Inmersivo.

## Rollback lógico

Revertir el commit restaura la publicación incondicional. No hay datos que migrar: el formato del manifest no cambia.

## Fuera de alcance (deudas)

- Reparar Cavafis, Odisea y Alicia (requiere créditos TTS y el rollout previo de este fix: IMM-TTS-02).
- `contentFingerprint` en el manifest.
- `ttsStatus` engañoso en producción.
- Huérfanos.
- Las 2 PREEXISTING_FAILURE de Inmersivo.
- Preexistente: en el `catch` exterior de `generateAudioForContent`, `chunks` está fuera de alcance (`ReferenceError` cuando hay `onProgress`). El llamador lo captura como `error_proveedor`. No se toca aquí.
