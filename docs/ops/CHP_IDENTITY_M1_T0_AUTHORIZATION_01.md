# CHP-IDENTITY-M1-T0-AUTHORIZATION-01

Fecha: 2026-09-09 (America/Bogota). Tipo: **registro documental de una autorización
directiva** (carril A de `CHP-ROADMAP-2026-05`, sucesor de
`CHP_IDENTITY_M1_FIELD_INVENTORY_MANAGEMENT_OVERRIDE_01.md`). Cero mutaciones
productivas, cero tráfico sintético, cero telemetría nueva, cero intervención en
dispositivos, cero consulta a producción, cero lectura de planillas o CSV privados.

Esta unidad **no ejecuta** `T0`, drain, `ENFORCE`, activación de eventos MOOK en
producción ni cambio productivo alguno. Registra la autorización humana expresa para
que una unidad posterior establezca `T0`.

---

## 1. Veredicto

**`GREEN-M1-T0-AUTHORIZATION-PUBLISHED`**

Qué significa exactamente:

- `T0` queda **autorizado** para las 180 cuentas de Nuevo Bosque y Villas de Aranjuez
  por decisión directiva;
- `T0` **no se ha ejecutado**: la ejecución corresponde a una unidad separada con su
  propio preflight productivo;
- drain, `ENFORCE` y activación MOOK en producción **siguen no autorizados**;
- el STOP técnico de `CHP-IDENTITY-M1-FIELD-INVENTORY-RECONCILIATION-01C-R2`
  **no se revierte** ni se presenta como GREEN; el fundamento de esta autorización es
  exclusivamente la atestación directiva.

## 2. Baseline verificado

```text
Rama: chp/mook-contract-00
HEAD: 8e6ea5e3050058c1502ccc1f8679088553ed3f12
Local == remoto (git ls-remote, sin fetch)
Tracked limpio
3 untracked preexistentes, sin abrir ni modificar
3 stashes preexistentes, sin abrir ni modificar
```

## 3. Fuente documental

Única fuente leída:
`docs/ops/CHP_IDENTITY_M1_FIELD_INVENTORY_MANAGEMENT_OVERRIDE_01.md`, publicada en el
commit `8e6ea5e3050058c1502ccc1f8679088553ed3f12`.

Valores confirmados en su bloque de estado final:

```text
COHORT_ACCOUNTS: 180
DECLARED_READY: 180
DECLARED_EXCEPTIONS: 0
INDEPENDENTLY_VERIFIED_DEVICES: NOT_DEMONSTRATED
INDIVIDUAL_DEVICE_TRACEABILITY: WAIVED_FOR_THIS_CAMPAIGN
T0: AWAITING_EXPLICIT_HUMAN_AUTHORIZATION
```

## 4. Autorización humana

```text
AUTORIDAD:
Nicolás Jiménez
Director de Chibalete Editores

FECHA: 2026-09-09
ZONA_HORARIA: America/Bogota

COMMIT_DEL_OVERRIDE_INVOCADO:
8e6ea5e3050058c1502ccc1f8679088553ed3f12
```

Texto literal de la autorización:

> Autorizo T0 para las 180 cuentas de Nuevo Bosque y Villas de Aranjuez con base
> exclusiva en la atestación directiva registrada en el commit cuyo prefijo es
> `8e6ea5e`.
>
> Reconozco que no existe trazabilidad individual por dispositivo, que no están
> demostradas 180 verificaciones técnicas independientes y que la fecha uniforme del
> CSV corresponde al 8 de septiembre de 2026, un día antes de la ventana inicialmente
> autorizada.
>
> Acepto expresamente esas limitaciones y autorizo que las 180 cuentas sean
> consideradas elegibles para T0 por decisión directiva. Esta autorización no ejecuta
> T0, drain ni ENFORCE.

## 5. Cohorte autorizada

```text
CUENTAS: 180
INSTITUCIONES: Nuevo Bosque, Villas de Aranjuez
FUNDAMENTO_EXCLUSIVO: atestación directiva (override 8e6ea5e)
```

## 6. Limitaciones reconocidas expresamente

- **No existe trazabilidad individual por dispositivo.** La renuncia registrada en el
  override aplica solo a esta campaña y no modifica el contrato técnico futuro.
- **No están demostradas 180 verificaciones técnicas independientes.** El sistema
  demuestra versión, sesión y cuenta, nunca dispositivo (ver
  `CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md`).
- **La fecha uniforme del CSV es anterior a la ventana.** Corresponde al 8 de
  septiembre de 2026; la ventana autorizada en
  `CHP_IDENTITY_M1_FIELD_CAMPAIGN_AUTHORIZATION_01.md` abría el 9 de septiembre. La
  autoridad acepta la diferencia de forma expresa.
- **La reconciliación técnica terminó en STOP.** Esta autorización no la convierte en
  GREEN; la sustituye por decisión humana documentada.

## 7. Alcance

Lo que esta autorización **habilita**:

- que una unidad posterior formule el preflight productivo de `T0` y, tras superarlo,
  establezca `T0` para las 180 cuentas de la cohorte.

Lo que esta autorización **no habilita**:

- ejecutar `T0` desde esta unidad;
- ejecutar drain de identidad legacy;
- activar `ENFORCE` de sesión o de autorización por tenant;
- activar eventos MOOK en producción;
- extender la elegibilidad a cuentas fuera de la cohorte de 180;
- reutilizar la renuncia de trazabilidad en otras campañas u organizaciones.

## 8. Privacidad

Este documento no contiene nombres, correos, identificadores de dispositivo,
contraseñas ni contenido del CSV. Ninguna planilla ni CSV privado fue abierto en esta
unidad.

## 9. Estado resultante

```text
INVENTORY: CLOSED_BY_MANAGEMENT_ATTESTATION
T0_ELIGIBLE_BY_MANAGEMENT_ATTESTATION: 180
T0_AUTHORIZATION: APPROVED
T0_EXECUTION: NOT_STARTED
DRAIN: NOT_AUTHORIZED
ENFORCE: NOT_AUTHORIZED
MOOK_PRODUCTION_ACTIVATION: NOT_AUTHORIZED
M1: AMBER-T0-AUTHORIZED-AWAITING-EXECUTION
```

## 10. Siguiente paso

Formular el **preflight productivo de `T0`** como unidad separada, de solo lectura,
que defina qué se mide, qué se escribe y cuál es la condición de reversibilidad antes
de tocar cualquier dato productivo.

## 11. Mutaciones

Único archivo creado: este documento. Sin cambios en producción, en datos, en las
planillas, en los CSV ni en ningún otro archivo del repositorio.
