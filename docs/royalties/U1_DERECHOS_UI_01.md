# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / U1 · DERECHOS-UI-01 · Interfaz de derechos por obra

**Fecha:** 2026-10-27 · **Baseline:** `bce38cd` (= remoto, CI 9/9 en verde) · **Ruta crítica:** `OPERACION_01_RUTA_CRITICA.md` · **Plan:** `PLAN_GENERAL_V1_1.md` (F5-A «Obras y Derechos», adelantada)
**Veredicto:** **GREEN_LOCAL** (CI pendiente del push; se anota en el seguimiento). Solo frontend sobre el contrato F2-A existente: sin cambios de servidor, migraciones, fórmulas, accesos ni datos. Sin despliegue.

## A. Baseline y CI

- `bce38cd` igual al remoto. CI en verde: 9/9 en `bce38cd` y 10/10 en `7cd6255` (API pública de check-runs).
- Contrato inspeccionado en `server/server.js` y `server/royalties/rightsStore.mjs`:
  - `GET /api/admin/rights/:contentId`: editorial responsable, modo de cumplimiento, versión en efecto e historial.
  - `GET …/eligibility`: veredicto y motivos.
  - `POST …/versions`: alta append-only con `validateRightsInput` y auditoría `rights_version_create`.
  - Las tres rutas exigen `requireAdminAccess`.

## B. Ubicación

- **Página nueva `/admin/derechos/:contentId`** (`pages/AdminDerechos.tsx`). La ruta está declarada `admin` en `config/routePermissions.ts` y protegida en `App.tsx` con `getRouteAccess`.
- **Entrada:** botón «Derechos» en cada **libro** (`libro`, `libro_album`) del catálogo administrativo (`/subir-contenido`, ruta ya restringida a administración). Los recursos no lo muestran, porque no son liquidables en V1.

## C. Campos y endpoints reutilizados

| Bloque | Contenido |
|---|---|
| Obra | Título, identificador, autor, tipo (marca «no liquidable en V1»), estado en catálogo, editorial responsable y sello |
| Elegibilidad (hoy) | Veredicto del servidor con **todos** sus motivos en lenguaje de administración, y modo de cumplimiento (`off`: «se registran, pero aún no restringen el acceso») |
| Historial | Todas las versiones, de la más reciente a la primera. Distintivos «En efecto», «Programada» (fecha de efecto futura) y «Vigencia vencida». Para cada versión: Acta (referencia, firma, editorial), vigencia, los tres estados, alfa, minutos, matriz y los 7 permisos. También fecha de efecto y de registro (hora de Bogotá) y autor del registro |
| Nueva versión | Referencia del Acta, firma, inicio y fin de vigencia, fecha de efecto (hora de Colombia → UTC), situación jurídica, estado económico, clase de liquidación, alfa (%), minutos esperados, matriz de titulares (editoriales **y terceros** activos, en %, con total en vivo), los 7 permisos (Autorizado / No autorizado, sin valor inicial) y notas |
| Partir de una versión | Botón explícito «Nueva versión a partir de la versión en efecto». Copia todo **salvo la fecha de efecto**, que hay que indicar |

Cliente: `dataService.getRights`, `getRightsEligibility` y `createRightsVersion` (solo GET y POST; el error conserva el `code` del servidor). Tipos `RightsVersion`, `RightsRegistry` y `RightsEligibility` en `types/index.ts`. Núcleo puro `utils/rightsForm.mjs`.

## D. Validaciones y permisos

- **Manda el servidor.** El cliente comprueba antes lo que el administrador puede corregir y no envía nada imposible:
  - matriz que no suma 100 %, con el total mostrado;
  - titular repetido, inactivo o sin elegir;
  - porcentajes con más de 2 decimales;
  - Acta, firma, inicio o fecha de efecto ausentes; fin de vigencia anterior al inicio;
  - permisos sin decidir, citados por nombre;
  - reglas de «Liquidable»: tipo libro, matriz, alfa, minutos y lectura autorizada;
  - obra sin editorial responsable o con editorial inactiva.
- Si aun así el servidor rechaza, se muestra el texto de su `code`. Los 27 códigos del validador tienen texto, y una prueba lo verifica contra la fuente.
- El resumen de errores **recibe el foco**: se ve y se anuncia aunque esté fuera de la vista.
- **Nada se asigna solo:** formulario vacío, matriz vacía y permisos sin decidir. La editorial responsable **no** entra en la matriz salvo que el administrador la añada (aviso en el formulario).
- **Guardar ≠ activar:** el aviso tras registrar remite al veredicto. Una versión con estado económico «Pendiente» queda registrada y no elegible (`ECONOMIC_PENDING`).
- **Append-only:** no hay edición ni borrado. Cada cambio es una versión nueva y las anteriores no cambian.
- **Acceso:** página con guarda de rol y ruta `admin`. La API ya exigía administración: verificado de nuevo en navegador (403 para mediación y lectura).

## E. Pruebas y navegador

**Automáticas:**

- `utils/__tests__/rightsForm.test.mjs` (**50/0**, añadida a `test:royalties`). Contrasta los cuerpos del formulario con el **validador real** (`validateRightsInput`) y con `economicEligibility`. Casos:
  - editorial interna y externa;
  - tres titulares con decimales;
  - 60/40 aceptado y 60/30 rechazado por el cliente y por el servidor (`shares_not_100`);
  - titular repetido o inactivo;
  - `publisher_mismatch`;
  - Acta incompleta;
  - permiso sin decidir;
  - liquidable sin lectura (`reading_required`);
  - auxiliar registrable pero no elegible;
  - vigencia vencida (`OUT_OF_VALIDITY`);
  - «Pendiente» registrable pero no elegible;
  - v2 programada que entra en efecto sin alterar la v1;
  - cobertura de motivos y códigos;
  - estructura (solo administración, solo GET/POST, ruta, enlace solo en libros, ninguna otra página usa los datos).
- `test:royalties`: rc = 0 (`rightsStore` 77, `rightsHttp` 50, `AdminEditoriales.structural` 32, …). Las suites POSIX se omiten en Windows, como siempre, y no las toca esta unidad.
- Estructurales que leen los archivos tocados (`SubirContenidoEpub`, `SubirContenidoEpubAdmin`, `ContentExtractionDeterrence`, `BibliotecaLibraryLayers`, `ChibaleteLUPublic`, `VisorInmersivoV2`, `useReducedMotion`, `chibaleteEpubReader`, `contentCreationDefaults`): todos en verde.
- `typecheck:baseline`: sin regresiones. `build`: verde (`AdminDerechos` en su propio chunk, ≈ 26 kB).

**Navegador real aislado** (Chrome contra el contenedor nuevo `chp-u1lab`):
- Misma imagen `chp-a11ylab:a9ab21a`, con el código de HEAD más U1; sin `.env`, `data/` ni `data-critical/`.
- Solo `127.0.0.1:5174`; ingesta y cumplimiento `off`.
- Datos 100 % sintéticos: administración y mediación `@u1-lab.test`, lectores `@a11y-lab.test`, editorial externa «Editorial Externa (LAB)» con sello, tercero «Autora Sintética (LAB)», `lab-largo` → Chibalete Editores, `lab-corto` y `lab-epub` → externa.
- El laboratorio de ACCESS-04 (`chp-a11ylab-a9ab21a`) no se tocó.

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Catálogo administrativo → «Derechos» en los 3 libros | ✓ |
| 2 | Obra sin régimen: externa como responsable, «No elegible: no hay ninguna versión», historial vacío | ✓ |
| 3 | Matriz 60/30 | No se envía; «Las participaciones suman 90 %…», total en rojo |
| 4 | Corregida a 60/40 con estado económico «Pendiente» | v1 registrada; **No elegible: estado económico pendiente** |
| 5 | «Nueva versión a partir de la versión en efecto» | Copia todo salvo la fecha de efecto. Con «Activa» → v2 en efecto, **Elegible**; v1 intacta en el historial |
| 6 | API real con sesión de administración (`lab-largo`, editorial interna) | `publisher_mismatch`, `shares_not_100` y `reading_required` → 400; Acta 2025 vencida → 201 y elegibilidad `OUT_OF_VALIDITY` |
| 7 | Mediación | `/admin/derechos/…` redirige al inicio; GET, elegibilidad y POST → **403** |
| 8 | Lectura | Redirige; GET, elegibilidad y POST → **403**; `my-catalog`, `/api/content` y el preflight de `lab-corto` **sin ningún dato contractual** |

**Defectos encontrados en el navegador y corregidos antes de cerrar:**
1. El resumen de errores quedaba fuera de la vista: ahora recibe el foco.
2. Al pasar de una obra a otra se arrastraba el aviso de la anterior: ahora el estado se reinicia por obra.
3. Una versión vencida aparecía como «Vigente»: ahora se ve «En efecto» y «Vigencia vencida».

**Compatibilidad con el catálogo productivo:**
- Sin cambios de servidor ni de datos.
- En producción hay 0 versiones: cada libro abrirá su página con «No elegible: no hay ninguna versión».
- La única superficie existente que cambia es la columna de acciones del catálogo administrativo, con un botón más en los libros.
- No se probó con datos productivos (prohibido en esta unidad).

## F. Limitaciones para registrar Actas reales

1. **Despliegue:** esta interfaz no está en producción. Necesita el gate «código con ingesta OFF» (CI, respaldo PRE y POST, autorización).
2. **La editorial del Acta es siempre la responsable de la obra** (`publisher_mismatch`). Si un Acta corresponde a otra editorial, primero se reasigna la obra (F1-B, con confirmación) y después se registra el Acta.
3. **Los titulares de la matriz deben existir y estar activos** en `/admin/editoriales` (los terceros se dan de alta allí como «Tercero con derechos»).
4. **Minutos esperados (P1):** sin ellos una versión no puede ser «Liquidable». Dirección debe fijarlos por obra.
5. **Sin corrección de errores tipográficos:** el modelo es append-only. Un Acta mal registrada se corrige con una versión nueva (con su fecha de efecto) y la anterior queda en el historial.
6. **Una versión en efecto que vence no se sustituye sola:** la elegibilidad pasa a `OUT_OF_VALIDITY` hasta registrar una nueva.
7. **El cumplimiento de permisos sigue `off`:** los permisos se registran pero no restringen el acceso. Activarlo es DERECHOS-ENFORCE (auditoría de impacto y autorización).
8. **Sin adjuntar el documento del Acta:** solo su referencia (el Plan no incluye un almacén de documentos).

## G. Commits

Código, pruebas y este informe en un solo commit; ver el seguimiento (fila U1).

## H. Veredicto

**GREEN_LOCAL**, pendiente de confirmar el CI del push. Laboratorio `chp-u1lab` **detenido, no borrado** (datos sintéticos). No se despliega y no se inicia U2.
