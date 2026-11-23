# CHP V9 65E-C3 / 65E-C4 — Privacidad del dispositivo e integridad de la lectura (Bloque I)

Estado: implementado y probado en laboratorio. Sin desplegar. Este documento describe qué queda en un navegador al
cerrar sesión, qué puede hacer su titular, qué riesgo no elimina la aplicación y las reglas de atribución y de
conservación que rigen desde 65E-C3.

## 1. Qué queda en el equipo al cerrar sesión

| Dato | Dónde | ¿Tiene copia en el servidor? | Al cerrar sesión |
|---|---|---|---|
| Progreso, catálogo, padrón, grupos, memoria y chat de Leo, respuestas de IA | navegador | Sí | Se borra siempre |
| Lecturas que todavía no se pudieron enviar (cuenta, obra, posición, inicio y duración de la sesión) | cola de pendientes | Todavía no | Se conserva, salvo que su titular pida eliminarla |
| Bitácora (diario y borradores de tareas), reseñas, entregas de tareas, publicaciones, prácticas de voz, vocabulario, notas de relectura, perfil de acompañamiento | navegador | No | Se conserva, salvo que su titular pida eliminarla |
| Preferencias de lectura (tema, tamaño de letra, accesibilidad) | navegador | No | Se conserva: no son de ninguna cuenta |

Borrar sin preguntar lo que no tiene copia destruiría trabajo de su titular. Por eso el cierre de sesión no lo borra
por defecto: avisa y deja elegir.

## 2. Cierre de sesión informado

Al pulsar «Cerrar sesión» (menú de escritorio, menú móvil y perfil), si en el equipo queda algo de esa cuenta se abre
un diálogo que:

- dice qué queda, con cantidades, y hasta qué fecha se conservarán las lecturas sin enviar (12 meses);
- advierte que alguien con acceso al navegador podría verlo y recomienda un perfil de navegador propio en equipos
  compartidos;
- ofrece **conservarlo y cerrar sesión** (opción por defecto y con el foco), **eliminar mis datos de este equipo** o
  **cancelar**.

Eliminar exige un segundo paso que enumera lo que se pierde. Antes de eliminar se intenta enviar lo pendiente con la
sesión todavía válida; lo que no llegue se pierde, y el diálogo lo dice. La eliminación quita solo lo de la cuenta
que sale: los datos de otras cuentas del mismo navegador, las preferencias compartidas y lo ya guardado en el servidor
no se tocan. Si no queda nada de la cuenta, se cierra sin preguntar.

Los cierres forzados (cambio de contraseña, sesión revocada) no abren el diálogo y no borran lo que solo existe en el
equipo.

## 3. Riesgo residual: inspección directa del perfil del navegador

La aplicación aísla las cuentas **dentro de la aplicación**: una cuenta no ve, no consulta y no envía datos de otra.
No protege el almacenamiento del navegador frente a quien tenga acceso al perfil: con las herramientas de desarrollo o
leyendo los archivos del perfil, una persona puede ver en claro lo que quedó guardado (por ejemplo el texto de la
bitácora, o qué obra y hasta dónde se leyó sin conexión), con el identificador de la cuenta.

No se cifra, a propósito: la clave tendría que guardarse en el mismo navegador y cualquiera con acceso al perfil la
tendría también. Sería una protección aparente.

Recomendación operativa para colegios y hogares con equipos compartidos:

1. Un perfil de navegador (o una cuenta del sistema operativo) por persona, o el modo invitado, que borra todo al
   cerrar la ventana.
2. Donde eso no sea posible, elegir «Eliminar mis datos de este equipo» al cerrar sesión.
3. No usar la sincronización de perfil del navegador con una cuenta personal en un equipo del colegio.

Reducir más este riesgo exige llevar al servidor los datos que hoy solo existen en el equipo (bitácora, reseñas,
entregas, vocabulario). Es un cambio de alcance mayor que este contrato y queda como propuesta para Dirección.

## 4. Colas de lecturas pendientes: política (65E-C3, completada en 65E-C4)

- Una lectura sale de la cola solo cuando el servidor la **confirma**, la **rechaza de forma definitiva** (cuenta
  suprimida, obra retirada, cuerpo inválido) o su titular la **elimina**. La antigüedad no es una entrega.
- **Sin desalojo por capacidad.** La cola no tiene tope por número de lecturas (antes, al llegar a 50 por cuenta se
  descartaba la más antigua sin enviarla y sin aviso; la cola del Visor Accesible descartaba a partir de 200 eventos en
  total, también los de otra cuenta). El límite es el espacio: un presupuesto de 1,5 millones de caracteres para la cola
  principal (unas 2 500 sesiones; 121 sesiones ocupan 37 000) y 1 millón para la del Visor Accesible.
- **Almacenamiento agotado.** Si una lectura nueva no cabe —o el navegador rechaza la escritura—, lo ya guardado no se
  toca, la nueva queda solo en la memoria de la página (se sigue reintentando) y el menú lo dice: cuántas lecturas solo
  se conservan mientras la ventana siga abierta. Nunca se da por guardado lo que no lo está.
- Lo pendiente de la cuenta **con la sesión abierta** no caduca: se reintenta hasta que llegue.
- Lo pendiente de una cuenta que **ya no usa el equipo** se conserva **12 meses** desde que se guardó y después se
  elimina. El plazo y la fecha se le dicen a su titular al cerrar sesión y en el aviso del menú.
- **Caducar no es entregar.** Cuando algo caduca queda una constancia sin contenido (cuántas lecturas y cuándo). Si su
  titular vuelve a ese equipo, se le informa de que se eliminaron sin enviarse y que no cuentan en su progreso; al darse
  por enterado, la constancia se retira. La eliminación voluntaria la retira también.
- Cada cuenta envía solo lo suyo; sin sesión no se envía nada.

### Plazo: web y Lector Único

| | Web (APP) | Lector Único (`59d7ada`) |
|---|---|---|
| Plazo para la cuenta ausente | 12 meses (`FAILED_SYNCS_TTL_MS`) | 12 meses (`ORPHAN_RETENTION_MS`, 65D-2R) |
| Desde cuándo cuenta | Desde que la lectura se guardó en la cola | Desde que se creó el evento o se actualizó el progreso |
| Cuenta activa | No caduca | No caduca |
| Entrega confirmada | Se retira | Se retira |
| Eliminación explícita | «Eliminar mis datos de este equipo» | `LocalDataCleaner.clearPendingOf` |

Los doce meses coinciden con la conservación de las constancias de sesión del servidor: más allá, tampoco el servidor
conservaría la evidencia. Es una **propuesta operativa pendiente de ratificación jurídica**; el valor es una constante
en cada cliente.

Corrección: una versión anterior de este documento decía que Lector Único conservaba 45 días. Era el valor de 65D-1S;
65D-2R lo cambió a 12 meses y es lo que contiene `59d7ada`.

Observación sin cambio en esta fase: Lector Único guarda como máximo 200 sesiones sin enviar por obra y descarta las
más antiguas al superarlo. Corregirlo exige intervenir Android y queda para su gate de distribución.

## 5. Atribución temporal de la lectura hecha sin conexión

Regla de 65A, ahora la misma en el tablero, el resumen de Aula Viva, la trayectoria, las cohortes y las
recomendaciones: una lectura fechada por el dispositivo se atribuye a un curso solo si la obra estaba asociada y el
lector era miembro **de forma continua desde la fecha declarada hasta que el servidor la recibió**. Si el contexto
cambió en ese tramo (la obra se retiró y se volvió a asociar, el lector salió y volvió), la lectura se conserva como
del lector, aparece como «lectura no atribuible» —nunca como inactividad— y no se acredita después, tampoco si se
reenvía.

### Administración: actividad observada y lectura acreditada (65E-C4)

La vista de la administración cuenta la actividad de las obras del curso sin condición de fecha (65E-B). Eso es
**actividad observada**, no lectura acreditada, y desde 65E-C4 la respuesta lo dice:

- `activityBasis` (`observed_activity`): las cifras del tablero, del informe, del resumen de Aula Viva y del agregado
  del colegio son actividad observada en las obras del curso.
- `creditedReading`: aparte, la **lectura acreditada** del curso con la regla 65A, calculada con las mismas funciones
  que recibe la mediación (lectores con lectura acreditada y lectores con lectura no atribuible). Con el registro de
  procedencia apagado se declara no disponible; en el agregado del colegio se remite a cada curso.

Las pantallas de administración muestran una nota con las dos cosas. Ninguna presenta una lectura no acreditable como
participación certificada del curso. La mediación no cambia: sus cifras ya son las acreditadas.

## 6. Cobertura de Lector Único en los indicadores globales

| Indicador global | Qué mide | Lector Único |
|---|---|---|
| Señales y perfil del materializador: continuidad, tiempo efectivo, diversidad; última actividad | Lectura de todos los modos | Incorporado: sesiones con fecha creíble, fechadas cuando ocurrieron |
| Abandono temprano | Abandonos sobre inicios | Solo aporta inicios: Lector Único no emite abandonos |
| Persistencia | Reanudaciones y términos | Sin cobertura: Lector Único no emite esos hechos; queda sin valor, no en cero |
| Cohorte activa por grupo | Lectores con actividad en 28 días | Incorporado |
| Ventanas de impacto de intervenciones | Lectura antes y después | Incorporado, por la fecha de la lectura |
| Agregados diarios, semanales y mensuales | Sesiones iniciadas, lectores activos, minutos | Incorporado, en el día de la lectura |
| Cohorte de modalidad «audio + inmersivo» | Uso de audio e inmersivo | Sin cobertura por definición: son modos de la web |
| Tiempo propio para el avance automático del visor accesible | Lectura registrada por los visores web | Sin cobertura: es una función del visor web |
| Métricas v2 (`/api/v2/metrics`) | Contrato de eventos de los visores web | Sin cobertura: su contrato enumera los modos web |
| Tablero y agregados de curso y colegio | Sesiones y tiempo | Ya incluido desde 65D-2 y 65E-C1 |

Una sesión de Lector Único que declara una fecha posterior a su recepción no se acredita con ninguna fecha. No se
atribuyen a Lector Único interacciones que no genera.

## 7. Pruebas

`server/__test__/luContextHttp.test.mjs`, `server/__test__/luGlobalCoverage.test.mjs`,
`pages/__tests__/PrivacyLocal65EC3.test.mjs`, `pages/__tests__/PendingQueue65EC4.test.mjs`,
`pages/__tests__/ActivityBasis65EC4.test.mjs` y las de 65E-C1 y 65E-C2, todas en `npm run test:v81`.
