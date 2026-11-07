# Acta O1 — Reglas de XP (modelo)

| Campo | Valor |
|---|---|
| `approvalRef` | `DIR-XP-O1-20261107` |
| Emite | Dirección (por cargo) |
| Fecha | 2026-11-07 |
| Alcance | **Modelo de reglas.** No autoriza la activación (J8), no instala reglas, no fija el corte |
| Contrato de origen | [A7-A12-V3](../GAMIFICACION_A7_A12_APROBACION_V3.md) §1, en su forma solo XP ([V8-UNIFIED-XP-01](../GAMIFICACION_V8_UNIFIED_XP_01.md)) |
| `ruleVersion` | `a7a12-v3-xp-o1` |
| Entrada en vigor | La fija el paso F4 de la activación: `effectiveFrom` ≥ el momento de la instalación y ≤ la publicación de F6. Nunca retroactiva |
| SHA-256 del bloque `rules` | `95613ec318be14c820deece4cde62055e69549d66053490b11f91434afd89878` |

## 1. Decisiones que formaliza

1. **XP es la única escala.** No existen Puntos de Magia, topes de PM, canjes ni campos heredados (`caps`, `pm`, `amounts.pm`, `reread.pmFactors`).
2. **Reconocimiento:** la primera evidencia aprobada de una obra da 10 (lectura) + 20 (reflexión) = **30 XP**; la segunda aprobada de la misma obra, **+20**; el máximo es **50 XP por obra y ciclo**. Ciclo único: no hay relecturas remuneradas.
3. **Solo evidencia pedagógica aprobada** por un mediador con alcance sobre el lector genera XP (`mook_review` por la vía del reconocimiento). No dan XP los clics, el tiempo de lectura, la finalización automática de la lectura ni el recorrido MOOK (`facts` vacío, ruta 0; `reading_completion` y `offline_validation` siguen bloqueadas por código).
4. **Niveles activos:** Semilla (0 XP) y Brote (30 XP y 1 obra). Ningún otro nivel, recompensa ni moneda.
5. **El mediador solo consulta a sus propios estudiantes:** XP, nivel, obras reconocidas y logros de las personas de los grupos que media; nada de otros grupos ni colegios, sin rankings ni comparaciones.

## 2. Bloque `rules` (literal para `createRuleSet`)

Es exactamente el objeto que se pasa en F4. El SHA-256 de la tabla es el de `JSON.stringify` de este objeto, el mismo que guarda `gm_rule_sets.rules_sha256`.

```json
{"schema":1,"facts":{},"recognition":{"approvalRef":"DIR-XP-O1-20261107","amounts":{"xp":{"reading":10,"reflection":20,"validated":0,"route":0}},"xpCeilingPerWorkCycle":50,"reread":{"windowDays":30,"xpFactors":[]}}}
```

`windowDays` es obligatorio por validación y no tiene efecto con `xpFactors` vacío. `validated` y `route` son 0.

## 3. Uso en F4 (sin ejecutar hoy)

Dentro de `api_1`, con un proceso puntual: `createRuleSet(getGamificationDb(), { ruleVersion: 'a7a12-v3-xp-o1', createdBy: '<cargo del operador>', effectiveFrom, rules })` con el bloque de §2 sin modificar. Evidencia: `getActiveRuleSet` devuelve `a7a12-v3-xp-o1`, `rules_sha256` coincide con la tabla y una repetición devuelve `created:false`. Cualquier error de validación es **STOP**: no se corrige a mano, se emite un acta nueva.

## 4. Verificación

`node docs/gamificacion/aprobaciones/verificar_o1.mjs` lee el bloque de §2 de este archivo y lo ejecuta contra el código real sobre una base temporal sintética (sin clave, sin datos reales). Resultado en [V8-ACTIVATION-GATE-01](../GAMIFICACION_V8_ACTIVATION_GATE_01.md) §3.

## 5. Lo que este acta no hace

No aprueba PRIV-6, no elige una base jurídica, no decide D1–D9 ni L1–L5, no emite la orden de activación (J8) y no cambia ningún valor de A7-A12-V3. Cambiar un valor exige un acta nueva con otra `ruleVersion` (D48).
