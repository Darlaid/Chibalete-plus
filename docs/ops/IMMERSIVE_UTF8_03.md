# PROD / IMMERSIVE-UTF8-03 · Reintento TTS tras la recarga de OpenAI

**Fecha:** 2026-10-27 (UTC) · **HEAD:** `7980943` · **Obra:** `content-1779292030328` («Las ciudades que llevamos dentro») · **Antecedentes:** `IMMERSIVE_UTF8_01.md`, `IMMERSIVE_UTF8_02.md`
**Autorización:** un único reintento productivo para esta obra.

**Veredicto:** **GREEN_PRODUCTIVO.** Voz y sincronización regeneradas desde el TXT UTF-8 vigente:
- 0 × «�»;
- Inmersivo y Guiado reproducen el audio nuevo;
- Accesible normal;
- estado `listo`;
- ninguna otra obra tocada.

## A. Baseline y preflight

- HEAD = remoto = `7980943`. Sesión de administración autenticada en Chrome (`/api/auth/me` → `administrador`).
- api_1 y api_2 healthy, 0 reinicios, **0 jobs TTS activos** de la obra.
- **Los 47 archivos originales = respaldo** `/root/chp-utf8-02/backup/` (huella por archivo). TXT íntegro (`sha256sum -c` OK) y **0 × U+FFFD**.
- **Bloque Gemini de UTF8-02** (`chunk_cb85cc61…_gemini_…mp3`, 5,6 MB): **WAV válido** (cabecera RIFF/WAVE, reproducible por contenido).
  - Los mp3 Gemini de mayo son **PCM crudo sin cabecera**, que el navegador no puede decodificar. Probablemente también por eso el audio viejo de esta obra no sonaba.
- **Estado previo:** `error_proveedor`. El reintento solo se bloquea con `generando`, así que no hizo falta ninguna transición.
- **Cuota de OpenAI:** `GET /v1/models` → 200 (clave válida, sin coste). Ese endpoint **no informa del saldo**; el primer bloque del reintento hizo de prueba real.

## B. Solicitud de reintento

- **Una sola** llamada `POST /api/content/content-1779292030328/retry` desde la sesión de administración (23:35:58Z) → **200** `success: true`. Sin duplicados.

## C. Bloques reutilizados y generados

- Job en api_1: «Total chunks: 45».
- **1 reutilizado** (cache hit por identidad: el bloque 1 que Gemini generó en UTF8-02) y **44 generados** por OpenAI.
- Resultado: `Created: 44, Skipped: 1, Errors: 0`; `[RETRY_SUCCESS]` a las 23:39:26Z (3 min 28 s).
- No hubo `TTS_MANIFEST_NOT_PUBLISHED`: el manifest pasó el validador y se publicó de forma atómica.
- `[TTS_ORPHAN_AUDIO] count=46 action=retained`: los 46 mp3 viejos se conservan.

## D. Proveedor y consumo

| Proveedor | Bloques | Formato |
|---|---|---|
| OpenAI `tts-1` (voz `alloy`) | 44 nuevos | MP3 |
| Gemini `gemini-2.5-flash-preview-tts` | 1 (reutilizado, generado en UTF8-02) | WAV |

- **Consumo estimado:** 44 bloques de OpenAI (~1 400 caracteres cada uno, ≈ 61 000 caracteres de TTS).
- Durante la prueba de Inmersivo se generaron además **2 clips cortos bajo demanda** con OpenAI (57 KB y 28 KB, 23:40:42–44Z). Es la caché compartida `/uploads/audio/immersive/` que el lector usa al empezar a mitad de un bloque.
- **Mezcla de voces:** el bloque 1 tiene la voz de Gemini y los 44 restantes la de OpenAI.

## E. Manifest final e integridad

Verificación independiente, de solo lectura, en un contenedor sin red con la imagen de producción y las funciones del servidor:

| Comprobación | Resultado |
|---|---|
| `validateManifestCandidate` (contrato de publicación) | **ok** |
| `_meta` | `version 2`, `splitVersion 1`, `totalChunks 45`, `totalSentences 852` |
| Entradas frente a bloques esperados del TXT vigente | 45 = 45; **todo `text` = su bloque del TXT actual** |
| U+FFFD | **0** en oraciones y **0** en textos |
| Primera y segunda oración | «Las ciudades que llevamos dentro **Antología poética** Constantino Cavafis **Prólogo I.**» · «**Quién** fue Cavafis: una vida entre dos mundos…» |
| Oraciones con tilde o ñ | 546 de 852 |
| Archivos de audio | Todos existen y no están vacíos; **0 referencias a archivos de la versión vieja** |
| Hash de cada bloque | Corresponde a su `text` (lo exige el validador) |
| Estado de la obra | **`ttsStatus: listo`**, `processingStatus: completed` (100 %) |
| sha256 del manifest publicado | `44709b645e7ec938…` |

## F. Pruebas visuales y auditivas (Chrome real, sesión de administración)

| Modo | Resultado |
|---|---|
| **Inmersivo** (`#/leer/inmersivo/…`) | Texto del manifest nuevo, **0 × «�»**, tildes correctas («había», «también», «lo más hondo»). **Reproducción:** el audio avanza (0 → 8,2 s, `paused: false`) y **la oración resaltada avanza con él** («Y eso no es algo del pasado.» → «Hoy también vemos cómo discursos políticos…»). **Pausa:** se detiene (8,3 s, `paused: true`) |
| Inicio del libro en Inmersivo | Se abre en la posición guardada de la cuenta (a mitad del libro), así que el inicio no está en pantalla. El manifest que **recibe el navegador** empieza por «…Antología poética… Prólogo I.», con 0 × «�» |
| **Guiado** (`#/leer/texto/…`) | Texto del TXT con «Antología poética» y «Prólogo», 0 × «�». «Leer en voz alta» reproduce **`chunk_4ba43178…_openai_tts-1.mp3` del manifest nuevo** (206, avanza a 7,6 s); «Pausar lectura» lo detiene (26,3 s) |
| **Accesible** (`#/leer/accesible/…`) | Abre con normalidad: texto completo con «Antología poética» y «Prólogo», 0 × «�», navegación por capítulo y sección, progreso |

- El panel de Leo se abrió solo en Guiado y se cerró sin usarlo.
- **Escrituras de la propia cuenta de administración** al leer (comportamiento normal del lector): 2 × `progress/sync` y actualizaciones de `leo/memory` de esa cuenta para esta obra.

## G. Datos antes y después

- **`content.json`** frente a la restauración POST de DEPLOY-01: 109 = 109 registros; **0 registros ajenos cambiados**; en esta obra solo `ttsStatus` y `processingStatus` (`listo`/`completed`).
- TXT idéntico. `royalties.db` (derechos y circuito económico), `events.db` (`econ_events`) y reglas comerciales idénticos.
- **Archivos fuera de esta obra** modificados desde el inicio de UTF8-02: solo los 2 clips de la caché bajo demanda de §D (generados por la prueba). Ningún otro libro, manifest ni audio.
- Errores 0 y reinicios 0 en las dos réplicas.

## H. Respaldos y archivos conservados

- Carpeta de audio de la obra: **92 archivos**:
  - los **46 mp3 de mayo intactos** (huella igual al respaldo);
  - el bloque Gemini de UTF8-02;
  - los 44 mp3 nuevos de OpenAI;
  - el manifest publicado.
- El manifest anterior (híbrido) queda solo en el respaldo, porque la publicación atómica lo reemplazó.
- `/root/chp-utf8-02/`:
  - `backup/` (tar `6358138120e428eb…` con el manifest y los 46 mp3 anteriores, más huellas, el registro TTS previo y la huella del TXT);
  - scripts `unblock_tts.mjs`, `lab_mock.mjs` y `verify_manifest.mjs`;
  - ensayo `lab/`;
  - huellas `snapshot-post*.json`.
- **No se borró ni limpió nada.** Los 46 mp3 huérfanos (~220 MB; disco al 94 %, 6,5 G libres) solo se pueden retirar con una unidad explícita y autorización.

## I. Veredicto

**GREEN_PRODUCTIVO** para esta obra:
- manifest y audio regenerados desde el TXT UTF-8 vigente, validados por el contrato de publicación y por una verificación independiente;
- 0 × «�»;
- Inmersivo reproduce y sincroniza; Guiado reproduce el audio nuevo; Accesible normal;
- estado `listo`;
- sin cambios en otras obras, derechos ni datos económicos.

**Observaciones:**
- la voz del bloque 1 (Gemini) es distinta de la de los otros 44 (OpenAI);
- la prevención de subidas TXT mal codificadas sigue pendiente como unidad independiente.
