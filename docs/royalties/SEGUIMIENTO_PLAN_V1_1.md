# CHP-EDITORIAL-ROYALTIES-2026-01 — Seguimiento del Plan General V1.1

El plan (`PLAN_GENERAL_V1_1.md`) está congelado; este documento solo registra el avance de sus 14 unidades.

| # | Unidad | Estado | Evidencia |
|---|---|---|---|
| 1 | F0-C | Cerrada | `64ec3f1` |
| 2 | F3-A1 | Cerrada (no se despliega) | `96526d5`, `4c3ad2b` |
| 3 | F1-A | **En producción** (2026-10-22), G1/G9 | `F1A_PROD_EVIDENCE.md` (`0e97b32`) |
| 4 | F2-A | **En producción con cumplimiento `off`** (2026-10-22), G2 parcial: registro y elegibilidad operativos; la activación de `enforce` queda bloqueada por los riesgos de `F2A_PROD_EVIDENCE.md` §6 | `F2A_IMPACT_AUDIT.md`, `F2A_PROD_EVIDENCE.md` |
| 5 | F2-B | **GREEN local, sin desplegar** (2026-10-22): clasificación implementada; las 22 reglas siguen `unclassified` a la espera de aprobación individual (P9) | `F2B_COMMERCIAL_MATRIX.md` |
| 6–14 | F3-A2 … F6-B | Pendientes | — |

**Decisiones de negocio abiertas que siguen sin bloquear F2-B:** P1, P4, P7, P9 (clasificación regla por regla), P11 (`DECISIONES_F0C.md` §4).

**Incidencias abiertas ajenas al plan:** TTS bajo demanda sin cuota de proveedores (`F2A_PROD_EVIDENCE.md` §5.1); jobs de `security` en rojo; intermitencia de `content-rmw`; `/#/admin/metricas` 401 (legacy).
