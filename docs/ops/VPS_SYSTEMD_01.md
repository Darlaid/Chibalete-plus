# VPS-SYSTEMD-01 — Desactivación de servicios systemd heredados

**Fecha:** 2026-10-28 (UTC, 19:58–20:01Z) · **Baseline:** `7dca08f` · **Referencia:** `docs/ops/VPS_STORAGE_06.md` · VPS `srv1179443`
Se deshabilitan y detienen `chibaleteplus-backend.service` y `chibaleteplus-backend-3002.service` (despliegue nativo con Node de marzo de 2026, anterior a Docker), que fallaban en bucle cada 5 s. No se borra ningún fichero ni se toca otra unidad, Docker, los logs ni el VPS.

## A. Dependencias verificadas (preflight, sin cambios)
- **Contenedores:** 11/11 Up desde el arranque de las 19:49:32Z, 0 reinicios.
- **Definición:** ambas unidades `Type=simple`, `Restart=always`, `RestartSec=5`, `WantedBy=multi-user.target`, `User=root`. Ejecutaban `/usr/bin/node /root/apps-spa/chibaleteplus.release.2026-03-11/server/server.js`; la segunda forzaba `PORT=3002`.
- **No pueden arrancar:**
  - `chibaleteplus-backend`: falta su `EnvironmentFile` `…/chibaleteplus.release.2026-03-11/.env`. El resultado es `Failed to spawn 'start' task`.
  - `-3002`: falta `…/server`, su `WorkingDirectory`. El resultado es `status=200/CHDIR`.
  - El directorio de la release solo contiene `node_modules`. Contadores: 198 434 reinicios en el arranque anterior y 101 cada una en el actual antes de la intervención.
- **Proceso y puerto:** `MainPID=0` en ambas; nada escucha en 3000 ni en 3002 en el host. Los únicos procesos Node del host están en cgroups de Docker (api_1, api_2, studio_bi_api).
- **Dependencias inversas:** solo `multi-user.target`, por los enlaces de `WantedBy`. Ninguna otra unidad las requiere ni las activa.
- **Referencias:** la búsqueda de `3002`, `apps-spa` y `chibaleteplus-backend` en `/etc/nginx`, compose (base y override), cron, `/var/spool/cron` y `/etc/systemd` (excluidas las propias unidades) no da ningún resultado. El nginx del host está `inactive`/`disabled`.
- **Edge:** solo envía a contenedores (`chibalete_api_1:3000`, `chibalete_api_2:3000`, `chibalete_front:80`, `studio_bi_front:80`).
- **PM2:** `pm2-root.service` gestiona una sola app, `studio-editor-bi-api` (`/root/apps-studio-editor/releases/release-2026-03-30-1341/functions/server.js`, puerto 3003). No está relacionada con estas unidades y **no se tocó**.
- **Ninguna petición productiva depende de ellas.**

## B. Configuración original conservada
- Ficheros de unidad intactos en `/etc/systemd/system/` (sha256 verificado tras la intervención). Se conserva también `chibaleteplus-backend.service.backup.2026-03-18-223526`.
- Copia y estado previo en `/root/chp-vps-systemd-01/original/`: los dos `.service`, la salida de `systemctl show` de cada uno, `symlinks.txt` (enlaces `multi-user.target.wants`) y `sha256.txt`.

## C. Acciones ejecutadas
`2026-10-28T19:59:04Z` — `systemctl disable --now chibaleteplus-backend.service chibaleteplus-backend-3002.service`
- Elimina solo los dos enlaces `multi-user.target.wants/…`, de modo que no arrancan al iniciar el sistema.
- Detiene ambas unidades. Con la unidad parada, `Restart=always` no vuelve a actuar. No se editó la política de reinicio de los ficheros, para conservarlos intactos.

## D. Resultado de systemd y journal
- Ambas `disabled`, `inactive (dead)`, `NRestarts=0`.
- Journal desde 19:59:04Z: solo dos líneas `Stopped …` y **ningún intento de arranque posterior** (comprobado a las 20:00:23Z).
- `systemctl --failed`: 0 unidades.

## E. Estado de servicios productivos (20:00:23Z)
- Contenedores: 11/11 con el mismo `StartedAt` y 0 reinicios respecto al preflight. Healthy los 6 que tienen healthcheck; los otros 5 no lo tienen (alertmanager, grafana, node_exporter, prometheus, studio_bi_front).
- `/api/health/ready` ×2 OK; ingesta económica y enforcement sin definir (= OFF); 0 `[ERROR]` en las API y 0 × 5xx en el edge desde la intervención; front 200, Studio 200; PM2 Studio en 3003 activo.
- Rollback (`override.bak-pre-edinf01`, `ROLLBACK.txt`) presente; sha de los compose sin cambios; 18 ImageID y 45 tarballs; 4 timers de respaldo programados.
- Datos: la única diferencia frente al cierre de VPS-STORAGE-05 está en `royalties/publishers`, por una editorial más creada desde el panel de administración (`POST /api/admin/publishers` → 201 a las 19:56:29Z). Es actividad legítima de la aplicación y ocurrió antes de la intervención; las unidades nunca llegaron a ejecutarse.

## F. Procedimiento de reversión
```
systemctl enable --now chibaleteplus-backend.service chibaleteplus-backend-3002.service
```
Restaura los enlaces `multi-user.target.wants` y el estado original, es decir, el bucle de fallos mientras falten `.env` y `server/`. Los ficheros de unidad no se modificaron; copia en `/root/chp-vps-systemd-01/original/`.

## G. Evidencia
Este documento; en el VPS `/root/chp-vps-systemd-01/` (`original/`, `pre_containers.txt`, `post_containers.txt`, `t0.txt`, `snap.json`).

## H. Veredicto
**GREEN.** Bucle eliminado (0 intentos tras la desactivación); dependencias inexistentes demostradas; producción, Studio, datos, respaldos y rollback intactos; ficheros conservados y reversión de un comando. STOP.
