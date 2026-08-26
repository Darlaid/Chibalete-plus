# CHP-CI-CONTENT-RMW-01 — gate bloqueante de seguridad RMW entre réplicas

Veredicto: **GREEN-CI-CONTENT-RMW-GATE**.

Este GREEN **no autoriza producción ni la recuperación del MOOK.** Solo
establece que la regresión ya no puede reintroducirse en silencio.

| | |
|---|---|
| Rama | `chp/mook-contract-00` |
| Commits | `40807b3` (gate) · `ad8f386` (control negativo) · este documento |
| Workflow | `.github/workflows/content-rmw.yml` |
| Check | `content-rmw` — job único, bloqueante |
| Run real GREEN | [`33012749298`](https://github.com/Darlaid/Chibalete-plus/actions/runs/33012749298) — `content-rmw: success`, `workflow: success` |
| Run real RED | [`33013055751`](https://github.com/Darlaid/Chibalete-plus/actions/runs/33013055751) — control negativo, `failure` |

---

## 1. Defecto protegido

`CHP-CONTENT-STORE-RMW-01` (incidente del 2026-08-26, documentado en
`CHP_CONTENT_STORE_RMW_01.md` y `CHP_CONTENT_STORE_RMW_02_PRODUCTION_DEPLOY.md`).

`content.json` era el **único** store que, dentro del lock, releía con
`readJSON(DB_FILE)` — y `readJSON` sirve la **caché en proceso** con un TTL de
30 s. `withFileLock` es cross-process y correcto; el fallo no estaba ahí. Cada
réplica reescribía el **array completo** a partir de una instantánea de hasta
30 s de antigüedad y borraba en silencio lo que la otra hubiera añadido
entretanto. `mutateMook` nunca lo sufrió porque invalida antes de leer.

Consecuencia real: la carga del mook «¿Estás aquí?» creó 39 recursos repartidos
por round-robin entre `chibalete_api_1` y `chibalete_api_2`; **sobrevivieron 20**.
19 recursos destruidos, y el 404 de la versión era verídico.

El arreglo (`acc2227`, ya en producción) invalida la caché **antes** de leer en
los 6 flujos RMW de `content.json`. Este gate impide que se deshaga.

## 2. Qué corre el gate

```
npm run test:content-rmw
  → node server/__test__/contentStoreRmwSuiteIntegrity.test.mjs   (29 aserciones)
  → node server/__test__/contentStoreRmwConcurrency.test.mjs      (27 aserciones)
```

**`contentStoreRmwConcurrency`** arranca **dos procesos `server.js` reales**
contra un store compartido en un directorio temporal y verifica **leyendo el
disco**: reproducción de la secuencia exacta del bridge (39 escrituras
alternando réplica), volumen (100 ids), monotonía del conteo, progreso TTS
asíncrono concurrente con creaciones, edición de metadata desde ambas réplicas,
eliminación concurrente sin resurrección, idempotencia de ráfaga, e invariantes
de integridad (0 duplicados, 0 locks huérfanos, 0 temporales, stores ajenos
intactos). Incluye además un **ratchet estructural** sobre `server.js`: los 6
flujos siguen presentes, todos invalidan antes de leer, y ninguna escritura
ocurre fuera de un lock.

**`contentStoreRmwSuiteIntegrity`** (nuevo) protege *al gate de sí mismo*. Una
suite reescrita con dobles de prueba o con una sola réplica seguiría en verde
mientras deja de proteger nada, porque el defecto vive en la interacción entre
el lock de fichero y una caché **por proceso**: un único proceso comparte caché
y no puede reproducirlo. El guard exige, sobre el fichero de la suite:

- arranca `server.js` como proceso hijo real, **≥2 réplicas**, en dos puertos
  distintos de loopback, esperando `/api/health`;
- **cero** marcos de dobles (`sinon`, `proxyquire`, `mock-fs`, `nock`,
  `testdouble`, `jest.mock`, `mock.method`, `MockAgent`, `setGlobalDispatcher`)
  y cero reasignación de `readJSON`/`writeJSON`/`_jsonCache`/`withFileLock`
  ni de `fetch`;
- las aserciones leen el store **del disco**, no de una respuesta HTTP;
- conserva los volúmenes 39 y 100, el ratchet, la cobertura de TTS y de
  eliminación, y ≥20 aserciones;
- aislamiento: `mkdtemp` bajo `os.tmpdir()`, cero rutas o dominios productivos
  **en código**, cero hosts externos, claves de IA vaciadas;
- limpieza en `finally` y salida con código ≠ 0 si algo falla.

> El guard inspecciona **solo** el fichero de la suite, nunca el suyo. Por eso
> puede nombrar los literales prohibidos sin detectarse a sí mismo — la trampa
> anti-literal que ya mordió en `CHP-BACKUP-TEST-SANDBOX-GUARD-01`. Si algún día
> se fusionaran ambos ficheros, esa propiedad se pierde.

## 3. Trigger

```yaml
on:
  push: { branches: ["**"] }
  pull_request:
  workflow_dispatch: { inputs: { negative_control: false|true } }
```

**Sin path filters, a propósito.** Este job está pensado para ser un *required
check* en branch protection, y un check filtrado por rutas queda
`expected — waiting` para siempre en cualquier PR que no toque esas rutas: el
merge se bloquea sin haber ejecutado nada. Correr siempre cuesta ~35 s y cubre
de sobra todo lo capaz de afectar al defecto:

| Superficie | Por qué importa |
|---|---|
| `server/server.js` | `_jsonCache`, `readJSON`/`writeJSON`, los 6 flujos RMW |
| `server/usersLock.js` | `withFileLock` |
| `server/__test__/contentStoreRmw*.mjs` | la propia suite y su guard |
| `package.json` / `package-lock.json` | el script del gate y el árbol de deps |
| `.github/workflows/content-rmw.yml` | el gate mismo |

`concurrency` incluye `github.event_name`. Sin eso, un control negativo lanzado
a mano comparte `github.ref` con el push de la misma rama y **cancela** el run
del push — observado en vivo: el run de push de `ad8f386` quedó `cancelled`.

## 4. Aislamiento

| Exigencia | Cómo se cumple / comprueba |
|---|---|
| Linux efímero | `ubuntu-latest`, runner desechable |
| Node del proyecto | `actions/setup-node@v4`, `node-version: '20'` (igual que `identity-preflight` y `security`) |
| Instalación reproducible | `npm ci` sobre `package-lock.json`; el proyecto no tiene hooks `pre/post/install` |
| Timeout explícito | `timeout-minutes: 15` (el job real tarda **34 s**) |
| Bloqueante | sin `continue-on-error` (ni en job ni en pasos), sin `|| true` |
| Sin secretos | no hay bloque `secrets`/`env` que los referencie; `permissions: contents: read`, lo mínimo para el checkout |
| Sin producción | cero URLs productivas, cero SSH, cero mounts; el guard falla si la suite nombra `/var/www`, `/opt/chibalete`, `data-critical`, `chibaleteplus`… en código |
| Sin stores reales | paso previo: `git ls-files -- data data-critical public/uploads uploads` vacío **y** `data/`, `data-critical/` inexistentes en el clone |
| Sin reutilizar stores | cada run crea el suyo con `mkdtemp`; el runner muere con el job |
| Sin red durante la prueba | solo loopback; `OPENAI_API_KEY`/`GEMINI_API_KEY` se inyectan vacías, así que el TTS emite su primer progreso —la escritura que interesa— sin llamar a ningún proveedor |
| Limpieza | paso `if: always()`: 0 directorios `/tmp/chp_rmw_*` y 0 procesos `server/server.js` vivos |

El harness **no** se copió a `/opt/chibalete-backup` ni se ejecutó nada en el
VPS.

## 5. Control negativo

Se hizo dos veces, y ninguna tocó el árbol versionado.

**(a) Local, sobre una copia desechable.** Copia de `server/`, `utils/`,
`engines/` en un directorio dentro del repo (para que `node_modules` resuelva),
retirada **una** invalidación de caché del flujo RMW de creación (línea 2753) y
ejecutada la suite:

```
✗ 39/39 registros sobreviven          sobreviven 20/39
✗ ningún id creado desaparece         faltan 19: rmw-alt-01, rmw-alt-03, …
✗ 100/100 registros sobreviven        esperados 120, hay 100
✗ todos invalidan la caché antes de leer   1 flujo(s) leen sin invalidar
```

**20/39 — la proporción exacta del incidente de producción.** Copia eliminada;
`git diff server/server.js` vacío; suite de nuevo 27/27 GREEN.

También se verificó que el **guard de integridad** es fail-closed ante la
sustitución de la suite: réplica única → ✗, doble de prueba (`sinon`) → ✗,
verificación por HTTP en vez de disco → ✗ (3 fallos, exit 1); stub trivial → 20
fallos; fichero borrado → exit 1.

**(b) En CI, de verdad.** `workflow_dispatch` con `negative_control=true`
degrada el checkout **efímero del runner** —el repositorio no se toca nunca— y
deja que el gate falle. Run [`33013055751`](https://github.com/Darlaid/Chibalete-plus/actions/runs/33013055751):

```
invalidación retirada (línea 2753); quedan 5 de 6
contentStoreRmwSuiteIntegrity — PASS 29 / FAIL 0
  ✗ 39/39 registros sobreviven        sobreviven 20/39
  ✗ ningún id creado desaparece       faltan 19: rmw-alt-01, …
contentStoreRmwConcurrency — PASS 19 / FAIL 8
temporales chp_rmw_* restantes: 0
OK — 0 temporales, 0 procesos hijos
```

| paso | conclusión |
|---|---|
| Control negativo (solo runner) | success |
| **Gate — pérdida de escrituras entre réplicas** | **failure** |
| No deben quedar procesos hijos ni temporales | success |
| **job / workflow** | **failure** |

El ancla es **semántica** (el flujo RMW de creación), no un número de línea, y
el paso falla si el ancla desaparece: un control negativo vacuo sería peor que
no tenerlo. Nunca se activa en `push` ni en `pull_request`.

## 6. Run real GREEN

[`33012749298`](https://github.com/Darlaid/Chibalete-plus/actions/runs/33012749298) — `40807b3`, evento `push`.

```
content-rmw: success
workflow:    success
```

| # | paso | dur. |
|---|---|---|
| 2 | checkout | 2 s |
| 3 | setup-node (20) | 7 s |
| 4 | `npm ci` | 13 s |
| 5 | ningún store real | 0 s |
| 6 | **gate** | **8 s** |
| 7 | 0 temporales / 0 procesos | 0 s |
| | **job** | **34 s** |

```
OK — sin stores reales
contentStoreRmwSuiteIntegrity — PASS 29 / FAIL 0
  ✓ 39/39 registros sobreviven
  ✓ 100/100 registros sobreviven
  ✓ 12/12 creaciones concurrentes al TTS sobreviven
contentStoreRmwConcurrency — PASS 27 / FAIL 0
temporales chp_rmw_* restantes: 0
OK — 0 temporales, 0 procesos hijos
```

Margen frente al timeout: 34 s de 15 min.

## 7. Para hacerlo *required*

El gate ya es bloqueante **dentro de su workflow**. Convertirlo en obligatorio
para merge es una acción de UI que este trabajo no puede hacer:

> Settings → Branches → branch protection de `main` → *Require status checks to
> pass* → añadir **`content-rmw`**.

Es seguro precisamente porque no tiene path filters: reporta en todos los PR.

## 8. Rollback

Sin riesgo productivo: no se desplegó nada y `server/server.js` queda
**byte-idéntico a `acc2227`**.

- Desactivar el gate sin perder la suite: `git revert` del commit del workflow,
  o borrar `.github/workflows/content-rmw.yml`. `npm run test:content-rmw` sigue
  ejecutable a mano.
- Revertir también el encadenado del guard: restaurar en `package.json`
  `"test:content-rmw": "node server/__test__/contentStoreRmwConcurrency.test.mjs"`.
- Quitar solo el control negativo: revertir `ad8f386`.

## 9. Relación con la recuperación del MOOK

Este gate es **preventivo**, no correctivo. No recupera nada:

- los 19 recursos destruidos **siguen destruidos**;
- la Experience sigue en `DRAFT` con `currentVersionId: null`;
- **⛔ no limpiar los ~19 uploads huérfanos**: son los MP3/TXT de los recursos
  destruidos y son el material de una eventual reconstrucción;
- este GREEN **no autoriza** reanudar la carga MOOK ni publicar.

Lo que sí aporta: cuando se reanude la carga, la causa que destruyó 19 de 39
recursos no puede reintroducirse sin poner el CI en rojo.

## 10. Estado de partida (no re-verificado contra el VPS)

Los hechos productivos se toman de `CHP_CONTENT_STORE_RMW_02_PRODUCTION_DEPLOY.md`
(despliegue de `acc2227`). **No se consultó el VPS en este trabajo**, porque el
encargo prohíbe tocar producción:

| | último estado registrado |
|---|---|
| APIs productivas | `acc2227` (ambas réplicas, `GIT_SHA=acc2227`) |
| Catálogo | 89 |
| Recursos MOOK | 22 (de los 39 previstos) |
| Experience | `DRAFT`, `currentVersionId: null` |

Backup: `backup-capacity` GREEN en `dc38f04` (harness sandbox + cobertura de
`mook_db.json`, 26 stores).

## 11. Deuda registrada, no tocada

- **`CHP-BACKUP-STALE-BUILD-TREES-01`** — ~22 árboles de build antiguos bajo
  `/root` y `/tmp/integ` en el VPS conservan copias del harness de backup sin el
  guard fail-closed. **No se tocaron.** Deuda separada.
- **Pre-existente, ajeno a este trabajo:** `npm run test:analytics` falla con
  43 ✓ / 3 ✗ (`EVENT_CATEGORIES = 13` frente a 12 esperadas; faltan samples de
  los eventos MOOK `experience_started`, `node_started`, `node_completed`,
  `evidence_submitted`, `evidence_reviewed`, `experience_completed`).
  Reproducido idéntico en el árbol limpio de `a3f8afc`, antes de este cambio.
  No lo ejecuta ningún workflow bloqueante.

## 12. Ficheros

| fichero | cambio |
|---|---|
| `.github/workflows/content-rmw.yml` | nuevo — gate bloqueante + control negativo manual |
| `server/__test__/contentStoreRmwSuiteIntegrity.test.mjs` | nuevo — 29 aserciones de integridad del gate |
| `package.json` | `test:content-rmw` encadena guard + suite |
| `docs/ops/CHP_CI_CONTENT_RMW_01.md` | este documento |

`server/server.js` **no se modificó**.
