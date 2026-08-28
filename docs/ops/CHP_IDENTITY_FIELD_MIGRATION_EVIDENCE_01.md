# CHP-IDENTITY-FIELD-MIGRATION-EVIDENCE-01

Fecha: 2026-08-28 (21:16–21:20Z). Tipo: preflight **read-only** sobre el parque LU instalado y el
contrato de evidencia. Carril A de `CHP-ROADMAP-2026-05`. Cero mutaciones, cero tráfico sintético,
cero telemetría nueva, cero intervención en dispositivos, cero contacto con usuarios.

---

## 1. Veredicto y alcance

**`AMBER-HUMAN-INVENTORY-OR-SCHEDULE-REQUIRED`**

Qué significa exactamente:

- la evidencia técnica disponible **sí** permite reconocer **versión, sesión y cuenta**;
- **no existe identidad estable de instalación ni de dispositivo**;
- falta acotar el parque físico con **información humana**;
- **el bloqueo es operacional, no arquitectónico**.

No hay `T0`, no se abre el drain y `ENFORCE` sigue prohibido.

## 2. Contrato reconstruido

- **Migración de campo** = instalar 0.9.0 **sobre el equipo existente**, abrir la app **con red** y
  hacer **login** (credencial tecleada por cada usuario).
- El **upgrade 0.8.0 → 0.9.0 está validado como no destructivo**: conserva instalación, libro y
  progreso (GREEN-DEVICE / GREEN-CANARY).
- **El login es necesario** porque el cliente legacy no conservaba cookie. Una reinstalación
  0.9.0 → 0.9.0, en cambio, no lo pide.
- El **User-Agent `ChibaleteLU/0.9.0`** demuestra **versión por sesión/petición**
  (`AuthInterceptor.kt`, construido desde `BuildConfig.VERSION_NAME`).
- Un **2xx con ese UA demuestra sesión firmada**, porque 0.9.0 **no envía `x-user-id`**: no tiene
  otra credencial que ofrecer.
- **`source` / `appSurface = lu_android`** demuestra **uso Android por cuenta**, y está persistido
  (dos stores independientes que coinciden).
- **No existe `ANDROID_ID`, UUID persistido ni ningún identificador estable de dispositivo** en el
  cliente. El `sessionId` es un UUID aleatorio por sesión de lectura.

## 3. Parque técnicamente demostrable

```text
Descargas históricas registradas:               62
Cuentas distintas que descargaron:              26
Cuentas escolares entre ellas:                  24
Cuentas con ejecución LU-Android demostrada:     5
Campo demostrado:                                4 cuentas
QA 0.9.0 demostrado:                             1 cuenta (excluida del campo)
Campo con 0.9.0 demostrado:                      0 cuentas
```

Conclusiones que deben preservarse tal cual:

```text
Parque físico total:            no demostrable
Instalaciones confirmadas:      entre 5 y 26 CUENTAS, no dispositivos
Unidades físicas desconocidas:  no acotables por arriba
```

Todas las descargas registradas son anteriores al cambio canónico de hoy, es decir, **de cliente
legacy**. Los datos anteriores son agregados: este documento no incorpora identificadores reales,
correos, direcciones IP ni nombres.

## 4. Límites de las señales

- **Cuenta, sesión, IP y dispositivo no son equivalentes.** Una cuenta puede usar cero, uno o varios
  equipos.
- **La IP nunca es identidad**: sirve como contexto forense redactado y nada más.
- **0.7.1 y 0.8.0 emiten el mismo UA legacy genérico** → son indistinguibles entre sí.
- **La versión solo es visible en el access log del edge**; no se persiste en ningún store.
- **La retención del edge es volátil** (vive con el contenedor).
- **`/uploads` no registra las descargas** directamente.
- **Desde el 18 de agosto la analítica legacy puede ser descartada por la mitigación 202**, de modo
  que los stores dejan de ver actividad legacy posterior.
- **El silencio del campo no equivale a migración.**
- **Descargar no equivale a instalar, ni instalar a usar.**

Estos límites **no se corrigen dentro de M1-A**: son el marco con el que hay que trabajar.

## 5. Paquete mínimo de evidencia (contrato operacional futuro)

```text
1. Inventario humano cerrado.
2. Instalación o upgrade a 0.9.0.
3. Login 200 con UA ChibaleteLU/0.9.0.
4. Assignment o sync 2xx posterior con el mismo UA.
5. Cero uso legacy posterior asociado a esa cuenta.
6. Cero 401/403/5xx anómalos en la secuencia.
```

El servidor demuestra **cuenta y sesión**. La correspondencia con el **equipo físico** depende
enteramente del inventario humano.

## 6. Definición de `T0`

```text
T0 = instante del último login 0.9.0 más assignment/sync exitoso
     de la última unidad incluida en un inventario humano cerrado.
```

**No** constituyen `T0`: publicar 0.9.0 · el paso del tiempo · el silencio escolar · la ausencia de
legacy en un parque inactivo · migrar el dispositivo de QA · migrar una parte indeterminada del
parque.

## 7. Ventana posterior

Solo después de `T0`: **≥48 horas hábiles**, con los criterios ya aprobados —0.9.0 sin regresiones ·
sin legacy incompatible · 202-drop sin crecimiento · sin 401/403 anómalos · sin 5xx atribuibles ·
UNKNOWN que no invalide la lectura · producción healthy—. **Esa ventana no se abre ni se simula
aquí.**

## 8. Decisiones humanas recibidas

```text
Inventario:    pendiente; Nicolás necesita reconstruirlo.
Calendario:    no existe todavía una fecha de uso real.
Instalación:   será realizada por cada usuario.
```

Consecuencia directa:

```text
CHP-IDENTITY-FIELD-INVENTORY-CLOSE-01 = BLOQUEADA
M1-A = AMBER
ENFORCE = PROHIBIDO
```

## 9. Próxima acción humana

Una **lista operacional mínima**, mantenida **fuera del repositorio** y sin credenciales:

| Campo | Obligatorio |
|---|---|
| Código operativo del equipo | sí |
| Cuenta asociada o pseudónimo | sí |
| Custodio o canal de contacto | sí |
| ¿LU sigue instalada? | sí |
| Versión conocida | sí / unknown |
| ¿Puede actualizarse? | sí / no / unknown |
| Fecha posible de apertura con red | pendiente |
| Primer login 0.9.0 verificado | pendiente |

Reglas de esa lista: **no** almacenar contraseñas · **no** incorporarla al repositorio · **no**
registrar IP · **no** recopilar datos personales adicionales · **no** crear una herramienta para
administrarla.

El trabajo técnico de M1-A queda detenido hasta que exista ese inventario o una fecha real de
coordinación.
