# Compatibilidad de modelos Gemini — CHP-AI-RUNTIME-MODEL-COMPAT-01A

**Estado:** implementado y validado **en local**. No desplegado.
**Rama:** `chp/ai-runtime-model-compat-01a` (desde `e45775a`).
**Producción al cierre:** `chibalete/api:83489ce`, sin tocar.

---

## 1. Causa raíz

Google **retiró `gemini-1.5-flash`**. No está depreciado: desapareció.

- `ModelService.ListModels` ya no lo devuelve para la clave productiva;
- `generateContent` responde `404 NOT_FOUND`.

`server/aiEngine.js` lo usaba en tres de las cuatro tareas:

| Tarea | Papel | Efecto del retiro |
|---|---|---|
| `text_light` | primary | 404 → fallback OpenAI |
| `chat` | fallback | 404 cuando OpenAI falla |
| `chat_visual` | primary | 404 → fallback OpenAI, sin imagen |

Y en dos endpoints admin de `server/server.js` que llaman a Gemini directamente
(análisis de regiones de álbum y sugerencia de etiquetas).

El fallback existía precisamente para esto, pero **también estaba caído**: la
clave OpenAI nueva autentica y devuelve `429 credit_balance_exhausted` en toda
inferencia porque la organización no tiene saldo. Los dos caminos rotos a la vez
dejaron el texto de Leo devolviendo HTTP 500 con respuesta enlatada.

TTS no se vio afectado: usa `gemini-2.5-flash-preview-tts`, que sigue vivo, y por
eso `/api/tts` es hoy lo único operativo del stack de IA.

## 2. Modelo seleccionado

**`gemini-3.6-flash`**, fijado como `GEMINI_TEXT_MODEL_DEFAULT` en `aiEngine.js`.

Evidencia con la clave productiva, SDK `@google/genai` **1.31.0** empaquetado en
la imagen, `apiVersion: 'v1beta'`, desde dentro del contenedor:

| Comprobación | Resultado |
|---|---|
| `models.list` | 58 modelos; `gemini-3.6-flash` presente |
| acciones soportadas | `generateContent`, `countTokens`, `createCachedContent`, `batchGenerateContent` |
| `gemini-1.5-flash` en la lista | **ausente** |
| texto (`contents` string) | HTTP 200, `COMPAT_TEXT_OK`, ~1,3 s, `finishReason: STOP` |
| chat (historial + `systemInstruction`) | HTTP 200, `COMPAT_CHAT_OK`, ~1,4 s |
| visión (PNG sintético inline) | HTTP 200, `rojo azul`, ~2,1 s — lee píxeles de verdad |
| `responseMimeType: application/json` | HTTP 200, `{"ok":true}` |
| control negativo `gemini-1.5-flash` | **404 NOT_FOUND** |

La imagen de la prueba visual se genera en el propio script (64×64, mitad roja y
mitad azul). No se usó contenido editorial, ni conversaciones, ni datos de
menores.

### Por qué no otros candidatos

- **`gemini-flash-latest`**: un alias mueve el modelo bajo los pies del runtime
  sin que ningún despliegue lo registre. Esta unidad existe por un modelo que
  cambió sin avisar; adoptar un alias sería institucionalizar el problema.
  El resolvedor lo **rechaza explícitamente**.
- **`gemini-2.5-flash`**: funciona, pero es una generación anterior. Adoptarlo
  sería crear la misma deuda que acabamos de pagar.
- **`gemini-2.0-flash`**: ya retirado (404), igual que la familia 1.5.
- **Modelos `preview`**: fuera para texto, por contrato.

## 3. Compatibilidad del SDK

**No se actualizó ninguna dependencia.** `@google/genai` 1.31.0 —el que va en la
imagen de producción— habla con `gemini-3.6-flash` sin cambios: mismo
`ai.models.generateContent`, mismo `config.systemInstruction`, mismo
`inlineData`, misma extracción por `response.text`, mismo `finishReason`,
mismo `usageMetadata`. No hizo falta migrar a Interactions API.

## 4. Contrato de configuración

```
GEMINI_TEXT_MODEL   (opcional)   default: gemini-3.6-flash
```

Reglas de `resolveGeminiTextModel()`:

| Entrada | Resultado | Motivo |
|---|---|---|
| ausente / no-string | default | compatibilidad con configuración ausente |
| `""` / espacios | default | `vacio` |
| `*-latest` | default | `alias_latest_prohibido` |
| modelo `*-tts-*` | default | `modelo_tts_no_es_modelo_textual` |
| familia `gemini-1.5-*` | default | `modelo_retirado` |
| identificador con forma rara | default | `identificador_no_valido` |
| cualquier otro | se acepta | override válido |

Un override inválido **no tumba el proceso**: se registra el motivo y se usa el
default. Reventar en el arranque por una errata en una variable convertiría un
typo en un crashloop de producción, y el default siempre es un modelo válido.

Al arrancar se emite una única línea con el identificador del modelo y su
procedencia. Nunca claves.

`GEMINI_TTS_MODEL` se declara como constante **solo** para poder rechazarlo como
modelo textual. Su valor y su comportamiento no cambian.

## 5. Tareas afectadas y no afectadas

**Cambian de modelo** (`gemini-1.5-flash` → `gemini-3.6-flash`):
`text_light` primary, `chat` fallback, `chat_visual` primary, y los dos
endpoints admin de `server.js`.

**No cambian**: OpenAI `gpt-4o-mini`, OpenAI `tts-1`, el modelo TTS de Gemini, el
orden primary/fallback, `maxRetries`, `timeoutMs`, `breakerCooldownMs`, el
circuit-breaker, los prompts pedagógicos, las políticas de moderación, los
payloads, la respuesta pública, las cabeceras y el logging.

## 6. Validación

Integración real y aislada, ejecutada dentro del contenedor contra Gemini
productivo con el **código nuevo** (copia efímera; el servidor vivo siguió con el
código de la imagen, y la copia se borró al terminar):

| Camino | Resultado |
|---|---|
| `text_light` | `gemini-3.6-flash`, `COMPAT_TEXT_OK`, 1,9 s |
| `chat` | OpenAI 429 → **fallback Gemini 3.6**, `COMPAT_CHAT_OK`, 4,4 s |
| `chat_visual` | `gemini-3.6-flash` con imagen, `rojo azul`, 1,6 s |
| `tts` | `gemini-2.5-flash-preview-tts`, WAV RIFF 79 290 bytes — **sin cambio** |

Más 92 aserciones con dobles en `server/__test__/geminiModelCompat.test.js`, sin
red: resolución del modelo, cableado, TTS intacto, invariantes del breaker,
rutas por tarea, modos de fallo (404, 429, safety block, timeout, respuesta
vacía, ambos proveedores caídos) y ausencia de secretos en logs.

## 7. Rollback

El cambio es un identificador de modelo. Tres niveles, de menor a mayor:

1. **Sin desplegar nada**: `GEMINI_TEXT_MODEL=<otro modelo válido>` en el `.env`
   de producción + recreación rolling. El cliente Gemini se cachea por proceso,
   así que la recreación es obligatoria (igual que en la rotación de claves).
2. **Volver al código anterior**: `chibalete/api:83489ce` sigue siendo la imagen
   productiva mientras esta rama no se despliegue.
3. Volver a `gemini-1.5-flash` **no es un rollback**: el modelo ya no existe.

## 8. Deuda abierta

- **TTS sigue en un modelo `preview`** (`gemini-2.5-flash-preview-tts`). Es el
  único camino de audio vivo hoy; migrarlo es una unidad aparte y merece la
  misma sonda de capacidad que esta.
- **OpenAI sin saldo.** Mientras siga en 429, Gemini no tiene red de seguridad:
  cualquier retiro futuro deja el texto caído otra vez. Es riesgo de negocio, no
  de código.
- **`services/geminiService.ts` (frontend)** apunta a `gemini-2.0-flash`, que
  también está retirado. Fuera del alcance de esta unidad (prohibido tocar
  frontend), pero es una avería latente del mismo tipo.
- **`AI_CONFIG.timeoutMs` está declarado y no se consume** en ninguna llamada.
  Es un hallazgo previo a esta unidad; se deja tal cual y se documenta.
- **Falta vigilancia de ciclo de vida de modelos.** Esta avería se descubrió
  porque un usuario reportó que Leo no respondía. Un chequeo periódico de
  `models.list` contra los modelos configurados habría avisado con semanas de
  antelación. Candidato natural para el agente de auditoría del VPS.

## 9. Política

1. **Nunca alias `-latest`** en un modelo productivo. Ningún despliegue registra
   un cambio que ocurre en el servidor del proveedor.
2. **Un solo sitio** define el modelo textual: `aiEngine.js`. Los endpoints que
   llaman a Gemini directamente lo importan de ahí.
3. **Modelo nuevo = sonda de capacidad primero**: `models.list`, texto, visión y
   el formato exacto que usa el runtime, con el SDK empaquetado y la clave real.
4. **El modelo TTS y el modelo textual no son intercambiables.** El resolvedor lo
   impide por contrato.
