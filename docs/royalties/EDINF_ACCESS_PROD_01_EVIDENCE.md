# EDINF-ACCESS-PROD-01 — Permisos productivos tras EDITORIALES-INFORMES-DEPLOY-01

**Fecha:** 2026-10-28 (UTC, ventana desde 16:02:58Z) · **Baseline:** `aa82bec` · **Producción:** api_1/api_2 y front `edinf-41b1bc7`
Sin despliegue ni cambios de código, datos, usuarios o configuración. Sin escrituras administrativas.

## A. Sesiones reales
- **Preflight:** api_1, api_2, front y edge healthy, 0 reinicios; `ECONOMIC_INGEST_MODE` / `RIGHTS_ENFORCEMENT_MODE` sin definir (= off); 0 `[ERROR]` y 0 × 5xx desde el despliegue; huella = cierre de EDITORIALES-INFORMES-DEPLOY-01 (padrón incluido).
- **Mediación:** sesión real abierta por la titular en Chrome. `/api/auth/me` → 200, `roles: ["mediador"]`.
- **Lectura:** sesión real abierta por la titular en Chrome tras cerrar la de mediación. `/api/auth/me` → 200, `roles: ["lector"]`.
- No se escribieron credenciales ni se simularon resultados; no se imprimieron datos personales.

## B. Resultado por rol y ruta
Obra de prueba: «La metamorfosis» (`content-1765751139919`). Filtros nuevos incluidos.

| Ruta | Mediación | Lectura |
|---|---|---|
| Menú: «Panel Admin» / «Editoriales» / «Informes» | ausentes | ausentes |
| `GET /api/admin/royalties/report?month=2026-10` (JSON) | **403** | **403** |
| `…&format=csv` | **403** | **403** |
| `?quarter=2026-Q4&format=html` | **403** | **403** |
| `…&editorial=…&sello=__sin_sello__&obra=…` (filtros) | **403** | **403** |
| `?quarter=2026-Q3&titular=…&format=csv` (filtro titular) | **403** | **403** |
| `GET /api/admin/royalties/preview`, `/closes`, `/period-inputs` | **403** | **403** |
| `GET /api/admin/publishers`, `?withCounts=1`, `/pub-chibalete-editores` | **403** | **403** |
| `GET /api/admin/rights/<obra>`, `/eligibility` | **403** | **403** |
| Cuerpo de las 13 respuestas | 38 bytes, sin datos (ni referencias, sellos, importes, matrices ni INS) | igual |
| `#/admin-dashboard` (Informes) | redirige a `#/`, no se pinta | redirige a `#/` |
| `#/admin/editoriales` y `?catalogo=pub-chibalete-editores` | redirige a `#/`, sin catálogo | redirige a `#/` |
| `#/admin/derechos/<obra>` | redirige a `#/` | redirige a `#/` |
| `#/subir-contenido?editar=<obra>` (ficha desde el catálogo) | redirige a `#/`, sin editor | redirige a `#/` |

## C. Apertura de libros
| | Mediación | Lectura |
|---|---|---|
| Ficha `#/contenido/<obra>` | normal: «Reanudar Lectura», «Leer en PDF» | normal: «Reanudar Lectura», «Leer en PDF» |
| Preflight de la app `/api/content/<obra>/access?userId=…` | **200** | **200** |
| Visor (`#/leer/inmersivo/<obra>`, último modo de la cuenta, ~7 s sin interactuar) | texto y controles, sin denegación | texto y controles, sin denegación |

## D. Integridad
- **Huella posterior = previa:** `content.json`, `royalties.db` (0 versiones de derechos, 1 titular, `rule_sets`/`period_inputs`/`closes`/`adjustments` = 0), `events.db` (0 `econ_events`, 0 `econ_tick`), reglas comerciales (`access_db.json`), grupos y colegios: **idénticos**.
- **Padrón** (frente a la restauración POST del despliegue, solo nombres de campo): 672 = 672, 0 altas, 0 bajas; cambió solo `lastLoginAt` de **1 cuenta de mediación y 1 de lectura** (los inicios de sesión de esta verificación).
- **Escrituras en el edge en la ventana** (todas 200 salvo la indicada):
  - sesiones: 2 × `POST /api/auth/login` 200, 2 × `POST /api/auth/logout`, **1 × `POST /api/auth/login` 502** (ver abajo);
  - telemetría normal del visor (dos aperturas): 14 × `/api/tts`, 4 × `/api/v1/events`, 2 × `/api/events`, 2 × `/api/analytics/events`, 2 × `/api/leo/memory/<usuario>/<obra>`;
  - **ninguna** escritura en derechos, titulares, INS, cierres, movimientos, reglas comerciales, contenido, grupos ni colegios.
- **El 502:** 16:04:07Z, `recv() failed (104: Connection reset by peer) while reading response header` hacia api_2 (`172.21.0.4`); api_2 no registró la petición (su anterior fue el logout de 16:03:59Z) ⇒ no llegó a Node. El reintento de 16:04:26Z entró por api_1 con 200. Es la deuda conocida de keepalive edge↔Node (42 casos iguales en los 7 días previos al despliegue, con la imagen anterior); no es de esta unidad ni tuvo efecto en datos.
- Los 404 de `/uploads/audio/<obra>/anchors.json` en el log de error del edge son el sondeo de un archivo opcional del visor (15 casos en los 3 días previos al despliegue): preexistentes.
- 0 `[ERROR]` en api_1/api_2; 0 reinicios; ingest/enforce sin definir.

## E. Evidencia
Huellas `/root/chp-edinf01/access/snapshot-{pre,post}-access.json`; este documento.

## F. Veredicto
**GREEN.** Mediación y lectura no acceden a Informes, Editoriales, catálogo, derechos ni a la ficha de edición (rutas redirigidas, 13/13 endpoints 403 sin datos, menú sin entradas administrativas) y leen con normalidad. Integridad intacta salvo los dos `lastLoginAt` y la telemetría normal de lectura. Cierra el pendiente de EDITORIALES-INFORMES-DEPLOY-01 §E.
