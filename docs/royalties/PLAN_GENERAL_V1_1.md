# CHP-EDITORIAL-ROYALTIES-2026-01 — Plan General V1.1 (congelado en F0-C)

**Estado:** CONGELADO en F0-C (2026-10-21). Sustituye al Plan General V1.0.
**Decisiones y parámetros:** [`DECISIONES_F0C.md`](./DECISIONES_F0C.md) — fuente única de P1–P15 y del `rule_set` inicial.
**Bases:** auditorías F0-A y F0-B (read-only, HEAD `e193b5e`), Doctrina Chibalete+ v1.0, Convenio marco de incorporación editorial v1.0, Guía breve de revisión jurídica.

> **Advertencia contractual vigente.** La Guía de revisión jurídica señala que la fecha de la Doctrina citada en el Convenio es inconsistente. Debe corregirse **antes de firmar** cualquier Convenio. Los documentos contractuales primarios no están versionados en este repositorio: los valores de este plan se tomaron del Plan V1.0, que los cita, y su cotejo con los originales queda pendiente (ver `DECISIONES_F0C.md` §5).

**Principio de ejecución:** una línea canónica; una entidad por concepto; un único almacén nuevo; ningún job, framework ni dependencia nuevos; unidades pequeñas con un único resultado y un gate verificable.

---

## 1. Objetivo

Incorporar a Chibalete+ un sistema administrativo que permita:

- vincular editoriales externas;
- registrar obras y derechos autorizados, y hacerlos cumplir;
- medir de forma verificable la lectura;
- distribuir la Bolsa de Remuneración por Derechos;
- producir liquidaciones mensuales y trimestrales auditables.

Todo ello sobre la infraestructura existente, sin ERP, sin contabilidad paralela y sin comprometer la plataforma actual.

**Al terminar, un administrador podrá:**

1. Administrar titulares: editoriales y terceros con derechos económicos, con sus sellos.
2. Asociar obras a una editorial desde el catálogo.
3. Registrar Actas, permisos, vigencias, alfa y matriz de participaciones.
4. Distinguir obras liquidables de recursos auxiliares.
5. Consultar lecturas y episodios cualificados por obra, sin doble conteo entre modos.
6. Registrar manualmente el INS con sus soportes.
7. Calcular la participación de cada titular.
8. Generar cierres mensuales inmutables.
9. Consultar y exportar estados mensuales y consolidados trimestrales.
10. Ejecutar liquidaciones sombra antes de la causación oficial.

---

## 2. Glosario cerrado

| Término | Significado único |
|---|---|
| **Obra** | Un `contentId`. Es la identidad económica. No existe `workId`. |
| **Titular** | Registro en `publishers`: una editorial (`kind = editorial`) o un tercero con derechos económicos (`kind = tercero`). El sello es un atributo de texto del titular. |
| **Editorial responsable** | `publisherId` en la ficha de contenido. Es una relación operativa entre la obra y la editorial. **No define quién cobra.** |
| **Beneficiarios** | La matriz de participaciones de la versión de derechos vigente: titulares y porcentajes que suman 100 %. Es lo único que define quién cobra. |
| **Sesión técnica** | La sesión de producto por modo (`session_start` / `session_heartbeat` / `session_end`). **No tiene efecto económico.** |
| **Franja** | Una unidad de 15 s de tiempo por usuario (valor provisional en `rule_set`). |
| **Episodio** | Las franjas activas de un par (usuario, obra) en cualquier modo, pestaña o dispositivo, fusionadas si el hueco es de 30 min o menos. |
| **Episodio cualificado** | Un episodio con 45 s activos o más que supera todas las exclusiones. **Q cuenta episodios cualificados.** |
| **`rule_set`** | Versión de los parámetros económicos y de medición que rige un periodo. |
| **Cierre** | Snapshot inmutable de un periodo, con hash y con la versión de `rule_set` que se aplicó. |
| **Movimiento posterior** | Ajuste, pago registrado, retención, liberación o traslado de saldo. Siempre referencia el cierre original y **nunca lo modifica**. |

---

## 3. Arquitectura mínima

**Flujo canónico:**

Titular → Obra → Derechos (con cumplimiento efectivo) → Acceso clasificado → Episodio → Q/R/S → BRD → Distribución → Cierre → Movimientos posteriores → Estados.

### 3.1 Inventario completo de persistencia

| Dato | Dónde | Naturaleza del cambio |
|---|---|---|
| `publisherId` | Ficha en `data/content.json`. **El servidor lo arrastra** porque `POST /api/content` reemplaza el registro completo. | Un campo |
| `commercialClass` | Reglas de `data/access_db.json`. **El servidor lo arrastra** porque `POST /api/access` reconstruye la regla (`server.js:1345-1352`). | Un campo |
| Evento `econ_tick` y atribución del acceso en `session_start` | `data-critical/events.db`, el existente | Un nombre de evento y un enriquecimiento del payload en el servidor |
| `publishers`, `rights_versions`, `rule_sets`, `period_inputs`, `closes`, `adjustments` | **`data-critical/royalties.db`** (SQLite, `server/db/migrate.js`, respaldo en `ops/backup/.../stores.py`) | **Las 6 tablas, en un único almacén nuevo** |

**Uso de cada tabla:**

- `adjustments` registra **todos** los movimientos posteriores al cierre: ajuste, pago registrado, retención, liberación y traslado de saldo. Cada movimiento lleva `closeId` y un motivo. **El cierre nunca se actualiza.**
- `rights_versions` admite solo inserciones: una nueva versión cierra la vigencia de la anterior.
- `closes` admite solo inserciones. Triggers SQLite bloquean `UPDATE` y `DELETE`, y la restricción `UNIQUE(periodo)` impide cierres duplicados entre las dos réplicas.

### 3.2 Lo que no se construye en V1

- agregados materializados
- jobs periódicos, elección de líder o locks nuevos
- tabla de métricas
- entidad de sellos
- entidad de titulares separada de `publishers`
- portal externo
- motor financiero genérico
- dependencia XLSX o PDF
- cambios en las métricas pedagógicas o de producto

### 3.3 Decisiones arquitectónicas congeladas

1. `contentId` es la identidad económica. Sin `workId` (F0-B: 0 duplicados de primer nivel entre los 109 contenidos).
2. El modo no forma parte de la identidad económica.
3. `publisherId` es la editorial responsable; los beneficiarios están en la matriz de derechos.
4. Los derechos están versionados y nunca se exponen en la ficha pública ni en respuestas a lectores.
5. **Los permisos se hacen cumplir de verdad (P15):** una función no autorizada se deniega en el servidor, no solo se excluye de las regalías.
6. Q, R y S se calculan bajo demanda con una función pura sobre `events.db`. Solo se persiste el snapshot del cierre.
7. El administrador lanza los cierres a mano. Sin scheduler nuevo.
8. Los parámetros están versionados en `rule_sets`. Las fórmulas no se aplican retroactivamente.
9. La implementación de la medición es única: el hook `useEconomicTick` en el frontend y la función pura `computeEconomicEpisodes` en el servidor.
10. Las obras existentes se asocian una por una. No hay backfill masivo.
11. Los estados se exportan en CSV y como página HTML imprimible. Sin dependencia XLSX.
12. El backend se despliega mediante **imagen Docker nueva**. La topología verificada en F0-B no monta `server/`.
13. Las APIs reutilizan la autenticación y la autorización de administración existentes.

### 3.4 Privacidad y seguridad

- Los datos contractuales nunca llegan a los lectores.
- Las editoriales solo reciben agregados de sus propias obras y sus estados.
- Los cierres y las exportaciones contienen agregados por obra y titular, **nunca** identificadores, nombres ni correos de lectores.
- `events.db` conserva solo los identificadores necesarios para reconstruir un cálculo.
- Las acciones administrativas quedan autenticadas y auditadas.

---

## 4. Contrato canónico de medición económica

Es un invariante transversal de F3, F4, F5 y F6. Los valores numéricos viven en `rule_sets` (`DECISIONES_F0C.md` §3).

### 4.1 Identidad y episodios

- Una obra puede leerse en PDF, Guiado, Inmersivo, Accesible, EPUB y Libro-Álbum. **Cambiar de modo no crea una nueva lectura económica.**
- Las reanudaciones dentro de 30 min se consolidan en el mismo episodio, aunque cambien el modo, la pestaña o el dispositivo.
- Máximo 3 episodios cualificados por usuario, obra y día contractual (`America/Bogota`).

### 4.2 Tiempo activo

Señal aditiva `econ_tick`. No reemplaza `session_heartbeat` ni altera ninguna métrica existente.

**Vía visual:**
- pestaña visible;
- señales humanas: interacción, navegación y las señales propias de tecnologías de apoyo;
- se excluyen completas las pausas de más de 120 s.

**Vía de escucha:**
- reproducción iniciada por un gesto del usuario;
- avance efectivo del medio;
- no silenciada;
- **no exige visibilidad de la pantalla**.

**Tope de escucha sin presencia (P3, provisional):** al superarse, se **detiene la acreditación económica, no la reproducción**. La escucha legítima continúa sin verificaciones invasivas, y la acreditación se reanuda con la siguiente señal humana.

**Unión temporal:** varias pestañas, modos o dispositivos se unen, no se suman. Una franja se atribuye a una sola obra. Se acredita de forma conservadora en los bordes de franja, sin reconocer tiempo no demostrado.

### 4.3 Q

Un episodio es cualificado si cumple todo lo siguiente:

- usuario autenticado por sesión;
- obra elegible según la versión de derechos vigente;
- actividad verificable;
- 45 s activos o más;
- no es QA, tráfico sintético ni anomalía excluida;
- acceso económicamente elegible al iniciar el episodio, según la atribución registrada por el servidor.

El avance equivalente queda **desactivado** (P4, provisional).

**Q cuenta episodios de la obra, nunca aperturas por modo.**

### 4.4 R

```
r = min(1, minutos_activos / minutos_esperados_obra)
R = mediana de r sobre los episodios cualificados del mes
```

- El denominador es **único por obra**, independiente del modo, y está registrado en `rights_versions` (P1).
- Páginas, scroll, CFI, diapositivas y bloques canónicos **no** sustituyen al tiempo activo.
- Si la obra no tiene minutos esperados válidos, no se inventa R: el cierre oficial de esa obra queda bloqueado hasta subsanarlo.

### 4.5 S

```
S = √Q × (0,40 + 0,60 × R)
```

Si Q = 0, S = 0.

### 4.6 Equidad y accesibilidad

- Perfiles de lectura comparables deben producir resultados equivalentes en todos los modos.
- El lector de pantalla, el TTS autorizado, la navegación accesible o el audio sincronizado no pueden penalizar sistemáticamente.
- Los desgloses por modo son descriptivos; las métricas económicas pertenecen a la obra.

**Gate transversal:** ninguna unidad de medición es GREEN si cambiar de modo multiplica Q, duplica minutos o pone en desventaja sistemática a un modo accesible.

---

## 5. Alcance V1

**Incluido:**

- titulares y sellos;
- asociación editorial por obra;
- derechos y permisos expresos, **con cumplimiento efectivo**;
- vigencias, alfa y matriz de participaciones;
- medición multimodo en PDF, Guiado, Inmersivo, Accesible, EPUB y Libro-Álbum;
- clasificación económica de accesos;
- Q, R y S;
- INS manual documentado;
- liquidación mensual, cierres inmutables y movimientos posteriores;
- consolidación trimestral;
- reportes administrativos y estados por titular;
- liquidaciones sombra.

**Excluido de V1:**

- portal externo de editoriales;
- facturación electrónica;
- integración con SIIGO;
- recaudo bancario;
- pagos o transferencias automáticos;
- contabilidad general;
- distribución interna de regalías entre la editorial y sus autores;
- integración financiera con WooCommerce;
- reconstrucción retroactiva de lecturas no verificables;
- reescritura de la analítica pedagógica;
- motor genérico de modalidades de negocio no aprobadas.

**LU/Android, MOOK, podcast y vídeo** quedan fuera de la liquidación automática de V1 (P10). Eso **no amplía ni presume sus permisos**: siguen sujetos a autorización y al cumplimiento de P15.

---

## 6. Modelo económico

Los parámetros están en `rule_sets` (`DECISIONES_F0C.md` §3).

### 6.1 INS

```
INS = recaudo efectivo elegible − deducciones contractuales
```

- **Deducciones admitidas:** impuestos indirectos incluidos, reembolsos, contracargos, descuentos financiados por Chibalete cuando procedan y comisiones de cobro no recuperables.
- **No se deducen:** hosting, desarrollo, nómina, administración, mercadeo ni costos editoriales.
- En contratos institucionales mixtos solo entra el valor documentalmente atribuible a la suscripción al catálogo.
- Carga **manual**, con referencia a sus soportes, en `period_inputs` (P11).

### 6.2 Bolsas

```
BRD = 25 % × INS
BGP = 30 % × BRD
BLC = 70 % × BRD
```

Existe una sola BRD. No hay una segunda bolsa del 25 %.

### 6.3 Garantía de presencia

```
P_titular = días con ≥1 obra activa del titular / días del mes
Base      = BGP × P_titular / Σ P de los titulares elegibles
```

Cada titular cuenta una sola vez; tener más títulos no multiplica la base.

### 6.4 Lectura cualificada

```
MontoObra = BLC × S_obra / Σ S_obras
```

Si Σ S = 0, la BLC se traslada a la BGP del mismo periodo (Doctrina).

### 6.5 Participación por titular

```
Variable = Σ (MontoObra × alfa_obra)
Total    = Base + Variable
```

- El alfa se define por obra y por versión de derechos.
- Los pagos directos a terceros se hacen mediante la matriz de participaciones, que debe sumar 100 %, sin doble remuneración.
- Los importes en disputa, sin titularidad acreditada o con participaciones incompletas se marcan como **retenidos dentro del snapshot del cierre**. Su liberación posterior es un movimiento en `adjustments`.
- Nunca se redistribuyen entre otros titulares.

### 6.6 Redondeo, cierre y pagos

- **Redondeo:** pesos colombianos enteros, método del resto mayor. La suma de las partes es exactamente igual a la bolsa.
- **Corte:** último día calendario del mes, hora de Colombia.
- **Conciliación:** dentro de los 15 días hábiles siguientes.
- **Estados:** disponibles tras el cierre.
- **Trimestre:** suma de tres cierres congelados.
- **Pago:** dentro de los 30 días calendario siguientes al cierre trimestral, sujeto a documentos tributarios válidos. **Se registra como movimiento, no se ejecuta.**
- **Umbral:** 50.000 COP. Los saldos inferiores se acumulan sin caducidad mediante movimientos de traslado.
- **Correcciones:** siempre como movimientos auditables, nunca modificando un cierre.
- **Libros impresos:** las ventas complementarias (margen del 30 % para Chibalete según el Convenio) quedan fuera de este motor y del INS.

---

## 7. Plan de ejecución: siete fases, catorce unidades

F0-A y F0-B ya están cerradas y no cuentan entre las catorce unidades ejecutables.

| # | Unidad | Resultado único | Depende de | Gate verificable | Gates globales |
|---|---|---|---|---|---|
| 1 | **F0-C** | Plan y decisiones congelados en `docs/royalties/` | F0-A, F0-B | Documentos coherentes; ninguna decisión pendiente bloquea F3-A1 | — |
| 2 | **F3-A1** | Motor puro `computeEconomicEpisodes` con fixtures T1–T19. **Sin tocar el runtime.** | F0-C | Deduplicación multimodo, equivalencia entre los 6 modos, escucha prolongada y accesibilidad en verde; recálculo idéntico; diff limitado al módulo, sus pruebas y la CI | G3, G4 |
| 3 | **F1-A** | Titulares y editorial responsable operativos: `royalties.db` (migración inicial y `publishers`), CRUD de administración, `publisherId` arrastrado en el servidor, selector en SubirContenido y registro en `stores.py` | F0-C | CRUD probado; editar una ficha conserva `publisherId`; el RMW de contenido sigue en verde; **respaldo y restauración de `royalties.db` en verde**; diff de accesos, progreso y eventos = 0 | G1, G9 |
| 4 | **F2-A** | Derechos versionados **con efecto**: `rights_versions` (permisos, vigencia, alfa, matriz que suma 100 %, minutos esperados), predicado de elegibilidad y **denegación en el servidor de los usos no autorizados**, reutilizando los puntos de autorización existentes | F1-A | Un Acta real se puede representar; ningún dato llega a lectores; sin licencia no hay elegibilidad ni uso; **auditoría de impacto previa**: 0 cambios para obras sin régimen de derechos; prueba de regresión; autorización explícita antes de desplegar | G2 |
| 5 | **F2-B** | Clase comercial en las reglas: campo `commercialClass` arrastrado en `POST /api/access` y en el aprovisionamiento B2C; las reglas sin aprobación quedan `unclassified`, que no es elegible | F0-C | 100 % de las reglas con una clase explícita; **los accesos resueltos son idénticos antes y después**; las clases aprobadas se aplican con evidencia individual | G1, G5 |
| 6 | **F3-A2** | Ingesta económica en el servidor: acepta `econ_tick` y registra en `session_start` la regla que concedió el acceso y su clase en ese momento. Flag OFF. | F3-A1, F2-B | Con el flag apagado, sin ningún cambio en el producto; con el flag encendido, el 100 % de las sesiones atribuidas; métricas pedagógicas idénticas | G5 |
| 7 | **F3-A3** | Instrumentación de los 6 modos: hook `useEconomicTick`, sesión nativa en EPUB y señales de accesibilidad; despliegue y smoke en producción | F3-A2 | E2E por modo; VoiceOver y TalkBack; **una lectura continua cambiando de modo da 1 episodio en producción**; métricas pedagógicas idénticas | G3, G4 |
| 8 | **F3-B** | Vista previa reproducible de Q, R y S de cualquier periodo, con motivos de exclusión y anomalías señaladas | F3-A3, F2-A | El mismo periodo da el mismo resultado; lecturas gratuitas, de QA, legacy y `unclassified` = 0 en lo liquidable | G5 |
| 9 | **F4-A** | Liquidación como función pura (INS desde `period_inputs`, BRD/BGP/BLC, presencia, alfa, matriz, redondeo, traslado de BLC a BGP) | F3-B | Casos obligatorios: Q = 0, INS = 0, obra suspendida, titularidad en disputa, acceso gratuito, matriz de terceros; la suma concilia al peso | G6 |
| 10 | **F4-B** | Cierre inmutable con movimientos posteriores: `closes` (snapshot, hash, versión de `rule_set`), `adjustments` y consolidación trimestral | F4-A | `UPDATE` y `DELETE` sobre un cierre fallan; recalcular da el mismo hash; un pago o ajuste nunca altera el cierre; trimestre = suma de cierres congelados | G7 |
| 11 | **F5-A** | Panel de administración: Titulares, Obras y Derechos, Lecturas, Cierres y Movimientos | F4-B | Solo administradores; consultas correctas | G1 |
| 12 | **F5-B** | Estados por titular en CSV endurecido y en página HTML imprimible | F4-B | Cero datos personales de lectores; prueba de inyección de fórmulas; el estado concilia con el cierre | G8 |
| 13 | **F6-A** | Validación con cohorte QA controlada en producción | F5-A, F5-B | Conciliación del 100 % de los casos | G6, G10 |
| 14 | **F6-B** | Dos periodos naturales en sombra y decisión de habilitación | F6-A | Dos cierres sombra completos; sesgos y diferencias resueltos o tratados formalmente; P4, P9, P11 y P1 resueltos; aprobación administrativa, técnica y jurídica | G10 |

**Asignación de gates globales:**

| Gate | Unidades | Gate | Unidades |
|---|---|---|---|
| G1 | F1-A, F2-B, F5-A | G6 | F4-A, F6-A |
| G2 | F2-A | G7 | F4-B |
| G3 | F3-A1, F3-A3 | G8 | F5-B |
| G4 | F3-A1, F3-A3 | G9 | F1-A, y se reverifica en cada migración de `royalties.db` |
| G5 | F2-B, F3-A2, F3-B | G10 | F6-A, F6-B |

### 7.1 Dependencias y camino crítico

**Aristas de dependencia (lista completa):**

```
F0-C  → F3-A1, F1-A, F2-B
F1-A  → F2-A
F3-A1 → F3-A2
F2-B  → F3-A2
F3-A2 → F3-A3
F3-A3 → F3-B
F2-A  → F3-B
F3-B  → F4-A → F4-B
F4-B  → F5-A, F5-B
F5-A, F5-B → F6-A → F6-B
```

- **Camino crítico:** F0-C → F3-A1 → F3-A2 → F3-A3 → F3-B → F4-A → F4-B → F5 → F6-A → F6-B.
- **En paralelo con el camino crítico:** F1-A → F2-A, y F2-B. Ambos deben estar cerrados antes de F3-B y de F3-A2, respectivamente.
- **Orden recomendado de ejecución:** F3-A1 → F1-A → F2-B → F2-A → F3-A2 → F3-A3 → F3-B → F4-A → F4-B → F5-A ∥ F5-B → F6-A → F6-B.
- **Sin ciclos.** F2-B ya no depende de una decisión de negocio para terminarse: usa la clase `unclassified`, que no es elegible. Las aprobaciones de P9 se aplican cuando existan, sin efecto retroactivo sobre sesiones ya atribuidas.
- **Despliegues productivos por separado**, cada uno con su smoke en verde antes del siguiente: F1-A, F2-A, F2-B, F3-A2, F3-A3, y un despliegue conjunto de F4/F5 antes de F6-A. F3-A1 no se despliega.
- No se despliega una medición incompleta solo para adelantar el calendario sombra.

---

## 8. Reglas de ejecución

Cada prompt de unidad incluye:

1. el identificador y su objetivo único;
2. la línea base (rama, HEAD y estado);
3. los componentes autorizados;
4. los límites;
5. las validaciones;
6. el criterio GREEN;
7. las stop conditions;
8. la evidencia y el reporte;
9. el commit, si está autorizado.

**Reglas permanentes:**

- **Una unidad, un propósito.**
- **Diagnóstico antes de corrección.**
- **Sin refactorizaciones oportunistas.**
- **Sin cambios silenciosos de alcance.**
- **Sin despliegues acumulados.**
- **Ninguna unidad crea almacenes, jobs, dependencias ni entidades fuera de §3.** Si hace falta, la unidad se detiene y pide una decisión explícita.
- **Protección absoluta de `data/`, `data-critical/`, uploads y archivos editoriales.**
- **Respaldo y restauración de prueba antes de depender de un almacén.**
- **Sin pérdida de historial.**
- **Sin resultados económicos inventados.**
- **Ningún cambio de cumplimiento de derechos (P15) se despliega sin:** auditoría de impacto sobre el catálogo actual, clasificación de derechos, prueba de regresión y autorización explícita.

---

## 9. Gates globales

| Gate | Requisito |
|---|---|
| **G1 · Integridad** | Ningún contenido, archivo, progreso o acceso existente cambia indebidamente. |
| **G2 · Derechos** | Ninguna obra ni función se activa ni se mantiene disponible fuera de su autorización. |
| **G3 · Medición** | Cambiar de modo nunca duplica Q ni el tiempo activo. |
| **G4 · Equidad** | Los modos compatibles miden de forma comparable; los modos accesibles no quedan en desventaja. |
| **G5 · Procedencia** | Ninguna lectura gratuita, de prueba o sin clasificar genera remuneración oficial. |
| **G6 · Exactitud** | La liquidación concilia con la bolsa y con las participaciones. |
| **G7 · Inmutabilidad** | Los cierres no se sobrescriben; todo cambio posterior es un movimiento separado. |
| **G8 · Privacidad** | Sin datos personales de lectores en los estados ni en las exportaciones. |
| **G9 · Recuperación** | `royalties.db` está respaldado y se puede restaurar. |
| **G10 · Validación** | Pruebas sintéticas y dos periodos sombra completados antes de la causación oficial. |

Que pasen las pruebas unitarias no basta para declarar GREEN el proyecto en producción.

---

## 10. Deudas diferibles y exclusiones

Se registran, pero no entran en el camino crítico salvo que bloqueen un gate:

- portal de editoriales;
- integraciones bancarias, SIIGO y WooCommerce;
- automatización de pagos;
- liquidación de LU/Android, MOOK, podcast y vídeo;
- kit genérico de componentes de administración;
- campo histórico de modo en `progress.db` (todas las sesiones quedan en `'text'`);
- 2 referencias `parentId` huérfanas;
- documentación de despliegue desactualizada: `CLAUDE.md` y `deployment_guide.md` describen un bind mount de `server/` que ya no existe en producción;
- mejoras de analítica pedagógica ajenas a las regalías.

**No son diferibles** los defectos de privacidad, identidad económica, medición, cumplimiento de derechos, restauración o integridad que afecten al motor.

---

## 11. Condición de terminación

El proyecto queda funcionalmente terminado cuando:

- los titulares se administran correctamente;
- las obras tienen editorial y derechos verificables, y esos derechos se hacen cumplir;
- los 6 modos producen episodios comparables;
- Q, R y S se pueden reconstruir desde eventos válidos;
- los accesos gratuitos y de prueba no contaminan la liquidación;
- el administrador calcula, revisa y cierra periodos;
- los cierres son inmutables y los movimientos posteriores son trazables;
- los estados trimestrales están disponibles;
- el respaldo y la restauración están validados;
- se han completado dos periodos sombra.

**La causación oficial y los pagos** son una decisión administrativa y jurídica posterior a los gates; desplegar el software no los habilita.

---

## 12. Próxima unidad

**F3-A1 — Motor puro de episodios económicos.** Solo con un prompt de unidad explícito. F0-C no la inicia.
