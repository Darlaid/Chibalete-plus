# V8-UNIFIED-XP-01 — Una sola escala: XP

**Estado:** implementado en local, sin publicar ni desplegar. XP sigue apagado.
**Decisión de Dirección (definitiva):** solo existe una escala de puntos, el XP. Los Puntos de Magia (PM) se retiran.

## 1. Inventario

| Pieza | Dónde | Clase | Qué se hizo |
|---|---|---|---|
| Ledger XP, reglas 30/20/50, idempotencia, reconocimientos | `server/gamification/ledger.mjs`, `recognition.mjs`, `progress.mjs` | CONSERVAR | Sin cambios de comportamiento en XP |
| Semilla y Brote, logros del piloto | `progress.mjs` (`PILOT_LEVELS`, `PILOT_ACHIEVEMENTS`) | CONSERVAR | Sin umbrales nuevos |
| Flag `PM_EARNING_ENABLED` | `db.mjs` (`isEarningEnabled`) | RETIRAR | Sin efecto; el único flag de emisión es `XP_EARNING_ENABLED` |
| PM y topes en reglas (`pm`, `caps`), bloqueos de PM | `policy.mjs` | ADAPTAR | Regla nueva con `pm`/`caps` ⇒ `PM_RETIRED`; un conjunto histórico se lee y esos campos se ignoran |
| PM en reconocimiento (`amounts.pm`, `reread.pmFactors`, `flags.pmEarning`, elegibilidad PM) | `recognition.mjs` | ADAPTAR | Fuera de la decisión; configuración nueva con PM ⇒ `PM_RETIRED`; histórica a cero se tolera |
| Movimientos, saldos, ajustes, compensaciones, verificación y reconstrucción de saldos | `ledger.mjs` | RETIRAR | Funciones eliminadas; ninguna ruta de código escribe PM |
| Extinción de saldo al excluir | `erasure.mjs` | RETIRAR | El acuse ya no lleva `extinguished` |
| Tablas `gm_pm_*`, `gm_redemptions*`, `gm_reward_grants`, `gm_work_cycles.pm` | migraciones 0001–0003 | CONSERVAR (compatibilidad) | Sin migración destructiva; filas antiguas intactas; `gm_work_cycles.pm` se escribe siempre a 0 |
| Arnés de pruebas de PM | `__test__/helpers/pmMechanics*.mjs` | RETIRAR | Borrado |
| Trivia (`/trivia`), generador de preguntas | `pages/Trivia.tsx`, `geminiService.generarPreguntaTrivia` | RETIRAR | Página, ruta, permiso y tipo eliminados |
| Recompensas (`/admin/recompensas`) | `pages/AdminRecompensas.tsx`, Navbar | RETIRAR | Página, ruta, permiso y entradas de menú eliminadas |
| Métodos de puntos del cliente (inertes desde G0) | `dataService` (`addPuntos`, `canjearRecompensa`, `addPoints`, `redeemCoupon`, `getRewardRequests`, `processRewardRequest`) | RETIRAR | Eliminados |
| Tipos de puntos | `types/index.ts` (`User.puntos`, `rewardsHistory`, `Reward`, `TriviaQuestion`, `Product.precio_descuento_puntos`, `reward_request`) | RETIRAR | Eliminados |
| `Section.unlockCost` | `types`, `SubirContenido` | ADAPTAR | Opcional y sin uso; el formulario ya no pide «Costo (Puntos)»; los datos guardados no se tocan |
| Aviso de Puntos de Magia en Tienda | `pages/Tienda.tsx` | RETIRAR | El catálogo WooCommerce queda igual |
| Precio en puntos de productos | `pages/AdminProductos.tsx` | RETIRAR | Campo eliminado |
| Limpieza de `[AWARD_POINTS:n]` en Leo | `server/leoAwardTokens.js`, `utils/leoActionTokens.mjs` | CONSERVAR | Defensa: el modelo puede seguir emitiendo el token |
| `RewardEngine` (continuidad de lectura), `immersive_level` | motores del visor | CONSERVAR | No son gamificación (U0) |
| `nivel_lectura` del usuario | esquema de identidad | CONSERVAR | Fuera de alcance: es parte del padrón; no se muestra en la UI (U0) |

## 2. Contratos XP resultantes

- **Reglas nuevas** (`createRuleSet`): `{ schema: 1, facts: { "<fuente>/<tipo>": { xp, emitWhen? } }, recognition? }`. `recognition` = `{ approvalRef, amounts: { xp: { reading, reflection, validated, route } }, xpCeilingPerWorkCycle, reread: { windowDays, xpFactors } }`. Con `caps`, `pm`, `amounts.pm` o `reread.pmFactors` ⇒ `PM_RETIRED`.
- **Reglas históricas** ya guardadas con PM: se leen igual; solo emiten XP; nunca `capped`.
- **`recordFact`** ⇒ `{ inserted, persisted, factId, decision, xp, xpEntryId }`. Con `XP_EARNING_ENABLED` apagado: `disabled_source`, sin fila.
- **`decideRecognition`** ⇒ resultado y entradas sin `pm`; `flags = { xpEarning }`.
- **`excludeUser`** ⇒ `{ erasureId, day, inserted, unlinked, checkpointed }`.
- Para activar: el bloque A7-A12-V3 §1 se usa en su forma solo XP (mismos 10/20/50, sin `amounts.pm` ni `reread.pmFactors`) y sin `caps`. Ver `GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md` (H1 cerrado).

## 3. Progreso individual para el mediador

`GET /api/groups/:groupId/students/:studentId/progress` — solo lectura.

| Puerta | Resultado |
|---|---|
| Sin sesión | 401 |
| `GAMIFICATION_ENABLED` o `XP_EARNING_ENABLED` apagados | 404, antes de autorizar y sin abrir la base |
| El llamador no MEDIA el grupo según el CIS (`via: mediator_of_group`): mediador ajeno, otra institución, lector, administrador de plataforma, secreto de máquina | 403 (503 si la identidad no está disponible) |
| La persona no está en la cohorte lectora del grupo (la misma de los agregados), no existe, o es el propio mediador | 404 idéntico byte a byte: no permite sondear |
| Fallo de lectura, registro de exclusiones dañado o sin escritor vivo | 503 genérico, nunca 0 XP |

Respuesta: `{ xp, level: { id }, recognizedWorks, achievements: [ids] }`. Sin nombre, ids, claves, historial, obras, exclusiones, rankings ni comparaciones. Una persona excluida es idéntica a una sin actividad. El limitador general de `/api/` (por cuenta) acota el volumen.

UI: `StudentProgressBlock` en Aula Viva, junto al panel del estudiante, solo cuando el resumen del grupo trae `recognition` (XP encendido). Sin panel ni ruta nuevos. Los agregados de grupo no cambian.

## 4. Pruebas

- Nuevas: `server/gamification/__test__/studentProgressHttp.test.mjs` (HTTP real, 3 réplicas con distintas flags) y `pages/__tests__/StudentProgressMediator.test.mjs`.
- `ledgerCore` §[6] y §[8b]: PM inexistente como moneda activa y compatibilidad con reglas históricas con PM.
- Las suites de concurrencia, respaldo, exclusión, MOOK y reconciliadores pasan a comprobar XP (un asiento por hecho) y cero filas de PM.

## 5. Riesgos residuales

- El acta O1 debe fijar el bloque de reglas en su forma solo XP; el bloque de A7-A12-V3 tal cual se rechaza (`PM_RETIRED`).
- Las tablas de PM siguen en el esquema; no hay un trigger que impida escribirlas por SQL directo (no se añadió migración para no tocar el respaldo).
- `unlockCost` y `nivel_lectura` permanecen en datos guardados; ninguno se muestra como puntos.
