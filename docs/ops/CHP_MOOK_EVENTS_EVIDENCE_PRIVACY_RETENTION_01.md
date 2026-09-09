# CHP-MOOK-EVENTS-EVIDENCE-PRIVACY-RETENTION-01

Fecha: 2026-09-09. Tipo: **auditoría factual del ciclo de datos** de eventos y
evidencias MOOK (carril de consolidación de `CHP-ROADMAP-2026-05`). Solo lectura de
código, schemas, tests y documentación tracked. Cero SSH, cero producción, cero lectura
de stores reales, cero inspección de textos producidos por usuarios. No implementa
borrado, anonimización, migraciones ni infraestructura de retención.

---

## 1. Veredicto

**`YELLOW-MOOK-EVENTS-RETENTION-DECISION-REQUIRED-AND-PUBLISHED`**

Qué significa exactamente:

- los seis eventos `experience` tienen payloads **mínimos**: identificadores y hechos,
  sin nombres, correos, credenciales, cookies, tokens ni texto de producciones o
  retroalimentación (§3, §5);
- **no existe una duración de retención vinculante** en ninguna capa: el registro
  declara clases de retención que ningún código aplica, la rotación a archivo está
  apagada por defecto y sin política documentada, las evidencias no tienen vía de
  borrado, la proyección de 28 días es una ventana analítica y no una retención, y la
  política de backup 7/4/6 está aprobada como objetivo pero nunca se ha ejecutado (§7);
- el inventario factual queda publicado; las decisiones humanas que faltan se enumeran
  en §10 y son las únicas que esta unidad reclama;
- este documento **no** declara cumplimiento legal, anonimización ni una política que no
  exista.

## 2. Baseline verificado

```text
Rama: chp/mook-contract-00
HEAD: a247f472026e15341b374977bcbe5cbcb989a1af
Local == remoto (git ls-remote, sin fetch)
Tracked limpio
3 untracked preexistentes, sin abrir ni modificar
3 stashes preexistentes, sin abrir ni modificar
```

## 3. Flujo de datos y fuentes

Fuentes inspeccionadas (todas tracked): `server/analytics/eventRegistry.js`,
`server/experienceBackboneEmitter.mjs`, `server/services/analyticsShadow.mjs`
(`recordCanonicalEvent`), `server/eventsService.js` (schema `events`),
`server/aulaViva/archiveRotation.mjs`, `server/services/insightMaterializer.mjs`,
`server/services/signalCompute.mjs`, `server/db/insightsDbExt.mjs` y
`server/db/rollupsDbExt.mjs` (schemas de `insights.db`), `server/lib/experienceStore.js`,
las rutas MOOK de `server/server.js`, los tests `experienceStore.test.mjs`,
`experienceBackboneEmitter.test.mjs`, `insightMaterializer.test.js`,
`mookPrivateJournal.test.mjs`, `mookReview01.test.mjs`, `mookReviewIdentity01a.test.mjs`,
y el inventario de backup `ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py`
con `ops/backup/CHP-BACKUP-01A/{BACKUP_DESIGN,DEST_DECISION}.md`.

| Capa | Store | Tabla / estructura | Origen | Naturaleza |
|---|---|---|---|---|
| Estado de dominio y **evidencia pedagógica** | `data/mook_db.json` (JSON, lock de archivo) | `experiences`, `versions`, `runs`, `evidence` | `experienceStore` vía `mutateMook` | contenido producido por el participante + historial de revisión |
| **Evento de auditoría** | `data-critical/events.db` (SQLite WAL) | `events` | `experienceBackboneEmitter` → `recordCanonicalEvent` → `eventsService.insertEvent` | hechos con identificadores, flag-gated |
| Archivo frío de eventos | `data-critical/events.archive.db` | `events` (mismo schema) | `archiveRotation.rotateOnce` | copia de eventos antiguos; **flag OFF por defecto** |
| **Proyección analítica** | `data-critical/insights.db` | `signal_snapshots` (+ `signal_snapshots_history` opcional) | `insightMaterializer` (28 días, scope `user`) | agregados por señal, reconstruibles desde `events.db` |
| **Log operacional** | stdout del contenedor (`console.log`) | — | `log()` en `server.js` | líneas `[MOOK]` con ids de experiencia/versión/evidencia y decisión |
| **Backup** | repositorio restic (B2) | snapshots | runner CHP-BACKUP-01B | copia íntegra de `mook_db.json`, `events.db`, `insights.db` |

Flujo: la petición autenticada muta `mook_db.json`; solo después, y solo si
`EXPERIENCE_EVENTS_BACKBONE_ENABLED=1`, se emite el evento a `events.db` con el
`sessionId` firmado real o vacío. El materializador lee `events.db` y escribe agregados
en `insights.db`. La rotación, si se activa, mueve eventos con `server_ts` anterior a
`ARCHIVE_RETENTION_DAYS` (90 por defecto) a `events.archive.db` y los borra de
`events.db`. El backup copia los tres stores; `events.archive.db` **no figura** en el
inventario de backup.

## 4. Inventario por evento

Envelope común (emisor + `recordCanonicalEvent` + tabla `events`):

```text
event_id        ULID generado en servidor
event           nombre del evento
mode            'experience'
user_id         actorId (sujeto del hecho)         ← seudónimo, dato personal
content_id      null
session_id      sessionId de la sesión firmada, o '' si no hay sesión canónica  ← seudónimo
client_ts       Date.now() del servidor (no hay cliente)
server_ts       autoridad temporal del servidor
schema_version  1
payload_json    payload validado (zod .strip()); si falla la validación se inserta con marca
```

| Evento | Payload exacto (schema zod) | Sujeto (`user_id`) | Texto libre | Contenido de evidencia | Clase declarada |
|---|---|---|---|---|---|
| `experience_started` | `experienceId`, `experienceVersionId`, `runId` | participante | no | no | `warm_1y` |
| `node_started` | `experienceId`, `experienceVersionId`, `runId`, `nodeId`, `nodeType`, `moduleId?` | participante | no (`nodeType` es enum corto) | no | `warm_1y` |
| `node_completed` | `experienceId`, `experienceVersionId`, `runId`, `nodeId`, `nodeType`, `required?`, `moduleId?` | participante | no | no | `warm_1y` |
| `evidence_submitted` | `experienceId`, `experienceVersionId`, `runId`, `nodeId`, `nodeType`, `moduleId?`, `evidenceId`, `requiresReview` | participante | no | **no**: solo `evidenceId` (referencia) | `cold_archive` |
| `evidence_reviewed` | `experienceId`, `experienceVersionId`, `evidenceId`, `reviewerId?`, `decision` (enum) | participante (dueño de la evidencia) | no (la retroalimentación **no** viaja) | no | `cold_archive` |
| `experience_completed` | `experienceId`, `experienceVersionId`, `runId`, `requiredNodes` | participante | no | no | `cold_archive` |

Notas:

- El contrato de esta unidad enumera cinco eventos; el registro y el emisor definen
  seis (`node_started` es el sexto, mismo envelope y misma categoría). Se documenta
  entero.
- `reviewerId` en `evidence_reviewed` es un segundo seudónimo dentro del payload: el
  revisor queda vinculado al hecho aunque el sujeto de la fila sea el participante.
- `.strip()` elimina cualquier campo no declarado, por lo que un payload no puede
  arrastrar texto, cookies ni credenciales aunque el emisor se equivocara. Un payload
  **inválido** se inserta igualmente con `__validation_failed` e `__issues`
  («recovery-first»), es decir, con el payload original marcado.
- `privacy_level` declarado para toda la categoría: `pedagogical`.

## 5. Clasificación de identificadores

| Identificador | Dónde vive | Clasificación |
|---|---|---|
| `user_id` / `actorId` | fila de `events`, `runs.userId`, `evidence.userId`, `signal_snapshots.scope_id` | **dato personal seudonimizado**: es el id del padrón canónico y vincula toda la actividad con una persona identificable en `usuarios_colegios_oro.json` |
| `reviewerId` | `payload_json` de `evidence_reviewed`, `evidence.review.reviewerId`, `evidence.history[]` | **dato personal seudonimizado** del mediador o administrador |
| `session_id` | fila de `events` | **seudónimo de sesión**: vincula con `sessions.db` mientras la sesión exista |
| `runId`, `evidenceId`, `nodeId`, `moduleId`, `experienceId`, `experienceVersionId` | payloads y `mook_db.json` | identificadores técnicos; por sí solos no identifican a la persona, pero **encadenan** hacia `user_id` a través de `runs` y `evidence` |
| `event_id` (ULID) | fila de `events` | técnico, sin vínculo personal |

Conclusión: el sistema **seudonimiza**, no anonimiza. Sustituir nombre por id no rompe
el vínculo con la persona mientras exista el padrón. No se afirma anonimización en
ninguna capa.

## 6. Evidencias: metadata, contenido, acceso y ciclo de vida

Cada registro de `mook_db.json.evidence` guarda: `id`, `runId`, `userId`,
`experienceId`, `experienceVersionId`, `nodeId`, `nodeType`, `type: 'text'`,
`payload` (`answers[]` en ACTIVITY o `text` en PRODUCTION), `requiresReview`,
`submittedAt`, `review` (`status`, y tras el cierre `reviewerId`, `decision`,
`feedback`, `reviewedAt`), y en PRODUCTION `versions[]` (cada texto enviado con su
fecha) e `history[]` (append-only: `submitted`, `feedback`, `revision_requested`,
`resubmitted`, `reviewed`, con `reviewerId` y comentario cuando aplica).

- **Dónde vive el contenido:** únicamente en `mook_db.json`. El evento
  `evidence_submitted` **referencia** por `evidenceId`; jamás copia texto ni respuestas.
- **Reenvíos:** `resubmitEvidence` conserva todas las versiones anteriores; nada se
  sobrescribe. **Revisiones:** cada acción se agrega al historial; el estado
  `REVIEWED` es terminal.
- **Bitácora privada** (`ACTIVITY` con `config.privado: true`): append-only por
  contrato (cada guardado es un registro nuevo). Sus `answers` solo se proyectan al
  dueño (`myEvidenceView` → `participantEvidenceView`); `reviewDetailView` omite por
  completo esos nodos, sin bypass por rol; ante un nodo no resoluble se trata como
  privado (fail-closed). Demostrado por `mookPrivateJournal.test.mjs`.
- **Quién puede leer el resto** (contrato vigente en `a247f47`): el participante
  dueño; el mediador con sesión firmada y membership activa en un grupo del dueño; el
  administrador global. Otro participante, un mediador sin membership o de otra
  institución, una cuenta inactiva o una identidad legacy sin sesión canónica: denegado
  (`mookReview01.test.mjs`, `mookReviewIdentity01a.test.mjs`).
- **Borrado:** **no existe** ninguna vía. `experienceStore` no tiene función de borrado
  de evidencias ni de runs; `archiveExperience` solo marca la Experiencia como archivada
  y no toca runs ni evidencias. No hay borrado lógico, físico ni tombstone.
- **Backups:** cada snapshot contiene el `mook_db.json` íntegro, con todas las
  versiones de cada producción. El inventario de backup ya etiqueta este store como
  `sensitivity=minors` y `retention_status=NEEDS_LEGAL_REVIEW`.

Separación de ciclos de vida:

| Objeto | Ciclo de vida actual |
|---|---|
| Evento de auditoría (`events.db`) | append-only; rotación a archivo opcional y apagada |
| Evidencia pedagógica (`mook_db.json`) | append-only, sin borrado, con todas las versiones |
| Proyección analítica (`insights.db`) | upsert por `(scope, señal, período)`; reconstruible desde eventos |
| Log operacional (stdout) | rotación del driver Docker en el host |
| Backup (restic) | snapshots acumulativos; política 7/4/6 no aplicada |

## 7. Retención demostrada por capa

| Capa | Evidencia tracked | Retención |
|---|---|---|
| `events.db` | `eventRegistry.js` declara `retention_class` (`warm_1y` para la categoría; `cold_archive` para `evidence_submitted`, `evidence_reviewed`, `experience_completed`). **Ningún módulo lee `retention_class`**. `eventsService.js` no contiene `DELETE`. `archiveRotation.mjs` mueve a `events.archive.db` los eventos con `server_ts` anterior a `ARCHIVE_RETENTION_DAYS` (90 por defecto) **solo si `ARCHIVE_ROTATION_ENABLED=1`** (OFF por defecto), sin distinguir clases ni eventos, y el archivo no tiene purga. Su activación en producción no consta en ningún documento tracked y esta unidad no consultó producción. | `RETENTION_PERIOD: UNDEFINED` |
| Evidencias MOOK (`mook_db.json`) | sin función de borrado, sin expiración, sin tombstone; inventario de backup: `NEEDS_LEGAL_REVIEW` | `RETENTION_PERIOD: UNDEFINED` (conservación de hecho indefinida, no aprobada como política) |
| `insights.db` (`signal_snapshots`) | `PERIOD_DAYS = 28` es la **ventana de cómputo**: cada señal `experiencias_iniciadas`, `nodos_requeridos_completados`, `experiencias_completadas`, `evidencias_enviadas`, `revisiones_realizadas` se recalcula sobre los eventos de los últimos 28 días y se **upserta** en la fila `(user, señal, '28d')` con `metadata_json = { by_version, total, window_days }`. Un evento anterior a 28 días deja de contar, pero **no se borra** de `events.db` y la fila del snapshot persiste con su último valor. `signal_snapshots_history` (append-only) solo si `SNAPSHOT_HISTORY_ENABLED=1`. | ventana analítica de 28 días; `RETENTION_PERIOD: UNDEFINED` para los snapshots |
| Logs | `log()` escribe a stdout; el contenedor delega en el driver de Docker. No hay configuración de logging en el compose tracked; la rotación del daemon del host (observada en una unidad operativa previa: 10 MB × 3 archivos) no está fijada en ningún archivo del repositorio. Las líneas `[MOOK]` contienen ids de experiencia, versión y evidencia y la decisión, nunca texto ni nombres. | operativa, no vinculante; `RETENTION_PERIOD: UNDEFINED` |
| Backups | `BACKUP_DESIGN.md` y `DEST_DECISION.md`: política 7/4/6 (diarios/semanales/mensuales) **aprobada como objetivo**; `restic forget`/`prune` **bloqueados** hasta CHP-BACKUP-01C y nunca ejecutados según los documentos tracked. `events.archive.db` no está en el inventario de stores. | snapshots acumulativos sin poda: un dato conservado en cualquier snapshot puede reaparecer sin límite temporal definido |

No se confunden: la ventana analítica (28 días) no es retención; la clase declarada
(`warm_1y`, `cold_archive`) no está aplicada; la rotación a archivo (90 días) no es
borrado y está apagada; el backup no poda.

## 8. Minimización: condiciones técnicas verificadas

| Condición | Resultado | Dónde se demuestra |
|---|---|---|
| eventos sin nombres ni correos | cumple | schemas zod con `.strip()`; `experienceStore.test.mjs` J y `mookReview01.test.mjs` (payloads validan y no admiten texto/PII) |
| eventos sin texto de producciones ni feedback | cumple | `evidence_submitted` solo `evidenceId`; `evidence_reviewed` sin `feedback` |
| eventos sin cookies, tokens ni credenciales | cumple | envelope construido en servidor; `sessionId` es el id opaco de sesión, no la cookie |
| payload limitado a identificadores y hechos | cumple | tabla §4 |
| `sessionId` no sustituido por `runId` | cumple | emisor: vacío si no hay sesión firmada; `experienceBackboneEmitter.test.mjs` |
| revisión atribuida al revisor real | cumple | `reviewerId: req.user.id` de sesión; `mookReviewIdentity01a.test.mjs` B8/B8c |
| materializador no duplica contenido sensible | cumple | `signal_snapshots` guarda conteos y `by_version`; no copia payloads |
| ninguna base paralela MOOK | cumple | único sink `events.db` vía `recordCanonicalEvent`; estado en `mook_db.json` |

No se detectó contenido sensible innecesario en ningún payload canónico. Datos que
explícitamente **no** se almacenan en eventos ni proyecciones: nombre, correo,
contraseña o hash, cookie o token de sesión, texto de producción, respuestas de
actividad, comentarios de revisión, nombre de colegio, IP, user-agent.

## 9. Riesgos y vacíos confirmados

1. **Retención declarada pero no aplicada.** `retention_class` es metadata inerte;
   nadie la lee. Sin `ARCHIVE_ROTATION_ENABLED` los eventos crecen sin límite.
2. **Rotación sin política.** `archiveRotation` usa 90 días por defecto para todos los
   eventos, ignora las clases del registro, no purga el archivo, y `events.archive.db`
   no está en el inventario de backup: activarla crearía un store con datos personales
   fuera del respaldo.
3. **Evidencias sin salida.** No hay borrado, anonimización ni tombstone para
   producciones de menores; el propio inventario de backup lo marca como
   `NEEDS_LEGAL_REVIEW`. `events.db` e `insights.db` figuran allí con sensibilidad
   `standard`, aunque contienen los mismos seudónimos de menores.
4. **Reaparición por backup.** Cualquier borrado futuro no es efectivo mientras los
   snapshots no se poden; la política 7/4/6 sigue sin ejecutarse.
5. **Recovery-first.** Un payload inválido se persiste con marca. Hoy los emisores
   solo producen ids, pero el mecanismo no filtra contenido: la garantía descansa en
   los emisores, no en el sink.
6. **Logs fuera del repositorio.** La rotación de logs depende de la configuración del
   daemon del host, no versionada.
7. **Ventana 28 días ≠ olvido.** La proyección deja de contar, pero el evento fuente y
   el último snapshot permanecen.

Ninguno de estos puntos constituye `STOP-MOOK-EVENTS-SENSITIVE-PAYLOAD-DETECTED`: los
payloads canónicos son mínimos.

## 10. Decisiones humanas pendientes

Únicamente las que faltan de verdad:

1. **Duración de conservación de los eventos `experience`** en `events.db` y en
   `events.archive.db`, y si la rotación a archivo debe activarse, con qué cutoff y si
   debe respetar `retention_class`.
2. **Duración de conservación de las evidencias pedagógicas** (`mook_db.json`,
   incluidas versiones anteriores y bitácoras privadas), y si debe existir una vía de
   borrado o anonimización a solicitud.
3. **Retención de `signal_snapshots`** (y de `signal_snapshots_history` si se activa)
   cuando el sujeto deja de tener eventos.
4. **Ejecución de la política de backup 7/4/6** (`restic forget`/`prune`), hoy
   bloqueada, e inclusión o exclusión explícita de `events.archive.db`.
5. **Retención operativa de logs** fijada en configuración versionada.

Esta unidad no propone valores. No se registra ningún plazo como aprobado.

## 11. Límites del análisis

- No se leyó ningún store real ni texto de usuario; los campos se derivan de código,
  schemas y tests.
- No se consultó producción: el estado real de `EXPERIENCE_EVENTS_BACKBONE_ENABLED`,
  `ARCHIVE_ROTATION_ENABLED` y `SNAPSHOT_HISTORY_ENABLED` en las APIs no se verificó
  aquí. La documentación tracked de MOOK registra el flag de eventos como **OFF**.
- La rotación de logs del host se cita desde una unidad operativa previa, no desde un
  archivo del repositorio.
- No se evaluó la evidencia Leo referenciada por id desde nodos LEO (vive en su propio
  store y contrato).
- No se emite juicio de cumplimiento normativo.

## 12. Prohibiciones vigentes

No desplegar este análisis ni activar `EXPERIENCE_EVENTS_BACKBONE_ENABLED`,
`ARCHIVE_ROTATION_ENABLED` o `SNAPSHOT_HISTORY_ENABLED` en producción antes del GREEN de
M1. No modificar la política de retención, no ejecutar borrados ni `restic forget`
como consecuencia de este documento.

## 13. Mutaciones

Único archivo creado: este documento. Sin cambios en código, tests, schemas, stores,
producción ni backups.
