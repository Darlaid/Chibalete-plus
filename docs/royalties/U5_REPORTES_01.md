# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / U5 · REPORTES-01 · Panel Admin: informes de regalías

**Estado:** GREEN_LOCAL+CI (`e1f8780`, CI 10/10) · **Fecha:** 2026-10-27 · **Baseline:** `1b07303`
Desarrollo local, CI y laboratorio aislado. Sin despliegue, ingesta, enforcement, cambios de fórmulas o de D1–D5, ni registros productivos.

## A. Baseline y CI

- HEAD = remoto = `1b07303`, árbol limpio.
- **Run `40576610544` (U4, `d471df9`):** intento 1 en *failure* e **intento 2 en *success*** (`identity-preflight`). U4 pasa a GREEN_LOCAL+CI y la falla queda confirmada como intermitente (ver `U4_F4B_01.md` §F).
- Contratos reales reutilizados:
  - U2 `computePeriodPreview`;
  - U3 `computeSettlement`;
  - U4 `closeMonth` (con `simulate`), `getClose`, `closeLedger`, `listMovements`, `quarterSummary` y `recordPeriodInput`.
- Componentes reutilizados del Panel Admin: el patrón de pestañas, tarjetas y tablas de `pages/AdminDashboard.tsx`, y el patrón de llamadas con `credentials: 'include'` y `no-store` de `services/dataService.ts`.

## B. Endpoints

Todos exigen `requireAdminAccess`; los GET además `requireAdminRead`. Todos responden con `Cache-Control: no-store`.

| Método y ruta | Uso | Fuente |
|---|---|---|
| `GET /api/admin/royalties/preview?month=` | Vista previa U2. **Reutilizado**: ahora comparte con los nuevos endpoints la función `royaltiesPreviewInputs`, sin cambio de comportamiento (22/0) | Servidor |
| `GET /api/admin/royalties/report?month=\|quarter=[&editorial&titular&obra][&format=json\|csv\|html][&expectReference=]` | Informe mensual o trimestral, filtros y exportaciones | Mes con cierre ⇒ snapshot + saldos U4. Sin cierre y con INS ⇒ **simulación U4 sin guardar** (U2 → U3). Sin INS ⇒ solo Q/R/S de U2. Trimestre ⇒ `quarterSummary` sobre cierres congelados |
| `GET /api/admin/royalties/closes` | Lista de cierres (sin snapshot) | U4 `listCloses` (nueva, solo lectura) |
| `GET / POST /api/admin/royalties/period-inputs` | INS con soporte | U4 `recordPeriodInput`; 409 si el periodo ya está cerrado |
| `POST /api/admin/royalties/closes` | **Solo cierre técnico**: exige `confirmMonth` = `month`. Cualquier otro modo ⇒ 400 `official_not_enabled` | U4 `closeMonth`; las entradas U2 las reúne el servidor |

**Regla crítica cumplida:** el navegador solo envía periodo, filtros, el INS (recaudo, deducciones, soporte) y la confirmación. Q, R, S, participaciones e importes salen siempre del servidor. `expectReference` hace que una exportación devuelva 409 `result_changed` si el resultado ya no es el que se vio en pantalla.

## C. Interfaz «Informes»

Es una pestaña nueva en `pages/AdminDashboard.tsx`, junto a Impacto & Inteligencia, Gestión de Ventas y Estado de Grupos. El componente es `components/admin/InformesRegalias.tsx` y se carga de forma diferida en su propio chunk.

- **Controles:** mensual o trimestral; selector de mes, o de año y trimestre; filtros por editorial, titular y obra (las opciones salen del informe sin filtrar).
- **Cabecera:**
  - estado: PROVISIONAL, PROVISIONAL (sin INS), TÉCNICO, OFICIAL, PROVISIONAL (incompleto / cierres técnicos) o DEFINITIVO;
  - origen (vista previa, simulación, cierre congelado, suma de cierres) y conciliación;
  - cartel **«PROVISIONAL — NO EXIGIBLE»** cuando corresponde;
  - referencia sha256, rule set, corte, fecha del cierre, **D1 con su id provisional**, fórmula S y meses faltantes.
- **Tarjetas:**
  - INS con su soporte, bolsa de derechos 25 %, presencia 30 % y lectura cualificada 70 %;
  - cobrable, retenido, pagado registrado y pendiente no cobrable, con el desglose D1, D4 y D5.
- **Tablas:**
  - obras: Q, R, S, MontoObra, retenido y pendiente;
  - titulares y editoriales: base, variable, liquidado, ajustes y recibidos, pagado, retenido y saldo cobrable;
  - movimientos.
- **Operaciones** (solo mes sin cierre):
  - registrar el INS;
  - **cierre técnico**: hay que escribir el periodo para confirmar, y el texto avisa de que no autoriza pagos.
- **No incluye** cierres oficiales, pagos, asignación de pendientes ni movimientos.
- **Accesibilidad:** errores con `role="alert"` y foco; avisos con `aria-live`; controles etiquetados; grupo de botones con `aria-pressed`.

## D. Consultas mensuales y trimestrales

- **Mes:**
  - con cierre: snapshot congelado + saldos;
  - sin cierre: simulación con el último INS registrado, cuyo sha256 es **el mismo** que tendrá el cierre técnico si nada cambia;
  - sin INS: Q/R/S de U2 sin importes.
- **Trimestre:** acumulado desde los cierres congelados, con meses faltantes y estado. Solo es DEFINITIVO con 3 cierres oficiales. Incluye movimientos, saldos y los sha256 de cada cierre.
- **Estados por editorial, titular y obra:** son los filtros del informe. Los totales del periodo no cambian; se añaden subtotales de lo visible (`visibleTotals`).

## E. Exportaciones y conciliación (V14-1)

Ambas exportaciones parten del **mismo objeto** que la pantalla y se piden con `expectReference`. Ninguna recalcula cifras.

- **CSV endurecido:**
  - formato: UTF-8 con BOM, separador `;`, CRLF y decimales con coma (Excel es-CO);
  - las celdas de texto que empiezan por `= + - @`, tabulador o retorno de carro se neutralizan con `'`;
  - los importes son números enteros;
  - se descarga como adjunto.
- **HTML imprimible** (guardar como PDF desde el navegador):
  - sin scripts y todo escapado;
  - servido con `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'` y `nosniff`;
  - cartel NO EXIGIBLE o de cierre oficial.
- **Contenido:**
  - periodo, estado, referencia, rule set, corte y fórmula S y de bolsas;
  - INS y soporte, bolsas, D1 y pendientes D1/D4/D5;
  - obras, partes por versión con matriz, titulares, ajustes, saldos y movimientos;
  - filtros aplicados.
- Sin librerías nuevas y sin datos de lectores.

## F. Pruebas

**Automáticas:**
- `royaltyReportsHttp.test.mjs` **56/0**: `server.js` real sobre stores temporales, con títulos hostiles (fórmula y `<script>`). Cubre:
  - acceso y entradas inválidas;
  - mes sin INS y mes sin lecturas;
  - INS con soporte;
  - simulación reproducible, conciliada, con D1 provisional en 2 partes, disputa retenida, D4 pendiente y autora compartida entre dos editoriales;
  - CSV (BOM, referencia, inyección neutralizada, cada saldo igual a la pantalla) y HTML (CSP, escapado, NO EXIGIBLE);
  - 409 si la referencia cambió; filtros por editorial, titular y obra;
  - INS cero;
  - cierre técnico solo con confirmación (oficial 400, duplicado 409, mismo hash que la simulación);
  - un cambio posterior de derechos no altera el informe del cierre;
  - trimestre incompleto y completo (BRD 75.000 + 500.000 + 0);
  - sin datos de lectores y consultas sin escrituras.
- `test:royalties` completo rc = 0 (incluidos `closes` 70, `settlement` 87, `periodPreview` 61, `royaltiesPreviewHttp` 22 y `rightsForm` 50).
- `typecheck:baseline` sin regresiones; `build` en verde (chunk `InformesRegalias`).

**Navegador real (Chrome), laboratorio aislado `chp-u1lab`:**
- **Entorno:** sesiones `enforce`, ingesta `off`, solo `localhost:5174`, sin `.env`, `data/` ni `data-critical/`.
- **Semilla sintética U5:** una editorial «Segunda (LAB)»; 4 obras `lab-u5-*` con títulos hostiles; 6 versiones (alfa y matriz que cambian el 16/08; disputa desde el 10/09); 442 filas `econ_events` con prefijo `u5lab-`. Se suman a la autora y la editorial externa de U1.

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Pestaña «Informes» junto a las otras tres | ✓ |
| 2 | Octubre sin INS: PROVISIONAL (sin INS), NO EXIGIBLE, solo Q/R/S (`lab-corto` Q 1, R 0,500, S 0,700 = U2) | ✓ |
| 3 | INS de julio por el formulario (1.250.000 − 50.000): BRD 300.000 / BGP 90.000 / BLC 210.000; cobrable 227.449 + pendiente D4 72.551 = BRD; D1 provisional visible | ✓ |
| 4 | **Conciliación API = pantalla = CSV = HTML** (misma referencia): total y saldo de cada uno de los 4 titulares; CSV con BOM y `'=SUM(1+1)…` neutralizado; HTML con `&lt;b&gt;` | ✓ |
| 5 | Cierre técnico de julio **desde la interfaz** escribiendo «2026-07»: sha256 = el de la simulación; el informe pasa a TÉCNICO | ✓ |
| 6 | Q3 con solo julio: PROVISIONAL (incompleto), faltan 08 y 09 | ✓ |
| 7 | Agosto con INS 0: bolsas 0, conciliado. Septiembre: `lab-u5-tres` (1 lectura antes de la disputa y 1 después) con D1 por Q ⇒ 46.130 retenidos | ✓ |
| 8 | Oficial ⇒ 400 `official_not_enabled`; sin confirmación ⇒ 400; cierre repetido ⇒ 409; el cierre de julio no cambia | ✓ |
| 9 | Q3 completo: PROVISIONAL (cierres técnicos), NO EXIGIBLE; BRD 525.000 = cobrable 372.908 + retenido 46.130 + pendiente 105.962 | ✓ |
| 10 | Versión imprimible del trimestre en una pestaña nueva, con cartel, referencia y cifras | ✓ |
| 11 | Sesiones reales de mediación y lectura: **403** en informe, CSV, trimestre, lista de cierres y en ambos POST; anónimo **401** | ✓ |

- **Hallazgo corregido durante la unidad:** el bloque de servicio de U5 quedaba dentro del rango que la prueba estructural de U1 reserva a `/admin/rights` (dos POST). Se movió fuera; la prueba no se tocó.
- **Nota:** las escrituras de mediación y lectura dan 401 sin sesión firmada (`SESSION_AUTH_MODE=off`) y 403 con sesión. Es el guard compartido `requireAdminAccess`, sin cambios.
- El laboratorio queda **detenido, no borrado**, con los datos sintéticos y los cierres técnicos de 2026-07/08/09. El de ACCESS-04 no se tocó.

## G. Riesgos y pendientes

1. **Despliegue conjunto F4/F5** (Plan §7.1): al desplegar el API, la migración 0004 se aplicará en `royalties.db`. Requiere respaldo PRE, restauración RY y autorización. Esta unidad no despliega.
2. **Rendimiento:** cada informe mensual sin cierre recalcula la simulación (lee el mes de `econ_events`). Basta para los volúmenes actuales; con ingesta real masiva habrá que medirlo (como en U2).
3. **INS vigente para la simulación y el cierre:** el último registrado del periodo; los anteriores se conservan. Si Dirección prefiere elegirlo explícitamente, es un cambio menor de interfaz.
4. **Pendientes de autorización posterior:** cierres oficiales, registro de pagos, asignación de pendientes D1/D4/D5 y demás movimientos desde la interfaz (U4 ya los soporta en el servidor).
5. **Decisiones abiertas sin cambio:** D1 sigue provisional (`D1-PROV-2026-10-v1`); D4 y D5, pendientes no cobrables.
6. El botón «Exportar Informe» de la cabecera del Panel Admin es anterior a U5 y no está conectado; no se tocó.

## H. Commits

- `e1f8780`: endpoints, módulo de informes, pestaña «Informes», pruebas e informe; registro de U4 en verde (CI 10/10, incluido `identity-preflight`).
- Este commit: registro de CI y veredicto.

## I. Veredicto

**GREEN_LOCAL+CI.** Sin despliegue. U6 no iniciada.
