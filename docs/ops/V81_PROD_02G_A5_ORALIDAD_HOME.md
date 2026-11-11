# V8.1-PROD-02G: A5 en la grabación de respuestas orales (Home)

**Fecha:** 2026-11-10.
- **Código:** `6e128a0`. **Pruebas:** `ac90f42`.
- **Base:** `51ee0f4` (PROD-02F).
- **Sin despliegue, sin imágenes y sin XP.** No se han tocado datos, registros ni claves reales.

Cierra la observación de `V81_PROD_02F_A5_DICTADO_LEO.md` §6.

## 1. Ciclo de vida comprobado del audio (código, no inferencia)

| Fase | Qué hace el código | Dónde |
|---|---|---|
| Captación | `getUserMedia({ audio: true })` y `MediaRecorder` | `pages/Home.tsx` `startRecording` |
| Almacenamiento temporal | Los fragmentos se acumulan en memoria (`audioChunksRef`). Al detener se crea un `Blob` `audio/webm` y una URL local `blob:` que se reproduce en el modal | `onstop` |
| Entrega | `handleAssignmentSubmit` pasa **la cadena de la URL `blob:`**, no el audio, a `dataService.submitAssignment` | `pages/Home.tsx` |
| Persistencia | `submitAssignment` guarda esa cadena en `assignments` y `saveState` la escribe en `localStorage` (`chibalete_assignments`) | `services/dataService.ts` |
| Transmisión | **Ninguna.** `persistSubmissionToServer` se omite cuando el contenido empieza por `blob:`. No hay otro `fetch` con el audio | `services/dataService.ts` |
| Reconocimiento de voz | **Ninguno.** No se usa `SpeechRecognition` | — |
| Eliminación | El código no llama a `URL.revokeObjectURL`. El `Blob` vive en la memoria de la pestaña hasta que esta se recarga o se cierra. «Borrar y grabar de nuevo» solo suelta la referencia | — |
| Cierre de sesión | `logout` borra solo `chibalete_user_id`. La **cadena** `blob:` sigue en `localStorage`, pero tras recargar la pestaña ya no apunta a ningún audio | `context/AuthContext.tsx` |

**Conclusión:** el audio es exclusivamente local. Solo permanece en la memoria de la pestaña y nunca sale del dispositivo.

Lo que perdura es una URL `blob:` inservible. En el mismo navegador y en la misma pestaña, un mediador podría reproducirla mientras esa pestaña no se recargue.

## 2. Control A5 aplicado

Reutiliza `utils/voiceAuthorization.mjs`. No hay registro, endpoint ni pantalla nuevos.

| Situación | Resultado |
|---|---|
| A5 efectiva | Comportamiento anterior |
| A5 No, Pendiente, Revocada o sin verificar | `getUserMedia` no se llama y aparece un aviso en el propio modal |
| Fallo de red o del registro | Igual que sin A5: el micrófono no se abre |
| Revocación durante la grabación | Comprobación cada 10 s. Si falla, se detiene el `MediaRecorder`, se cierran las pistas, se vacían los fragmentos y no se genera el `Blob` |
| Página desmontada | Se detiene la vigilancia y se cierran las pistas del micrófono |
| Tareas de texto, foto o video | Sin cambios. La entrega no consulta A5 |

## 3. Pruebas

| Prueba | Resultado |
|---|---|
| `OptionalProcessingUi.structural` | **23/0** (8 comprobaciones nuevas de Home) |
| `voiceAuthorizationA5` | **25/0** |

`voiceAuthorizationA5` prueba la lógica común con datos sintéticos: A5 Sí, No, Pendiente y Revocada, fallo de red, registro alterado y revocación durante la captura.

**No regresión:**

| Verificación | Resultado |
|---|---|
| `typecheck:baseline` | Sin regresiones |
| `build` | Correcto |
| `test:v81` | En verde salvo `o8Check`, que falla por la ruta fija `/app`, igual que en la base |
| `test:a11y-reader` | 26/0 |
| `test:reading-runtime` | 18/0 |
| `test:evidence` | 41/0 |
| `test:zod-exposure` | 34/0 |
| `lint:evidence` | 0 violaciones |

## 4. Observación sin cambios

Si el lector cierra el modal (X) **mientras graba**, la grabación sigue en memoria hasta que vuelve a abrirlo y la detiene, o hasta que sale de Home, que ahora cierra el micrófono. Con A5 se mantiene este comportamiento anterior. Sin A5 ya no puede empezar a grabar.
