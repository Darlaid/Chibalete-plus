# CHP V9 65E-C3 — Privacidad del dispositivo e integridad de la lectura (Bloque I)

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

- dice qué queda, con cantidades, y hasta qué fecha se conservarán las lecturas sin enviar;
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

## 4. Cola de lecturas pendientes: política

- Una lectura sale de la cola solo cuando el servidor la **confirma**, la **rechaza de forma definitiva** (cuenta
  suprimida, obra retirada, cuerpo inválido) o su titular la **elimina**. La antigüedad no es una entrega.
- Lo pendiente de la cuenta **con la sesión abierta** no caduca: se reintenta hasta que llegue. Antes, tras más de siete
  días sin conexión o al volver después de ese plazo, se borraba sin haberse enviado.
- Lo pendiente de una cuenta que **ya no usa el equipo** se conserva 7 días desde que se guardó y después se elimina. El
  plazo se le dice a su titular, con fecha, al cerrar sesión. Es un límite de privacidad en equipos compartidos, no una
  afirmación de entrega.
- Cada cuenta envía solo lo suyo; el tope es de 50 pendientes por cuenta.
- Mientras haya lecturas sin sincronizar más de un minuto, o sin conexión, el menú lo indica.

Decisión pendiente de Dirección: el plazo para cuentas ausentes es de 7 días en la web y de 45 días en Lector Único
(valor de 65D-1S, también por confirmar). Propuesta: fijar un único plazo para los dos clientes. La implementación no
depende del número.

## 5. Atribución temporal de la lectura hecha sin conexión

Regla de 65A, ahora la misma en el tablero, el resumen de Aula Viva, la trayectoria, las cohortes y las
recomendaciones: una lectura fechada por el dispositivo se atribuye a un curso solo si la obra estaba asociada y el
lector era miembro **de forma continua desde la fecha declarada hasta que el servidor la recibió**. Si el contexto
cambió en ese tramo (la obra se retiró y se volvió a asociar, el lector salió y volvió), la lectura se conserva como
del lector, aparece como «lectura no atribuible» —nunca como inactividad— y no se acredita después, tampoco si se
reenvía.

La vista de la administración cuenta la actividad de las obras del curso sin condición de fecha (65E-B): no atribuye a
un periodo de mediación y no cambia.

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
`pages/__tests__/PrivacyLocal65EC3.test.mjs` y las de 65E-C1 y 65E-C2, todas en `npm run test:v81`.
