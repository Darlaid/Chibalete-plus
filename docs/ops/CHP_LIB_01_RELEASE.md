# CHP-LIB-01-RELEASE — Release controlado de Biblioteca Editorial a producción

Fecha: 2026-08-18 (18:50–19:35Z). Publica EXACTAMENTE el alcance GREEN-LIB-01 (`679b036`). Sin funcionalidad nueva; frente M1-A intacto por diseño y por verificación.

---

## A. Veredicto

**GREEN-LIB-01-PROD** — los 12 criterios cumplidos: imagen nueva healthy en ambas APIs + frontend, dry-run productivo limpio, migración aplicada e idempotente, Biblioteca Editorial operativa (vacía por datos legítimos, ver §D), no-duplicación demostrada EN PRODUCCIÓN (hash byte-idéntico de content.json tras el ciclo admin), access engine intacto como autoridad, administración protegida, cero regresiones, 0×5xx, M1-A sin tocar. Rollback NO usado.

## B. Preflight

- Repo limpio, HEAD `679b036` (descendiente ff de `8ed4e5e`: la imagen nueva = producción actual + docs + LIB-01, nada más).
- Diff auditado: solo docs + archivos LIB-01; **0 apariciones** en el diff de `sessionAuth`/`SESSION_AUTH_MODE`/`requireEventsWriteAuth`/`legacyAnalyticsAcceptAndDrop`/`access_db`/`x-user-id`/`lu_config`/`requireProgressOwner`; única mención INSTITUTIONAL/PERSONAL = comentario del STOP boundary (sin rutas).
- Tests: `test:library` 17/17 local + **CI remoto `identity-preflight` SUCCESS sobre `679b036`** (ejecuta la cadena completa incl. los tests nuevos); guards estructurales GREEN; `vite build` GREEN; typecheck 0 errores nuevos (14 = baseline).
- Producción pre: `8ed4e5e` ambas healthy, restarts 0/0, COMPAT/COMPAT, 202-drop=1 (probe histórico), 0×5xx.

## C. Artefacto

`git archive` byte-exacto de `679b036` (tar sha256 `7ebc5d6d…`, verificado en VPS) → `docker build` → **`chibalete/api:679b036`** y **`chibalete/front:lib01-679b036`**. Canary en imagen aislada (`--network none`): eventsWriteAuth 9 + eventsRoutesSessionGuard 4 + legacyAnalyticsDropGuard 10 + sessionIdentity 42 + integración 34, todos GREEN; suite library 17/17 ejecutada con el node de la imagen sobre el árbol de build completo (la imagen no incluye `scripts/` — comportamiento conocido; por eso la migración se ejecuta vía `docker cp` con layout relativo `/tmp/libmig/`).

## D. Dry-run productivo

`GREEN-LIB-MIG-DRYRUN`: `bundlesDetected=0, referencesProposed=0, orphanContentIds=[], conflicts=[]` — **producción NO tiene `bundles_db.json`** (las 3 Experiencias eran datos de dev). Divergencia de datos legítima, prevista por la unidad: lo obligatorio (0 huérfanos, 0 ambigüedades) se cumple. Consecuencia: la Biblioteca Editorial productiva **nace vacía** y se puebla con los endpoints administrativos canónicos cuando la editorial lo decida — el smoke §G demuestra ese camino funcionando end-to-end.

## E. Deploy

Backup `override.pre-lib01-20260818T171500Z.yml` (sha `44d45fdf…`) en `/root/chp-lib-01-release/`. Diff del override = exactamente 2 líneas api (8ed4e5e→679b036) + 1 línea front. Rolling: api_2 → healthy (~36 s) → smoke → api_1 → healthy; front recreado solo (bundle nuevo `index-BUu4H9r6.js` sirviendo, edge 200×4). Sin tocar COMPAT/202-drop/auth/LU/lu_config. **Rollback disponible:** restaurar backup + `up -d --no-deps` (imágenes `8ed4e5e` y `front:m1a-0ff76b6` retenidas en host).

## F. Migración

`--apply` en producción (nuevo contenedor, `--data-dir /app/data`): resultado vacío limpio; `/var/www/chibalete/data/library_db.json` creado (`{collections:[],references:[]}`, 644 root). Re-dry-run posterior: 0 pendientes, limpio ✓ idempotente. `content.json`, `isCollection:true` y fuentes: intactos.

## G. Smoke Biblioteca (producción)

- `GET /api/library/editorial` → 200 con estructura vacía-segura en ambas instancias y vía edge.
- **Ciclo administrativo completo NO destructivo** (secret file-only usado dentro del VPS, jamás impreso): `POST referencia` (libro real `content-1765…919`) → `created:true` → **la vista la proyecta** (metadata desde el catálogo canónico) → re-POST → `created:false` (idempotencia en prod) → `DELETE` → 200 → vista vacía otra vez.
- Sin credencial admin → **401** (guard canónico); body malformado → 400 del body-parser (antes del guard, comportamiento estándar).

## H. Autorización / no duplicación

- **No duplicación demostrada en producción:** sha256 de `content.json` **byte-idéntico** antes y después del ciclo completo (`889629ee…`); `library_db.json` solo contuvo punteros y quedó limpio.
- **Access engine = autoridad intacta:** el diff no lo toca; el preflight `/api/content/:id/access` y el visor siguen siendo el único camino de apertura; la vista editorial no emite ningún campo de autorización (garantizado por test en CI).
- `GET /api/content` sin credencial → 401 = baseline previo (GET-guard global existente, sin cambio).

## I. Salud productiva

Regresión M1-A verificada con probes sintéticos (lt-user-001, sin contaminar métricas): header-only analytics → **202 accept-and-drop con cuerpo exacto** (mitigación LU intacta); header-only `/api/v1/events` → 401 (events-guard intacto); header-only assignment → 401 (firma compat); COMPAT/COMPAT confirmado en env de ambas. 0×5xx en toda la ventana; logs solo con ruido benigno + probes propios. **Baseline de contadores post-recreate: series in-process reseteadas (legacy/drop parten de 0/1-probe; el histórico queda en Prometheus)** — relevante para la futura medición del drain. Ventana de observación corta cerrada sin anomalías (ver cifras finales en §J del reporte de sesión).

## J. Límites

- Biblioteca Editorial productiva vacía hasta que la editorial la puemble (API-first con el mecanismo admin canónico; sin CMS por diseño).
- La imagen no incluye `scripts/` → operaciones de migración futuras repiten el patrón `docker cp` documentado aquí.
- Sin credencial de usuario real en esta ventana: el candado por card (useAccessCheck) queda validado por código+tests+preflight canónico intacto; una verificación visual con sesión real puede hacerse en cualquier uso natural.

## K. Próximo paso

DETENER. NO comenzar LIB-02/LIB-03; NO tocar identidad aprovechando el deploy. Estado final de Biblioteca: **EDITORIAL implementada + productiva · INSTITUTIONAL contrato listo, implementación bloqueada por M1-A/M1-B · PERSONAL contrato listo, bloqueada por M1-A.** Trabajo paralelo disponible: `CHP-ADR-MOOK + CHP-MOOK-PILOT-DESIGN-00` u otra unidad habilitada por el Plan V3. Ref productiva a actualizar por ff a `679b036`.
