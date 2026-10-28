# VPS-STORAGE-03 — Retirada selectiva de imágenes Docker históricas (lote 1)

**Fecha:** 2026-10-28 (UTC, 16:50–17:00Z) · **Baseline:** `6e626ec` · **Producción:** `edinf-41b1bc7` · VPS `srv1179443`
Alcance ejecutado: **un primer lote de 4 imágenes** de Chibalete+ recuperables desde tarball verificado. Sin tocar tarballs, contenedores, volúmenes, datos, configuración ni Studio Editor BI; sin reinicios; sin `prune`.

## A. Inventario de candidatas
- Inventario de las 115 imágenes `chibalete/*` (`/root/chp-vps-storage-03/img_inventory.jsonl`, script `imginv.py`, solo lectura): ID, etiquetas, contenedores (incl. detenidos), referencias en `/opt/chibaleteplus/*` (compose, override y sus `.bak`), `/root/chp-*/ROLLBACK*`, scripts del edge, cron, systemd y runners de backup, y tarball idéntico (VPS-STORAGE-01).
- Imágenes con tarball idéntico: 40. Ninguna usada por contenedores salvo las activas `edinf-41b1bc7`. Sus únicas referencias son `ROLLBACK.txt`/`ROLLBACK.env` de despliegues superados y copias `.bak` del override (procedimientos históricos, no el rollback vigente).
- **Excluidas siempre:** activas (`edinf-41b1bc7`), rollback vigente (`rollback-pre-edinf01` = `regalias-c8f491e`), `rollback-current` (sin tarball), Studio Editor BI, imágenes base y de observabilidad, y toda imagen sin tarball verificado.

## B. Dependencias y recuperación (lote 1)
| Imagen | ID | Exclusivo | Contenedores | Referencias | Tarball (sha256) |
|---|---|---|---|---|---|
| `chibalete/api:ped01d-bef0afe` | `cccf3de4fc4f` | 739,8 MB | 0 | `chp-pedagogy-01d-deploy-02/ROLLBACK.env`, `chp-v6-release-01/ROLLBACK.env` | `/root/chp-pedagogy-01d-deploy-02/chibalete-api-ped01d-bef0afe.tar.gz` `bcecbc4150e149db81d1de90c3f7e672070fe928c7a70783d874f72625be38ac` |
| `chibalete/front:ped01d-bef0afe` | `b5318c946f2c` | 26,5 MB | 0 | ídem | `…/chibalete-front-ped01d-bef0afe.tar.gz` `c82dbcc4d8efb91fcb0261fca7f43adc318acf3207a55a074431f500c2547d51` |
| `chibalete/api:v6rc-b8350ab` | `814179c52485` | 740 MB | 0 | `chp-landing-banner-04/ROLLBACK.env`, `chp-v6-release-01/ROLLBACK.env` | `/root/chp-v6-release-01/chibalete-api-v6rc-b8350ab.tar.gz` `58095bedd7904fd04cf0bc3e6a7fd94a5b109da8a7fa7dd8a0f51713295a8ad2` |
| `chibalete/front:v6rc-b8350ab` | `940bedb0e45d` | 26,5 MB | 0 | ídem | `…/chibalete-front-v6rc-b8350ab.tar.gz` `5d950898f80597edccb9d8d13ba7eb949c335c89192c263616d5a9ff3ceba584` |

Las cuatro: una sola etiqueta, 0 contenedores, ausentes del compose y override vivos; las más antiguas con tarball (2026-09-07 y 09-14), superadas por más de 15 despliegues.

**Recuperación demostrada** antes de retirar:
1. Integridad en el VPS (`tarcheck.py`): gzip completo; 19/17/15/13 blobs, **0 corruptos** (sha256 = nombre), 0 faltantes; `diff_ids` del config = sha256 de cada capa **descomprimida** (containerd exporta capas gzip); capas + `created` = imagen viva.
2. **`docker load` real** en un daemon Docker aislado y vacío (contenedor `docker:dind` local, eliminado después): las 4 cargan («Loaded image …») y reproducen exactamente las mismas `RootFS.Layers` (13/11/13/11) y `Created` que las imágenes del VPS.

## C. Lote retirado
Verificación inmediata previa (16:56:24Z): 1 etiqueta, 0 contenedores (por `ancestor` y por ImageID), 0 menciones en compose/override vivos; servicios healthy.
| Hora (UTC) | Comando | Resultado | Δ disco |
|---|---|---|---|
| 16:57:09 | `docker rmi chibalete/api:ped01d-bef0afe` | Untagged + Deleted `sha256:cccf3de4fc4f…` | +659 MiB |
| 16:57:22 | `docker rmi chibalete/front:ped01d-bef0afe` | Deleted `sha256:b5318c946f2c…` | +5 MiB |
| 16:57:22 | `docker rmi chibalete/api:v6rc-b8350ab` | Deleted `sha256:814179c52485…` | +659 MiB |
| 16:57:31 | `docker rmi chibalete/front:v6rc-b8350ab` | Deleted `sha256:940bedb0e45d…` | +5 MiB |
Sin `-f`; por etiqueta inequívoca. Los 4 tarballs se conservan con el mismo sha256.

## D. Capas y caché liberadas
- Las capas exclusivas se liberaron **al retirar las imágenes**, sin poda de caché.
- Caché BuildKit tras el lote: **Shared 22,93 GB · Private 0 B**; `docker system df`: reclamable 0 B → **no se ejecutó `buildx prune`** (§4 de la unidad).

## E. Espacio recuperado
**1.329 MiB** (5,5 G → **6,8 G libres; 95 % → 94 %**). Imágenes: 128 → 124.

## F. Servicios, rollback y datos
- api_1/api_2/front `edinf-41b1bc7`, edge y Studio (api healthy; front Up desde 2026-10-16, sin healthcheck) — 11/11 contenedores Up, 0 reinicios; `/api/health/ready` ready ×2; front 200, Studio 200.
- 0 `[ERROR]` y 0 × 5xx desde el lote. Ingesta y enforcement sin definir (= off).
- Imágenes activas, de rollback vigente (`rollback-pre-edinf01`) y de Studio presentes; override `.bak-pre-edinf01-…` y `ROLLBACK.txt` presentes.
- Datos idénticos al cierre de VPS-STORAGE-01 (padrón incluido); uploads 5,8 G intactos; respaldos restic presentes (último `450d87b2`).

## G. Conservado y riesgos
- Conservadas: 124 imágenes (todas las demás), los 40 tarballs, restauraciones, logs y caché.
- Restaurar una imagen del lote: `docker load -i <tarball>` (probado en daemon aislado).
- Riesgo residual: disco al 94 %. Cada api histórica con tarball libera ≈ 659 MiB; quedan **34 imágenes con tarball** no activas ni de rollback vigente (≈ 16 api + 18 front, ≈ 10,5 GB estimados). La caché seguirá en Private 0 B mientras haya imágenes que compartan sus capas.

## H. Evidencia
Este documento; en el VPS `/root/chp-vps-storage-03/` (`img_inventory.jsonl`, `tarcheck.py`, `tarcheck_lote1.jsonl`, `images_lote1.txt`, `avail_pre.txt`, `snapshot-post-lote1.json`).

## I. Veredicto
**GREEN** para el lote 1: retirada segura, recuperación demostrada, 1,33 GB liberados, servicios y datos intactos. **STOP**: no se amplía sin autorización expresa.
