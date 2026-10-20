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

**NEXT:** REPEAT IMM-TTS-02C WITH CORRECTED SMOKE PROCEDURE (ejecutado en R2, abajo).

---

# R2 SUCCESSFUL ROLLOUT (IMM-TTS-02C-R2, 2026-10-20, 15:34Z–15:48Z)

Evidencia en el VPS: `/root/chp-imm-tts02c-r2/` (`pre.txt`, `post.txt`, `sentinel.sh`, `R2_START_UTC`, `prev_smoke_files.txt`, `ROLLBACK.txt`).

## Veredicto R2

```
IMMERSIVE_TTS_ASSET_RETENTION_ROLLOUT:   GREEN_PRODUCTION
TTS_AUTOMATIC_ASSET_DELETION:            ZERO_PRODUCTION
TTS_EXISTING_ASSETS:                     PRESERVED_PRODUCTION
TTS_ORPHAN_DETECTION:                    READ_ONLY_PRODUCTION
ALBUM_CACHE_AUTOMATIC_GC:                DISABLED_PRODUCTION
ATOMIC_MANIFEST_CONTRACT:                PRESERVED_PRODUCTION
OPENAI_TTS_CALLS_DURING_R2:              ZERO
GEMINI_TTS_CALLS_DURING_R2:              ZERO
POST_API_TTS_DURING_CONTROLLED_SMOKE:    ZERO
PROGRESS_RESET_FOR_SMOKE:                PROHIBITED
PROGRESS_MANUAL_MUTATION:                ZERO
AFFECTED_TITLES_MUTATION:                ZERO
CONTENT_PROTECTION_REGRESSION:           ZERO
```

## Baseline R2

- **API:** api_1 y api_2 en `acbfaee` (`64b26f3c851a`), healthy, 0 reinicios.
- **Front:** `cbc8e2d`. **LU:** 0.9.2.
- **Caché `audio/immersive`:** **1701** entradas. Es la nueva baseline: incluye los 16 archivos del intento 1, que se conservan.
- **Uploads:** 3398 / 6.014.573.827 B.
- **progress:** 7224 filas.

## Backups R2

- `structured-20261020T153518Z-e4214474`: rc=0, success.
- `uploads-20261020T153531Z-d3d2f2f5`: rc=0, success.

## Artefacto R2

`chibalete/api:immersive-retention-9c00d1c`, `5bde24a6e4a6`, `GIT_SHA=9c00d1c` (env + label). Es la misma imagen verificada en el intento 1; no se reconstruyó.

**Tests repetidos en la imagen** (las suites de TTS, con `--network none`), todos con 0 fallos:

| Suite | Resultado |
|---|---|
| ttsAssetRetention | 37 |
| ttsAtomicManifest | 42 |
| ttsCacheIdentity | 39 |
| ttsProgressRace | 26 |
| immersiveTtsCache | 44 |
| uploadsAuthzStrict | 157 |
| contentGlobalReadOnlyPolicy | 31 |
| progressReadIdentity | 27 |
| session | 42 · 34 · 13 |
| catalog | 33 · 48 · 20 |

**En el árbol completo:** `test:content-rmw` 32/32; `test:immersive` 35/37 con solo las 2 PREEXISTING_FAILURE.

## Selección segura del smoke (read-only, antes del deploy)

| Campo | Valor |
|---|---|
| Actor | sesión de lector del operador (id terminado en `-092`) |
| Título | `content-mook-eaq-fad2f33d8fb7a19c` «Libro · El silencio cartesiano» (GREEN 7/7, 114 frases) |
| Progreso PRE | servidor `null`; local sin registro |
| Frase de reanudación | 0 |
| Chunk | 0 (`sentenceStart` 0, 13 frases) |
| CHUNK_BOUNDARY | YES |
| Audio exacto requerido | `chunk_e25526389bac513bedcc9f45db0e7cc8_gemini_gemini-2.5-flash-preview-tts.mp3`, 5.393.850 B, sha256 `29407c1fcb47…`, identidad (md5 de texto, idioma, voz y motor) = hash del manifest |
| EXACT_AUDIO_REQUIRED_FOR_SMOKE | PRESENT (verificado de nuevo justo antes del Play) |
| PROGRESS_RESET | NO |

**Base de código.** En `VisorInmersivo` + `useImmersivePlayback`, el TTS por frase solo se fuerza en una reanudación anclada (`targetIndex > 0` + play) a mitad de chunk. Al abrir en la frase 0, o al preparar una reanudación sin reproducir, solo se carga el mp3 del chunk.

## Centinela de proveedores

`R2_START_UTC = 2026-10-20T15:34:01Z`. `sentinel.sh` cuenta en ambas réplicas `POST /api/tts`, OpenAI tts, Gemini tts, `cache_miss`, jobs TTS y 5xx. Se ejecutó después de cada paso; **en todas las lecturas el resultado fue 0**, hasta la última a las 15:48:23Z.

## Deploy R2

| Réplica | Hora | Imagen | Estado |
|---|---|---|---|
| api_1 | 15:40:51Z | `5bde24a6e4a6` | healthy a los 12 s, 0 reinicios, `GIT_SHA=9c00d1c`, flags idénticos, 0 líneas de GC de álbum |
| api_2 | 15:45:17Z | ídem | healthy, 0 reinicios, flags idénticos, 0 líneas de GC de álbum; `HASH_INDEX` construido a las 15:47:11Z |

api_1 = api_2 = `5bde24a6e4a6` / `9c00d1c`.

## Smokes (separados)

| Smoke | Resultado |
|---|---|
| A · API | health/ready 200. Anónimo: catálogo, `/access` y manifest → 401. Lector: catálogo 200 `no-store` (89); `/access` allowed; PDF Range 206 `private, no-store`; endpoint EPUB 200; EPUB crudo 403 |
| B · Inmersivo sin audio | `/access` 200 antes de manifest y TXT (R6). Texto en la frase 0, sin aviso de reanudación. Solo se carga `chunk_e2552638` (200). Avanzar → frase 1 y retroceder → frase 0, sin reproducir. 0 `/api/tts`. Al cerrar, el progreso del servidor sigue en `null` |
| C · Audio cacheado exacto | Reapertura en la frase 0; un único Play real: reproduce `chunk_e2552638` (200; 9,5 s → 18,7 s de 112,4 s). Pausa y cierre. 0 `/api/tts`, 0 `cache_miss` |
| D · Progreso | Modo Guiado: scroll + flush. 2 `POST /sync` 200 (uno en cada réplica); el servidor guarda 48 % (15:44:08Z). No se usó el botón de audio |
| E · Reanudación | Reapertura de Inmersivo: «Continuando desde otro modo — Retomando desde el 48% del libro». Solo se prepara el chunk existente `chunk_9808e861` (200). **Sin Play** (posición a mitad de chunk). 0 `/api/tts` |

## Invariantes R2 (PRE 15:34:02Z vs POST 15:47Z)

**Snapshot completo idéntico** (`diff pre.txt post.txt` vacío):

- Stores idénticos: content `d8cf6abd38b7`, access, groups, schools, school_configs, library, mook, banner, lu_config, users legacy y `usuarios_colegios_oro`.
- uploads: 3398 / 6.014.573.827 B.
- 63 manifests (árbol `bacd36d5c5dd`) y 516 mp3 de chunks (árbol `4fce57c9362b`).
- `audio/immersive`: 1701.
- Caché de álbum: 2 (`eccce11de3ae`).
- Huérfanos: Alicia 5 (`5d7e08006ef7`), Metamorfosis 8 (`b0340a71c25f`).
- Alicia, Odisea y Cavafis: manifest y TXT idénticos.
- Los **16 archivos del intento 1** siguen presentes, con el hash del conjunto idéntico (`3930e75b60b2`).

`TTS_ASSET_DELETION: ZERO` · `TTS_ASSET_GENERATION: ZERO`.

**progress:** de 7224 a 7225 filas. La nueva corresponde al smoke D (lector `-092`, `content-mook-eaq-fad2f33d8fb7a19c`, 15:44:08Z) y se clasifica como NORMAL_SMOKE_ACTIVITY. Escrituras manuales: 0.

`PRODUCTION_EDITORIAL_CONTENT_MUTATION: ZERO` · `PROGRESS_MANUAL_MUTATION: ZERO`.

## Monitoreo R2 (desde `R2_START_UTC`)

| Métrica | Resultado |
|---|---|
| 5xx de la API / del edge | 0 / 0 |
| Reinicios | 0 en los 4 contenedores |
| CPU / memoria | API ~1 %, 67–85 MiB (api_2 tuvo un pico del 60 % al arrancar, que se normalizó) |
| Catálogo (servidor, 60 peticiones tras `HASH_INDEX`) | p50 44 / p95 81 / máx 269 ms |
| Errores de Inmersivo / progreso / runtime | 0 / 0 / 0 |
| Jobs TTS / `[TTS_ORPHAN_AUDIO]` | 0 / 0 |
| Proveedores | 0 |

## Rollback R2 (preparado, no ejecutado)

- **Runbook:** `/root/chp-imm-tts02c-r2/ROLLBACK.txt`.
- **Override:** `.bak-pre-immtts02c-r2-20261020T153549Z`.
- **Imagen:** `rollback-pre-immtts02c-r2` = `64b26f3c851a`.

## Deudas R2

- **Capacidad de proveedor:** OpenAI sin créditos; Gemini en free tier.
- **Pendientes de reparar:** Cavafis, Odisea y Alicia (IMM-TTS-03).
- **`CONTENT_DELETE_AUDIO_DESTRUCTIVE_PATH`:** NOT_EXECUTED · OUT_OF_SCOPE · REQUIRES_SEPARATE_SAFETY_UNIT.
- **No bloqueantes:**
  - La reanudación a mitad de chunk genera TTS por frase.
  - El progreso es compartido entre modos.
  - `committedIndex`.
  - `ttsStatus` engañoso.
  - No hay fingerprint en el manifest.
  - `ReferenceError` en el `catch`.
- **Preexistentes:**
  - Disco al 91 %.
  - Resets de keepalive.
  - 2 tests de Inmersivo.
  - 12 errores de `tsc`.

**NEXT:** RESTORE OPENAI TTS CAPACITY, THEN IMM-TTS-03 — REPAIR CAVAFIS → ODISEA → ALICIA (no ejecutado).
