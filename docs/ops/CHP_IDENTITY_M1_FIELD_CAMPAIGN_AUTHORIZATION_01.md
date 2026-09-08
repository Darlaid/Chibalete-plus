# CHP-IDENTITY-M1-FIELD-CAMPAIGN-AUTHORIZATION-01

Fecha: 2026-09-08. Tipo: **registro documental de autorización** (carril A de
`CHP-ROADMAP-2026-05`, sucesor de `CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md`).
Cero mutaciones productivas, cero tráfico sintético, cero telemetría nueva, cero
intervención en dispositivos, cero consulta a producción.

Esta unidad **no ejecuta** campaña, inventario, `T0`, drain, `ENFORCE`, activación de
eventos MOOK ni cambio productivo alguno. Registra formalmente los insumos humanos y la
autorización para ejecutar la campaña de campo LU en Nuevo Bosque y Villas de Aranjuez.

---

## 1. Veredicto

**`GREEN-M1-FIELD-CAMPAIGN-AUTHORIZATION-PUBLISHED`**

Qué significa exactamente:

- la campaña de campo LU queda **autorizada** con responsables, contactos, ventana y
  fecha límite definidos por decisión humana;
- el inventario físico **todavía no se ha ejecutado**;
- `T0`, drain y `ENFORCE` **siguen bloqueados** hasta el cierre de ambos inventarios;
- la autorización de campaña **no equivale al GREEN de M1**.

## 2. Baseline verificado

```text
Rama: chp/mook-contract-00
HEAD: 7588a86789394dfb4ee98bfbb1eb82d099a62d7f
Local == remoto (git ls-remote, sin fetch)
Tracked limpio
3 untracked preexistentes, sin abrir ni modificar
3 stashes preexistentes, sin abrir ni modificar
```

## 3. Insumos humanos aprobados

Registrados literalmente tal como fueron decididos:

```text
INSTITUCION_1: Nuevo Bosque
RESPONSABLE_INSTITUCIONAL_1:
Equipo territorial Bolívar de Fundación Pies Descalzos
CONTACTOS_OPERATIVOS_1:
canales institucionales bolivar2 y bolivar3
ROL_1:
enlaces institucionales y responsables de validación en campo
VENTANA_1:
2026-09-09 a 2026-09-30, hora de Colombia

INSTITUCION_2: Villas de Aranjuez
RESPONSABLE_INSTITUCIONAL_2:
Equipo territorial Bolívar de Fundación Pies Descalzos
CONTACTOS_OPERATIVOS_2:
canales institucionales bolivar2 y bolivar3
ROL_2:
enlaces institucionales y responsables de validación en campo
VENTANA_2:
2026-09-09 a 2026-09-30, hora de Colombia

FUENTE_DEL_INVENTARIO_FISICO:
verificación directa de los dispositivos en cada colegio,
reportada mediante los enlaces institucionales de FPD Bolívar

RESPONSABLE_DE_CONSOLIDACION:
Nicolás Jiménez, Chibalete Editores

FECHA_LIMITE_GLOBAL:
2026-09-30, 23:59, America/Bogota

DISPOSITIVOS_NO_LOCALIZADOS_O_INOPERABLES:
quedan expresamente fuera de T0 hasta ser localizados o reparados;
no se eliminan cuentas, registros ni evidencias y no bloquean el
avance de los dispositivos correctamente verificados

PERSONA_QUE_AUTORIZARA_T0:
Nicolás Jiménez

CONDICION_DE_AUTORIZACION_T0:
inventarios de ambos colegios cerrados, discrepancias clasificadas
y aprobación explícita posterior de Nicolás Jiménez
```

Este documento **no contiene** correos, teléfonos, contraseñas, seriales, nombres de
estudiantes ni bases de usuarios. Los contactos se identifican únicamente por canal
institucional.

## 4. Responsables y roles

| Institución | Responsable institucional | Contactos operativos | Rol |
|---|---|---|---|
| Nuevo Bosque | Equipo territorial Bolívar de Fundación Pies Descalzos | canales institucionales bolivar2 y bolivar3 | enlaces institucionales y responsables de validación en campo |
| Villas de Aranjuez | Equipo territorial Bolívar de Fundación Pies Descalzos | canales institucionales bolivar2 y bolivar3 | enlaces institucionales y responsables de validación en campo |

Responsable de consolidación del inventario y persona que autorizará `T0`:
**Nicolás Jiménez, Chibalete Editores**.

## 5. Fuente y responsable del inventario físico

- **Fuente:** verificación directa de los dispositivos en cada colegio, reportada mediante
  los enlaces institucionales de FPD Bolívar.
- **Consolidación:** Nicolás Jiménez, Chibalete Editores.
- Un inventario se considera **cerrado** cuando la institución ha reportado la totalidad
  de sus dispositivos y cada discrepancia queda clasificada (verificado, no localizado,
  inoperable).

## 6. Ventanas y fecha límite

| Institución | Ventana (hora de Colombia) |
|---|---|
| Nuevo Bosque | 2026-09-09 a 2026-09-30 |
| Villas de Aranjuez | 2026-09-09 a 2026-09-30 |

Fecha límite global: **2026-09-30, 23:59, America/Bogota**.

## 7. Política de excepciones

Dispositivos no localizados o inoperables:

- quedan **expresamente fuera de `T0`** hasta ser localizados o reparados;
- **no se eliminan** cuentas, registros ni evidencias;
- **no bloquean** el avance de los dispositivos correctamente verificados.

## 8. Gate de `T0`

`T0` solo puede fijarse cuando se cumplan **todas** estas condiciones:

1. inventario de Nuevo Bosque cerrado;
2. inventario de Villas de Aranjuez cerrado;
3. discrepancias clasificadas;
4. aprobación explícita **posterior** de Nicolás Jiménez.

Persona que autorizará `T0`: Nicolás Jiménez. Este documento **no** constituye esa
aprobación.

## 9. Evidencia de procedencia (antecedente)

- 15 de abril de 2026: encuentro sobre la Plataforma Chibalete+ con el frente territorial
  de Bolívar.
- 14 de mayo de 2026: encuentro Fundación Pies Descalzos–Chibalete.
- 1 de junio de 2026: encuentro FPD Bolívar–VdA.
- 8 de septiembre de 2026: decisión humana de aceptar los enlaces institucionales
  disponibles y aprobar la ventana del 9 al 30 de septiembre.

Se registra únicamente como antecedente. No se volvió a consultar Calendar, Gmail, Drive
ni producción para elaborar este documento.

## 10. Estado resultante

```text
CAMPAÑA_LU: AUTORIZADA
VENTANA: 2026-09-09/2026-09-30
INVENTARIO_FISICO: PENDIENTE_DE_EJECUCION
T0: BLOQUEADO_HASTA_CIERRE_DE_AMBOS_INVENTARIOS
DRAIN: NO_AUTORIZADO
ENFORCE: NO_AUTORIZADO
MOOK_EVENTS_PRODUCTION: NO_AUTORIZADO
M1: AMBER-CAMPAIGN-AUTHORIZED-AWAITING-FIELD-EVIDENCE
```

La autorización de campaña **no equivale al GREEN de M1**.

## 11. Siguiente paso

El único siguiente paso es **comenzar la recopilación del inventario físico** a través de
los enlaces institucionales, dentro de la ventana autorizada. No ejecutar `T0`.
