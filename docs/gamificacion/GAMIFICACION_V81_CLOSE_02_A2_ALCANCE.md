# V8.1-CLOSE-02: alcance completo de A2 y aprovisionamiento

**Fecha:** 2026-11-09. **Sigue a:** `GAMIFICACION_V81_CLOSE_01_A2_RECTIFICACION.md`. Sin despliegue y con XP apagado.

**Fuente usada:** 004 A2 (p. 8) autoriza el tratamiento de D1, D3, D4 y D5 y «la consulta por mediadores asignados [...] para revisar, retroalimentar y acompañar el programa». 004 A1 «no habilita el acceso institucional». 006 §3.3: «sin A2 suficiente no se habilitan reportes identificables ni acceso individual al colegio».

## 1. Alcance por operación

| # | Operación | ¿Datos individuales cubiertos por A2? | Control aplicado |
|---|---|---|---|
| 1 | `GET /api/groups/:g/students/:s/progress` (XP individual) | Sí (D5) | CLOSE-01: quinta puerta, 404 idéntico |
| 2 | `GET /api/groups/:id/analytics-summary` (Aula Viva) | Sí: `readers[]` contiene D3 por lector | CLOSE-01: `readers[]` filtrado; con 1 a 4 retenidos, los agregados se calculan sobre los visibles |
| 3 | `GET /api/students/:id/status` | Sí: nombre (D1) y lectura (D3) | `requireSubjectScope(..., { a2: true })`: cuando el acceso llega como `mediator_of_member_group`, exige A2 vigente. Sin A2 devuelve **el mismo 403** que fuera de alcance |
| 4 | `GET /api/students/:id/export-submissions` y `GET /api/tasks/:id/export-submissions` | Sí (D4) | `resolveExportScope`: la nómina del mediador solo incluye lectores con A2. Una entrega sin A2 sale del ZIP colectivo, y la exportación individual da la misma respuesta que fuera de alcance |
| 5 | MOOK: bandeja, detalle, comentario, solicitud de cambios y decisión | Sí (D4: «revisar, retroalimentar») | `mediatorReviewScope().allows(owner)` exige A2. Cubre la bandeja (filtrada), el detalle, las tres escrituras y la **reautorización dentro del lock**. Sin A2: el mismo `403 REVIEW_FORBIDDEN` que fuera del grupo, y no se escribe nada |

**Fuera de A2:** `GET /api/access/by-user/:id`. Son reglas de acceso a contenidos, configuración del servicio y no D1/D3/D4/D5.

### Qué no cambia

- **Lo propio (`self`):** el lector ve su estado, exporta sus entregas, ve su ruta MOOK y su «Mi progreso».
- **Administración de plataforma y autoridad de máquina:** no es consulta institucional (atiende solicitudes y opera el servicio). Conserva su alcance en las operaciones 3 a 5.
  - En Aula Viva (2) el filtro de CLOSE-01 también se aplica al administrador. Es más estricto y se mantiene sin rehacerlo.
- **Puertas anteriores:** sesión, rol, grupo, organización, grupos inactivos y cuentas sintéticas siguen igual. A2 solo puede **restar** acceso, nunca ampliarlo.
- **Lectores sin nómina:** un lector o un rol sin grupos sigue recibiendo 403, nunca el 503 del registro.

### Fallo cerrado

Si el registro A2 no se puede verificar:

| Operación | Respuesta |
|---|---|
| 1 | 503 |
| 2 | `readers[]` vacío |
| 3 | 503 `individual_access_unavailable` |
| 4 | 503 antes de leer ninguna entrega |
| 5 | 503 `INDIVIDUAL_ACCESS_UNAVAILABLE` (también dentro del lock) |

Lo propio y la administración no dependen del registro.

### Dependencia real informada (006 §3.5)

Sin A2, nadie de la institución revisa las entregas MOOK de ese lector. Por eso no obtiene el XP que depende de una revisión aprobada. El lector conserva la experiencia, su entrega y su XP anterior. Debe figurar en la información a familias (004).

### Sin enumeración ni filtración indirecta

- Las denegaciones por A2 dan el mismo cuerpo que una denegación por alcance, ya comprobado byte a byte en exportación, en XP individual y en el código de MOOK.
- Los agregados se protegen con la regla de 1 a 4 retenidos (CLOSE-01).
- El ZIP colectivo no incluye nombre, id ni texto de quien no tiene A2.
- Las cabeceras, la query y los ids manipulados siguen sin ampliar nada: la suite de exportaciones lo cubre.

## 2. G-03 tras los ajustes

`voidRecognition` no cambia. `xpRectification` (44/0) y la suite de núcleo siguen en verde.

A2 no toca el ledger: retirarla no cambia el XP, el techo ni las anulaciones. La anulación sigue sin liberar el techo por obra y ciclo.

## 3. Contrato de aprovisionamiento de A2 (sin ejecutar)

| Elemento | Contrato |
|---|---|
| **Clave** | La clave de sujeto (`/app/secrets/gamification_subject_key`), con el procedimiento S de `GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md` F2: 0400, root, copia al custodio y evidencia sin el valor. El MAC usa una derivación propia (`chp-a2-registry-v1`). **Rotar la clave invalida el registro A2**: habría que volver a anotarlo desde la fuente administrativa |
| **Ruta** | Un directorio propio en el host, fuera de `data/`, `data-critical/` y del inventario de respaldos, y distinto del registro de exclusiones (`A2_REGISTRY_NOT_INDEPENDENT`). Va montado **rw en las dos réplicas** con `CHP_A2_REGISTRY=<ruta en el contenedor>` en el override. Las réplicas solo leen; escribe el operador |
| **Fuente administrativa** | El registro C.1 del 006 (decisión, prueba, estado), llevado por GVA y verificado por VER. Cada línea del registro A2 lleva la referencia opaca del trámite C.1, nunca datos personales. Solo se anota `granted` con la prueba verificada. «No aplica» no se anota y equivale a pendiente |
| **Copia bajo custodia de Dirección** | Después de **cada** anotación: copia del archivo más su SHA-256 y su número de líneas, entregados al custodio designado (J4, por cargo) |
| **Pérdida o corrupción** | Las réplicas cierran el acceso de inmediato (§1). Se recupera de la copia custodiada **solo si** su número de líneas coincide con las decisiones atendidas en C.1. Si no coincide, no se restaura: se vuelve a anotar desde C.1. Una copia más antigua que una revocación reabriría una A2 retirada |

## 4. Orden seguro de despliegue

Sin este orden, el despliegue cierra al instante el detalle por lector de Aula Viva, la exportación institucional y la revisión MOOK de todos los mediadores.

1. **Antes de tocar las réplicas:**
   - Clave en su sitio, con su evidencia.
   - Directorio y archivo vacío del registro.
   - Montaje y variable preparados en una copia del override.
2. **Carga inicial:** con la **imagen nueva** como contenedor efímero (`docker run --rm`), con el secreto en solo lectura y el registro en lectura y escritura, y sin puertos.
   - Anotar las A2 verificadas de C.1 con la plantilla de CLOSE-01 §1.
   - Comprobar que `readA2Registry` devuelve tantas entradas como decisiones C.1.
   - Copia al custodio.
3. **Rolling por réplica:**
   - Drain, recreate con el override nuevo, gate en un paso propio, rejoin.
   - Gate: el log sin `[A2] clave no disponible`. Un mediador piloto con A2 verificada ve su grupo con `individualAccess.status` distinto de `unavailable`, y la evidencia se toma sin datos personales.
   - Después, la otra réplica.
4. **Rollback:** se restaura el override y la imagen anterior. El registro no se toca y no se restaura ningún dato.

**Alternativa:** Dirección acepta por escrito el cierre hasta completar el paso 2.

## 5. Validación Linux

El paso `A2, Aula Viva y O8 (V8.1)` de `identity-preflight` ejecuta `npm run test:v81`:

- `a2Registry`
- `groupAnalyticsSummary`
- `AulaVivaGroupAnalytics`
- `o8Check` con `O8_APP_ROOT` igual al checkout

En el mismo workflow ya corren `platformIntegration`, `mookReviewIdentity01a` (capa B, con el nuevo caso B9 de A2), `mookReviewReplicaAuthz`, exportaciones, identidad y sesiones, el núcleo de gamificación, typecheck y build. Gitleaks corre en `security.yml`.
