# GAMIFICACION-G4-05A-4: corrección del registro a cero y contrato de parámetros

**Fecha:** 2026-10-31 · **Base:** `03a283e` (CI 10/10) · **Producción:** sin cambios.
**Alcance:** evitar que un reconocimiento sin XP consuma claves. Sin migraciones, flags activos ni cifras. Sustituye el §1 y el §3 «Hecho sin emisión» de [G4-05A-3](GAMIFICACION_G4_05A_3_REGISTRO_POR_OBRA.md).

## 1. Causa

G4-05A-3 escribía un hecho `observed` y actos a cero al encender `XP_EARNING_ENABLED`. `gm_source_facts` y `gm_work_cycles` son append-only, y `UNIQUE(source, source_event_id, fact_type)` más `ux_gm_cycle_reading` hacen esas filas definitivas. La evidencia quedaba registrada y **nunca podía recibir XP**: no hay `UPDATE`, y compensar queda excluido.

No existen filas afectadas: el flag nunca estuvo encendido y el código no se desplegó.

## 2. Solución

**Regla:** en esta ruta, una fila significa emisión real. Sin XP que emitir no hay hecho, ni acto, ni sujeto, y la clave sigue libre.

| Condición | Resultado | Motivo |
|---|---|---|
| `XP_EARNING_ENABLED` apagado, también con PM encendido | Sin escritura | `disabled` |
| `mook_review` en `XP_LOCKED_SOURCES` | Sin escritura, **vigente en producción** | `source_locked` |
| Regla sin `recognition` válido y aprobado | Sin escritura | `recognition_not_configured` |
| Evidencia anterior a la regla | Sin escritura ni retroactividad | `predates_rules` |
| Techo agotado, XP total cero | Sin escritura | `no_xp_to_emit` |

**Doble cierre:** aunque alguien encienda el flag y cargue parámetros válidos, el bloqueo de código impide escribir. Hay una prueba con `server.js` real. Levantarlo exige un cambio de código revisado en la unidad de activación.

Con todo liberado, hecho `awarded`, asiento de XP y actos se escriben en la misma transacción. Las pruebas lo ejercitan con un arnés que libera `mook_review` **solo en su proceso**, con importes de prueba que solo existen en la suite.

**Sin cambios:** `0003`, claves, unicidades, PM bloqueado, `workAccess`, derechos, exclusiones y cortes.

## 3. Semántica de `observed`: decisión pendiente

Los documentos dan dos interpretaciones. **No cambié la semántica:** `recordFact` sigue igual, y la ruta nueva no escribe `observed`.

| | A: sin fila | B: fila definitiva |
|---|---|---|
| Fuente | PRIV-01A §3.2, PRIV-01C, comportamiento actual | ADR G2, Reconocimiento §6.3 |
| Significado | Sin emisión no hay dato personal | Registro de cada hecho y su decisión |
| Efecto | Se reevalúa en cada barrido | Consume la clave y nunca emite |
| Cumple minimización | Sí | Exige justificarla en la DPIA |

**Recomendación: A,** que es lo implementado. Reconocimiento §6.3 («el siguiente se registra como `observed`») debería enmendarse. **Pendiente de Dirección y DPO.** Una tercera lectura, «pendiente de pago», no es viable: exigiría actualizar filas append-only.

## 4. Contrato de parámetros (A7, A12)

**Estado:** A7 y A12 sin aprobar. Ninguna cifra existe en el código.

### Qué recibe XP

| Acto | Regla | Parámetro | Cuándo |
|---|---|---|---|
| `reading` | R-XP-1 | `amounts.xp.reading` (`XP_LECTURA`) | Primera evidencia aprobada de la obra en el ciclo |
| `reflection` | R-XP-2 | `amounts.xp.reflection` (`XP_REFLEXION`) | Cada evidencia aprobada, una vez por `evidenceId` |

Una evidencia de una obra nueva emite ambos. `XP_RUTA`, `XP_VALIDADA` y `XP_REFLEXION_C` quedan fuera de esta ruta.

### Parámetros que Dirección debe aprobar

| Parámetro | Doctrina | Decide | Validación |
|---|---|---|---|
| `amounts.xp.reading` | A12 | Finanzas + Producto | Entero > 0 |
| `amounts.xp.reflection` | A12 | Finanzas + Producto | Entero > 0 |
| `amounts.xp.validated`, `route` | A12 | Finanzas + Producto | Entero ≥ 0, obligatorios aunque aquí no se usen |
| `xpCeilingPerWorkCycle` (`TECHO_XP_OBRA`) | A4, A12 | Producto | Entero > 0 |
| `reread.windowDays` (`W_RELECTURA`) | A7 | Pedagogía | Entero ≥ 1 |
| `reread.xpFactors` (`ρ`) | A7 | Pedagogía | Decrecientes, cada uno en [0, 1) |
| `reread.pmFactors` | A7 | Pedagogía | Todos 0 en piloto |
| `amounts.pm.*` | A1, D13 | — | Deben ser 0: esta ruta no emite PM |
| `approvalRef` | D48, D50 | Dirección | Referencia del acta |

**Límites:**

| Ámbito | Estado |
|---|---|
| Obra y ciclo | `xpCeilingPerWorkCycle`, aplicado en la transacción |
| Por evidencia | Una sola, por clave |
| Por periodo | **Sin tope de XP:** `caps` solo cubre PM. A4 y P1 no lo exigen. Dirección debe confirmar si basta el techo por obra |

### Versión de reglas

Una regla nueva en `gm_rule_sets`, con su `ruleVersion`, en `rules.recognition`. Es append-only, solo rige hacia adelante (D48) y su contenido queda sellado por `rules_sha256`.

### Qué impide activar con valores incompletos

`validateApprovedRecognition` corre al crear la regla y otra vez al reconocer. Rechaza acta ausente, XP o techo en cero, PM distinto de cero y relectura incompleta. Ninguna cifra tiene valor por defecto.

### Propuesta para aprobación

1. Aprobar la estructura de A7: ciclo, ventana y factores decrecientes.
2. Encargar a Finanzas y Producto la simulación de A12: `XP_LECTURA`, `XP_REFLEXION`, `TECHO_XP_OBRA`.
3. Fijar `W_RELECTURA` y `ρ` con Pedagogía, y `ρ_PM = 0` en piloto.
4. Confirmar si el techo por obra y ciclo basta, sin tope por periodo.
5. Elegir interpretación de `observed` (§3).
6. Designar al firmante de `approvalRef` (D50).

**Una unidad posterior** retiraría `mook_review` de `XP_LOCKED_SOURCES`. Sigue pendiente la asimetría de XP (G4-03 §3).
