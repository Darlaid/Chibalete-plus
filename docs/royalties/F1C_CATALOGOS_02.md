# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-C / CATÁLOGOS-02 · Biblioteca por editoriales y sellos

**Fecha:** 2026-10-26 · **Baseline:** `5b83544` · **Código:** `b3dd8a9` · **Auditoría previa:** `F1C_CATALOGOS_01.md` · **Alcance:** local + CI, sin despliegue

**Veredicto:** **GREEN_LOCAL+CI** (sin despliegue). CI `b3dd8a9`: security ✅, content-rmw ✅, identity-preflight ✅ (incluye `test:library`, `test:royalties` de su ámbito, typecheck y build).

---

## A. Baseline

- HEAD `5b83544` = origin; árbol limpio.
- CI `5b83544`: security ✅, content-rmw ✅.
- F1-B estable en producción (`F1B_EDITORIALES_04_PROD_EVIDENCE.md` §K). No se repitió su auditoría ni se tocó producción.
- **Android LU:** el repositorio local de LU (v0.9.0) no consume `/api/content/my-catalog` (sus llamadas son login, logout, progreso, analítica y asignación offline) y parsea con Gson, que ignora claves desconocidas. Una ampliación aditiva no le afecta.

## B. Metadatos y servidor

| Pieza | Cambio |
|---|---|
| `imprint` (texto opcional en la ficha) | `publisherAssignment.resolveImprint`, llamado en `POST /api/content` antes del lock y dentro de él |
| Validación | El sello debe estar en `publishers.imprints` de la editorial resultante (400 `imprint_invalid` si es ajeno, si no es texto o si no hay editorial). `''` o `null` lo quitan |
| Edición parcial | Sin la clave `imprint` se conserva el guardado. Un sello que la editorial retiró de su lista se conserva mientras la obra no cambie de editorial |
| Reasignación | Con un sello que no es de la nueva editorial se **rechaza**: no se borra en silencio y no se escribe historial |
| `my-catalog` | Clave aditiva `publishers: [{ id, name }]`: editoriales **activas** con al menos un libro en el conjunto ya autorizado (`publicPublishersForCatalog`). `catalog` no cambia (mismas filas, mismas 5 claves). Si falla el registro de titulares, responde `[]`; sin libros con editorial, no abre `royalties.db` |
| Fuera de alcance | Sin tablas, migraciones ni entidad de sellos. Ninguna de las 52 obras de producción se modifica |

## C. Biblioteca por editorial y sello

- `pages/Biblioteca.tsx`: la pestaña `editorial` pasa de «Selección Chibalete» a **«Editoriales»** (mismo id de pestaña).
- Dibuja `groupBooksByPublisher(filterHidden(miBiblioteca), visiblePublishers)`, es decir, el **mismo conjunto autorizado** de «Libros»:
  - Solo `libro` y `libro_album` de editoriales públicas.
  - Un grupo por sello en orden alfabético y el grupo «General» al final para los libros sin sello.
  - Una editorial con solo libros sin sello no muestra subtítulo.
- Tarjeta y apertura iguales que en «Libros» (`renderSavable` → `ContentCard` → `/contenido/:id`). Sin preflight ni fuente propios. Los nombres salen de `my-catalog`, nunca de endpoints administrativos.
- La curaduría CHP-LIB-01 (`/api/library/editorial*`, `library_db.json`, `dataService.getEditorialLibrary`) **se conserva** sin vista de lectura.

## D. Catálogo administrativo

- `/admin/editoriales`: el conteo de libros enlaza a `?editorial=<id>&clase=libros` y el de recursos a `&clase=recursos`. Los conteos usan la misma regla que `bookCount` del servidor.
- `/subir-contenido` (gestión), con `utils/adminCatalogFilters.mjs`:
  - Selector Todos / Libros / Recursos con conteos.
  - Selector de sello y de estado, visibles solo si hay más de un valor.
  - Etiqueta del sello en cada fila.
  - «Editar» abre la ficha.
- Formulario:
  - Selector «Sello (Opcional)» con los sellos de la editorial elegida y «Sin sello».
  - Aviso si el sello no pertenece a la editorial seleccionada.
  - Bloqueo previo a la subida (`imprintFormBlock`, espejo del servidor).
  - El sello viaja con `publisherId`, solo si la lista de editoriales cargó.
- Sin endpoints nuevos: el filtro es de presentación sobre la lista que ya recibe administración.

## E. Búsqueda

- `pages/Busqueda.tsx` agrupa con `groupSearchResults` por **editorial real** (`publisherId`):
  - «Libros de <editorial>», que incluye los `libro_album`.
  - «Otros libros» para los libros cuya editorial no tiene nombre público para quien busca (no se les atribuye ninguna).
  - «Videos y podcasts».
- La fuente de resultados no cambia (`buscarContenido`).
- Las fichas nuevas ya no reciben `editorial: 'Chibalete'`. Las existentes conservan su texto histórico, también al editarlas.
- `Content.editorial` pasa a ser opcional.

## F. Compatibilidad y permisos

- `my-catalog` conserva `success`, `catalog` y sus 5 claves por fila. Lo verifican el test HTTP y el navegador.
- `publishers` solo expone `id` y `name`: sin NIT, contacto, notas, sellos ni estado (aserción de claves exactas y búsqueda de los valores sembrados).
- Lector y mediador reciben 403 en `/api/admin/publishers` y `/api/admin/publisher-audit`. Un lector no puede fijar sellos (`POST /api/content` → 401/403).
- Los filtros administrativos siguen bajo la ruta `admin`.

## G. Pruebas

| Suite | Resultado |
|---|---|
| `publisherImprint` (nueva, unidad) | 20/20 |
| `publisherCatalogHttp` (nueva, servidor real) | 33/33: lector, mediador y administración; interna con 2 sellos, externa, inactiva y solo-admin; restringida; sellos válido, ajeno, no-texto y vacío; edición parcial; reasignación; sello retirado; ids únicos; progreso, eventos, `econ_events`, derechos y reglas sin cambios; base real no creada |
| `libraryPublisherGroups` (nueva, cliente) | 40/40: pestaña, Búsqueda, parser, filtros administrativos, regla del formulario |
| `BibliotecaLibraryLayers.structural` | 123/123. **Actualizada a propósito:** la etiqueta pasa a «Editoriales» y la sección [20] cambia de «Selección intacta» a once aserciones sobre la nueva pestaña (mismo conjunto, misma tarjeta, sin preflight ni endpoints administrativos, un único escritor de estado, curaduría conservada) |
| `AdminEditoriales.structural` | 32/32 (+10 de F1-C) |
| `test:royalties` | Verde completo |
| `test:content-rmw` | Verde |
| `test:library` | Verde salvo `libraryInstitutionalPersonal`: 1 aserción («/api/content general NO cambia su política no-store»), que **falla igual en la baseline `5b83544`** (verificado en un worktree limpio). En CI pasa. Ajena a F1-C |
| `typecheck:baseline` | Sin regresiones |
| `build` | OK |

**Navegador real, laboratorio aislado** (contenedor sin acceso a datos reales, código `b3dd8a9`, datos 100 % sintéticos, ingesta apagada, `localhost:5173`):
- **Lector:**
  - «Editoriales» con Chibalete (sellos LAB y «General») y Externa LAB.
  - La editorial inactiva, la solo-admin, la obra restringida y la guía no aparecen. El libro de la editorial inactiva sigue en «Libros».
  - El álbum aparece en Libros, Libros Álbum y Editoriales con el mismo id, y se abre en `/contenido/lab-ch-album`.
  - Búsqueda agrupa por editorial real.
  - 403 en los endpoints administrativos.
- **Administración:**
  - Enlaces con `clase`: Chibalete 5 libros / 1 recurso, iguales al catálogo.
  - El filtro de sello funciona.
  - El formulario muestra los sellos de la editorial; al cambiar a Externa, avisa sin borrar el sello y vuelve a mostrar la confirmación de reasignación.
  - Guardar un sello válido en el laboratorio escribe solo ese campo; el texto histórico se conserva y no hay ids duplicados.
- **Mediador:**
  - Solo sus libros autorizados, agrupados.
  - Sin «Editoriales» en el menú, 403 en los endpoints administrativos y redirección desde `#/admin/editoriales`.
- 0 eventos económicos (no se creó `events.db`) y 0 respuestas 5xx.
- Incidencia del propio laboratorio: el seed omitió `metricas`, que la ficha exige y todas las fichas reales tienen. Se corrigió en los datos sintéticos; no es un defecto del producto.

## H. Riesgos residuales

1. **Exposición de metadatos de Búsqueda (preexistente, `GENERAL_CATALOG_METADATA_EXPOSURE`):** Búsqueda sigue buscando en el catálogo general cacheado, así que lista títulos que el usuario no puede abrir (abrirlos sigue denegado por el preflight). F1-C no amplía ese conjunto ni atribuye editorial a esas obras: van a «Otros libros».
2. Mientras administración no asigne sellos, producción mostrará un único bloque «Chibalete Editores» sin subtítulos. Es lo esperado y no hay migración.
3. `libraryInstitutionalPersonal` falla en local en una aserción ajena a F1-C, también en la baseline.
4. `rightsHttp` (F2-A, sin tocar) reescribe la `mtime` de `data/progress.db-shm` local, con el mismo contenido.
5. Al publicar, Biblioteca dejará de mostrar «Selección Chibalete»; en producción está vacía (0 colecciones).

## I. Commits

- `b3dd8a9`: implementación y tests.
- Este documento y el seguimiento: commit documental posterior.

## J. Veredicto

**GREEN_LOCAL+CI.** Implementación completa de §2–§6 del prompt, pruebas nuevas y actualizadas en verde, navegador real en laboratorio aislado en verde y CI `b3dd8a9` en verde en los tres workflows. Los riesgos de §H son preexistentes o esperados. **No se desplegó**: requiere autorización posterior (imagen api + front; sin migraciones; al desplegar, `my-catalog` gana la clave `publishers` y Biblioteca muestra «Editoriales»).
