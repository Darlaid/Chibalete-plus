# V8.1-CLOSE-03: release candidata y aprovisionamiento de A2

**Fecha:** 2026-11-09. **Veredicto:** `HOLD_A2_EVIDENCE`. Sin despliegue, sin claves ni registros productivos, y XP apagado.

## 1. Baseline verificado (solo lectura)

- **Git:** `325b8fc` en local y en `origin/chp/epub-mainfile-r1-release`, sin cambios locales.
- **CI de `325b8fc`:** `security`, `content-rmw` e `identity-preflight` en verde.
- **Producción:**
  - `api_1`, `api_2` y `front` corren `unifiedxp-13b8045` y están healthy.
  - 0 variables `GAMIFICATION_*`, `XP_*`, `PM_*` o `CHP_A2*` en las dos réplicas.
  - Sin `gamification_subject_key` en `secrets/`, sin directorio de registro (ni de exclusiones ni A2) y sin `gamification.db`.

## 2. Fuente de autorizaciones A2

| Fuente inspeccionada | Resultado |
|---|---|
| Código de vinculación de lectores: alta de usuarios, unión a grupo, membresía, CIS | No registra ninguna decisión A0–A5. Solo hay cuentas, roles, grupos y estado de cuenta, de los que **no** se puede inferir A2 (004 A1; 006 §3.3) |
| Búsqueda en el código: consentimiento, representante, tutor, aceptación de términos | Ningún mecanismo. Los avisos de Leo dicen expresamente «No es consentimiento» |
| `Tratamiento de datos/` (fuera de Git) | Solo las seis plantillas: el 004 es una proforma sin formularios diligenciados y el 005 está en blanco |
| Repositorio (aprobaciones) | Solo el acta O1 de reglas XP. No existe el registro C.1 del 006 |

**Clasificación:**

| Estado | Lectores |
|---|---|
| A2 afirmativa verificada | **0** |
| A2 negativa o revocada | **0** |
| A2 pendiente o sin evidencia | **todos** |

**Bloqueo operativo:** no hay una fuente verificable desde la que cargar el registro. Con esta release, cualquier mediador perdería de inmediato el detalle por lector de Aula Viva, las exportaciones institucionales, la revisión MOOK y el status individual. Por eso el veredicto es `HOLD_A2_EVIDENCE`. No se ha generado ni inferido ninguna decisión.

## 3. Aprovisionamiento probado en laboratorio

El laboratorio usa la imagen candidata, volúmenes Docker propios, datos sintéticos (`r1`…`r4`, `med-a`, `adm`) y puertos en 127.0.0.1. Resultado: **41/0**.

Solo se han usado herramientas existentes: Docker, `sh`, `sha256sum`, `wc` y las plantillas de operador [`ops/a2/a2_operator.mjs`](../../ops/a2/a2_operator.mjs) y [`ops/a2/a2_verify.mjs`](../../ops/a2/a2_verify.mjs). La segunda informa solo de recuentos por estado, nunca de ids. No hay servicio, ruta HTTP ni panel nuevos.

1. **Clave (F2):** se genera dentro de un contenedor, con `umask 377`, sin imprimirse. Resultado: modo `0400`, root, 96 bytes.
2. **Registro:** un volumen propio con `a2.jsonl` vacío. Es verificable aunque esté vacío.
3. **Carga desde C.1:** un contenedor efímero de la imagen nueva por cada decisión, `--network none`, con la clave en solo lectura y los datos por stdin. Se anotan las 3 decisiones sintéticas más una renovación, y los acuses no contienen ids. La verificación da `granted: 2`, `denied: 1`.
4. **Custodia:** copia con SHA-256 idéntico y número de líneas igual al de decisiones C.1.
5. **Dos réplicas** de `server/server.js` con el registro compartido. En las dos:

| Caso | Resultado |
|---|---|
| Sí | 200 |
| No | 403 |
| Pendiente | 403 |
| Sí con vigencia | 200 |
| Lo propio | 200 |
| Administración | 200 |
| Aula Viva | Solo r1 y r4, con agregados sobre los visibles |
| XP apagado | Progreso individual en 404 |
| Base de gamificación | No se crea `gamification.db` |
| Log | Sin `[A2] clave no disponible` |

6. **Revocación:** el operador ejecuta `docker exec -i` en rep1 y rep2 la ve **sin reiniciar** (403). La copia custodiada se actualiza después.
7. **Pérdida y restauración:**
   - La copia anterior a la revocación tiene menos líneas que C.1, así que **se rechaza**. Se demostró aparte que reabriría la A2 revocada.
   - Sin registro: 503 en las dos réplicas y lo propio sigue en 200.
   - Al restaurar la copia vigente (las líneas coinciden con C.1): r1 vuelve a 200, mientras r4 (revocada) y r2 (No) siguen en 403.
8. **Corrupción:** una línea alterada da 503 en las dos réplicas, nunca 200. Se recupera desde la copia vigente.

## 4. Release candidata

| Artefacto | Valor |
|---|---|
| Imagen | `chibalete/api:v81-325b8fc`, `linux/amd64`, construida desde `git -c core.autocrlf=false archive 325b8fc` (sin CR), con `GIT_SHA=325b8fc` y `RELEASE_TAG=v81-325b8fc` |
| ID local | `sha256:17b0dbb85ab7eb944cbfbddbc17f6780cc1d3396216540e2a890aa023ac9dccb` |
| Config del manifiesto | `sha256:c08865922063e4ced37a36b7f7a4c0d0d7159c44491c424452a63b1bd6a76b06` |
| `api-v81-325b8fc.tar.gz` | SHA-256 `bc6c7d6be423c16f159cc80a67e3102576998756d8af7113a969336a1d70bdf3`, 151 964 735 B |
| Frontend | **No se construye.** Desde `13b8045` solo cambian `server/`, `ops/`, `docs/`, el workflow y scripts de prueba en `package.json`. La imagen de rollback y la actual siguen siendo `unifiedxp-13b8045` (`26a0a3f4…`) |

**Comprobaciones de la imagen:**

- **Integridad** (`verify-image-integrity.mjs`): 51/0. `secrets/` vacío. Contiene `server/privacy/a2Registry.mjs` y `server/gamification/rectification.mjs`.
- **Trivy 0.69.3** (HIGH/CRITICAL, `--ignore-unfixed`, `.trivyignore`) sobre **esta** imagen: 0 vulnerabilidades, rc 0.
- **CI del mismo commit:**
  - Trivy fs, config e imágenes; gitleaks sobre el historial y HEAD; OSV; integridad.
  - Linux: `platformIntegration` 58/0, `mookReviewIdentity01a` 30/0 (con B9 de A2), `mookReviewReplicaAuthz` 14/0, `o8Check` 27/0, `a2Registry` 34/0, Aula Viva 107/0, exportaciones 83/0, `authzSubjectScope` 45/0, `studentProgressHttp` 49/0, `xpRectification` 44/0.
- **Rollback:** `13b8045` no contiene `CHP_A2` ni `server/privacy/`. Volver a la imagen anterior ignora el registro sin tocar ningún dato.

## 5. Gate de despliegue

Se despliega **solo cuando se cumplan los seis puntos**:

1. **Cargar las A2 verificadas:** Dirección entrega el C.1 del 006 (decisión, prueba y estado por lector, con la referencia opaca de cada trámite), verificado por VER. Se carga con el paso 3 en un contenedor efímero de la imagen candidata **antes** de recrear las réplicas. La verificación debe dar `readers` igual al número de lectores de C.1.
2. **Proteger negativas y pendientes:** se anotan las negativas (`denied`). Las pendientes y las «No aplica» no se anotan: equivalen a no tener A2. No hay ningún valor por defecto.
3. **No cerrar a mediadores habilitados:** antes del despliegue, la cobertura C.1 debe incluir a todos los lectores de los grupos con mediadores activos que deban mantener sus funciones. En los grupos que queden sin cobertura, Dirección acepta por escrito el cierre del detalle individual.
4. **Seguir atendiendo altas y revocaciones:** la plantilla de operador se ejecuta con `docker exec -i` en una réplica. La otra la ve sin reiniciar. Después de **cada** anotación se actualiza la copia custodiada.
5. **Recuperar sin perder decisiones recientes:** se restaura solo una copia cuyas líneas coincidan con C.1. Si no coinciden, se vuelve a anotar desde C.1.
6. **Revertir sin restaurar datos:** se restaura el override y se recrean las réplicas con `unifiedxp-13b8045`. El registro y la clave se quedan donde están.

**Orden:**
1. Clave (F2) y su evidencia.
2. Directorio del registro fuera de `data/`, `data-critical/` y de los respaldos, distinto del de exclusiones.
3. Carga C.1 y copia custodiada.
4. Override con el montaje rw y `CHP_A2_REGISTRY` en las dos réplicas.
5. Rolling: `api_1`, gate en un paso propio, `api_2`.

Las flags de gamificación siguen sin definir.
