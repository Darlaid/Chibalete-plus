# MOOK-STUDIO-WORKREF-01: selector de obra en Studio

**Fecha:** 2026-10-31 · **Base:** `9938511` (CI 10/10) · **Producción:** sin cambios.
**Alcance:** permitir declarar en Studio la obra que evalúa una producción. Sin flags, reglas, XP ni PM. Cumple la condición de selector de [A7-A12-V3](GAMIFICACION_A7_A12_APROBACION_V3.md) §4; la regla editorial sigue pendiente.

## 1. Interfaz

Al editar un paso `PRODUCTION` en un borrador aparece **Obra que evalúa (opcional)**:

- **Sin obra:** muestra «Sin obra: experiencia general», y es el valor por defecto.
- **Seleccionar o Cambiar:** abre el `ContentPicker` existente, limitado a obras elegibles.
- **Quitar:** vuelve a experiencia general.
- **Estado:** «Obra elegible, ofrecida antes en la ruta», o el motivo por el que no.
- **Lista de pasos:** muestra «Evalúa: título», también en versiones publicadas.

No hay catálogo, permisos ni metadatos propios: se reutiliza `dataService.getContenidos` y se guarda el `contentId` en `resourceRef`, por el contrato de PRIV-01E.

## 2. Regla única

`utils/workEligibility.mjs` es puro y lo usan Studio, el servidor y `mookWorks.mjs`. La elegibilidad no cambia: `libro`, `libro_album` y `video` raíz disponibles y autónomos.

| Momento | Control | Error |
|---|---|---|
| Studio | Selector filtrado y `validate()` | Mensaje en el campo |
| Crear o guardar borrador | Obra existente y elegible | `RESOURCE_NOT_FOUND`, `WORK_NOT_ELIGIBLE` |
| Publicar | Obra ofrecida antes y aún elegible, sin caché | `WORK_NOT_IN_VERSION`, `WORK_NOT_ELIGIBLE` |

Un borrador con una obra no ofrecida todavía se guarda por API: el orden se exige al publicar. Las reglas para `READING`, `VIDEO`, `AUDIO` y `LEO` no cambian.

**Versiones publicadas:** siguen inmutables. El editor no se abre y la API responde 409; cambiar el vínculo exige una versión nueva.

**Sin cambio de datos:** un borrador existente con obra no elegible se rechaza al volver a guardarlo.

## 3. Pendiente

- **Regla editorial:** el selector solo ofrece lo que hoy cuenta como obra; capítulos, podcasts y artículos siguen fuera.
- **Verificación visual:** hecha en Chromium, ver §4.
- **Despliegue:** `utils/workEligibility.mjs` es nuevo; backend y frontend necesitan imagen nueva.

## 4. Verificación en navegador (MOOK-STUDIO-WORKREF-01-CLOSE)

Chromium real, `server.js` real y Vite dev con stores temporales y contenido sintético, a 1280, 768 y 360 px, con axe sobre selector y editor. Resultado: 47 ✓ y 5 ✗ antes de corregir, 52 ✓ y 0 ✗ después. Evidencia en [`evidence/mook-studio-workref-01/`](evidence/mook-studio-workref-01/).

**Límite:** sesión simulada. La cookie firmada no funciona en Windows nativo porque `secretFile` abre con `O_NOFOLLOW`, así que el arnés usa `SESSION_AUTH_MODE=off` e inyecta `x-user-id` en la red. No se probó el flujo con cookie ni la imagen Docker.

Defectos corregidos, todos en `ExperienceStudio.tsx`:

| Defecto | Corrección |
|---|---|
| El error de un guardado seguía visible tras elegir una obra válida | El mensaje se calcula con la obra actual |
| Al reordenar y guardar decía «Revisa los campos marcados» sin ningún campo visible | Se abre el primer paso con error |
| Tab salía del diálogo modal hacia la página | El foco queda dentro del selector |
| Quitar dejaba el foco en `body` | El foco pasa a Seleccionar |
| Contraste insuficiente en el tipo de obra y en «Sin obra» (axe) | `text-gray-500` |
| A 360 px, «Quitar» invadía el margen de la tarjeta | La fila admite salto de línea |

Pendiente menor, sin corregir: el tipo se muestra en crudo (`libro_album`), el selector ofrece obras aún no ofrecidas en la ruta (avisa después de elegir) y una versión publicada conserva «Guardar borrador», que solo guarda Información.
