# CHP-EDITORIAL-ROYALTIES-2026-01 — F2-B · Inventario y matriz comercial de reglas de acceso

**Fecha:** 2026-10-22 · **Base:** `5d98b3b` · **Decisión aplicable:** P9 (`DECISIONES_F0C.md`)
**Fuente:** `data/access_db.json` de producción, leído en solo lectura el 2026-10-22; usuarios resueltos contra el store canónico (`USERS_DB` = `data-critical/usuarios_colegios_oro.json`). Sin datos personales en este documento: los beneficiarios se describen por rol, tipo y tamaño.

> **Estado en producción: las 22 reglas son `unclassified` y siguen así.** La columna «Propuesta» es solo una propuesta para aprobación humana **individual**. Ninguna clase se aplica sin esa aprobación y su soporte (`evidenceRef`).

## 1. Inventario (22 reglas)

Forma de una regla: `{ id, scope, scopeId, titleIds, collectionIds, expiresAt, b2c? }`. No hay campo de estado: la caducidad (`expiresAt`, ms) y, en B2C, `b2c.revokedAt` determinan la vigencia. Ninguna tiene `collectionIds`.

| # | Regla | Ámbito · beneficiario | Títulos | Vigencia (UTC) | Origen (evidencia) |
|---|---|---|---|---|---|
| 1 | `lt-access-v2` | grupo «Load Test School v2», 400 miembros sintéticos | 64 | **caducada** (`expiresAt=1`) | carga sintética (`docs/ops/IDENTITY_SYNTHETIC_USERS_GAP1_01.md`) |
| 2–3 | `access-v6-explicit-group-1776199165029`, `…1776199266164` | grupo curso «Grado 005», 80 miembros | 89 | permanente | V6 Etapa 5: materialización del acceso implícito (`LEGACY_OPEN`), `scripts/migrations/chp-v6-explicit-access/migrate.mjs` |
| 4 | `access-v6-explicit-group-1777177383528` | grupo «Club Filbo – Chibalete Club», 62 miembros | 89 | permanente | V6 Etapa 5 |
| 5–14 | `access-v6-explicit-group-1777687428733` … `…1777687435045` (10 reglas) | grupos «Club Filbo – Chibalete Club» de 1 a 3 miembros | 89 | permanente | V6 Etapa 5; el espejo de identidad marca 11 grupos como `LEGACY_TEST_GROUP_PENDING_RETIREMENT` |
| 15–16 | `access-v6-user-user-1777214026863`, `…1778175346157` | usuario lector con colegio | 89 | permanente | V6 Etapa 5 (por usuario) |
| 17 | `access-b2c-lectores` | grupo «Chibalete+ — Lectores», 0 miembros | 86 | permanente | plantilla de aprovisionamiento B2C (`templateRuleId` de las reglas 20–21) |
| 18 | `access-user-admin-library-visibility-01` | usuario administrador | 89 | permanente | LIBRARY-VISIBILITY-01 (visibilidad de biblioteca para administración) |
| 19 | `access-pilot-epub3c-user-1774362611303` | usuario administrador | 1 | hasta 2026-10-27 | piloto EPUB 3C (QA del operador) |
| 20 | `access-b2c-production-order-900000001` | usuario lector B2C | 86 | **revocada** 2026-09-29 02:52 (1,5 s tras activarse, `manual`) | `/api/b2c/provision`, producto 345, plan digital |
| 21 | `access-b2c-production-order-900000002` | usuario lector B2C | 86 | **revocada** 2026-09-29 03:38 (41 min tras activarse, `manual`) | idem |
| 22 | `access-pilot-epub3e5-user-1779493121246-092` | usuario lector (cuenta de smoke del operador) | 1 | **caducada** 2026-10-16 | piloto EPUB 3E.5 |

## 2. Matriz comercial propuesta

**Ninguna regla tiene evidencia documental de una relación comercial pagada en el repositorio ni en producción.** Conceder acceso no prueba pago (P9).

| Regla(s) | Propuesta | Certeza | Fundamento | Qué falta para aprobar |
|---|---|---|---|---|
| 1 `lt-access-v2` | `internal` | Alta | Tráfico sintético de carga; además caducada | Confirmación del operador |
| 2–3 «Grado 005» | **`unclassified`** (candidata a `paid_institutional`) | Baja | Materializa acceso que antes era implícito; no hay contrato ni factura en el repo | Contrato o convenio con la institución y su periodo; si no es pagado: `pilot` o `courtesy` |
| 4 «Club Filbo» (62) | **`unclassified`** (candidata a `pilot` o `promo_authorized`) | Baja | Club ligado a FilBo 2026; ningún soporte de pago | Naturaleza del club (evento, piloto, cortesía) y, si hubiera, su soporte |
| 5–14 «Club Filbo» (1–3 miembros) | `internal` | Media | Grupos pequeños que el espejo de identidad marca como pendientes de retiro por ser de prueba | Confirmar que son grupos de prueba |
| 15–16 lectores por usuario | **`unclassified`** | Baja | Materialización V6; sin soporte comercial | Origen de esas dos cuentas |
| 17 `access-b2c-lectores` | `template` | Alta | Plantilla del aprovisionamiento, 0 miembros | Confirmación del operador |
| 18 `…admin-library-visibility-01` | `internal` | Alta | Cuenta de administración (además excluida por rol) | Confirmación del operador |
| 19 `access-pilot-epub3c-…` | `internal` | Alta | QA del operador con cuenta de administración | Confirmación del operador |
| 20–21 B2C `order-90000000x` | `internal` (prueba del aprovisionamiento) | Media | Revocadas manualmente a los segundos/minutos de activarse; F0-B registró 0 accesos pagados activos | Confirmar en WooCommerce si los pedidos 900000001/2 fueron reales; si lo fueron, `paid_b2c` (sin efecto: ya inactivas) |
| 22 `access-pilot-epub3e5-…-092` | `internal` | Alta | Cuenta de smoke del operador; caducada | Confirmación del operador |

**Excepciones:** ninguna regla puede clasificarse como `paid_b2c` o `paid_institutional` con la evidencia actual. Aun aprobadas todas las propuestas, **el número de reglas económicamente elegibles en producción sería 0**, coherente con F0-B (0 accesos pagados activos).

## 3. Cómo se aprueba una regla (cuando exista la aprobación)

Una aprobación por regla, con su soporte, en `PUT /api/admin/access/:ruleId/commercial-class` (solo administración, auditada):

```json
{ "commercialClass": "internal", "evidenceRef": "<referencia del soporte de la aprobación>", "note": "<opcional>" }
```

La clase rige desde el momento del registro (hora del servidor; no se admite fecha retroactiva) y queda en `commercialClassHistory`. Las reglas nuevas del aprovisionamiento B2C nacen `unclassified` (P9) hasta su aprobación individual.

## 4. Implementación (local, sin desplegar)

- **Modelo:** la clase vive en la propia regla de `access_db.json` (sin almacén nuevo): `commercialClass` (valor vigente, de conveniencia), `commercialClassSince` y `commercialClassHistory` (`[{ commercialClass, since, by, evidenceRef, note? }]`). **La autoridad es el historial**: `commercialClassAt(rule, t)` devuelve la clase vigente en `t`; un campo suelto sin historial cuenta como `unclassified`.
- **Módulo puro:** `server/royalties/commercialClass.mjs` — taxonomía P9, validación, `applyClassification` (hora del servidor, sin fechas del cliente, sin entrada nueva si la clase no cambia), `ruleSupportsEconomicAttribution` (clase pagada vigente + regla activa, incluida la revocación B2C), `isEconomicallyExcludedUser` (administración, `_loadtest_marker` y lista interna aportada; los mediadores no se excluyen, P7) y `resolveCommercialAttribution`.
- **Atribución determinista:** parte de las reglas que el motor de acceso ya aplicó al usuario (`resolveUserContentAccess().appliedRules`), filtra las vigentes que cubren la obra (títulos o colección) y elige **una**: clase pagada primero (P8), luego ámbito `user` > `group` > `organization`, luego `id`. Nunca devuelve dos.
- **Servidor:**
  - `PUT /api/admin/access/:ruleId/commercial-class` — solo administración, dentro del lock de accesos (`mutateAccessRules`), con `evidenceRef` obligatorio y auditoría (`access_commercial_class_set`).
  - `GET /api/admin/access/commercial-classes` y `GET /api/admin/access/attribution?userId=&contentId=` — solo administración (`requireAdminRead`), `no-store`.
  - `POST /api/access` rechaza (400 `commercial_class_readonly`) un cuerpo con campos comerciales y **arrastra** la clase y el historial guardados al reconstruir la regla.
  - Revocación B2C, sincronización de títulos B2C y sincronización de contenido a reglas de organización ya copian la regla completa: conservan la clase sin cambios de código. Las reglas B2C nuevas nacen sin clase (no heredan `template` de la plantilla).
- **Sin cambios en el permiso de lectura:** el motor de acceso no lee la clase. El entitlement del lector solo expone ids de reglas.

## 5. Pruebas

| Suite | Resultado |
|---|---|
| `commercialClass` (taxonomía, validación, historial sin retroactividad, predicado por clase, arrastre, exclusiones, atribución determinista, escritores B2C) | 58 ✓, 0 ✗ |
| `commercialClassHttp` (servidor real) | Windows 36 ✓ + 1 SKIP (sección `POST /api/access`, requiere `/app/secrets`); Linux con tmpfs en `/app/secrets`: **39 ✓, 0 ✗** |
| `test:royalties` completo (incluye F3-A1, F1-A, F2-A) | verde |
| `test:b2c`, `test:content-rmw`, `test:memberships` | verde |
| `test:library` | fallo preexistente idéntico a la base («`/api/content` general NO cambia su política no-store») |
| POSIX en Linux (`uploadsAuthzStrict`, `catalogResourceLocators`, `catalogAccessLogNoise`, `catalogAccessPerformance`, `b2cProvisioning.integration`, `sessionIdentity`, `rightsHttp`, `publishersHttp`) | mismos resultados con la imagen F2-A sola y con el `server/` de F2-B |
| Respaldo | `access_db.json` es store JSON CANON del respaldo estructurado; el capturador real del runner copió una regla con historial comercial byte a byte (`integrity_result: ok`) |

Lo que demuestra `commercialClassHttp`: accesos, catálogo y entitlement de 5 actores idénticos antes y después de clasificar; reglas idénticas salvo campos comerciales; dos clasificaciones concurrentes persisten; lector y mediador reciben 401/403 en las tres rutas; regla sin clasificar → acceso sí, elegibilidad no; piloto o cortesía → no elegible; pagada → elegible; cuenta sintética → excluida; reclasificar no borra la etapa anterior; catálogo, `publisherId`, usuarios, grupos, progreso y eventos intactos; 3 cambios auditados.

## 6. Compatibilidad productiva y pendientes

- **Al desplegar:** ninguna regla tiene campos comerciales → las 22 son `unclassified` → 0 reglas elegibles; ningún acceso cambia. El despliegue no escribe en `access_db.json`.
- **Decisión humana pendiente (P9):** aprobación individual de cada fila de §2, con su soporte. Hasta entonces, nada se clasifica en producción.
- **Negocio pendiente (P7):** la lista concreta de cuentas internas o de QA (`internalUserIds`) para la exclusión económica en F3-B.
- **Deuda preexistente, no corregida:** `POST /api/access` también descarta el campo `b2c` al reconstruir una regla existente (F2-B solo arrastra los campos comerciales).
- F3-A2 consumirá `resolveCommercialAttribution` en `session_start`; no se generan eventos en esta unidad.
