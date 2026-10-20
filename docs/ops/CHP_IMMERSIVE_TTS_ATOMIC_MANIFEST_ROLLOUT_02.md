# CHP-MAINT-IMMERSIVE-TTS-2026-10 · IMM-TTS-02 — Rollout del fix de manifest atómico

Fecha: 2026-10-20 · VPS de producción · Ventana 13:45Z–14:49Z · Evidencia en `/root/chp-imm-tts02/`

## Veredicto

```
IMMERSIVE_TTS_ATOMIC_MANIFEST_ROLLOUT:  GREEN_PRODUCTION
PARTIAL_MANIFEST_PUBLICATION:           PREVENTED_PRODUCTION
PREVIOUS_VALID_MANIFEST_ON_FAILURE:     PRESERVED
NO_PREVIOUS_MANIFEST_ON_FAILURE:        FALLBACK_TO_FULL_TEXT
AFFECTED_TITLES_REPAIR:                 NOT_YET_EXECUTED
OPENAI_TTS_CALLS / GEMINI_TTS_CALLS:    ZERO / ZERO
IMMERSIVE_PROGRESS_REGRESSION:          ZERO
CONTENT_PROTECTION_REGRESSION:          ZERO
PRODUCTION_CONTENT_MUTATION:            ZERO
```

## Baseline (PRE, 13:45Z)

- **API:** `chibalete/api:contentprotect-global-73f45d6` (`b5e6f59c60db`) en api_1 y api_2.
- **Front:** `contentprotect-final-cbc8e2d` (`7265576a7feb`). Sin cambios.
- **Edge:** sin cambios. **LU:** 0.9.2, sin cambios.
- **Flags:** `SESSION_AUTH_MODE=enforce`, `UPLOADS_AUTHZ_MODE=strict`, `TTS_MODE=openai`, `AI_MODE=enabled`; `ARCHIVE_ROTATION_ENABLED=1` solo en api_1.
- **Contenedores:** 4 healthy, 0 reinicios.

## Backups JIT

| Unidad | rc | Result | ID |
|---|---|---|---|
| structured-backup | 0 | success | `structured-20261020T135549Z-254d93a4` |
| uploads-backup | 0 | success | `uploads-20261020T135605Z-d060d5b5` |

## Artefacto

- **Tag:** `chibalete/api:immersive-atomic-manifest-acbfaee`.
- **Image ID:** `64b26f3c851a`. Es el mismo en local y en el VPS.
- **Tarball:** sha256 `6818bb33ef7b…`, verificado con `sha256sum -c`.
- **Revisión:** `GIT_SHA` (env) y la label `org.opencontainers.image.revision` valen `acbfaee469ff…`.
- **Origen:** construido desde `git -c core.autocrlf=false archive acbfaee`.
- **Diferencia en runtime frente a producción** (sha256 de `server/`, `utils/` y `engines/`, sin tests):
  - `server/ttsService.js`: el fix.
  - `utils/epubAdmin.mjs`: el texto de CP-4F, ya presente en el front de producción.

## Tests predeploy (dentro de la imagen)

| Suite | Resultado | Clasificación |
|---|---|---|
| ttsAtomicManifest (además con `--network none` y sin claves) | 42/0 | GREEN |
| ttsCacheIdentity | 39/0 | GREEN |
| ttsProgressRace | 26/0 | GREEN |
| contentGlobalReadOnlyPolicy | 31/0 | GREEN |
| uploadsAuthzStrict | 157/0 | GREEN |
| progressReadIdentity | 27/0 | GREEN |
| sessionIdentity · sessionIdentityIntegration · sessionBrowserCookieOnly | 42 · 34 · 13 / 0 | GREEN |
| epubProgressSync · epubOriginalEndpoint | 39 · 32 / 0 | GREEN |
| catalogResourceLocators · catalogAccessLogNoise · catalogAccessPerformance | 33 · 48 · 20 / 0 | GREEN |
| contentFingerprint · canonicalBookIngestion · contentStoreRmwConcurrency · contentStoreRmwSuiteIntegrity · uploadDedupCanonical · uploadDedupOwnership | 0 fallos | GREEN |
| canonicalBookTxt | la imagen no trae `typescript` (devDep); 49/0 en el árbol completo `acbfaee` | SKIPPED_BY_PLATFORM |
| `test:content-rmw` completo (árbol `acbfaee`) | 31/31 archivos | GREEN |
| `test:immersive` completo (árbol `acbfaee`) | 35/37 | GREEN + 2 PREEXISTING_FAILURE (`playbackTelemetryNonBlocking`, `playbackLifecycle` [A5]) |

NEW_FAILURE: ninguno.

## Ratchet de atomicidad en el artefacto

`PARTIAL_MANIFEST_PUBLICATION: PREVENTED_IN_ARTIFACT`. El ratchet `ttsAtomicManifest` corrió en la imagen sin red.

| Escenario | Manifest PRE | Resultado | Manifest POST |
|---|---|---|---|
| éxito completo | — | success | 6/6 publicado |
| 429 a mitad | — | abortedByProvider | ninguno; 3 mp3 conservados |
| 5xx a mitad | — | incomplete, error_proveedor | ninguno; 3 mp3 conservados |
| excepción del proveedor a mitad | — | success=false | ninguno |
| manifest previo + fallo | V1 6/6 | abortado | V1 idéntico byte a byte |
| sin manifest previo + fallo | — | success=false | ninguno (fallback a TXT completo) |
| reintento completo | — | success, solo 3 llamadas | 6/6 publicado |

## Rollback (preparado, no ejecutado)

- **Runbook:** `/root/chp-imm-tts02/ROLLBACK.txt`.
- **Override previo:** `docker-compose.override.yml.bak-pre-immtts02-20261020T135630Z`.
- **Imagen previa:** `contentprotect-global-73f45d6` (`b5e6f59c60db`), también etiquetada `chibalete/api:rollback-pre-immtts02`.
- **Pasos:** `sed` de la línea 40/85 y recreate api_1 → api_2.
- **Datos:** no hay nada que restaurar.

`ROLLBACK_READY: YES`.

## Deploy

**api_1** (13:56:46Z):
- healthy a las 13:56:58Z, 0 reinicios.
- Imagen `64b26f3c851a`, `GIT_SHA=acbfaee`.
- Flags idénticos; solo cambia `CHIBALETE_RELEASE`, que es metadato.
- `[HASH_INDEX] Built` a las 14:00:43Z.
- Smoke anónimo: health 200 y ready 200; catálogo, `/access` y manifest dan 401.
- El startup passive audit de TTS (preexistente) no modificó `content.json`: es idempotente y esos títulos ya estaban en `pendiente`.

**Gate api_1:** GREEN.
- 0 5xx en la API y 0 errores de runtime.
- Inmersivo abre y reproduce.
- Progreso y reanudación funcionan, sin regresión en CP-4.

**api_2** (14:45:12Z):
- healthy a las 14:45:30Z, 0 reinicios.
- Misma imagen y flags idénticos.
- `[HASH_INDEX] Built` a las 14:47:06Z.

Desde ese momento api_1 = api_2 = `64b26f3c851a`.

## Invariantes de manifests

| Título | Hash PRE | Hash POST | Entradas PRE / POST | mp3 | TXT | Estado |
|---|---|---|---|---|---|---|
| Alicia `content-1773325007384` | `3eaee28371d7` | `3eaee28371d7` | 10 / 10 | 15 / 15 | `0228c7ed0267` | PREEXISTING_TRUNCATED |
| Una odisea marciana `content-1789417845849` | `9482c38ce957` | `9482c38ce957` | 8 / 8 | 8 / 8 | `5398b7706da5` | PREEXISTING_TRUNCATED |
| Las ciudades que llevamos dentro `content-1779292030328` | `3b6e7a21911f` | `3b6e7a21911f` | 46 / 46 | 46 / 46 | `11d816595be1` | PREEXISTING_STALE |

`AFFECTED_TITLE_MANIFEST_MUTATION: ZERO`.

**Globales:**
- 63 manifests y 516 mp3 de chunks, antes y después.
- Hash del árbol de manifests `bacd36d5c5dd` y del árbol de mp3 `4fce57c9362b`, idénticos.
- `audio/immersive` 1685 = 1685.
- Uploads 3382 / 6.012.748.115 B = idéntico.
- 0 escrituras inesperadas.

## Smoke de Inmersivo (producción, sesión de lector del operador)

Título: «Libro · Aparecer o estar: el nuevo cogito» (`content-mook-eaq-13ef9e9e5bd08451`, GREEN 15/15). No se usó ninguno de los 3 títulos afectados.

- **Apertura:** `/access` 200 y después el manifest y el TXT (R6, en las 3 aperturas). Texto del manifest visible.
- **Audio:** mp3 de chunk cacheado → 200. Reproduce con un clic real, avanza de forma natural por las frases y pasa sin cortes al chunk 1 (A/B, 97,9 s → 102,9 s).
- **Navegación:** «siguiente» avanza. «Anterior» retrocede y dispara el apoyo de Leo («volviste varias veces»), comportamiento existente.
- **Cierre de sesión temporizada:** el overlay «¡Lectura Completada!» con «+5 minutos» y «Salir» es el bloque de 40 s. Comportamiento existente.
- **Progreso:**
  - En Inmersivo con audio por chunk no se envía ningún `sync` hasta confirmar la frase (puerta de cliente `canSaveProgress`; deuda conocida `committedIndex`). No depende de la API.
  - En Modo Guiado, sobre el mismo título y con **las dos réplicas ya nuevas**: 2× `POST /sync` 200; el servidor guarda 42 % a las 14:47:57Z.
- **Reanudación:** Inmersivo vuelve a abrir con «Continuando desde otro modo — Retomando desde el 42 % del libro». Es el contrato actual (`GLOBAL_PERCENTAGE_SHARED_ACROSS_MODES`, sin cambios).
- **R7:** el texto del libro no está en localStorage. `chibalete_content` es la caché del catálogo, que se purga al hacer logout (CP-3).
- **Catálogo del lector:** 89 títulos; manifest y TXT con `private, no-store`.

## Monitoreo (13:56Z–14:49Z)

| Métrica | Resultado |
|---|---|
| 5xx de la API | 0 en las dos réplicas |
| 5xx del edge | 1: `POST /api/events` 502 a las 14:42:45Z por `recv() failed (104: Connection reset by peer)` del upstream api_1. Es un patrón preexistente: 9 casos en 7 días, en ambas réplicas, desde el 15-10. Telemetría no bloqueante. **No atribuible** |
| Reinicios | 0 en los 4 contenedores |
| CPU / memoria | API ~1 %, 74–85 MiB. Front 3 MiB. Edge 11 MiB |
| Catálogo (servidor, tras `HASH_INDEX`, 60 peticiones del lector) | **p50 40 / p95 54 / máx 91 ms**. Referencia CP-4E: p50 42 / p95 88 |
| Errores de Inmersivo / progreso / authz | 0 / 0 / 0 |
| Jobs de TTS | 0 (sin `Starting generation`, `RETRY_` ni `TTS_MANIFEST_NOT_PUBLISHED`) |
| Llamadas a proveedores de TTS | 0 (sin on-demand, `cache_miss` ni `FALLBACK task=tts`) |
| Errores de cuota | 0 reales (los aciertos de grep por «429» eran IDs) |

## Invariantes de datos (PRE vs POST)

| Store | PRE | POST | Estado |
|---|---|---|---|
| content | `d8cf6abd38b7` (109) | `d8cf6abd38b7` | idéntico |
| access_db | `d4182a1d1152` | ídem | idéntico |
| groups | `43503119a5f9` | ídem | idéntico |
| school_configs / schools | `de83151ce295` / `a030122151d9` | ídem | idéntico |
| library / mook / banner / lu_config | `67ff6972` / `dd056fbe` / `d25811e9` / `ea86a666` | ídem | idéntico |
| users_db (legacy) | `9fb0bd984c7e` | ídem | idéntico |
| `usuarios_colegios_oro.json` | `8fbad9830db4` | `84f8b33a2b4c` (mismo tamaño) | solo `lastLoginAt` del login de smoke del lector (14:36:27Z): uso normal |
| progress | — | 1 registro del lector de smoke | uso normal |
| uploads / manifests / mp3 | ver arriba | idéntico | idéntico |
| disco | 89 % | 90 % | tarball (148 MB) + capas de la imagen cargada |

`PRODUCTION_CONTENT_MUTATION: ZERO`.

## SHAs

- **Runtime API:** `acbfaee469ffebc845ac948000d1f4f7b78c885e` (`64b26f3c851a`).
- **Front:** `cbc8e2d`, sin cambios.
- **LU:** 0.9.2, sin cambios.

## Deudas

**Bloqueantes para reparar los títulos (IMM-TTS-03)**
- Capacidad de proveedor: OpenAI sin créditos; Gemini free tier limitado a 10/día.

**Inmersivo, no bloqueantes**
- Reparar Cavafis, Odisea y Alicia (IMM-TTS-03).
- `contentFingerprint` en el manifest.
- `ttsStatus` engañoso.
- 13 huérfanos: Alicia 5 (chunks 10–14 válidos) y La metamorfosis 8.
- `ReferenceError` en el `catch` exterior del job.
- El progreso de Inmersivo con audio por chunk solo se guarda al confirmar la frase (`committedIndex`).
- Las sesiones de Inmersivo se registran como `text` (dual-write legacy).
- `GLOBAL_PERCENTAGE_SHARED_ACROSS_MODES`.

**Preexistentes, ajenas**
- Reset de keepalive edge↔API (~1–3 al día).
- `[HASH_INDEX]` ocupa una CPU tras cada arranque (~2–4 min).
- Disco al 90 %.
- Tests `playbackTelemetryNonBlocking` y `playbackLifecycle` [A5].
- 12 errores de `tsc`.

**NEXT:** RESTORE TTS PROVIDER CAPACITY, THEN IMM-TTS-03 — REPAIR THREE AFFECTED TITLES (no ejecutado).
