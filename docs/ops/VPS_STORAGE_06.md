# VPS-STORAGE-06 — Conciliación del espacio real del VPS y el panel Hostinger

**Fecha:** 2026-10-28 (UTC, 19:50–19:56Z) · **Baseline:** `78bcdc0` · VPS `srv1179443` · Diagnóstico de solo lectura: sin limpiezas, sin cambios de configuración, sin reinicios por nuestra parte.

## A. Capacidad física y sistema de archivos (19:50:44Z)
| Nivel | Bytes | GB (10⁹) | GiB (2³⁰) |
|---|---|---|---|
| Disco virtual `sda` | 118 648 471 552 | 118,6 | **110,5** |
| Partición `sda1` (`/`) | 117 573 664 256 | 117,6 | 109,5 |
| ext4 `/` tamaño útil (`df` 1B-blocks) | 113 809 375 232 | 113,8 | **106,0** |
| `/boot` (`sda16`) + `/boot/efi` (`sda15`) + `sda14` | 1 072 693 760 | 1,07 | 1,0 |

- `ext4`, bloque 4 KiB, 28 704 507 bloques, **reservados 0**, overhead de metadatos 919 015 bloques (≈ 3,5 GiB: diferencia partición ↔ `df`).
- Sin otros montajes de datos (solo `/`, `/boot`, `/boot/efi`; `sr0` = ISO cloud-init de 4 MiB). Swap: `/swapfile` 2 GiB **dentro** de `/` (ya contado en «usado»).
- Inodos: 2 108 334 / 14 352 384 (15 %).

## B. Uso y espacio realmente disponibles
- `df -B1 /`: usado **70 367 879 168 B (65,5 GiB)**, disponible **43 424 718 848 B (40,4 GiB)**, 62 %. Como no hay bloques reservados, disponible = libre.
- `docker system df`: imágenes 18 ImageID / 22 etiquetas, 23,19 GB (5 % reclamable); contenedores 5 MB; volúmenes 378 MB; **caché BuildKit 325 registros, 22,93 GB, de ellos 22,34 GB privados y reclamables** (`docker buildx du`: compartido 592 MB).
- Estado posterior: 19:54:04Z, 43 424 460 800 B disponibles. Sin crecimiento anómalo.

## C. Conciliación GB / GiB
- El «111 GB» del panel corresponde al **disco virtual completo en GiB** (110,5 GiB = 118,6 GB decimales), no al sistema de archivos `/` (106 GiB).
- Linux `df -h` usa GiB etiquetados como «G». La capacidad «perdida» entre panel y `df` (110,5 → 106 GiB ≈ 4,5 GiB) son las particiones de arranque (1 GiB) y los metadatos ext4 (3,5 GiB). Es estructural; no es espacio ocupado.

## D. Imágenes eliminadas y bloques liberados
- Quedan solo 7 etiquetas `chibalete/*` (5 ImageID: producción, rollback inmediato y la excepción `hf4a-r2`). Las 90 imágenes retiradas no están en el almacén.
- **Archivos borrados que siguen abiertos: 0 bytes** (recorrido de `/proc/*/fd`).
- `/` está montado con **`discard`** (TRIM en línea) y el disco lo admite (granularidad 4 KiB, máx. 1 GiB). Los bloques liberados se devuelven al hipervisor al borrarse. Además, `fstrim.timer` es semanal (último 26/10: 3,1 GiB recortados).
- Histórico de Prometheus (`node_filesystem_avail_bytes`, `/`, muestras horarias):

| UTC | Libre (GiB) | Evento |
|---|---|---|
| 27/10 19:53 | 7,64 | |
| 28/10 14:53 | 6,38 | |
| 28/10 16:53 | 5,45 | tras el despliegue `edinf` |
| 28/10 17:53 | 13,21 | VPS-STORAGE-04 (lotes 1–3) |
| 28/10 18:53 | 15,66 | VPS-STORAGE-04 cerrado |
| 28/10 19:53 | **40,44** | VPS-STORAGE-05 (19:19–19:44Z) |

## E. Comparación con Hostinger
| | Panel Hostinger | Linux ahora | Linux a las 18:53Z (antes de STORAGE-05) |
|---|---|---|---|
| Capacidad | 111 | 110,5 GiB (disco) / 106 GiB (`/`) | igual |
| Usado | **90** | **65,5 GiB** | **90,3 GiB** (113,81 − 16,82 GB = 96,99 GB) |
| Libre implícito | 21 | 40,4 GiB (+ 4,5 GiB estructurales) | 15,7 GiB (+ 4,5 estructurales ≈ 20,2) |

El «90 usado / 21 libre» del panel coincide con el estado del disco **antes de VPS-STORAGE-05**: usado 90,3 GiB, y libre 15,7 + 4,5 estructurales ≈ 20,2 GiB.

## F. Causa
- **Demostrado:**
  - La diferencia 111 ↔ 106 es de unidades y capas: disco completo en GiB frente a sistema de archivos.
  - Linux dispone hoy de 40,4 GiB libres reales: sin archivos borrados abiertos, sin reservas ni montajes ocultos, y con TRIM en línea.
  - Las cifras del panel corresponden numéricamente al uso real previo a 19:19Z.
- **Hipótesis pendiente (no verificable desde el VPS):** el panel mostraba una muestra tomada antes de que terminase VPS-STORAGE-05 (19:44Z), menos de una hora antes de esta unidad. No hay acceso al panel ni a su frecuencia de muestreo, así que no afirmo que esté desactualizado. Queda descartado que mida bloques no recortados: el montaje usa `discard`. El agente `qemu-guest-agent` está activo y sería la vía normal por la que el panel lee el uso del invitado.

## Incidencia observada durante la unidad (no causada por nosotros)
- **Reinicio abrupto de la VM entre 19:48:20Z y 19:49:10Z.**
  - El diario del arranque anterior termina sin secuencia de apagado y `last` no registra ningún *shutdown*. La ISO cloud-init `cidata` se regeneró a las 19:48:58Z, lo que es compatible con un reinicio o power-cycle desde el panel o el hipervisor.
  - Nuestra última sesión antes del corte terminó a las 19:45:11Z; los comandos de esta unidad empezaron a las 19:50:44Z.
- **Tras el arranque:**
  - ext4 montado sin errores.
  - 11/11 contenedores Up (healthy donde hay healthcheck); `/api/health/ready` ×2 OK.
  - Ingesta y enforcement sin definir (= OFF); 0 `[ERROR]` en las API y 0 × 5xx en el edge desde el arranque; front 200, Studio 200.
  - Datos idénticos al cierre de VPS-STORAGE-05; imágenes y sha de los ficheros compose sin cambios.
  - Timers de respaldo programados.
- **Deuda previa visible en el diario:** las unidades systemd heredadas `chibaleteplus-backend.service` y `-3002.service` (era PM2/host, `enabled`, `Restart=always` cada 5 s) fallan en bucle porque falta su `.env`. Contador del arranque anterior: 198 434 reinicios. Producción no las usa; solo generan ruido en el diario.

## G. Recomendaciones (no ejecutadas)
1. Volver a consultar el panel de Hostinger. Si se actualiza, debería mostrar ≈ 65–66 GiB usados. Si sigue en 90, abrir consulta a Hostinger con esta tabla: `df`, la serie de Prometheus y el montaje con `discard`.
2. Revisar en el registro de actividad de Hostinger quién o qué reinició la VM a las 19:48Z, y confirmar si fue manual.
3. Unidad aparte con autorización: `docker buildx prune` de la caché BuildKit, que ahora tiene 22,34 GB privados y reclamables (en VPS-STORAGE-02 eran 0 B). Llevaría el uso a ≈ 45 GiB.
4. Unidad aparte con autorización: deshabilitar las dos unidades systemd heredadas `chibaleteplus-backend*`, que se reinician en bucle.

## H. Veredicto
**GREEN** en la conciliación: discrepancia explicada por unidades/capas y por el momento de la muestra, y espacio libre real de 40,4 GiB demostrado. **Con una alerta abierta:** reinicio abrupto de la VM a las 19:48Z, de origen externo y sin daños verificados; se recomienda confirmarlo en el panel. STOP: sin limpiezas ni cambios de configuración.
