# SEC-DEPS-PROD-DEPLOY-01 — Evidencia de despliegue

**Fecha:** 2026-11-01. **Veredicto:** `GREEN_PROD`. **Pendientes de observar:** un login real correcto y una exportación ZIP de administrador real.

## Release

| Campo | Valor |
|---|---|
| Commit | `0a606c06a54e998a535401f96551f99de7e86081`, rama `chp/sec-deps-prod-01` |
| Imagen | `chibalete/api:secdeps-0a606c0`, ID `12460b15e61aa4a2…` |
| SHA-256 del tar | `4582c8b6404984002469deae3d406f42479f451b685e5e78b135e13794a527e0` |
| Imagen anterior | `chibalete/api:authatomic-a0b48c5`, ID `6f5fe4eb591d…` |
| Override | `f6c64f7ca366173a…` → `b7ddcc3f7cece101…`, solo líneas 40 y 85 |
| Frontend y edge | Sin cambios |

Elimina GHSA-3g3m-2fjr-6pw4 (glob), GHSA-g3hv-75wg-m249 (minimatch) y GHSA-8g5g-mxqh-grgj (vite, dev). Sigue el ignore de zod GHSA-mrhx-c7xc-m3w5, que caduca el 2026-11-23.

## Preflight

- API, edge y frontend saludables; digest y override esperados.
- Padrón válido, 672 registros, 0 sin id, hash `dda8613b0002b2e7…`, sin escrituras desde 2026-10-31 20:07Z.
- Snapshot `7a199332`: su padrón coincidió por hash con el vivo. Rollback en disco.
- Imagen sin `server/gamification` ni referencias de Studio o MOOK nuevas; login atómico presente.

## Transición

| Réplica | Drain | Inicio | Estado |
|---|---|---|---|
| `api_1` | 18:04:07Z | 18:05:13Z | healthy en 10 s; gate separado correcto |
| `api_2` | 18:05:46Z | 18:06:52Z | healthy en 12 s; gate correcto |

Versiones mezcladas: unos 100 s, con tráfico concentrado en una réplica. `api_2` volvió al pool tras su gate.

## Después del despliegue

- Mismo digest en ambas réplicas, `RestartCount` 0, pool con las dos.
- `/api/health` 200 ×6; login sintético, `/api/auth/me` anónimo y spoof 401; frontend 200.
- ZIP en vivo: anónimo y spoof 401 por edge.
- ZIP autenticado: contenedor efímero de la imagen exacta en el VPS, sin red ni montajes y con administrador sintético. Tarea y estudiante inexistentes: 200, `application/zip`, `zipfile` íntegro, con `sin_entregas.txt`. El contenedor ya no existe.
- No se generó una sesión real: requeriría credenciales o suplantar una cuenta.
- Vigilancia hasta 18:17Z: 10/10 muestras sanas, padrón 672 en todas.
- `ELOCKTIMEOUT`, lock obsoleto, errores de escritura, `CANONICAL_MUTATION`, excepciones y `[ERROR]`: 0. 5xx del edge desde 18:04Z: 0.
- Padrón: mismo hash y mtime. Sin `.tmp` ni `.lock` en `data/` ni `data-critical/`.
- Snapshot `d4a3eb1c` (18:02Z): 672 registros y hash igual al padrón vivo.
- 0 logins reales en la ventana.

## Rollback

Preparado, no usado. Tag `chibalete/api:rollback-pre-secdeps` = `6f5fe4eb591d`. Instrucciones en `/root/chp-secdeps/ROLLBACK.txt`. Conserva el login atómico, pero reintroduce los avisos OSV.
