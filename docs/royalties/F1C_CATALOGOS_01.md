# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-C / CATÁLOGOS-01 · Auditoría de Biblioteca multieditorial y sellos

**Fecha:** 2026-10-26 · **Baseline:** `578a277` · **Tipo:** auditoría y propuesta, sin implementación · **Autoridad:** `PLAN_GENERAL_V1_1.md`, `PLAN_INTEGRADO_V1_4.md` §2 y §4 (V14-2)

**Veredicto:** **GO condicionado** a las decisiones I-1…I-4 (§I). Sin ellas, la propuesta no se implementa.

---

## A. Baseline

| Control | Resultado |
|---|---|
| Repo | HEAD `578a277` = origin; árbol limpio (solo carpetas no versionadas ajenas) |
| CI `578a277` | security ✅; content-rmw en curso al auditar (commit solo de docs) |
| Producción (solo lectura) | F1-B estable: api_1, api_2 y front `editoriales-beb11e4` healthy (ver `F1B_EDITORIALES_04_PROD_EVIDENCE.md` §K). No se repite su auditoría |
| Escrituras | Ninguna. Lectura agregada dentro de api_1 con un script temporal que se borró al terminar |

## B. Estado real de Biblioteca (`pages/Biblioteca.tsx`)

- **8 pestañas** en un solo componente: Libros, Libros Álbum, Experiencias, Mi biblioteca, Biblioteca institucional, **Selección Chibalete**, Continuar Leyendo, Comunidad. La suite `BibliotecaLibraryLayers.structural` fija ese conjunto y su orden.
- **Autoridad de visibilidad:** `GET /api/content/my-catalog` (`server/server.js:11662`), que aplica `visibleCatalogForUser` y el permiso F2-A `cover_metadata`. Devuelve solo ids. El navegador dibuja cada id con la ficha del catálogo cacheado (`utils/libraryCatalogSelection.mjs`). Libros, Libros Álbum y Continuar Leyendo son filtros de presentación sobre ese mismo conjunto:
  - `deriveAlbumFromVisible`, para Libros Álbum.
  - `standalone === false`, que oculta las 10 obras «Para Experiencias».
  - `hiddenContentIds` del colegio.
  - `isPedagogyChildMaterial`.
- **Libros** dibuja todo el conjunto autorizado, no solo libros, agrupado por `sectionIds` (42 de 52 libros tienen sección). **Libros Álbum** es su subconjunto `libro_album`. Un álbum aparece ya en las dos pestañas.
- **Identidad y apertura:** cada tarjeta es `ContentCard` → `/contenido/:id`. El id de la ficha es el único identificador: progreso, episodios y `econ_tick` se calculan por `contentId` en el visor, no en la pestaña. Mostrar una obra en varias pestañas no crea lecturas.
- **Visibilidad por perfil:** `/biblioteca` acepta cualquier sesión autenticada. Qué obras aparecen lo decide el servidor (administración ve todo; mediación ve el catálogo de su organización y asignaciones; lectura, sus reglas).
- **«Selección Chibalete»** (`tab="editorial"`) es la capa EDITORIAL de CHP-LIB-01:
  - Lectura con `GET /api/library/editorial` (público, `server/server.js:1836`); curaduría con `POST`/`PUT`/`DELETE /api/library/editorial/*` (administración).
  - Datos en `data/library_db.json`. **En producción está vacía:** 0 colecciones y 0 referencias EDITORIAL. Hoy muestra «La selección editorial estará disponible pronto.»
  - Es la única pestaña que pinta candados: usa el preflight `/api/content/:id/access` por tarjeta.
- **Fuera de Biblioteca:** `pages/Busqueda.tsx` agrupa los resultados con el texto libre `content.editorial` («Libros del sello Chibalete» = `editorial === 'Chibalete' && tipo === 'libro'`; también «Aliada X» y «Comunidad»). El formulario (`SubirContenido.tsx:1098`, `:1189`) escribe siempre `editorial: 'Chibalete'`.

## C. Relación editorial – sello – obra (producción, solo lectura)

| Dato | Valor |
|---|---|
| Fichas | 109: 43 `libro`, 9 `libro_album`, 10 `guia`, 23 `articulo_pedagogico`, 2 `contexto_pedagogico`, 17 `podcast`, 5 `video` |
| `publisherId` | 109/109 = `pub-chibalete-editores`; 52/52 libros con editorial válida |
| Editoriales | 1, activa: Chibalete Editores |
| Sellos registrados (`publishers.imprints`) | «Chibalete Editores», «Estado Sólido» (los completó Dirección el 2026-10-26) |
| **Sello por obra** | **No existe.** Ninguna ficha tiene `imprint` ni `sello`. El único campo parecido es `isCollection`, que no tiene relación |
| Texto libre `editorial` | «Chibalete» en las 109 fichas (valor fijo del formulario) |
| Estado de los libros | 52 `disponible`; 10 con `standalone === false` |

- Hoy se puede agrupar por editorial, pero **no por sello**: falta la relación libro–sello.
- **Editoriales inactivas:** el estado no afecta al acceso ni a la Biblioteca (F1-B no lo conecta). Los libros siguen visibles por sus reglas de acceso.
- **Nombres para lectores:** `publisherId` ya llega al navegador dentro de la ficha (es un id opaco). Los nombres solo salen por `GET /api/admin/publishers`, que es de administración y además devuelve contacto, NIT y notas. **Ningún endpoint de lectura ofrece hoy el nombre público de la editorial.**

## D. Catálogo administrativo existente

- `/admin/editoriales` → el conteo de libros enlaza a `#/subir-contenido?editorial=<id>` (verificado en producción: «Editorial: Chibalete Editores · 109», con «Quitar filtro»).
- El filtro (`SubirContenido.tsx:787`) usa `c.publisherId === id` y muestra **todo** el contenido de la editorial (libros y recursos). La tabla tiene las columnas Tipo (solo icono), Título, Autor, Estado TTS y Acciones (Editar, Eliminar), además de la marca «Para Experiencias».
- «Editar» abre la ficha con la editorial preseleccionada (F1-B). Acceso: la ruta `/subir-contenido` es `admin` y todas las mutaciones pasan por `requireAdminRole` en el servidor.
- **No hay** distinción explícita libro/recurso (salvo el icono), filtro por sello (no hay datos) ni filtro por estado.

## E. Brechas funcionales

| # | Brecha | Afecta |
|---|---|---|
| E1 | No existe la relación obra–sello | Agrupar por sello (lectores y administración) |
| E2 | No hay una proyección pública mínima de la editorial (nombre y sellos) para lectores | Pestaña «Editoriales» |
| E3 | «Selección Chibalete» es una curaduría manual vacía, no una vista por editorial | Sustitución pedida |
| E4 | El catálogo administrativo no separa libros y recursos ni filtra por sello o estado | Administración |
| E5 | Búsqueda atribuye por el texto fijo `editorial: 'Chibalete'`: un libro de una editorial externa saldría como «Libros del sello Chibalete», y los `libro_album` no aparecen en ningún grupo | Atribución correcta con varias editoriales |
| E6 | El estado `inactive` de una editorial no tiene efecto definido en la Biblioteca | Regla de presentación |

## F. Solución mínima propuesta (sin implementar)

**F1. Campo de sello por obra (cierra E1, conforme a V14-2: sin entidad de sellos).**
- Campo opcional `imprint` (string) en la ficha de libro.
- Validación en el servidor, en `POST /api/content` junto a `resolvePublisherAssignment`: si viene, debe pertenecer a `publishers.imprints` de la editorial resultante; si no, 400 `imprint_invalid`.
- `''` o `null` lo quita. Al reasignar la editorial con un sello que no pertenece a la nueva, la petición se rechaza; no se limpia en silencio.
- Las ediciones parciales sin `imprint` conservan el guardado (mismo patrón que `publisherId`).
- **Sin migración:** las 52 fichas quedan sin sello hasta que administración lo asigne una por una.
- No entra en `content_publisher_history` ni en derechos: es presentación, no identidad económica.
- Formulario: un selector «Sello» bajo «Editorial responsable», con las opciones de esa editorial y «Sin sello».

**F2. Nombre público de la editorial (cierra E2).** Ampliación aditiva de `GET /api/content/my-catalog`:
- Clave nueva `publishers: [{ id, name, imprints }]` con `name = tradeName || legalName`, limitada a las editoriales **activas** con al menos un libro en el conjunto visible de quien consulta.
- Sin contacto, NIT, notas, derechos ni importes.
- `parseMyCatalogResponse` ignora claves desconocidas, así que LU y los clientes actuales no cambian.

**F3. Pestaña «Editoriales» (cierra E3) en el mismo componente.**
- `<TabButton tab="editorial" label="Editoriales" />`, conservando el id de pestaña.
- Dibuja el **mismo conjunto autorizado** de la pestaña Libros (`miBiblioteca` tras `filterHidden`), restringido a `libro` y `libro_album`.
- Agrupa por editorial (con el nombre de F2) y, dentro de cada una, por sello cuando la obra lo tenga, más un grupo «Otros títulos» para los que no lo tienen.
- Tarjetas `ContentCard` normales → `/contenido/:id`. Sin endpoint de acceso nuevo, sin preflight por tarjeta y sin candados: lo no autorizado no aparece, como en Libros.
- Agrupación en una función pura nueva `utils/libraryPublisherGroups.mjs`, testeable.
- Una editorial sin libros visibles no aparece. Los libros de una editorial inactiva o sin nombre público siguen en Libros y no salen en Editoriales (I-3).
- La capa EDITORIAL de CHP-LIB-01 (endpoints y `library_db.json`) **no se borra**: queda sin vista de lectura (I-1).

**F4. Catálogo administrativo (cierra E4), solo en `SubirContenido.tsx`.**
- Parámetro `?clase=libros|recursos` junto a `?editorial=`, con selector «Todos · Libros · Recursos» basado en `isBookForm`.
- Selector de sello visible solo si alguna ficha filtrada tiene `imprint`; selector de estado (`disponible`, `procesando`, `error`, «Para Experiencias») solo con más de un valor presente.
- Etiqueta de texto del tipo junto al icono.
- `/admin/editoriales`: «52» → `?editorial=X&clase=libros` y «+57 recursos» → `&clase=recursos`.
- «Editar» se reutiliza tal cual. Sin endpoints nuevos: el filtro es de presentación sobre el catálogo que ya recibe administración, y el acceso sigue siendo `admin`.

**F5. Búsqueda (cierra E5), mínimo.**
- Sustituir el agrupamiento por texto por `publisherId`: «Libros de <editorial>» para `libro` y `libro_album`, con el nombre de F2.
- Quitar los grupos «Aliada X» y «Comunidad» (hoy siempre vacíos: 0 fichas con esos valores) o conservarlos (I-4).
- El texto libre `editorial` no se toca en los datos.

## G. Archivos y componentes afectados (previstos)

| Archivo | Cambio |
|---|---|
| `server/royalties/publisherAssignment.mjs` | `resolveImprint` (validación de F1) |
| `server/server.js` | `POST /api/content`: llamada a la validación; `my-catalog`: clave `publishers` |
| `pages/Biblioteca.tsx` | Etiqueta y render de la pestaña `editorial` |
| `utils/libraryPublisherGroups.mjs` (nuevo) | Agrupación pura editorial → sello |
| `services/dataService.ts`, `utils/libraryCatalogSelection.mjs` | Leer `publishers` de my-catalog (los ids siguen igual) |
| `pages/SubirContenido.tsx` | Selector de sello y filtros `clase`, sello y estado |
| `pages/AdminEditoriales.tsx` | Dos enlaces con `clase` |
| `pages/Busqueda.tsx` | Agrupación por `publisherId` |
| `types/index.ts` | `imprint?: string` en `Content` |
| Tests | `BibliotecaLibraryLayers.structural` (la pestaña cambia de etiqueta: el cambio de «Selección Chibalete» a «Editoriales» debe constar en la aserción), nuevas suites de agrupación, `imprint` HTTP y my-catalog |

Sin migraciones de `royalties.db`, sin cambios en `content.json` existente, sin cambios en F3-A3, visores, `econ_tick`, derechos ni motor de regalías.

## H. Pruebas y riesgos

**Casos (sintéticos, en laboratorio o CI):**

| Caso | Esperado |
|---|---|
| Chibalete Editores con sellos A y B, 2 libros en cada uno y 1 sin sello | Editoriales: un bloque con subgrupos A, B y «Otros títulos» |
| Editorial externa activa con 3 libros | Bloque propio; Búsqueda la nombra, no «Chibalete» |
| Libro y libro-álbum de la misma editorial | Los dos en el bloque; el álbum también en Libros Álbum; mismo id |
| Libro visible en Libros, Libros Álbum y Editoriales | Una sola ficha; abrir desde cualquier pestaña → mismo `/contenido/:id`; 0 episodios o progreso duplicados (mismo `contentId`) |
| Editorial sin libros visibles para el usuario | No aparece en Editoriales ni en `my-catalog.publishers` |
| Obra restringida (sin regla o sin `cover_metadata`) | Ausente en Editoriales, igual que en Libros; preflight sigue 403 |
| Usuario sin permiso (lector) en el catálogo administrativo | `/subir-contenido` redirige; `POST /api/content` con `imprint` → 401/403 |
| Lector | `my-catalog.publishers` sin contacto, NIT, notas ni datos económicos (aserción de claves exactas) |
| `imprint` ajeno a la editorial, o reasignación con sello incompatible | 400 `imprint_invalid`, sin escritura |
| Edición parcial sin `imprint` | Sello conservado |
| Identidad económica | Huella de `content.json` y `econ_events` sin cambios por navegar entre pestañas; `publisherId` intacto |

**Riesgos:**
- **R1.** El cambio de etiqueta rompe la aserción fija de `BibliotecaLibraryLayers` → hay que actualizarla de forma explícita, no relajarla.
- **R2.** Tocar `my-catalog`, que también usa LU → solo cambios aditivos, con test de compatibilidad del parser.
- **R3.** Vaciar la vista de CHP-LIB-01 deja sin uso curaduría que administración podría querer → los datos y endpoints se conservan.
- **R4.** El botón «Eliminar» sigue en el catálogo filtrado → no se amplía y no entra en el alcance.
- **R5.** Mientras no se asignen sellos, Editoriales mostrará un solo bloque «Chibalete Editores» con «Otros títulos» → es esperado, sin migración automática.

## I. Decisiones que requieren aprobación

| # | Decisión | Recomendación |
|---|---|---|
| **I-1** | Destino de la curaduría EDITORIAL de CHP-LIB-01 al sustituir la pestaña | Retirar solo la vista de lectura; conservar endpoints y `library_db.json` (vacío en producción) |
| **I-2** | ¿Editoriales muestra solo lo autorizado (como Libros) o todo el fondo de la editorial con candados (como la Selección actual)? | Solo lo autorizado: no expone metadatos nuevos y respeta `cover_metadata` |
| **I-3** | Editorial `inactive`: ¿sus libros salen en Editoriales? | No salen en Editoriales; siguen en Libros si el acceso lo permite (el estado no decide acceso) |
| **I-4** | Búsqueda: grupos «Aliada X» y «Comunidad» | Sustituirlos por grupos por editorial; mantener el grupo de vídeos y podcasts de Chibalete por `publisherId` |
| **V14-2** | Sello como `imprint` (texto validado contra `publishers.imprints`), sin entidad | Confirmar (§F1) |

## J. Veredicto

**GO condicionado** a I-1…I-4 y V14-2. La solución es aditiva:
- un campo opcional validado;
- una clave aditiva en `my-catalog`;
- una pestaña que reutiliza el conjunto autorizado;
- filtros de presentación en el catálogo administrativo.

No crea biblioteca paralela, entidad de sellos ni migraciones, y no toca acceso, derechos, F3-A3 ni el motor de regalías. Sin aprobación de las decisiones, no se implementa.
