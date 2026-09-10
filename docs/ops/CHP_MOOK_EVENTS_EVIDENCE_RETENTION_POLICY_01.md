# CHP-MOOK-EVENTS-EVIDENCE-RETENTION-POLICY-01

Fecha: 2026-09-09, 19:56 (America/Bogota). Tipo: **registro documental de una
decisión ejecutiva** (carril de consolidación de `CHP-ROADMAP-2026-05`, sucesor de
`CHP_MOOK_EVENTS_EVIDENCE_PRIVACY_RETENTION_01.md`). Cero código, cero SSH, cero
producción, cero stores reales, cero backups. Esta unidad **solo documenta** la política
aprobada: no implementa rotación, borrado, poda ni cambio productivo alguno, y no
autoriza eliminar ningún dato.

---

## 1. Veredicto

**`GREEN-MOOK-RETENTION-POLICY-APPROVED-AND-PUBLISHED`**

Qué significa exactamente:

- la política de retención por capa queda **aprobada y publicada**;
- su **implementación no ha comenzado**: las duraciones de este documento describen el
  estado objetivo, no el comportamiento actual del sistema, que sigue siendo el
  registrado en el informe factual (retención indefinida en todas las capas);
- ninguna eliminación, rotación, poda de backups ni activación de eventos en producción
  queda autorizada por este documento;
- no se declara cumplimiento legal integral.

## 2. Baseline verificado

```text
Rama: chp/mook-contract-00
HEAD: fda30c60ce0aff4fa18c2c596004ce2bd4211c8d
Local == remoto (git ls-remote, sin fetch)
Tracked limpio
3 untracked preexistentes, sin abrir ni modificar
3 stashes preexistentes, sin abrir ni modificar
```

## 3. Fuente factual

Única fuente leída: `docs/ops/CHP_MOOK_EVENTS_EVIDENCE_PRIVACY_RETENTION_01.md`,
publicada en el commit `fda30c60ce0aff4fa18c2c596004ce2bd4211c8d`. Se confirmó que
registra los hechos sobre los que se decide:

- payloads canónicos mínimos (identificadores y hechos, sin texto ni credenciales);
- identificadores seudonimizados, no anónimos;
- contenido de evidencias fuera de `events.db` (solo en `mook_db.json`, referenciado
  por id);
- `RETENTION_PERIOD: UNDEFINED` en todas las capas;
- ventana de cómputo de 28 días en `insights.db`, distinta de una retención;
- backups sin poda efectiva (`forget`/`prune` nunca ejecutados);
- payload inválido persistido con marca `__validation_failed`, es decir, susceptible de
  conservar contenido no validado;
- cinco decisiones humanas pendientes (§10 del informe).

No se reauditó código ni se ampliaron fuentes.

## 4. Autoridad y fecha

```text
AUTORIDAD:
Nicolás Jiménez, Director de Chibalete Editores

FECHA_DE_LA_DECISION:
2026-09-09, 19:56, America/Bogota

ALCANCE:
eventos canónicos, evidencias pedagógicas, proyecciones analíticas,
logs y backups de Chibalete+
```

## 5. Política aprobada por capa

### 5.1 Eventos canónicos

```text
events.db:                  90 días desde occurred_at
events.archive.db:          desde el día 91 hasta completar 12 meses
eliminación definitiva:     al superar 12 meses
archivo indefinido:         prohibido
```

Finalidad operativa: memoria pedagógica reciente en caliente, trazabilidad hasta un año
y ningún acumulado perpetuo de actividad seudonimizada de menores.

La rotación futura deberá usar el mecanismo existente (`archiveRotation`) y no crear
otro sistema. Referencia temporal: `occurred_at` corresponde al `server_ts` de la fila
(autoridad temporal del servidor).

### 5.2 Evidencias pedagógicas

Conservar mientras exista la relación educativa o contractual activa. Terminada la
relación, la expiración será:

```text
max(fin de la relación, última actividad de la evidencia) + 12 meses
```

Superado ese límite deberán eliminarse la producción y todas sus versiones, salvo
obligación legal o contractual específica y documentada.

Finalidad operativa: que el participante y su mediador dispongan de la producción y su
historial durante el proceso pedagógico, sin conservación indefinida de textos de
menores una vez concluido.

**No se autoriza ninguna eliminación en esta unidad.**

### 5.3 Proyecciones analíticas

```text
signal_snapshots: 90 días desde su última generación o actualización
```

Son datos derivados y reconstruibles desde `events.db`. La ventana de cómputo de 28
días del materializador permanece intacta y **no** se presenta como política de
retención.

### 5.4 Backups

Aplicar en una unidad posterior la política ya aprobada como objetivo en
`ops/backup/CHP-BACKUP-01A/DEST_DECISION.md`:

```text
7 snapshots diarios
4 snapshots semanales
6 snapshots mensuales
```

`events.archive.db` deberá incluirse expresamente en el inventario de stores cuando la
rotación sea activada.

Un dato eliminado del entorno vivo podrá permanecer únicamente hasta que expire el
último snapshot mensual que lo contenga.

**No ejecutar `forget`, `prune` ni eliminar snapshots en esta unidad.**

### 5.5 Logs

```text
retención máxima: 30 días
```

Los logs no deben contener texto de evidencias, feedback pedagógico, nombres, correos,
cookies, tokens ni credenciales. Una conservación excepcional solo podrá responder a un
incidente específico y documentado.

## 6. Excepción legal documentada

Toda excepción a las duraciones anteriores debe:

1. responder a una obligación legal o contractual concreta;
2. quedar documentada con su fundamento, alcance y fecha de expiración;
3. limitarse a los datos estrictamente necesarios.

Sin ese registro, la excepción no existe y aplica la política.

## 7. Invariante de minimización para la implementación

Requisito vinculante de la futura implementación del sink de eventos:

> Un evento cuyo payload no valide no debe conservar el payload crudo. Solo podrá
> registrar un envelope mínimo saneado, el nombre del evento, timestamp y código de
> fallo de validación.

Hoy el sink persiste el payload original con marca (`recovery-first`). **No se corrige
en esta unidad.**

## 8. Política aprobada vs. implementación pendiente

| Capa | Comportamiento actual (informe factual) | Política aprobada | Implementación |
|---|---|---|---|
| `events.db` / `events.archive.db` | sin purga; rotación 90 d apagada; archivo sin límite y fuera del backup | 90 d caliente, 12 meses total, eliminación definitiva | pendiente |
| Evidencias (`mook_db.json`) | sin vía de borrado; versiones perpetuas | relación activa + 12 meses; borrado de producción y versiones | pendiente |
| `signal_snapshots` | upsert perpetuo | 90 d desde última actualización | pendiente |
| Backups | snapshots acumulativos sin poda | 7/4/6 con `events.archive.db` incluido | pendiente |
| Logs | rotación del daemon del host, no versionada | máximo 30 d, sin contenido sensible | pendiente |
| Payload inválido | se persiste crudo con marca | prohibido conservar el crudo | pendiente |

## 9. Estado resultante

```text
RETENTION_POLICY: APPROVED
EVENT_RETENTION: 12_MONTHS_MAX
EVIDENCE_RETENTION: ACTIVE_RELATION_PLUS_12_MONTHS
SIGNAL_RETENTION: 90_DAYS
LOG_RETENTION: 30_DAYS
BACKUP_RETENTION: 7_DAILY_4_WEEKLY_6_MONTHLY
INVALID_PAYLOAD_RAW_STORAGE: PROHIBITED
RETENTION_IMPLEMENTATION: NOT_STARTED
DELETION_EXECUTION: NOT_AUTHORIZED
EVENTS_PRODUCTION_ACTIVATION: NOT_AUTHORIZED
M2: AMBER-RETENTION-POLICY-APPROVED
M5: AMBER-PRIVACY-POLICY-APPROVED
```

## 10. Prohibiciones vigentes

Desde esta unidad no se despliega, no se activa `EXPERIENCE_EVENTS_BACKBONE_ENABLED`,
`ARCHIVE_ROTATION_ENABLED` ni `SNAPSHOT_HISTORY_ENABLED` en producción, no se ejecuta
`restic forget`/`prune`, y no se elimina ningún evento, evidencia, snapshot ni log.
Todo ello requiere unidades posteriores con su propio preflight y, para la eliminación
de datos, autorización humana explícita.

## 11. Siguiente paso

Una implementación local mínima y probada sobre los mecanismos existentes, sin
despliegue, que materialice esta política capa por capa.

## 12. Mutaciones

Único archivo creado: este documento. Sin cambios en código, tests, schemas, stores,
producción ni backups.
