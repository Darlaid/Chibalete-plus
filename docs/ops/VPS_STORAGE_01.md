# VPS-STORAGE-01 — Inventario y limpieza segura del VPS

**Fecha:** 2026-10-28 (UTC, 16:22–16:45Z) · **Baseline:** `4154839` · **Producción:** `edinf-41b1bc7` · VPS `srv1179443`
Alcance: inventario de solo lectura y borrado exclusivamente de candidatos de categoría C verificados uno a uno. Sin `docker * prune`, sin tocar imágenes, volúmenes, respaldos, datos, logs activos ni Studio Editor BI, sin reinicios.

## A. Estado inicial
- `/` 106 G, 101 G usados, **5,5 G libres (95 %)**; inodos 31 %.
- Por directorios: `/var` 69 G (de ellos **containerd ≈ 60 G**, `/var/www` 6,2 G, `/var/log` 1,2 G, `/var/lib/docker` 1,1 G, resto de `/var/lib` 0,5 G, `/var/cache` 0,2 G), `/root` 19 G, `/opt` 6,9 G, `/usr` 3,7 G.
- Docker (`docker system df`): 128 imágenes (10 activas) «64,26 GB / 43,5 GB reclamables» (contabilidad inflada por capas compartidas, ver memoria de CHP-STORAGE-01: ≈ 740 MB únicos por imagen api); 11 contenedores; 5 volúmenes; **build cache 22,93 GB, 325 registros, 0 activos**.
- Cron de imágenes: `docker image prune -f --filter until=24h` (sin `-a`: no borra imágenes etiquetadas).

## B. Inventario por categorías
| Cat. | Elemento | Tamaño | Motivo |
|---|---|---|---|
| A | `/var/www/chibalete` (data, data-critical, uploads, audios incl. Cavafis) | 6,2 G | datos y contenido editorial vivos |
| A | `/opt/backups` (`uploads.tar`), `/root/backups`, `/root/apps-spa` | 5,0 + 3,1 + 3,0 G | copias de uploads/respaldos: protegidas por política de la titular |
| A | `/opt/studio-archive`, `/opt/studio-editor-bi*`, `/root/apps-studio-editor`, `/root/.pm2` (PM2 vivo de Studio) | 1,1 G + 2,1 G + 0,3 G | Studio Editor BI |
| A | `/opt/chibaleteplus` (compose, override y sus `.bak`), `/opt/secrets`, `/etc/chibalete-backup` | 0,6 G | configuración y secretos |
| A | volúmenes `chibalete-obs_*` (en uso) y `2026-04-17-210511_{data,uploads}-volume` | 377 MB | volúmenes persistentes (los dos últimos sin contenedor: no se tocan) |
| A | imágenes activas `edinf-41b1bc7` y de rollback (`rollback-pre-*`, `rollback-current`) | — | necesarias para rollback |
| A | restic (snapshots `f162f574`, `450d87b2`…), `/var/cache/chibalete-backup` | — | respaldos |
| A | `/root/chp-dep01/{api,front}-regalias-c8f491e.tar.gz` | 174 MB | copia compacta de la imagen de rollback vigente (`rollback-pre-edinf01`) |
| B | contenedores Chibalete+ (4), Studio (2), observabilidad (5) y sus imágenes | — | en uso |
| B | `/var/log/journal`, `/var/log/syslog` | 0,9 G + 81 MB | logs activos |
| D | demás imágenes Chibalete etiquetadas (~110 IDs, versiones anteriores) | ≈ 35 G reales | no necesarias para el rollback inmediato, pero eliminar una imagen es irreversible (precedente `2945fa8`) → decisión de la titular |
| D | build cache | 22,9 G | solo se libera con `buildx prune` (limpieza Docker global, fuera de alcance) |
| D | 40 tarballs de imagen en `/root/chp-*` (incl. `chp-edinf01`) | 3,8 G | idénticos a imágenes presentes (§C); son la copia **compacta** que haría reversible retirar esas imágenes: borrarlos y conservar las imágenes sería el intercambio equivocado |
| D | 14 `src-*.tar` / `source-*.tar` / `chp-acc2227.tar` | 0,19 G | fuentes de despliegues antiguos; **no reproducibles byte a byte** con `git archive` (original no verificable) |
| D | restauraciones de verificación `restore-*` en `/root/chp-*` (p. ej. `chp-edinf01`, `chp-dep01`: 76 MB c/u) | ≈ 0,15 G por despliegue | son copias de recuperación (y contienen el padrón): no se borran sin autorización |
| D | `/root/deploy` (4,0 G), `/opt/releases` (246 MB), `/root/chp-utf8-02/backup` (audio Cavafis previo) | 4,2 G | despliegues históricos / respaldo de audio |
| D | `syslog.1`–`syslog.4.gz` rotados | 0,19 G | logs archivados: su retención es una política, no una limpieza |
| C | 2 copias de ensayo de `royalties.db` (EDITORIALES-INFORMES-DEPLOY-01) | 221 KB | §D |
| C | caché de apt (5 `.deb` de monarx + 2 índices) | 137 MB | §D |

## C. Duplicados identificados
- **Tarballs de imagen**: 40/40 **idénticos** a la imagen Docker de su etiqueta (mismas capas `rootfs.diff_ids` y misma `created` del config dentro del tar frente a `RootFS.Layers`/`Created`; con el almacén de containerd el ID que muestra Docker es el digest del manifest, por eso se comparó por capas). Detalle por fichero: `/root/chp-vps-storage-01/tar_inventory.txt` (script `tarinv.py`, solo lectura).
- **Copias de ensayo**: `rehearse-IFxy/royalties.db` y `rehearse-post-XfgE/royalties.db` = sha `915d2264…` = `royalties.db` de las restauraciones PRE/POST = snapshots restic `f162f574`/`450d87b2` (presentes).
- **`src-*.tar`**: comparados con `git -c core.autocrlf=false archive <commit>`: 0/13 coinciden → no se consideran duplicados.

## D. Eliminado (evidencia individual)
Comprobado antes de cada lote: sin procesos que los abran (`fuser`), sin montajes (`findmnt`, mounts de contenedores), sin referencias en servicios/cron/compose/rollback, no pertenecen a volúmenes, original o reconstrucción verificados.

**Lote 1 — copias de ensayo** (origen: ensayo de compatibilidad de imágenes del despliegue; reconstrucción: `restic restore` de `f162f574`/`450d87b2`)
| Hora (UTC) | Ruta | Bytes | sha256 (16) |
|---|---|---|---|
| 16:41:58 | `/root/chp-edinf01/rehearse-IFxy/royalties.db` | 110 592 | `915d2264cc366f77` |
| 16:41:58 | `/root/chp-edinf01/rehearse-post-XfgE/royalties.db` | 110 592 | `915d2264cc366f77` |
Directorios vacíos retirados con `rmdir`. Recuperado: 224 KiB.

**Lote 2 — caché de apt** (origen: descargas de apt; reconstrucción: repositorio de apt / regeneración automática de índices)
| Hora (UTC) | Ruta | Bytes | sha256 (16) |
|---|---|---|---|
| 16:42:09 | `/var/cache/apt/archives/monarx-agent_4.3.78-master_amd64.deb` | 5 625 474 | `eae84cc1afc94660` |
| 16:42:09 | `/var/cache/apt/archives/monarx-agent_4.3.81-master_amd64.deb` | 5 630 950 | `fcefcc0d84f80261` |
| 16:42:09 | `/var/cache/apt/archives/monarx-agent_4.3.82-master_amd64.deb` | 5 675 996 | `663c03e36a86590a` |
| 16:42:09 | `/var/cache/apt/archives/monarx-protect-autodetect_5.2.73-master_amd64.deb` | 5 066 | `d185bdfff13c9070` |
| 16:42:09 | `/var/cache/apt/archives/monarx-protect_5.2.73-master_amd64.deb` | 167 642 | `c1b0e9fa73798558` |
| 16:42:09 | `/var/cache/apt/pkgcache.bin` | 62 043 224 | `408815091f144bfd` |
| 16:42:09 | `/var/cache/apt/srcpkgcache.bin` | 61 980 599 | `462b08f5044b43d1` |
- Los paquetes monarx siguen instalados (`dpkg` `ii`, `4.3.82` / `5.2.73`); `monarx-agent.service` estaba ya `disabled`, sin procesos ni entradas de journal (nunca arrancó en este arranque): estado previo, ajeno a la limpieza.
- **Los dos índices se regeneraron al instante** (mismo tamaño, 62 MB c/u) porque la propia verificación ejecutó `apt-cache policy`. Ganancia neta del lote ≈ 17 MB (los `.deb`).

## E. Espacio recuperado
≈ **17 MB netos** (224 KiB + ≈ 16,7 MB de `.deb`). `df` sigue en **5,5 G libres (95 %)**: la limpieza segura dentro de las reglas no cambia el riesgo de disco.

## F. Estado final
- api_1/api_2/front `edinf-41b1bc7`, edge y Studio BI healthy, 0 reinicios; `/api/health/ready` ready en ambas réplicas; front 200, Studio 200; anónimo 401 en informes y catálogo administrativo.
- Ingesta y enforcement sin definir (= off). 0 `[ERROR]`; 0 × 5xx en el edge durante la limpieza (el único 5xx de la última hora es el 502 de login de 16:04:07Z ya documentado en EDINF-ACCESS-PROD-01).
- Datos idénticos al cierre de EDINF-ACCESS-PROD-01 (padrón incluido; 52 libros; 0 `econ_events`).
- Rollback intacto (`rollback-pre-edinf01`, override `.bak-pre-edinf01-…`, `ROLLBACK.txt`, tar de `regalias-c8f491e`); respaldos restic `f162f574`/`450d87b2` presentes; timers `structured-backup` (18:02Z) y `uploads-backup` (03:44Z) programados.

## G. Protegidos y candidatos descartados
Ver §B (A/B/D). Descartados expresamente pese a parecer limpiables: los 40 tarballs (función de retirada reversible), los `src-*.tar` (no reproducibles), las restauraciones de verificación (copias de recuperación), los logs rotados (política de retención), el build cache y las imágenes antiguas (limpieza Docker / irreversibles).

## H. Riesgos residuales y recomendaciones (requieren autorización expresa)
1. **El disco sigue al 95 %.** Las palancas reales, de mayor a menor y todas fuera de esta unidad:
   - **build cache 22,9 G** (`buildx prune` sin filtro; el siguiente build parte de cero; la última vez liberó ~45 G);
   - **retirar imágenes Chibalete antiguas conservando su tarball** (≈ 740 MB cada api; las que tienen tar en `/root/chp-*` se pueden recargar con `docker load`); exige después podar el cache para liberar snapshots de containerd;
   - **restauraciones de verificación** antiguas en `/root/chp-*` (≈ 76 MB c/u, contienen el padrón: conviene retirarlas también por privacidad);
   - política de retención de `journal` y logs rotados.
2. No usar `apt-cache`/`apt` después de borrar sus índices si el objetivo es medir espacio: los regenera.
3. `/root/deploy` (4 G) y los volúmenes huérfanos `2026-04-17-210511_*` necesitan una revisión de propietario antes de cualquier decisión.

## I. Veredicto
**YELLOW.** Limpieza segura completada y verificada sin ningún efecto en servicios, datos, respaldos ni rollback, pero el espacio recuperado es marginal (≈ 17 MB) y el disco sigue al 95 %: todo el espacio significativo está en elementos protegidos o inciertos cuya retirada requiere una decisión expresa (§H).
