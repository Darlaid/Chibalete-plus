# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / OPERACIÓN-01 · Ruta crítica multieditorial

**Fecha:** 2026-10-27 · **Baseline:** `7cd6255` (= remoto) · **Autoridad:** `PLAN_GENERAL_V1_1.md` (congelado), `DECISIONES_F0C.md`, adenda `PLAN_INTEGRADO_V1_4.md`
**Tipo:** auditoría breve y plan. Sin implementación, sin tocar producción, ingesta apagada. Esta ruta **no cambia** fórmulas, gates ni unidades del Plan V1.1: solo las descompone en piezas ejecutables.

**En paralelo:** F3-A3 / ACCESS-04 (VoiceOver y TalkBack) quedó en pausa antes de M-1. El laboratorio `chp-a11ylab-a9ab21a` sigue en marcha.

## A. Capacidades existentes reutilizables

| Capacidad | Estado | Dónde | Nota |
|---|---|---|---|
| Editoriales (titulares), sellos, editorial responsable por obra, historial de reasignaciones | **LISTA** (producción) | `publishersStore.mjs`, `publisherAssignment.mjs`, `/admin/editoriales`, migraciones 0001 y 0003 | `kind: editorial \| tercero` ya admite beneficiarios no editoriales |
| Derechos versionados (Acta, vigencia, alfa, minutos esperados, matriz de participaciones en pb, 7 permisos, estados legal, económico y de liquidación) | **LISTA** en datos y API (producción) | `rightsStore.mjs`, migración 0002 (append-only), `GET/POST /api/admin/rights/:contentId[/versions]`, `…/eligibility` | 0 versiones registradas en producción |
| Predicado de elegibilidad económica con motivos | **LISTA** | `economicEligibility`, `eligibilityFor` | Evalúa en una fecha dada |
| Cumplimiento de permisos (P15) | **PARCIAL** | `createRightsGate`, `RIGHTS_ENFORCEMENT_MODE` (`off` en producción) | `enforce` bloqueado por los 5 riesgos de `F2A_PROD_EVIDENCE.md` §6 |
| Interfaz de administración de derechos | **FALTANTE** | — | Hoy solo por API (riesgo 5 de F2-A) |
| Clase comercial por regla y atribución en el primer tick | **LISTA** (producción) | `commercialClass.mjs`, `resolveCommercialAttribution` | Las 22 reglas siguen `unclassified` (P9) ⇒ 0 elegibles |
| Ingesta `econ_tick` y lectura de filas | **LISTA** (producción, flag OFF) | `econEvents.mjs` (`recordEconTicks`, `readEconRows`, `excludedUsersFromRows`, `internalUserIdsFromEnv`) | `econ_events` vacía en producción |
| Instrumentación de los 6 modos | **LISTA** (producción, inerte) | `useEconomicTick`, `utils/economicTick.mjs` | Gate de F3-A3 pendiente: VO/TB en dispositivo y 1 episodio productivo |
| Motor de episodios, Q y R por obra | **LISTA** (puro, 95 fixtures) | `computeEconomicEpisodes` | **No calcula S** (la fórmula solo está declarada en el `rule_set`). Recibe un solo conjunto de obras elegibles para todo el periodo |
| `rule_set` `rs-2026-01-v1` | **PARCIAL** | Constante `RULE_SET_RS_2026_01_V1` en código | No existe la tabla `rule_sets` |
| Vista previa del periodo (F3-B) | **FALTANTE** | — | Ningún endpoint une filas, elegibilidad, exclusiones y motor |
| Liquidación (F4-A): INS, BRD/BGP/BLC, presencia, alfa, matriz, resto mayor | **FALTANTE** | — | — |
| `period_inputs`, `closes`, `adjustments`, `rule_sets` (F4-B) | **FALTANTE** | — | Tablas ya previstas en Plan §3.1 dentro de `royalties.db`: no crean almacén nuevo |
| Panel «Regalías» e informes (F5-A, F5-B, REPORTES-01) | **FALTANTE** | — | Formato condicionado por V14-1 |
| Respaldo y restauración de `royalties.db` | **LISTA** | `stores.py` (CANON), RY01–RY04 | Cada migración nueva reverifica G9 |
| Laboratorio aislado con cuentas, obras y eventos sintéticos | **LISTA** | `scripts/royalties/a11yLab.mjs` (siembra, arranque, `report` con el motor) | Base para la validación integral sintética |

## B. Faltantes reales

1. **Interfaz de derechos:** registrar y consultar Actas por obra sin `curl`. Es imprescindible para recibir editoriales externas.
2. **Vista previa F3-B:** endpoint de solo lectura (mes → episodios, Q, R y **S** por obra, motivos de exclusión y anomalías), con la elegibilidad evaluada en el día del episodio.
3. **Liquidación F4-A:** función pura sobre la vista previa más INS.
4. **Cierre F4-B:** migración 0004 (`rule_sets`, `period_inputs`, `closes`, `adjustments`, append-only con triggers y `UNIQUE(periodo)`), hash del snapshot y trimestre = suma de tres cierres.
5. **Panel e informes F5:** vista previa, carga de INS, cierre, movimientos y estado por titular exportable.
6. **Validación integral sintética:** circuito completo con editorial y obras sintéticas en el laboratorio.

No faltan motores, servicios ni almacenes nuevos. Todo cabe en `royalties.db`, `events.db` y el motor existente.

## C. Ruta crítica mínima

| Transición | Reutilizable | Brecha | Prueba indispensable | Dependencia bloqueante |
|---|---|---|---|---|
| Editorial | `publishers` + `/admin/editoriales` | — | — (F1-B GREEN_PRODUCTIVO) | — |
| Editorial → obra | `publisherId` obligatorio, historial 0003 | — | — | — |
| Obra → derechos | `rights_versions` + API + elegibilidad | **UI** (U1) | Alta de una Acta real-sintética con matriz 100 % y lectura de veredicto | Datos del Acta de cada editorial (minutos esperados = P1) |
| Derechos → lectura (acceso) | Reglas de acceso + `commercialClass` | Clasificar reglas pagadas (negocio) | Ya cubierta en F2-B | **P9** para resultados distintos de 0 |
| Lectura → evento | Hook + ingesta | — (flag OFF) | VO/TB (ACCESS-04) | Gate de F3-A3 para activar la ingesta en producción |
| Evento → episodio | `computeEconomicEpisodes` | Integración en el servidor (U2) | Mismo periodo ⇒ mismo resultado; gratuitas, QA, legacy y `unclassified` = 0 | Elegibilidad por día (versiones que cambian dentro del mes) |
| Episodio → atribución (obra → titular) | `shares`, alfa y `publisherAt` | Cálculo (U3) | Q = 0, INS = 0, obra suspendida, disputa, gratuito, matriz de terceros; suma = bolsa al peso | INS (P11) solo para cierres reales |
| Atribución → cierre mensual | — | Migración 0004 + cierre (U4) | `UPDATE`/`DELETE` fallan; recálculo = mismo hash; respaldo y restauración RY | G9 |
| Cierre → acumulado trimestral | — | Suma de cierres (U4) | Trimestre = Σ 3 cierres; movimiento posterior no altera cierres | — |
| Acumulado → informe descargable | — | Panel y exportación (U5) | 0 datos de lectores; inyección de fórmulas; el estado concilia con el cierre | **V14-1** (formato) |

## D. Unidades de implementación y gates

| Unidad | Alcance (solo lo faltante) | Plan V1.1 | Depende de | Gate para desplegar |
|---|---|---|---|---|
| **U1 · DERECHOS-UI-01** | Sección «Derechos» por obra en el Panel Admin sobre los endpoints existentes: historial de versiones, alta de versión nueva (permisos, vigencia, alfa, minutos, matriz) y veredicto de elegibilidad con motivos. Sin cambios en el servidor | F5-A (parte «Obras y Derechos»), adelantada | — | Código con ingesta OFF: CI, PRE y autorización. No cambia accesos (enforcement `off`) |
| **U2 · F3-B-01 Vista previa** | `GET /api/admin/royalties/preview?month=` (solo administración, `no-store`): `readEconRows` del mes + margen de fusión, elegibilidad por día con `rights_versions`, `expectedMinutes` de la versión vigente, exclusiones (internos por entorno + cohorte sintética), motor y **S** según `scoreFormula`. Nada persistido | F3-B | Puede empezar ya con fixtures; datos reales tras el gate F3-A3 | Código con ingesta OFF (devuelve vacío). Prueba de reproducibilidad y G5 |
| **U3 · F4-A-01 Liquidación pura** | `computeSettlement(preview, { ins, ruleSet, rightsAt, publishers, days })`: BRD 25 %, BGP 30 % por presencia (titular cuenta una vez), BLC 70 % por S, traslado BLC→BGP si Σ S = 0, alfa, matriz, retenidos, COP enteros por resto mayor | F4-A | Forma de salida de U2 (contrato acordado al iniciar) | No se despliega sola: va con U4 |
| **U4 · F4-B-01 Cierre y trimestre** | Migración 0004 con las 4 tablas del Plan §3.1, carga de INS con soporte, cierre con snapshot + hash + versión de `rule_set`, movimientos (ajuste, pago registrado, retención, liberación, traslado) y vista trimestral | F4-B | U3 | **Migración:** respaldo PRE, restauración aislada RY con la 0004, CI, autorización |
| **U5 · F5 / REPORTES-01** | Panel «Regalías»: vista previa (marcada PROVISIONAL), INS, cierre, movimientos, estado por titular. Exportación desde el snapshot (nunca recalcula) | F5-A, F5-B, REPORTES-01 | U2 (vista previa), U4 (cierres); decisión V14-1 | Despliegue conjunto F4/F5 (Plan §7.1) con CI, PRE y autorización |
| **U6 · F6-A-SINT** | En el laboratorio: 2 editoriales sintéticas (una con matriz de tercero), 4 obras, Actas, reglas `paid_*` sintéticas, lecturas reales en Chrome, INS ficticio ⇒ cierre ⇒ trimestre ⇒ estado conciliado al peso | F6-A (parte sintética) | U5 | Solo laboratorio. Los resultados se marcan **SINTÉTICO, NO EXIGIBLE** |
| Pendiente existente · **F3-A3 / ACCESS-04** | 8 comprobaciones VO/TB | F3-A3 | — | Ya definido |
| Pendiente existente · **DERECHOS-ENFORCE** | Cerrar los riesgos 1–4 de `F2A_PROD_EVIDENCE.md` §6 y pasar a `shadow` → `enforce` | F2-A (G2) | U1 (para tener Actas) | Auditoría de impacto + autorización explícita (P15) |

**Escalera de gates (no se salta un peldaño):**

1. **Desarrollo y pruebas aisladas:** U1, U2, U3 y U4 (con base temporal), U6 en el laboratorio y ACCESS-04. Pueden empezar ya.
2. **Despliegue de código con ingesta OFF:** cada unidad por separado; F4/F5 juntas. CI verde, respaldo PRE y POST restaurados y autorización. La 0004 exige además RY verde.
3. **Prueba de ingesta productiva:** autorización específica para encender `ECONOMIC_INGEST_MODE` en ventana acotada, con cuentas QA en `internalUserIds`, cohorte controlada y resultados excluidos de cualquier liquidación oficial. Requiere el gate de F3-A3. Es el «1 episodio en producción» y F6-A.
4. **Operación económica oficial:** derechos válidos por obra (Actas registradas, P1), reglas pagadas clasificadas (P9), INS documentado (P11), cuentas internas (P7), P4 resuelto, enforcement de derechos activo (G2), conciliación (G6), medición validada (F3-A3 + S-1…S-5 decididos), **dos periodos sombra** (F6-B, G10) y aprobación administrativa, técnica y jurídica.

## E. Desarrollo simultáneo sin riesgo

- **Paralelo inmediato:** U1 (solo front) ∥ U2 (servidor, solo lectura) ∥ U3 (función pura) ∥ ACCESS-04 (dispositivos). No comparten archivos salvo `server/server.js` (U2 añade una ruta).
- **Después:** U4 tras U3. U5 puede empezar sus pantallas de vista previa en cuanto exista U2 y completar el cierre tras U4.
- **No paralelizar:** dos unidades que migren `royalties.db`, ni despliegues acumulados.
- **Decisiones de Dirección en paralelo** (no bloquean el desarrollo): V14-1, P9, P11, P1 (minutos por obra en cada Acta), P7 y P4.

## F. Lo que bloquea únicamente la operación económica oficial

P9 (hoy 0 reglas pagadas ⇒ Q = 0 en todo), P11 (INS), P1 (minutos esperados por obra), P7 (cuentas internas), P4 (jurídico), `RIGHTS_ENFORCEMENT_MODE=enforce` con los riesgos de F2-A cerrados, gate de F3-A3 en producción, decisión sobre S-1…S-5 (F6-B), dos periodos sombra y aprobación expresa. Nada de esto impide desarrollar, probar ni desplegar el código con la ingesta apagada. **Los resultados sintéticos o sombra nunca se convierten en regalías exigibles.**

## G. Primera unidad de código recomendada

**U1 · DERECHOS-UI-01.** Es la que desbloquea antes la incorporación de editoriales externas: sus Actas se pueden registrar hoy solo por API. Es frontend puro sobre endpoints ya en producción, sin migraciones ni cambios de acceso (enforcement `off`). Valida en la práctica el modelo de derechos que consumirán U2 y U3.

**En paralelo:** **U2 · F3-B-01** con fixtures. Es el siguiente eslabón del camino crítico y no depende del gate de F3-A3 para desarrollarse.

## H. Seguimiento

Se añade la fila «O1» a `SEGUIMIENTO_PLAN_V1_1.md`. Sin cambios de código, de producción ni de datos.
