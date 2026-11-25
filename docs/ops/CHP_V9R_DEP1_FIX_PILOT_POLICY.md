# CHP V9-R · DEP-1 — Corrección bloqueante: continuidad de pilotos y aceptación de la Política 001

Estado: **corregido en código, NO desplegado.** Producción no se tocó. Candidata nueva: `v9r-f5b9281` (APP `f5b9281`). Sustituye a `v9r-a3c16e6` para API y front; conector WEB (`6dc8aed`) y LU 0.10.0 (`41d17bf`) no cambian.

DEP-1 se detuvo en el preflight (2026-11-25) por dos defectos de la candidata frente a la decisión de Dirección sobre los pilotos (21 mediadores y 224 lectores en tres espacios; sin regularización retrospectiva; sin autorizaciones fabricadas).

## 1. Los dos defectos y su corrección

| | Causa | Corrección |
|---|---|---|
| 1 | V9 exige C005 del mediador y A2 del lector para la nómina, el resumen y el seguimiento individual. Los pilotos no tienen ninguna en el registro, y no pueden inventarse: con el registro vacío los 21 mediadores perdían todo salvo el tablero agregado. | Tipo nuevo en el **mismo** registro de decisiones: `PILOT_LEGACY`. No es un consentimiento. Constata que una **pertenencia** (grupo + cuenta) existía en el corte, y conserva solo las funciones de la tabla del §2, dentro de ese grupo. |
| 2 | La activación registraba términos (T, 002), autorizaciones (A0–A5, 004) y compromiso (C005, 005). La Política 001 solo aparecía enlazada: su aceptación no dejaba constancia propia. | Tipo nuevo `P`: aceptación expresa de la Política 001, con su versión, en la activación. Casilla propia, sin premarcar. Ninguna cuenta nueva queda activa sin ella, tampoco por la vía administrativa. |

Archivos: `server/privacy/a2Registry.mjs`, `server/privacy/acceptance.mjs`, `server/privacy/suppression.mjs`, `server/server.js`, `pages/ActivarCuenta.tsx`, `ops/a2/pilot_legacy_pack.mjs` (nuevo) y sus pruebas. No hay un segundo motor de permisos: las puertas existentes (`decisionGate`, `a2Gate`, `individualDisclosure`) consultan la condición en el mismo punto donde consultaban C005 y A2.

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

### Matriz de permisos

«Antes» = candidata `v9r-a3c16e6` con el registro vacío (lo único posible sin fabricar autorizaciones). «Después» = esta corrección con la carga del §4.

| Quién · qué | Producción hoy | Antes | Después |
|---|---|---|---|
| **Lector de piloto** · leer, guardar progreso, ver lo suyo | Sí | Sí | Sí |
| Lector de piloto · Leo e IA | Sí | 403 `A3_REQUIRED` | 403 `A3_REQUIRED` (§3) |
| Lector de piloto · transcripción de voz | — | Cerrada (A5) | Cerrada (A5) |
| Lector de piloto · XP | Apagado | Apagado (A1) | Apagado (A1) |
| **Mediador de piloto** · lista de grupos | Con nóminas | Nóminas retenidas | Nómina del corte de sus cursos del corte; el resto, retenido |
| Mediador de piloto · lista de usuarios | Institución | Solo personal | Además, los lectores del corte de sus cursos del corte |
| Mediador de piloto · nómina de su curso del corte | Sí | 403 | Sí, solo lectores del corte |
| Mediador de piloto · resumen del curso | Sí | 403 | Sí, limitado a lectores del corte; filas individuales solo con seguimiento |
| Mediador de piloto · seguimiento individual (estado, progreso, línea de tiempo, intervenciones, revisión y exportación de entregas) | Sí | 403 | Solo de lectores con `pilot_reader_followup` en ese mismo curso |
| Mediador de piloto · candidatos y diagnóstico del grupo | Sí | 403 | 403 (exigen C005: nombran a personas de fuera de la nómina) |
| Mediador de piloto · un curso suyo posterior al corte | — | 403 | 403 |
| Mediador de piloto · lector llegado después del corte | — | 403 | 403 (ni en la nómina) |
| Mediador de piloto · otros cursos, otra institución | 403 | 403 | 403 |
| **Mediador nuevo** (sin C005) | — | 403 | 403 |
| **Mediador con C005** · lector con A2 | — | Sí | Sí (sin cambios) |
| **Administración** | Sí | Sí | Sí (sin cambios) |
| **Cuenta nueva** · activación | — | T + autorizaciones (+ C005) | Además `P`; sin `P` no se activa |
| Cuenta nueva · alta activa por administración | — | Con A1 o C005 verificada | Además `P` verificada |
| Cuenta nueva · condición de piloto | — | — | Imposible (régimen sellado) |

## 3. Tratamientos que siguen exigiendo base jurídica verificable

`PILOT_LEGACY` **no** abre ninguno de estos. Cada uno requiere su decisión propia en el registro, por lector:

| Tratamiento | Decisión | Por qué no entra en la continuidad |
|---|---|---|
| Leo y cualquier procesamiento con IA de un lector | A3 | Interviene un proveedor externo de IA; las condiciones materiales del 004 sobre proveedores siguen abiertas. Para un menor decide su representante. |
| Transcripción de la voz | A5 | Tratamiento opcional del 004, independiente de los demás. |
| XP y reconocimiento | A1 | Apagado; exige A1 con fecha del acto anterior al hecho. |
| Seguimiento individual de un lector **sin** `pilot_reader_followup` | A2 + C005 | La carga decide, curso por curso, si los lectores conservan el seguimiento (`PILOT_FOLLOWUP`). Donde Dirección no lo decida, el mediador ve la nómina y los agregados, no el detalle. |
| Cualquier lector, mediador o curso posterior al corte | A2 + C005 | El régimen está cerrado. |
| Candidatos y diagnóstico del grupo | C005 | Enumeran a personas de la institución ajenas a la nómina del corte. |

**Decisión que queda en Dirección:** en qué cursos del piloto los lectores (menores incluidos) conservan el seguimiento individual. El seguimiento es el mismo tratamiento que el piloto ya hacía (004 A2: acompañamiento por los mediadores asignados), con las vistas de V9; no llega a nadie distinto del mediador que ya lo tenía. La herramienta no tiene valor por defecto: `none`, `all` o la lista de cursos.

## 4. Carga (se ejecuta en DEP-1, paso 4.2; sustituye al preparativo 3.2-6)

En un contenedor efímero sin red de la imagen nueva, con `ops/a2/` montado en solo lectura:

1. `PILOT_MODE=emit` con `PILOT_GROUPS` (los tres grupos), `PILOT_FOLLOWUP` (decisión de Dirección), `PILOT_CUTOFF_DAY=2026-11-24` (inventario de PRE-1), `PILOT_REF` (referencia de la decisión) y, si se fija, `PILOT_VALID_UNTIL`. Los recuentos salen por stderr, sin identificadores: se cotejan con el inventario (21 mediadores, 224 lectores) **antes** de cargar.
2. La salida se entuba al operador de decisiones en el mismo paso: `node pilot_legacy_pack.mjs | node decision_operator.mjs`. Todas las líneas o ninguna; la última es el sello. La salida lleva identificadores de cuenta: no se guarda.
3. `PILOT_MODE=verify`: recuentos por grupo de pertenencias vigentes. Copia custodiada del registro, como tras cualquier lote.

Reversión: revocar el sello (una línea). No hay reapertura: una carga corregida exige un registro nuevo antes de arrancar.

## 5. Constancia `P` (Política 001)

Línea del registro, autenticada como las demás: sujeto (HMAC de la cuenta), tipo `P`, `granted`, día del acto, **instante del servidor** (`t`, ISO 8601 UTC; nuevo en todas las líneas), documento y versión (`001@1.0`), medio (`in_app`), calidad de quien declara (`titular` o `legal_representative`), verificación y la referencia `ACT-…` del acto de activación, que es la misma de las demás decisiones tomadas en ese acto.

- Identidad del declarante: el titular activa con su enlace personal de un solo uso y su contraseña (`self_authenticated`). En una cuenta de menor declara su representante, con la misma calidad y el mismo estado «sin verificar» que A0 y A1, y la cuenta guarda la referencia de esa declaración junto al contacto del adulto del pedido.
- Separación: `P` no aporta T, A0–A5 ni C005, y ninguna de ellas aporta `P`. Mediadores y administración también la aceptan.
- Exige el 001 aprobado y publicado (`CHP_ACCEPTANCE_DOCUMENTS`), como antes: sin él no hay activación (503).
- Revocación: línea `revoked` por el operador; la supresión de una cuenta la revoca junto con T. No se añadió ningún efecto automático nuevo sobre el acceso: lo que procede tras revocarla lo fija el 001 y se tramita por los procedimientos de supresión existentes.
- Las líneas anteriores (sin `t`) siguen verificando; el instante no se puede añadir, quitar ni alterar sin invalidar el registro.

Las cuentas de piloto ya activas **no** tienen `P` y no se les anota: no pasan por la activación. Si una se reinvita, acepta la Política y decide sus autorizaciones como cualquier cuenta nueva.

## 6. Verificación

| Comprobación | Resultado |
|---|---|
| `pilotLegacy.test.mjs` (registro, sin servidor) | 68 ✓ |
| `pilotLegacyHttp.test.mjs` (server real, dos réplicas: alcance, barrido de rutas, Leo aparte, cuentas nuevas, revocación, traslado, sustitución, desactivación, fin del régimen) | 57 ✓ |
| `pilotLegacyPack.test.mjs` (herramienta de carga) | 12 ✓ |
| Job `identity-preflight` completo en Linux (`node:20`, `npm ci`), incluido `test:b2c` sin omisiones | `todos los pasos, `[job] completo` (clon limpio de `f5b9281`)` |
| 42 suites de página | 0 fallos |
| E2E tienda → app (conector `6dc8aed`, APP `f5b9281`) | `201 correctas, VERDE` |
| Integridad de la imagen API | `51 ok` |

Las tres suites nuevas forman parte de `test:v81`, que la CI ejecuta. Evidencia: `D:\chp-artifacts\v9r-dep1-fix\`.

No se repitieron las pruebas de Android ni el ensayo de restauración: nada de esta corrección toca LU, los esquemas ni los respaldos. El registro de decisiones sigue fuera de los respaldos por diseño.

## 7. Bloqueos que siguen abiertos (todos externos)

1. **Aprobación documental**: acta sin firmar; 001, 002, 004 y 005 sin publicar. Sin ella no se activa ninguna cuenta nueva, tampoco una cuenta de piloto reinvitada.
2. **Decisión escrita de Dirección sobre el piloto**: referencia, fecha de corte, cursos con seguimiento individual y, si procede, fecha de caducidad del régimen.
3. **Retención** (12 meses en servidor, 365 días en web y LU) sin ratificar; la poda sigue apagada.
4. **Publicación de este commit y CI oficial**: pendientes de autorización; aquí solo consta la reproducción local del job.
