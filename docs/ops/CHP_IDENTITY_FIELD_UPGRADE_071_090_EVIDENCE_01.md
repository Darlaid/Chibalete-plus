# CHP-IDENTITY-FIELD-UPGRADE-071-090-EVIDENCE-01

Fecha: 2026-08-29. Tipo: **QA en dispositivo físico**, con cierre documental. Carril A de
`CHP-ROADMAP-2026-05`. Ejecutado en dos unidades: `01A` (preflight, terminó
`YELLOW-UPGRADE-071-090-INCOMPLETE-OR-UNPROVABLE` por ausencia de dispositivo) y `01B` (ejecución
completa).

Cero producción, cero SSH, cero HTTP a producción, cero tráfico sintético, cero cambios de código,
cero commits fuera de `docs/ops/`.

Resuelve el gate que `CHP_IDENTITY_FIELD_UPDATE_CAMPAIGN_01.md` §5 dejó abierto como bloqueante.

---

## 1. Veredicto y alcance

```text
GREEN-UPGRADE-071-090-NONDESTRUCTIVE-DEVICE
```

Demostrado en un **REDMI 15C físico, Android 15 / API 35**, no emulador.

Alcance exacto, y nada más: **la ruta técnica entre los dos APK auditados es no destructiva**.

**No** demuestra, y no debe citarse como si lo hiciera:

- el inventario real de equipos;
- la actualización de ningún equipo de campo;
- cobertura del parque, ni parcial ni general;
- el inicio de la campaña;
- `T0`.

Un dispositivo probado **no equivale al parque**. Sigue vigente la separación de
`CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md` §4: cuenta, sesión, descarga, instalación y equipo
físico son universos distintos.

---

## 2. Identidad de binarios

```text
Package: com.chibalete.lu

0.7.1:
versionCode 8
SHA-256 f6516dfc6b31524f346a9f5460d2942e5d061f27caf9e79432c93903ff796d60

0.9.0:
versionCode 10
SHA-256 a925033054a4846a3ecff779e738f5abd7c55ca1831544f3219b809895888e0b

Certificado común (SHA-256 del certificado del firmante):
7cd34ce8438e28aee2c91bb73e295f8ed1c0981afc8134d2443c7cc59fa45f66
```

Mismo `applicationId`, mismo certificado exacto, `versionCode` creciente. Ambos APK son locales y
previamente auditados: no se descargó ni compiló ninguno.

**El APK 0.9.0 utilizado es byte-idéntico al artefacto canónico documentado para producción** en
`CHP_IDENTITY_LU_CANONICAL_DISTRIBUTION_01.md` §C (mismo SHA-256). La prueba se hizo, por tanto,
sobre el mismo binario que descargaría el campo, no sobre una compilación equivalente.

---

## 3. Método probatorio

Secuencia ejecutada, en orden:

```text
1.  desinstalación del LU preexistente (solo ese package)
2.  instalación limpia de 0.7.1
3.  login QA manual, tecleado en el dispositivo
4.  descarga de un libro ya asignado (sin crear asignaciones)
5.  progreso inicial procedente del servidor: 3 %
6.  lectura hasta un checkpoint local distinguible: 20 %
7.  corte efectivo de Wi-Fi y datos móviles
8.  confirmación offline en 0.7.1
9.  adb install -r de 0.9.0, con el dispositivo todavía sin red
10. confirmación offline equivalente en 0.9.0
11. restauración de la red al estado inicial exacto
12. reautenticación manual con la misma cuenta QA
13. una única acción conectada, confirmada por UI
```

Nota metodológica sobre el paso 6, que no es un detalle: el 3 % inicial **procedía del servidor** y
se habría repuesto en cualquier reinicio de sesión. Un checkpoint reponible por el servidor no
demuestra conservación local. Por eso el checkpoint se fijó deliberadamente en un valor
**distinguible del estado servidor**, y toda la comparación de las §5 se hizo **con la red cortada**,
donde ningún valor puede proceder de la red.

---

## 4. Continuidad de instalación

```text
package:           com.chibalete.lu  ->  com.chibalete.lu   idéntico
versionCode:       8  ->  10
firstInstallTime:  2026-08-29 14:29:58  ->  2026-08-29 14:29:58   SIN CAMBIO
appId / UID:       10351  ->  10351                                SIN CAMBIO
resultado:         adb install -r  ->  Success
```

`lastUpdateTime` pasó a `2026-08-29 17:35:29`, que es el comportamiento esperado de una
actualización.

**Durante el upgrade no hubo `uninstall`, `pm clear`, downgrade, reinstalación, restauración ni flags
alternativos.** Un solo intento, mediante reemplazo normal. La desinstalación del paso 1 pertenece a
la *preparación* del banco de pruebas —para partir de 0.7.1 limpia— y es anterior e independiente del
upgrade medido.

`firstInstallTime` y UID intactos son lo que prueba que fue **actualización sobre la instalación
existente**, y no una aplicación nueva.

---

## 5. Preservación local

Ambas mediciones se tomaron **con Wi-Fi y datos desactivados** y con la ausencia de red verificada de
forma independiente (`ping` a un destino público: *Network is unreachable*).

| Componente | 0.7.1 sin red | 0.9.0 sin red |
|---|---|---|
| Inicio | abre, sin crash | abre, sin crash |
| Estado del libro | `Listo · sin conexión` | `Listo · sin conexión` |
| Apertura del lector | desde almacenamiento local | desde almacenamiento local |
| Volumen renderizado | **103 247 caracteres** | **103 247 caracteres** |
| Posición | preservada | preservada |
| Progreso | **20 %** | **20 %** |
| `FATAL EXCEPTION` de LU | 0 | 0 |

El banner de la aplicación en ambos casos: `Sin conexión — usando datos guardados.`

Se midió únicamente el **volumen** de texto renderizado, como prueba de que el contenido reside en el
dispositivo. **No se copió, citó ni transcribió contenido del libro**, ni se inspeccionó la base
Room, el APK instalado ni los archivos del libro.

La igualdad exacta de los 103 247 caracteres antes y después del upgrade es la evidencia central de
que el contenido descargado sobrevivió intacto.

---

## 6. Reautenticación

```text
REAUTH_REQUIRED
```

Al recuperar la red, 0.9.0 mostró:

```text
Tu sesión expiró. Iniciá sesión de nuevo.
```

Lectura correcta de este hecho:

- **Es comportamiento esperado** al venir de 0.7.1: el cliente legacy no conservaba cookie, tal como
  ya recogía `CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md` §2.
- **No representa pérdida del libro ni del progreso.** El dato decisivo es que, con la sesión ya
  caducada, el libro seguía descargado y el progreso seguía en 20 %. La reautenticación afecta al
  acceso, no a los datos locales.
- **Debe advertirse antes de la campaña.** Sin aviso previo, un docente o mediador leerá la petición
  de login como un fallo de la actualización y la detendrá.
- **Docentes o mediadores necesitarán disponer de la credencial correspondiente** al equipo antes de
  empezar, o el recorrido se interrumpe a mitad.

Este documento no registra la credencial ni la identidad de la cuenta utilizada.

---

## 7. Acción conectada posterior

Tras la reautenticación manual, una única acción conectada:

```text
Sin sincronizar — se intentará después
->
Progreso guardado

Progreso: 20 %  ->  21 %
```

El progreso local pendiente subió al servidor. El paso de 20 % a 21 % corresponde al avance mínimo de
la propia reapertura del lector: **el progreso solo avanzó, y en ningún momento revirtió al 3 % que
tenía el servidor**.

Límite probatorio que debe conservarse literalmente:

- La build **release no expone código HTTP ni User-Agent en logs**. El buffer no mostró líneas
  atribuibles a la aplicación.
- Por tanto **no se afirma observación directa de un `2xx`**.
- Ni **observación directa de `ChibaleteLU/0.9.0`**.
- La confirmación de esta unidad es **de UI**, que es lo que el protocolo admite para QA en
  dispositivo.
- Ambos elementos —`2xx` autenticado y señal de versión— **siguen siendo evidencia que deberá
  conciliarse durante la campaña**, mediante el mecanismo operacional previsto en
  `CHP_IDENTITY_FIELD_UPDATE_CAMPAIGN_01.md` §3 y §4, y no se dan por adquiridos aquí.

---

## 8. Cierre seguro

```text
LU 0.9.0:            instalada, con sus datos
Conectividad:        restaurada al estado inicial exacto
Ajustes USB:         restaurados por el operador
ADB:                 cerrado, cero procesos residuales
Otros packages:      ninguno afectado (373 antes, 373 después)
Tráfico:             limitado a QA (2 logins manuales, 1 libro asignado, 1 sincronización)
Eventos QA:          ninguno borrado
Repositorios:        sin cambios durante la ejecución
```

La credencial QA nunca pasó por línea de comandos, variables de entorno, archivos ni `adb input`. No
se leyó keystore ni secreto alguno. Este documento no contiene credenciales, identidad de cuenta,
serial de dispositivo, direcciones IP, tokens ni PII.

> **Nota operacional, vinculante para la campaña.** Los permisos especiales de depuración utilizados
> por el banco de pruebas —depuración USB y sus ajustes de seguridad— fueron un **requisito del
> método ADB**, no del recorrido del campo. La campaña **no debe pedir a docentes o mediadores
> activar opciones de desarrollador**, depuración USB ni instalación vía USB. El recorrido real es el
> de `CHP_IDENTITY_FIELD_UPDATE_CAMPAIGN_01.md` §7: abrir la URL oficial, descargar e instalar encima
> desde el propio teléfono.

---

## 9. Efecto sobre el gate de campaña

`CHP_IDENTITY_FIELD_UPDATE_CAMPAIGN_01.md` §5 pasa de **bloqueante** a **resuelto**:

```text
0.8.0 -> 0.9.0:  demostrado previamente en dispositivo
0.7.1 -> 0.9.0:  RESUELTO — demostrado en dispositivo físico (esta unidad)
```

Los equipos identificados como `0.7.1` quedan **técnicamente habilitados**. `UNKNOWN` debe seguir
identificándose antes de seleccionar la ruta.

Esto **no autoriza la campaña**: su veredicto operativo sigue siendo
`AMBER-CAMPAIGN-NOT-YET-AUTHORIZED`, y los bloqueantes restantes son humanos. `T0` no está definido,
el drain no está iniciado y `ENFORCE` sigue prohibido.
