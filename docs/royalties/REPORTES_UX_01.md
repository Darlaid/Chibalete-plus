# REPORTES-UX-01 — Panel Admin → Informes (corrección visual)

Plan PLAN-EDITORIALES-INFORMES-01 · V1.0 · 2026-10-28 · código `dbe1e04` · **sin despliegue**.

## A. Baseline
- Rama `chp/epub-mainfile-r1-release`, HEAD previo `30e3eaf` = `origin` (0 adelante). Último CI conocido: `89d8015` 9/10 (content-rmw amarillo, pendiente de relanzar). `gh` no está instalado en el equipo: CI no consultable desde aquí.
- `components/admin/InformesRegalias.tsx` y `pages/AdminDashboard.tsx` idénticos entre producción (`regalias-c8f491e`) y HEAD.

## B. Causa de la «duplicación»
- **No existe duplicación en el DOM.** Referencia, corte, fórmula S y las dos exportaciones se renderizan una sola vez (conteo en el DOM del laboratorio: 1/1/1/1). `AdminDashboard` y `Layout` montan el contenido una vez.
- La captura 1 del 28/10 muestra la copia dentro del relleno inferior (`pb-24`) del `<main>` con `overflow-y-auto`, con botones a medio pintar; la captura 2, en la misma posición, no la tiene, y la captura 4 (Editoriales, otra pantalla con el mismo `Layout`) muestra el mismo fantasma («3023769559» suelto). Diagnóstico: **artefacto de repintado del contenedor con scroll (Chrome / Herramienta Recortes)**, no reproducido en el laboratorio. No se oculta con CSS (no hay nada que ocultar).
- Problema real encontrado: a 390 px la cabecera y las 4 pestañas del panel no envuelven ni se desplazan → `<main>` de 547 px en 390 (desplazamiento horizontal de la página; «Informes» fuera de pantalla).

## C. Correcciones
- `InformesRegalias.tsx` (solo JSX/clases): A encabezado+filtros+Actualizar (con indicador de carga) · B resumen (estado, NO EXIGIBLE, indicadores, aviso «Trimestre incompleto», bloque técnico compacto) · C «Desempeño de obras» con estados vacíos y nota sin INS · D titulares, movimientos, **una** sección «Exportar informe», «Operaciones del periodo» diferenciada. Tablas con scroll interno, números a la derecha. `colSpan` de la fila vacía trimestral 8→6.
- `AdminDashboard.tsx`: `flex-wrap` en la cabecera, `overflow-x-auto whitespace-nowrap` en la barra de pestañas. Botón «Exportar Informe» intacto (inoperante; **recomendación**: retirarlo o conectarlo en una unidad propia, se confunde con la exportación del informe).

## D/E. Validación (laboratorio `chp-u6lab`, `localhost:5175`, datos sintéticos)
Anchos emulados con iframe del mismo origen (la ventana de Chrome no se redimensionaba).

| Ancho | Antes: `main` scrollWidth/clientWidth | Después |
|---|---|---|
| 1440 | 1152/1152 | 1152/1152 |
| 1024 | 736/736 | 736/736 |
| 390 | **547/390** | 390/390 |

| Caso | Resultado |
|---|---|
| Mes 2026-05 (sin INS) | PROVISIONAL (sin INS), operaciones visibles |
| Mes 2026-08 (cerrado) | TÉCNICO, `d7718362…` = semilla U6, sin operaciones |
| Q3 2026 completo | PROVISIONAL (cierres técnicos), `quarter_sha256 7e8402f3…` |
| Q4 2026 incompleto | aviso «faltan 2026-10, 2026-11, 2026-12»; fila vacía colspan 6 = 6 columnas |
| 2026-10 | `preview_digest 3e374debd35f666b` idéntico antes/después |
| Filtro editorial | 2 obras visibles + texto de ámbito |
| CSV / HTML | 200, contienen la referencia de pantalla y «Ámbito de los totales» |
| INS inválido (12.5) | error mostrado |
| INS 1.000.000 `LAB-UX01` | aviso + estado PROVISIONAL (simulación) |
| Confirmación de cierre | deshabilitado vacío y con mes erróneo; habilitado con mes exacto |

Nota: el servidor del laboratorio es `7157200`, anterior a CLOSE-GUARD-01 (`a6fda3b`, presente en HEAD y en prod `c8f491e`), por eso aceptó el cierre técnico de 2026-10 (solo base sintética del lab; sha `fc361cb7…` = simulación mostrada). No es regresión del frontend.

Typecheck: 0 errores en los archivos tocados (12 preexistentes, iguales antes/después). `npm run build` OK. `royaltyReportsHttp` 64/0. Backend sin cambios.

Capturas: `reportes_ux_01/antes_*`, `reportes_ux_01/despues_*`.

## F. Riesgos pendientes
- El artefacto de repintado puede repetirse (también en Editoriales); es de pintado del navegador, no de datos.
- Modo oscuro y lector de pantalla no revisados en esta unidad.
- CI del commit pendiente de consultar en GitHub.
