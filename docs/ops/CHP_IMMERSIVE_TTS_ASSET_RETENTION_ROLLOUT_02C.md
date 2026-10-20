# CHP-MAINT-IMMERSIVE-TTS-2026-10 · IMM-TTS-02C — Rollout de la retención no destructiva (intento 1)

Fecha: 2026-10-20 · Ventana: 15:19Z–15:26Z · Evidencia en el VPS: `/root/chp-imm-tts02c/`

## Veredicto

```
IMM_TTS_02C_ATTEMPT:  ROLLED_BACK_PROCEDURAL_GATE_BREACH
ESTADO:               NOT_COMPLETED (no GREEN)
CAUSA:                PROCEDURAL_SMOKE_GATE_BREACH, no una regresión del producto
```

El candidato `9c00d1c` no está desplegado. Producción vuelve a `acbfaee` (`64b26f3c851a`) en api_1 y api_2.

## Cronología

| Hora (UTC) | Evento |
|---|---|
| 15:19:55 | Snapshot PRE (`pre.txt`) |
| 15:20:08 / 15:20:23 | Backups `structured-20261020T152008Z-6c755346` / `uploads-20261020T152023Z-bb395ab6`: rc=0, Result=success |
| 15:20:37 | Backup del override (`.bak-pre-immtts02c-20261020T152037Z`, sha `e541125f5f43…`) y tag `rollback-pre-immtts02c` |
| 15:20:57 | api_1 → `chibalete/api:immersive-retention-9c00d1c` (`5bde24a6e4a6`): healthy a los 12 s, 0 reinicios, flags idénticos, sin GC de álbum al arrancar |
| 15:21–15:22 | Smoke anónimo OK. Smoke autenticado de Inmersivo: **brecha del gate de proveedores** (abajo) |
| 15:22:30 | Última petición `/api/tts`. El lector se cerró al detectarlo |
| 15:25:25 | Rollback de api_1 → `immersive-atomic-manifest-acbfaee` (`64b26f3c851a`) por decisión del operador; healthy |
| 15:26 | Snapshot POST-ROLLBACK (`post_rollback.txt`) |

api_2 no se tocó: siguió todo el tiempo en `acbfaee`, iniciado a las 14:45:14Z.

## Incidente: PROCEDURAL_SMOKE_GATE_BREACH

**Qué ocurrió**
- El lector de smoke tenía el progreso del título GREEN «Aparecer o estar» en **42 %**. Lo había dejado el smoke de IMM-TTS-02 (Modo Guiado), y el porcentaje se comparte entre modos.
- Inmersivo reanudó en una frase que no es la primera de su chunk.
- Con ese anclaje, el front fuerza TTS **por frase** (`resolveAudioUrlMode` → `forceSentenceTts`, contrato del fix IMMSYNC `78a8425`) y pide cada frase a `POST /api/tts`.
- Esas frases no estaban en la caché bajo demanda (`audio/immersive/`): 8 cache_miss, que llegaron a los proveedores.

**Por qué invalida el procedimiento.** El gate de la unidad exigía 0 llamadas a proveedores y «no provocar cache miss». Reanudar a mitad de chunk lo garantiza: solo el audio del chunk (mp3 publicado) está cacheado; el de cada frase suelta no. El procedimiento de smoke no controlaba la posición de reanudación.

**Por qué no es una regresión del fix**
- `9c00d1c` solo cambia la **eliminación** de assets: GC de `ttsService`, `unlink` de la caché bajo demanda y programación de la GC de álbum.
- No toca la decisión de qué audio se pide, ni el front (`cbc8e2d`, sin cambios), ni `/api/tts`.
- La ruta reanudación → TTS por frase → `/api/tts` existe igual en `acbfaee`. Las 8 peticiones se repartieron entre api_1 (nueva) y **api_2 (vieja, `acbfaee`)**, con el mismo comportamiento en ambas: 3 en api_1 y 5 en api_2.
- No hubo 5xx, errores de runtime ni borrados.

## Llamadas a proveedores (registro honesto)

| Proveedor | Llamadas | Resultado |
|---|---|---|
| OpenAI (`tts-1`) | 4 intentos (api_1 3, api_2 1) | 4 × `429 You have no credits remaining`: sin audio y sin cargo |
| Gemini (`gemini-2.5-flash-preview-tts`, free tier) | 8 generaciones (api_1 3, api_2 5) | 8 audios generados. Consumen la cuota diaria gratuita (10/día), de la que depende el audio bajo demanda de los lectores |

```
OPENAI_TTS_CALLS:  4 (rechazadas, 429 sin créditos; 0 audio, 0 cargo)
GEMINI_TTS_CALLS:  8 (generadas; cuota free tier)
```

## Rollback

| | Imagen | GIT_SHA | Health | Reinicios |
|---|---|---|---|---|
| api_1 PRE (candidato) | `immersive-retention-9c00d1c` (`5bde24a6e4a6`) | `9c00d1c` | healthy | 0 |
| api_1 POST rollback | `immersive-atomic-manifest-acbfaee` (`64b26f3c851a`) | `acbfaee` | healthy (15:25:26Z) | 0 |
| api_2 (sin cambios) | `immersive-atomic-manifest-acbfaee` (`64b26f3c851a`) | `acbfaee` | healthy | 0 |

- El override quedó idéntico byte a byte al backup pre-02C.
- Las variables de entorno de api_1 son idénticas a las de PRE.
- La imagen restaurada vuelve a programar la GC de álbum (>30 días) al arrancar. En este arranque registró 0 líneas y los 2 archivos de álbum siguen presentes con el mismo hash.

## Invariantes (PRE 15:19:55Z vs POST-ROLLBACK)

| Elemento | PRE | POST | Estado |
|---|---|---|---|
| content | `d8cf6abd38b7` (109) | ídem | idéntico |
| access / groups / schools / school_configs / library / mook / banner / lu_config / users legacy | ver `pre.txt` | ídem | idéntico |
| `usuarios_colegios_oro.json` | `84f8b33a2b4c` | ídem | idéntico |
| manifests | 63, árbol `bacd36d5c5dd` | ídem | idéntico |
| mp3 de chunks | 516, árbol `4fce57c9362b` | ídem | idéntico |
| Alicia / Odisea / Cavafis (manifest + TXT) | `3eaee283`/`0228c7ed` · `9482c38c`/`5398b770` · `3b6e7a21`/`11d81659` | ídem | idéntico |
| Huérfanos: Alicia 5 / Metamorfosis 8 | `5d7e08006ef7` / `b0340a71c25f` | ídem | preservados |
| Caché de álbum | 2, `eccce11de3ae` | ídem | preservada |
| Caché bajo demanda `audio/immersive` | 1685 | **1701** (+8 `.wav`, +8 sidecars `.json`) | escrituras del smoke; 0 borrados |
| uploads | 3382 / 6.012.748.115 B | 3398 / 6.014.573.827 B (+16 / +1.825.712 B) | solo las 16 de arriba |
| progress | — | 0 filas modificadas desde 15:20Z (la del título de smoke sigue en 14:47:57Z) | sin escrituras |
| 5xx de API / edge desde 15:20:57Z | — | 0 / 0 | — |

`PRODUCTION_CONTENT_MUTATION: ZERO`. La única escritura son las 16 entradas nuevas de la caché bajo demanda, causadas por la brecha del smoke. No hay contenido editorial, manifests, chunks, stores ni progreso modificados.

## Runbook de smoke corregido (obligatorio para repetir IMM-TTS-02C)

```
IMMERSIVE_SMOKE_REQUIRES_CHUNK_BOUNDARY:  YES
PROGRESS_RESET_FOR_SMOKE:                 PROHIBITED
PRODUCTION_PROGRESS_MANUAL_MUTATION:      ZERO
```

1. **Elegir el título y el punto de entrada**
   - Usar un título GREEN (manifest completo).
   - Antes de abrir Inmersivo, leer en solo lectura el progreso del actor (`GET /api/progress/item/:u/:c`).
   - Solo continuar si al reanudar se cae en el **inicio** del libro o en la **primera frase de un chunk**: progreso `null`, `sentenceIndex = sentenceStart` de un chunk, o un `porcentaje × total` que caiga exactamente en un `sentenceStart`.
   - Si no es así, **no abrir Inmersivo con ese actor y ese título**: cambiar de título o de actor.
2. **Prohibido preparar el estado:** no resetear, editar ni borrar progreso, ni por API ni por almacén.
3. **Actor:** preferir uno de prueba sin progreso previo en el título elegido. Para el lector actual, el título `content-mook-eaq-13ef9e9e5bd08451` queda **excluido** del smoke de Inmersivo, porque tiene 42 % compartido entre modos.
4. **Tres smokes separados**
   - **a) Audio y caché:** abrir desde un límite de chunk y reproducir el mp3 del chunk. Gate durante la prueba: en los logs, 0 `on-demand request` / 0 `cache_miss`. **Si aparece una sola `/api/tts`: cerrar el lector de inmediato y abortar el smoke.**
   - **b) Navegación:** avanzar y retroceder. Antes, confirmar que la navegación no fuerza TTS por frase sobre frases sin caché. Si lo hace, limitar la navegación a límites de chunk o hacerla sin reproducir audio.
   - **c) Progreso y reanudación:** con un recorrido normal del usuario que genere progreso por sí mismo (por ejemplo Modo Guiado con scroll y el flush de 15 s), sin manipular nada. La reanudación en Inmersivo **no** se reproduce si cae a mitad de chunk; se verifica solo el aviso «Retomando desde X %», sin play.
5. **Monitor continuo de proveedores durante el smoke** (`docker logs -f` filtrando `IMMERSIVE_TTS|on-demand|FALLBACK task=tts|PRIMARY task=tts`).

## Deudas

**Bloqueantes para la reparación**
- Créditos de OpenAI.
- Cuota de Gemini (hoy reducida por este incidente).

**Inmersivo, no bloqueantes**
- Una reanudación a mitad de chunk siempre genera TTS por frase vía proveedor: coste o cuota por lectura. Es comportamiento de producto existente y se registra para evaluarlo aparte.
- El progreso es compartido entre modos.
- `committedIndex`.
- Las sesiones de Inmersivo se registran como `text`.
- `ttsStatus` engañoso.
- No hay fingerprint en el manifest.
- `ReferenceError` en el `catch` exterior.

**`CONTENT_DELETE_AUDIO_DESTRUCTIVE_PATH`** (`DELETE /api/content/:id` hace `rmSync` del directorio de audio): NOT_EXECUTED · NOT_PART_OF_TTS_RUNTIME · REQUIRES_SEPARATE_SAFETY_UNIT.

**Preexistentes, ajenas**
- Disco al 91 %.
- Resets de keepalive entre edge y API.
- 2 tests de Inmersivo.
- 12 errores de `tsc`.

**NEXT:** REPEAT IMM-TTS-02C WITH CORRECTED SMOKE PROCEDURE (no ejecutado).
