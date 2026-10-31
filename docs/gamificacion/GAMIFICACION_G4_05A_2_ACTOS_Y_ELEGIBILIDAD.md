# GAMIFICACION-G4-05A-2: actos por obra y elegibilidad

**Fecha:** 2026-10-31 · **Base:** `e63f3de` · **Producción:** sin cambios.
**Alcance:** procedencias elegibles, lectura autoritativa, elegibilidad histórica de obras y migración `0003`. Nada escribe en `gm_work_cycles`. Sin XP, PM, flags ni cifras.

## 1. Procedencias

Según `docker-compose.prod.yml`, producción usa `ACCESS_FALLBACK_MODE=restricted`. En ese modo, sin regla de scope la decisión termina en `SCOPE_NO_RULES`: **las ramas de grupo y organización solo se alcanzan en modo `open`**.

| Procedencia | Auditoría | Elegible |
|---|---|---|
| `SCOPE_TITLE`, `SCOPE_COLLECTION` | Regla explícita con vencimiento y sujeto canónico | Sí |
| `GROUP_CATALOG` | Lista explícita del grupo | Sí |
| `GROUP_ALL` | Valor `'all'` puesto por administración, nunca por defecto; exige grupo vigente y miembro canónico, y antes pasan obra, derechos y restricción pedagógica | **Sí** |
| `ORG_ALL` | Se resuelve por el texto `user.colegio`, no por `organizationId`. La misma vía se cerró en el motor de scopes (ID-GROUPS-RECON-01B) | **No: no verificable para el lector** |
| `ORG_CATALOG` | Misma identificación textual | **No** |
| `LEGACY_OPEN` | Ausencia de reglas | No |
| `ADMIN_ROLE`, `MEDIATOR_*` | Rol, no concesión al lector | No |

**Corrección de G4-05A-1:** `GROUP_CATALOG` también cubría la lista de `schoolConfig`, porque ambas se unen en `unionAccess`. Ahora la procedencia distingue grupo de organización. Las respuestas no cambian.

## 2. Caché

Cada réplica guarda `access_db`, `groups_db`, `school_configs` y `content` hasta 30 s, y el índice de derechos 20 s. Se comprobó que una réplica con caché seguía respondiendo `200` a una regla ya revocada.

`server.js` usa `workBlock` a través de `mookSource.mjs`, su única puerta al motor, y la lista de enganches permitidos de `ledgerCore` lo declara.

`checkWorkAccess` pasa a `decideContentAccess` un `readStore` que invalida la entrada antes de leer, e invalida el índice de derechos. Es el parámetro que ya existía: **el motor no cambia** y el resto de rutas sigue con caché. La vía de mediador lee su configuración aparte, pero no es elegible.

**Queda:** una revocación escrita después de la lectura y antes del sello. `at` registra el instante real de la comprobación.

## 3. Elegibilidad histórica de la obra

`status` no sirve como retirada: solo admite `procesando`, `disponible` o `error`, y puede cambiar por reprocesos. Consultarlo al procesar daba resultados distintos a gancho y barrido.

| Momento | Regla |
|---|---|
| **Entrega** | `workBlock` se evalúa una vez. Si la obra no es elegible, el snapshot queda `denied` con esa causa en `via`, por ejemplo `WORK_NOT_CLASSIFIED`. Sigue siendo el mismo formato de cuatro campos |
| **Después** | Cambios de catálogo, tipo o clasificación **no** alteran una evidencia ya entregada |
| **Retirada explícita** | Solo `legal_status` en `suspended`, `revoked` o `disputed` en la versión efectiva de derechos. Bloquea lo **pendiente** mientras dure; no revierte lo ya reconocido |

`legal_status` es append-only, administrativo y auditado. Una licencia vencida no es retirada, y una obra sin versiones de derechos no tiene régimen.

**Conexión:** `isWorkWithdrawn` es puro y `resolveEvidenceWork` recibe `isWithdrawn` inyectado; sin respuesta `false` no atribuye. **La lectura real del índice de derechos queda para G4-05A-3,** junto con el llamador.

**Consecuencia:** una obra reclasificada por Editorial no reabre evidencias anteriores. `via` conserva la causa si algún día se decide revisarlas.

No hizo falta un cambio transversal del modelo de permisos.

## 4. Migración `0003_work_cycle_acts`

```sql
PRIMARY KEY (fact_id, work_key, act)
CHECK (act IN ('reading','reflection'))
UNIQUE (subject_ref, work_key, cycle) WHERE act = 'reading'
UNIQUE (subject_ref, work_key, cycle) WHERE pm > 0
```

- Solo se aplica con `gm_work_cycles` vacía. Con filas aborta con `0003_REQUIRES_EMPTY_WORK_CYCLES` y no cambia nada.
- Se conservan clave foránea y triggers append-only. Las migraciones anteriores no se tocaron.
- `WORK_CYCLE_ACTS` en `recognition.mjs` coincide con el `CHECK`, y hay prueba.
- `route` no se registra aquí: no tiene obra.

**Concurrencia:** la prueba destapó un fallo previo. Un proceso podía repetir una versión ya confirmada por otro y chocar con `UNIQUE _migrations.version`. La transacción se revertía y los datos quedaban bien, pero esa réplica caía a «no disponible» durante 30 s. `openAndMigrate` lo reintenta ahora como un `BUSY`. El runner compartido con identidad no cambió.

**`intake.mjs`** sigue exigiendo `0002`: no escribe ciclos. G4-05A-3 debe exigir `0003`.

## 5. Antes de G4-05A-3

1. Inyectar `isWithdrawn` desde el índice de derechos.
2. Conectar `mookRecognitionEvidence`, escribir `gm_work_cycles` y desbloquear XP de `mook_review`, con `PM_LOCKED_SOURCES` intacto.
3. Ampliar `validateRules` con la configuración, sin cifras en el código.
4. Probar dos procesos escribiendo el mismo ciclo (T14).
5. Aprobar A7 y A12 antes de activar.
