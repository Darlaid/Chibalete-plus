# CHP-BACKUP-DEST-01 — Decisión Humana de Destino Off-site (registro)

> Registro de la decisión aprobada por el decisor. Resuelve
> `BLOCKED — OFF-SITE DESTINATION REQUIRES HUMAN SELECTION` de CHP-BACKUP-01A.
> **Autoriza redactar CHP-BACKUP-01B.** NO autoriza implementación, credenciales en repo,
> creación automatizada de cuentas/buckets, deploy, provisión de `admin_secret`, cambios de CI
> ni restauración sobre producción.

| # | Decisión | Valor aprobado |
|---|---|---|
| 1 | Destino off-site | **Backblaze B2** vía API **S3-compatible** |
| 2 | Independencia | Cuenta y bucket **independientes de Hostinger**; bucket **privado y exclusivo** de Chibalete+ |
| 3 | Herramienta | **restic** (cifrado cliente + deduplicación) |
| 4 | Frecuencia | SQLite+JSON canónico **cada 6 h**; uploads **incremental diario**; Hostinger semanal como capa de infra |
| 5 | Retención | **7 diarios · 4 semanales · 6 mensuales** |
| 6 | Objetivos (a validar en 01C) | RPO estructurado **6 h** · RPO uploads **24 h** · RTO app **4 h** · RTO recuperación completa **8 h** |
| 7 | Método SQLite | **Online Backup API / `sqlite3 .backup`** principal; `VACUUM INTO` solo fallback justificado con preflight de espacio + lock |
| 8 | Espacio local | **Prohibido** tarball completo o duplicar uploads localmente; minimizar staging, verificar espacio antes, fallar seguro |
| 9 | Datos sensibles | `leo_*` y memoria de menores: retención explícita, acceso restringido, tratamiento separado |
| 10 | Cierre | Un backup exitoso **no** cierra CHP-BACKUP-01; GREEN solo tras **01C** + restauración aislada satisfactoria |

**Prohibiciones vigentes de la decisión:** no crear cuentas/buckets por automatización · no almacenar credenciales en el repo · no desplegar `376f6dd` · no provisionar `admin_secret` · no modificar CI · no restaurar sobre producción.

## Aclaración de secuenciación (R1, coherente con la Decisión 10)

La política de retención **7/4/6** queda aprobada como **objetivo**. Su **aplicación destructiva** (`restic forget`/`prune`/eliminación de snapshots) **no** se ejecuta ni se programa en CHP-BACKUP-01B: permanece **bloqueada** hasta que CHP-BACKUP-01C esté GREEN y una unidad posterior explícita la habilite. 01B solo genera, lista y verifica snapshots, y puede **simular** la política con `forget --dry-run` (sin mutación). Esto no altera la decisión humana; solo fija el orden seguro (validar restauración antes de permitir borrado).

**Corrección R2 (permisos de la Application Key):** la key **sí** debe permitir borrado de objetos, porque restic lo necesita para su operación normal (p. ej. sus **archivos de lock**); una key sin borrado deja locks persistentes y bloquea operaciones. Por tanto la protección contra borrado **prematuro de snapshots** **no** se implementa restringiendo permisos del bucket, sino mediante **controles del runner** (ausencia de comandos destructivos, units separadas, allowlist de subcomandos, revisión estática, aprobación humana post-01C). La key sigue **limitada exclusivamente al bucket aprobado**, no master, sin acceso a otros buckets ni administración de cuenta.
