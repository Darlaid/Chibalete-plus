# PLAN MAESTRO DE EJECUCIÓN — CHIBALETE+ V5

**Código:** `CHP-ROADMAP-2026-05`
**Fecha de corte:** 28 de agosto de 2026
**Estado:** plan rector alineado de consolidación hacia 100 %
**Sustituye operativamente:** `CHP-ROADMAP-2026-04`
**Avance global indicativo:** ≈67 %
**Autoridad de avance:** los gates demostrados de este documento, no el porcentaje

---

## 0. DECISIÓN EJECUTIVA DE V5

V4 definió correctamente las superficies del producto. Desde entonces ocurrió el cambio que V5 debe
reconocer:

Chibalete+ ya publicó su primera Experiencia real y demostró el vertical principal **Biblioteca →
MOOK Runtime → MOOK Studio**. También cerró las unidades previas de cubierta, objetivos, navegación
y paridad mínima de CI. El trabajo rector deja de ser *completar el primer MOOK* y pasa a **cerrar
las autoridades transversales** que todavía impiden declarar el sistema completo.

V5 no abre una arquitectura nueva. Congela lo que ya funciona, registra lo cerrado y reduce el
futuro a los gates todavía pendientes.

### Principio rector

**Cero sobreingeniería:** una unidad solo existe si cierra un gate, corrige un riesgo productivo
demostrado o aporta evidencia necesaria para liberar.

No se abre trabajo por elegancia, simetría, conveniencia futura o deuda ajena.

### Distinción vinculante

La **V5 del plan general** no debe confundirse con la **v5 editorial** de la Experience
«¿Estás aquí?»:

- `CHP-ROADMAP-2026-05` es el plan rector de Chibalete+;
- la Experience v5 es una versión publicada e inmutable del primer MOOK;
- esa v5 editorial fue una **modificación deliberada de contenido**, no un incidente ni una
  migración del plan.

---

## 1. DEFINICIÓN VINCULANTE DE 100 %

Chibalete+ estará completo al 100 % cuando pueda demostrar, en producción o en el entorno vinculante
correspondiente, que:

- la identidad de cada actor procede de una **sesión firmada**;
- institución, grupo, rol y acceso son **explícitos**;
- no existe cruce de tenant ni confianza residual en `x-user-id`;
- las interacciones pedagógicas relevantes producen **eventos canónicos**;
- las proyecciones se **reconstruyen** desde esos eventos;
- Aula Viva representa procesos, continuidad y mediación **sin ranking ni diagnóstico automático**;
- Biblioteca organiza contenido **sin duplicarlo ni conceder acceso**;
- una Experiencia puede **descubrirse, iniciarse, recorrerse, revisitarse, reanudarse, completarse y
  mediarse**;
- un editor puede **crear y publicar** una Experiencia sin JSON ni código;
- un mediador puede **revisar una producción** con su contexto y sin cruzar instituciones;
- LU conserva lectura, progreso y sincronización offline bajo **identidad canónica**;
- accesibilidad, privacidad, seguridad, gobernanza de IA, backups, CI y rollback están demostrados.

El 100 % **no** exige convertir Chibalete+ en LMS, CMS universal, motor de workflows o plataforma
analítica genérica.

---

## 2. ARQUITECTURA CONGELADA

Las cinco superficies visibles permanecen:

| Superficie | Responsabilidad única | No debe convertirse en |
|---|---|---|
| **Biblioteca** | Descubrir y organizar contenido y Experiencias | autorización, CMS o catálogo duplicado |
| **MOOK Runtime** | Recorrer una Experiencia como participante | LMS o reproductor paralelo de contenidos |
| **MOOK Studio** | Crear y publicar rutas versionadas | page builder o workflow engine |
| **Revisión** | Mediar producciones contextualizadas | gradebook o evaluación automática |
| **Aula Viva** | Comprender procesos y continuidad | ranking, diagnóstico o Runtime MOOK |

Debajo de todas ellas existe **una sola capa transversal**: identidad · autorización · catálogo
canónico · eventos y evidencia · accesibilidad · privacidad · despliegue y respaldo.

### Contratos que V5 no reabre

- una sola identidad;
- un solo catálogo canónico;
- una sola autorización;
- una sola cadena de eventos y evidencia;
- contenido MOOK mediante `contentId`, **nunca mediante copia**;
- nodos embebidos en `ExperienceVersion`;
- versiones publicadas **inmutables**;
- runs **fijados a una versión**;
- progreso de ruta distinto del progreso interno de un libro;
- secuencia lineal hasta que exista un caso real de branching;
- **frontera de avance decidida por el servidor**;
- navegación de revisión como estado visual **no persistente**;
- LU como extensión offline, no como ecosistema paralelo.

---

## 3. FOTO DE CORTE V5

### 3.1 Estado general

| Fase / hito | Estado V5 | Lectura correcta |
|---|---|---|
| Fase 0 — Fundamentos | 🟢 100 % | Cerrada; no reabrir salvo P0 |
| M1 — Identidad, acceso y aislamiento | 🟡 ≈62 % | Base operativa; cierre canónico y drain pendientes |
| M2 — Evidencia canónica | 🟡 ≈50 % | Infraestructura existente; integración MOOK incompleta |
| M3 — Aula Viva | 🟡 ≈45 % | Superficie existente; faltan proyecciones integradas |
| M4 — Ecosistema pedagógico | 🟡 ≈84 % | Primer MOOK completo; gates sistémicos aún abiertos |
| M5 — Release y compliance | 🟡 ≈63 % | Paridad mínima de CI cerrada; WCAG y evidence pack pendientes |

Los porcentajes son **señales de planificación**, no autorizaciones de release. Un estado solo cambia
por **evidencia de gate**. El cierre de unidades locales no obliga a alterar el porcentaje global si
no cierra uno de los grandes gates M1–M5.

### 3.2 Lo cerrado y no reabrible

**Fundamentos y operación**

- Fase 0 cerrada;
- despliegues escalonados y reversibles demostrados;
- backups estructurados y de uploads dentro de RPO;
- `restic check` y restore rehearsal demostrados;
- protección explícita de stores y recursos persistentes;
- corrección del **RMW concurrente** del content store;
- observabilidad productiva por réplica y release;
- construcción de la **imagen real del frontend** como gate bloqueante de CI;
- suites MOOK incorporadas a CI;
- validaciones multiplataforma de EOL estabilizadas.

**Biblioteca**

- contrato arquitectónico GREEN;
- UX principal implementada;
- capa Editorial productiva;
- pestaña Experiencias productiva;
- Biblioteca **referencia** contenido y **no concede acceso**;
- una sola copia canónica de cada recurso;
- origen Biblioteca preservado cuando una lectura no procede de un MOOK.

**Experiencias/MOOK**

- contrato y dirección visual congelados;
- Runtime funcional;
- Studio funcional sin JSON;
- preview sobre el Runtime real;
- versionado DRAFT/PUBLISHED demostrado;
- publicación inmutable demostrada;
- múltiples objetivos editables sin colapso silencioso;
- guardar metadata **no** genera una versión pedagógica;
- contenido `standalone:false` soportado;
- referencias a contenido canónico demostradas;
- actividades privadas demostradas;
- **primera Experiencia real publicada: «¿Estás aquí?»**.

#### Primer MOOK productivo

| Evidencia | Estado al corte |
|---|---|
| Experience | `exp-1787709803882-9ym4tt`, publicada |
| Versiones | 5 publicadas e inmutables |
| Vigente | v5 `expv-1787884365439-msj4ub` |
| Objetivos vigentes | 3, completos y ordenados |
| Estructura | 7 módulos / 56 nodos |
| Distribución | 16 AUDIO / 25 READING / 15 ACTIVITY |
| Privacidad | 15/15 actividades privadas |
| Recursos | 41/41 referencias canónicas resueltas |
| Libro | 10/10 extractos con páginas y `parentId` |
| Audio | 25/25 manifests completos |
| QA de borrador | 56/56 nodos montan |
| Run / evidencias | 1 / 0 |
| Run existente | pineado a v1; progreso 3/42 |
| Requeridos v1 | 42 de 56 |
| Requeridos v5 | 48 de 56 |
| Audiencia | liberación general autorizada y ejecutada |

#### Cronología editorial preservada

| Versión | Objetivos | Lectura histórica |
|---|---|---|
| v1 | 3 | original correcta; versión del run existente |
| v2 | 1 | incidente de colapso de objetivos |
| v3 | 1 | publicación intermedia sin daño productivo vigente |
| v4 | 3 | correctiva de objetivos |
| **v5** | 3 | **edición editorial deliberada y vigente** |

Ninguna versión publicada fue mutada ni eliminada. La v5 retiró un prefijo redundante en **10**
actividades —quedan 4 que aún lo conservan— y convirtió **seis** nodos de opcionales a obligatorios.
No cambió el número ni los tipos de nodos, la privacidad o los objetivos.

Este MOOK **no vuelve a ser «piloto pendiente»**. Cualquier cambio posterior requiere una necesidad
editorial o un defecto demostrado.

#### Navegación del MOOK

- **Atrás** permite revisar nodos recorridos hasta el inicio disponible;
- **Adelantar** devuelve al participante hasta su frontera canónica;
- la navegación cruza módulos **sin abrir nodos bloqueados**;
- revisar un nodo completado es **read-only** y se identifica como «Revisando»;
- la navegación **no persiste**, no altera el historial del navegador y no cambia el progreso;
- recargar devuelve al punto canónico;
- el servidor sigue siendo la **única autoridad** de frontera y desbloqueo.

#### Retorno contextual desde las lecturas

- abrir una lectura desde el MOOK conserva `experienceId` y `nodeId` como origen validable;
- la ficha del contenido regresa al MOOK y al mismo nodo;
- los modos de lectura activos ofrecen retorno directo al mismo nodo;
- el retorno expande, desplaza y **enfoca** el nodo exacto;
- un nodo completado vuelve como «Revisando»; la frontera vuelve como «Estás aquí»;
- parámetros inexistentes o bloqueados **caen en la frontera** y nunca desbloquean contenido;
- el origen Biblioteca conserva su retorno normal y **no** muestra controles MOOK;
- el retorno contextual es **de un solo uso** y limpia la URL;
- no se usa una URL arbitraria, `referrer`, `localStorage` ni persistencia nueva.

#### TTS y recuperación de contenido

- carrera de callbacks terminales corregida y desplegada;
- 14 estados heredados reconciliados **sin regenerar audio**;
- cero cambios editoriales durante la reconciliación;
- 41/41 recursos recuperados;
- deuda del retry atascado registrada como **no bloqueante**.

#### Cubierta propia de Experience

- endpoint dedicado y autenticado para administradores;
- fuente de hasta 50 MiB;
- validación de formato, dimensiones, ratio y píxeles;
- optimización cliente determinista a 1600 × 900;
- WebP con fallback JPEG;
- payload servido limitado a 5 MiB;
- nombre único y **cero overwrite**;
- hero 16:9 en desktop y móvil;
- cubierta definitiva «¿Estás aquí?» servida en producción;
- `book.portada_url` intacta;
- backup y restore rehearsal posteriores demostrados.

La cubierta es **metadata** de la Experience, no contenido pedagógico. Este endpoint acotado no
contradice la prohibición de crear un segundo uploader de contenido MOOK.

#### Revisión/Mediación ya demostrada

El flujo funcional genérico ya existe y **no debe reconstruirse**:

```text
participante → entrega → mediador → revisión → ajustes → reenvío → confirmación
```

El cierre **sistémico** permanece pendiente de identidad canónica, contexto institucional,
aislamiento negativo, eventos y Aula Viva.

#### Android/LU demostrado y límite actual

Está demostrado en QA: sesión cookie-only en 0.9.0 · persistencia y upgrade no destructivo · libro y
progreso preservados · lectura offline · cola offline · sincronización sin duplicación · UA
versionado · distribución canaria · observabilidad segmentada.

Esto **no equivale todavía a migración operacional cerrada**. Existe una discrepancia que M1 debe
resolver sin suposiciones:

```text
lu_config.json anuncia 0.8.0
APK 0.9.0 existe y fue probado
```

Existencia, publicación, distribución y tráfico real son **hechos distintos**. No crear más
arquitectura Android; medir y cerrar el drain mediante las señales existentes.

### 3.3 Cierres realizados antes de iniciar M1

| Unidad | Veredicto | Evidencia principal |
|---|---|---|
| Cubierta y objetivos | `GREEN-MOOK-OBJECTIVES-AND-COVER-PRODUCTION` | `e9a8f37`; front `obj-ab380ed` |
| Navegación de revisión | `GREEN-MOOK-RUNTIME-REVISIT-NAV-PRODUCTION` | `356f2fe`; cierre `609aac5` |
| Gates CI de MOOK | `GREEN-CI-MOOK-RELEASE-GATES` | `5f6fc64` + doc `1273927` |
| Retorno contextual | `GREEN-MOOK-CONTEXTUAL-RETURN-PRODUCTION` | `162c3e6`; cierre `8665a26` + `33ce34a` |

Baseline productivo registrado al cierre contextual:

```text
APIs:      chibalete/api:e70c0f1 ×2
Frontend:  chibalete/front:ret-162c3e6
Servicios: 4 healthy
```

Estos cierres **no se repiten** dentro de V5. Sus pruebas permanecen como regresión y sus contratos
como invariantes.

---

## 4. ESTADO PENDIENTE REAL

### 4.1 M1 — Identidad, acceso y aislamiento

Este es el **principal bloqueador transversal**.

Pendiente:

- reconstruir con evidencia el estado real de versiones LU en campo;
- resolver la semántica de `lu_config.json` frente al APK 0.9.0;
- completar migración de campo Android/LU;
- observar el drain exigido por el contrato, **al menos 48 horas hábiles** cuando corresponda;
- activar **ENFORCE** de forma controlada;
- hacer canónica la sesión como autoridad de lectura y escritura;
- eliminar confianza residual en `x-user-id`;
- consolidar memberships explícitas;
- definir acceso real por grupos/entitlements;
- retirar `ACCESS_FALLBACK_MODE=open` **después** de poblar reglas explícitas;
- demostrar aislamiento negativo entre instituciones;
- retirar compatibilidad legacy **solo después del GREEN**.

**Gate M1**

```text
SESSION = SIGNED
IDENTITY READ/WRITE AUTHORITY = CANONICAL
MEMBERSHIPS = EXPLICIT
ACCESS = EXPLICIT
TENANT ISOLATION = PROVEN
x-user-id = NOT TRUSTED
ANDROID/LU DRAIN = GREEN
```

### 4.2 M2 — Cadena canónica de evidencia

MOOK **no necesita otra base de datos**. Necesita integrarse al pipeline existente.

Pendiente mínimo:

- registrar el conjunto mínimo de eventos MOOK en `eventRegistry`;
- emitirlos desde sesión canónica;
- persistirlos en `events.db`;
- materializar proyecciones reconstruibles en `insights.db`;
- reconciliar conteos fuente/proyección;
- documentar retención, privacidad y límites.

Eventos mínimos, sujetos al vocabulario existente: Experience iniciada · nodo requerido completado ·
Experience completada · evidencia enviada · revisión realizada.

**No** registrar cada clic, scroll, navegación de revisión o segundo de reproducción salvo una
necesidad pedagógica demostrada.

**Gate M2** — una secuencia real debe poder demostrarse como:

```text
acción → evento canónico → events.db → materialización → insights.db → API
```

La proyección debe **reconstruirse desde cero** y reconciliar con la fuente.

### 4.3 M3 — Aula Viva

Pendiente:

- consumir las proyecciones canónicas de M2;
- mostrar Experiencias iniciadas y completadas;
- mostrar continuidad y nodos requeridos recorridos;
- mostrar evidencia pendiente/revisada cuando exista;
- mostrar datos faltantes **sin inventar conclusiones**;
- probar aislamiento de mediadores e instituciones.

**No** añadir ranking, score, diagnóstico automático, recomendación IA ni evaluación de competencia.

**Gate M3** — un mediador y un administrador deben comprender procesos reales desde datos
reconstruibles, con alcance institucional correcto y lenguaje no evaluativo.

### 4.4 M4 — Ecosistema pedagógico completo

El primer MOOK está completo **como producto**, pero M4 global permanece abierto por:

- Biblioteca Institucional y Personal bloqueadas por M1;
- Review pendiente de **cierre sistémico**, no de reconstrucción funcional;
- eventos MOOK y Aula Viva pendientes;
- prueba integral de aislamiento pendiente;
- accesibilidad global pendiente;
- cierre operacional LU pendiente.

**Review sistémico pendiente** — el flujo funcional existente debe integrarse con: participante
autenticado por sesión canónica · institución y grupo explícitos · Experience, versión, nodo y
consigna · producción y estado · aislamiento positivo y negativo · eventos canónicos y proyección en
Aula Viva.

**No** crear otro Review, rúbricas universales, notas ni automatización de feedback.

**Biblioteca pendiente** — después de M1: activar capa Institucional con escritura segura · activar
capa Personal con identidad de sesión · probar intersección de referencia, publicación, membership y
entitlement · confirmar que ninguna capa duplica contenido.

### 4.5 M5 — Accesibilidad, seguridad y release

La paridad mínima de CI ya está cerrada. Pendiente real:

- auditoría **WCAG 2.2 AA** sobre las cinco superficies;
- correcciones **solo** de criterios fallidos;
- pruebas de teclado, foco, zoom/reflow, contraste y errores;
- privacidad y retención de eventos/evidencias;
- gobernanza de Leo/IA y límites visibles;
- evidencia de aislamiento y autorización;
- **evidence pack reproducible** de release;
- conservar activos los gates bloqueantes de CI ya demostrados.

No se requiere reescribir toda la interfaz, crear un design system nuevo ni perseguir cero warnings
globales.

---

## 5. DEUDAS CONOCIDAS Y TRATAMIENTO

### 5.1 Deudas abiertas

| Deuda | Severidad V5 | Tratamiento |
|---|---|---|
| `CHP-TTS-RETRY-STUCK-STATE-DEADLOCK-01` | P2 no bloqueante | Corregir antes de necesitar retry de un estado atascado o si reaparece |
| `CHP-MOOK-RUN-RESUME-WRITE-ON-READ-01` | P2 no bloqueante | Evitar la escritura al montar/reanudar solo cuando exista unidad propia; no mezclar con M1 |
| `sessionIdentityIntegration` flaky | P2 | Estabilizar la causa demostrada; un reintento no sustituye el fix |
| `gitleaks-history` / `trivy-image` heredados | evaluar | Separar hallazgo real de baseline; no reescribir historia ni limpiar masivamente |
| `ACCESS_FALLBACK_MODE=open` | P1 | Cerrar en M1 con reglas explícitas y rollback |
| 20/20 grupos sin `availableContentIds` | P1 | Migrar dentro del cierre de acceso, no mediante una plataforma nueva |

Una deuda **no se convierte en unidad activa por estar documentada**. Debe bloquear un gate o elevar
un riesgo demostrado.

### 5.2 Deudas cerradas

| Deuda | Cierre |
|---|---|
| `CHP-CI-FRONT-IMAGE-BUILD-COVERAGE-01` | imagen real `Dockerfile.front` construida en gate bloqueante |
| `CHP-TEST-MOOKREVIEW-EOL-ASSERTION-01` | aserción alineada al invariante y validada con LF/CRLF/CR |
| `test:mook` fuera de CI | suite integrada como gate bloqueante |

Cierre común: `GREEN-CI-MOOK-RELEASE-GATES`, código `5f6fc64`, documentación `1273927`.

---

## 6. SECUENCIA OPERATIVA V5

Se mantiene un **máximo de tres carriles**. Un carril no autoriza mutaciones simultáneas ni mezcla de
objetivos.

### Carril A — Identidad y acceso productivo

Orden vinculante:

1. **`CHP-IDENTITY-FIELD-DRAIN-CLOSE-01`** — determinar versión LU real, completar campo, medir drain
   y conservar evidencia.
2. **`CHP-IDENTITY-CONTROLLED-ENFORCE-01`** — canary por réplica, observación, rollback probado y
   luego ambas réplicas.
3. **`CHP-MEMBERSHIP-ACCESS-CANONICAL-01`** — consolidar institución, grupo, rol y reglas explícitas
   usando stores y contratos existentes.
4. **`CHP-ACCESS-FALLBACK-CLOSE-01`** — poblar acceso, probar cuentas reales y retirar `open`
   controladamente.
5. **`CHP-TENANT-ISOLATION-GATE-01`** — pruebas positivas y negativas sobre lector, mediador y
   administrador.
6. **`CHP-IDENTITY-LEGACY-CLEANUP-01`** — solo después del GREEN; retirar compatibilidad sin tráfico.

**Límites del carril A**

- no crear otro identity service;
- no crear otro entitlement service;
- no cambiar simultáneamente sesión, grupos y catálogo en un deploy;
- no borrar usuarios deshabilitados como parte del cierre;
- no migrar stores fuera del mecanismo canónico existente sin ADR y necesidad demostrada;
- no declarar drain por ausencia de evidencia;
- no confundir APK existente con adopción en campo.

### Carril B — Evidencia, mediación y Aula Viva

Puede preparar código local en paralelo, pero **las mutaciones productivas dependientes de identidad
esperan M1**.

Orden:

1. **`CHP-MOOK-CANONICAL-EVENTS-01`** — cinco eventos máximos, registry existente y sesión canónica.
2. **`CHP-MOOK-INSIGHTS-MATERIALIZER-01`** — proyecciones mínimas reconstruibles y reconciliación.
3. **`CHP-MOOK-REVIEW-IDENTITY-INTEGRATION-01`** — integrar el Review existente con contexto canónico
   y aislamiento.
4. **`CHP-AULA-VIVA-MOOK-INTEGRATION-01`** — solo indicadores necesarios para continuidad, evidencia
   y revisión.
5. **`CHP-LIBRARY-INSTITUTIONAL-PERSONAL-01`** — activar contratos ya definidos después de M1.
6. **`CHP-PHASE4-INTEGRATION-GATE-01`** — Runtime + Studio + Review + Biblioteca + LU + eventos +
   accesibilidad.

**Límites del carril B**

- no crear `mook_events.db`, `mook_analytics.db` ni `mook_stats.db`;
- no crear otro catálogo, uploader de contenido o sistema de permisos;
- no instrumentar telemetría exhaustiva;
- no registrar navegación de revisión como evidencia pedagógica;
- no abrir un segundo MOOK como requisito técnico;
- no crear formatos de producción adicionales antes de una necesidad editorial real;
- no reconstruir Review;
- no rediseñar Runtime o Studio ya aprobados salvo defecto o criterio WCAG fallido.

### Carril C — Compliance y evidencia de release

La paridad mínima de CI está cerrada y pasa a ser **invariante**. El orden pendiente es:

1. **`CHP-WCAG-FIVE-SURFACES-01`** — auditoría y fixes sobre Biblioteca, Runtime, Studio, Review y
   Aula Viva.
2. **`CHP-PRIVACY-SECURITY-AI-EVIDENCE-01`** — evidencia mínima de acceso, retención, transparencia y
   revisión humana.
3. **`CHP-RELEASE-EVIDENCE-PACK-01`** — gates, backups, restores, rollback, límites y excepciones
   vigentes.

**Límites del carril C**

- no perseguir cero warnings globales;
- no regenerar baselines para ocultar regresiones;
- no arreglar todo el historial de scanners en una unidad;
- no crear una plataforma de compliance;
- no declarar WCAG por inspección estructural sin QA visual y de teclado;
- no degradar los gates CI ya cerrados a `continue-on-error`.

---

## 7. ORDEN INMEDIATO DESDE ESTE CORTE

1. Ejecutar **`CHP-IDENTITY-FIELD-DRAIN-CLOSE-01A`** como preflight **read-only**.
2. Resolver la semántica `lu_config.json` 0.8.0 frente a APK 0.9.0 y medir campo con señales
   existentes.
3. Según evidencia: cerrar drain, abrir ventana de observación o declarar estado incompleto.
4. Solo con drain GREEN, ejecutar enforcement controlado.
5. Completar memberships, acceso explícito, cierre de fallback y aislamiento.
6. Con M1 GREEN, integrar eventos MOOK al pipeline existente.
7. Materializar insights y conectarlos a Aula Viva.
8. Cerrar integración sistémica de Review y Biblioteca Institucional/Personal.
9. Ejecutar gate integrado de Fase 4.
10. Cerrar WCAG, compliance y evidence pack de M5.

**No se abre otro gran frente entre esos pasos.** La deuda
`CHP-MOOK-RUN-RESUME-WRITE-ON-READ-01` no interrumpe este orden.

---

## 8. GATES DE SALIDA ACTUALIZADOS

### Gate de MOOK Runtime

GREEN global cuando un participante autorizado puede:

```text
descubrir → abrir landing → iniciar → recorrer → revisitar
→ abrir contenido → regresar al nodo exacto → salir → reanudar
→ producir → completar
```

La frontera debe seguir siendo autoridad del servidor; revisar y regresar **no pueden escribir
progreso**. Las acciones requeridas deben quedar ligadas a sesión, versión y eventos canónicos.

El primer MOOK demuestra la experiencia visual y funcional. **M1 y M2 completan el gate sistémico.**

### Gate de MOOK Studio

Funcionalmente GREEN cuando un administrador puede:

```text
crear → configurar → editar varios objetivos → seleccionar contenido
→ ordenar → preview → guardar draft → publicar
```

Sin JSON ni código, con versiones inmutables, metadata separada de contenido pedagógico y sin
duplicar recursos.

**Estado V5:** GREEN funcional; compliance e integración se cierran en gates transversales.

### Gate de Review

GREEN sistémico cuando un mediador autorizado puede:

```text
ver pendiente → abrir producción y contexto → devolver feedback
→ recibir reenvío → confirmar revisión
```

Sin cruzar instituciones y sin delegar autoridad pedagógica en Leo. El flujo funcional ya existe;
faltan identidad, aislamiento, eventos y proyección.

### Gate de Biblioteca

GREEN global cuando Editorial, Institucional y Personal operan como **referencias** sobre el catálogo
canónico y la visibilidad resulta de:

```text
reference ∩ publication_state ∩ membership/role ∩ entitlement
```

### Gate de Fase 4

GREEN cuando: Biblioteca completa sus tres capas · Runtime y Studio conservan su GREEN · Review
alcanza GREEN sistémico · versionado y referencias canónicas siguen demostrados · eventos pasan por
la cadena canónica · LU cierra identidad y sync · accesibilidad y aislamiento están demostrados.

### Gate de M5 / 100 %

GREEN cuando M1–M4 están cerrados y existe **evidence pack reproducible** de: seguridad y privacidad
· WCAG 2.2 AA · gobernanza IA · backups y restores · rollback · CI equivalente al artefacto
productivo · límites conocidos y deudas aceptadas.

---

## 9. CONTRATO OPERATIVO DE CADA UNIDAD

Toda unidad V5 debe contener: un objetivo único · baseline read-only · dependencias y gate que
desbloquea · **allowlist explícita de escrituras** · stop conditions · backup previo cuando haya
persistencia · despliegue escalonado y rollback cuando aplique · verificación independiente · prueba
de ausencia de daño · cierre documental y siguiente paso.

### Reglas de ejecución

- máximo tres carriles activos;
- máximo **una clase de mutación productiva** por unidad;
- un resultado ambiguo nunca se repite a ciegas;
- YELLOW abre forense, no una reimplementación completa;
- una corrección local no autoriza deploy;
- un deploy no autoriza migración de datos;
- un GREEN técnico no sustituye un gate humano editorial o de audiencia;
- ningún trabajo toca deudas ajenas salvo bloqueo demostrado;
- stores, uploads y corpus editorial **nunca** se eliminan, mueven, truncan ni limpian como efecto
  lateral;
- commits documentales usan **rutas explícitas**;
- activos temporales, bridges, logs, stores y corpus **no entran al repositorio**.

### Regla para hallazgos durante una unidad

Si aparece un cambio ajeno al objetivo:

1. determinar si es previo o causado por la unidad;
2. verificar si es legítimo, dañino o ambiguo;
3. detener escrituras si rompe un invariante;
4. **no revertir historia legítima** para «limpiar» el estado;
5. registrar deuda solo si existe una condición pendiente real.

---

## 10. LISTA VINCULANTE DE «NO CONSTRUIR»

V5 mantiene y refuerza la prohibición de crear ahora:

LMS · SCORM o xAPI paralelo · gradebook o sistema de notas · badges o credenciales complejas ·
branching engine · adaptive learning · recommendation AI · graph builder · workflow engine · schema
builder universal · quiz engine completo · rúbricas universales · catálogo MOOK paralelo · uploader
MOOK de contenido · telemetría o analytics MOOK paralelos · identidad o permisos MOOK independientes
· CMS separado para Experiencias · garbage collection automático de recursos · infraestructura canary
por grupos para un solo lanzamiento · nueva base de datos por conveniencia · refactor transversal sin
fallo o gate que lo justifique · segunda Experiencia como prueba artificial de arquitectura · nuevo
framework de CI para sustituir gates ya funcionales · observabilidad nueva si las señales existentes
responden la pregunta.

Una **segunda Experiencia** se crea cuando exista una **decisión editorial**, no para justificar el
sistema.

---

## 11. DECISIONES QUE V5 DEJA CERRADAS

- «¿Estás aquí?» está publicado y **no se recrea**.
- Sus versiones v1–v5 permanecen **inmutables**; v5 es vigente.
- Una nueva versión solo responde a una edición editorial real o a una corrección explícita mediante
  vías canónicas.
- La **v5 editorial es legítima y no debe revertirse**.
- El run existente permanece **pineado a v1** y conserva su denominador de **42 requeridos**.
- La cubierta propia es 16:9 y se gestiona mediante el uploader acotado ya desplegado.
- Los originales de cubierta **no se modifican**; el Studio deriva el activo servido.
- Los contenidos de Experiencia siguen entrando por **Subir** y el catálogo canónico.
- Las actividades privadas **no** crean galería ni evidencia pública.
- **Preview no crea runs ni evidencias.**
- Publicar **no** crea segmentación; el acceso se resuelve en M1, no dentro de MOOK.
- Atrás/Adelantar y el retorno contextual son **navegación**, no evidencia ni progreso.
- TTS **no** se regenera para corregir metadata terminal.
- Las tres deudas de CI previas están cerradas y no se reabren sin regresión demostrada.
- Las deudas abiertas **no se trabajan por inercia**.

---

## 12. PRÓXIMO PUNTO DE EJECUCIÓN Y DECISIÓN HUMANA

No queda ningún cierre previo del primer MOOK que bloquee el inicio operativo de V5.

La siguiente unidad es:

```text
CHP-IDENTITY-FIELD-DRAIN-CLOSE-01A
PREFLIGHT READ-ONLY
```

Debe determinar con evidencia: qué significa 0.8.0 en `lu_config.json` · cuál APK es distribución
canónica · qué versión tiene tráfico real · si el campo heredado continúa en uso · si existe una
ventana suficiente para cerrar el drain.

La decisión humana posterior depende del veredicto:

- **GREEN:** autorizar enforcement controlado;
- **AMBER:** autorizar únicamente la ventana mínima de observación;
- **RED:** autorizar la unidad correctiva mínima, sin ampliar arquitectura.

Esta autorización **no incluye**: abrir un segundo MOOK · trabajar la deuda de resume · crear nuevos
tipos de producción · rediseñar Aula Viva · construir segmentación nueva · resolver todo el historial
de seguridad o CI.

---

## 13. REGLA FINAL V5

**Conservar lo que ya funciona. Cerrar primero las autoridades transversales. Integrar mediante
contratos existentes. Construir una sola vez y solo lo que el siguiente gate pueda demostrar.**

La ruta hacia 100 % ya no necesita más superficie de producto. Necesita terminar identidad,
evidencia, mediación, observabilidad y compliance sin convertir cada cierre en una plataforma nueva.

---

## 14. NOTA DE VERIFICACIÓN DE CIFRAS AL CORTE

Las cifras del §3.2 se comprobaron contra producción el 2026-08-28 (store `mook_db.json` del VPS,
lectura sin escritura). Resultado: **5 versiones publicadas**, vigente `expv-1787884365439-msj4ub`
con 3 objetivos, 7 módulos, 56 nodos, **16 AUDIO / 25 READING / 15 ACTIVITY**, 15/15 actividades
privadas, **48 requeridos** en v5 y **42** en v1, run único `active` pineado a v1 con **3/42** y 0
evidencias; 4 servicios healthy sobre `api:e70c0f1` ×2 y `front:ret-162c3e6`.

Dos cifras del borrador se corrigieron con esa medición, para que el plan no arrastre un número
inexacto:

- el prefijo «Ve a tu Bitácora y:» se retiró en **10** actividades, no en 12 (`n-b00`…`n-b05`,
  `n-b07`, `n-b06-dia-1/2/3`); **4 lo conservan** (`n-b06-dia-4`…`dia-7`);
- el cierre del retorno contextual se identifica por **tres** referencias: código `162c3e6`,
  documentación `8665a26` y confirmación editorial `33ce34a`.

Lo demás del borrador se transcribe sin cambios.
