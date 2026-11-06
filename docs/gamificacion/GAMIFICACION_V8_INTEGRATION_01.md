# V8-GAMIFICATION-INTEGRATION-01 — Integración y evaluación

**Fecha:** 2026-11-06. **Veredicto:** `GREEN_LOCAL_V8_INTEGRATION`. **Sin push, sin despliegue y sin activar nada en producción.**

**Base:** rama `chp/epub-mainfile-r1-release`. Producción: API `zlib-6d09d47` ×2, front `uxfix-b18f6f0`, G4 inerte (sin flags, sin clave, sin registro y sin `gamification.db`). La especificación B1 (lista de participantes) se descartó y no forma parte de esta rama.

## 1. Commits

Este documento va en `12a5050`. Los SHA son los publicados (V8-INTEGRATION-02A).

| Commit | Responsabilidad | Archivos |
|---|---|---|
| `40f40bd` | Historial de reconocimiento en «Mi progreso» | `server/gamification/progress.mjs`, `utils/myProgressView.mjs`, `pages/MiProgreso.tsx` y sus pruebas |
| `e8acc6c` | Coherencia entre réplicas de «Mi progreso» + prueba integral HTTP | `server/server.js` (5 líneas), `platformIntegration.test.mjs`, `package.json` |
| `77c6d38` | Prueba de escala de plataforma | `platformScale.test.mjs`, `package.json` |

## 2. Estado de cada componente

| Componente | Estado | Evidencia |
|---|---|---|
| Motor XP: `recordFact` y `recordWorkRecognition`; idempotencia por clave HMAC del sujeto | **Implementado y probado** | `ledgerCore`, `workRecognition`, `platformIntegration` [2] [7] |
| Reglas A7-A12-V3: 30 (10 + 20), 20, 0; techo de 50 por obra y ciclo; PM = 0 | **Implementado y probado** | `xpPilotEmission` [2]; `platformScale` [1] |
| Ganchos MOOK (revisión, recorrido) y reconciliadores síncrono y por lotes | **Implementado y probado**; cableado en `server.js:2657`, `:3173` y `:12974` | `mookHooksHttp`, `mookReconcileBatched`, `platformIntegration` [11] |
| Exclusión con restauración y reaplicación | **Implementado y probado** | `exclusion`, PRIV-C7, `platformIntegration` [6] |
| «Mi progreso»: XP, nivel, logros, obras | **Implementado y probado** | `myProgress`, `myProgressHttp`, `MiProgreso` |
| Historial: qué, cuándo y por qué | **Faltaba → implementado** (`40f40bd`) | `myProgress` [4b]; `MiProgreso`; `platformIntegration` [9] |
| Coherencia entre réplicas del estado de las entregas en «Mi progreso» | **Defecto → corregido** (`e8acc6c`): caché de 30 s de `mook_db.json` por réplica | `platformIntegration` [1] [2]; control negativo 52/55 sin el arreglo |
| Niveles Semilla y Brote | **Implementado y probado** (definitivos) | `progress`, `myProgress` [4] |
| Raíz, Tallo, Rama y Árbol | **Desconectado a propósito:** provisionales, sin aprobar (G4_UX_01 §350) | `progress.mjs` `PROPOSED_LEVELS` |
| Logros del catálogo inicial | Implementado y probado. El umbral 5 de «lector-reflexivo» es provisional | `progress.mjs:55` |
| Agregado del mediador (k ≥ 5, sin datos individuales) | **Implementado y probado** | `groupRecognitionHttp`, `platformIntegration` [8], `platformScale` [3] |
| Alcance de revisión del mediador (grupo e institución) | **Implementado y probado** | `mookReviewReplicaAuthz`, `platformIntegration` [3] |
| `mook_review` como fuente de XP | **Desconectado en producción** (`XP_LOCKED_SOURCES`, `policy.mjs:36`). Se libera solo en laboratorio con el arnés | `xpPilotEmission` [8] |
| Rectificación de un XP (`void`) | Solo esquema; nada la escribe | PRIV-6 R16 |
| XP por lectura, tiempo o clics (`reading_completion`), validación offline | **Fuera de alcance por doctrina:** bloqueados | `policy.mjs:35-36` |
| Acceso por `ORG_ALL` / `ORG_CATALOG` | **Fuera de alcance por doctrina:** no verificable para el lector | G4-05A-2 §1 |
| PM y canjes | Fuera de alcance | Orden de la unidad |

**Vías de acceso:** `GROUP_ASSIGNMENT` no es una brecha: en `server.js` es código muerto (`assignmentsArr` siempre vacío).

**Descartado como brecha:** la navegación a «Mi progreso» ya existe en el perfil propio (`Perfil.tsx`) y tras una entrega aprobada (`Experiencias.tsx`).

## 3. Recorridos comprobados

**`platformIntegration.test.mjs`:** dos réplicas reales de `server.js`, sesiones firmadas en modo `enforce` y stores temporales. Resultado: 55/55 en Linux, dentro de la imagen de la API.

| # | Recorrido | Resultado |
|---|---|---|
| 1 | Lector individual con regla propia; revisa administración | 30 XP; un mediador de colegio recibe 403 |
| 2 | Lector de colegio: 1.ª aprobación, ajustes, reenvío y 2.ª aprobación | 30 → 50, obra completa. Reintento de entrega → 200, misma evidencia. Doble aprobación sin XP extra; un hecho por evidencia |
| 3 | Dos colegios; mediadores de otro colegio o de otro grupo del mismo colegio | 403; cada mediador aprueba a los suyos |
| 4 | Varias obras y experiencias; experiencia sin producción | 80 XP en dos obras con techo propio; la ruta sin producción no deja hecho |
| 5 | Obra sin acceso; lector sin reglas | Aprobada sin XP, sin hecho y sin actividades que sumen |
| 6 | Cuenta excluida | 0 XP; vista idéntica a la de alguien sin actividad; la revisión pedagógica sigue |
| 7 | Aprobaciones concurrentes en las dos réplicas | Exactamente 30 XP y un hecho por evidencia |
| 8 | Agregado del mediador | 4 de 6 (la excluida no cuenta); sin XP, niveles ni nombres; otro mediador recibe 403 |
| 9 | Historial y privacidad | Cinco actos con día, obra y acto; sin claves, ids ni revisores; el sujeto es siempre la sesión |
| 10 | XP apagado / gamificación apagada | `{enabled:false}` / 404; la revisión funciona; ninguna escritura |
| 11 | Dos reconciliadores por lotes concurrentes | Recogen lo pendiente una sola vez; ledger íntegro; sin PM |
| 12 | Reinicio de una réplica | Mismo XP e historial |

**Accesibilidad y móvil** (`pages/__tests__/MiProgreso.test.mjs`, render real):
- Cinco secciones con `h2` enlazado.
- Historial como lista ordenada con `<time>`.
- Barras con `role=progressbar` y su valor en texto.
- `details/summary` nativo, operable con teclado.
- Objetivos táctiles de 44 px y foco visible.
- Una sola columna; sin animaciones, rankings ni comparaciones.

No se hizo una prueba visual en navegador.

## 4. Escala (`platformScale.test.mjs`, sintética)

**Escenario:** 3 colegios × 4 grupos × 25 lectores = 300 lectores y 12 mediadores. Hay 1200 evidencias aprobadas, 24 lectores excluidos y 12 sin acceso a una obra.

| Medida | Windows | Linux (imagen API) |
|---|---|---|
| Primer barrido por lotes (816 hechos, 21 720 XP) | 3,9 s | 6,7 s |
| Segundo barrido sin novedades | 0,86 s | 1,1 s |
| «Mi progreso», p50 / p95 | 3,9 / 6,6 ms | 3,6 / 5,7 ms |
| 4 réplicas × 3 barridos a la vez | 6,0 s, mismo resultado y sin duplicados | 9,3 s, ídem |

El barrido por lotes cede el bucle de eventos, así que no bloquea la réplica. **No hace falta infraestructura nueva.**

## 5. Validación

| Suite | Windows | Linux |
|---|---|---|
| `test:gamification-core` | Todo verde salvo `groupRecognitionHttp` [8] (CRLF de la copia de trabajo, conocido); `platformIntegration` hace SKIP (POSIX) | 22/25; los 3 restantes por entorno del contenedor: `ops/` no montado y CRLF |
| `platformIntegration` | SKIP | **55/55** |
| `platformScale` | 17/17 | 17/17 |
| `test:gamification-g0` (incluye MiProgreso 60/60) | verde | — |
| `test:mook` | verde (capas POSIX omitidas, como siempre) | — |
| `npm run build` | correcto | — |
| `tsc --noEmit` | 12 errores **preexistentes**, ninguno en archivos tocados | — |

## 6. Privacidad, autorización e integridad

- El historial solo expone el día, la obra que la persona ya ve, el acto y el XP. La prueba de contrato se amplió a propósito (`history`, `day`, `act`).
- Sin flags, `/api/me/progress` responde 404 **antes** de leer MOOK (`mookSource.mjs:132`): producción no cambia.
- No cambian los permisos de mediadores, el acceso a libros ni a MOOK, la autenticación ni el esquema de la base.
- No se añaden rankings ni métricas individuales para mediadores.
- No se tocaron datos reales: guardas de `testMode.mjs` y huellas de `data/` y `data-critical/` intactas.

## 7. Lo que falta para desplegar y activar

**Técnico:**
1. Publicar los commits y pasar la CI completa. `platformIntegration` corre en `identity-preflight` (Linux).
2. Nuevas imágenes API y front. El cambio es inerte sin flags; cada imagen se despliega en su propia ventana.
3. Clave de sujeto, volumen y copia del registro de exclusiones (P1–P3), cada uno con su orden.
4. Release que saque `mook_review` de `XP_LOCKED_SOURCES`.
5. Reglas con el `approvalRef` de Dirección, `GAMIFICATION_MOOK_SINCE` y, después, publicar experiencias con producciones.

**Jurídico (no lo resuelve Ingeniería):**
- Con la activación general, participa toda la población con acceso explícito a obras con experiencia. Hace falta una base jurídica y un procedimiento de participación válidos **para toda esa población** (PRIV-6 D1–D9 y L1–L5).
- **Brecha clasificada:** si Legal exige autorización previa individual, el sistema actual no puede aplicarla sin excluir de forma irreversible. Con B1 retirado, eso queda como **bloqueo jurídico-técnico**. No se improvisa una solución.

**Producto:** un lector individual sin grupo solo puede ser revisado por administración, porque no tiene mediador. Es una decisión de producto, no un defecto.
