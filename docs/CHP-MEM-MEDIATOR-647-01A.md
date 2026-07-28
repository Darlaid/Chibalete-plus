# CHP-MEM-MEDIATOR-647-01A — Reparación de membership del mediador FilBo

> **Estado: DRY-RUN. NO APLICADO.** Este documento prepara la unidad `01B`.
> No contiene identificadores personales: el usuario objetivo vive únicamente en
> un manifiesto root-only del VPS que no se versiona.

## 1. Síntoma

Un mediador legítimo de *Chibalete Club FilBo 2026* recibe **403
`scope_access_denied` / `ORGANIZATION_MISMATCH`** al consultar
`/api/v2/metrics/organizations/school-1777176810244`, pese a:

- tener `roles: ["mediador"]`,
- `accountStatus: "active"`,
- `organizationId: "school-1777176810244"`,
- `groupIds: ["group-1777177383528"]`,
- figurar en `memberIds` de ese grupo.

## 2. Causa exacta

El grupo `group-1777177383528` tiene **`mediatorIds: []`**. El usuario está en
`memberIds` (y en su espejo `studentIds`), pero no en `mediatorIds`.

La cadena de decisión es:

```
getMemberships(principal)
  ├─ isMediatorOfGroup(g, id)  → lee mediatorId / mediatorIds / mediadores
  │                              → false  ⇒ NO se emite membresía 'mediator'
  └─ getExplicitGroupMembers(g) → true    ⇒ se emite membresía 'member'

resolveScope(principal)
  └─ sólo agrega organizationId cuando m.role === 'mediator'
     ⇒ organizationIds = []   ⇒ ORGANIZATION_MISMATCH en la API v2
```

`getMemberships` **no** elige entre roles: hace dos comprobaciones
independientes y puede emitir ambas membresías para el mismo grupo. Por eso
añadir el principal a `mediatorIds` **no** lo saca de `memberIds`: pasa a tener
las dos, y `resolveScope` deriva el scope institucional de la de mediador.

### Causas descartadas

| Hipótesis | Verificación |
|---|---|
| `organizationId` incorrecto en el usuario | coincide con FilBo |
| Grupo histórico | tiene `organizationId`; el CIS lo clasifica `ACTIVE_REAL` |
| Institución no registrada | `school-1777176810244` existe en `schools_db.json` |
| Fallo de la API de métricas | otras organizaciones responden correctamente |
| Error de despliegue | ambas API en la imagen inmutable, healthy, `restarts=0` |

### Sobre `studentIds`

El principal también aparece en `studentIds`. **No es una anomalía:**
`utils/groupMembership.mjs` documenta que `studentIds` y `memberIds` se
mantienen sincronizados y `getGroupMembers` devuelve su **unión**. En producción
los 20 grupos tienen divergencia cero entre ambos arrays. La reparación **no
toca** ninguno de los dos.

## 3. Operación propuesta (única)

```
group-1777177383528.mediatorIds += <principalId>
```

Exactamente una vez, conservando el resto de campos y el orden existente.

**No se modifica:** `memberIds`, `studentIds`, `teacherId`, ningún otro grupo, ni
el padrón de usuarios (`roles`, `organizationId`, `groupIds`, `accountStatus`,
`password`).

## 4. Invariantes

| Invariante | Antes | Después |
|---|---|---|
| usuarios | 647 | 647 |
| grupos | 20 | 20 |
| instituciones | 4 | 4 |
| memberships (Σ `memberIds`) | 625 | 625 |
| `mediatorIds` del grupo objetivo | 0 | **1** |
| `memberIds` del grupo objetivo | 38 | 38 |
| `studentIds` del grupo objetivo | 38 | 38 |
| otros grupos modificados | — | 0 |
| padrón de usuarios | — | byte a byte idéntico |

## 5. Impacto de autorización

Simulación sobre una copia aislada, evaluando la ruta real de la API v2
(`authorize` → `evaluateScopeAccess`) en procesos separados:

| Scope | Antes | Después |
|---|---|---|
| organización FilBo | 403 `ORGANIZATION_MISMATCH` | **200 `mediator_in_organization`** |
| grupo `group-1777177383528` | 403 `not_mediator_of_group` | **200 `mediator_of_group`** |
| Villas de Aranjuez | 403 | 403 |
| Nuevo Bosque | 403 | 403 |
| Externado | 403 | 403 |
| grupos históricos | 403 | 403 |
| grupo `lt-org` | 403 | 403 |

Shadow del CIS sobre la matriz completa (647 principales × 24 scopes = **15.528
decisiones**): 15.527 idénticas, **1 restaurada**, `HIGH_RISK_ACCESS_EXPANSION=0`,
`HIGH_RISK_ACCESS_LOSS=0`, `REVIEW_UNEXPLAINED=0`. Ningún lector cambia de
decisión.

## 6. Sin impacto poblacional

La corrección cambia **autorización**, no población. Se mantienen:
`registeredUsers=47`, `registeredReaders=46`, `eligibleReaders=44`,
`readersWithoutGroup=2`.

## 7. Migrador

`scripts/migrations/chp-mem-mediator-647/migrate.mjs` — genérico y sin datos
productivos: `--root` obligatorio, el `principalId` llega por manifiesto externo.

```bash
# dry-run (por defecto)
node scripts/migrations/chp-mem-mediator-647/migrate.mjs \
     --manifest /root/m647/manifest.json --root /var/www/chibalete --json

# apply (unidad 01B) — exige backup gate
CHP_BACKUP_GATE=GREEN node scripts/migrations/chp-mem-mediator-647/migrate.mjs \
     --manifest /root/m647/manifest.json --root /var/www/chibalete --apply
```

Precondiciones: schema válido, archivo regular sin symlinks, sin path escape,
`sha256` del grupo objetivo, fingerprint **semántico** del usuario (excluye
`lastLoginAt`, volátil y legítimo), principal presente exactamente una vez en
`memberIds`, grupo con `organizationId` y fuera de las organizaciones sintéticas.

**Idempotencia:** si el principal ya está en `mediatorIds`, devuelve
`ALREADY_APPLIED` con 0 cambios **sin exigir el hash previo** — tras un apply el
grupo cambia de hash por definición, y exigirlo convertiría la idempotencia en un
falso STOP.

## 8. Procedimiento de apply (unidad 01B)

1. Snapshot estructurado fresco; registrar `snapshot_id`.
2. Copia byte a byte de `groups_db.json` root-only.
3. Dry-run; confirmar `totalChanges=1` y `fieldsChanged=["mediatorIds"]`.
4. `--apply` con `CHP_BACKUP_GATE=GREEN`, una sola vez.
5. Verificar conteos de §4 y las poblaciones de §6.
6. Segunda ejecución → `ALREADY_APPLIED`, 0 cambios.
7. Smoke: la organización y el grupo FilBo pasan a 200 para el principal; las
   otras tres instituciones siguen en 403.
8. Snapshot posterior.

Las API leen los stores en cada request (sin caché largo), así que **no** hace
falta recrear contenedores ni desplegar.

## 9. Rollback

El migrador deja `groups_db.json.pre-CHP-MEM-MEDIATOR-647` (copia byte a byte)
antes de escribir. `rollback()` lo restaura mediante escritura atómica y devuelve
el `sha256` original. Probado: los bytes restaurados son idénticos a los previos.

## 10. Pruebas

`scripts/migrations/chp-mem-mediator-647/__test__/migrate.test.mjs` — 51
aserciones sobre fixtures en `mkdtemp`; ningún test toca stores reales ni
contiene PII. Cubre: dry-run sin escritura, apply, permanencia en `memberIds`,
no adición a `studentIds`, determinismo, idempotencia, STOP por target duplicado,
rol incorrecto, organización distinta, grupo histórico o sintético, hash
inesperado, `ALREADY_APPLIED`, fingerprint semántico (insensible a `lastLoginAt`,
sensible a rol/`groupIds`/organización/estado/email), rollback byte a byte,
ausencia de PII en la salida, path escape y backup gate.
