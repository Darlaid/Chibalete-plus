# V8.1-PROD-02F: A5 también en el dictado a Leo

**Fecha:** 2026-11-10.
- **Código:** `e83b068`. **Pruebas:** `15c8963`.
- **Sin despliegue, sin imágenes y sin XP.** No se han tocado datos, registros ni claves reales.

## 1. Problema (PROD-02E)

`components/Chatbot.tsx` abría el reconocimiento de voz del navegador para dictar preguntas a Leo **sin consultar A5**.

El navegador envía la voz a su servicio: en Chrome, a un servicio de Google en servidor (MDN). Por eso el dictado es la misma captación que cubre A5 (004 §6.3).

## 2. Usos de micrófono y reconocimiento de voz en el cliente

| Lugar | Qué hace | Estado |
|---|---|---|
| `components/Chatbot.tsx` (Leo: Layout, Bitácora, VisorAlbum, VisorTexto) | Dictado de preguntas con `SpeechRecognition` | **Protegido ahora con A5** |
| `components/OralityModal.tsx` (lectura en voz alta, Modo Guiado) | `getUserMedia` + `SpeechRecognition` | Ya exigía A5 al abrir el modal (PROD-02B). **Ahora además** vuelve a comprobarla antes de cada grabación y la vigila durante la grabación |
| `pages/Home.tsx` (entrega de tareas de tipo `audio`) | Graba con `MediaRecorder` **en el navegador**; no usa reconocimiento de voz. El contenido que se entrega es la URL local `blob:`, no el audio | **Fuera del alcance de A5 y de esta unidad**, sin cambios. Queda como observación (§6) |

## 3. Comportamiento

**Fuente única:** `utils/voiceAuthorization.mjs`. Consulta `GET /api/auth/me` sin caché y lee `optionalProcessing.voiceTranscription`. Ese valor lo calcula el servidor con `optionalProcessingFor` a partir del registro de decisiones. **No se crea ningún registro nuevo ni se guarda estado en el cliente.**

| Situación | Resultado |
|---|---|
| **A5 efectiva** (concedida y verificada, o del titular adulto) | Comportamiento anterior. El botón «Dictar a Leo» aparece y se dicta igual que antes |
| **A5 No, Pendiente, Revocada o sin verificar** | No aparece el micrófono y no se crea ningún `SpeechRecognition`. **La entrada escrita a Leo no cambia**: la gobierna A3 en el servidor |
| **Antes de cada captura** | Nueva consulta. Si falla (red, 401/503, JSON inválido o registro alterado), el micrófono no se abre |
| **Durante la captura** | Nueva consulta cada 10 s. Si la A5 se revoca o no puede comprobarse, se aborta el reconocimiento, se descarta lo que llegue después y desaparece el micrófono. En la oralidad se descarta el intento: no se puntúa ni se guarda |
| **Mediadores y administración** | Sin cambios: no son lectores (`optionalProcessingFor`) |

No se pide autorización al usuario en cada uso: la decisión es la registrada.

## 4. Pruebas

| Prueba | Resultado |
|---|---|
| **`voiceAuthorizationA5`** (nueva, en `test:v81`) | **25/0.** Encadena registro real → `optionalProcessingFor` → cuerpo de `/api/auth/me` → guarda del cliente |
| **`OptionalProcessingUi.structural`** | **15/0** (8 comprobaciones nuevas) |

**Qué cubre `voiceAuthorizationA5`:**
- A5 Sí, No, Pendiente, Revocada y sin verificar;
- A3 Sí con A5 No: Leo escrito sí, micrófono no;
- revocación durante la captura: corta una sola vez y no admite nuevas capturas;
- fallos de red, 401, JSON inválido, campo ausente o no booleano, y registro alterado;
- la vigilancia no solapa consultas y no actúa una vez detenida;
- el módulo no escribe en el registro ni usa almacenamiento.

**Qué cubre `OptionalProcessingUi.structural`:**
- la comprobación va antes de `new SpeechRecognition()` y de `start()`;
- vigilancia y descarte;
- micrófono oculto sin A5;
- entrada escrita independiente de A5;
- sin `confirm` ni `prompt`;
- en la oralidad, la consulta va antes de `getUserMedia`.

**No regresión:**

| Verificación | Resultado |
|---|---|
| `typecheck:baseline` | Sin errores nuevos (12 frente a 25 de la línea base) |
| `build` | Correcto |
| `test:v81`, A3/A5 HTTP | 32/0 |
| `test:a11y-reader` | 26/0 |
| `test:reading-runtime` (Modo Guiado) | 18/0 |
| `test:evidence` | 41/0 |
| `test:zod-exposure` | 34/0 |
| `test:identity`, `test:session-browser` y `test:b2c` | Verdes en contenedor Linux limpio |

**Fallos locales que no dependen de esta unidad:**
- `o8Check` falla en Windows y en un contenedor fuera de `/app` porque usa una ruta fija `/app/...`.
- `AulaVivaGroupAnalytics` falla en un árbol sin `.git`.
- En los dos casos falla igual sobre `16e310e`.

## 5. Texto propuesto para la ficha A5 del 004

Es una **propuesta**: no modifica los originales ni declara aprobado el documento. Está en la hoja 13 del paquete PROD-02A.

## 6. Observación fuera del alcance

`pages/Home.tsx` (tareas con respuesta de audio) graba con el micrófono sin A5. El audio no sale del navegador; solo se entrega una URL `blob:` sin contenido útil fuera de esa pestaña.

**No es reconocimiento de voz ni transmisión**, así que no corresponde a A5. Aun así, **es una captación de voz del menor** que el 004 no describe. Hay que decidir si se retira o si se documenta. No se modificó.
