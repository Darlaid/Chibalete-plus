# CHP-IDENTITY-FIELD-UPDATE-CAMPAIGN-01

Fecha: 2026-08-29. Tipo: **diseño operacional, docs-only**. Carril A de `CHP-ROADMAP-2026-05`.
Continúa `CHP-IDENTITY-FIELD-UPDATE-CHANNEL-01`, que cerró
`AMBER-EXTERNAL-UPDATE-CAMPAIGN-REQUIRED`.

Cero producción, cero SSH, cero HTTP, cero tráfico sintético, cero APK, cero backend, cero Android,
cero mensajes enviados, cero contacto con instituciones, docentes, familias o menores.

> **Este documento no autoriza su propia ejecución.** Describe cómo se haría la campaña; no la
> inicia, no fija fechas reales, no publica enlaces, no abre el drain y no define `T0`.

**Actualización 2026-08-29:** el gate `0.7.1 → 0.9.0` de §5 quedó **resuelto** con QA en dispositivo
físico. Evidencia: `CHP_IDENTITY_FIELD_UPGRADE_071_090_EVIDENCE_01.md`. De ahí se incorporan a §7 y
§8 la advertencia de **reautenticación obligatoria** y la exigencia de tener la credencial
disponible. El veredicto operativo **no cambia**: sigue `AMBER-CAMPAIGN-NOT-YET-AUTHORIZED`.

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

## 5. Gate especial para 0.7.1 — **RESUELTO** (2026-08-29)

```text
0.8.0 -> 0.9.0: demostrado previamente en dispositivo
0.7.1 -> 0.9.0: RESUELTO — demostrado en dispositivo físico
```

La ruta `0.7.1 → 0.9.0` quedó demostrada en un dispositivo físico (Android 15 / API 35) con los APK
auditados: instalación encima sin `uninstall` ni `pm clear`, continuidad de package, UID y
`firstInstallTime`, libro conservado y accesible sin red, posición y progreso preservados, y
sincronización posterior funcional. Evidencia completa en
`CHP_IDENTITY_FIELD_UPGRADE_071_090_EVIDENCE_01.md`.

Regla de ejecución vigente:

- Los equipos identificados como `0.7.1` quedan **técnicamente habilitados**: ya no existe
  prohibición técnica de incluirlos en la actualización.
- **La campaña continúa sin autorización**, por motivos **operativos**, no técnicos. Ver §10 y el
  veredicto operativo.
- **`UNKNOWN` debe identificarse antes** de seleccionar la ruta de actualización de esa unidad: la
  versión instalada se determina mirándola en el equipo, porque `0.7.1` y `0.8.0` emiten el mismo
  User-Agent legacy y son indistinguibles desde el servidor.
- Los equipos `0.8.0` siguen el mismo recorrido de §7.

Lo que el gate resuelto **no** significa: no demuestra el inventario, no actualiza ningún equipo de
campo, no da cobertura del parque, no inicia la campaña y no fija `T0`. Un dispositivo probado no
equivale al parque.

Advertencia que este resultado incorpora al recorrido: **tras actualizar, LU pedirá iniciar sesión de
nuevo** (`REAUTH_REQUIRED`). Ver §6 del documento de evidencia y los pasos correspondientes en §7 y
§8.

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
tener a mano la credencial de esa unidad
recibir la instrucción
abrir únicamente la URL oficial
descargar el APK
no desinstalar LU ni borrar sus datos
autorizar la instalación cuando Android lo solicite
instalar sobre la aplicación existente
abrir LU con internet
iniciar sesión de nuevo — es normal que lo pida
ejecutar una acción conectada
observar señal 0.9.0 y 2xx
obtener confirmación humana
cerrar la fila
```

Notas de ejecución, todas demostradas en dispositivo o ya documentadas:

- **Instalar encima**: mismo `applicationId`, certificado idéntico y `versionCode` creciente. No
  desinstalar y **no borrar los datos de la aplicación**: desinstalar o limpiar datos puede perder
  libro y progreso sin necesidad ninguna. Instalando encima, ambos se conservan.
- **Autorización de Android**: el sistema pedirá permiso para instalar desde esta fuente. Es un paso
  humano previsto. **No se promete actualización silenciosa** —es imposible sin `PackageInstaller`,
  MDM ni tienda— y **no se recomienda desactivar ninguna protección general de Android**.
- **Reautenticación obligatoria** (`REAUTH_REQUIRED`), demostrada en dispositivo: al abrir 0.9.0 con
  red aparece «Tu sesión expiró. Iniciá sesión de nuevo.» porque el cliente legacy no conservaba
  cookie. **Es esperado, no es un fallo, y no implica pérdida del libro ni del progreso** — en la
  prueba, el libro seguía descargado y el progreso intacto con la sesión ya caducada. Sin este aviso
  previo, un responsable lo leerá como error y detendrá la actualización.
- **La credencial debe estar disponible antes de empezar**, o el recorrido se interrumpe a mitad, con
  el equipo ya actualizado y sin poder conciliarse.
- **Acción conectada**: abrir la app con red y usarla hasta producir una petición autenticada. Es el
  **único paso observable por el servidor**; los demás son humanos.
- **Confirmación humana**: sin ella la unidad no es `UPDATED`, por mucha señal técnica que haya.

> **Nada de opciones de desarrollador.** El recorrido del campo se hace **desde el propio teléfono**:
> abrir la URL oficial, descargar e instalar. La campaña **no debe pedir a nadie** activar opciones
> de desarrollador, depuración USB, depuración USB (ajustes de seguridad), instalación vía USB ni
> usar ADB. Esos permisos fueron un requisito del banco de pruebas, no del recorrido real.

Referencia de descarga:

```text
Artefacto canónico documentado:  /uploads/chibalete-lu-0.9.0.apk (versionName 0.9.0, versionCode 10)
URL pública a comunicar:         https://chibaleteplus.chibaleteeditores.com/#/chibalete-lu
```

La ruta del artefacto está documentada en `CHP_IDENTITY_LU_CANONICAL_DISTRIBUTION_01.md`. La **URL
pública quedó resuelta el 2026-09-03**: la página de descarga está desplegada, es estable y se abre
sin sesión. Evidencia en `CHP_IDENTITY_FIELD_PUBLIC_DOWNLOAD_PAGE_DEPLOY_01.md`.

**Se comunica la página, nunca el binario.** La URL de campaña es siempre la página
`/#/chibalete-lu`, no la ruta directa `/uploads/chibalete-lu-0.9.0.apk`: la página es la que muestra
la versión disponible, la advertencia de instalar encima sin borrar datos y el aviso de
reautenticación. Un enlace binario directo entrega el archivo sin ninguna de esas instrucciones, que
son precisamente lo que evita que un responsable pierda libro y progreso o interprete la
reautenticación como un fallo.

---

## 8. Comunicaciones preparatorias (redactadas, no enviadas)

Los tres textos siguientes son **borradores**. No se envían, no se publican y no se trasladan a
ningún canal dentro de esta unidad. Van dirigidos a **docentes o mediadores adultos**, nunca a
menores.

### 8.1 Mensaje inicial al docente o mediador

> Hola. Estamos actualizando la aplicación **Chibalete LU** en los equipos que se usan para leer.
> Te pedimos ayuda con los equipos que están a tu cargo.
>
> **Antes de empezar:** ten a mano la contraseña con la que entra cada equipo. Después de actualizar,
> la aplicación **va a pedir iniciar sesión otra vez**. Es completamente normal y no se pierde nada;
> pero si no tienes la contraseña a mano, te quedarás a mitad del proceso.
>
> Para cada equipo, uno por uno:
> 1. Abre únicamente esta dirección oficial:
>    `https://chibaleteplus.chibaleteeditores.com/#/chibalete-lu`
> 2. Descarga la aplicación e **instálala encima de la que ya está**. **No desinstales** la actual y
>    **no borres sus datos**: si lo haces, se puede perder el libro y el progreso. Instalando encima,
>    se conservan.
> 3. Android te pedirá autorizar la instalación. Es normal: acéptala solo para esta descarga.
> 4. Abre la aplicación **con internet**.
> 5. **Te va a pedir iniciar sesión de nuevo. Es normal, no es un error**: entra con la cuenta de
>    siempre de ese equipo. El libro y el progreso siguen ahí.
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
> `https://chibaleteplus.chibaleteeditores.com/#/chibalete-lu`, instalar **encima** sin desinstalar ni borrar
> datos, abrir la aplicación con internet, **iniciar sesión de nuevo cuando lo pida —es normal— y**
> entrar una vez a un libro o a la lista de lecturas.
>
> Recuerda tener a mano la contraseña de cada equipo antes de empezar: la aplicación la pedirá
> siempre después de actualizar, y no significa que se haya perdido nada.
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
> Un equipo cuenta como actualizado solo si, después de instalar, **se pudo iniciar sesión de nuevo**
> y abrir una vez un libro o la lista de lecturas. Si se quedó pidiendo la contraseña y no la tenías,
> márcalo como pendiente y dinos: no es un fallo del equipo.
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

## 12. Estado operativo

```text
AMBER-CAMPAIGN-NOT-YET-AUTHORIZED
```

Bloqueantes restantes, **todos humanos u operativos, ninguno técnico**:

```text
responsables concretos por institución   pendiente
fechas reales aprobadas                  pendiente
inventario físico                        por construir
```

Resuelto el 2026-09-03:

```text
URL pública canónica   RESUELTO — página estable, anónima y desplegada
                       https://chibaleteplus.chibaleteeditores.com/#/chibalete-lu
                       Evidencia: CHP_IDENTITY_FIELD_PUBLIC_DOWNLOAD_PAGE_DEPLOY_01.md
```

El veredicto **no cambia**: sigue `AMBER-CAMPAIGN-NOT-YET-AUTHORIZED`. Tener la URL elimina un
bloqueante de comunicación, no autoriza la campaña ni sustituye ninguno de los tres pendientes
anteriores. **Publicar la página no notificó, no descargó y no actualizó ningún dispositivo.**

Invariantes que no cambian ni con el gate resuelto ni con la URL pública desplegada:

```text
180        = cuentas escolares, no equipos
T0         = no definido
drain      = no iniciado
ENFORCE    = prohibido
campaña    = no iniciada
```

## 13. Único siguiente paso

**Decisión humana, no técnica:** designar a los docentes o mediadores responsables por institución.
La **URL oficial canónica** ya no es un pendiente: quedó resuelta el 2026-09-03 y está en §7. Sin
responsables concretos, la campaña no puede solicitarse.
