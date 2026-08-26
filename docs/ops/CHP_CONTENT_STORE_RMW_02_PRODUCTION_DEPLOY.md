# CHP-CONTENT-STORE-RMW-02 — Despliegue en producción del fix de lost updates

**Veredicto: `GREEN-CONTENT-RMW-FIX-PRODUCTION`**

Fecha de la ventana: 2026-08-26, 11:17Z–11:50Z.
Commit desplegado: `acc2227` (`acc2227e6c9f5c06cf2f551876d28d4d82ff7d85`).
Commit anterior en producción: `ffc90a1`.

Esta unidad despliega en las dos réplicas de API el arreglo descrito en
`CHP_CONTENT_STORE_RMW_01.md`: la invalidación de caché dentro del lock en los
seis flujos read-modify-write de `content.json`, más la auditoría de arranque
que ya no reescribe el array completo leído fuera del lock.

**Este GREEN autoriza únicamente que ambas APIs ejecuten el fix.** No autoriza
reanudar la carga MOOK, ejecutar los bridges R1–R3, crear los 19 recursos
faltantes, crear v1 ni publicar.

---

## 1. Baseline verificada antes de tocar nada

| Comprobación | Esperado | Observado |
|---|---|---|
| Rama | `chp/mook-contract-00` | ✅ |
| HEAD | `acc2227` | ✅ |
| `origin` idéntico | sí | ✅ misma SHA |
| CI `security` | GREEN | ✅ run #188 success |
| CI `identity-preflight` | GREEN | ✅ run #96 success |
| `api_1` / `api_2` | `ffc90a1` | ✅ ambas |
| `front` | `lib01-ffc90a1` | ✅ |
| `edge` | sin cambio | ✅ `nginx:alpine`, up 2 semanas |
| Salud / `RestartCount` | healthy / 0 | ✅ los 4 containers |
| Catálogo | 89 | ✅ |
| Recursos MOOK | 22 | ✅ |
| Uploads | 95 entradas | ✅ |
| Experience | `exp-1787709803882-9ym4tt` | ✅ única |
| Estado Experience | DRAFT, `currentVersionId:null` | ✅ |
| Versiones / runs / evidencias / publicaciones | 0 | ✅ los cuatro |
| Eventos MOOK | 0 | ✅ (`events.db` total 19 584) |
| Jobs TTS activos | ninguno | ✅ 0 en ejecución |

El working tree solo contenía las dos carpetas editoriales sin versionar. No se
añadieron al índice en ningún momento y no viajan en la imagen (ver §3).

### Congelamiento operativo

Durante toda la ventana no se ejecutó ninguna carga de contenido, ni Gestionar
Biblioteca, ni TTS o reintentos de TTS, ni el bridge. Los estados de TTS
`generando` (1) y `pendiente` (13) que existen en el catálogo son zombis
históricos de mayo, no trabajos en curso: ningún job estaba corriendo.

---

## 2. Backups previos (en serie, nunca en paralelo)

Precedidos de un preflight de capacidad para no chocar con el tope Class B de
B2 (`backup_capacity_preflight.py`): veredicto **GREEN**, repositorio legible,
coste estimado del día 9 operaciones.

| # | Unidad | Snapshot | Resultado |
|---|---|---|---|
| 1 | `structured-backup.service` | `3606e841` | exit 0 — 25 stores, integridad ok en todos |
| 2 | `uploads-backup.service` | `0549ee9d` | exit 0 — 3 328 ficheros, 5,88 GB, 0 modificados |
| 3 | `backup-verify.service` | — | exit 0 — `restic check` ok, 236 snapshots, 202 manifiestos, **0 problemas** |

Ambos backups quedaron dentro de su RPO (structured 125 s, uploads 71 s). Cero
`LockBusy`. **No se borró ningún snapshot anterior.**

El snapshot de uploads confirma que los ~19 huérfanos editoriales están
respaldados en remoto: los 3 328 ficheros figuran como `unmodified`, es decir ya
presentes en el repositorio.

### ⚠️ Hallazgo: `mook_db.json` no tiene cobertura de backup

La allowlist de `structured-backup` es anterior al MOOK y **no incluye
`data/mook_db.json`**. Los 25 stores capturados son los históricos; el store de
experiencias no está en ninguno.

Mitigación aplicada en esta ventana: copia local aditiva previa al despliegue en
`/root/chp-content-rmw-02/pre-deploy/`. La lectura no mutó el origen: los
`mtime` de ambos stores quedaron intactos.

Deuda abierta: **CHP-BACKUP-MOOK-STORE-COVERAGE-01** — añadir `mook_db.json` a
la allowlist del runner estructurado. No se corrige aquí porque tocar el
toolchain de backup queda fuera del alcance autorizado.

---

## 3. Build reproducible

Construida desde un `git archive` exacto de `acc2227`, no desde el working tree.

- SHA-256 del archive, idéntico en local y en el VPS:
  `dd2b371fe76f09f6b449de1a11d10c4180916c07a1974fe6ed38b1f0b923e246`
- 939 entradas; **cero** carpetas editoriales, ficheros sin versionar, fichero
  de entorno o `node_modules` (verificado por listado del tar).
- Imagen: `chibalete/api:acc2227`
- Image ID / digest: `sha256:0e1d9087e94e7acbf4e38df5ba01b94550a131f0f62546de6b47700bc6c51892`
- `GIT_SHA=acc2227`, `CHIBALETE_RELEASE=CHP-CONTENT-STORE-RMW-02`
- `node --check server/server.js` dentro de la imagen: OK
- `docker build`: exit 0

### Diferencias de entrada respecto al build de `ffc90a1`

| Entrada | Resultado |
|---|---|
| `Dockerfile.api` | **idéntico** |
| `package-lock.json` | **idéntico** |
| `package.json` | +1 línea: script `test:content-rmw` |
| `server/server.js` | 45 líneas de diff (el arreglo) |

### Superficie de vulnerabilidad

No hay escáner instalado en el VPS, así que la comparación se hizo de forma
empírica contra la imagen baseline en vez de por confianza en el lockfile:

| Comparación | Resultado |
|---|---|
| Paquetes de sistema (apk) | **19 / 19 idénticos** |
| Paquetes de `node_modules` | **428 / 428 idénticos** |
| Base | Alpine 3.23.4, Node v20.20.2 en ambas |

Cero vulnerabilidades nuevas atribuibles al cambio: el único delta entre las dos
imágenes es código de aplicación propio. La imagen anterior
`chibalete/api:ffc90a1` (`sha256:9c1d2ad4…`) se conserva. No se publicó ni se
eliminó ninguna imagen.

---

## 4. Smoke aislado con dos réplicas reales

Antes de tocar producción se levantaron dos containers temporales desde la
imagen `acc2227` sobre una red `--internal` (sin ruta externa), compartiendo un
store temporal bajo `/tmp`, con caches por proceso independientes, los mismos
locks de fichero y **sin ningún mount productivo**.

Resultado: **PASS 16 / FAIL 0**.

| Escenario | Exigido | Resultado |
|---|---|---|
| 39 creaciones alternando réplica | 39/39 sobreviven | ✅ 39/39 |
| 20 escrituras adicionales | el conteo nunca retrocede | ✅ 0 retrocesos |
| Progreso TTS concurrente con creaciones | el TTS no borra contenido | ✅ 12/12 concurrentes vivas, 0 registros previos perdidos |
| Eliminación concurrente con creación | no resucita registros | ✅ eliminado no reaparece, creado persiste, 0 arrastrados |
| Duplicados | 0 | ✅ |
| JSON válido | sí | ✅ array válido |
| Locks / temporales huérfanos | 0 | ✅ |
| Monotonía global (72 censos) | sin bajadas | ✅ min 1 → max 72 |

### Control negativo: el smoke no es vacuo

El mismo harness se ejecutó contra la imagen **`ffc90a1`** (fixture nuevo,
containers nuevos). Reprodujo el incidente con exactitud:

```text
FAIL 39/39 sobreviven :: sobreviven 20/39, faltan 19
FAIL el conteo nunca retrocede :: 21->20
```

**19 de 39 registros perdidos** — la misma proporción que destruyó la carga real
del mook. Esto demuestra que el smoke detecta el defecto y que `acc2227` lo
corrige, en lugar de pasar por construcción.

Se destruyeron únicamente los containers, redes y datos temporales creados por
esta prueba. Producción quedó intacta: `content.json` y `mook_db.json`
conservaron su hash durante todo el smoke.

---

## 5. Rolling

La imagen viaja **dentro** del container: `/app/server` no es un bind mount
(solo lo es `/app/server/.deploy-info`, en solo lectura). No se usó el antiguo
procedimiento de swap de bind mount.

El único cambio de configuración fue el tag de imagen en
`docker-compose.override.yml`, una réplica cada vez. Diff total contra el
respaldo: **2 líneas**, ambas de imagen. Nada más se tocó.

### 5.1 `api_1` — 11:36:39Z

Gate completo exigido antes de tocar `api_2`:

| Comprobación | Resultado |
|---|---|
| Container healthy | ✅ |
| `RestartCount` | ✅ 0 |
| `GIT_SHA` | ✅ `acc2227` |
| `/api/health`, `/api/health/ready` | ✅ 200 / 200 |
| Rutas legacy sin sesión | ✅ 401 en `/api/content`, `/api/groups`, `/api/experiences` — idéntico a baseline |
| Permisos administrativos | ✅ sin regresión: 200 con secreto válido y 401 sin él, **igual en ambas réplicas** |
| Catálogo (read-only) | ✅ 89 |
| Recursos MOOK | ✅ 22 |
| Experience | ✅ DRAFT intacta, `currentVersionId:null` |
| Versiones / publicaciones | ✅ 0 / 0 |
| Logs | ✅ sin errores reales |
| Frontend resuelve ambos upstreams | ✅ 30/30 respuestas, reparto 15/15 |
| `api_2` sigue en `ffc90a1` | ✅ |

Durante el estado mixto no se ejecutó ninguna escritura de contenido como smoke.
El estado mixto duró **3 min 18 s**, solo lo necesario para validar.

Detalle relevante: `content.json` y `mook_db.json` quedaron **byte-idénticos**
tras el arranque de `api_1`. La auditoría de arranque (`checkMissingTTS`) — uno
de los flujos que antes reescribía el array completo — no mutó el store.

### 5.2 `api_2` — 11:39:57Z

| Comprobación | Resultado |
|---|---|
| Ambas réplicas healthy | ✅ |
| Ambas con `GIT_SHA=acc2227` | ✅ |
| `RestartCount` | ✅ 0 en ambas |
| Health y rutas legacy | ✅ verdes e idénticas en las dos |
| Frontend y edge sanos | ✅ front 200 |
| 502 / 503 | ✅ 0 |
| Edge y front `StartedAt` intacto | ✅ edge 2026-08-11T01:33:31Z, front 2026-08-25T23:29:04Z — sin cambio |

Verificación end-to-end final a través del edge: **40/40 respuestas correctas**,
reparto **20/20** entre las dos réplicas.

### Nota operativa: reresolución de IP en el edge

`upstream chibalete_api_pool` referencia las réplicas por nombre y nginx resuelve
en carga de configuración, no por petición. Recrear un container puede cambiar su
IP y dejar al edge apuntando a la antigua. En esta ventana **no ocurrió**: ambas
réplicas conservaron su IP (`172.21.0.4` y `172.21.0.2`), de modo que no hizo
falta recargar el edge ni drenar instancias, y el edge quedó literalmente sin
tocar. Queda anotado para el próximo deploy basado en imagen: verificar la IP
tras recrear, y recargar el edge solo si cambió.

---

## 6. Verificación final de integridad (read-only)

| Store / activo | Resultado |
|---|---|
| `content.json` | **byte-idéntico** a pre-deploy (`082a971c…`) |
| `mook_db.json` | **byte-idéntico** a pre-deploy (`d69a8f34…`) |
| Catálogo | 89 |
| Recursos MOOK | 22 |
| Uploads | 95 entradas, listado **idéntico** |
| ~19 uploads huérfanos | ✅ conservados, ninguno tocado |
| Libro padre | ✅ `content-1774362922886`, `disponible` |
| Experience | ✅ única, `status:'draft'`, `currentVersionId:null` |
| Versiones / runs / evidencias / publicaciones | ✅ 0 / 0 / 0 / 0 |
| Eventos MOOK | ✅ 0 (`events.db` sigue en 19 584 — cero eventos nuevos) |
| Grupos | ✅ sin cambios |
| Padrón | ✅ sin cambios atribuibles (último `mtime` 11:16:41Z, **anterior** al inicio del rolling a las 11:36:39Z) |

El despliegue no mutó ningún store. Las únicas peticiones registradas fueron de
salud y verificación read-only; ninguna mutación MOOK.

---

## 7. Observación y logs

| Métrica | Ventana | Resultado |
|---|---|---|
| 5xx en edge | pre-deploy 2 h | 0 |
| 5xx en edge | durante el estado mixto | 0 |
| 502 / 503 | toda la ventana | 0 |
| Errores en `api_1` | desde su recreación | 0 reales |
| Errores en `api_2` | desde su recreación | 0 reales |

La única línea que coincide con el patrón de error es la de error-tracking
deshabilitado por ausencia de DSN, que es informativa, no un fallo.

---

## 8. Rollback

Preparado por réplica durante toda la ventana y **no fue necesario**.

- Imagen anterior conservada: `chibalete/api:ffc90a1` (`sha256:9c1d2ad4…`).
- Override respaldado en
  `/root/chp-content-rmw-02/docker-compose.override.yml.pre-acc2227`
  (`sha256:d1fe8e57…`).
- Procedimiento: restaurar el tag `ffc90a1` en el bloque de la réplica afectada
  dentro de `docker-compose.override.yml` y recrear **solo** esa réplica con
  `docker compose up -d --no-deps <servicio>`; validar antes de tocar la otra.

Rollback **de código únicamente**: el fix no tiene migración ni estado que
revertir, así que no se restauran datos, no se borran imágenes y no se tocan
uploads.

---

## 9. Estado del MOOK al cierre

Sin cambios respecto a la baseline. La carga sigue **parcial y congelada**:

- Experience `exp-1787709803882-9ym4tt` en DRAFT, sin versión actual.
- 22 recursos MOOK de los 39 previstos; faltan los 19 destruidos por el defecto
  que este despliegue corrige.
- 0 versiones, 0 runs, 0 evidencias, 0 publicaciones, 0 eventos.

### ⛔ Los uploads huérfanos NO deben limpiarse

Las ~19 entradas de `public/uploads` sin referencia en `content.json` son los
MP3 y TXT de los recursos destruidos: activos editoriales, no basura. Siguen
íntegras y respaldadas. No se tocaron en esta ventana.

---

## 10. Próximo paso

Con ambas réplicas ejecutando el fix, la reanudación de la carga MOOK
(bridges R1–R3, recreación de los 19 recursos faltantes, creación de v1 y
publicación) es una **unidad posterior que requiere autorización explícita** y
su propia ventana. Este documento no la habilita.

Antes de esa unidad conviene resolver
**CHP-BACKUP-MOOK-STORE-COVERAGE-01** (§2): reanudar la carga sin cobertura de
backup de `mook_db.json` deja el store de experiencias sin red de seguridad
justo cuando empieza a recibir escrituras.

---

## 11. Artefactos

- Respaldo del override: `/root/chp-content-rmw-02/docker-compose.override.yml.pre-acc2227`
- Copias pre-deploy de stores: `/root/chp-content-rmw-02/pre-deploy/`
- Archive y árbol del build: `/root/chp-content-rmw-02/build/`
- Driver del smoke aislado: `/root/chp-content-rmw-02/rmw_driver.mjs`
- Snapshots restic: `3606e841` (structured), `0549ee9d` (uploads)
