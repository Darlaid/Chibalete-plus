# VPS-STORAGE-04 — Ampliación controlada de retirada de imágenes históricas

**Fecha:** 2026-10-28 (UTC, 17:05–18:10Z) · **Baseline:** `aac603c` · **Producción:** `edinf-41b1bc7` · VPS `srv1179443`
4 lotes de 4 imágenes api de Chibalete+ con tarball verificado y restauración probada en daemon aislado. Sin `prune`, sin tocar tarballs, respaldos, datos, configuración ni Studio Editor BI; sin reinicios.

## A. Inventario inicial y candidatas
- Inicio: `/` 6,8 G libres (94 %); 11/11 contenedores sanos; HEAD `aac603c`.
- Recalculado desde cero (`tar_inventory.txt`, `select.py`): **34 candidatas** (16 api + 18 front), no 32. La cifra 34 de VPS-STORAGE-03 era correcta y la «corrección» a 32 (`aac603c`) fue un error de recuento; la unidad se ejecutó dentro del máximo de 32 retiradas (16 realizadas).
- Excluidas siempre: activas `edinf-41b1bc7`, rollback vigente `rollback-pre-edinf01` (`regalias-c8f491e`), `rollback-current`, Studio Editor BI, imágenes sin tarball verificado.
- Decisión de alcance: **solo imágenes api** (≈ 700 MB exclusivos cada una); cada front libera ≈ 5 MiB y no compensa su verificación.

## B. Lotes e imágenes retiradas
Por imagen (`lote.sh`): re-verificación remota (`recheck.py`: todas sus etiquetas `chibalete/*`, 0 contenedores por `ancestor` y por ImageID, ausente de compose/override vivos y de `ROLLBACK.txt` vigente, tarball íntegro con `tarcheck.py`, capas y `created` = imagen), descarga con sha256 igual, `docker load` en `docker:dind` aislado vacío, comparación de capas, y `docker rmi` de **cada etiqueta exacta, sin forzar**.

| Lote | Imagen (ID) | Etiquetas retiradas | Tarball sha256 (16) | Δ disco |
|---|---|---|---|---|
| 1 | api `banner-e590ae5` (`c74dbde6116b`) | 1 | `3d92ecd3ab00043d` | +6 MiB |
| 1 | api `events-a2-388e8a9` (`e175beeb3a01`) | 1 | `3d93db93f700f697` | 0 MiB |
| 1 | api `contentprotect-cp3-598bfb4` (`d8101582ac9f`) | 1 | `b85439cc80596816` | +661 MiB |
| 1 | api `contentprotect-cp3d-935a515` (`31c99a93d152`) | 2 (+`rollback-pre-cp4b`) | `eecf7aa8a04d099f` | +661 MiB |
| 2 | api `contentprotect-cp4-3b9bff6` (`3083495a538e`) | 2 (+`rollback-pre-cp4e`) | ver `lote2.log` | +661 MiB |
| 2 | api `contentprotect-global-73f45d6` (`b5e6f59c60db`) | 2 (+`rollback-pre-immtts02`) | ver `lote2.log` | +661 MiB |
| 2 | api `immersive-atomic-manifest-acbfaee` (`64b26f3c851a`) | 3 (+`rollback-pre-immtts02c`, `-r2`) | ver `lote2.log` | +661 MiB |
| 2 | api `immersive-retention-9c00d1c` (`5bde24a6e4a6`) | 2 (+`rollback-pre-f1a`) | ver `lote2.log` | +661 MiB |
| 3 | api `royalties-f1a-a3b704d` (`0800e27c35b1`) | 2 (+`rollback-pre-f2a`) | ver `lote3.log` | +661 MiB |
| 3 | api `royalties-f2a-36cc965` (`49475d4f87f6`) | 2 (+`rollback-pre-f2b`) | ver `lote3.log` | +661 MiB |
| 3 | api `royalties-f2b-ffc563b` (`54c9e489a242`) | 2 (+`rollback-pre-f3a2`) | ver `lote3.log` | +661 MiB |
| 3 | api `royalties-f3a2-145934b` (`921fd77f39e9`) | 2 (+`rollback-pre-secusers-a`) | ver `lote3.log` | +661 MiB |
| 4 | api `secusers-a-2ec37f7` (`f2a3e5118108`) | 2 (+`rollback-pre-selfpw`) | ver `lote4.log` | +627 MiB |
| 4 | api `selfpw-91634d2` (`042eb8bf11a2`) | 2 (+`rollback-pre-f1b`) | ver `lote4.log` | +627 MiB |
| 4 | api `editoriales-beb11e4` (`2bb58b4be9f5`) | 2 (+`rollback-pre-f1c`) | ver `lote4.log` | +628 MiB |
| 4 | api `catalogos-b3dd8a9` (`f8812c438bab`) | 2 (+`rollback-pre-dep01`, rollback N-2, no vigente) | ver `lote4.log` | +628 MiB |

Las etiquetas `rollback-pre-*` retiradas pertenecen a procedimientos de despliegues superados; el rollback vigente (`rollback-pre-edinf01`) no se tocó. Registros completos (incluidos sha256 de cada tarball descargado y comprobado): `docs/ops/vps_storage_04/lote{1..4}.log`; en el VPS `/root/chp-vps-storage-04/`.

## C. Verificaciones de restauración
16/16 tarballs: íntegros (blobs = nombre, `diff_ids` = sha256 de capa descomprimida), descargados con el mismo sha256, cargados en un daemon `docker:dind` aislado y vacío (creado y eliminado por lote) y con **13/13 capas y `created` idénticos** a la imagen del VPS. Restaurar cualquiera: `docker load -i <tarball>`.

**Anomalía explicada (lote 1):** `banner-e590ae5` (+6 MiB) y `events-a2-388e8a9` (0 MiB) liberaron casi nada porque sus capas superiores (incluida la grande de `node_modules`) son **idénticas** a las de `chibalete/api:secreset-01`, que se conserva (sin tarball, no candidata): las capas siguen en uso. Comprobado cruzando `RootFS.Layers` con todas las imágenes restantes. Desde el lote 2 se verificó antes el tamaño exclusivo (`docker system df -v`, 707–742 MB) de cada candidata; todas liberaron lo previsto.

## D. Espacio recuperado
| Lote | Antes (B) | Después (B) | Δ |
|---|---|---|---|
| 1 | 7 245 164 544 | 8 638 840 832 | +1,30 GiB |
| 2 | 8 638 275 584 | 11 412 209 664 | +2,58 GiB |
| 3 | 11 411 808 256 | 14 186 885 120 | +2,58 GiB |
| 4 | 14 186 430 464 | 16 820 051 968 | +2,45 GiB |
| **Total** | | | **+8,92 GiB** |
(Las pequeñas diferencias entre el «después» de un lote y el «antes» del siguiente son escrituras normales del sistema.)

## E. Estado final
- `/` **16 G libres (15,66 GiB), uso df 86 %; 14,8 % libre sobre el total** — umbral del 15 % **no alcanzado** por 0,2 %.
- Tras cada lote: 11/11 contenedores Up, api_1/api_2/front/edge y studio_bi_api healthy (studio_bi_front sin healthcheck, running), 0 reinicios; `/api/health/ready` ready ×2; front 200, Studio 200; 0 `[ERROR]`; 0 × 5xx en el edge; ingesta y enforcement sin definir (= off).
- 10/10 imágenes protegidas presentes (activas, rollback vigente, Studio); override `.bak-pre-edinf01-…` y `ROLLBACK.txt` presentes; `docker-compose.override.yml` y `docker-compose.yml` con el mismo sha (`9a5c76b2…`, `3765c4e7…`).
- Datos idénticos al inicio (padrón incluido); 45 tarballs presentes (ninguno borrado); uploads y respaldos sin tocar.

## F. Imágenes conservadas
- 108 imágenes. Candidatas con tarball que quedan: **18 fronts** (≈ 5 MiB exclusivos c/u, ≈ 90 MiB en total) — no se retiraron: llevarían al 14,9 % y no justifican la verificación.
- `chibalete/api:secreset-01` y el resto de api sin tarball: no candidatas.

## G. Riesgos y pendientes
- Margen 14,8 % libre. Para superar el 15 % con holgura harían falta decisiones de otra categoría (VPS-STORAGE-01 §H): imágenes api sin tarball (p. ej. `secreset-01`, que retiene ≈ 0,7 GB y bloqueó la ganancia de dos imágenes del lote 1; antes habría que exportar su tarball), restauraciones de verificación antiguas, retención de logs.
- La caché BuildKit no se podó (prohibido en esta unidad).

## H. Evidencia
Este documento; scripts `recheck.py`, `select.py` (VPS `/root/chp-vps-storage-04/`) y `lote.sh`, `postcheck.sh` (scratchpad de la sesión); logs en `docs/ops/vps_storage_04/`.

## I. Veredicto
**GREEN** en seguridad y procedimiento (16/16 retiradas recuperables y probadas, 0 incidencias, +8,92 GiB) — **sin alcanzar el umbral del 15 % (14,8 %)**: candidatas api agotadas. STOP.
