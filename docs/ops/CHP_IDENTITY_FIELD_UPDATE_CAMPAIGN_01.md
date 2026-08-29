# CHP-IDENTITY-FIELD-UPDATE-CAMPAIGN-01

Fecha: 2026-08-29. Tipo: **diseño operacional, docs-only**. Carril A de `CHP-ROADMAP-2026-05`.
Continúa `CHP-IDENTITY-FIELD-UPDATE-CHANNEL-01`, que cerró
`AMBER-EXTERNAL-UPDATE-CAMPAIGN-REQUIRED`.

Cero producción, cero SSH, cero HTTP, cero tráfico sintético, cero APK, cero backend, cero Android,
cero mensajes enviados, cero contacto con instituciones, docentes, familias o menores.

> **Este documento no autoriza su propia ejecución.** Describe cómo se haría la campaña; no la
> inicia, no fija fechas reales, no publica enlaces, no abre el drain y no define `T0`.

---

## 0. Decisiones humanas vinculantes registradas

```text
Responsable por cada equipo:  docente o mediador
La cifra 180 representa:      cuentas escolares, no equipos
Ventana general:              14 días (relativa, sin fechas reales)
```

La segunda decisión resuelve la ambigüedad que `CHP_IDENTITY_FIELD_UPDATE_CHANNEL_01.md` §7 dejó
abierta: **180 son cuentas escolares**. Queda prohibido usar esa cifra como inventario físico o como
denominador de migración. El denominador de migración es, y solo puede ser, el **inventario de
equipos físicos** construido por esta campaña.

---

## 1. Alcance y no objetivos

### Alcance

Campaña **externa** —fuera del producto, porque dentro del producto no existe canal— dirigida a
instituciones y a sus docentes o mediadores, para que las **instalaciones LU legacy** (`0.7.1`,
`0.8.0`) de cada equipo físico bajo su responsabilidad pasen a `0.9.0`, y para que cada equipo quede
**conciliado** en un inventario cerrado.

Ventana general **relativa** de **14 días**, expresada como Día 1 … Día 14. Sin fechas reales.

### No objetivos

- **No** hay comunicación directa con menores. La campaña se dirige a adultos responsables.
- **No** se bloquea ninguna versión antigua. No se toca `forceUpdate`, `minSupportedVersion`, drain
  ni `ENFORCE`.
- **No** se construye receptor, push, FCM, worker ni mecanismo de aviso in-app: no existiría manera
  de que alcanzase a `0.7.1` ni a `0.8.0`, que son precisamente el objetivo.
- **No** se implementa base de datos, formulario, aplicación ni automatización de registro.

### Equivalencias prohibidas

Ninguna de estas cadenas puede tratarse como equivalencia, en ningún reporte derivado:

```text
cuenta       != sesión
sesión       != descarga
descarga     != instalación
instalación  != uso
cuenta       != equipo físico
campaña enviada != campaña recibida
señal 0.9.0 de una cuenta compartida != todos sus equipos migrados
```

Consecuencias que deben repetirse literalmente en cualquier informe:

- **La campaña enviada no demuestra recepción.**
- **La descarga no demuestra instalación.**
- **La señal 0.9.0 de una cuenta compartida no migra automáticamente todos sus equipos.**

---

## 2. Responsabilidades

### Chibalete Editores

- Proporcionar las **instrucciones** y la **URL oficial** de descarga, una sola y verificada.
- Mantener el **protocolo** y el formato de registro; resolver dudas de procedimiento.
- Consultar **únicamente evidencia técnica agregada o controlada** (versión por sesión, `2xx`
  autenticado, uso `lu_android` por cuenta). Nunca identificadores personales, IP como identidad ni
  listados de personas.
- **Apoyar excepciones**: equipos inaccesibles, cuentas compartidas, equipos `0.7.1`, equipos
  retirados.
- **No declarar ningún equipo migrado sin confirmación humana** de su responsable.

### Docente o mediador (responsable por equipo)

- **Identificar cada equipo físico** bajo su responsabilidad, uno por uno.
- Asignarle un **código local no personal** (`campaignUnitId`), estable durante la campaña.
- **Supervisar la actualización** de cada equipo elegible.
- **Confirmar el resultado por unidad**, no por curso ni por cuenta.
- **Registrar excepciones sin PII**, mediante código o categoría.
- **No compartir contraseñas** de nadie y **no registrar datos de menores** en ningún campo.

Un mismo docente o mediador puede ser responsable de varios equipos. Un equipo tiene exactamente un
responsable.

---

## 3. Contrato mínimo de inventario

Regla estructural: **una fila por equipo físico**, aunque varios equipos usen la misma cuenta y
aunque un mismo equipo haya usado varias cuentas. La cuenta es un atributo de la fila, nunca su
clave.

| Campo | Regla |
|---|---|
| `campaignUnitId` | Código opaco y único de la unidad. **Nunca** nombre, correo, IMEI, MAC ni teléfono. |
| `institutionCode` | Código institucional no personal. |
| `responsibleRole` | `DOCENTE` o `MEDIADOR`. |
| `baselineVersion` | `0.7.1`, `0.8.0`, `0.9.0`, `UNKNOWN`, `NO_LU`. |
| `accountMode` | `DEDICATED`, `SHARED`, `UNKNOWN`. Sin correo ni nombre de cuenta. |
| `accessState` | `ACCESSIBLE`, `INACCESSIBLE`, `UNKNOWN`. |
| `updateAttemptedAt` | Fecha/hora del intento. Se rellena **solo cuando ocurre**. |
| `ua090Seen` | Sí/no. Evidencia **por sesión o cuenta**, nunca por dispositivo. |
| `authenticated2xxSeen` | Sí/no. Acción conectada exitosa con sesión firmada. |
| `humanConfirmedAt` | Momento de la confirmación del docente o mediador. |
| `finalStatus` | Uno de los seis estados autorizados. |
| `closureDecision` | **Requerida** para retiro o exclusión: motivo codificado, fecha y quién decide. |
| `controlledNote` | Código o categoría de una lista cerrada. Sin texto libre con PII. |

Estados autorizados, y ningún otro:

```text
UPDATED
RETIRED
NO_LONGER_HAS_LU
INACCESSIBLE
PENDING
UNKNOWN
```

`baselineVersion = UNKNOWN` es un estado de entrada legítimo y frecuente: `0.7.1` y `0.8.0` emiten el
mismo User-Agent legacy genérico y son indistinguibles desde el servidor; la versión instalada se
determina **en el equipo**, mirándola.

Esta sección define un **contrato de datos**, no una implementación. No se diseña base de datos, no
se especifica motor, no se construye el formulario.

---

## 4. Reglas de conciliación

1. **`UPDATED`** exige **las dos cosas**, sin excepción:
   - evidencia técnica: `ChibaleteLU/0.9.0` con **sesión autenticada** y **acción conectada `2xx`**;
   - **confirmación humana del equipo**, emitida por su responsable, referida a ese
     `campaignUnitId`.
2. **`RETIRED`** y **`NO_LONGER_HAS_LU`** exigen confirmación humana **y** `closureDecision`
   registrada. No se infieren del silencio.
3. **`INACCESSIBLE`**, **`PENDING`** y **`UNKNOWN`** **no cierran la unidad** en ningún caso: ni por
   vencimiento de la ventana, ni por ausencia de tráfico, ni por acumulación estadística.
4. Toda **exclusión** requiere **decisión operacional explícita**, con **motivo** y **fecha**. Una
   unidad excluida sigue apareciendo en el inventario: se excluye del cierre, no del recuento.
5. Una **misma señal técnica de una cuenta compartida no puede copiarse a varias unidades**. Cada
   unidad necesita su propia confirmación individual. Con `accountMode = SHARED`, la evidencia
   técnica es **necesaria pero nunca suficiente** para más de una fila.
6. Los **porcentajes** usan como denominador el **inventario físico cerrado**. **Nunca** las 180
   cuentas escolares, ni las 26 cuentas que descargaron, ni las 5 con ejecución LU demostrada.
7. El **silencio no migra**. La ausencia de tráfico legacy posterior no convierte `PENDING` en
   `UPDATED`; desde la mitigación 202 del 18 de agosto la analítica legacy puede además descartarse,
   de modo que los stores dejan de ver actividad legacy por diseño.

---

## 5. Gate especial para 0.7.1 — bloqueante

```text
0.8.0 -> 0.9.0: demostrado en dispositivo
0.7.1 -> 0.9.0: compatible en teoría, no demostrado en dispositivo
```

Lo demostrado sobre `0.7.1` es que comparte `applicationId`, huella de certificado, `versionCode`
creciente y el mismo esquema Room v4 con migraciones aditivas presentes en su dex, y que el
comportamiento destructivo solo actúa en downgrade. **Eso no es una demostración en dispositivo y no
se eleva a «verificada».**

Regla de ejecución:

- **Ningún equipo con `baselineVersion = 0.7.1` recibe instrucciones de actualización masiva** hasta
  que se complete una **unidad separada de validación no destructiva** en dispositivo, o hasta que se
  apruebe expresamente un **tratamiento alternativo** documentado.
- **`UNKNOWN` debe resolverse antes** de indicar la ruta de actualización a esa unidad: mientras no se
  sepa si es `0.7.1` o `0.8.0`, se trata con la cautela de `0.7.1`.
- Los equipos `0.8.0` pueden seguir el recorrido de §7 sin esperar a este gate.

Este gate no se resuelve dentro de esta unidad de diseño.

---

## 6. Ventana relativa de 14 días

Secuencia **relativa**, sin fechas reales y sin compromiso de calendario:

```text
Antes del Día 1:
designar docentes/mediadores, entregar formato y verificar URL oficial

Días 1-3:
acuse de recibo y construcción del inventario físico inicial

Días 2-10:
actualización supervisada de unidades elegibles y conciliación inmediata

Día 7:
recordatorio y revisión de excepciones

Días 11-13:
recuperación de pendientes y decisiones sobre unidades no accesibles

Día 14:
corte provisional, conciliación y reporte; no equivale a T0

Después del Día 14:
resolver pendientes o aprobar exclusiones; solicitar autorización separada
```

Reglas de la ventana:

- «Antes del Día 1» incluye el **gate de §5**: si hay unidades `0.7.1` o `UNKNOWN`, la campaña masiva
  no sale para ellas.
- La conciliación es **inmediata por unidad**, no un lote final: cada equipo se cierra cuando reúne
  su evidencia técnica y su confirmación humana.
- **El vencimiento de los 14 días no convierte pendientes en migrados.** El Día 14 produce un **corte
  provisional** y un reporte de estado; no cierra el inventario, no fija `T0`, no abre drain y no
  habilita `ENFORCE`.

---

## 7. Recorrido por cada equipo elegible

```text
recibir la instrucción
abrir únicamente la URL oficial
descargar el APK
no desinstalar LU
autorizar la instalación cuando Android lo solicite
instalar sobre la aplicación existente
abrir LU con internet
iniciar sesión si es necesario
ejecutar una acción conectada
observar señal 0.9.0 y 2xx
obtener confirmación humana
cerrar la fila
```

Notas de ejecución, todas ya demostradas o ya documentadas:

- **Instalar encima**: mismo `applicationId`, certificado compatible y `versionCode` creciente. No
  desinstalar: desinstalar puede perder libro y progreso sin necesidad.
- **Autorización de Android**: el sistema pedirá permiso para instalar desde esta fuente. Es un paso
  humano previsto. **No se promete actualización silenciosa** —es imposible sin `PackageInstaller`,
  MDM ni tienda— y **no se recomienda desactivar ninguna protección general de Android**.
- **Primer login obligatorio** viniendo de `0.7.1` o `0.8.0`: el cliente legacy no conservaba cookie.
- **Acción conectada**: abrir la app con red y usarla hasta producir una petición autenticada. Es el
  **único paso observable por el servidor**; los seis anteriores son humanos.
- **Confirmación humana**: sin ella la unidad no es `UPDATED`, por mucha señal técnica que haya.

Referencia de descarga:

```text
Artefacto canónico documentado:  /uploads/chibalete-lu-0.9.0.apk (versionName 0.9.0, versionCode 10)
URL pública a comunicar:         <URL_OFICIAL_CANÓNICA_PENDIENTE_DE_VERIFICACIÓN>
```

La ruta del artefacto está documentada en `CHP_IDENTITY_LU_CANONICAL_DISTRIBUTION_01.md`; la **URL
pública completa que se entregaría a las instituciones no está demostrada en la documentación** y
debe verificarse antes del Día 1. Hasta entonces se usa el placeholder, literalmente, en todo
borrador de comunicación.

---

## 8. Comunicaciones preparatorias (redactadas, no enviadas)

Los tres textos siguientes son **borradores**. No se envían, no se publican y no se trasladan a
ningún canal dentro de esta unidad. Van dirigidos a **docentes o mediadores adultos**, nunca a
menores.

### 8.1 Mensaje inicial al docente o mediador

> Hola. Estamos actualizando la aplicación **Chibalete LU** en los equipos que se usan para leer.
> Te pedimos ayuda con los equipos que están a tu cargo.
>
> Para cada equipo, uno por uno:
> 1. Abre únicamente esta dirección oficial: `<URL_OFICIAL_CANÓNICA_PENDIENTE_DE_VERIFICACIÓN>`
> 2. Descarga la aplicación e **instálala encima de la que ya está**. **No desinstales** la actual:
>    si la desinstalas, se puede perder el libro y el progreso.
> 3. Android te pedirá autorizar la instalación. Es normal: acéptala solo para esta descarga.
> 4. Abre la aplicación **con internet**.
> 5. **Inicia sesión si te lo pide** (la primera vez tras actualizar suele pedirlo).
> 6. Entra a un libro o abre la lista de lecturas, para que la aplicación se conecte una vez.
> 7. Anota en el formato que te enviamos el **código del equipo** y que quedó actualizado.
>
> Por favor **confirma equipo por equipo**, aunque varios usen la misma cuenta: la confirmación de
> uno no vale por los demás.
>
> **No anotes datos de los niños ni de las niñas**, ni nombres, ni correos: solo el código del
> equipo. **No compartas contraseñas** con nadie.
>
> Si algo falla —no descarga, no instala, no abre, no deja iniciar sesión, el equipo no está
> disponible— **no insistas**: escríbenos y te ayudamos.

### 8.2 Recordatorio del Día 7

> Hola. Recordatorio a mitad de la ventana de actualización de **Chibalete LU**.
>
> Si aún tienes equipos sin actualizar, el procedimiento es el mismo: abrir la dirección oficial
> `<URL_OFICIAL_CANÓNICA_PENDIENTE_DE_VERIFICACIÓN>`, instalar **encima** sin desinstalar, abrir la
> aplicación con internet, iniciar sesión si lo pide y entrar una vez a un libro o a la lista de
> lecturas.
>
> Cuéntanos también los casos que **no** se pudieron hacer: equipos que ya no se usan, que ya no
> tienen la aplicación, o a los que no tienes acceso. Esos casos también hay que registrarlos, con su
> código de equipo y sin datos de menores.
>
> Si tuviste cualquier error, escríbenos antes de volver a intentarlo.

### 8.3 Mensaje de conciliación del Día 13

> Hola. Estamos cerrando el registro de la actualización de **Chibalete LU**.
>
> Te pedimos revisar tu formato y dejar **cada equipo con un resultado**: actualizado, retirado del
> uso, ya no tiene la aplicación, o no fue posible acceder a él. Si alguno sigue pendiente, déjalo
> como pendiente: **es preferible un pendiente honesto a un dato supuesto**.
>
> Recuerda que la confirmación es **por equipo**, aunque compartan cuenta, y que solo necesitamos el
> **código del equipo**: sin nombres, sin correos, sin datos de menores.
>
> Si quedó algún equipo con error o sin poder actualizarse, escríbenos y lo resolvemos caso por caso.

---

## 9. Métricas agregadas

Único conjunto de métricas publicable. Todas **agregadas**:

```text
instituciones incluidas
docentes/mediadores designados
equipos inventariados
UPDATED
RETIRED
NO_LONGER_HAS_LU
INACCESSIBLE
PENDING
UNKNOWN
cuentas con señal 0.9.0, informadas aparte
porcentaje conciliado sobre equipos físicos
```

Reglas:

- **`cuentas con señal 0.9.0` se informa aparte**, en su propia línea, y **nunca** se suma, cruza ni
  presenta junto a los estados de equipo: son universos distintos.
- El **porcentaje conciliado** se calcula sobre **equipos físicos inventariados**. No sobre 180
  cuentas escolares, no sobre 26 cuentas con descarga, no sobre 5 cuentas con ejecución demostrada.
- **Prohibido** en cualquier reporte: nombres, correos, IP, identificadores de dispositivo, listados
  de personas y **rankings** de instituciones, cursos o docentes.
- Un reporte incompleto se publica **como incompleto**, con `PENDING` y `UNKNOWN` visibles. No se
  redondean a cero ni se omiten.

---

## 10. Condición previa a solicitar `T0`

**El Día 14 no fija `T0`.** El Día 14 produce un corte provisional y un reporte.

Solo podrá **solicitarse una decisión separada** sobre `T0` cuando se cumplan **todas** estas
condiciones:

```text
1. existe un denominador físico cerrado
2. todas las unidades están conciliadas
3. no quedan PENDING ni UNKNOWN
4. cada INACCESSIBLE tiene una decisión explícita registrada
5. cada UPDATED tiene evidencia técnica y confirmación humana
6. el gate 0.7.1 está resuelto
7. el resultado está firmado operacionalmente
```

Cumplirlas **habilita la solicitud**, no el valor. **Esta unidad no fija `T0`.** La definición
vigente sigue siendo la de `CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md` §6, y solo después de `T0`
corresponden **48 horas hábiles o más** de drain y, únicamente entonces, la reevaluación de
`ENFORCE`.

---

## 11. Límites de esta unidad

No se envió ningún mensaje. No se contactó ninguna institución, docente, familia ni menor. No se
publicó ningún enlace. No se fijó ninguna fecha real. No se inició la campaña. No se construyó
inventario. No se fijó `T0`. No se abrió el drain. `ENFORCE` sigue prohibido. No se instaló, probó,
compiló ni modificó ningún APK. No se tocó backend, Android, `forceUpdate` ni `minSupportedVersion`.
Cero producción, SSH, HTTP y tráfico sintético.

Este documento no contiene identificadores reales, PII, secretos ni URL inventada.

## 12. Único siguiente paso

**Decisión humana, no técnica:** designar a los docentes o mediadores responsables por institución y
verificar la **URL oficial canónica** de descarga. Sin responsables concretos y sin esa URL
verificada, la campaña no puede solicitarse; y con el gate `0.7.1` abierto, tampoco puede lanzarse de
forma masiva.
