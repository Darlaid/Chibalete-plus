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

## R1 — Endurecimiento de expected-gaps (`ba4fde3`)

**Defecto confirmado y corregido**: la absence policy convertía rechazos
ESTRUCTURALES en expected — un rogue org-less se escondía como
`LEGACY_GROUP`, un usuario no-proyectable como `NOT_PROJECTABLE_BY_POLICY`,
y un marcador `_loadtest_marker` SIN exclusión atestada como
`SYNTHETIC_USER` (vector de drift auto-marcado). Contrato vinculante desde
R1: **EXPECTED ⇔ atestación explícita** (migration_exclusions /
identity_tombstones / contrato de credenciales); `WHY_NOT_PROJECTED` es
diagnóstico en la muestra (`UNPROJECTABLE_*`, `MARKER_WITHOUT_ATTESTATION`,
`INSTITUTION_NOT_REGISTERED`), jamás severidad. Matriz negativa completa
probada (11 casos); severidad de ausencias = dirección DENY (unexpected,
no security: una ausencia no puede conceder). Fixture M1 partido:
escenario rogue (drift DETECTADO ≥1 por dominio) + sano (0/0/0 con conteos
contractuales EXACTOS: `SYNTHETIC_USER=400`, `LEGACY_GROUP=16`). Baseline
productivo re-verificado read-only: 0 entidades no atestadas en ambos
dominios ⇒ el endurecimiento no introduce divergencias hoy. La evidencia
histórica «GAP-3: legacy 404 bajo cutover» se invirtió al contrato nuevo
(legacy ATESTADO → 200 vía compat; fail-closed vive en los NO atestados).

**Delta a reaplicar en producción**: `ba4fde3` viaja con la integración de
GAP2 (su punto natural de dependencia: usa el loader de users). Ventana
GAP3→GAP2 con la política laxa de grupos: sin impacto productivo (0 no
atestados, verificado) — documentado y aceptado.

## R1 — Estrategia de integración productiva FINAL (auditada)

**Práctica real del hotfix** (auditada en git): linaje estrictamente LINEAL
— 0 merge-commits en `eec39e9..f885e31`; cada unidad avanzó por ff puro
porque eran SECUENCIALES. Con 4 preps paralelas basadas en `f885e31`, el ff
puro solo es posible para la primera.

**Estrategia seleccionada (por evidencia, no estética): HÍBRIDA**
- **ff puro donde es posible** (preserva la práctica histórica):
  BACKUP `72d5f5e` es descendiente directo de `f885e31` → el hotfix avanza
  por ff sin commit nuevo.
- **`merge --no-ff` para el resto** (preps no descendientes del tip móvil):
  preserva el SHA prep auditado con su CI propio, el merge-commit es el
  punto de resolución (recetas byte a byte de este rehearsal) y el punto de
  rollback por unidad (revert del merge). Cherry-pick/regeneración quedan
  DESCARTADOS: pierden provenance del SHA preparado.
- **Sin force-push jamás** de ramas prep.

**GATE EXPLÍCITO DE CI (F14)**: el ÁRBOL EXACTO que va a build productiva
debe tener CI GREEN DESPUÉS de resolver conflictos. «La rama original tenía
CI GREEN» NO es sustituto. Este rehearsal lo demuestra viable: los 3
workflows están GREEN sobre el árbol integrado completo.

## R1 — Contrato de SHAs del release train (placeholders, no inventados)

| Unidad | BASE SHA | SOURCE SHA | INTEGRATION SHA | CI SHA | BUILD SHA | ROLLBACK |
|---|---|---|---|---|---|---|
| BACKUP | `f885e31` (hotfix) | `72d5f5e` | = `72d5f5e` (ff puro) | `72d5f5e` | n/a (deploy systemd, sin imagen API) | retirar drop-ins + hotfix previo |
| GAP1 | H₁ := `72d5f5e` | `806fce4` | M₁ := merge(H₁, `806fce4`) | M₁ | M₁ (git-archive) | imagen `f885e31`* + revert M₁ |
| GAP3 | H₂ := M₁ | `a8e5ae0` | M₂ := merge + receta package.json (`2e13253`) + replay `035e176` | M₂ | M₂ | imagen M₁ + revert M₂ |
| GAP2 | H₃ := M₂ | `1a9fec5` | M₃ := merge + recetas `ab1a771` + replay `d1fbd3a` (fixture M1) + replay `ba4fde3` (strictness) | M₃ | M₃ | imagen M₂ + revert M₃ |

\* BACKUP no produce imagen API: la imagen N-1 de GAP1 sigue siendo
`f885e31`. Tras cada merge: `npm run test:identity` local + CI exact-tree
GREEN antes del build de esa ventana.

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
