# CHP-IDENTITY-FIELD-UPDATE-CHANNEL-01

Fecha: 2026-08-28. Tipo: preflight **read-only** sobre el canal de alerta y actualización del parque
LU instalado, más su auditoría de interrupción y un microgate de procesos. Carril A de
`CHP-ROADMAP-2026-05`. Cero mutaciones, cero builds, cero APK, cero deploys, cero mensajes, cero
tráfico sintético, cero contacto con usuarios.

Continúa `CHP-IDENTITY-LU-CANONICAL-DISTRIBUTION-01` y `CHP-IDENTITY-FIELD-MIGRATION-EVIDENCE-01`.

---

## 1. Veredictos

```text
Canal funcional:  AMBER-EXTERNAL-UPDATE-CAMPAIGN-REQUIRED
Auditoría:        GREEN-PREVIOUS-PREFLIGHT-COMPLETE-AND-REVALIDATED
Procesos:         GREEN-NO-RESIDUAL-SHELL
```

El preflight se ejecutó el 2026-08-28 entre las 22:24Z y las 22:30Z y **emitió su reporte completo**.
Un corte eléctrico posterior hizo dudar de su terminación; la auditoría reconstruyó las 13
comprobaciones read-only, las revalidó de forma independiente y confirmó las conclusiones.

## 2. Estado actual

```text
LU 0.9.0:        canónica para nuevas descargas
Campo migrado:   NO
T0:              NO DEFINIDO
Drain:           NO INICIADO
ENFORCE:         PROHIBIDO
M1-A:            AMBER
```

## 3. Conclusión técnica

- **0.7.1, 0.8.0 y 0.9.0 no incluyen receptor de actualización.** Ninguna de las tres.
- **No hay FCM, push, polling, worker, servicio ni receiver operativo** en ninguna versión: sin
  clases Firebase, sin `google-services.json`, sin `androidx.work`, `AlarmManager`, `JobScheduler`,
  `BOOT_COMPLETED`, WebSocket ni SSE. El manifiesto declara **una sola `<activity>`**, cero
  `<service>` y cero `<receiver>` propios, y solo los permisos `INTERNET`, `ACCESS_NETWORK_STATE` y
  `DUMP` — **sin `POST_NOTIFICATIONS`**.
- **`/api/lu/version` existe, pero su consumidor es la página web, no Android.** El handler vive en
  `server/server.js` y sirve `version`, `apkUrl`, `forceUpdate`, `notes` y `minSupportedVersion`;
  el único consumidor en todo el árbol es `pages/ChibaleteLU.tsx` (y sus copias compiladas o de
  despliegue). La cadena `api/lu/version` **no aparece en el dex de ningún APK**.
- Corolario que conviene fijar: **activar `forceUpdate` no alcanzaría a un solo dispositivo**. Solo
  pinta un banner en una página web que el usuario de LU no visita. La prohibición de tocarlo sigue
  vigente, pero su alcance real es la web, no el parque.
- Los eventos `version_check`, `download_start` y `download_success` pertenecen a
  `hooks/useLuAnalytics.ts`, es decir a la **web de distribución**. Una descarga web **no demuestra
  instalación**.
- La cadena `com.google.android.gms` sí aparece en el dex de las tres versiones, pero **no hay
  componente gms en el manifiesto, ni `google-services.json`, ni clases FCM**: es residuo de una
  dependencia, **no un canal**.
- **Ninguna infraestructura actual permite avisar retroactivamente a las instalaciones legacy.**
- **Crear un receptor futuro no alcanzaría por sí mismo a 0.7.1 ni 0.8.0.** Una 0.9.x que
  incorporase la comprobación seguiría sin llegar a las versiones ya instaladas, que son
  precisamente las que hay que alcanzar.

Recuperar internet **no produce ninguna petición por sí solo**: sin la app abierta, el dispositivo es
inalcanzable. Al abrirla, el recorrido real es `GET /api/offline/assignment` (más `sync` y
`analytics` si hay pendientes), y la respuesta se deserializa en una data class Gson cerrada: los
campos desconocidos se ignoran en silencio y **no hay UI capaz de mostrar un mensaje del servidor**.

## 4. Compatibilidad de actualización

- **Mismo `applicationId`** (`com.chibalete.lu`), **certificado compatible** —misma huella en las
  tres versiones— y **`versionCode` creciente** (8 → 9 → 10). Instalar 0.9.0 encima de una versión
  legacy es técnicamente posible.
- **`0.8.0 → 0.9.0`: demostrado en dispositivo real** sin pérdida relevante (conserva instalación,
  libro y progreso).
- **`0.7.1 → 0.9.0`: técnicamente esperable, pero NO demostrado en dispositivo.** Se verificó que
  0.7.1 ya lleva el mismo esquema Room v4, con las migraciones aditivas 2→3 y 3→4 presentes en su
  dex, y que el comportamiento destructivo solo actúa **en downgrade**. **No elevar esta ruta a
  «verificada».**
- El **primer login tras actualizar es obligatorio** desde 0.7.1 y 0.8.0, que no conservaban cookie.
- **La actualización silenciosa es imposible** con lo desplegado: sin `PackageInstaller`, sin MDM,
  sin tienda. Android exige que el usuario autorice la instalación desde orígenes desconocidos.

Cadena real, separada por responsable:

```text
recibir el aviso            -> solo por canal externo
descargar el APK            -> acto del usuario
autorizar la instalación    -> acto del usuario
instalar sobre la existente -> acto del usuario
abrir LU 0.9.0              -> acto del usuario
iniciar sesión              -> acto del usuario
producir evidencia 0.9.0    -> único paso observable por el servidor
```

Siete pasos, **seis de ellos humanos**.

## 5. Canal requerido

La migración necesita una **campaña externa** dirigida a **instituciones, coordinadores o
docentes-mediadores**. **No se autoriza comunicación directa con menores.**

No existe alternativa dentro del producto: el backend **no tiene sistema de avisos ni difusión**, y
**la plataforma no puede enviar correo** (sin mailer, SMTP ni proveedor). El padrón solo guarda
`email`, `colegio`, `curso` y `groupIds`: **no hay teléfono, acudiente ni contacto de familia**.

Un aviso dentro de Chibalete+ web **no alcanza a quien solo usa LU**.

## 6. Unidad de conciliación

**Una cuenta no equivale a un dispositivo.** No existe `ANDROID_ID`, UUID persistido ni ningún
identificador estable de instalación en el cliente. Para cerrar cada equipo deben coexistir:

```text
evidencia técnica:
ChibaleteLU/0.9.0 + sesión autenticada + acción conectada 2xx

confirmación humana:
actualizado
retirado del parque
ya no tiene LU
inaccesible
pendiente
desconocido
```

Una señal 0.9.0 procedente de una **cuenta compartida** no declara migrados todos los equipos que la
usan. Campaña enviada no equivale a campaña recibida; descarga no equivale a actualización; señal de
cuenta no equivale a equipo.

## 7. Aclaración de los «~180»

```text
180 cuentas escolares:  conteo agregado verificado
~180 equipos:           estimación humana todavía no validada
```

**La coincidencia numérica no demuestra que sean el mismo universo.** Es una señal que invita a
sospechar que la estimación humana recontó cuentas, no equipos, pero mientras no se resuelva con
información humana ambas cifras deben mantenerse **separadas y sin equiparar**.

Del conteo agregado escolar: 160 lectores, 180 con grupo asignado, 57 con algún login histórico.

## 8. Correcciones al reporte original del preflight

La auditoría encontró dos datos que deben quedar corregidos. Ninguno altera el veredicto.

**a) Desglose escolar inexistente.** Donde el reporte decía «3 cuentas escolares con LU», debe
leerse:

```text
5 cuentas con señal LU-Android:
4 de campo
1 de QA excluida
sin desglose escolar demostrado
```

El único desglose escolar trazado corresponde a **descargas** (24 de 26 cuentas), no a ejecución.

**b) Número de endpoints.** El conteo original omitía `@DELETE`:

```text
0.8.0: 7
0.9.0: 8
/api/lu/version: ausente en ambas
```

## 9. Enmienda sobre el shell

Al pie del reporte de auditoría apareció `1 shell still running`, en aparente contradicción con la
afirmación «0 procesos residuales». Reconciliación:

- El contador **era correcto**.
- Correspondía al `grep -rn "api/lu/version"` **read-only iniciado por la propia auditoría**, que el
  harness movió a segundo plano por superar el tiempo de espera.
- La consulta inicial de procesos solo cubría `adb/gradle/emulator/ssh`; por eso **no detectó
  `bash`**. La cifra era cierta para la clase consultada, pero se presentó como afirmación general.
- El `grep` **terminó por sí mismo con `exit 0`** y su salida fue leída y utilizada.
- La revalidación posterior confirmó **ausencia de shells persistentes**.
- **No hubo proceso ajeno, incidente, mutación ni acción de limpieza.**

## 10. Pendientes humanos que bloquean la campaña

```text
a. Elegir el canal institucional y su responsable.
b. Determinar el inventario real de equipos, separado de las cuentas.
c. Definir una franja de uso con conectividad.
```

Ninguno es técnico. Sin ellos, cualquier envío es un disparo al aire cuyo resultado no podría
conciliarse.

## 11. Condición de `T0`

`T0` solo podrá fijarse cuando exista un **inventario físico acotado** y **cada unidad esté
conciliada** como actualizada, retirada o excluida mediante decisión documentada.

```text
T0 = instante del último login 0.9.0 más assignment/sync 2xx
     de la última unidad pendiente de un inventario humano CERRADO
```

**No** constituyen `T0`: enviar la alerta, publicar el enlace, observar la primera cuenta 0.9.0,
completar las 26 cuentas conocidas, la ausencia posterior de tráfico legacy, ni la existencia de
equipos físicos sin conciliar.

Solo después de `T0`: **48 horas hábiles o más** de drain con los criterios ya aprobados, y solo
entonces se reevalúa `ENFORCE`.

## 12. Límites de esta unidad

No se diseñó ni ejecutó campaña alguna. No se envió ningún aviso. No se desarrolló ningún mecanismo.
No se tocó `forceUpdate` ni `minSupportedVersion`. No se bloqueó ninguna versión legacy. No se abrió
el drain. `ENFORCE` sigue prohibido. Ninguna capacidad futura de 0.9.0 se convierte en capacidad
retroactiva de 0.7.1 o 0.8.0.

Este documento no contiene identificadores reales: todo lo relativo a cuentas es conteo agregado.

## 13. Único siguiente paso

**Decisión humana, no técnica:** elegir el canal institucional y su responsable, y aclarar si los
~180 son equipos o cuentas. Con eso y la franja de uso, el inventario puede cerrarse y la campaña
redactarse.
