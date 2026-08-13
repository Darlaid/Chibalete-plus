# M1_RELEASE_TRAIN_REHEARSAL — ensayo offline de integración

Unidad: **CHP-IDDB-M1-RELEASE-TRAIN-00** (2026-08-13). Rama:
`chp/m1-release-train-rehearsal` (evidencia, **jamás fuente productiva
directa**; nunca ff a hotfix). Base: `f885e31`.

## Veredicto

**GREEN — M1 RELEASE TRAIN INTEGRATES CLEANLY AND IS READY FOR SEQUENTIAL
PRODUCTION DEPLOYMENT**

## Orden ensayado y commits

```
f885e31 (base prod)
  → 434e938 merge BACKUP   (72d5f5e)   sin conflictos
  → 889254b merge GAP1     (806fce4)   sin conflictos
  → 2e13253 merge GAP3     (a8e5ae0)   1 conflicto: package.json
  → 035e176 ACTUALIZACIÓN DE CONTRATO GAP1→GAP3 (semántica, ver abajo)
  → ab1a771 merge GAP2     (1a9fec5)   4 conflictos: package.json,
             identityReadFacade.js, identityShadowCompare.js, metrics.js
  → d1fbd3a fixture M1 completo (18 casos)
```

## Conflictos y resoluciones exactas

| Archivo | Naturaleza | Resolución |
|---|---|---|
| `package.json` (×2) | GAP1/GAP3/GAP2 amplían cadenas de test en las mismas líneas | combinación aditiva: `test:identity` += groupDomains + userDomains (+ m1ReleaseTrain), `test:identity-candidate` += retireSyntheticCohort |
| `identityReadFacade.js` | ambos editan imports + la expresión `const arr` | combinación: users→`composeCanonicalUserView`, groups→`composeGroupReadView`, access→repo; ambos imports/counters |
| `identityShadowCompare.js` | ambos editan imports + absence policy | combinación: `exclGroups=attestedGroupExclusionMap` (GAP3) ∧ `exclUsers=Set(attestedUserExclusionMap)` (GAP2) — **una sola fuente atestada por entidad, cero clasificadores duplicados** |
| `observability/metrics.js` | ambos añaden un counter en el mismo anclaje | ambos counters, secuenciales |

**Cero rediseño**: todas las resoluciones son aditivas.

## Actualización de contrato GAP1→GAP3 (035e176)

La aserción PRE-GAP1 `SYNTHETIC_ACCESS_COMPAT_PRESERVED=true` se sustituye por
el contrato POST-retiro en la suite de GAP3 (fixture: cohorte disabled, regla
`expiresAt=1`):

```
SYNTHETIC_COMPAT_PRESENT=true      (el grupo se sirve vía compat atestada)
SYNTHETIC_ACCESS_INACTIVE=true     (la regla expirada no concede en NINGÚN modo)
SYNTHETIC_LOGIN_DISABLED=true      (verificado en el fixture M1 integrado)
```

No se reactivó ningún acceso para satisfacer tests antiguos. 41/41 GREEN.

**Obligación para las integraciones productivas**: si GAP3 se integra después
de GAP1 (el orden previsto), aplicar esta MISMA actualización de contrato
(commit de referencia `035e176`) como parte de la integración de GAP3.

## Fixture M1 completo (d1fbd3a — 18/18)

Cutover dual `users,groups` con LOGIN/WRITES/METRICS en JSON: login real 200 /
sintético 401; users admin 647 (247 SQLite + 400 compat, fantasma y tombstones
fuera); groups 20 (4+15+1, rogue fuera); regla sintética inactiva; regla real
concede; membresías resolubles; tombstone/unknown-user/unknown-group 404;
métricas físicas; RMW 648→648 y 21→21; `CREDENTIALS_IN_SQLITE=0` tras
mutaciones; comparador integrado: **UNEXPECTED=0 / SECURITY=0 / ERRORS=0**,
gaps solo contractuales (SYNTHETIC_USER=400 + fantasma estructural;
LEGACY_GROUP=17 = 16 atestados + rogue estructural; access 2 MATCH).

## Suite completa (F10)

`test:identity` (incluye las suites de las 4 unidades + fixture M1) exit 0 ·
backup-capacity 85/0 · memberships 51/0 · store-isolation 3 suites GREEN ·
`npm run build` ✓. (identityTwoProcessConcurrency: flaky Windows conocido,
GREEN en esta corrida.)

## Diff audit (F11)

31 archivos vs `f885e31`: 13 BACKUP · 3 GAP1 · 4 GAP3 · 6 GAP2 · 3
compartidos GAP3+GAP2 (los conflictos) · package.json (3 unidades) ·
**1 solo archivo INTEGRATION-only** (`m1ReleaseTrain.test.mjs`) + la
actualización semántica dentro de `identityGroupDomains.test.mjs` (origen
GAP3, modificada por 035e176). 17 deleciones totales (resoluciones + flip de
contrato). Sin features perdidas, sin tests borrados, sin debilitamiento, sin
secretos (los 2 matches del escaneo son los propios regex de los escáneres),
sin comandos destructivos de backup.

## Estrategia de integración productiva (F12)

La rama rehearsal NO se usa como fuente. Método para las ventanas reales,
preservando auditabilidad, CI exacto, hotfix lineal y rollback por unidad:

1. **BACKUP → hotfix actual**: `git merge --no-ff 72d5f5e` sobre el linaje
   hotfix (limpio, probado aquí). CI exacto → deploy 01B → hotfix avanza.
2. **GAP1 → nuevo hotfix**: `merge --no-ff 806fce4` (limpio). CI → deploy
   retirement → hotfix avanza.
3. **GAP3 → hotfix post-GAP1**: `merge --no-ff a8e5ae0` + resolución de
   package.json (esta receta) + **cherry-pick/replay de `035e176`** (contrato
   sintético post-GAP1). CI → deploy → hotfix avanza.
4. **GAP2 → hotfix post-GAP3**: `merge --no-ff 1a9fec5` + las 4 resoluciones
   exactas de `ab1a771` (recetas arriba) + incorporar
   `m1ReleaseTrain.test.mjs` (d1fbd3a) al chain. CI → deploy → evaluación M1.

- **Merges --no-ff** (no cherry-pick de los preps, no regeneración): conserva
  los SHAs auditados de cada prep con CI GREEN propio, y cada merge-commit es
  el punto de rollback por unidad (revert del merge o imagen N-1).
- **Sin force-push** de ninguna rama prep; las resoluciones se copian de esta
  rama rehearsal (los merge-commits `2e13253`/`ab1a771` son la referencia
  byte a byte — `git diff` contra ellos debe dar vacío en los archivos en
  conflicto).
- Tras CADA merge productivo: `npm run test:identity` completo antes del
  build de esa ventana.

## Riesgos restantes

- El rehearsal usa merges directos entre preps; en producción cada unidad se
  integra DESPUÉS de su deploy — el estado intermedio real incluye datos
  productivos mutados (retiro GAP1 aplicado): las suites ya modelan ese
  estado por fixture contractual.
- `identityTwoProcessConcurrency` puede flakear en Windows local; el veredicto
  bloqueante es CI Linux.
- La consolidación opcional de loaders (`identityDomainAttestations`) se
  evaluó y NO se hizo: los dos loaders comparten tabla pero son 10 líneas
  cada uno — crear el módulo común ahora sería framework sin deuda real.
