# EDITORIALES-CATALOGO-01 — Catálogo de títulos por editorial y sello

Plan PLAN-EDITORIALES-INFORMES-01 · V1.0 · 2026-10-28 · código `71a5d1a` · **sin despliegue**.

## A. Baseline y CI
- Base `5d6098e` = `origin/chp/epub-mainfile-r1-release`, árbol limpio.
- CI de `5d6098e`: security ✓, identity-preflight ✓, content-rmw ✓ en el intento 2 del run `40706174133` (intento 1: gate «pérdida de escrituras entre réplicas», intermitente; suite completa verde en local). → REPORTES-FILTROS-01 = GREEN_LOCAL+CI.

## B. Fuente canónica
- Lista: `dataService.getContenidos(['administrador'])` — la misma que la gestión de contenido (`/subir-contenido`), servida por `GET /api/content` (administración ve todo).
- Libro = `tipo` `libro` | `libro_album` (`isBookForm`), la misma regla con la que el servidor calcula `bookCount` (`publisherCompliance`).
- Editorial = `publisherId` actual de la obra; sello = `imprint` de la obra; sellos registrados = `publishers.imprints`.
- Sin endpoints, migraciones ni colecciones nuevas. Sin backend.

## C. Catálogo por editorial y sello
- Botón «Catálogo» en cada fila de Editoriales → `/admin/editoriales?catalogo=<id>` (enlazable), panel «Catálogo editorial» encima de la tabla, con foco al abrirse.
- Por libro: cubierta en miniatura (marcador si no hay), título, autoría, «ISBN …» si la obra lo tiene registrado o «Sin ISBN», ID canónico, «Libro álbum», estado (Disponible / Procesando / Con error), enlaces «Ficha» y «Derechos».
- Grupos: sellos registrados en su orden (vacíos incluidos: «Sello registrado sin títulos»), sellos guardados que ya no figuran en la editorial (marcados), «Sin sello asignado» al final. Cada grupo con su número de títulos y expandible (`aria-expanded`).
- No se deducen sellos de colecciones, títulos ni autoría; nada se asigna. Los libros sin sello quedan en «Sin sello asignado» (no pasan a Chibalete Editores ni a Estado Sólido).

## D. Contadores y navegación
- Total de libros de la editorial; recursos (incluida pedagogía) aparte, «no se cuentan como libros», con enlace al catálogo filtrado existente.
- Aviso si el conteo del catálogo cargado difiere de `bookCount` del servidor.
- «Ficha» → `/subir-contenido?editar=<id>`: abre el editor existente (donde se asigna el sello), se consume una vez y se quita de la URL. «Derechos» → `/admin/derechos/<id>`. Sin segundo editor de metadatos.

## E. Pruebas
- `utils/__tests__/publisherCatalog.test.mjs` 19/0: varios sellos, un sello, sello vacío, sin sello, sello no registrado, sin catálogo, reasignado, ISBN sí/no, recursos y pedagogía aparte, sin duplicados, sin deducir sellos por título/autoría/colección, paridad con `publisherCompliance`, solo lectura.
- `AdminEditoriales.structural` 39/0 (+7). `npm run test:royalties` verde; estructurales de SubirContenido (Epub 17, EpubAdmin 21, ClientContentProtection 19, ContentExtractionDeterrence 80) verdes. Typecheck: 0 errores nuevos (12 preexistentes). Build OK.
- Laboratorio `chp-u6lab` / `/tmp/chp_u7lab` con el código del árbol: Aurora (Aurora Infantil con `lab-corto` + ISBN; Aurora Clásicos vacío; 1 guía como recurso), Bruma (Bruma Joven con `lab-largo`; EPUB reasignado y álbum sin sello), Chibalete Editores / Ilustradora / Traductor sin catálogo.
  - Las 5 editoriales: libros en pantalla = `bookCount` del servidor = libros del catálogo canónico (mismos IDs, sin duplicados, sin aviso de desfase).
  - Navegación: «Ficha» abre el editor con título, editorial y sello cargados; atrás vuelve al catálogo; «Derechos» abre la ficha de derechos. Grupos contraen y expanden.
  - Permisos: administración 200; mediación y lectura 403; anónimo 401 (`/api/admin/publishers`, `/:id`, informes).
  - 390 / 1024 / 1440 px: `main` 390/390, 736/736, 1152/1152.
  - Integridad: `content.json` y `royalties.db` del lab con el mismo sha256 antes y después de recorrer catálogos.
- Capturas en `editoriales_catalogo_01/`.

## F. Coherencia con Informes
- Octubre 2026 (simulación viva): para las 4 obras, editorial, sello e ID del informe = los del catálogo.
- Junio 2026 (vista previa) y agosto (cierre): el informe conserva la atribución del periodo (EPUB en Aurora; sello `publisher_changed` / `not_historical`); el catálogo muestra la actual (EPUB en Bruma). Es la diferencia esperada: el catálogo refleja la atribución actual; los cierres y sus hashes no se tocan.

## G. Riesgos y limitaciones
- **ISBN**: el modelo canónico de obra no tiene campo ISBN ni el editor lo captura. Se muestra solo si la obra lo trae registrado; si no, «Sin ISBN» + ID canónico. Incorporar ISBN al editor es una decisión aparte.
- En producción hoy ninguna obra tiene sello: todos los libros aparecerán en «Sin sello asignado» hasta que se asignen uno a uno en su ficha.
- La lista sale de la caché de `dataService` cargada al iniciar sesión; si otra sesión cambia el catálogo, el aviso de desfase con `bookCount` indica recargar.
- Congelar el sello en cierres futuros sigue pendiente (unidad separada).
