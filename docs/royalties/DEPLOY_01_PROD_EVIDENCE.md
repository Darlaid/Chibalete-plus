# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / DEPLOY-01 · Puesta en producción del circuito de regalías

**Fecha:** 2026-10-27 (UTC) · **Código:** `c8f491e` (= código de `a6fda3b`, CI 10/10) · **Imágenes:** `chibalete/api:regalias-c8f491e` (`423251d0b5c2`), `chibalete/front:regalias-c8f491e` (`d8ba20851d7d`)
**Autorización:** desplegar U2–U5 y CLOSE-GUARD-01 dejando «Panel Admin → Informes» disponible, **sin operación económica real**. No incluye ingesta, enforcement, INS reales, cierres ni liquidaciones.

## A. Baseline y CI

- HEAD = remoto = `c8f491e`, árbol limpio. Código `a6fda3b` con CI 10/10 (`identity-preflight` incluido); `c8f491e` solo añade documentación.
- **Producción previa:**
  - api_1/api_2 `catalogos-b3dd8a9` (`f8812c438bab`) y front `derechos-f3e0256` (`a2305076362e`); edge healthy; 0 reinicios;
  - override `e43818e4…`, imágenes en las líneas 40/85/130;
  - `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` **sin definir (= off)**; `NODE_ENV=production`;
  - 7,7 G libres (93 %).
- **Delta ejecutable:** `server/` (U2–U5, migración 0004, CLOSE-GUARD-01), el front (pestaña «Informes») y una línea de script en `package.json` (sin dependencias nuevas). `Dockerfile.api`, `Dockerfile.front` y `nginx.prod.conf` son iguales a producción.

## B. Respaldo PRE y restauración

- **Huella PRE** (`dep01_snapshot.cjs`, de solo lectura, desde api_2), igual al cierre de U1:
  - `content.json` `9faaf68566e513f0` (109 fichas, 52 libros);
  - `royalties.db` `quick ok`, migraciones 0001–0003, 0 versiones de derechos, historial 0, 4 triggers, tablas de 0004 inexistentes;
  - `events.db` 0 `econ_events` y 0 `econ_tick`.
- **Respaldo PRE:** `structured-20261027T224103Z-668c9bfb` (snapshot `2a4d18bd`): `result ok`, 0 avisos.
- **Restauración aislada** (`/root/chp-dep01/restore-pre-Eooy/`, comprobada en un contenedor `catalogos-b3dd8a9` **sin red**): **idéntica al vivo**.

## C. Imágenes y seguridad

| Control | api | front |
|---|---|---|
| Construcción | `git archive c8f491e` (sin `.env`, `data/` ni `data-critical/`) + `docker build --pull -f Dockerfile.api`, con `GIT_SHA=c8f491e` y `RELEASE_TAG=regalias-c8f491e` | `docker build --pull -f Dockerfile.front` |
| Contenido | Migraciones 0001–0004, módulos U2–U5, 860 MB (igual que la imagen de producción) | Chunk `InformesRegalias-Df1jiDHi.js` |
| Trivy 0.69.3 `HIGH,CRITICAL --ignore-unfixed` (`.trivyignore` del repo) | **0** | **0** |
| Tarball sha256 | `441ce4005d0b9d04…` | `59d4daa70800abf5…` |
| `sha256sum -c` en el VPS / ID tras `docker load` | OK / `423251d0b5c2` | OK / `d8ba20851d7d` |

- **Rollback preparado:**
  - etiquetas `chibalete/api:rollback-pre-dep01` (`f8812c438bab`) y `chibalete/front:rollback-pre-dep01` (`a2305076362e`);
  - copia del override `.bak-pre-dep01-20261027T224916Z`;
  - `/root/chp-dep01/ROLLBACK.txt`.
- No se borró ninguna imagen ni respaldo, y no hubo limpiezas Docker.

## D. Migración 0004

- **Ensayo previo** sobre una copia de la restauración PRE, en contenedores sin red:
  - la imagen nueva aplica **solo** `0004_closes`, con 0 filas en `rule_sets`, `period_inputs`, `closes` y `adjustments`, 12 triggers e `integrity ok`;
  - volver a ejecutarla no aplica nada;
  - **la imagen anterior abre la base migrada** con normalidad (migraciones, titulares, índice de derechos, integridad). El rollback a `catalogos-b3dd8a9` **no exige revertir el esquema**.
- **En producción:** api_1 registró `[royalties-migrate] applied 0004_closes` **una vez** (22:49:33Z). api_2 no la reaplicó. Mismo archivo (inodo 817635) y mismo DDL (`bcefc2dbc84c`) en las dos réplicas.
- **La migración no creó INS, cierres, movimientos ni rule_sets:** las 4 tablas tienen 0 filas.

## E. Despliegue

| Paso | Hora (UTC) | Gate |
|---|---|---|
| api_1 (línea 40) | 22:49:23 → healthy 22:49:38 | Migración 0004 una vez; 0 errores; 0 reinicios; ready 200; ingesta y cumplimiento sin definir; anónimo 401; huella = PRE + tablas 0004 vacías. **Revisado en un paso separado antes de tocar api_2** |
| api_2 (línea 85) | 22:50:35 → healthy 22:50:54 | Sin migración; 0 errores; huella = api_1; **0 5xx en el edge** durante el cambio |
| front (línea 130) | 22:51:27 → healthy 22:51:39 | `nginx -t` OK |
| edge | 22:51:40 | `nginx -t` OK (solo los avisos `ssl_stapling` de Studio, preexistentes); `nginx -s reload`; healthy |

- Override final `cda4bae4…`: el `diff` con la copia PRE muestra solo las 3 líneas de imagen. Sin cambios en flags ni en mounts.
- **Ventana de api_1:** 44 × 502 en el edge, todos en el mismo segundo (22:49:27Z), todos `POST /api/events` («upstream prematurely closed / connection reset») mientras se recreaba el contenedor. Es la ventana de corte de una réplica, sin drenaje; ningún 5xx después.

## F. Smokes de Informes y permisos (sin escrituras)

**Anónimo — GREEN**
- Inicio 200; la entrada `index-CF8HTP-2.js` carga `AdminDashboard-C2xk8d6N.js`, que referencia `InformesRegalias-Df1jiDHi.js`.
- **401** en informe JSON, CSV y HTML, cierres, INS (GET), vista previa, derechos y `my-catalog`, y en `POST` de INS y de cierres. Un `x-user-id` falsificado da 401.

**Administración — GREEN** (sesión abierta por la titular en Chrome; solo consultas; **no se usaron los botones de INS ni de cierre**)

| Comprobación | Resultado |
|---|---|
| Pestaña «Informes» junto a Impacto & Inteligencia, Gestión de Ventas y Estado de Grupos | ✓ |
| Octubre 2026 | **PROVISIONAL (sin INS)**, NO EXIGIBLE, vista previa, «Sin obras en el periodo» (0 versiones de derechos y 0 eventos económicos ⇒ **Q = 0** en todo), conciliado, `rs-2026-01-v1`, corte 2026-11-01T05:00Z |
| Trimestre 2026-Q4 | **PROVISIONAL (incompleto)**, meses faltantes 2026-10/11/12, 0 cierres, totales 0, NO EXIGIBLE. 2026-Q3 también incompleto |
| CSV | 200, `no-store`, UTF-8 con BOM, referencia y NO EXIGIBLE |
| HTML imprimible | Abierto en una pestaña: cartel NO EXIGIBLE, referencia, meses, «Sin datos de lectores»; CSP `default-src 'none'`, sin `<script>` |
| Privacidad | 0 correos y ningún identificador de usuario ni de sesión en JSON, CSV ni HTML |
| Sin operación económica | Lista de cierres `[]`; INS de 2026-10 `[]` |

- **Observación cosmética (no bloqueante):** en un trimestre sin cierres, «Fórmula S» aparece vacía (la fórmula se toma de los cierres).

**Mediación y lectura — PENDIENTE (no observado en producción).** No había sesiones reales de esos roles. **No se declara verificado.**
- Cobertura que no la sustituye:
  - 403 con sesiones reales en los laboratorios `chp-u1lab` (U5) y `chp-u6lab` (U6), sobre el mismo código;
  - `royaltyReportsHttp` en CI.
- **Para cerrarlo**, con una sesión real de cada rol y sin escribir nada:
  1. `GET /api/admin/royalties/report?month=2026-10` → 403.
  2. La pestaña «Informes» no está accesible (el Panel Admin es solo de administración).
  3. Un libro propio se abre con normalidad.

## G. Comparación de integridad

- **Huella final** (api_1 y api_2) frente a la PRE:
  - `content.json`, `events.db` y el resto de `royalties.db` (titulares, 0 derechos, historial 0, integridad) **idénticos**;
  - **cambios esperados de 0004:** las 4 tablas nuevas con 0 filas, 12 triggers y la migración `0004_closes` registrada.
- **Padrón:** 672 = 672, 0 altas y 0 bajas. Único campo cambiado: `lastLoginAt` de **1** usuario (inicio de sesión normal en la ventana). Comparado con la restauración PRE, imprimiendo solo nombres de campo.
- **Escrituras en la ventana:** las únicas en rutas de datos son los 2 `POST` anónimos de la verificación (401).
  - El edge registra además 3 × `POST /api/library/personal/references` (201) a las 22:52Z: actividad normal de la biblioteca personal de un usuario, ajena a la verificación y al circuito económico.
  - Ningún INS, cierre, movimiento, versión de derechos, evento económico ni cambio de contenido.
- `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` siguen sin definir (= off) en las dos réplicas.

## H. Respaldo POST y restauración

- **Respaldo POST:** `structured-20261027T225550Z-8a7e4da6` (snapshot `7f8bf51b`): `result ok`, 0 avisos.
- **Restauración aislada** (`/root/chp-dep01/restore-post-1Yui/`, contenedor sin red): **idéntica al vivo**; `royalties.db` con 0001–0004, 0004 vacía, 12 triggers, `quick ok`.
- **Rollback comprobado de nuevo:** la imagen anterior (`catalogos-b3dd8a9`) abre la base POST restaurada sin errores.

## I. Riesgos residuales y rollback

- **Estado final:**
  - api_1/api_2 `regalias-c8f491e` y front `regalias-c8f491e`, healthy, 0 reinicios, **0 errores** desde el despliegue;
  - edge desde el front: 132 × 200, 65 × 304, 11 × 401, 3 × 201 y **0 × 5xx**; preflight de acceso y archivos 200/304;
  - Studio Editor BI sin tocar (Up 11 días);
  - disco **6,7 G libres (94 %)**.
- **Rollback** (`/root/chp-dep01/ROLLBACK.txt`): restaurar el override `.bak-pre-dep01-20261027T224916Z` y recrear api_1, validar, api_2 y el front, con `nginx -t` y recarga del edge. **No se revierte el esquema ni se restaura `royalties.db`** sin autorización expresa: la imagen anterior es compatible con la base migrada (ensayado dos veces).
- **Riesgos:**
  1. **Disco al 94 %.** Los tarballs (180 MB) y las dos restauraciones (76 MB cada una) siguen en `/root/chp-dep01/` como evidencia; su limpieza requiere autorización.
  2. **Ventana de corte de una réplica:** 44 × 502 en `POST /api/events` durante 1 s. Recomendación para futuros despliegues: drenar la réplica en el edge antes de recrearla.
  3. Mediación y lectura sin observación productiva (§F).
  4. Deudas que siguen abiertas, sin cambios: desajuste de keepalive entre el edge y Node; excepción zod `CVE-2023-54404` (caduca el 2026-11-23).
  5. Operación económica **no activada**: 0 reglas pagadas (P9), INS (P11), D1 provisional y D4/D5 pendientes. Los cierres técnicos solo son posibles para meses terminados (CLOSE-GUARD-01), y su uso real requiere autorización.

## J. Commits documentales

Este documento y la fila DEP01 del seguimiento.

## K. Veredicto

**GREEN_PRODUCTIVO** en el alcance autorizado:
- U2–U5 y CLOSE-GUARD-01 desplegados;
- «Informes» funcional para administración, con vista mensual PROVISIONAL, trimestre incompleto, CSV y HTML;
- anónimo 401;
- migración 0004 aplicada una vez y vacía;
- datos intactos salvo el esquema esperado y un `lastLoginAt`;
- respaldos PRE y POST restaurados idénticos al vivo;
- ingesta y cumplimiento off.

**Pendiente, sin declararlo verificado:** la observación de mediación y lectura con sesiones reales. No se activó la ingesta ni se registraron INS, cierres o liquidaciones.
