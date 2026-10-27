# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / U6 · F6-A-SINT · Validación integral del circuito de regalías

**Estado:** ver §I · **Fecha:** 2026-10-27 · **Baseline:** `df0510c`
**Todos los resultados de esta unidad son SINTÉTICOS — NO EXIGIBLES.** Solo laboratorio aislado. Sin despliegue, ingesta real, Actas reales, pagos ni cierres oficiales. ACCESS-04 no se tocó.

## A. Baseline y CI

- HEAD = remoto = `df0510c`, árbol limpio. CI 10/10 en `e1f8780`, el último commit de código (U5); `df0510c` es solo documentación.
- U2–U5 se validan con el **código aprobado**: el laboratorio se construyó con `git archive df0510c` (sin `public/`, `docs/` ni `ops/`), sin `.env`, `data/` ni `data-critical/`.
- Migración 0004 con base temporal: `closesStore` 70/0, RY04 de U4 y la restauración aislada de §F.

## B. Escenario sintético

**Laboratorio nuevo `chp-u6lab`:**
- Imagen `chp-a11ylab:a9ab21a` + código de HEAD; solo `localhost:5175`; sesiones firmadas (`enforce`).
- Ingesta **on solo** en `/tmp/chp_u6lab` durante las lecturas, y después **off**.
- `chp-u1lab` y el laboratorio de ACCESS-04 no se tocaron.
- Semilla base con `a11yLab.mjs seed`, más `u6lab_seed.mjs` (fuera del repositorio).

| Elemento | Detalle |
|---|---|
| Editoriales | **Aurora (LAB-U6)**, con beneficiarios adicionales Ilustradora y Traductor (terceros); **Bruma (LAB-U6)** |
| Obras | `lab-corto` (libro, Aurora), `lab-epub` (libro con EPUB, Aurora), `lab-largo` (libro, Bruma), `lab-album-u6` (**libro_album**, Bruma) |
| Derechos | Todos con vigencia desde 2026-07-01 y Actas sintéticas:<br>• `lab-corto`: alfa 0,7; Aurora 70 / Ilustradora 30<br>• `lab-epub` v1: alfa 0,6; Aurora 100. **v2 desde 16/08**: alfa 0,8; Aurora 60 / Traductor 40<br>• `lab-largo` v1: activa; **v2 en disputa desde 10/09**<br>• `lab-album-u6`: alfa 0,75; Bruma 50 / Ilustradora 50 (titular compartido entre editoriales) |
| Reglas comerciales | Lector `paid_b2c` (pagado); lector «avance» reclasificado a `courtesy` (gratuito). La administración no tiene regla (interna) |
| INS | 07: 1.500.000 − 100.000; 08: 1.000.000; 09: 850.000 − 50.000. Soportes `SINTETICO-NO-EXIGIBLE-U6-2026-0x`, registrados **desde la interfaz** |

**Lecturas reales en Chrome (27/10, ingesta del laboratorio):**
- **Lector pagado:**
  - `lab-epub` en Modo Guiado (~65 s, con desplazamientos) **y luego en el lector EPUB** (~60 s, pasando páginas);
  - `lab-corto` (dos sesiones, ~57 s + ~74 s);
  - `lab-largo` (~60 s).
- **Lector de cortesía:** `lab-corto` (~60 s).
- **Administración:** `lab-corto` (~60 s).

Resultado: 42 filas `econ_events` reales.

**Q3 por réplica temporal:**
- El reloj real impide leer en meses pasados, así que el tercer trimestre (jul–sep) se construyó copiando esas **mismas filas reales** con las fechas desplazadas (`u6lab_replay.mjs`, prefijo `u6rep-`, payload de atribución intacto).
- Resultado: 14 lecturas y 145 filas. Incluyen una lectura del lector pagado de `lab-corto` reasignada al libro-álbum, que no tiene visor de álbum en el laboratorio.
- Las fechas cruzan a propósito el cambio de derechos del 16/08 y la disputa del 10/09.

## C. Resultados del circuito

| Comprobación | Resultado |
|---|---|
| Un evento → una obra | `crossWorkDroppedSlots = 0` en los 3 meses; cada episodio pertenece a una sola obra |
| Cambio de modo | `lab-epub`: **un solo episodio** con `epub` 60 s + `text` 45 s (en agosto, 2 episodios: 120 s / 90 s) |
| Q, R, S = lecturas observadas | Julio: Q = 1 por obra (álbum, corto, epub, largo); 6 episodios. `lab-corto` R = 1,0 (minutos esperados 1); `lab-epub` R = 0,080 (22 min); `lab-largo` R = 0,037 (20 min) |
| Exclusiones | Cortesía ⇒ `access_not_paid:courtesy`; administración ⇒ `user_excluded` (y `access_unattributed`, sin regla). Las dos lecturas reales cortas de `lab-corto` (≈ 57 s de ticks) quedaron en `below_min_active`, que es correcto: la primera franja parcial no cuenta (S-4) y no llegan a 45 s de franjas completas |
| Derechos según la fecha de lectura | Agosto: `lab-epub` Q = 2, una con v1 (05/08) y otra con v2 (20/08). Septiembre: `lab-largo` Q = 2, activa (03/09) y en disputa (15/09) |
| **D2** presencia por beneficiarios | Ilustradora con presencia por `lab-corto` y el álbum (31 días); **Traductor 16 días en agosto** (desde la v2) y 30 en septiembre; terceros sin editorial responsable |
| **D3** retención sin redistribución | Septiembre: `lab-largo` MontoObra 40.900, de los cuales **20.450 retenidos** (la mitad en disputa); a Bruma solo le llega la variable de la parte activa (14.315 = 20.450 × 0,7) |
| **D1** provisional | `D1-PROV-2026-10-v1 (provisional)` en cada snapshot, en la pantalla y en los archivos; aplicada al reparto entre versiones de `lab-epub` (agosto) y `lab-largo` (septiembre) |
| **D4 / D5** | Complemento de alfa pendiente no cobrable (73.371 / 49.335 / 32.801); D5 = 0 (siempre hubo beneficiarios) |
| Bolsas 25/30/70 | BRD = INS / 4 y BGP + BLC = BRD en los 3 meses (§D) |
| Cierres | 3 cierres técnicos **desde la interfaz**, cada uno con el **mismo sha256 que su simulación**: 07 `5faa4169320b…`, 08 `d77183620ff5…`, 09 `a25cd1077d5f…`; `paymentsAuthorized: false` |
| Trimestre | Q3 = Σ de los 3 cierres congelados (BRD 800.000 = 350.000 + 250.000 + 200.000), PROVISIONAL (cierres técnicos), nunca DEFINITIVE. Q4 sin cierres = PROVISIONAL (incompleto) |
| Movimientos | Pago registrado 50.000 a Aurora (julio) ✓; pago mayor que el saldo ⇒ `insufficient_balance`; traslado del saldo de Bruma bajo umbral (agosto, 45.059) a 2026-10 abierto ✓, a 2026-09 cerrado ⇒ `target_closed`; retención y liberación de 5.000 ✓; liberar más de lo retenido sin titular ⇒ `insufficient_balance`; D4 **no** se asignó (sin autorización). Los 3 libros mayores concilian (350.000 / 250.000 / 200.000) y los 3 hashes de cierre no cambian |

## D. Conciliación económica (al peso)

| Mes | INS | BRD 25 % | BGP 30 % | BLC 70 % | Cobrable | Retenido | Pendiente D4 | BRD = Σ |
|---|---|---|---|---|---|---|---|---|
| 2026-07 | 1.400.000 | 350.000 | 105.000 | 245.000 | 276.629 | 0 | 73.371 | ✓ |
| 2026-08 | 1.000.000 | 250.000 | 75.000 | 175.000 | 200.665 | 0 | 49.335 | ✓ |
| 2026-09 | 800.000 | 200.000 | 60.000 | 140.000 | 146.749 | 20.450 | 32.801 | ✓ |
| **Q3** | 3.200.000 | **800.000** | | | **624.043** | **20.450** | **155.507** | ✓ |

- Estado de la Ilustradora en Q3: 83.809 + 59.425 + 29.375 = **172.609** (la suma de sus 3 cierres).
- Tras los movimientos, el cobrable de Q3 es 528.984 = 624.043 − 50.000 (pagado registrado) − 45.059 (trasladado a octubre). Conciliado.

## E. Informes y exportaciones (Chrome real, administración sintética)

- **Panel Admin → Informes:**
  - vista previa de julio sin INS (solo Q/R/S, NO EXIGIBLE);
  - INS registrado por el formulario y simulación;
  - cierres técnicos de 07/08/09 escribiendo el periodo;
  - Q3 completo y Q4 incompleto;
  - filtros por editorial, titular (Ilustradora) y obra.
- **CSV:** descarga con un clic real (el servidor respondió 200 dos veces, con filtro y `expectReference`). El archivo se guarda en la carpeta de descargas que tenga configurada Chrome, que no se buscó. Los mismos bytes, pedidos desde la página:
  - BOM y `;`;
  - inyección neutralizada;
  - solo el titular filtrado.
- **HTML imprimible:** se abrió en una pestaña. Lleva el cartel NO EXIGIBLE, la referencia, la fórmula, los filtros y la tabla del titular; también la CSP y ningún `<script>`.
- **Igualdad exacta** API = pantalla = CSV = HTML = snapshot, para 07, 08, 09 y Q3:
  - la referencia es igual al `snapshot_sha256` del cierre;
  - los totales, cada titular y cada obra coinciden;
  - las identidades de bolsas se cumplen.
- **Privacidad:** ningún identificador, nombre, correo ni sesión de lectores en JSON, CSV, HTML ni snapshots.

## F. Seguridad, integridad y restauración

- **Sesiones reales:**
  - administración 200;
  - **mediación y lectura 403** en los 7 GET (informe JSON, CSV y HTML, vista previa, cierres, INS) y en los 2 POST;
  - **anónimo 401**.
- **Consultas sin escrituras:** la huella (cierres y hashes, INS, movimientos, derechos, titulares, `econ_events` y JSON) es idéntica antes y después de las 7 consultas.
- **Solo inserciones:** `UPDATE` y `DELETE` bloqueados en `closes`, `period_inputs`, `adjustments` y `rule_sets`.
  - Una primera comprobación dio falso porque `adjustments` aún estaba vacía: un `UPDATE` sobre 0 filas no dispara el trigger.
  - Repetida con filas, todo bloqueado.
- **Protecciones de cierre:** cierre duplicado ⇒ 409; cierre oficial ⇒ 400 `official_not_enabled`.
- **Reproducibilidad:** recálculo independiente de cada cierre con las mismas entradas que reúne el servidor (`verifyCloseReproduction`) ⇒ **mismo hash en los 3 meses**; el snapshot guardado supera la verificación de integridad.
- **Restauración aislada** (API de respaldo de SQLite):
  - `integrity_check ok`;
  - migraciones 0001–0004;
  - mismas filas en las 7 tablas y los 12 triggers;
  - cierres íntegros y trimestre idéntico.

## G. Defectos corregidos y riesgos residuales

**Defecto corregido — totales de las exportaciones filtradas sin ámbito.**
- Con un filtro (p. ej. el estado de un titular), el CSV y el HTML repetían los totales del periodo completo (cobrable 624.043) sin decirlo y sin el subtotal visible (172.609) que sí muestra la pantalla. Un estado por titular podía malinterpretarse.
- **Corrección mínima** en `server/royalties/royaltyReports.mjs`: con filtro, ambos archivos añaden «Ámbito de los totales: periodo completo (sin filtrar)» y los subtotales visibles (titulares, obras, cobrable, retenido y MontoObra). Sin filtro, nada cambia.
- **Regresión:** 3 casos nuevos en `royaltyReportsHttp` (59/0). Verificado de nuevo en el laboratorio con Q3 filtrado por la Ilustradora.

**Riesgos residuales** (no bloquean el circuito):
1. **Se puede cerrar un mes que aún no terminó.** `closeMonth` no comprueba que el periodo haya acabado (corte, Plan §6.6). Como el cierre es único e inmodificable, cerrar el mes en curso por error congelaría datos parciales. Recomendación (condición J.4): rechazar el cierre antes del fin del mes más el retraso de ingesta.
2. **Rendimiento:** la simulación de un mes abierto lee el mes de `econ_events` en cada consulta. Con volúmenes reales hay que medirlo.
3. **Lecturas cortas:** las dos lecturas reales de ~1 minuto de un texto que cabe en pantalla no cualificaron por la regla de franjas completas (S-4) y los 45 s (es correcto). En producción conviene explicarlo a Dirección: una lectura breve no acredita.
4. **Libro-álbum:** el visor de álbum no tiene contenido en el laboratorio; su lectura se replicó sobre una lectura real de texto. La instrumentación del visor de álbum no se validó en esta unidad (sí en F3-A3).
5. **Q3 por réplica temporal:** las lecturas de jul–sep son copias desplazadas de lecturas reales, porque el reloj no permite leer en el pasado. La atribución y los payloads son los reales.
6. Decisiones abiertas sin cambio: D1 provisional; D4 y D5 pendientes no cobrables; P9 (0 reglas pagadas en producción), P11, P1 y P7 siguen pendientes de negocio.

## H. Commits

Ver `SEGUIMIENTO_PLAN_V1_1.md` (fila U6).

## I. Veredicto

Ver `SEGUIMIENTO_PLAN_V1_1.md` (fila U6).

## J. Condiciones concretas para el despliegue productivo de U2–U5

1. **Autorización expresa de Dirección** del despliegue conjunto F4/F5 (Plan §7.1), que solo cubre consulta, INS y cierre técnico. **Sin activar `ECONOMIC_INGEST_MODE`** ni `RIGHTS_ENFORCEMENT_MODE`.
2. **Respaldo PRE** (`structured-backup.service`) y **restauración aislada RY** con la base restaurada abierta por la imagen nueva: la 0004 se aplica sola, de forma aditiva; comprobar 12 triggers e `integrity_check`.
3. **Imagen API** desde HEAD con CI 10/10 (`identity-preflight` incluido) y **front** con la pestaña «Informes». Reinicio escalonado `api_1` → validar → `api_2`. POST de PRE y rollback documentados.
4. **Antes de habilitar cierres técnicos en producción:** añadir la guarda de «mes terminado» (riesgo G.1) o mantener el cierre deshabilitado y desplegar solo consulta e INS.
5. **Smokes productivos sin escrituras:**
   - administración 200;
   - mediación 403 y lectura 403 **con sesiones reales**;
   - anónimo 401;
   - mes actual = PROVISIONAL sin INS y Q = 0 en todas las obras (0 reglas pagadas, ingesta off);
   - CSV y HTML con NO EXIGIBLE.
6. **Ningún INS ni cierre real** hasta que Dirección defina P11 (INS real), P9 (reglas pagadas), D1 definitiva, y D4 y D5. Las dos primeras corridas reales serán en sombra (P13, gate F6-B).
7. **Huella post-despliegue** igual a PRE (salvo `lastLoginAt`) y respaldo POST restaurado.
