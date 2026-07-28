# CHP-RELEASE-IMAGE-01A — Nota sobre el manifiesto de identidad (NO APLICADO)

> **Esta unidad NO rebasa hashes, NO aplica el manifiesto y NO activa freeze.**
> El documento deja constancia del estado observado y del único procedimiento
> autorizado para el despliegue futuro.

Manifiesto: `scripts/migrations/chp-id-recon-01b/manifest.json`.

## 1. Estado observado (2026-07-28, lectura no destructiva)

| Store | Esperado por el manifiesto | Producción hoy | Veredicto |
|---|---|---|---|
| `data/groups_db.json` | `8766da5e…` (20 registros) | `8766da5e…` | **coincide** |
| `data/schools_db.json` | `7b7f269f…` (3 registros) | `7b7f269f…` | **coincide** |
| `data-critical/usuarios_colegios_oro.json` | `33377e4a…`, 333011 bytes, 647 registros | `f3561bb6…`, **333011 bytes, 647 registros** | **hash divergente** |

## 2. Interpretación

El padrón de usuarios es el **único** store cuyo hash divergió, y lo hizo
conservando **exactamente** el mismo tamaño en bytes (333011) y el mismo número
de registros (647).

Esa combinación es la firma característica de reescrituras in-place de
`lastLoginAt`: `server/server.js:2788` persiste la marca de login en el padrón
canónico, y una fecha ISO 8601 sustituida por otra ocupa idéntica longitud. Se
observó una de esas escrituras en vivo durante CHP-SEC-ADMIN-FILE-01D-R1
(login legítimo a las 14:21:38.220Z; `mtime` del archivo 14:21:38.222).

Distribución actual de roles: 1 administrador, 23 mediadores, 623 lectores
(647 total); 2 organizaciones distintas; 68 registros con `lastLoginAt`.

**Un hash divergente aquí NO implica por sí solo una alteración del padrón.**
Tampoco lo prueba inocuo: tamaño y conteo iguales son condición necesaria, no
suficiente. La verificación semántica es obligatoria antes de aplicar.

## 3. Procedimiento ÚNICO autorizado para el despliegue futuro (bajo freeze)

1. Activar el write freeze.
2. Comparar **semánticamente** el padrón contra el baseline aprobado, campo a
   campo, no por hash.
3. Si los **únicos** deltas son valores de `lastLoginAt` de usuarios que ya
   existían en el baseline → se permite **regenerar `expectedInputs`** con los
   hashes actuales.
4. **Preservar los valores nuevos de `lastLoginAt`.** No revertirlos: son
   actividad legítima de usuarios reales.
5. **STOP inmediato** ante cualquier otro delta:
   - altas o bajas de usuarios,
   - cambios de `roles`,
   - cambios de `organizationId`,
   - cambios de `groupIds` o memberships,
   - cualquier campo no aprobado.

No se autoriza ninguna otra forma de reconciliar el manifiesto. En particular,
no se autoriza regenerar hashes "porque no coinciden" sin la comparación
semántica del paso 2.

## 4. Fuera de alcance de esta unidad

- No se aplicó el manifiesto.
- No se rebasaron hashes.
- No se activó freeze.
- No se tocó ningún store productivo.
