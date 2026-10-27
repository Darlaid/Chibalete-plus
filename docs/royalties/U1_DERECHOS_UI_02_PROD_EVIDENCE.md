# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / U1 · DERECHOS-UI-02 · Despliegue productivo de la interfaz de derechos

**Fecha:** 2026-10-27 (UTC) · **Imagen desplegada:** `chibalete/front:derechos-f3e0256` (`a2305076362e`) · **Código:** `f3e0256` · **Evidencia previa:** `U1_DERECHOS_UI_01.md`
**Autorización:** GO para desplegar exclusivamente U1. No autoriza la ingesta económica ni el cumplimiento de derechos.

**Veredicto:** **GREEN_PRODUCTIVO** en el alcance desplegado:
- solo se desplegó el front;
- smokes anónimos y administrativos en verde, sin escrituras;
- datos intactos, con respaldos PRE y POST restaurados idénticos al vivo;
- ingesta y cumplimiento apagados.

**Pendiente, sin inferirlo como aprobado:** la observación con sesiones reales de mediación y lectura (§E.3). El servidor no cambió y sus 403 están verificados en el laboratorio, pero no se observaron en producción.

## A. Baseline y CI

- HEAD `3b56c42` igual al remoto; código `f3e0256` con CI 10/10 en verde.
- **Diferencia ejecutable entre producción (`catalogos-b3dd8a9`) y `f3e0256`: solo el frontend de U1.** Los otros cambios son scripts del laboratorio y pruebas, que no entran en las imágenes, y un script de prueba en `package.json`.
- **Se desplegó solo el front; la API sigue en `catalogos-b3dd8a9`.**

## B. Imagen y seguridad

| Control | Resultado |
|---|---|
| Construcción | `git archive f3e0256` (sin `.env`, `data/` ni `data-critical/`) + `docker build --pull -f Dockerfile.front`. `Dockerfile.front` y `nginx.prod.conf` iguales a HEAD; base `nginx:1.30-alpine` fijada por digest, la misma que producción |
| Contenido | Bundle con `AdminDerechos-CvaN0G1D.js`, `SubirContenido-SuYyyPAe.js` y `AdminEditoriales-YKK1gYJ0.js`; sin directorios de datos |
| Trivy 0.69.3 | `HIGH,CRITICAL`, `--ignore-unfixed`, `.trivyignore` del repo: **0** |
| Tarball | `front-derechos-f3e0256.tar.gz`, sha256 `0c0cd0c9bf5c5810…`. `sha256sum -c` OK en el VPS; `docker load` → `a2305076362e` (esperado) |

## C. Respaldo PRE

- **Preflight (solo lectura):**
  - api_1, api_2 y front en `catalogos-b3dd8a9` (`f8812c438bab` / `a3fed246dd15`), healthy, 0 reinicios.
  - Override `e9b904361d92…`, líneas 40, 85 y 130.
  - `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` sin definir (= off) en las dos réplicas.
  - 7,9 G libres.
- **Huella PRE** (`/root/chp-u1/snapshot-pre.json`, desde api_2): igual al cierre de F1-C salvo el padrón (`lastLoginAt` de accesos normales).
  - `content.json` `9faaf68566e513f0`: 109 fichas, 52 libros, todas con editorial, 0 `imprint`.
  - `royalties.db`: `quick_check ok`, migraciones 0001–0003, **0 `rights_versions`**, historial 0.
  - `events.db`: **0 `econ_events`** y 0 `econ_tick`.
  - Accesos, grupos y colegios con los mismos hashes.
- **Respaldo PRE:** `structured-20261027T151809Z-1770095c` (snapshot `81a711cc`): `result ok`, 32 stores, 0 avisos; `royalties.db`, `events.db` y `content.json` `integrity ok`.
- **Restauración aislada** (`/root/chp-u1/restore-pre-3dka/`, comprobación en un contenedor `catalogos-b3dd8a9` **sin red**): **idéntica al vivo**.

## D. Despliegue

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Rollback preparado | 15:19:31 | Etiqueta `chibalete/front:rollback-pre-u1` (`a3fed246dd15`); override `.bak-pre-u1-20261027T151931Z`; `/root/chp-u1/ROLLBACK.txt` |
| Override | 15:19:53 | Solo cambia la **línea 130** (`front:catalogos-b3dd8a9` → `front:derechos-f3e0256`); `diff` de una línea; override `e43818e4b17e…` |
| front | 15:19:53 → healthy 15:20:02 | `docker compose up -d --no-deps front`; `nginx -t` OK |
| edge | 15:20:04 | `nginx -t` OK (solo los avisos `ssl_stapling` de Studio, preexistentes); `nginx -s reload`; healthy |

- API sin tocar, sin migraciones y sin cambios de datos.
- Público tras el despliegue:
  - inicio 200;
  - la entrada `index-Ctw6dyo4.js` referencia `AdminDerechos-CvaN0G1D.js`;
  - anónimo **401** en `GET /api/admin/rights/x`, `…/eligibility`, `POST …/versions`, `/api/content/my-catalog` y `/api/admin/publishers`.

## E. Smokes y permisos

### E.1 Anónimo — GREEN

Ver §D: 401 en las 5 rutas, incluido el POST de derechos.

### E.2 Administración (sesión abierta por la titular en Chrome; sin guardar nada) — GREEN

| Comprobación | Resultado |
|---|---|
| Catálogo administrativo «Libros (52)» | **52 botones «Derechos»**, uno por libro |
| «Recursos (57)» | **0 botones** |
| Botón «Derechos» de «La metamorfosis» | Abre `#/admin/derechos/content-1765751139919`: título, identificador, Franz Kafka, `libro`, `disponible`, editorial responsable Chibalete Editores |
| Obra sin Acta | «**No elegible.** Motivos: No hay ninguna versión de derechos registrada.» · cumplimiento **off** («se registran, pero aún no restringen el acceso») · historial: «Sin versiones registradas: la obra no tiene régimen de derechos.» |
| Formulario preparado sin guardar | Referencia de prueba «SMOKE-NO-GUARDAR», titular Chibalete Editores al 50 %. «Registrar versión» **bloqueado en el cliente** con 8 motivos concretos (fechas, estados, los 7 permisos sin decidir, «Las participaciones suman 50 %…»); el resumen de errores recibe el foco. Un espía en la página registró **0 peticiones no GET**. Se canceló |
| Tras cancelar | La API devuelve 0 versiones, `NO_RIGHTS_VERSION`, cumplimiento `off`. Censo de editoriales sin cambios: 52/52, 0 sin editorial, 0 desconocidas |

### E.3 Mediación y lectura — PENDIENTE (no observado en producción)

- Solo había sesión de administración.
- **Tráfico real desde el despliegue:** 66 respuestas en el edge (53 × 200, 10 × 401, 2 × 304), casi todas de esta verificación; 1 preflight de lectura (200). No basta para concluir nada sobre los lectores.
- **Cobertura disponible, que no sustituye la observación productiva:**
  - la API, sus guardas y el preflight de acceso no cambiaron (misma imagen `catalogos-b3dd8a9`, cuyos 403 se observaron con sesiones reales en CATÁLOGOS-05);
  - laboratorio `chp-u1lab` (`U1_DERECHOS_UI_01.md` §E): mediación y lectura redirigidas desde `/admin/derechos/…`, 403 en GET, elegibilidad y POST, y sin datos contractuales en `my-catalog`, `/api/content` ni el preflight.
- **Para cerrarlo**, con una sesión real de cada rol y sin escribir nada:
  1. `#/admin/derechos/<id>` redirige.
  2. `GET /api/admin/rights/<id>` → 403.
  3. Un libro propio se abre con normalidad.

## F. Integridad

- **Huella final** (desde api_1 y api_2): **igual a la PRE** en catálogo, `royalties.db` (0 versiones, mismas 3 migraciones, historial 0), `events.db` (0 `econ_events`) y en los almacenes de accesos, grupos y colegios.
- **Única diferencia, el padrón:** 670 = 670 usuarios, 0 altas, 0 bajas. El único campo cambiado es `lastLoginAt` de **1** usuario: el inicio de sesión de administración del smoke.
  - Se comparó con la copia restaurada del PRE, imprimiendo solo nombres de campo.
- **Escrituras en la ventana** (logs de ambas réplicas desde el despliegue): ninguna sobre contenido, editoriales, accesos, grupos o colegios. Solo el `POST /api/admin/rights/x/versions` anónimo de la verificación (401). Ninguna línea `[RIGHTS]`.
- `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` siguen sin definir (= off) en las dos réplicas.

## G. Respaldo POST y rollback

- **Respaldo POST:** `structured-20261027T152911Z-144fe67a` (snapshot `60bcc856`): `result ok`, 32 stores, 0 avisos.
- **Restauración aislada** (`/root/chp-u1/restore-post-WFZ5/`, contenedor sin red): **idéntica al vivo**.
- **Rollback disponible** (`/root/chp-u1/ROLLBACK.txt`):
  - restaurar el override `.bak-pre-u1-20261027T151931Z` (línea 130 → `front:catalogos-b3dd8a9` = `rollback-pre-u1`);
  - `docker compose up -d --no-deps front`;
  - `nginx -t` y recarga del edge.
  - Sin datos ni esquema que revertir.

## H. Estado del VPS

- **Contenedores:** api_1 y api_2 `catalogos-b3dd8a9`, front `derechos-f3e0256` y edge, todos healthy y con 0 reinicios.
- **Errores:** 0 errores en las API y 0 respuestas 5xx en el edge desde el despliegue.
- **Studio Editor BI** sin tocar (Up 10 días).
- **Disco:** 7,7 G libres (93 %). Sin limpiezas Docker; se conservan las imágenes anteriores (`catalogos-b3dd8a9`, `editoriales-beb11e4`, `rollback-pre-*`).
- **Evidencias** en `/root/chp-u1/`:
  - huellas: `snapshot-pre.json`, `snapshot-final-chibalete_api_1.json`, `snapshot-final-chibalete_api_2.json`, `snapshot-live-post.json`, `snapshot-restore-pre.json`, `snapshot-restore-post.json`;
  - scripts `u1_snapshot.cjs` y `u1_restore_check.cjs`;
  - tarball, `SHA256SUMS` y `ROLLBACK.txt`;
  - restauraciones `restore-pre-3dka/` y `restore-post-WFZ5/`.
- **Deudas que siguen abiertas, sin cambios:**
  1. Desajuste de keepalive entre el edge y Node (502 esporádicos).
  2. Excepción zod `CVE-2023-54404` en la API, que caduca el 2026-11-23.
  3. Disco al 93 %.

## I. Documentación

Este documento y la fila U1 del seguimiento.

## J. Veredicto

**GREEN_PRODUCTIVO** para la interfaz de derechos:
- desplegada solo con el front;
- funcional para administración: botón en los 52 libros y en ningún recurso, página de la obra, veredicto y formulario sin guardar;
- sin escrituras en producción;
- 0 versiones de derechos, 0 eventos económicos;
- ingesta y cumplimiento off;
- respaldos PRE y POST restaurados idénticos al vivo.

**Queda abierta:** la observación con sesiones reales de mediación y lectura (§E.3). **Registrar Actas reales** requiere instrucciones de Dirección. No se inicia U2.
