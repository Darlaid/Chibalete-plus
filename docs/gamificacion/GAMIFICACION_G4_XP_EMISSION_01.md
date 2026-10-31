# GAMIFICACION-G4-XP-EMISSION-01: preparación de la emisión de XP del piloto

**Fecha:** 2026-10-31 · **Base:** `fe7e0b9` · **Producción:** sin cambios.
**Alcance:** demostrar el modelo aprobado ([A7-A12-V3](GAMIFICACION_A7_A12_APROBACION_V3.md)) sobre el escritor real. **XP y PM sin activar;** `mook_review` sigue bloqueada.

## 1. Auditoría del escritor

`recordWorkRecognition` (G4-05A-4) ya cubría casi todo sin cambios:

| Requisito | Resultado con la regla aprobada | Mecanismo |
|---|---|---|
| Primera evidencia | 30 XP: lectura 10 + reflexión 20 | `decideRecognition` |
| Segunda evidencia | 20 XP, total 50 | Reflexión; una sola lectura por ciclo |
| Después del techo | 0 XP, sin hecho, acto ni clave | `no_xp_to_emit` |
| Evidencia sin XP | Sigue en MOOK, aprobada y visible | El ledger no toca `mook_db.json` |
| Doble emisión por gancho, reconciliación o reintento | Una sola | Clave única e `IMMEDIATE` |
| Ruta | No paga | Sin regla `mook_experience` |
| Derechos, `workAccess`, exclusiones y versiones | Se conservan | Sin cambios |

## 2. Única modificación

**Hueco:** `recordFact` y `recordWorkRecognition` comparten clave de hecho, y el barrido ejecuta primero `reconcile`. Al retirar el bloqueo, una regla con `facts['mook_review/evidence_reviewed']` pagaría por la vía antigua, sin techo por obra, y ocuparía la clave. Otra con `mook_experience` pagaría la ruta, contra `XP_RUTA = 0`.

**Cierre:** `createRuleSet` rechaza con `RECOGNITION_RULE_CONFLICT` una regla con `recognition` que pague por `mook_review` o `mook_experience` en `facts`. Las reglas sin `recognition` no cambian, y una entrada a cero se admite.

## 3. Bloqueo

La aprobación documental no puede activar nada: **ningún código lee el contrato ni el acta**, y `approvalRef` solo se comprueba como identificador. Un proceso sin arnés, con flags y regla aprobada, devuelve `source_locked` y no escribe.

## 4. Pruebas

`xpPilotEmission.test.mjs`, con arnés solo de prueba y `approvalRef` sintético. El valor real lo emite Dirección.

## 5. Pendiente para activar

Las condiciones de A7-A12-V3 §4. Ninguna es de esta unidad.

**Efecto conocido:** la tercera y siguientes evidencias aprobadas se reevalúan en cada barrido, porque no dejan fila. El coste es de una decisión pura por evidencia, sin escritura.
