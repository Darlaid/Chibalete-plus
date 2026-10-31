# Aprobación de parámetros A7 y A12 — versión 1

**SUSTITUIDA por la [versión 2](GAMIFICACION_A7_A12_APROBACION_V2.md).**

**ESTADO: PENDIENTE DE DIRECCIÓN.** Sin aprobar. No constituye configuración productiva.

| Campo | Valor |
|---|---|
| Documento | `A7-A12-V1` |
| Fecha de la propuesta | 2026-10-31 |
| Base técnica | `75911b4` |
| `approvalRef` | **Sin asignar.** Lo emite Dirección al firmar |
| `ruleVersion` | **Sin asignar** |
| Firmante (D50) | **Sin designar** |
| Vigencia | Prospectiva (D48); fecha sin definir |

Análisis: [XP-RULES-01](GAMIFICACION_XP_RULES_01_PROPUESTA.md).

## Decisiones

Las cifras son la recomendación de simulación. Dirección puede sustituirlas.

| # | Decisión | Propuesta | Responsable | Decisión |
|---|---|---|---|---|
| 1 | Escala | Equilibrado | Finanzas + Producto | ☐ Pendiente |
| 2 | `XP_LECTURA` (`amounts.xp.reading`) | 10 | Finanzas + Producto | ☐ Pendiente |
| 3 | `XP_REFLEXION` (`amounts.xp.reflection`) | 20 | Finanzas + Producto | ☐ Pendiente |
| 4 | `TECHO_XP_OBRA` (`xpCeilingPerWorkCycle`) | 50 | Producto | ☐ Pendiente |
| 5 | `amounts.xp.validated` | 0 hasta G7 | Pedagogía | ☐ Pendiente |
| 6 | `amounts.xp.route` | 0; no gobierna ninguna emisión | Producto | ☐ Pendiente |
| 7 | `XP_RUTA` en `rules.facts` | Sin regla en piloto (A5) | Pedagogía + Finanzas | ☐ Pendiente |
| 8 | Estructura A7 | Ciclo, ventana y factores decrecientes | Pedagogía | ☐ Pendiente |
| 9 | `W_RELECTURA` | 30 días | Pedagogía | ☐ Pendiente |
| 10 | `xpFactors` | `[0.5, 0.25]` | Pedagogía | ☐ Pendiente |
| 11 | `pmFactors` y `amounts.pm.*` | 0 | Pedagogía + Finanzas | ☐ Pendiente |
| 12 | Tope semanal de XP | No bloquear el piloto; si se quiere, 4 × techo con un cambio de código | Producto | ☐ Pendiente |
| 13 | `UMBRAL_EQUIDAD` | Definir antes de conectar lectura | Producto + Accesibilidad | ☐ Pendiente |
| 14 | Umbrales de nivel `T_n` | Definir después de la escala | Pedagogía | ☐ Pendiente |

## Condiciones que esta aprobación no levanta

Aprobar este documento **no activa nada**. Antes de emitir hacen falta, además:

1. Una unidad que retire `mook_review` de `XP_LOCKED_SOURCES`, con autorización expresa.
2. Una regla en `gm_rule_sets` con `rules.recognition`, que supere `validateApprovedRecognition`.
3. `XP_EARNING_ENABLED`, por orden separada.
4. Selector de obra en Studio y regla editorial de qué es obra.
5. Las condiciones GATED de PRIV-01 Implementación §6.

## Efecto conocido

- A7 no tiene efecto en MOOK hasta conectar lectura validada.
- El techo no decrece por ciclo.
- Sin VU-2, conectar lectura abre una brecha por modalidad.

## Firma

| Rol | Nombre | Fecha | Referencia |
|---|---|---|---|
| Owner ejecutivo (D50) | *Pendiente* | *Pendiente* | *Pendiente* |
| Finanzas | *Pendiente* | *Pendiente* | *Pendiente* |
| Pedagogía | *Pendiente* | *Pendiente* | *Pendiente* |
| Producto | *Pendiente* | *Pendiente* | *Pendiente* |
