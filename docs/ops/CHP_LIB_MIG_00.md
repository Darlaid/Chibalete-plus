# CHP-LIB-MIG-00 — Plan conceptual de migración hacia Biblioteca por referencias

Fecha: 2026-08-18 · Estado: **PLAN congelado — NO ejecutado.** Ninguna migración productiva corre en esta unidad.
Principio: preferir migración/referencia sobre duplicación/recreación.

---

## 1. Inventario del estado actual (inspección read-only del repo/datos)

| Estructura existente | Qué representa hoy | Destino conceptual |
|---|---|---|
| `content.json` (12 registros, `status=disponible`) | entidad canónica de libro/contenido | SE CONSERVA tal cual — es el Book canónico del ADR |
| `data/bundles_db.json` ("Experiencias", 3 bundles con `contentIds`) | proto-colecciones editoriales **ya por referencia** (cero duplicación detectada) | mapping directo → `LibraryCollection(EDITORIAL)` + una `LibraryReference(EDITORIAL)` por `contentId` |
| `school_configs.json` + `schools_db.json` | selección/config por colegio | → `LibraryCollection/References(INSTITUTIONAL, contextId=organizationId)` para los campos de contenido que representen "biblioteca del colegio"; los campos de configuración no-biblioteca NO migran |
| `content.json` registros `isCollection:true` (+`sectionIds`) | colecciones de contenido conflated en el catálogo | **NO migran a Biblioteca** — siguen siendo contenido canónico agrupado (los visores y `access_db.collectionIds` dependen de ellas); decisión de separarlas queda fuera de alcance |
| `access_db.json` (reglas scope user/group/organization, temporales) | entitlements | NO se migra ni se toca: es la capa `entitlement` de la fórmula |
| "Estoy leyendo" (derivado de progreso) | continuidad de lectura | NO es biblioteca: se mantiene derivado, no genera referencias |
| Biblioteca personal | **no existe hoy de forma persistente** | nace vacía: cero migración personal |

Duplicación real detectada: **ninguna a nivel de libro** (bundles y configs ya apuntan por id). La única conflación es colecciones-dentro-de-content, resuelta por decisión (no migra).

## 2. Mapping propuesto

1. `bundle.{id,name,description}` → `LibraryCollection{layer:EDITORIAL, contextId:null, name, description, published:true}`; `bundle.contentIds[i]` → `LibraryReference{layer:EDITORIAL, collectionId, bookId, position:i}`.
2. `school_config[org].titleIds/collectionIds`-equivalentes de exhibición → `LibraryReference{layer:INSTITUTIONAL, contextId:organizationId, bookId, position}`; agrupaciones nombradas del config (si las hay) → `LibraryCollection(INSTITUTIONAL)`.
3. Clave de contexto institucional: **mapear nombre de school → `organizationId` canónico** usando el mapa institucional vigente (CHP-ID: 4 instituciones válidas; `organizationId` es la única autoridad — `schoolId` fue eliminado). Caso ambiguo documentado: las rutas actuales usan el NOMBRE (`/api/schools/:name/config`) — la migración resuelve por el mapa canónico y FALLA explícitamente ante nombre no mapeable (no adivinar).
4. Deduplicación en carga: aplicar `UNIQUE(layer, contextId, collectionId, bookId)`; colisiones → conservar la primera aparición, log de descarte.
5. Referencias a `bookId` inexistente en `content.json` → NO se crean; log de huérfanos para decisión humana.

## 3. Procedimiento (cuando los gates lo permitan — NO ahora)

1. **Mapping** determinista (script offline, entrada = copias de los JSON, salida = referencias candidatas + log).
2. **Dry-run** sin escritura con reporte: conteos por capa/contexto, huérfanos, colisiones, nombres no mapeables.
3. **Validación de conteos:** Σ referencias EDITORIAL = Σ `contentIds` únicos por bundle; Σ INSTITUTIONAL = Σ ids únicos por config mapeada; 0 personal.
4. **Validación de integridad:** todo `bookId` existe en content.json; todo `contextId` institucional ∈ mapa canónico; unicidad satisfecha.
5. **Rollback conceptual:** la migración solo CREA estructuras nuevas de Biblioteca (no muta content/access/bundles/configs) ⇒ rollback = eliminar las estructuras nuevas; las fuentes quedan intactas y siguen operando el runtime legacy hasta el switchover explícito de LIB-01.
6. **Ejecución futura:** únicamente cuando M1-A enforce + M1-B estén GREEN (frontera del ADR §7) y LIB-01 exista; con backup previo estándar.

## 4. Qué NO hace este plan

No escribe maquinaria de migración, no toca producción, no muta bundles/configs/access/content, no decide el almacenamiento físico de las referencias (decisión de LIB-01 dentro de las restricciones arquitectónicas vigentes), no migra MOOK ni nada ajeno a Biblioteca.
