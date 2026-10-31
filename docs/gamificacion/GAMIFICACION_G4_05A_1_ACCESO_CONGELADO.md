# GAMIFICACION-G4-05A-1: acceso congelado en evidencias MOOK

**Fecha:** 2026-10-31 · **Base:** `137a5a8` sobre `757280e` · **Producción:** sin cambios.
**Alcance:** registrar la decisión de acceso en la primera entrega. Sin migración, flags, XP ni PM. Resuelve el §2 de [G4-05A STOP](GAMIFICACION_G4_05A_STOP.md); los §3 y §4 siguen abiertos.

## 1. Recorrido

`POST /api/experiences/runs/:runId/nodes/:nodeId/evidence`:

1. `requireUserAuth` y `b2cEntitlementGuard` fijan el usuario desde el servidor.
2. `checkWorkAccess` invalida la caché de MOOK y localiza run, versión y nodo. Sale sin consultar si el run no es del usuario, si el nodo ya está completado o si no hay obra válida declarada.
3. Consulta `decideContentAccess` **fuera del lock**.
4. `mutateMook` toma el lock `O_EXCL` entre procesos y relee el documento.
5. `submitEvidence` valida la entrega. Si ya existe, devuelve la existente **sin escribir**. Si es nueva, sella el snapshot.

Una entrega rechazada, por ejemplo por longitud, no deja rastro: la primera entrega **válida** vuelve a comprobar.

## 2. Forma

```js
evidence.workAccess = {
    workRef: 'contentId',
    decision: 'allowed' | 'denied' | 'indeterminate',
    via: 'SCOPE_TITLE',      // procedencia del servidor
    at: '2026-10-31T…Z',     // instante de comprobación
};
```

Solo existe en `PRODUCTION` con obra declarada. No contiene identidad: la evidencia ya la tiene.

**Procedencia:** `decideContentAccess` y `canUserAccessContent` añaden `via`, un campo nuevo al nivel de `status` y fuera de `body`. Todos sus llamadores usan solo `status` y `body`, así que ninguna respuesta cambia.

| Elegible para reconocimiento | No elegible |
|---|---|
| `SCOPE_TITLE`, `SCOPE_COLLECTION`, `GROUP_CATALOG` | `LEGACY_OPEN` y cualquier otra procedencia, incluidas `ADMIN_ROLE`, `MEDIATOR_*`, `GROUP_ALL` y `ORG_ALL` |

`GROUP_ALL` y `ORG_ALL` son concesiones generales, no de esta obra: quedan fuera por prudencia. Como `via` se guarda tal cual, `EXPLICIT_ACCESS_VIAS` se puede ampliar sin recalcular nada.

`indeterminate` cubre un error del motor, una decisión ilegible o sin procedencia. Es definitivo para esa evidencia.

## 3. Garantías

| Garantía | Mecanismo |
|---|---|
| Primera escritura gana | La consulta asíncrona puede repetirse, pero solo la petición que crea la evidencia sella, bajo lock |
| Sin sobrescritura | `submitEvidence` es la única función que lo escribe. Reintento, reenvío y revisión no lo tocan |
| Dos réplicas | Lock entre procesos y relectura dentro de él |
| Sin aporte del cliente | Es un parámetro del servidor; `payload` solo guarda `text` |
| Coherencia con la obra | El store rechaza un snapshot cuya obra no sea la del nodo publicado |
| Sin permiso permanente | El motor de acceso no lee este campo |
| Sin exposición | Ninguna proyección incluye `workAccess` |
| Fallo seguro | Un error de acceso nunca impide entregar |
| Sin reconsulta | `resolveEvidenceWork` dejó de recibir `canAccess`: solo lee el snapshot |

No hizo falta el STOP arquitectónico.

## 4. Riesgos residuales

- **Caché de 30 s:** cada réplica guarda `access_db` hasta 30 s. Una revocación reciente puede congelarse como `allowed`, igual que hoy puede dar acceso a la obra durante ese margen.
- **Catálogo vivo:** `workBlock` se evalúa al procesar. Si una obra se retira entre entrega y revisión, el resultado depende del momento, y G4-05A-2 debe decidir si se congela también. El encargo limitó el snapshot a cuatro campos.
- **Hueco entre comprobación y escritura:** `at` puede preceder unos milisegundos a la entrega; el orden de carrera lo decide el lock, no `at`.
- **Lock expirado:** `usersLock` retira un lock con más antigüedad que `LOCK_STALE_MS`. Un proceso bloqueado más tiempo podría solaparse; es deuda preexistente de todo `mook_db.json`.
- **Integridad en disco:** quien escriba `mook_db.json` directamente puede alterar el snapshot. No está firmado.
- **Modo `open`:** cuentas sin regla explícita quedarán sin reconocimiento por diseño. Conviene medirlo antes de activar.
- **Procedencia sin regla:** `via` indica el mecanismo, no qué regla concreta, porque las reglas no tienen historial.
- **Registro inerte:** en la copia local ningún nodo `PRODUCTION` tiene `resourceRef`, así que no se escribiría ningún snapshot. Producción no se midió.
