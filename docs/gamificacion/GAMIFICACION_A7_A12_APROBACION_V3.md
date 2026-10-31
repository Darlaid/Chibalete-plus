# Contrato de XP A7/A12 — versión 3

**ESTADO:**
- **Modelo de parámetros: APROBADO POR DIRECCIÓN,** según instrucción comunicada a ingeniería. **Acta formal pendiente** (§3).
- **Activación de emisiones: NO AUTORIZADA.**

Sustituye a la [versión 2](GAMIFICACION_A7_A12_APROBACION_V2.md), cuyo análisis y casos límite siguen vigentes salvo lo que aquí cambia.

| Campo | Valor |
|---|---|
| Documento | `A7-A12-V3` |
| Base técnica | `75911b4` (GREEN_CI) |
| `approvalRef` | **Sin asignar:** lo emite Dirección |
| Firma y fecha del acta | **Sin registrar** |
| `ruleVersion` y entrada en vigor | **Sin asignar** |
| Owner y comité (D50) | **Sin designar** |

## 1. Parámetros aprobados para el piloto

| Parámetro | Valor |
|---|---|
| `XP_LECTURA` | 10 |
| `XP_REFLEXION` | 20 |
| `TECHO_XP_OBRA` | 50 por obra y ciclo |
| Ciclos | Único; sin relecturas remuneradas |
| `XP_RUTA` | 0 |
| PM | 0 |
| Techo semanal | Ninguno |
| Reconocimiento retroactivo | Ninguno |

**Efecto:** 30 XP por la primera evidencia aprobada de una obra, 20 por la segunda y 0 después.

**Forma técnica:**

```json
{
  "approvalRef": "<lo emite Dirección>",
  "amounts": { "xp": { "reading": 10, "reflection": 20, "validated": 0, "route": 0 },
               "pm": { "reviewed": 0, "validated": 0 } },
  "xpCeilingPerWorkCycle": 50,
  "reread": { "windowDays": 30, "xpFactors": [], "pmFactors": [] }
}
```

`windowDays` es obligatorio por validación y no tiene efecto con `xpFactors` vacío: no es una regla de relectura. `validated` y `route` son 0 por la misma razón. Las reglas de relectura `[0.5, 0.25]` de la versión 2 **no están aprobadas**.

## 2. Qué autoriza y qué no

| | Aprobación del modelo | Autorización de activación |
|---|---|---|
| Qué es | Los valores y reglas de §1 | Orden de empezar a emitir |
| Estado | Aprobado; falta acta | **No concedida** |
| Efecto en el sistema | **Ninguno.** Ningún código lee este documento | Retirar el bloqueo, crear la regla, encender el flag |
| Quién | Dirección | Dirección, en una orden separada y explícita |

Aprobar el modelo no levanta `XP_LOCKED_SOURCES`, no crea `ruleVersion` y no enciende `XP_EARNING_ENABLED`.

## 3. Procedimiento para registrar la aprobación

Cada aprobación real es un archivo versionado en `docs/gamificacion/aprobaciones/`, sin datos personales más allá del cargo:

1. Dirección emite su referencia. Ingeniería no la crea.
2. Se añade `APROBACION-<approvalRef>.md` con: referencia, cargo del firmante, fecha, alcance (modelo o activación), `A7-A12-V3` y SHA-256 del bloque JSON de §1.
3. Se revisa como cualquier cambio y se fusiona. Un cambio de valores exige versión nueva del contrato y nueva aprobación (D48).
4. Solo entonces esa referencia puede usarse como `approvalRef` en `rules.recognition`.

`gm_rule_sets` conserva `ruleVersion` y `rules_sha256`, de modo que regla y acta quedan enlazadas. **No hay entidades ni tablas nuevas.**

## 4. Condiciones para activar

**Dentro de gamificación, todas antes de retirar el bloqueo:**

1. Acta registrada según §3, con `approvalRef`.
2. Autorización de activación, separada.
3. Regla editorial de obra y selector en Studio para `PRODUCTION`.
4. Regla en `gm_rule_sets` con §1, sin pago por `mook_experience` ni `mook_review` en `rules.facts`.
5. `GAMIFICATION_MOOK_SINCE` fijado antes de publicar las versiones que declaren obra.
6. Clave de sujeto y registro de exclusiones operativos.
7. Criterio de Pedagogía para `minPalabras` y revisión disponible en las cohortes.
8. Alarma D41 definida, incluida la de aprobaciones anómalas.
9. Unidad específica que retire `mook_review` de `XP_LOCKED_SOURCES`, con CI verde.

`reading_completion` sigue bloqueada, y `XP_EARNING_ENABLED` se enciende por orden separada, al final.

**Fuera del alcance de gamificación:** la versión 2 listaba como condición técnica DPIA, aviso, supresión transversal (COMP-07/08) y retención. Se retiran de esta lista porque no los resuelve esta familia de unidades. **Esas obligaciones no desaparecen:** tratar datos de menores sigue sujeto a la normativa aplicable, y su cumplimiento corresponde al responsable del tratamiento con DPO y Legal. Este documento no valora si están cumplidas ni las sustituye.

## 5. Contradicciones resueltas

| Tema | Antes | Ahora |
|---|---|---|
| Estado | Pendiente | Modelo aprobado; activación no |
| Relectura | Factores previstos | Sin relecturas remuneradas en piloto |
| `reread` en piloto | Propuesta | `xpFactors: []` |
| PRIV-01 §6 | Condición técnica | Obligación externa, vigente |

Niveles y logros: sin cambios frente a la versión 2 §5. Ninguno se implementa.
