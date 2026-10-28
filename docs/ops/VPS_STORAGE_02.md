# VPS-STORAGE-02 — Liberación controlada de caché Docker (detenida en preflight)

**Fecha:** 2026-10-28 (UTC, 16:46–16:50Z) · **Baseline:** `237e0d8` · **Producción:** `edinf-41b1bc7` · VPS `srv1179443`
**Resultado:** **no se ejecutó ninguna limpieza.** El preflight demuestra que la caché de BuildKit no tiene espacio propio recuperable: todo lo que reporta lo retienen capas de imágenes que se conservan.

## A. Estado inicial
- `/` 106 G, 101 G usados, **5,5 G libres (95 %)**; inodos 31 %.
- Chibalete+ (api_1/api_2/front `edinf-41b1bc7`, edge) y Studio Editor BI healthy, 0 reinicios (verificado en VPS-STORAGE-01 a las 16:43Z; sin cambios desde entonces).

## B. Builder y caché identificados
- Docker 29.4.1, almacén **containerd** (`Storage Driver: overlayfs`, `driver-type: io.containerd.snapshotter.v1`), raíz `/var/lib/docker`.
- Único builder: `default` (driver `docker`, BuildKit v0.29.0, running). Sin `buildkitd` independiente, sin contenedores BuildKit, **sin builds en curso**.
- `docker buildx du --builder default`: **Shared 22,93 GB · Private 0 B** · «Reclaimable» 22,93 GB · Total 22,93 GB.
- `docker system df`: Build Cache 325 registros, 0 activos, 22,93 GB, **reclamable 0 B**.
- `docker buildx du --verbose` (guardado en `/root/chp-vps-storage-01/buildx_du_verbose.txt`): **325/325 registros `Shared: true`**, ninguno `In use`, todos `regular`, 22,89 GB; último uso: 179 hace meses, 103 hace semanas, 43 hace días.

## C. Comando previsto y por qué no se ejecutó
- Comando dirigido que se habría usado (mismo que VPS-CLEAN-01C, sin filtro global de Docker y sin `--all`):
  `docker buildx prune --builder default --force --verbose`
- Efecto esperado: retirar registros inactivos de BuildKit. **Efecto en disco: ≈ 0.** Un registro `Shared` apunta a snapshots de containerd que también usan imágenes etiquetadas; BuildKit no libera un snapshot mientras una imagen lo referencie (precedente medido en VPS-CLEAN-01C: los registros compartidos ni siquiera se borraron y su «reclaimable» era ficticio). Con Private = 0 B no hay ninguna capa que pertenezca solo al caché.
- Coste sin beneficio: se perdería el historial de compilación (el próximo build en el VPS, p. ej. Studio Editor BI, partiría de cero).
- Decisión: **STOP antes de ejecutar**, en aplicación del objetivo («caché comprobada como no utilizada») y del criterio de alcance mínimo. Ninguna imagen, contenedor, volumen, dato, tarball, restauración, log ni configuración fue tocado.

## D. Espacio recuperado
0 (no hubo limpieza).

## E. Integridad
Sin operaciones de escritura en el VPS más allá del fichero de inventario `buildx_du_verbose.txt` en `/root/chp-vps-storage-01/`. Imágenes, rollback (`rollback-pre-edinf01`, override `.bak-pre-edinf01-…`, `ROLLBACK.txt`), respaldos y datos sin cambios respecto de VPS-STORAGE-01.

## F. Estado final del disco
5,5 G libres (95 %), igual que al inicio.

## G. Riesgos residuales
- **El disco sigue al 95 %.** El espacio que la caché aparenta es en realidad de las ~118 imágenes Chibalete antiguas (≈ 740 MB únicos por imagen api).
- Única vía efectiva, que requiere **autorización independiente** (VPS-STORAGE-01 §H): retirar imágenes históricas que no son activas ni de rollback, **conservando su tarball** cuando exista (40 de ellas tienen tarball idéntico verificado en `/root/chp-*`), y **después** podar la caché con el comando de §C; solo entonces los snapshots quedan sin referencias y se liberan.

## H. Evidencia
Este documento; inventario `buildx_du_verbose.txt` en el VPS.

## I. Veredicto
**YELLOW.** Preflight completo y sin riesgos, pero el objetivo no es alcanzable con esta operación: la caché no tiene espacio propio (Private 0 B, 325/325 compartidos). No se ejecutó nada.
