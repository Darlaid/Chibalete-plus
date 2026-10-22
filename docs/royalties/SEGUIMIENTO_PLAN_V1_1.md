# CHP-EDITORIAL-ROYALTIES-2026-01 — Seguimiento del Plan General V1.1

El plan (`PLAN_GENERAL_V1_1.md`) está congelado; este documento solo registra el avance de sus 14 unidades.

| # | Unidad | Estado | Evidencia |
|---|---|---|---|
| 1 | F0-C | Cerrada | `64ec3f1` |
| 2 | F3-A1 | Cerrada (no se despliega) | `96526d5`, `4c3ad2b` |
| 3 | F1-A | **En producción** (2026-10-22), G1/G9 | `F1A_PROD_EVIDENCE.md` (`0e97b32`) |
| 4 | F2-A | **En producción con cumplimiento `off`** (2026-10-22), G2 parcial: registro y elegibilidad operativos; la activación de `enforce` queda bloqueada por los riesgos de `F2A_PROD_EVIDENCE.md` §6 | `F2A_IMPACT_AUDIT.md`, `F2A_PROD_EVIDENCE.md` |
| 5 | F2-B | **En producción** (2026-10-22, `ffc563b`): clasificación comercial operativa; las 22 reglas siguen `unclassified` (0 elegibles) a la espera de aprobación individual (P9); defecto `b2c` de `POST /api/access` corregido | `F2B_COMMERCIAL_MATRIX.md`, `F2B_PROD_EVIDENCE.md` |
| 6 | F3-A2 | **GREEN local, sin desplegar** (2026-10-22): ingesta de `econ_tick` y atribución F2-B en el primer tick, tabla `econ_events` (append-only) en `events.db`, flag `ECONOMIC_INGEST_MODE` apagado | `F3A2_ECON_INGEST.md` |
| 7–14 | F3-A3 … F6-B | Pendientes | — |

**Decisiones de negocio abiertas (no bloquearon F2-B):** P1, P4, P7, P9 (clasificación regla por regla), P11 (`DECISIONES_F0C.md` §4).

**Incidencias abiertas ajenas al plan:** TTS bajo demanda sin cuota de proveedores (`F2A_PROD_EVIDENCE.md` §5.1); jobs de `security` en rojo; intermitencia de `content-rmw`; `/#/admin/metricas` 401 (legacy).
