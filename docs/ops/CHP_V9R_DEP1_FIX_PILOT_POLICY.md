# CHP V9-R · DEP-1 — Corrección bloqueante: continuidad de pilotos y aceptación de la Política 001

Estado: **corregido en código, NO desplegado.** Producción no se tocó. Candidata: `v9r-acedba8` (APP `acedba8`). Sustituye a `v9r-a3c16e6` y a las intermedias `v9r-f5b9281` y `v9r-07126b5` para API y front; conector WEB (`6dc8aed`) y LU 0.10.0 (`41d17bf`) no cambian.

DEP-1 se detuvo en el preflight (2026-11-25) por dos defectos de la candidata frente a la decisión de Dirección sobre los pilotos (21 mediadores y 224 lectores en tres espacios; sin regularización retrospectiva; sin autorizaciones fabricadas).

## 1. Los dos defectos y su corrección

| | Causa | Corrección |
|---|---|---|
| 1 | V9 exige C005 del mediador y A2 del lector para la nómina, el resumen y el seguimiento individual. Los pilotos no tienen ninguna en el registro, y no pueden inventarse: con el registro vacío los 21 mediadores perdían todo salvo el tablero agregado. | Tipo nuevo en el **mismo** registro de decisiones: `PILOT_LEGACY`. No es un consentimiento. Constata que una **pertenencia** (grupo + cuenta) existía en el corte, y conserva solo las funciones históricas del §2, dentro de ese grupo. |
| 2 | La activación registraba términos (T, 002), autorizaciones (A0–A5, 004) y compromiso (C005, 005). La Política 001 solo aparecía enlazada: su aceptación no dejaba constancia propia. | Tipo nuevo `P`: aceptación expresa de la Política 001, con su versión, en la activación. Casilla propia, sin premarcar. Ninguna cuenta nueva queda activa sin ella, tampoco por la vía administrativa. |

Archivos: `server/privacy/a2Registry.mjs`, `server/privacy/acceptance.mjs`, `server/privacy/suppression.mjs`, `server/aulaViva/scopeAccess.mjs`, `server/server.js`, `pages/ActivarCuenta.tsx`, `ops/a2/pilot_legacy_pack.mjs` (nuevo) y sus pruebas. No hay un segundo motor de permisos: las puertas existentes (`decisionGate`, `a2Gate`, `individualDisclosure`) consultan la condición en el mismo punto donde consultaban C005 y A2.

## 2. `PILOT_LEGACY`: qué es y qué no

**Forma en el registro.** Una línea por pertenencia del corte y una línea de **sello**:

- sujeto = grupo + cuenta (nunca la cuenta sola); función `pilot_mediator`, `pilot_reader` o `pilot_reader_followup`;
- verificación `inventory`, medio `admin_record`, versión `PILOT@1.0`: una forma que ninguna decisión de consentimiento puede tener, y que ningún otro tipo puede usar. `effective('A1'|'A2'|'A3'|'A5'|'C005'|'T'|'P')` sigue siendo falso para una cuenta de piloto;
- nada rige hasta que existe el sello. **Desde el sello no se admite ni se lee ninguna concesión nueva** (tampoco otro sello): ninguna cuenta, curso o institución posterior puede obtener la condición, ni siquiera por el operador;
- admite solo `granted` y `revoked`. Revocar una pertenencia la cierra para siempre; revocar el sello termina el régimen entero; la vigencia opcional lo hace caducar solo.

**Condiciones en cada petición** (se decide con los grupos de hoy, en todas las réplicas, sin caché):

- el mediador sigue mediando ese grupo y el lector sigue siendo miembro de ese grupo;
- las dos pertenencias tienen su línea vigente y el sello está vigente;
- una negativa o revocación expresa prevalece siempre: A2 negada o revocada del lector, C005 negado o revocado del mediador.

Un lector trasladado no lleva la condición a su curso nuevo; una mediadora sustituida la pierde y su sustituta no la hereda.

**Solo funciones históricas.** La puerta de A2 (`a2Gate`) **no** admite la condición de piloto por defecto. Solo la admite la función que la pide de forma expresa (`pilot: true`), y solo la piden las que el mediador de un curso ya tenía en producción. Una función nueva que reutilice el criterio de A2 no hereda nada.

### 2.1 Qué es «histórico»: cotejo con producción

Cotejado contra el código de producción (`secsess-642820d`) y contra su estado medido el 2026-11-25 (`/api/health/analytics`): materializador encendido con 1 248 señales, 52 perfiles y 33 agregados de cohorte; motor de intervenciones, agregados periódicos y vectores **apagados, con 0 filas** (0 recomendaciones, 0 banderas de riesgo, 0 intervenciones registradas, 0 vectores).

| Función | En producción para el mediador del curso | Con `PILOT_LEGACY` |
|---|---|---|
| Nómina del grupo; lista de grupos y de usuarios | Sí | **Se conserva**, limitada a los lectores del corte |
| Resumen del grupo (`analytics-summary`) | Sí | **Se conserva**; filas individuales solo con seguimiento |
| Progreso de lectura (`/api/progress/user`, `/item`, `/api/reading-progress`) | Sí | **Se conserva** (seguimiento) |
| Estado del lector (`/api/students/:id/status`) | Sí | **Se conserva** (seguimiento) |
| Tablero e informe del curso (`/api/metrics/course`, `/api/reports/course`) | **No**: producción responde 403 `course_detail_restricted` a quien media (decisión de Dirección del 2026-11-15) | **No**: exigen A2 + C005. La intermedia `v9r-07126b5` los abría por error; corregido en `acedba8` antes de cualquier cambio productivo |
| Intervenciones (`/api/interventions…`) | Sí | **Se conserva** (seguimiento) |
| Revisión de entregas y exportación de entregas | Sí | **Se conserva** (seguimiento) |
| Candidatos del grupo | Sí | **No**: nombra a personas ajenas a la nómina del corte. Exige C005 |
| Diagnóstico del grupo | Sí | **No**: enumera canales y miembros sin distinguir el corte. Exige C005 |
| Leo del lector | Sí | **No**: exige A3 del lector |
| Leo del mediador (resumen, historial por obra, activación) | Sí | **No**: son evidencias del tratamiento con IA. Exige A2 + C005 (y supone A3) |
| Perfil lector y línea de tiempo de señales (`/api/aula-viva/…/profile`, `/timeline`) | Sí, con datos (perfiles y señales) | **No**: V9 las sirve desde el motor de contexto junto con los indicadores nuevos; no se pueden separar con un cambio mínimo. Exigen A2 + C005 |
| Agregados de cohorte del grupo (`/api/aula-viva/cohorts/group/…`) | Sí, con datos (33 agregados) | **No** por lector; el agregado sigue las reglas de agregados, sin la condición de piloto |
| Riesgo, recomendaciones, cola de atención, impacto, resultados, aprendizajes, cohortes tipadas, trayectorias, patrones, vector de rasgos | Rutas presentes, **sin datos** (motores apagados) | **No**: para un piloto serían tratamiento nuevo. Exigen A2 + C005 |
| Indicadores contextuales por lector (`/api/aula-viva/context/…`) | No existe | **No**: función nueva de V9. Exige A2 + C005 |
| Progreso de XP del lector | Inerte | **No**: exige A1 y A2 |

**No hay continuidad completa.** Cinco funciones que el mediador tiene hoy no se mantienen bajo `PILOT_LEGACY` y quedan como decisión de Dirección (§7): candidatos, diagnóstico, Leo del lector, Leo del mediador, y perfil y línea de tiempo de señales.

### 2.2 Matriz de permisos

«Antes» = candidata `v9r-a3c16e6` con el registro vacío (lo único posible sin fabricar autorizaciones). «Después» = esta corrección con la carga del §4.

| Quién · qué | Producción hoy | Antes | Después |
|---|---|---|---|
| **Lector de piloto** · leer, guardar progreso, ver lo suyo | Sí | Sí | Sí |
| Lector de piloto · Leo e IA | Sí | 403 `A3_REQUIRED` | 403 `A3_REQUIRED` |
| Lector de piloto · transcripción de voz | — | Cerrada (A5) | Cerrada (A5) |
| **Mediador de piloto** · nómina y resumen de su curso del corte | Sí | 403 / retenida | Sí, solo lectores del corte |
| Mediador de piloto · seguimiento histórico (progreso de lectura, estado, filas del resumen, intervenciones, entregas) | Sí | 403 | Solo de lectores con `pilot_reader_followup` en ese mismo curso |
| Mediador de piloto · tablero e informe del curso | 403 (restringidos) | 403 | 403 |
| Mediador de piloto · analítica derivada de Aula Viva, Leo del mediador, XP | Parcial (ver 2.1) | 403 | 403 |
| Mediador de piloto · candidatos y diagnóstico | Sí | 403 | 403 |
| Mediador de piloto · curso o lector posterior al corte | — | 403 | 403 |
| Mediador de piloto · otros cursos, otra institución | 403 | 403 | 403 |
| **Mediador nuevo** (sin C005) | — | 403 | 403 |
| **Mediador con C005** · lector con A2 | — | Todo lo de V9 | Todo lo de V9 (sin cambios) |
| **Administración** | Sí | Sí | Sí (sin cambios) |
| **Cuenta nueva** · activación | — | T + autorizaciones (+ C005) | Además `P`; sin `P` no se activa |
| Cuenta nueva · alta activa por administración | — | Con A1 o C005 verificada | Además `P` verificada |
| Cuenta nueva · condición de piloto | — | — | Imposible (régimen sellado) |

## 3. Tratamientos que siguen exigiendo base jurídica verificable

`PILOT_LEGACY` **no** abre ninguno de estos. Cada uno requiere su decisión propia en el registro:

| Tratamiento | Decisión | Por qué no entra en la continuidad |
|---|---|---|
| Leo y cualquier procesamiento con IA de un lector | A3 | Interviene un proveedor externo de IA; las condiciones materiales del 004 sobre proveedores siguen abiertas. Para un menor decide su representante. |
| Vistas de Leo del mediador | A2 + C005 | Muestran evidencias del tratamiento con IA. |
| Transcripción de la voz | A5 | Tratamiento opcional del 004, independiente de los demás. |
| XP y reconocimiento | A1 | Apagado; exige A1 con fecha del acto anterior al hecho. |
| Analítica derivada de Aula Viva por lector | A2 + C005 | En producción los motores están apagados: para un piloto es tratamiento nuevo. |
| Tablero e informe del curso | A2 + C005 | Producción ya los niega a quien media por falta de base acreditable. |
| Seguimiento histórico de un lector **sin** `pilot_reader_followup` | A2 + C005 | La carga decide, curso por curso, si los lectores lo conservan (`PILOT_FOLLOWUP`). |
| Cualquier lector, mediador o curso posterior al corte | A2 + C005 | El régimen está cerrado. |
| Candidatos y diagnóstico del grupo | C005 | Enumeran a personas ajenas a la nómina del corte. |

## 4. Carga (se ejecuta en DEP-1, paso 4.2; sustituye al preparativo 3.2-6)

En un contenedor efímero sin red de la imagen nueva, con `ops/a2/` montado en solo lectura:

1. `PILOT_MODE=emit` con `PILOT_GROUPS` (los tres grupos), `PILOT_FOLLOWUP` (decisión de Dirección: `none`, `all` o la lista de cursos), `PILOT_CUTOFF_DAY=2026-11-24` (inventario de PRE-1), `PILOT_REF` (referencia de la decisión) y, si se fija, `PILOT_VALID_UNTIL`. Los recuentos salen por stderr, sin identificadores: se cotejan con el inventario (21 mediadores, 224 lectores) **antes** de cargar.
2. La salida se entuba al operador de decisiones en el mismo paso: `node pilot_legacy_pack.mjs | node decision_operator.mjs`. Todas las líneas o ninguna; la última es el sello. La salida lleva identificadores de cuenta: no se guarda.
3. `PILOT_MODE=verify`: recuentos por grupo de pertenencias vigentes. Copia custodiada del registro, como tras cualquier lote.

Reversión: revocar el sello (una línea). No hay reapertura ni enmienda: una carga corregida exige un registro nuevo antes de arrancar.

## 5. Constancia `P` (Política 001)

Línea del registro, autenticada como las demás: sujeto (HMAC de la cuenta), tipo `P`, `granted`, día del acto, **instante del servidor** (`t`, ISO 8601 UTC; nuevo en todas las líneas), documento y versión (`001@1.0`), medio (`in_app`), calidad de quien declara (`titular` o `legal_representative`), verificación y la referencia `ACT-…` del acto de activación, que es la misma de las demás decisiones tomadas en ese acto.

- Identidad del declarante: el titular activa con su enlace personal de un solo uso y su contraseña (`self_authenticated`). En una cuenta de menor declara su representante, con la misma calidad y el mismo estado «sin verificar» que A0 y A1, y la cuenta guarda la referencia de esa declaración junto al contacto del adulto del pedido.
- Separación: `P` no aporta T, A0–A5 ni C005, y ninguna de ellas aporta `P`. Mediadores y administración también la aceptan.
- Exige el 001 aprobado y publicado (`CHP_ACCEPTANCE_DOCUMENTS`), como antes: sin él no hay activación (503).
- Reinvitación: una cuenta que ya la aceptó por sí misma en esa versión no la repite; la de un menor (declarada por su representante y aún sin verificar) sí.
- Revocación: línea `revoked` por el operador; la supresión de una cuenta la revoca junto con T. No se añadió ningún efecto automático nuevo sobre el acceso: lo que procede tras revocarla lo fija el 001 y se tramita por los procedimientos de supresión existentes.
- Las líneas anteriores (sin `t`) siguen verificando; el instante no se puede añadir, quitar ni alterar sin invalidar el registro.

Las cuentas de piloto ya activas **no** tienen `P` y no se les anota: no pasan por la activación. Si una se reinvita, acepta la Política y decide sus autorizaciones como cualquier cuenta nueva.

## 6. Verificación

| Comprobación | Resultado |
|---|---|
| `pilotLegacy.test.mjs` (registro, sin servidor) | 71 ✓ |
| `pilotLegacyHttp.test.mjs` (server real, dos réplicas: alcance, funciones históricas frente a nuevas con control por la vía ordinaria, tablero e informe cerrados, barrido de rutas, Leo aparte, cuentas nuevas, revocación, traslado, sustitución, desactivación, fin del régimen) | 67 ✓ |
| `pilotLegacyPack.test.mjs` (herramienta de carga) | 12 ✓ |
| Job `identity-preflight` completo en Linux (`node:20`, `npm ci`), incluido `test:b2c` sin omisiones | todos los pasos, `[job] completo` (clon limpio de `acedba8`) |
| 42 suites de página | 0 fallos |
| E2E tienda → app (conector `6dc8aed`, APP `acedba8`) | 201 correctas, VERDE |
| Integridad de la imagen API; Trivy de las dos imágenes | 51 ok; 0 hallazgos |
| Chrome real, laboratorio sintético: casilla propia y desmarcada, documento y versión enlazados, activación bloqueada sin aceptación, registro `P`; menor por su representante; ni A0/A1 ni términos la sustituyen | Correcto (capturas en la evidencia) |
| Altas administrativas y reinvitación (laboratorio y `contractingLinkingHttp`) | Sin `P` verificada la cuenta queda invitada; con ella, activa |

Las tres suites nuevas forman parte de `test:v81`, que la CI ejecuta. Evidencia: `D:/chp-artifacts/v9r-dep1-final/`. Validación en seco de la carga sobre una proyección de solo lectura de producción: 245 pertenencias (21 + 224), tres grupos, misma huella que un cálculo independiente.

No se repitieron las pruebas de Android ni el ensayo de restauración: nada de esta corrección toca LU, los esquemas ni los respaldos. El registro de decisiones sigue fuera de los respaldos por diseño. En el laboratorio los enlaces de los documentos apuntan a un dominio de prueba: que el documento real se abra depende de su publicación.

## 7. Condiciones externas para retomar DEP-1

1. **Aprobación documental**: acta firmada; 001, 002, 004 y 005 publicados en HTTPS en su versión `1.0`. Sin ella no se activa ninguna cuenta nueva, tampoco una cuenta de piloto reinvitada.
2. **Asiento `DIR-V9R-PILOT-01` aprobado por Dirección**: corte 2026-11-24, tres grupos, 245 pertenencias, seguimiento histórico en los tres, régimen revocable sin fecha, custodia en Dirección.
3. **Decisión sobre las cinco funciones históricas que no se mantienen** (§2.1): aceptar que quedan cerradas para los pilotos hasta tener C005, A2 y A3, o aportar esas autorizaciones. No admiten otra vía en esta candidata.
4. **Retención** (12 meses en servidor, 365 días en web y LU) sin ratificar; la poda sigue apagada. No bloquea por sí sola.
