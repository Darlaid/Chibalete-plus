# CHP-IDENTITY-M1-FIELD-INVENTORY-MANAGEMENT-OVERRIDE-01

Fecha: 2026-09-09 (America/Bogota). Tipo: **registro documental de una decisión
directiva** (carril A de `CHP-ROADMAP-2026-05`, sucesor de
`CHP_IDENTITY_M1_FIELD_CAMPAIGN_AUTHORIZATION_01.md`). Cero mutaciones productivas,
cero tráfico sintético, cero telemetría nueva, cero intervención en dispositivos, cero
consulta a producción, cero modificación del artefacto aceptado.

Esta unidad **no ejecuta** `T0`, drain, `ENFORCE`, activación de eventos MOOK ni
cambio productivo alguno. Registra de forma transparente una excepción humana sobre el
cierre del inventario de campaña LU de Nuevo Bosque y Villas de Aranjuez.

---

## 1. Veredicto

**`GREEN-M1-INVENTORY-MANAGEMENT-OVERRIDE-PUBLISHED`**

Qué significa exactamente:

- el inventario de campaña queda **cerrado por atestación directiva**, no por
  reconciliación técnica;
- la reconciliación técnica del mismo día (`CHP-IDENTITY-M1-FIELD-INVENTORY-RECONCILIATION-01C-R2`)
  terminó en `STOP-M1-INVENTORY-R2-RECONCILIATION-INVALID` y **ese veredicto no se
  revierte ni se reinterpreta**: esta unidad no afirma que aquella auditoría pasó;
- `T0` **sigue bloqueado** hasta una unidad separada de autorización explícita;
- la aceptación directiva **no equivale al GREEN de M1**.

## 2. Baseline verificado

```text
Rama: chp/mook-contract-00
HEAD: 8c8857c4046c0576c158f62248865050651fa2f8
Local == remoto (git ls-remote, sin fetch)
Tracked limpio
3 untracked preexistentes, sin abrir ni modificar
3 stashes preexistentes, sin abrir ni modificar
```

## 3. Autoridad y decisión humana

```text
AUTORIDAD:
Nicolás Jiménez, Director de Chibalete Editores,
responsable de consolidación de M1

FECHA_DE_LA_DECISION:
2026-09-09, America/Bogota
```

Decisión registrada literalmente:

> Aceptar `Inventario_Campana_LU_2026_R2_lleno.csv` como declaración administrativa
> consolidada de la cohorte de Nuevo Bosque y Villas de Aranjuez.
>
> El archivo no se considera prueba de trazabilidad física individual, pero sí
> declaración humana suficiente para cerrar el inventario de campaña y continuar al
> gate independiente de autorización de T0.
>
> Se acepta que los 180 registros expresan una declaración común: dispositivo
> localizado, operativo, actualizado a LU 0.9.0 y validado satisfactoriamente.
>
> Se renuncia para esta campaña al requisito de demostrar un identificador único por
> dispositivo. Esta excepción no debe convertirse en regla general ni modificar el
> contrato técnico futuro.

## 4. Artefacto aceptado

Archivo privado, **no versionado** (gitignored), que conserva el detalle fila por fila:

```text
Users/Bases canónicas Finales/Inventario_Campana_LU_2026_R2_lleno.csv
Tamaño: 23626 bytes
SHA-256: 3350cecbb7e50ac7d38b6e79ee0282d7fd1a67f350cd547a091f8c9e907ebc59
```

Esta unidad verificó únicamente tamaño y hash. No abrió, normalizó ni modificó el CSV
ni ningún otro archivo de la carpeta. El hash coincide byte a byte con el artefacto
sobre el que se ejecutó la reconciliación técnica del mismo día.

## 5. Cohorte declarada

Estructura canónica confirmada por la reconciliación técnica (única parte de aquella
unidad que resultó válida) y aceptada aquí como base de la declaración:

```text
CUENTAS_CANONICAS: 180
NUEVO_BOSQUE: 90
VILLAS_DE_ARANJUEZ: 90
LECTORES: 160
MEDIADORES: 20
CORREOS_UNICOS: 180
CAMPOS_CANONICOS (institucion, nombre, email, curso, rol):
coinciden fila por fila con NuevoBosque.xlsx y VillasDeAranjuez.xlsx
```

Declaración consolidada aceptada para las 180 cuentas:

```text
DISPOSITIVO: localizado y operativo
VERSION_LU_DECLARADA: 0.9.0
ACTUALIZACION_DECLARADA: realizada
RESULTADO_DECLARADO: validación satisfactoria
EXCEPCIONES_DECLARADAS: 0
```

## 6. Equivalencias autorizadas

Registradas sin modificar el CSV:

```text
si
= respuesta afirmativa SI

fecha D/MM/YYYY
= fecha válida bajo convención colombiana, siempre que corresponda
al 9 de septiembre de 2026 y no sea futura al ejecutar la unidad

bolivar2 · bolivar3
= validación conjunta del equipo territorial FPD Bolívar

identificador repetido
= referencia común de cohorte; no identificador físico individual

observación uniforme
= declaración consolidada aplicable a toda la cohorte
```

Nota de transparencia sobre la fecha: la reconciliación técnica del mismo día registró
que la fecha uniforme del CSV tiene la forma `D/MM/YYYY` y corresponde al
**8 de septiembre de 2026**, un día antes de la apertura de la ventana de campaña
(2026-09-09). La condición literal de la equivalencia menciona el 9 de septiembre. Se
deja constancia de la diferencia sin reinterpretar la fecha ni corregir el CSV; la
valoración corresponde a la autoridad que emite la decisión. La fecha no es futura al
momento de ejecutar esta unidad.

## 7. Alcance de la renuncia

```text
RENUNCIA:
trazabilidad individual por dispositivo (identificador único por equipo)

ALCANCE:
exclusivamente la campaña LU 2026 de Nuevo Bosque y Villas de Aranjuez

NO_MODIFICA:
el contrato técnico de inventario (dominios, unicidad de identificador,
fecha ISO, un contacto FPD por fila) para campañas futuras

NO_CONSTITUYE:
regla general ni precedente para otras cohortes u organizaciones
```

## 8. Declaración humana vs. verificación técnica independiente

Lo que **sí** existe:

- una declaración administrativa consolidada, firmada por la dirección, que cubre las
  180 cuentas canónicas de ambos colegios;
- un artefacto con hash fijo que la respalda y que conserva el detalle en privado.

Lo que **no** existe y este documento no afirma:

- 180 identificadores únicos de dispositivo;
- 180 verificaciones técnicas independientes, una por equipo;
- evidencia telemétrica de que cada dispositivo abrió LU 0.9.0 (el sistema demuestra
  versión, sesión y cuenta, nunca dispositivo; ver
  `CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md`);
- un GREEN de la reconciliación técnica.

En consecuencia, la elegibilidad para `T0` que se registra abajo es **por atestación
directiva**, y cualquier unidad posterior debe citarla con esa calificación.

## 9. Privacidad

Este documento no contiene nombres, correos, identificadores de dispositivo,
contraseñas ni observaciones del CSV. La columna `Password` de las planillas no fue
leída en ninguna unidad de este frente. El detalle fila por fila permanece únicamente
en el CSV privado referenciado en §4.

## 10. Estado final

```text
INVENTARIO_FISICO: CLOSED_BY_MANAGEMENT_ATTESTATION
COHORT_ACCOUNTS: 180
DECLARED_READY: 180
DECLARED_EXCEPTIONS: 0
INDEPENDENTLY_VERIFIED_DEVICES: NOT_DEMONSTRATED
INDIVIDUAL_DEVICE_TRACEABILITY: WAIVED_FOR_THIS_CAMPAIGN
T0_ELIGIBLE_BY_MANAGEMENT_ATTESTATION: 180
T0: AWAITING_EXPLICIT_HUMAN_AUTHORIZATION
M1: AMBER-INVENTORY-ACCEPTED-AWAITING-T0
```

## 11. Siguiente paso

Una unidad separada de **autorización explícita de `T0`** por Nicolás Jiménez. Esta
unidad no la solicita, no la anticipa y no ejecuta ninguna acción técnica.

## 12. Mutaciones

Único archivo creado: este documento. Sin cambios en el CSV, en las planillas, en
producción ni en ningún otro archivo del repositorio.
