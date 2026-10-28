# EDITORIALES-INFORMES-DEPLOY-01 — Despliegue de REPORTES-UX-01, REPORTES-FILTROS-01 y EDITORIALES-CATALOGO-01

**Fecha:** 2026-10-28 (UTC) · **Código:** `41b1bc7` · **Imágenes:** `chibalete/api:edinf-41b1bc7` (`0dc5fc1e0f50`), `chibalete/front:edinf-41b1bc7` (`a00873c4b087`)
**Alcance autorizado:** las tres unidades del plan PLAN-EDITORIALES-INFORMES-01, más **TXT-UTF8-GUARD-01** (`89d8015`), que estaba entre producción y `41b1bc7`; la titular eligió incluirlo antes de construir. Sin cambios del motor de regalías, derechos ni datos; sin operación económica.

## A. Baseline y CI
- HEAD = remoto = `41b1bc7`, árbol limpio.
- CI: UX-01 (`7e746ca`, identity-preflight intento 2 ✓), FILTROS-01 (`5d6098e`, content-rmw intento 2 ✓), CATALOGO-01 (`41b1bc7`, 3/3 a la primera). Las tres GREEN_LOCAL+CI.
- Producción previa: api_1/api_2/front `regalias-c8f491e` (`423251d0b5c2` / `d8ba20851d7d`); override `cda4bae4…` (líneas 40/85/130); disco 6,4 G libres (94 %).
- Delta ejecutable desde `c8f491e`: front (Informes, Editoriales, `?editar` en SubirContenido) y **backend** (`server/royalties/royaltyReports.mjs`, endpoint del informe en `server/server.js`; TXT-UTF8-GUARD-01 en `server/lib/textEncoding.js`, `server/ttsService.js`, `server/server.js`). Sin migraciones nuevas (0001–0004), sin dependencias nuevas; `Dockerfile.*` sin cambios. ⇒ **api y front** necesarios (el código del backend viaja en la imagen).

## B. Validación integrada (laboratorio `chp-u6lab`, `/tmp/chp_u7lab`, código = `41b1bc7` normalizando CRLF)
- Recorrido Editorial → Sello → Catálogo → Libro → Derechos → Informes: catálogo Aurora (Aurora Infantil 1, Aurora Clásicos 0, recurso aparte) = `bookCount`; «Derechos» muestra editorial y sello; informe filtrado editorial+sello+libro = la obra (MontoObra 93.571 = 65.500 + 0 + 28.071); total y referencia intactos.
- Beneficiario compartido (Ilustradora): 19.650 (Aurora) + 0 (Bruma) = su variable. Pantalla = API = CSV = HTML.
- Hashes: Q3 `7e8402f3…`, Q4 `13316c45…` (faltan 10/11/12), agosto `d7718362…`, cierres 07/08/09 `5faa4169`/`d7718362`/`a25cd107` sin cambio.
- 390/1024/1440 px, Editoriales e Informes con detalle abierto: `main` 390/390, 736/736, 1152/1152.
- TXT-UTF8-GUARD-01: TXT Latin-1 → 415 `TXT_NOT_UTF8`, nada persistido en `uploads`; TXT UTF-8 → 200.

## C. Respaldo PRE
- Huella PRE (`/root/chp-edinf01/snapshot.cjs` = `dep01_snapshot.cjs`, solo lectura), api_1 = api_2: `content.json` `08c8c415…` (109 fichas, 52 libros, `idsSha` `33f443b0…` = DEPLOY-01; el sha cambió desde DEPLOY-01 por la regeneración TTS de Cavafis), `royalties.db` quick ok, 0001–0004, 0 derechos, historial 0, 12 triggers, tablas económicas 0; `events.db` 0 `econ_events`; 0 obras con sello.
- Respaldo `structured-20261028T153859Z-c295de39` (snapshot `f162f574`): `result ok`, 0 avisos. Restauración aislada en contenedor sin red: **idéntica al vivo**.

## D. Imágenes y servicios
| Control | api | front |
|---|---|---|
| Construcción | `git -c core.autocrlf=false archive 41b1bc7` (sin `.env`, `data/`, `data-critical/`; 0 CR) + `docker build --pull`, `GIT_SHA=41b1bc7`, `RELEASE_TAG=edinf-41b1bc7` | `docker build --pull -f Dockerfile.front` |
| Contenido | `attachImprints`, `textEncoding.js`, migraciones 0001–0004 | chunks `InformesRegalias-DSSAA6RV.js`, `AdminEditoriales-ALfvngbU.js` |
| Trivy 0.69.3 `HIGH,CRITICAL --ignore-unfixed` (`.trivyignore`) | **0** (479 objetivos) | **0** |
| Tarball sha256 | `a1b880a2e35b4821…` | `92a4f3caa83a0b95…` |
| `sha256sum -c` / ID tras `docker load` | OK / `0dc5fc1e0f50` | OK / `a00873c4b087` |

- Ensayo sin red sobre copia de la restauración PRE: imagen nueva y anterior abren la base, 0 migraciones aplicadas, `integrity ok`, sha de la base sin cambio.
- Rollback: etiquetas `rollback-pre-edinf01` (api `423251d0b5c2`, front `d8ba20851d7d`), override `.bak-pre-edinf01-20261028T154552Z`, `/root/chp-edinf01/ROLLBACK.txt`.

| Paso | Hora (UTC) | Gate |
|---|---|---|
| drain api_1 (edge) | 15:46 | 20/20 sondas a api_2 tras 65 s |
| api_1 (línea 40) | 15:47:40 → healthy 15:47:52 | **paso separado**: 0 `[ERROR]`, sin migración, ingest/enforce sin definir, `/api/health/ready` 200, anónimo 401, huella = PRE, 0 × 5xx en el edge |
| rejoin api_1, drain api_2 | 15:49 | 20/20 a api_1 |
| api_2 (línea 85) | → healthy 15:50:29 | paso separado: 0 errores, sin migración, ready 200, 401, huella = api_1, 0 × 5xx |
| rejoin api_2, front (línea 130), edge | 15:51:11 | `nginx -t` ok (solo `ssl_stapling` de Studio, previo), reload; pool 10/10 |

- Override final `9a5c76b2…`: `diff` con la copia PRE = solo las 3 líneas de imagen. Sin cambios de flags, mounts ni edge.
- **Drenaje por réplica**: 0 × 5xx en todo el despliegue (DEPLOY-01 tuvo 44 × 502 sin drenaje).

## E. Smokes productivos (sin escrituras)
**Anónimo — GREEN:** inicio 200; la entrada `index-CJDvF3uF.js` referencia `AdminDashboard-Df_KcXfB.js` y `AdminEditoriales-ALfvngbU.js`; 401 en informe JSON/CSV(+sello)/HTML, publishers, cierres y con `x-user-id` falsificado.

**Administración — GREEN** (sesión de la titular en Chrome; solo consultas; sin INS, cierres ni guardados):
| Comprobación | Resultado |
|---|---|
| Informes · octubre 2026 | PROVISIONAL (sin INS), NO EXIGIBLE, vista previa, 0 obras, conciliado; referencia `5c426f8df557…` = la de las capturas del 28/10 (no cambió) |
| Estado vacío | «Sin lecturas cualificadas en este mes…»; secciones A–D presentes; sin desbordamiento |
| Filtros | editorial + «sin sello»: 0 obras, total y referencia intactos; sello disponible (catálogo actual) con «Sin sello asignado» |
| Trimestres | Q4 PROVISIONAL (incompleto), faltan 10/11/12, sello no reconstruible (filtro → 400 `imprint_not_historical`); Q3 incompleto |
| CSV / HTML | 200; BOM `ef bb bf`; filtros, «Dimensión sello», ámbito «Periodo completo», NO EXIGIBLE, referencia; HTML sin `<script>` |
| Privacidad | sin correos ni identificadores de usuario/sesión |
| Editoriales · Chibalete Editores | **52 libros** (= `bookCount` 52 = catálogo canónico, sin duplicados) · 57 recursos aparte; sellos registrados «Chibalete Editores» 0 y «Estado Sólido» 0; **52 en «Sin sello asignado»**; todos «Sin ISBN» |
| Navegación | «Ficha» abre el editor existente con la obra cargada (sello vacío) y quita `?editar`; atrás vuelve al catálogo; «Derechos» abre la ficha con la editorial |
| Lectura | ficha pública del libro: preflight de la app 200, «Leer Ahora» y «Leer en PDF». El visor no se abrió (para no generar progreso ni telemetría de lectura) |
| Sin operación económica | 0 cierres, 0 INS de 2026-10 |

**Mediación y lectura — PENDIENTE (no observado en producción).** Sin sesiones reales de esos roles. Cobertura que no lo sustituye: 403 con sesiones reales en el laboratorio sobre el mismo código (`/api/admin/publishers`, `/:id`, informe), anónimo 401 en producción y `royaltyReportsHttp` en CI.

**TXT-UTF8-GUARD-01:** verificado en la imagen (`server/lib/textEncoding.js`) y en el laboratorio (415). **No ejercitado en producción** (exigiría una subida).

## F. Integridad y respaldo POST
- Huella final api_1 = api_2 = **PRE idéntica** (contenido, atribuciones editoriales, titulares, 0 derechos, historial 0, 0 INS/cierres/movimientos/rule_sets, 0 `econ_events`, stores y padrón con el mismo sha).
- APIs: 0 `[ERROR]`, 0 `[WARN]`, 0 reinicios. Edge desde el despliegue: 85 × 200, 41 × 304, 7 × 401, 1 × 400 (prueba del sello en Q4), **0 × 5xx**, **0 escrituras** (POST/PUT/PATCH/DELETE).
- `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` sin definir (= off) en las dos réplicas. Studio Editor BI sin tocar.
- Respaldo POST `structured-20261028T155534Z-359911fe` (snapshot `450d87b2`): `result ok`, 0 avisos. Restauración aislada: **idéntica al vivo**. La imagen anterior abre la base POST (rollback compatible).

## G. Rollback y riesgos residuales
- Rollback (`/root/chp-edinf01/ROLLBACK.txt`): restaurar el override `.bak-pre-edinf01-20261028T154552Z`; drenar y recrear api_1, validar, rejoin; igual api_2; front + `nginx -t` + reload. Sin migraciones que revertir.
- Riesgos:
  1. **Disco 5,5 G libres (95 %).** `/root/chp-edinf01/` ocupa 325 MB (tarballs y restauraciones); con `/root/chp-dep01/` y las imágenes de rollback acumuladas, su limpieza requiere autorización.
  2. Mediación y lectura sin observación productiva (§E).
  3. TXT-UTF8-GUARD-01 cambia la subida de TXT: los no UTF-8 se rechazan con 415 y un mensaje de cómo guardarlos en UTF-8.
  4. Sello sin historial (no se congela en cierres) e ISBN fuera del modelo: decisiones pendientes, fuera de esta unidad.
  5. Deudas previas sin cambio: keepalive edge↔Node; excepción zod `CVE-2023-54404` (caduca 2026-11-23).

## H. Commits documentales
Este documento y sus capturas (`editoriales_informes_deploy_01/`).

## I. Veredicto
**GREEN_PRODUCTIVO** en el alcance autorizado: api y front `edinf-41b1bc7` healthy, 0 × 5xx en el cambio, Informes y Editoriales funcionales para administración, anónimo 401, datos idénticos a PRE, respaldos PRE y POST restaurados idénticos, ingesta y cumplimiento off. **Pendiente, sin declararlo verificado:** observación de mediación y lectura con sesiones reales.
