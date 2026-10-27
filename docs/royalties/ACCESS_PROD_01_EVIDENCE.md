# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / ACCESS-PROD-01 · Verificación final de permisos productivos

**Fecha:** 2026-10-27 (UTC, ventana desde 22:59:06Z) · **Baseline:** `1e731eb` · **Producción:** api_1/api_2 y front `regalias-c8f491e` (DEPLOY-01)
Sin despliegue, sin cambios de código, datos ni configuración. Sin escrituras salvo la telemetría normal de lectura descrita en §C.

## A. Sesiones comprobadas

- **Preflight:** api_1, api_2, front y edge healthy, con 0 reinicios. `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` sin definir (= off). Huella previa igual al cierre de DEPLOY-01: 0 derechos, 1 titular, tablas 0004 vacías, 0 `econ_events`.
- **Mediación:** sesión real abierta por la titular en Chrome. `/api/auth/me` → 200, `roles: ["mediador"]`; catálogo propio 109 títulos.
- **Lectura:** sesión real abierta por la titular en Chrome (tras cerrar la de mediación). `/api/auth/me` → 200, `roles: ["lector"]`; `my-catalog` 89 títulos, 52 libros.
- Las cifras de catálogo coinciden con las registradas en F2-A para estas cuentas (109 y 89).
- Ningún resultado se simuló: ambas sesiones existían y se usaron.

## B. Resultado por rol y ruta

Obra de prueba: «La metamorfosis» (`content-1765751139919`), presente en el catálogo de los dos roles.

| Ruta | Mediación | Lectura |
|---|---|---|
| `GET /api/admin/rights/<obra>` | **403** | **403** |
| `GET /api/admin/rights/<obra>/eligibility` | **403** | **403** |
| `GET /api/admin/royalties/report?month=2026-10` | **403** | **403** |
| `GET …/report?month=2026-10&format=csv` | **403** | **403** |
| `GET …/report?quarter=2026-Q4&format=html` | **403** | **403** |
| `GET /api/admin/royalties/preview?month=2026-10` | **403** | **403** |
| `GET /api/admin/royalties/closes` | **403** | **403** |
| `GET /api/admin/royalties/period-inputs?period=2026-10` | **403** | **403** |
| `GET /api/admin/publishers` | **403** | **403** |
| Contenido de esas respuestas | Sin datos (ni referencias, matrices, Actas, INS ni obras) | Sin datos |
| Ruta `#/admin/derechos/<obra>` | **Redirige a `#/`**; no se pinta la página de derechos | **Redirige a `#/`** |
| Ruta `#/admin-dashboard` (Panel Admin → Informes) | **Redirige a `#/`**; sin pestaña «Informes», sin Panel | **Redirige a `#/`**; el menú no ofrece «Panel Admin» |

## C. Apertura normal de libros

| | Mediación | Lectura |
|---|---|---|
| Ficha `#/contenido/<obra>` | Normal: portada, sinopsis, botones de modo, «Reanudar Lectura» | Normal; la obra aparece en «Estoy leyendo» |
| Preflight `GET /api/content/<obra>/access` | **200** (×2) | **200** (×2) |
| Lectura (`#/leer/inmersivo/<obra>`, el último modo de cada cuenta) | Texto y controles renderizados | Texto y controles renderizados, en el punto de la cuenta |

**Escrituras generadas al abrir** (telemetría normal del visor, capturada en la red y en los logs; cada lectura duró ~7 s y se salió sin interactuar):
- en cada apertura: `POST /api/events` ×1, `/api/v1/events` ×2, `/api/analytics/events` ×1, `/api/tts` ×7 (síntesis de voz) y `/api/leo/memory/<usuario>/<obra>` ×1, todos 200;
- **sin** sincronización de progreso.

Es la actividad propia de la cuenta que lee. No toca derechos, titulares, reglas, contenido ni el circuito económico: con la ingesta off, `econ_events` sigue en 0.

## D. Integridad posterior

- **Huella posterior frente a la previa:**
  - `royalties.db` **idéntica** (0 versiones de derechos, 1 titular `pub-chibalete-editores`, `rule_sets`/`period_inputs`/`closes`/`adjustments` = 0);
  - `events.db` idéntica (0 `econ_events`, 0 `econ_tick`);
  - `content.json` idéntico;
  - reglas comerciales (`access_db.json`) y grupos/colegios idénticos.
- **Único cambio, el padrón:** 672 = 672, 0 altas y 0 bajas. Solo cambió `lastLoginAt` de **1 cuenta de mediación y 1 de lectura**: los dos inicios de sesión de esta verificación. Comparado con la restauración POST de DEPLOY-01, imprimiendo solo nombres de campo.
- **Escrituras en la ventana** (ambas réplicas, todas 200):
  - 2 × `POST /api/auth/login` y 1 × `POST /api/auth/logout` (las sesiones abiertas por la titular);
  - la telemetría de §C: 2 × `/api/events`, 4 × `/api/v1/events`, 2 × `/api/analytics/events`, 14 × `/api/tts` y 2 × `/api/leo/memory`.
  - **Ninguna** escritura en derechos, titulares, INS, cierres, movimientos, reglas comerciales, contenido, grupos ni colegios.
- `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` siguen sin definir (= off). 0 errores y 0 reinicios en las dos réplicas.

## E. Evidencia documental

- Este documento y la fila AP01 de `SEGUIMIENTO_PLAN_V1_1.md`.
- Huellas en el VPS: `/root/chp-accprod01/snapshot-pre.json`, `snapshot-post.json` y `t0.txt`.
- Cierra la observación pendiente de `U1_DERECHOS_UI_02_PROD_EVIDENCE.md` §E.3 y de `DEPLOY_01_PROD_EVIDENCE.md` §F (mediación y lectura con sesiones reales).

## F. Veredicto

**GREEN.** Con sesiones reales de producción:
- mediación y lectura reciben 403, sin datos, en los 9 endpoints administrativos de derechos, titulares e informes;
- las rutas administrativas (derechos y Panel Admin → Informes) redirigen al inicio;
- los dos roles conservan el acceso normal a sus libros.

No hubo cambios en derechos, titulares, INS, cierres, movimientos, eventos económicos, reglas comerciales ni configuración; solo los `lastLoginAt` de las dos sesiones y la telemetría normal de lectura. No se desplegó nada, no se registraron derechos y no se activó la ingesta.
