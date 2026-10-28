# REPORTES-FILTROS-01 — Informes por editorial, sello, libro y titular

Plan PLAN-EDITORIALES-INFORMES-01 · V1.0 · 2026-10-28 · código `2b808a0` · **sin despliegue**.

## A. Baseline y CI
- Base `7e746ca` = `origin/chp/epub-mainfile-r1-release`, árbol limpio (solo no rastreados previos).
- CI `40700386567` (identity-preflight de `7e746ca`): intento 1 falló en `test:credential-reset` (suite ajena: pasa en local 21+22+17/0); **intento 2 = success** → REPORTES-UX-01 queda GREEN_LOCAL+CI.

## B. Filtros
Periodo (mes/trimestre) + editorial responsable + sello + libro + titular, combinables. Cascada en el navegador sobre el informe sin filtrar: editorial → sus sellos y libros; sello → sus libros; titular acotado a los beneficiarios de la selección. Al cambiar un nivel se descartan las selecciones inferiores que ya no pertenecen. Opción **«Sin sello asignado»** (`sello=__sin_sello__`). Nada se asigna ni inventa.

## C. Detalle por obra
Tabla: título, editorial, sello, Q, R, S (mes), MontoObra, cobrable, retenido, pendiente. «Detalle» abre una fila en el mismo periodo con:
- Elegibilidad económica U2 (régimen de derechos, episodios cualificados/total, días de presencia elegibles, exclusiones por motivo, avisos, cambios de editorial). Rotulado como lecturas que cuentan para regalías, no métricas pedagógicas.
- Reparto de la variable entre titulares (cobrable/retenido) y partes por versión (α, Q, importe).
- Trimestre: Q/R/S/MontoObra por mes (R y S no se suman).

Importes leídos de las participaciones ya liquidadas en U3, sin recalcular: cobrable = participaciones `payable`; retenido = obra/parte retenida + participaciones `retained`; pendiente = D1 + D4. **Identidad por obra: cobrable + retenido + pendiente = MontoObra.**

## D. Subtotales y conciliación
- «Total del periodo completo» = cifras del informe o del cierre, sin cambios.
- «Subtotal filtrado» = suma por obra visible (Q, MontoObra, cobrable, retenido, pendiente). Con titular: solo sus participaciones en esas obras, y aparte su saldo total (Base + variable + movimientos).
- No se suma R, no se recalcula S, no se redistribuyen bolsas, la Base (BGP) no se atribuye a obras.
- Corrige un defecto de REPORTES-01: el subtotal con filtro de editorial sumaba saldos completos de titulares que también cobran por obras de otras editoriales (y la Base). Ahora es `null` salvo con filtro de titular.
- Titulares: con filtro, columna «En obras visibles» (su variable en la selección) separada del saldo completo.

## E. Exportaciones
CSV y HTML: filtros (incluido sello), «Dimensión sello», «Ámbito de los totales: periodo completo», subtotal por obras separado, filas por obra con sello y desglose, reparto por obra y titular (también trimestral), referencia, estado, rule set, NO EXIGIBLE. Neutralización CSV intacta (probada con «sin sello»).

## F. Pruebas
- `royaltyReportsHttp` 96/0 (+31): identidad por obra; Σ MontoObra = BLC; Σ pendiente = D1+D4; por titular Σ por obra = su variable (sin doble conteo); sello / sin sello / editorial+sin sello / editorial / titular compartido / editorial+titular / libro+titular; CSV y HTML = API; 403 mediación/lectura con filtros; cierre: sello no reconstruible + 400; trimestre: desglose = Σ cierres, referencia = hash del cuerpo previo.
- `npm run test:royalties` completo: verde. Typecheck: 0 errores nuevos (12 preexistentes). Build OK.
- Laboratorio `chp-u6lab`, directorio nuevo `/tmp/chp_u7lab` (copia de U6 sin el cierre técnico 2026-10 creado en UX-01 por un backend sin CLOSE-GUARD-01), código del árbol de trabajo. Datos: Aurora (sellos Aurora Infantil/Clásicos) y Bruma (Bruma Joven); `lab-corto`/`lab-largo` con sello, EPUB y álbum sin sello; Ilustradora compartida entre editoriales; EPUB reasignado Aurora→Bruma el 2026-10-28; derechos v2 en EPUB y largo.
  - Referencias con el código nuevo = anteriores: 08 `d7718362`, Q3 `7e8402f3…`, Q4 `13316c45…`, octubre `fc361cb7` (antes de reasignar). Snapshots guardados de 07/08/09 vuelven a dar su sha256.
  - Octubre: total 174.016 intacto; Aurora 93.571 + Bruma 81.429 = BLC 175.000; Ilustradora 19.650 (Aurora) + 0 (Bruma) = su variable; saldo 38.865 = Base 19.215 + variable.
  - Bruma + sin sello: pantalla = API = CSV = HTML (41.895 / 33.516 / 0 / 8.379).
  - Junio (vista previa): EPUB conserva Aurora y sello `publisher_changed`; agosto (cierre): EPUB sigue en Aurora, selector de sello deshabilitado con explicación.
  - 390 / 1024 / 1440 px con detalle abierto: `main` 390/390, 736/736, 1152/1152. Defecto hallado y corregido en la prueba: el `sr-only` de la cabecera de la tabla escapaba del contenedor con scroll (845 px); el contenedor ahora es `relative` y el detalle queda fijo a la izquierda en móvil.
- Capturas en `reportes_filtros_01/`.

## G. Limitaciones históricas
- **Sello**: no tiene historial y ningún cierre lo congela. En cierres y trimestres no se reconstruye (filtro deshabilitado, API 400 `imprint_not_historical`). En vivo se usa el sello actual solo si la editorial actual coincide con la del periodo. Para tener sello histórico habría que congelarlo en el snapshot de los cierres futuros: decisión pendiente, fuera de esta unidad.
- **Editorial en el trimestre**: se toma del primer cierre que incluye la obra; si cambió entre meses se avisa en el detalle.
- Exclusiones se muestran con su código interno (sin traducción).
