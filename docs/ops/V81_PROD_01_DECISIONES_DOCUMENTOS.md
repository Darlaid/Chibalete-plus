# V8.1-PROD-01: decisiones de Dirección y preparación documental

**Fecha:** 2026-11-10.
- **Base:** `d39e231`, publicado (`aed7f99..d39e231`). Ese commit contiene solo la evidencia de CLOSE-10A.
- **Sin despliegue y sin XP.** No se han publicado ni modificado documentos jurídicos, no se han creado claves ni registros productivos y no se han tocado `data/`, `data-critical/`, uploads ni respaldos.

## 1. Decisiones de Dirección (DIR-V81-01 a 06)

**Fuente:** instrucción de Dirección transmitida en esta unidad (2026-11-10). Se registran como **decisiones de gestión**.
- **No** son evidencia de ninguna autorización familiar (A0–A5), ni de la aceptación de un mediador (C005), ni de la validación jurídica de un plazo.
- **No** sustituyen las actas de aprobación de 001–006.

| Id | Decisión | Qué implica en la plataforma | Qué NO acredita |
|---|---|---|---|
| DIR-V81-01 | La aceptación queda integrada en la contratación y la vinculación | La activación de cuentas (`accept-invite`) exige las decisiones T/A0/A1/A2 o C005. El checkout de WooCommerce puede aportar la T (`termsAcceptance`). Ya está implementado (CLOSE-05/06B) | No aprueba los textos 001/002/004/005 ni equivale a que una familia haya autorizado |
| DIR-V81-02 | Dirección custodia; la operación y la verificación técnica quedan documentadas | DIR custodia la clave y las copias de los registros. AT opera (CLOSE-03 §3, §3 de este documento). VER verifica C.1 | No nombra todavía a las personas del Anexo A del 006 (§2.6) |
| DIR-V81-03 | Las autorizaciones se concilian antes de restringir funciones actuales | Las fichas C.1 se cargan **antes** del despliegue (P3 de CLOSE-08B). Si no, se cierra el detalle individual de los mediadores (§3.3 de CLOSE-10A) | No da por verificada ninguna ficha |
| DIR-V81-04 | Toda restauración se hace en cuarentena | El procedimiento es el de CLOSE-09A §4 y 09B §4: conciliación, `DELETE`/`/disable`, segunda pasada, compactación y puerta con 0 pendientes. Probado en laboratorio (22/0) | No autoriza ninguna restauración real |
| DIR-V81-05 | Las cohortes tienen al menos cinco lectores, sin inferencias indirectas | Implementado en esta unidad (§4) | No valida jurídicamente que cinco sea suficiente |
| DIR-V81-06 | El objetivo de retención es 7/4/6, sin autorizar borrados | Registrado como **objetivo aprobado sujeto a validación**. Siguen sin `forget`, sin `--dry-run` habilitado y sin limpieza (§5) | No valida los plazos C01–C12 ni la retención del proveedor |

## 2. Documentos 001–006: estado preciso (solo la correspondencia con las decisiones)

**Fuente:** los PDF de `Tratamiento de datos/`, leídos en local. No se reescriben, no se aprueban, no se publican y no se suben a Git.

### 2.1 Configuración que espera la API

`CHP_ACCEPTANCE_DOCUMENTS`, en el override de **ambas** réplicas:

```
{"001":{"version":"001@1.0","url":"https://…"},"002":{"version":"002@1.0","url":"https://…"},
 "004":{"version":"004@1.0","url":"https://…"},"005":{"version":"005@1.0","url":"https://…"}}
```

- Un documento cuenta como aprobado solo si su versión coincide **exactamente** con la del código (`utils/acceptanceDocuments.mjs`) y su URL es `https:`.
- Documentos que exige cada tipo de cuenta:
  - lector: 001, 002 y 004;
  - mediador: 001, 002 y 005;
  - administrador: 001 y 002.

**Restricción importante:** el código y el front fijan `@1.0`. Si Dirección aprueba otra versión (el 001 §14.1 la deja «por asignar al aprobar la versión consolidada»), hay que cambiar `utils/acceptanceDocuments.mjs` y **reconstruir las dos imágenes**, porque el bundle del front incluye las versiones.

### 2.2 001 — Política de tratamiento de datos personales

| Campo | Estado |
|---|---|
| Versión | Cabecera: «Versión 1.0». §14.1: «Por asignar al aprobar la versión consolidada» |
| Estado | «Borrador para revisión y aprobación» |
| Aprobación | §14.1: fecha «Por completar»; responsable: Dirección de Chibalete Editores |
| Entrada en vigor | **Contradicción:** la cabecera dice 9 de noviembre de 2026 y §14.1 dice «Por completar». Mientras siga como borrador, no sustituye la política vigente |
| Versión que sustituye | «Por identificar al formalizar» |
| URL HTTPS | **No existe.** En el documento solo figura `https://chibaleteeditores.com` |

**Actuación de Dirección:**
1. Aprobar la versión consolidada: número, fecha de aprobación, entrada en vigor y versión que sustituye. Retirar la marca de borrador y corregir la cabecera.
2. Publicarla en una URL HTTPS estable. Propuesta, por crear: `https://chibaleteeditores.com/legal/001-politica-datos-v1.0.pdf`.

### 2.3 002 — Términos y condiciones

| Campo | Estado |
|---|---|
| Versión | 1.0 |
| Entrada en vigor | 9 de noviembre de 2026 |
| Aprobación | **No consta fecha.** §12.2 la exige para la versión definitiva |
| URL HTTPS | **No existe** (propuesta: `…/legal/002-terminos-v1.0.pdf`) |

**Actuación de Dirección:** fijar la fecha de aprobación (§12.2), retirar cualquier marca de borrador y publicarla en HTTPS. La T del checkout cita la misma versión (`002@1.0`).

### 2.4 004 — Información y autorización (menores)

| Campo | Estado |
|---|---|
| Versión | Proforma v1.0, elaborada el 9 de noviembre de 2026 |
| Estado | «No circular para firma con datos esenciales pendientes». Revisión jurídica y validación operativa pendientes |
| Campos por vinculación | Modalidad y periodo, institución (razón social y NIT), sede y grupo, contacto institucional, y decisiones A0–A5 (`Sí/No/No aplica/Pendiente`). Se completan **en cada vinculación**; no impiden aprobar la proforma |
| Campos de Chibalete, antes de aprobar | Versión, fecha y medio de consulta del 001 aprobado. Responsables y encargados **por operación** (A1, A2…). **Proveedores efectivos** (alojamiento, respaldo, soporte, comunicaciones), con su función y los **lugares o países de tratamiento verificados** (prohíbe «cualquier país»). **Plazos** de registros técnicos y evidencias. **Ciclo de respaldos**, con expiración tras la supresión y custodio |
| URL HTTPS | **No existe** (propuesta: `…/legal/004-autorizacion-menores-v1.0.pdf`) |

**Actuación de Dirección:** completar los campos de Chibalete, cerrar la revisión jurídica y aprobar la proforma. El ciclo de respaldos depende de DIR-V81-06 y de su validación (§5).

### 2.5 005 — Compromiso del mediador

| Campo | Estado |
|---|---|
| Versión | 1.0 |
| Campos | Todos son **por mediador**: nombre, identificación, institución, función, cuenta, vigencia, grupos asignados y coordinador. Se completan en cada alta |
| Aprobación | No consta una aprobación propia |
| URL HTTPS | **No existe** (propuesta: `…/legal/005-compromiso-mediador-v1.0.pdf`) |

**Actuación de Dirección:** aprobar el texto y publicarlo. Cada mediador lo acepta en la activación (C005 `self_authenticated`) o en papel, con su ficha C.2.

### 2.6 003 y 006 — Solo datos de formalización y responsables

- **003, acuerdo institucional:** por cada institución faltan:
  - razón social y NIT;
  - representantes;
  - firmas de las dos partes;
  - la versión y fecha aceptadas de los anexos A y B;
  - el identificador del paquete firmado;
  - las versiones identificadas del 001 que se incorporan.
  - Hay 277 campos entre corchetes, casi todos por institución.
- **006, protocolo interno:**
  - **Pendiente:** fecha y acta de aprobación, entrada en vigor, versión que sustituye, responsable y suplente, y el entorno de implementación.
  - **Anexo A (responsables):** titular y suplente de DIR, GVA, AT, CI y VER, con sus canales, cobertura y activación.
  - **A.2:** facultades y escalamiento: quién aprueba altas ordinarias y privilegiadas, entregas, derechos e incidentes, eliminación o restauración; canal principal y alterno; quién contiene la situación si DIR no responde.

## 3. Preparación operativa A1/A2/C005 (sin datos ni claves productivas)

Se reutiliza el procedimiento de CLOSE-03 §3, ya probado en laboratorio (A2 44/0 con la imagen `v81-aed7f99`):
1. **Clave** (F2):
   - contenedor efímero de la imagen nueva, `umask 377`, nunca impresa;
   - destino `secrets/gamification_subject_key`: `0400`, root, 96 bytes;
   - copia sellada **bajo custodia de DIR** (DIR-V81-02).
2. **Registros:**
   - decisiones (`CHP_A2_REGISTRY`) y exclusiones (`GAMIFICATION_EXCLUSION_REGISTRY`) en directorios distintos, fuera de `data/`, `data-critical/` y de los respaldos;
   - archivos vacíos, montados rw en las dos réplicas.
3. **Fichas C.1:**
   - VER verifica cada ficha (004 Parte III; 006 C.1). Solo entra una decisión con verificación «suficiente» y con A1 = Sí (CLOSE-04).
   - AT transcribe cada decisión en una línea JSON para `ops/a2/decision_operator.mjs`:
     - `subjectId`, `kind` (A1/A2/C005), `status`, `actDay` (la fecha de la ficha), `version` (`004@1.0`/`005@1.0`);
     - `medium` (`paper`/`electronic_signature`/`verifiable_message`), `capacity`, `verification: "verified"` y `requestRef` (referencia opaca de la ficha).
   - Las pendientes y las «No aplica» **no se anotan**. No hay ningún valor por defecto.
4. **Carga:**
   - por stdin, en un contenedor efímero sin red, con la clave en solo lectura;
   - todas las líneas o ninguna;
   - el acuse no contiene ids.
5. **Verificación:**
   - `a2_verify` da recuentos por tipo y estado iguales a los de C.1;
   - el mismo SHA-256 en los dos montajes;
   - copia custodiada por DIR;
   - `ops/a2/inventory.mjs` (solo lectura, agregado por grupo, sin datos personales) da los lectores y mediadores activos. Comparados con los recuentos de C.1, muestran cuántos quedarían sin ficha. El inventario no lee el registro de decisiones.
6. **Puerta (DIR-V81-03):** todo mediador activo tiene C005, o Dirección acepta por escrito el cierre de su detalle individual. Si no, no se despliega.

**Restauraciones:** siempre en cuarentena (DIR-V81-04). Sin restauraciones reales en esta unidad.

## 4. Umbral de cohortes (DIR-V81-05)

**Módulo:** `server/analytics/cohortDisclosure.mjs`. No crea tablas, servicios, paneles ni reglas de XP.
- **Cohorte:** se cuenta con `resolveGroupReaderCohort`, la autoridad única: membresía vigente menos mediadores. Para un colegio u organización es la unión de sus grupos. Se lee en cada petición, sin caché.
- **Reglas:**
  - menos de 5 lectores ⇒ se suprime;
  - un par anidado de la misma organización (grupo ⊂ colegio, club ⊂ curso) con una diferencia de 1–4 lectores ⇒ se suprimen los dos;
  - un subámbito de 1–4 dentro de un ámbito ⇒ se suprime el ámbito, porque `org − g1 − g2` aislaría a `g3`;
  - un resto de 1–4 fuera de la unión de los subámbitos ⇒ se suprime.
- **Fuentes ilegibles:** fallo cerrado.
- **Respuesta suprimida:** misma forma, `suppressed: true` y `minCohort: 5`, **sin tamaño ni valores**. Las listas vuelven vacías.
- **No afecta:**
  - al detalle individual (ámbito `user`, que rige A2/C005);
  - al administrador de plataforma;
  - a los ámbitos `all` y a las cohortes tipadas (en estas, la trayectoria oculta los puntos con `sample_size` < 5).

**Endpoints:**

| Router | Endpoints |
|---|---|
| Operacional | `/cohorts/:t/:id`, `/cohorts/:t/:id/rollups`, `/recommendations/scope/:t/:id` |
| Institucional | `/institutional/outcomes/scope/:t/:id`, `/institutional/cohorts/:id/trajectory`, `/institutional/learnings/scope/:t/:id` |

**Fuera de la regla (documentado):** solapamientos parciales entre grupos no anidados, y diferencias en el tiempo por altas y bajas de la cohorte.

**Pruebas:**
- **`cohortDisclosure`:** 34/0. Cubre cohortes de 1, 4, 5, 6 y 16 lectores; mediadores fuera del recuento; colegio de 7 con un grupo de 5; club de 6 en un curso de 8; curso de 12 con dos clubes de 5; los seis endpoints por HTTP con el CIS real; filtros (`period`, `sinceTs`); sin tamaño ni valor en la respuesta; administrador; detalle individual intacto; baja de un lector que surte efecto en la siguiente petición; fuentes corruptas.
- **`aulaVivaOperationalAuthz`:** 112/0. La siembra del grupo propio pasa a 5 lectores para seguir probando la misma propiedad.

**Hallazgo fuera del alcance, sin corregir:** los endpoints **individuales** de Aula Viva no aplican A2 ni C005; solo usan el alcance del CIS. Ver §6, H-1.

## 5. G-04: retención (DIR-V81-06)

- **Objetivo aprobado por Dirección: 7/4/6** (7 diarias, 4 semanales y 6 mensuales) **sujeto a validación jurídica**. No es un plazo validado.
- **Sin cambios técnicos:**
  - el runner sigue rechazando `forget`, también con `--dry-run`;
  - no se ha ejecutado ninguna limpieza;
  - no se han modificado copias.
- **Siguiente paso, en su propia unidad y con autorización:** permitir solo `forget --dry-run --tag <tipo> --group-by host` y la simulación de 4 semanas (CLOSE-08A §4).

## 6. Bloqueos exactos para PROD-02

| # | Bloqueo | Responsable |
|---|---|---|
| B-1 | 001 aprobado (§14.1 completo, sin marca de borrador, cabecera coherente) y publicado en HTTPS | Dirección |
| B-2 | 002 con fecha de aprobación (§12.2) y publicado en HTTPS | Dirección |
| B-3 | 004 con los campos de Chibalete completos, revisión jurídica cerrada, aprobado y publicado | Dirección + Legal |
| B-4 | 005 aprobado y publicado | Dirección |
| B-5 | Versiones aprobadas = `@1.0`. Si no, cambio de código y reconstrucción de las dos imágenes | Dirección → AT |
| B-6 | Anexo A del 006: titulares y suplentes de DIR, GVA, AT, CI y VER, y el acta de aprobación del 006 | Dirección |
| B-7 | Fichas C.1 verificadas (A1/A2) y C005 de cada mediador activo, o la aceptación escrita del cierre del detalle | Instituciones + VER + Dirección |
| B-8 | Clave, registros y custodia (§3, pasos 1–2) | AT + DIR |
| B-9 | **Nuevas imágenes:** esta unidad cambia código (umbral de cohortes), así que `v81-aed7f99` queda **obsoleta** | AT |
| H-1 | Los endpoints individuales de Aula Viva (`/students/:id/timeline`, `feature-vector`, `risk-history`, señales, cola de atención) e institucionales (`/institutional/cohorts/:id/members`, `follow-up-queue`, `profile/:userId`) no aplican A2/C005. Ya era así en producción; no es una regresión. Decidir si se aplica la misma puerta que G-02 antes de PROD-02 | Dirección → unidad de código |
