# CHP-CONTENT-STORE-RMW-01 — Pérdida de escrituras entre réplicas en `content.json`

**Estado:** `GREEN-CONTENT-RMW-FIX-READY` — código corregido y probado. **No desplegado.**
**Rama:** `chp/mook-contract-00` · **Base:** `76b9e51` · **Producción al cierre:** `chibalete/api:ffc90a1` (sin tocar)
**Fecha:** 2026-08-26

---

## 1. Incidente

El 2026-08-26, la carga del mook «¿Estás aquí?» en producción (unidad 04D) creó **39 recursos**
repartidos por round-robin del edge entre `chibalete_api_1` y `chibalete_api_2`. El bridge verificó
cada recurso tras crearlo y todas las verificaciones dieron positivo.

Al terminar, la creación de la versión v1 devolvió **404**. La forense (04D-R8) demostró que el 404
era **verídico**: de los 39 recursos creados solo **20 sobrevivían** en `content.json`. El guard
`RESOURCE_NOT_FOUND` de `createDraftVersion` informaba correctamente de que faltaban `resourceRef`.

Las verificaciones del bridge no fueron falsas: cada recurso **existía en el instante en que se
comprobó**. Lo que ocurrió es que escrituras posteriores lo borraban.

Reparto de supervivencia medido en los logs de producción:

```
api_1: 19 escrituras → 18 sobreviven
api_2: 20 escrituras →  2 sobreviven
total: 39 escrituras → 20 sobreviven, 19 DESTRUIDAS
alternancias de réplica: 37 en 39 escrituras
```

---

## 2. Causa raíz

Las seis rutas read-modify-write de `content.json` toman correctamente un lock **cross-process**
(`withFileLock` usa `O_EXCL` sobre el bind mount compartido; ver `server/usersLock.js`). Pero la
relectura «fresca» **dentro** del lock era `readJSON(DB_FILE)`, que sirve la **caché en proceso con
TTL de 30 s**: `content.json` no está en `UNCACHED_JSON_FILES`, que solo contiene `USERS_DB`.

Consecuencia: una réplica reescribe el array **completo** partiendo de una instantánea vieja y
**borra en silencio todo lo que la otra réplica añadió** desde esa instantánea. El lock impide
escrituras rotas; no impide *lost updates*.

```js
// ANTES — vulnerable
await withFileLock(DB_FILE, () => {
    const freshList = readJSON(DB_FILE);   // ← caché de hasta 30 s
    freshList.push(newContent);
    writeJSON(DB_FILE, freshList);         // ← reescribe TODO el array
});
```

`mutateMook` nunca sufrió esto porque invalida antes de leer:

```js
_jsonCache.delete(MOOK_DB);
const doc = normalizeMookStore(readJSON(MOOK_DB));
```

**`content.json` era el único store del servidor sin esa invalidación.** Todos los demás
—`GROUPS_DB`, `SECTIONS_DB`, `SCHOOLS_DB`, `SCHOOL_CONFIGS_DB`, `ACCESS_DB`, `LEO_MEMORY_DB`,
`INTERVENTIONS_DB`, `USER_AUDIT_DB`, `SUBMISSIONS_DB`, `BUNDLES_DB`, `LIBRARY_DB`, `MOOK_DB`,
`USERS_DB`— ya la aplicaban. La corrección **restituye un invariante que el código ya sostenía en
todas partes**; no introduce un diseño nuevo.

---

## 3. Los seis flujos auditados

| # | Ruta / worker | Lectura base | Lock | Riesgo antes | Corrección |
|---|---|---|---|---|---|
| 1 | `DELETE /api/content/:id` | dentro del lock, cacheada | ✅ | resucita registros borrados por la otra réplica y elimina los que ella creó | invalidar antes de leer |
| 2 | `POST /api/content` (alta/edición) | dentro del lock, cacheada | ✅ | **origen del incidente**: destruye altas de la otra réplica | invalidar antes de leer |
| 3 | `onProgress` TTS del alta | dentro del lock, cacheada | ✅ | escritura asíncrona y repetida por job; el vector más agresivo | invalidar antes de leer |
| 4 | `POST /api/content/:id/retry` (reset) | dentro del lock, cacheada | ✅ | mismo patrón | invalidar antes de leer |
| 5 | `onProgress` TTS del retry | dentro del lock, cacheada | ✅ | mismo patrón | invalidar antes de leer |
| 6 | `checkMissingTTS` (auditoría de arranque) | **fuera del lock** | ✅ | el peor: reescribe entera una lista leída antes de un escaneo de ficheros que dura segundos | releer dentro del lock y aplicar solo los campos auditados, por id |

---

## 4. Corrección aplicada

**Un solo fichero: `server/server.js`. 26 inserciones, 4 eliminaciones.**

Flujos 1–5 — una línea cada uno, como primera sentencia dentro del lock:

```js
await withFileLock(DB_FILE, () => {
    _jsonCache.delete(DB_FILE);            // ← añadido
    const freshList = readJSON(DB_FILE);   // ahora lectura física
    ...
    writeJSON(DB_FILE, freshList);
}, 'contentLock');
```

Flujo 6 — la lista se leía antes del lock; ahora se relee dentro y se aplican **solo los campos que
la auditoría decidió cambiar**, registro a registro. Se registran los ids tocados durante el escaneo
(`idsModificados`) y un registro eliminado entretanto por otra réplica **no se resucita**:

```js
await withFileLock(DB_FILE, () => {
    _jsonCache.delete(DB_FILE);
    const freshList = readJSON(DB_FILE);
    const auditados = new Map(contentList.map(c => [c.id, c]));
    for (const id of idsModificados) {
        const idx = freshList.findIndex(c => c.id === id);
        const auditado = auditados.get(id);
        if (idx === -1 || !auditado) continue;   // eliminado por otra réplica: no se resucita
        freshList[idx].status = auditado.status;
        freshList[idx].ttsStatus = auditado.ttsStatus;
        if (auditado.processingStatus !== undefined) freshList[idx].processingStatus = auditado.processingStatus;
    }
    writeJSON(DB_FILE, freshList);
}, 'contentLock');
```

**Lo que NO se hizo:** no se desactivó la caché de lectura (`content.json` sigue cacheado 30 s para
lecturas; el objetivo es la consistencia de las **escrituras**), no se añadieron dependencias, base
de datos, cola ni servicio distribuido, no se cambió el esquema ni se migró nada, y no se tocaron
autenticación, grupos, MOOK ni telemetría.

---

## 5. Reproducción y pruebas

`server/__test__/contentStoreRmwConcurrency.test.mjs` — **dos procesos `server.js` reales** contra un
`CHP_DATA_DIR` temporal. Dos procesos y no mocks porque el defecto vive en la interacción entre el
lock de fichero y una caché **por proceso**: un solo proceso comparte caché y no puede reproducirlo.

**Sobre el baseline sin corregir (fallo esperado y obtenido):**

```
[1] 39 escrituras alternando réplica  ✗ sobreviven 20/39   ← idéntico a producción
[5] dos actualizaciones de metadata    ✗ ambas ediciones perdidas
[4] el contenido con TTS               ✗ desaparecido
PASS 15 / FAIL 8
```

Los 19 perdidos fueron los de índice impar: **el mismo patrón alternante que en producción**.

**Con la corrección: `PASS 27 / FAIL 0`.**

| Bloque | Qué demuestra |
|---|---|
| [0] ratchet estructural | los 6 flujos siguen presentes, todos invalidan antes de leer, toda escritura vive dentro de un lock, la auditoría ya no reescribe la lista leída fuera del lock |
| [1] | 39/39 sobreviven en la secuencia exacta del bridge |
| [2] | 100 ids únicos desde dos procesos → 100/100 |
| [3] | el conteo **solo aumenta, nunca retrocede** |
| [4] | progreso TTS real en una réplica + 12 creaciones en la otra → nada se pierde y el estado TTS persiste |
| [5] | dos ediciones de metadata, una por réplica, ambas persisten (respetando el guard de idempotencia de 2 s) |
| [6] | eliminación y creación concurrentes: lo borrado no reaparece, lo creado persiste, nada ajeno se arrastra |
| [7] | idempotencia de ráfaga existente intacta |
| [8] | JSON siempre válido, 0 duplicados, sin locks ni temporales huérfanos |
| [9] | `users.json`, `groups.json` y `mook_db.json` intactos |

El bloque [4] ejercita el **camino real** del TTS: `generateAudioForContent` emite su primer
`onProgress` antes de llamar al proveedor, así que basta un fichero de texto y no hace falta red.

Aislamiento: todo en ficheros temporales. El test nunca toca `data/`, `data-critical/` ni uploads
productivos.

---

## 6. Regresiones

| Suite | Resultado |
|---|---|
| `contentStoreRmwConcurrency` (nueva) | ✅ 27/27 |
| `test:mook` | ✅ verde |
| `test:library` | ✅ 17 escenarios |
| `test:memberships` | ✅ 51 ok, 0 fallidos |
| `test:metric-contract` | ✅ verde |
| `jsonCacheCoherence` | ✅ 5/5 |
| `realStoreGuard` | ✅ verde |
| `typecheck:baseline` | ✅ sin regresiones (current == baseline) |
| `npm run build` | ✅ built in 20,46 s |
| `test:analytics` | ⚠️ **rojo PREEXISTENTE** — `43 ✓, 3 ✗`, idéntico con y sin este cambio |

El rojo de `test:analytics` se verificó aislando el fichero modificado (`git stash push --
server/server.js`): el baseline intacto produce **exactamente el mismo** `43 ✓, 3 ✗`. Es el registro
de eventos del backbone MOOK (`EVENT_CATEGORIES = 13`, faltan samples `experience_*`), ajeno a
`content.json` y a esta unidad. No se toca aquí.

---

## 7. Compatibilidad y rollback

**Compatibilidad total hacia atrás.** No cambia el formato de `content.json`, ni contratos HTTP, ni
respuestas, ni esquema. Una réplica corregida y una sin corregir pueden convivir: la corregida deja
de destruir, la no corregida sigue destruyendo hasta que se actualice. Por eso el rolling debe
completarse en las dos réplicas.

**Efecto de rendimiento:** una lectura física adicional por escritura de contenido. Las lecturas de
`GET /api/content` conservan su caché de 30 s. El volumen de escrituras de contenido es bajo
(altas editoriales y progreso TTS).

**Rollback:** revertir el commit y reconstruir la imagen. No hay estado que deshacer, no hay
migración que revertir, no hay datos que restaurar.

---

## 8. Plan de despliegue (unidad posterior, requiere autorización explícita)

1. CI verde sobre la rama.
2. Construir imagen `chibalete/api:<sha>` con el flujo canónico (`git archive` → build en VPS → tag).
3. Backup previo (`structured-backup`, en serie: nunca en paralelo con `uploads-backup`).
4. Rolling escalonado: `api_1` → validar salud y smoke → `api_2`.
5. Smoke: alta de un contenido de prueba alternando réplicas, verificando que el conteo del catálogo
   solo aumenta.
6. Solo entonces reanudar 04D con un bridge R4.

---

## 9. Estado del MOOK al cierre de esta unidad

**No se tocó producción.** Verificado al inicio y sin cambios:

```
catálogo productivo : 89
recursos MOOK       : 22 de 41   (19 perdidos en el incidente)
uploads             : 95 entradas (~19 huérfanos de los recursos perdidos)
experience          : exp-1787709803882-9ym4tt · estas-aqui · draft · currentVersionId: null
versions / runs / evidence : 0 / 0 / 0
api_1, api_2, front, edge  : healthy, restarts=0, ffc90a1
```

La Experience es **byte-exacta** contra el manifest v2 en `title`, `description`, `durationLabel` y
`audience`, y es adoptable como `REUSE-RESUME`.

### ⛔ Los uploads huérfanos NO deben limpiarse

Los ~19 ficheros sin referencia en `uploads/` son los MP3 y TXT de los recursos destruidos.
**Son activos editoriales, no basura.** Una limpieza de huérfanos los borraría y obligaría a
resubirlos. Deben conservarse hasta que 04D termine y se verifique el estado final. Esta prohibición
es vinculante para cualquier tarea de mantenimiento de disco.

---

## 10. Hallazgos fuera de alcance (reportados, NO corregidos aquí)

Dos stores más comparten el mismo patrón —lectura cacheada dentro del lock y reescritura del array
completo—:

- `LEO_INTERACTIONS_DB` (`/api/leo/ask`, persistencia de interacciones)
- `ANALYTICS_DB` (ingesta de eventos legacy)

Ambos son *append-only* con tope de 50 000 entradas, así que el efecto sería pérdida de eventos
telemétricos, no de contenido editorial. **No se modifican en esta unidad**: no hay evidencia de
incidente y ampliar el cambio sin necesidad demostrada contradice las reglas del repo. Quedan como
deuda: `CHP-TELEMETRY-STORE-RMW-01`.

---

## 11. Archivos

| Archivo | Cambio |
|---|---|
| `server/server.js` | +26 / −4 — las seis correcciones |
| `server/__test__/contentStoreRmwConcurrency.test.mjs` | nuevo — reproducción, ratchet y 27 aserciones |
| `package.json` | nuevo script `test:content-rmw` |
| `docs/ops/CHP_CONTENT_STORE_RMW_01.md` | este documento |
