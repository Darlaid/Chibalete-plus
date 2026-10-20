# CHP-MAINT-IMMERSIVE-TTS-2026-10 · IMM-TTS-03 — Reparación Cavafis → Odisea → Alicia

## Intento 1 — 2026-10-20 ~16:00Z: STOP en la precondición de proveedor (§0)

```
IMMERSIVE_TTS_REPAIR:   STOP
OPENAI_TTS_CAPACITY:    UNAVAILABLE
TTS_REPAIR_PROVIDER:    OPENAI_ONLY (no aplicado: no hubo generación)
GEMINI_TTS_CALLS:       ZERO
PRODUCTION_WRITES:      ZERO (sin backups, sin jobs, sin manifests, sin audio, sin progreso)
CAVAFIS / ODISEA / ALICIA: SIN CAMBIOS (siguen STALE_TTS / STRUCTURE_MISMATCH / STRUCTURE_MISMATCH)
```

### Preflight

- **Repo:** `chp/epub-mainfile-r1-release`, HEAD `76b6de5` (= origin, contiene `9c00d1c`), working tree limpio.
- **Producción:** api_1 = api_2 = `5bde24a6e4a6` (`9c00d1c`); front `7265576a7feb` (`cbc8e2d`); edge sin cambios. Todo healthy, 0 reinicios.
- **Disco:** 91 % (11.224.088.576 B libres).

### Comprobación de capacidad

- **Pasiva:** ninguna llamada TTS en los logs desde las 15:48Z, así que no hay evidencia reciente.
- **Llamada mínima controlada:** `audio.speech.create({ model: 'tts-1', voice: 'alloy', input: 'Hola.' })` desde api_1, con su propia clave, sin escribir a disco y sin tocar ningún título. Resultado: **`429 credit_balance_exhausted` / `insufficient_quota`**, «You have no credits remaining».
- **Consecuencia:** STOP según §0. No se ejecutaron backups, disk gate, snapshot, inventario ni jobs, porque la unidad no puede avanzar sin el proveedor.

### Nota para el siguiente intento (`OPENAI_ONLY`)

El job existente (`generateAudioForContent` → `runHybridTask('tts')`) usa Gemini como **fallback automático** cuando OpenAI falla (`AI_CONFIG.tts.fallback`). El endpoint `POST /api/content/:id/retry` corre dentro de la API, que tiene `GEMINI_API_KEY`, así que **no garantiza OPENAI_ONLY**. Si OpenAI fallara a mitad de un job, el resto de los chunks se generaría con Gemini.

Para cumplir §1 hace falta una de estas opciones, que requieren una decisión antes de ejecutar:

- **a) Job puntual fuera de la API:** misma imagen, mismo job (`generateAudioForContent`) en un contenedor efímero con montaje de uploads y **sin `GEMINI_API_KEY`**. El fallback falla, el breaker aborta y el contrato atómico no publica nada. El inconveniente es que el `ttsStatus` del registro no se actualiza, porque `onProgress` va por la API.
- **b) Cambio de código:** un flag de entorno que desactive el fallback de TTS, con su propia unidad y su propio rollout.
- **c) Aceptar Gemini como fallback:** contradice §1; no se recomienda.

**NEXT:** recargar créditos de OpenAI → elegir el mecanismo `OPENAI_ONLY` → repetir IMM-TTS-03.
