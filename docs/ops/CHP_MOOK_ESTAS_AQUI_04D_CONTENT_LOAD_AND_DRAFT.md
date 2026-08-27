# CHP-MOOK-ESTAS-AQUI-04D — CONTENT LOAD AND PRODUCTION DRAFT

**Veredicto:** 🟢 **`GREEN-MOOK-V1-DRAFT-READY-FOR-FINAL-QA`** — ver **Anexo de cierre** al final.
> *(El veredicto original de esta unidad, `YELLOW-OPERATOR-LOGIN`, se conserva abajo como registro histórico del punto en que se detuvo.)*
**Rama:** `chp/mook-contract-00` · **Código productivo al cierre:** `910c735` (era `ffc90a1` cuando se escribió lo de abajo)
**Fecha:** 2026-08-26 · **Operador:** Nicolás Jiménez

> **Fase A completa y GREEN. Cero escrituras ejecutadas.** El preflight, el manifest y el backup
> canónico previo están hechos y verificados. La unidad se detiene **antes del primer POST** porque
> no dispongo de una vía de autenticación de escritura que respete los límites de la Fase B.
> Ver §N.
>
> **Estado productivo intacto:** `mook_db.json` sigue sin existir, catálogo en 67 registros,
> 0 recursos MOOK, 0 experiencias, nada publicado.

---

## A. VEREDICTO

| Fase | Resultado |
|---|---|
| A · Preflight y backup | 🟢 **completa** |
| B · Autenticación de carga | 🟡 **BLOQUEADA** — opción A probada e insuficiente, ver Anexo R1 |
| C–J | ⏸️ **no ejecutadas** |

**No se emitió** `STOP-MANIFEST-DRIFT` (manifest idéntico), `STOP-CATALOG-CONFLICT` (0 conflictos),
`RED-DRAFT-VISIBLE` ni `RED-PRODUCTION-REGRESSION` (producción intacta y sana).

---

## B. BASELINE Y BACKUPS

### Salud productiva antes de la unidad

| Container | Imagen | Health | Restarts |
|---|---|---|---|
| `chibalete_api_1` | `chibalete/api:ffc90a1` | healthy | **0** |
| `chibalete_api_2` | `chibalete/api:ffc90a1` | healthy | **0** |
| `chibalete_front` | `chibalete/front:lib01-ffc90a1` | healthy | **0** |
| `chibalete_edge` | `nginx:alpine` | healthy | **0** |

Errores en `api_1` / `api_2` / `front` (2 h): **0 / 0 / 0**. **5xx en edge (2 h): 0.**

### Estado MOOK antes de la unidad

| Comprobación | Resultado |
|---|---|
| `mook_db.json` | ✅ **ausente** |
| Catálogo | ✅ **67 registros** |
| Ids locales `1787…` en catálogo | ✅ **0** |
| Títulos MOOK en catálogo | ✅ **0** |

### Backup canónico previo — ✅ ejecutado

| Componente | Snapshot | Run id | Timestamp | Exit |
|---|---|---|---|---|
| `structured` | **`962e38a5`** | `structured-20260826T000342Z-5933c93b` | 2026-08-26T00:03:47Z | **0** |
| `uploads` | **`6611b4d2`** | `uploads-20260826T000535Z-772679e5` | 2026-08-26T00:05:39Z | **0** |
| `uploads-manifest` | **`719a80eb`** | `uploads-20260826T000535Z-772679e5` | 2026-08-26T00:05:46Z | **0** |

Repositorio restic: **226 → 230 snapshots**. **No se borró ningún snapshot.**

> **Incidencia registrada y resuelta:** el primer intento de `uploads-backup` devolvió **exit 13
> (`LockBusy`)** porque se lanzó mientras `structured-backup` aún tenía el lock de restic. El
> servicio **abortó limpio** («otra ejecucion de backup ya tiene el lock; se aborta limpio») — es
> la defensa correcta, no un fallo de backup. Relanzado en serie tras terminar el structured →
> **exit 0**.

---

## C. MANIFEST DE FUENTES

Carpeta source-only (**no modificada, no renombrada, no indexada**):
`ESTÁS AQUÍ - Pensar, elegir y atender en la era del scroll`

| Clase | Esperado | Real |
|---|---|---|
| Total de archivos | 50 | ✅ **50** |
| MP3 | 16 | ✅ **16** |
| Transcripciones TXT (`A…`) | 16 | ✅ **16** |
| Bitácoras TXT (`B…`) | 8 | ✅ **8** |
| Textos TXT (`T00`–`T08`) | 9 | ✅ **9** |
| Texto completo del libro | 1 | ✅ **1** |
| **A04** | ausente | ✅ **ausente** |

### Hashes de control exigidos — 7/7 ✅

| Archivo | SHA-256 (prefijo) |
|---|---|
| `Me desconecto, luego existo.txt` | `6a9734e419305635…` |
| `A15. Una ética de la presencia.mp3` (corregido) | `3c75004673056890…` |
| `A15. Una ética de la presencia.txt` (corregido) | `7a5b2cb6c68dee4a…` |
| `T08. Mi manera de estar.txt` (corregido) | `ce01d25aac67b022…` |
| `B00. Bitácora de entrada…txt` (corregido) | `054ad2acd9fa25f8…` |
| `B03. Bitácora — Antes de enviar.txt` (corregido) | `6cee299fe3d995d5…` |
| `T00. Carta de entrada.txt` (corregido) | `71ce37b29d1ab29f…` |

### Clasificación contra producción — recomputada, sin drift

Comparación por hash de los **41 recursos** de v4 contra **3 163 archivos** productivos:

| Clase | Cantidad |
|---|---|
| **`CREATE-PROD`** | **41** — 16 `podcast` + 15 `articulo_pedagogico` (8 «Texto del mook ·» + 7 «Transición ·») + 10 `libro` (extractos) |
| **`REUSE-PROD`** | **1** — el libro `content-1774362922886`, que **no se crea**: se referencia como `parentId` |
| **`CONFLICT`** | **0** |
| **`SOURCE-ONLY`** | los 50 archivos de la carpeta editorial |
| **`NOT-REFERENCED`** | padre local `content-1787627190805-00` y recurso READING de T08 `content-1787621720131-24` |

Volumen a cargar: **57,6 MB**. **Manifest idéntico al de 04B — sin drift.**

---

## D. LIBRO PADRE Y PORTADA — verificado en producción

| Campo | Valor |
|---|---|
| `id` | **`content-1774362922886`** |
| `titulo` | `Me desconecto, luego existo ` |
| `tipo` / `status` | `libro` / `disponible` |
| `parentId` / `isCollection` | `None` / `False` |
| `editorial` | `Chibalete` |
| **`portada_url`** | `/uploads/content-1774362922886/me_desconecto__luego_existo_mesa_de_trabajo_1_01_…-1774362924043-457078397.jpg` (3 204 384 B) |
| `url_recurso` | `…/taco___me_desconecto__luego_existo-1774362924609-945861737.pdf` (993 560 B) |
| `texto_plano_url` | `…/me_desconecto-1774362924884-516843797.txt` |
| **`texto_plano` SHA-256** | **`6a9734e4193056358bef8324b63162885c8385af1fec37b3ba374083535c5ce7`** |
| Coincidencia con el máster local | ✅ **byte-idéntico** |
| Apto como `parentId` | ✅ |

**La portada a usar como `imageUrl` es la del propio libro**, ya presente en producción.
**`content-1765751139919` (La metamorfosis, Kafka) queda prohibido** y no se usará.

---

## E–J. FASES NO EJECUTADAS

**Ninguna escritura se produjo.** No se cargó ningún recurso, no se creó ningún extracto, no se creó
la Experience ni la Version, no se abrió preview, no se creó ningún run, evidencia ni evento.

Confirmación posterior al backup: `mook_db.json` **sigue ausente**, catálogo en **67 registros**,
**0** ids MOOK, containers healthy con **0 restarts** y **0 5xx**.

---

## K. CHECKPOINT DE REANUDACIÓN

**Checkpoint alcanzado: fin de Fase A.** Nada materializado en producción.

Al reanudar **no se empieza de cero**: se recomprueba por hash cuáles de los 41 recursos existen ya
(hoy: **0**) y se cargan únicamente los ausentes. El manifest, los hashes de control, la
clasificación y el backup previo de esta unidad **siguen siendo válidos** mientras la carpeta
editorial y el catálogo productivo no cambien.

Orden de reanudación: Fase C (41 recursos, secuencial) → Fase D (10 extractos con
`parentId: content-1774362922886`) → Fase E (Experience + v1 DRAFT) → Fase F/G (estructura y
validación previa al POST) → Fase H (preview) → Fase I (invisibilidad) → Fase J (salud + backup
posterior).

---

## N. EL BLOQUEADOR: AUTENTICACIÓN DE ESCRITURA

### Qué exige producción

`requireAdminAccess` (en `server/server.js`) admite exactamente **dos** vías para un método de
escritura:

1. **`x-admin-secret`** — «Máquina/operador: admin-secret file-only», la vía documentada para
   *scripts o llamadas server-to-server*.
2. **Sesión humana con rol `administrador`**, resuelta **server-side** desde la cookie firmada.

Producción corre **`SESSION_AUTH_MODE=compat`**, de modo que `sessionIssuanceEnabled()` es
verdadero y **la rama legacy de `x-user-id` no se aplica a escrituras administrativas**.

### Por qué me detengo

La Fase B me prohíbe, correctamente:

- usar `x-user-id`;
- crear credenciales temporales;
- extraer o imprimir cookies, contraseñas o secretos.

No dispongo de la contraseña del operador ni de una cookie de sesión suya, y **no debo pedírsela**:
la cookie es `HttpOnly` y entregarla sería exactamente la extracción que la unidad prohíbe.

Queda una tercera posibilidad que **no puedo decidir por mi cuenta**: usar el **admin-secret
file-only** ya existente en el VPS (`/var/www/chibalete/secrets`, montado read-only en
`/app/secrets`), sin imprimirlo nunca, como cabecera de las llamadas canónicas. Es la vía que el
propio código nombra «para scripts o llamadas server-to-server» y encaja con el «script mecánico
temporal» que la Fase B sí autoriza. Pero **no es una “sesión”**, y leer el fichero es, en sentido
literal, extraer un secreto. La ambigüedad es real y afecta a las primeras escrituras de contenido
editorial en producción, así que la decisión es del operador.

### Lo que se necesita

Una de estas dos autorizaciones explícitas:

| Opción | Qué implica |
|---|---|
| **A · Autorizar el admin-secret** (recomendada) | Se usa el secreto existente desde su fichero, **sin imprimirlo ni copiarlo**, como cabecera de las llamadas canónicas. No se crea ninguna credencial. Es el mecanismo diseñado para cargas mecánicas. |
| **B · Sesión del operador** | El operador ejecuta la carga con su propia sesión, o habilita una vía equivalente que no exija entregar la cookie. |

Con cualquiera de las dos, Fases C–J se ejecutan de corrido: el manifest, el orden, la estructura de
56 nodos y las validaciones previas al POST ya están preparados y verificados.

### Riesgos y siguiente unidad

| # | Estado |
|---|---|
| **R-1** · CVE heredado `CHP-SEC-IMAGE-CVE-01` | abierto, no alcanzable, cero hallazgos nuevos |
| **R-3** · `YELLOW-AUDIENCE-DECISION` | **abierto** — no afecta a 04D (la carga nace en DRAFT) pero **bloquea 04F** |
| **R-4** · portada / `parentId` | ✅ cerrado en 04C y reverificado aquí |

**No se creó cuenta QA, no se ejecutó 04E y no se publicó nada.** La decisión de audiencia sigue
pendiente.

---

## TRAZA

| Fecha | Operador | Acción |
|---|---|---|
| 2026-08-26 | Nicolás Jiménez | **Fase A de 04D completa**: salud productiva GREEN, manifest 50/50 con 7 hashes de control, clasificación 41 `CREATE-PROD` / 0 `CONFLICT` sin drift, libro padre y portada reverificados, backup canónico previo (`962e38a5`, `6611b4d2`, `719a80eb`; 226 → 230 snapshots). **Cero escrituras.** Detenida en Fase B por falta de vía de autenticación de escritura conforme a los límites → **`YELLOW-OPERATOR-LOGIN`**. |

---

# ANEXO R1 — INTENTO CON `admin-secret` (opción A autorizada)

**Veredicto R1:** 🟡 **`YELLOW-OPERATOR-LOGIN` — se mantiene, con causa raíz distinta y ya probada.**
**Cero escrituras.** Catálogo en 67, `mook_db.json` ausente, uploads en 64 dirs, 4 containers
healthy con 0 restarts y 0 5xx.

## R1.1 · Manejo del secreto — condiciones cumplidas

Se construyó un orquestador **temporal, fuera del repo**, en el VPS. El secreto se leyó
**exclusivamente desde `/var/www/chibalete/secrets/admin_secret`** con `fs.readFileSync` dentro del
proceso, en ámbito local de función.

| Condición | Cumplimiento |
|---|---|
| Solo desde fichero, solo en memoria | ✅ |
| Nunca impreso, copiado, devuelto ni persistido | ✅ — en los diagnósticos solo se emitieron **longitud y hash truncado**, jamás el valor |
| No como argumento, `$(cat …)`, variable de entorno, fichero temporal, log o stdout | ✅ |
| No sale del VPS | ✅ |
| Llamadas al endpoint local autorizado | ✅ `http://172.21.0.4:3000` (container `api_1`) |
| Cabeceras redactadas en diagnósticos | ✅ helper `redactHeaders` → `x-admin-secret: <REDACTED>` |

**El helper existente no era utilizable:** `scripts/validate-remote.mjs` toma el secreto de una
**variable de entorno**, expresamente prohibido por las condiciones. No existe en el repositorio un
helper que realice escrituras administrativas leyendo el secreto solo desde fichero.

El orquestador se eliminó al terminar (`/root/chp-04d`). Ningún script llegó a contener el valor:
lo leía en tiempo de ejecución.

## R1.2 · Verificación de que el secreto es correcto

Diagnóstico **sin exponer el valor**, comparando hashes:

| Origen | Longitud | SHA-256 (prefijo) |
|---|---|---|
| Fichero en el host, normalizado | 64 | `16cda091b9957e3c` |
| **Lector propio del servidor** (`readSecretFile` en el container) | 64 | **`16cda091b9957e3c`** |

**Coinciden.** Metadatos correctos: 64 bytes, modo `0400`, `uid=0`, proceso servidor `uid=0`.
`headerMatchesAdminSecret` probado en aislamiento dentro del container: **`true`** con el secreto
correcto, **`false`** con valor erróneo y sin cabecera.

## R1.3 · 🔴 EL HALLAZGO: el `admin-secret` NO autoriza la carga de contenido

Probado con **cuerpos deliberadamente inválidos**, de modo que un `400` demuestra autenticación
correcta y **nada puede crearse**:

| Ruta | Guard | Resultado | Lectura |
|---|---|---|---|
| `POST /api/experiences` | `requireAdminAccess` | **400 `INVALID_SLUG`** | ✅ **autenticación aceptada** |
| `POST /api/content` | `requireAdminRole` | **401 `Auth requerida`** | ❌ **rechazada** |
| `POST /api/upload` | `requireAdminRole` | **401 `Auth requerida`** | ❌ **rechazada** |

La causa está en el código, y es deliberada. `requireAdminAccess` ofrece la vía máquina:

```js
// Opción A: admin secret (scripts, PM2, server-to-server) — file-only
if (await headerMatchesAdminSecret(req)) return next();
```

`requireAdminRole` —el guard de `app.use('/api/upload', …)` y `app.use('/api/content', …)`— **no
tiene esa rama**: en `compat` exige sesión firmada y nada más.

```js
if (sessionIssuanceEnabled()) {
    const d = await sessionAuth.authenticate(req);
    if (!d.ok) return res.status(d.status).json({ error: 'Auth requerida' });
```

**Consecuencia:** la opción A autoriza únicamente la mitad de 04D —crear la Experience y la
Version— pero **no permite cargar ninguno de los 41 recursos**, que es el requisito previo. Las
Fases C y D son inejecutables por esta vía.

> **Nota lateral verificada:** el `admin-secret` tampoco basta para los **GET** administrativos
> (`/api/system/metrics`, `/api/admin/membership/validate` → 401). Los GET pasan por
> `allowAuthenticatedGetOrReject`, más estricto en este build. No es un bloqueador de 04D, pero
> conviene saberlo: **la verificación de estado no puede hacerse por esa vía**, sino leyendo los
> stores o desde la sesión del operador.

**No se emite `STOP-SECRET-HANDLING`**: el manejo del secreto cumplió todas las condiciones. El
problema no es *cómo* usarlo, sino que **es insuficiente por diseño** para las rutas de carga.

## R1.4 · Lo que se necesita ahora

La carga de los 41 recursos exige una **sesión administrativa humana**. Caminos posibles, **todos
requieren decisión del operador**:

| Opción | Qué implica | Valoración |
|---|---|---|
| **B1 · El operador ejecuta la carga** | Se le entrega el orquestador y lo corre desde un contexto ya autenticado con su sesión | ✅ **Respeta todos los límites.** Es la vía natural |
| **B2 · Carga manual por Studio** | 41 ficheros con metadata completa, a mano | ⚠️ Impracticable y propenso a error |
| **B3 · Ampliar `requireAdminRole` para aceptar admin-secret** | Cambio de código en el guard de `upload`/`content` | ❌ **Fuera de alcance**: 04D prohíbe tocar código, y ampliaría la superficie de autenticación de dos rutas sensibles. Exigiría unidad propia con revisión de seguridad |

**Recomendación:** **B1**. El resto de 04D ya está preparado y verificado: manifest, hashes,
clasificación, libro padre, portada, estructura de 56 nodos y validaciones previas al POST.

## R1.5 · Estado tras el anexo

| Comprobación | Resultado |
|---|---|
| Escrituras realizadas | **0** |
| `mook_db.json` | ✅ ausente |
| Catálogo | ✅ **67 entradas** |
| Uploads | ✅ **64 dirs** |
| Containers | ✅ 4 healthy, **0 restarts** |
| 5xx (10 min) | ✅ **0** |
| Orquestador temporal | ✅ eliminado |
| Publicación / cuenta QA / 04E / 04F | ✅ **no ejecutados** |

**El checkpoint de reanudación sigue siendo el fin de Fase A**, intacto y válido.

---
---

# ANEXO DE CIERRE — 04D COMPLETADA

**Veredicto:** 🟢 **`GREEN-MOOK-V1-DRAFT-READY-FOR-FINAL-QA`**
**Fecha de cierre:** 2026-08-27 · **Código productivo:** `910c735` en ambas APIs

> Autoriza únicamente la unidad final de QA y una eventual publicación. **No publica por sí mismo.**

Todo lo anterior a esta línea es el registro histórico del punto en que la unidad se detuvo
(`YELLOW-OPERATOR-LOGIN`, con el catálogo en 67 registros y sin `mook_db.json`). Lo que sigue
documenta el recorrido hasta el cierre.

## 1. El arco completo

| Hito | Resultado |
|---|---|
| Carga original (R2/R3) | 39 recursos creados… **20 sobrevivieron** |
| `CHP-CONTENT-STORE-RMW-01` | causa: `content.json` era el único store que releía la caché en proceso *dentro* del lock; cada réplica reescribía el array entero desde una instantánea de hasta 30 s. **19 recursos destruidos** |
| Corrección RMW | `acc2227`, desplegada; 6 flujos invalidan la caché antes de leer |
| Gate de CI | `content-rmw`, **bloqueante y *required* en `main`** |
| Recuperación (R9/R10, bridge R4) | catálogo **89 → 108**, **41/41** recursos, 19 creados / 22 adoptados |
| `CHP-TTS-PROGRESS-CALLBACK-RACE-01` | 14 recursos textuales atascados en `generando` con el audio ya al 100 % |
| Corrección de la carrera | `910c735`, desplegada; escritor serializado por job |
| Reconciliación (R11-R1) | **14/14** en `listo/completed`, solo metadata |

## 2. Estado productivo al cierre

| | |
|---|---|
| Catálogo | **108** · 0 duplicados |
| Recursos MOOK | **41/41** · `standalone:false` 41/41 · hashes servidos 41/41 |
| `ttsStatus` | 16 `no_iniciado` (podcasts) + **25 `listo`** (todos los textuales) · **0 en `generando`** |
| Manifests de audio | **25/25 completos** |
| Extractos | **10/10** con `paginas_impresas` exactas (U+2013) y `parentId: content-1774362922886` |
| Experience | `exp-1787709803882-9ym4tt` · **`draft`** · `currentVersionId: null` |
| Versión | `expv-1787787648329-ooo21e` · **v1 `draft`** · sin `publishedAt` |
| Estructura | 7 módulos / 56 nodos · AUDIO 16 / READING 25 / ACTIVITY 15 · **15/15 privadas** · 0 VIDEO/LEO/PRODUCTION |
| Publicaciones / runs / evidencias | **0 / 0 / 0** |
| Invisible para participantes | sí, por **doble condición estructural**: `listPublished` exige `status === 'published' && currentVersionId`, y `startRun` exige `published` |

## 3. La reconciliación de los 14

La vía canónica de regeneración **no servía**: el guard del retry devuelve `409 already_running`
justo cuando `ttsStatus` es `generando`, así que **el estado atascado bloqueaba su propia
reparación**. Verificado en producción: 13 × 409 y 1 × 502 transitorio (keep-alive nginx↔Node,
`RestartCount=0`), **cero escrituras, cero jobs, cero chunks**.

Se reconcilió por el upsert canónico `POST /api/content`, reponiendo **exactamente** el estado
terminal que el callback habría persistido —`ttsStatus: 'listo'` y
`processingStatus: {100, 0, 0, 'completed', <ISO>}`, shape tomado del código, no inventado—.
Seguro porque el handler solo regenera si `texto_plano_url` cambia o si falta el manifest: se
reenvió la misma URL y los 25 manifests están completos.

**Verificación independiente:** 14 POST → 14 × 200 → 14 `CONTENT_SAVE_SUCCESS` · **0 `Triggering TTS`**
· 0 retries, uploads, versiones o publicaciones · los 41 conservan **todo lo demás byte-idéntico**
(comparación clave por clave contra el snapshot previo) · los 27 no atascados **no se tocaron en
absoluto** · el zombi ajeno `content-1779292030328` quedó fuera de alcance e intacto.

**Cero consumo de proveedor:** 0 chunks MP3 nuevos desde las 03:00 del 26-ago; los 93 del rango
02:00–03:00 son de la carga original. La caché de audio acierta por índice.

**Durabilidad:** la auditoría de arranque solo marca `pendiente` si el manifest falta, está vacío o
no parsea, y solo fuerza `error_proveedor` si `status` es `procesando`/`error`. Con manifest completo
y `status: 'disponible'`, **un reinicio no deshace la reconciliación**.

## 4. Deploy

Imagen construida desde `git archive 910c735` (SHA-256 `45d09ee6…5108cb30`, idéntico en local y VPS;
949 entradas; 0 carpetas editoriales, `node_modules` ni `.env`). Rolling `api_1` → verificación →
`api_2`. Ambas en `910c735`, healthy, `RestartCount=0`. **Frontend y edge sin tocar.** Stores
byte-idénticos antes y después del rolling. Imagen `acc2227` conservada para rollback; override
respaldado en `/root/chp-r11-override.bak.yml`.

## 5. Backups y restore

| Momento | structured | uploads | verify |
|---|---|---|---|
| Previo al deploy | `339e66e3` | `433b46cd` | ok |
| Programado tras la carga | `701a0bd8` (108 registros) | — | — |
| **Posterior al cierre** | **`0fd2ff39`** (26 stores, `mook_db.json` 109 826 B) | **`0135c0e7`** | **ok** — 246 snapshots, 210 manifiestos, 0 problemas, dentro de RPO |

**Restore rehearsal:** `restic dump` de `mook_db.json` desde `0fd2ff39` a un `mktemp -d`.
**Byte-idéntico** (`48dfc05e…058b03`). Contenido validado: 1 experience / 1 versión / 0 runs /
0 evidencias, `draft`, `currentVersionId: null`, v1 `draft` sin `publishedAt`, 7/56, 16/25/15,
15/15 privadas. Temporal eliminado. **Nunca se restauró sobre producción**; sin `forget` ni `prune`.

## 6. Deuda abierta

**`CHP-TTS-RETRY-STUCK-STATE-DEADLOCK-01`** — *no bloqueante.* El guard
`ttsStatus === 'generando' ⇒ 409` impide reparar por la vía canónica un registro atascado en ese
estado. **No afecta a las cargas normales desde `Subir → Studio`**: con `910c735` el estado terminal
se persiste siempre, así que ningún registro nuevo puede quedar atascado. Solo afectaba a los que ya
lo estaban antes del fix, y esos ya están reconciliados. No se trabaja en esta unidad.

## 7. Alcance y qué NO autoriza este cierre

La reparación fue **excepcional, para el primer MOOK**. No se construyó infraestructura reusable de
importación: los bridges y microbridges fueron temporales y **no están versionados**. Los siguientes
MOOK se cargan desde **`Subir → Studio de Experiencias`**.

Este GREEN **no autoriza** publicar, crear una v2, iniciar runs o evidencias, ni ejecutar 04E/04F.
Lo único que habilita es la unidad final de QA.

---

**Continuación:** la unidad final de QA se ejecutó y cerró en
`CHP_MOOK_ESTAS_AQUI_04E_DRAFT_FINAL_QA.md` — 🟢 `GREEN-MOOK-V1-DRAFT-QA-PASSED`.
El borrador v1 queda **apto para publicación**; **04F sigue bloqueada por B-1**.
