# BACKUP_CAPACITY_01B — caché restic persistente y gates de capacidad

Unidad: **CHP-BACKUP-CAPACITY-01B** (prep: 2026-08-13, sin deploy).
Diagnóstico origen: CHP-BACKUP-CAPACITY-01A (GREEN).
Estado: **PREPARADO Y PROBADO — NO INSTALADO.** El deploy exige GAP-4 F27 GREEN.

## 1. Qué corrige

Cuatro gates productivos chocaron con el cap diario Class B de B2. Causa
compuesta demostrada:

1. **Las tres units de backup corren restic sin caché persistente**:
   `ProtectHome=true` deja `HOME` vacío y `RESTIC_CACHE_DIR` no estaba
   configurado → cada corrida re-descarga TODOS los metadatos del repo
   (índices + snapshots) como Class B. Probado con `systemd-run` replicando el
   sandbox y con el harness de esta unidad.
2. **Crecimiento monotónico** de metadatos (sin prune, por diseño): el coste
   por corrida sube cada día.
3. **Corridas extra por gates** de deploy y ops ad-hoc.
4. Además, el clasificador histórico etiquetaba la firma del cap
   («unable to open config file: Stat: **Access Denied**») como
   `config_absent`: la aguja de config-ausente se evaluaba antes que la de
   denegación. El preflight nuevo corrige el orden.

NO cambia: RPO, cobertura, datos protegidos, verify semanal, retención.

## 2. Entregables versionados (esta prep)

| Fichero | Propósito |
|---|---|
| `ops/backup/CHP-BACKUP-01B/systemd/dropins/{structured-backup,uploads-backup,backup-verify}.service.d/10-restic-cache.conf` | caché persistente (`CacheDirectory=` + `Environment=RESTIC_CACHE_DIR`) |
| `runners/chibalete_backup/capacity.py` | clasificación GET+LIST, presupuesto estimado, `status.json` atómico |
| `runners/chibalete_backup/recovery_point.py` | evaluación local de recovery points (pre/post deploy) |
| `runners/backup_capacity_preflight.py` | CLI del preflight (exit 0/1/2 = GREEN/YELLOW/RED) |
| `runners/chibalete_backup/config.py` | `RESTIC_CACHE_DIR` con fallback de entorno + presupuesto opcional validado |
| `tests/test_capacity.py` | 88 casos stdlib (clasificación, budget, status, reuse, guards) |
| `tests/capacity_harness.sh` | harness systemd real: persistencia/reuso/reconstrucción de caché + lock |
| `config/backup.env.example` | documentación de las claves nuevas (opcionales) |

Nota de diseño clave: `restic_env()` construye el entorno de restic **desde
cero** — el `Environment=` del drop-in solo llega a restic gracias al fallback
añadido en `config.py` (`cache_dir`). backup.env productivo NO necesita
editarse para activar la caché.

## 3. Inventario de drop-ins (F22) — NO instalados

| FILE (repo) | DESTINATION | OWNER | MODE | UNIT | PURPOSE |
|---|---|---|---|---|---|
| `systemd/dropins/structured-backup.service.d/10-restic-cache.conf` | `/etc/systemd/system/structured-backup.service.d/10-restic-cache.conf` | root:root | 0644 | structured-backup.service | caché restic persistente |
| `systemd/dropins/uploads-backup.service.d/10-restic-cache.conf` | `/etc/systemd/system/uploads-backup.service.d/10-restic-cache.conf` | root:root | 0644 | uploads-backup.service | ídem |
| `systemd/dropins/backup-verify.service.d/10-restic-cache.conf` | `/etc/systemd/system/backup-verify.service.d/10-restic-cache.conf` | root:root | 0644 | backup-verify.service | ídem |

Comandos futuros exactos (deploy — **NO ejecutar ahora**):

```bash
SRC=/ruta/al/checkout/ops/backup/CHP-BACKUP-01B/systemd/dropins
for u in structured-backup uploads-backup backup-verify; do
  install -d -m 0755 /etc/systemd/system/$u.service.d
  install -m 0644 -o root -g root "$SRC/$u.service.d/10-restic-cache.conf" \
    /etc/systemd/system/$u.service.d/10-restic-cache.conf
done
systemctl daemon-reload
systemctl show structured-backup.service -p CacheDirectory -p Environment
```

ROLLBACK (simple, no destructivo):

```bash
rm -rf /etc/systemd/system/{structured-backup,uploads-backup,backup-verify}.service.d
systemctl daemon-reload
# opcional: systemctl clean --what=cache structured-backup.service
```

Borrar la caché **nunca** destruye backups (CACHE_RECONSTRUCTIBLE=true,
probado en el harness). Las tres units comparten caché porque el lock
compartido (`/run/chibalete-backup/lock`) las serializa (probado con procesos
reales).

## 4. Capacity preflight

`backup_capacity_preflight.py` — coste remoto máximo: **1 GET** (camino sano)
o **1 GET + 1 LIST firmado** (camino de fallo; el LIST es Class C, no consume
Class B). Nunca snapshots/stats/check/restore/backup.

Separación estricta (F6): `repository_state` (GREEN/RED/UNKNOWN) y
`budget_state` (GREEN/YELLOW/RED/UNKNOWN) son ejes independientes; repo GREEN
con presupuesto sin declarar = `GREEN + UNKNOWN`, jamás un RED inventado.

Clasificaciones: `HEALTHY, AUTH_FAILURE, CLASS_B_CAP, NETWORK,
BUCKET_FAILURE, REPOSITORY_FAILURE, LOCK, CONFIG_ERROR, BUDGET_PRESSURE,
UNKNOWN`. La discriminación decisiva del cap: **GET de contenido denegado
mientras el LIST autenticado funciona y muestra objetos** (LIST=200 solo no
prueba nada). Veredicto de gate fail-closed: lo no demostrado es RED;
NETWORK/LOCK son YELLOW (transitorios).

Contabilidad honesta (F10): todo consumo es `cost_source=estimated`; nunca se
presenta como consumo real de la consola B2. Presupuesto opcional
(`B2_DAILY_OPERATION_BUDGET` / `B2_EMERGENCY_RESERVE` en backup.env): sin
declarar → UNKNOWN; declarado inválido → CONFIG_ERROR (RED, fail-closed);
5000/2000 del diagnóstico son **HIPÓTESIS** hasta la medición (§8).

## 5. `status.json` (F9)

Ubicación productiva propuesta (se crea en deploy):
`/var/backups/chibalete-backup/status.json`, 0600 root, escritura atómica
(temp + `os.replace`), schema `capacity-status/1` con los campos del contrato
(último éxito por tipo, snapshot corto, duración, corridas del día, bloqueos
de cuota, última lectura autenticada, próximo timer, estados, coste estimado,
config de presupuesto). Sin secretos ni PII; claves fuera del schema se
rechazan.

## 6. Gates de deploy (F17) — política

**PRE-DEPLOY:**
1. `backup_capacity_preflight.py` → RED = **mutación bloqueada**.
2. `evaluate_predeploy_recovery_point()` (local puro, 0 ops remotas):
   REUSE solo si TODO se cumple — `result=ok`, edad ≤ umbral (default 60 min),
   25 stores, 0 warnings, identity.db incluida, fingerprints críticos sin
   cambio (JSON: sha256 contra la captura; SQLite: mtime+sidecars contra el
   timestamp del manifiesto — proxy conservador), sin bloqueo de cuota
   posterior al snapshot.
3. REUSE válido → documentar reutilización; si no → backup nuevo obligatorio.

**POST-APPLY:**
1. Preflight de capacidad.
2. Backup que cubra el estado POST. **Regla no negociable
   (`POST_MUTATION_REQUIRES_POST_STATE_RECOVERY_POINT=true`)**: un manifiesto
   anterior o igual al instante de la mutación jamás valida el estado
   posterior (`evaluate_postapply_recovery_point` lo aplica estructuralmente).

## 7. Failure policy (F18)

Cap Class B en el post-deploy con snapshot PRE válido:

- Estado = **`DEGRADED_BACKUP`** — producción **sigue sirviendo** (stores
  canónicos en disco + recovery point pre existente). No es incident.
- **Siguiente mutación/deploy BLOQUEADO** hasta backup ok que cubra el estado
  actual.
- **NO rollback automático**: el rollback responde a fallos de código/datos,
  no a disponibilidad del proveedor de backup.
- El snapshot PRE es suficiente **temporalmente** si su manifiesto es ok y los
  stores críticos no cambiaron o son derivados reconstruibles (flag
  `reconstructible` de stores.py; p. ej. proyecciones).
- **Incident** solo si: RPO real incumplido de forma sostenida (>24 h sin
  backup ok), corrupción/pérdida detectada, o ambas. Una cuota externa jamás
  se convierte sola en pérdida de datos.

## 8. Plan de medición (F24)

Tres puntos, mismos criterios:

- **A. LEGACY** — última corrida pre-deploy sin caché (datos ya en journal).
- **B. COLD CACHE** — primera corrida tras instalar drop-ins.
- **C. WARM CACHE** — corrida siguiente.

Comparar: duración de la corrida (journal), tamaño y nº de ficheros de
`/var/cache/chibalete-backup/restic`, request counts reales de la consola B2
si los expone (por clase y por día), coste estimado local, errores de cuota,
warnings en journal. Resultado exigido: **`MATERIAL_REDUCTION`** — reducción
clara y estable de operaciones Class B entre A y C (no se exige un 10×
exacto).

## 9. Datos a obtener de la consola B2 (F23) — operador

1. Cap diario Class B **actual** (Caps & Alerts) y si es el default del plan.
2. Consumo real de los últimos días por clase (A/B/C), si el histórico existe.
3. Confirmar que el cap es configurable y su granularidad.
4. Precio vigente por 10k ops Class B/C (no asumir los del diagnóstico).
5. Alertas disponibles (umbral %, email) y configurarlas al 50 %/75 %.
6. Histórico de request counts por bucket si existe (para el punto A/C de §8).

## 10. node_exporter (F19)

Auditado read-only: el `chibalete_node_exporter` productivo corre **sin**
`--collector.textfile.directory` → el textfile collector NO está activo. No se
modifica ahora. Integración futura documentada: añadir el flag + montar un
directorio de métricas y volcar desde `status.json`:
`backup_last_success_timestamp`, `backup_runs_today`,
`backup_quota_blocks_total`, `backup_capacity_state`,
`backup_last_duration_seconds` (sin labels de alta cardinalidad). Mientras
tanto, `status.json` + journal son la superficie de observabilidad.

## 11. Unidad de deploy congelada — CHP-BACKUP-CAPACITY-01B-DEPLOY

**NO ejecutar.** Secuencia exacta para cuando se autorice:

1. **Gate previo:** GAP-4 F27 cerrado GREEN (backup post de GAP-4 ok) y
   producción estable (`f885e31`, 1/1/json, LIVE=MATCH).
2. Preflight de producción read-only: units activas byte-idénticas al repo,
   timers en su horario, journal limpio.
3. Backup de configuración: copiar `/etc/systemd/system/*.service`,
   `/etc/chibalete-backup/backup.env` (hash, no contenido) y
   `systemctl show` de las 3 units a `/root/chp-backup-capacity-01b/pre/`.
4. Instalar los 3 drop-ins (§3, comandos exactos).
5. `systemctl daemon-reload`.
6. Verificar: `systemctl show <unit> -p CacheDirectory -p Environment`
   muestra `chibalete-backup/restic` y `RESTIC_CACHE_DIR`; `systemd-analyze
   verify` silencioso; timers intactos (`list-timers`).
7. **COLD RUN controlado**: esperar el siguiente ciclo del timer (o
   `systemctl start structured-backup.service` UNA vez si la ventana lo
   permite y B2 no está capado): exit 0, manifiesto ok, caché poblada.
8. **WARM RUN**: siguiente ciclo del timer: exit 0 y caché reutilizada
   (fingerprint estable).
9. Medición A/B/C (§8) → exigir `MATERIAL_REDUCTION`.
10. Activar preflight/status: primera ejecución de
    `backup_capacity_preflight.py` productiva (coste ≤2 ops), `status.json`
    creado 0600.
11. node_exporter: solo si se decide en esa ventana; si no, queda documentado.
12. Decisión de cap B2 con los datos de consola (§9): subir cap + alertas.
    El presupuesto (`B2_DAILY_OPERATION_BUDGET`/`B2_EMERGENCY_RESERVE`) se
    fija DESPUÉS de medir, no antes.
13. **Rollback drill no destructivo**: retirar drop-in de backup-verify,
    daemon-reload, verificar unit operativa sin caché, reinstalar.
14. Invariantes de recuperación: `restic cat config` rc=0, último manifiesto
    ok, 25 stores, identity.db incluida, snapshots del día listables.
15. Cierre: manifiesto de la unidad, actualización de memoria/runbooks,
    rollback-plan registrado.

STOP conditions del deploy: cualquier unit que no arranque tras
daemon-reload; caché no creada/escribible; cold run con exit≠0; medición sin
reducción; B2 capado durante la ventana (esperar reset, no forzar).

## 12. Decisión de branch (F21)

La preparación vive en la rama publicada `chp/backup-capacity-01b` y **NO se
fusiona al linaje hotfix** hasta que su gate productivo (deploy 01B) pase —
consistente con la política del proyecto de ff solo tras gates productivos
GREEN. La rama parte del hotfix actual (`f885e31`).
