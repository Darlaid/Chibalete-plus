# V8.1-PROD-02B: correspondencia efectiva de A3, A4 y A5 (004)

**Fecha:** 2026-11-10.
- **Base:** `92c9a9b`, CI 3/3.
- **Sin push, sin imágenes y sin despliegue.** No se han tocado XP, WooCommerce, claves, registros productivos ni datos reales. **El PDF del 004 no se modifica.**

## 1. Verificación (lo que hace hoy el código)

### A3: Leo e IA

- **Rutas** (`server/server.js`):
  - con IA: `POST /api/leo/ask`, `/chat` y `/recap`;
  - de almacenamiento: `GET` y `POST /api/leo/memory/:userId/:contentId`.
  - Antes de este cambio dependían de la sesión, el derecho B2C y los derechos editoriales (`ai_leo`). `/recap` ni siquiera tenía estos últimos. Ninguna miraba una decisión del lector.
- **Datos enviados:** la pregunta o el mensaje, el fragmento de la obra y las señales de lectura (nivel, etapa y memoria de sesión acotada por `leoContextBuilder`).
- **Proveedores** (`aiEngine.AI_CONFIG`):
  - `text_light`: Gemini, con OpenAI de respaldo;
  - `chat`: OpenAI, con Gemini de respaldo.
- **Qué se guarda:**
  - `leo_memory_db.json` y `leo_profile_db.json` (memoria y contadores);
  - `leo_interactions_db.json` (metadatos);
  - `leo_evidence_db.json` (evidencia estructurada, **sin texto literal**);
  - eventos del backbone.
- **IA directa desde el navegador** (`services/geminiService.ts`): solo con `VITE_GEMINI_API_KEY` en el build. **Ni la imagen de producción (`unifiedxp-13b8045`) ni la candidata contienen una clave:** sin ella, esas funciones devuelven un texto de respaldo y no llaman al proveedor. El único uso en una pantalla es `analizarProgresoPedagogico`, en Aula Viva (mediador).

### A4: LU y lectura sin conexión

- **En la web:**
  - el libro se guarda en IndexedDB (`services/offlineService.ts`): contenido editorial, no datos del lector;
  - el progreso pendiente se guarda en memoria y localStorage y se envía después por la **misma** ruta de progreso;
  - el servidor guarda `offline_book_assignments` (qué libro, versión y fechas).
  - **No hay ningún tratamiento opcional adicional:** queda comprendido en A1.
- **Chibalete LU:** es una aplicación Android (APK) que **no está en el repositorio**. Solo existen su página de descarga y `/api/lu/version`. Su tratamiento interno queda **por verificar**.

### A5: micrófono, voz, imágenes y video

- **`components/OralityModal.tsx`** (modo Guiado):
  - usa `getUserMedia` y `SpeechRecognition` del navegador. Según el propio código, este último «requiere conexión a internet en este navegador», así que el **navegador envía la voz a su servicio**;
  - `MediaRecorder` mantiene el audio en memoria; según el comentario, «no se envía a ningún sitio»;
  - el intento se guarda en `localStorage` (puntuación, palabras y duración; **ni voz ni transcripción**);
  - no hay ninguna llamada a la API de Chibalete.
- **`pages/Home.tsx`:** graba para reproducir en el propio navegador (URL local del blob). Actividad local, sin transmisión.
- **Imágenes y video del lector:** **ninguna** ruta permite que un lector suba o capture imágenes o video. Las subidas son de administración (`/api/upload`) o de la máquina (`/api/leo/ingest`, con `requireAuth` por secreto de administración en POST).
- **Permiso técnico ≠ autorización:** el permiso de micrófono del navegador no sustituye la A5.

## 2. Corrección (mismo registro, misma pantalla; sin otro sistema)

- **Registro:** `DECISION_KINDS` admite **A3** y **A5**. A4 no se añade, porque no hay tratamiento opcional propio.
- **`utils/acceptanceDocuments.mjs`:** las opciones A3 y A5 son `yes/no` **opcionales**. Sin respuesta quedan pendientes y **no se presumen** por A1, A2, la compra ni la matrícula.
- **`acceptance.mjs`:**
  - registra A3/A5 del lector con la misma calidad que A1: titular adulto `self_authenticated`; representante `unverified` hasta que VER lo verifique;
  - `optionalProcessingFor(user, gate)`: para un lector exige la decisión **efectiva**; para mediadores y administración no aplica.
- **`server.js`:**
  - **`requireLeoAuthorization`** en las cinco rutas de Leo para lectores. Va **después** de las guardias existentes (derecho B2C y derechos editoriales), que conservan sus códigos (`ENTITLEMENT_EXPIRED`…), y **antes** del handler. Sin A3 efectiva ⇒ 403 `A3_REQUIRED`, sin llamar al proveedor ni guardar nada. Registro no verificable ⇒ 503 `leo_authorization_unavailable`;
  - `GET /api/auth/me` incluye `optionalProcessing`. Con el registro no verificable, todo es `false`.
- **Front:**
  - ActivarCuenta pregunta A3 y A5 como opcionales, sin opción marcada;
  - `LeoCompanion` muestra un mensaje claro ante `A3_REQUIRED`;
  - `OralityModal` consulta `optionalProcessing.voiceTranscription` y, sin A5 (o si no puede comprobarlo), no abre el micrófono.
  - La grabación local de `Home` no se toca, porque no transmite nada.

**Límite de la A5:** el reconocimiento de voz lo ejecuta el navegador, así que el servidor **no puede impedirlo técnicamente** si alguien modifica el cliente. La decisión la toma el servidor; el cliente oficial la respeta y no hay ningún dato que Chibalete reciba.

## 3. Pruebas

| Suite | Resultado | Qué comprueba |
|---|---|---|
| `optionalProcessingHttp` (nueva, dos réplicas, registro real) | 32/0 | Ver lista siguiente |
| `OptionalProcessingUi.structural` (nueva) | 7/0 | ActivarCuenta sin opciones premarcadas y con envío solo si se decide; oralidad con la comprobación antes de `getUserMedia` y fallo cerrado; Leo con mensaje ante `A3_REQUIRED` |
| `test:b2c` (Linux, como root) | 77/0 | El comprador adulto activa con A3 = Sí y los lectores de colegio de la siembra tienen A3 sintética. Sin eso, Leo respondía 403 donde la prueba esperaba llegar a la lógica |
| `leoMemoryOwnership` | 30/0 (Windows), 72/0 (Linux) | La siembra concede A3 sintética (`grantOptional`). Sin ella, el fallo cerrado esperado (503) |
| `acceptanceDecisions`, `acceptInviteDecisionsHttp`, `ActivarCuentaDecisions`, `a2Registry` | 42, 31, 26, 34 | Sin cambios |

**`optionalProcessingHttp`:**
- A3/A5 opcionales y nunca presumidas; un valor inválido se rechaza; un mediador no las decide.
- A3 negada, pendiente, revocada o sin verificar ⇒ 403 en las cinco rutas, sin escribir nada.
- Mediador y administración sin cambios.
- `/api/auth/me` correcto.
- Revocación inmediata en las dos réplicas; registro alterado ⇒ 503 y `false`.
- Lectura, progreso, modo sin conexión y estado individual del mediador iguales con y sin A3.

**`leoMediatorScope`:** su aserción estructural del import ya fallaba antes (desde `8de5e2a`) y no está en la CI.

## 4. Efecto sobre los usuarios actuales al desplegar

- **Ningún lector actual tiene A3 ni A5 registradas** ⇒ **Leo y la lectura en voz alta con transcripción dejan de estar disponibles para los lectores** hasta registrar su A3/A5:
  - en la activación, si es titular adulto;
  - o en la ficha C.1, verificada por VER.
- La lectura, el modo sin conexión, el progreso y las funciones de mediación no cambian.
- **DIR-V81-03:** conciliar (cargar A3/A5 de C.1) antes de desplegar.

## 5. Condiciones

1. **Dirección y Legal:** ajustar el 004 §6.1–§6.3 según la propuesta del paquete PROD-02A, hoja 09. Mantenerlo como 1.0 si se aprueba así.
2. **Verificar:** los proveedores (OpenAI, Google) y su país; el servicio de reconocimiento de voz del navegador; y el funcionamiento interno de **Chibalete LU**.
3. **Builds del front:** no deben llevar `VITE_GEMINI_API_KEY`, porque activaría IA directa desde el navegador sin pasar por A3. Hoy no la llevan.
4. **Publicar** estos commits y **reconstruir las dos imágenes** desde el commit final.
