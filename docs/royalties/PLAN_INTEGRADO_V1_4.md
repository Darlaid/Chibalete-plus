# CHP-EDITORIAL-ROYALTIES-2026-01 — Plan General Integrado V1.4 (adenda de ejecución)

**Fecha:** 2026-10-26 · **Origen:** EDITORIALES-05 (cierre de F1-B).

## 1. Autoridad

- **La autoridad económica no cambia:** `PLAN_GENERAL_V1_1.md` (congelado) y `DECISIONES_F0C.md`. Esta adenda no modifica fórmulas, parámetros, gates ni la condición de terminación del Plan V1.1.
- Esta adenda solo ordena la ejecución: incorpora las unidades aprobadas después de F0-C (F1-B, F1-C, REPORTES-01) y su correspondencia con las 14 unidades del Plan V1.1.
- El avance se registra en `SEGUIMIENTO_PLAN_V1_1.md`.

## 2. Unidades incorporadas

| Unidad | Alcance aprobado | Corresponde en V1.1 a | Depende de | Estado |
|---|---|---|---|---|
| **F1-B** · EDITORIALES-02…05 | Editorial responsable obligatoria para todo libro, administración de editoriales, historial append-only de reasignaciones | Complemento de F1-A (G1) | F1-A | En producción (`editoriales-beb11e4`); YELLOW justificado por un control (`F1B_EDITORIALES_04_PROD_EVIDENCE.md` §J) |
| **F1-C** · CATÁLOGOS | Biblioteca por editorial y sello; sustituir la pestaña «Selección Chibalete» (`pages/Biblioteca.tsx`) por «Editoriales»; catálogo administrativo completo | Complemento de F1-A (G1); lo usa F5-A («Obras») | F1-B | Pendiente; siguiente unidad: **CATÁLOGOS-01, solo auditoría técnica** |
| **REPORTES-01** | Pestaña «Informes» en el Panel Admin: consultas mensuales, acumulados trimestrales, exportación PDF/Excel | Interfaz de F5-A (consultas) y F5-B (estados), alimentada por F3-B (vista previa), F4-A (cálculo) y F4-B (cierres y trimestre) | F3-B para estados provisionales; F4-B para cierres | Pendiente; criterios en §3, sin implementar |

No se crean entregables paralelos: F3-B, F4-A, F4-B, F5-A, F5-B, F6-A y F6-B siguen siendo las unidades del Plan V1.1, con sus gates.

## 3. Criterios para REPORTES-01 (registrados, sin implementar)

1. Una sola BRD = 25 % del INS (Plan V1.1 §6.2); no hay segunda bolsa.
2. División BGP 30 % (presencia) / BLC 70 % (lectura cualificada) (§6.2–6.4).
3. Q, R y S según §4.3–4.5; alfa contractual por obra y versión de derechos (§6.5).
4. Atribución por editorial (titular), obra y periodo, con la matriz de participaciones.
5. Derechos y elegibilidad históricamente verificables: `rights_versions` y `content_publisher_history` (append-only), evaluados en la fecha del hecho.
6. Cierres mensuales inmutables y acumulados trimestrales como suma de tres cierres congelados (F4-B).
7. PDF y Excel generados desde **una única fuente de cálculo** (la función pura de F4-A o el snapshot del cierre de F4-B); ninguna exportación recalcula por su cuenta.
8. Estados provisionales (vista previa de F3-B, sin cerrar) visiblemente diferenciados de los cierres y de las liquidaciones.
9. Dos meses de liquidación sombra antes de cualquier causación oficial (F6-B, G10).

## 4. Decisiones abiertas que esta adenda no resuelve

| Código | Tema | Detalle |
|---|---|---|
| **V14-1** | Formato de exportación de REPORTES-01 | El Plan V1.1 §3.2 excluye «dependencia XLSX o PDF», y F5-B define «CSV endurecido y página HTML imprimible». Opción compatible sin enmienda: Excel = CSV endurecido (UTF-8 con BOM, prueba de inyección de fórmulas) y PDF = HTML imprimible guardado como PDF desde el navegador. Una librería XLSX/PDF requiere enmendar §3.2 en `DECISIONES_F0C.md`. Decide Dirección antes de implementar REPORTES-01 |
| **V14-2** | «Sello» en F1-C | El Plan V1.1 §3.2 excluye una entidad de sellos. F1-C debe usar `publishers.imprints` (ya existente) y no crear una entidad nueva; si hace falta asignar un sello a cada obra, se decide en CATÁLOGOS-01 |

Siguen abiertas P1, P4, P7, P9 y P11 (`DECISIONES_F0C.md` §4).

## 5. Orden de ejecución

F1-C / CATÁLOGOS-01 (auditoría) → F1-C implementación ∥ cierre del gate de F3-A3 (VoiceOver/TalkBack en dispositivo, despliegue y episodio productivo) → F3-B → F4-A → F4-B → F5-A ∥ F5-B, con REPORTES-01 como su interfaz → F6-A → F6-B.

Cada unidad se inicia solo con su prompt explícito.
