# VPS-STORAGE-05 — Política de retención: producción + rollback inmediato

**Fecha:** 2026-10-28 (UTC, 19:05–19:46Z) · **Baseline:** `ba0296b` · **Producción:** `edinf-41b1bc7` · VPS `srv1179443`
Retención aplicada a las imágenes Docker de Chibalete+: se conservan la producción vigente y el despliegue inmediatamente anterior; se retiran las demás imágenes `chibalete/*` sin dependencias. 23 lotes de máx. 4 imágenes, `docker rmi` sin forzar por etiqueta exacta. Sin `prune`, sin tocar tarballs, respaldos, datos, configuración, Studio Editor BI ni imágenes de otros proyectos; sin reinicios ni despliegues.

## A. Inventario inicial
- `/` 16 G libres (16 827 187 200 B), uso 86 %. 11/11 contenedores Up (ninguno detenido). HEAD `ba0296b`. Último respaldo estructurado 18:02Z correcto; timers de respaldo activos.
- 154 imágenes en total; `chibalete/*`: **95 ImageID** (75 etiquetas api + 63 front) — `inventario.tsv` (id, fecha, tamaño exclusivo, protegida, etiquetas).
- Otras (no Chibalete+, fuera de alcance): Studio Editor BI (`deploy-studio_bi_*`, `studio-bi-*`, 7 etiquetas), observabilidad (`prom/*`, `grafana`, `cadvisor`), `nginx:alpine` (edge), `python:3.12-slim`, `ubuntu:24.04`.

## B. Versiones vigente y anterior
- **Vigente:** `docker-compose.override.yml` líneas 40/85/130 y contenedores `api_1`/`api_2`/`front` → `chibalete/api:edinf-41b1bc7` (`0dc5fc1e0f50`) y `chibalete/front:edinf-41b1bc7` (`a00873c4b087`).
- **Inmediatamente anterior** (demostrado, no deducido por nombre): `docker-compose.override.yml.bak-pre-edinf01-20261028T154552Z` (líneas 40/85/130) y `/root/chp-edinf01/ROLLBACK.txt` → `chibalete/api:regalias-c8f491e` = `rollback-pre-edinf01` (`423251d0b5c2`) y `chibalete/front:regalias-c8f491e` = `rollback-pre-edinf01` (`d8ba20851d7d`).
- `chibalete/api:rollback-current` apuntaba a `cf36852` (2026-08-15): alias obsoleto, no es el rollback inmediato y ningún procedimiento vigente lo usa → retirado (lote 3).

## C. Imágenes protegidas (conservadas)
| ImageID | Etiquetas | Motivo |
|---|---|---|
| `0dc5fc1e0f50` | api `edinf-41b1bc7` | producción (api_1, api_2) |
| `a00873c4b087` | front `edinf-41b1bc7` | producción (front) |
| `423251d0b5c2` | api `regalias-c8f491e`, `rollback-pre-edinf01` | rollback inmediato |
| `d8ba20851d7d` | front `regalias-c8f491e`, `rollback-pre-edinf01` | rollback inmediato |
| `9141cfb4fa96` | front `hf4a-r2-coherence-82fba6e` | **excepción**: referenciada por `docker-compose.yml` base (línea 44, sobrescrita por el override) — ver G |
| Studio Editor BI, observabilidad, `nginx:alpine`, `python`, `ubuntu` | — | otros servicios/proyectos |

Tarballs del rollback conservados y verificados: `/root/chp-dep01/api-regalias-c8f491e.tar.gz` y `front-regalias-c8f491e.tar.gz` (íntegros, capas idénticas a la imagen).

## D. Retirada por lote
Por imagen (`recheck5.py`, por ImageID): todas sus etiquetas `chibalete/api|front:*`; no protegida; 0 contenedores (por `ancestor` y por ImageID, incluidos detenidos); ninguna etiqueta en `docker-compose.yml`/`override` vivos; ausente de `ROLLBACK.txt`; producción y rollback inmediato presentes. Luego `docker rmi` de cada etiqueta, comprobación de que el ImageID ya no existe y medición con `df`. Tras cada lote, validación automática (`run5.sh`); cualquier fallo detiene la ejecución.

| Lote | Imágenes (etiquetas) | Δ disco |
|---|---|---|
| 1 | api 7a44d8f, c4d0a8c, ddfdc01, eec39e9 (+`-candidate`) | +2,18 GiB |
| 2 | api 89407f0, d8c252f-candidate, 2610d4c, f885e31 | +1,64 GiB |
| 3 | api e998300, 967ddd5, cf36852 (+`rollback-current`), 0ff76b6 | +2,28 GiB |
| 4 | front m1a-0ff76b6; api c9f323e, 8ed4e5e, 679b036 | +1,64 GiB |
| 5 | front lib01-679b036, lib01-ffc90a1; api ffc90a1, acc2227 | +1,10 GiB |
| 6 | api 910c735, c47f7f4, e70c0f1; front cover-e70c0f1 | +1,10 GiB |
| 7 | front obj-ab380ed, nav-356f2fe, ret-162c3e6 (+`rollback-20260903-…`), lupub-9842238 | +0,02 GiB |
| 8 | front banner-e590ae5, secreset-01; api secreset-01, secreset-02-src | +0,55 GiB |
| 9 | front secreset-02-src; api stage9, stage10, stage11 | +1,10 GiB |
| 10 | front stage11; api stage11d, authz1, authz2 | +1,84 GiB |
| 11 | api authz2b, libvis, readcanon; front libvis | +1,84 GiB |
| 12 | api avscope, aggscope; front aggscope, immsync | +0,56 GiB |
| 13 | api a11yauto-27b89fb, a11yauto-c27916e; front a11yauto (2 etiq.), stickygap | +1,10 GiB |
| 14 | api storewoo, groupwarn, histmetrics-311dc008; front storewoo | +0,66 GiB |
| 15 | front histmetrics-311dc008, histmetrics-4a4d01d (+`rollback-pre-epubui`); api histmetrics1c-wip, histmetrics-4a4d01d (+`rollback-pre-canon2b-f16d048`) | +0,65 GiB |
| 16 | api canon2b, epub3c, defaults; front epubui (cada una con su `rollback-pre-*`) | +1,20 GiB |
| 17 | api b2c, pedvis; front pedvis, epubr1 (+`rollback-pre-*`) | +1,30 GiB |
| 18 | front epubr2, epubreader; api dedupown, epubreader (+`rollback-pre-*`) | +1,10 GiB |
| 19 | api progfix, privacy, epubprog; front epubprog (+`rollback-pre-*`) | +1,65 GiB |
| 20 | api adminepub, contentprotect-2357ea0; front adminepub, librarytabs (+`rollback-pre-*`) | +1,20 GiB |
| 21 | front contentprotect-cp3, cp4, global, final (+`rollback-pre-*`) | +0,02 GiB |
| 22 | front royalties-f1a, secusers-a, selfpw, editoriales (+`rollback-pre-*`) | +0,02 GiB |
| 23 | front catalogos-b3dd8a9, derechos-f3e0256 (+`rollback-pre-u1`, `-dep01`) | +0,01 GiB |
| **Total** | **90 imágenes, 139 etiquetas** | **+24,78 GiB** |

Detalle exacto (ImageID, etiquetas, `docker rmi`, delta por imagen, validación): `docs/ops/vps_storage_05/lote{1..23}.log`. Los deltas desiguales se deben a capas compartidas: una imagen libera su parte cuando desaparece la última que comparte esas capas; los fronts liberan ≈ 5 MiB cada uno.

**Incidencia del lote 1 (explicada).** La validación posterior se detuvo con `datos_iguales=False`. El cambio estaba en `royalties/publishers`: 4 editoriales nuevas creadas desde el panel de administración (`POST /api/admin/publishers` → 201 a las 19:19:05, 19:19:31, 19:19:58 y 19:20:13Z, desde navegador). Es actividad legítima de la aplicación; `docker rmi` no escribe datos. Resto de controles del lote en verde. Se ajustó el control: comparación de datos antes/después de **cada** lote, y una diferencia solo se acepta si el edge registra escrituras de la aplicación (POST/PUT/PATCH/DELETE 2xx) en esa ventana; si no, STOP. Lotes 2–23: datos idénticos sin necesidad de esa excepción. Registro original: `lote1.stop-datos.log`.

## E. Espacio recuperado
- `df /`: **16 827 187 200 → 43 434 405 888 B libres (+24,78 GiB)**; **16 G → 41 G libres, uso 86 % → 62 %** (38 % libre).
- Imágenes: 154 → 22 etiquetas; `chibalete/*`: 95 → 5 ImageID.

## F. Verificación de servicios y rollback
- Tras cada uno de los 23 lotes: 11/11 Up, 0 reinicios, api_1/api_2/front/edge/studio_bi_api healthy, `/api/health/ready` ×2, 0 `[ERROR]`, 0 × 5xx en el edge, ingesta económica y enforcement sin definir (= OFF), 10/10 ImageID protegidos presentes, `docker-compose.yml` y `override` con el mismo sha256, 45/45 tarballs, datos sin cambios (salvo lo explicado en el lote 1).
- Final: front 200, Studio 200; ningún contenedor fuera de Up.
- **Rollback inmediato ejecutable:** `chibalete/api:regalias-c8f491e` arranca Node v20.20.2 y `node --check /app/server/server.js` OK (contenedor efímero `--network none`); `chibalete/front:regalias-c8f491e` pasa `nginx -t` en la red `chibalete_net` (sin red falla igual que el front vigente por no resolver `chibalete_api_1`: es del entorno, no de la imagen). Override `.bak-pre-edinf01-…` y `ROLLBACK.txt` presentes; tarballs del rollback con capas idénticas.

## G. Excepciones conservadas
- `chibalete/front:hf4a-r2-coherence-82fba6e` (`9141cfb4fa96`, ≈ 26 MB exclusivos): la referencia el `docker-compose.yml` base (servicio front, línea 44), sobrescrito por el override. Retirarla requeriría alinear antes el compose base (cambio de configuración, fuera de alcance). El mismo fichero cita `chibalete/api:e6a3f4a` (líneas 67/112), que ya no existía antes de esta unidad.
- Los `.bak` antiguos del override y los directorios `releases/`/`backups/` de `/opt/chibaleteplus` citan imágenes retiradas: son registros de despliegues superados, no procedimientos vigentes; no se tocaron.
- Las imágenes retiradas con tarball (45 tarballs en `/root/chp-*/`) siguen siendo recuperables con `docker load`; las retiradas sin tarball (anteriores a la serie `banner`, `secreset-*`, `stage*`, `authz*`, etc.) no son recuperables bit a bit, conforme a la política aprobada.

## H. Evidencia
Este documento; `docs/ops/vps_storage_05/` (`inventario.tsv`, `lote1..23.log`, `lote1.stop-datos.log`, `run5.sh`, `recheck5.py`, `select5.py`); en el VPS `/root/chp-vps-storage-05/`.

## I. Veredicto
**GREEN.** Retención aplicada: producción + rollback inmediato completo y ejecutable; 90 imágenes históricas retiradas sin incidencias de servicio; +24,78 GiB (uso 86 % → 62 %). Una excepción conservada (front citada por el compose base). STOP: no se amplía a tarballs, restauraciones, logs ni otros directorios.
