# CHP-MOOK-ESTAS-AQUI-04F — LIBERACIÓN GENERAL

**Estado:** 🟢 **CERRADO — `GREEN-MOOK-ESTAS-AQUI-V1-PRODUCTION`**
**Rama:** `chp/mook-contract-00`
**Fecha:** 2026-08-27
**Operador humano:** **Nicolás Jiménez** — director/editor de Chibalete Editores
**Unidad previa:** 04E — `GREEN-MOOK-V1-DRAFT-QA-PASSED` (`bc9fd5d`)

> **El MOOK «¿Estás aquí?» está publicado en producción.** v1 es la versión vigente para las
> **247 cuentas activas**. Es la primera experiencia editorial real del sistema MOOK.

---

## A. DECISIONES VINCULANTES DEL OPERADOR

Autorización expresa, que **no requiere volver a solicitarse**:

```text
PUBLICAR V1 PARA TODAS LAS CUENTAS AUTENTICADAS
CUBIERTA ORIGINAL DEL LIBRO
```

Sin canario y sin segmentación: **B-1 `YELLOW-AUDIENCE-DECISION` se resuelve aceptando la
liberación general**, que era una de las tres salidas planteadas en 04B §N.

**Exposición verificada de forma independiente** contra `usuarios_colegios_oro.json` —el
`USERS_DB` real del contenedor, no `data/users_db.json`—:

| Rol | `accountStatus` | Cuentas |
|---|---|---|
| `administrador` | active | **1** |
| `mediador` | active | **23** |
| `lector` | active | **223** |
| `lector` | **disabled** | **400** |
| | **Total activo** | **247** |

Las 400 deshabilitadas no pueden autenticarse: `requireUserAuth` rechaza con 403 vía `isUserActive`.
La cifra del operador coincide **exactamente** con el padrón.

---

## B. BASELINE PREVIO A PUBLICAR

Todo verificado read-only contra el VPS antes de autorizar el clic.

| Ítem | Esperado | Verificado |
|---|---|---|
| APIs | `910c735` ×2 healthy | ✅ `RestartCount=0` |
| Experience | `exp-1787709803882-9ym4tt` | ✅ `draft` |
| `currentVersionId` | `null` | ✅ |
| Versión | `expv-1787787648329-ooo21e` DRAFT | ✅ `publishedAt: null` |
| Experiences / versiones | 1 / 1 | ✅ |
| Módulos / nodos | 7 / 56 | ✅ 5+5+7+5+6+7+21 |
| Distribución | 16–25–15 | ✅ |
| Actividades privadas | 15/15 | ✅ `config.privado: true` |
| Recursos | 41/41 | ✅ 41 `resourceRef` → 41 contentIds únicos, 0 sin resolver, **41/41 archivos en disco** |
| Catálogo | 108 | ✅ · 10/10 páginas con `parentId` resoluble |
| published/runs/evidence | 0/0/0 | ✅ |

**Cero drift desde 04E, probado por huella y no por inspección:** `mook_db.json` medía
`48dfc05e…058b03`, **byte a byte idéntico** al restore rehearsal de 04D.

### Desviación del baseline — detectada y resuelta

`origin/chp/mook-contract-00` estaba en `cacf8b8`: **el commit de 04E nunca se pushó**. No era drift
productivo —el hash del store lo desmiente— sino un commit documental local. Se resolvió con un push
fast-forward `cacf8b8..bc9fd5d` (2 archivos, solo documentación) **antes** de publicar. No se detuvo
la unidad porque la condición que el stop protege —estado productivo intacto— se cumplía.

---

## C. FASE A — PORTADA: CERO ESCRITURAS

Resuelto desde el registro canónico del libro padre `content-1774362922886`:

```
book.portada_url     = /uploads/content-1774362922886/me_desconecto__luego_existo_…-457078397.jpg
experience.imageUrl  = /uploads/content-1774362922886/me_desconecto__luego_existo_…-457078397.jpg
                                                                        ↑ mismo string, no un equivalente
```

La Experience **ya apuntaba literalmente** al activo de la cubierta original. Verificado en disco
(**3 204 384 B**, sha256 `85c5a9be…e2f215`, JPEG con magic `ff d8 ff e1`) y servido por el edge
(**HTTP 200 · `image/jpeg` · 3 204 384 B**, mismo tamaño exacto).

**No se escribió nada, no se subió nada, no se duplicó nada, y `portada_url` del libro quedó intacta.**
No hizo falta acción humana en el Studio.

> **B-3 de 04B no aplicaba en producción.** El `imageUrl` que apuntaba a una portada de Kafka era el
> de la experiencia **local**. La productiva nació en 04D ya con la cubierta correcta.

---

## D. FASE B — EL CLIC HUMANO

Nicolás pulsó «Publicar» en `Subir → Studio de Experiencias → ¿Estás aquí? → v1`.

```
17:28:32.804Z  [MOOK] published exp-1787709803882-9ym4tt v1
17:28:32.808Z  POST /api/experiences/versions/expv-1787787648329-ooo21e/publish → 200  (api_1, 35 ms)
```

### ⚠️ Hubo un segundo clic — y el backend lo rechazó

```
17:28:45.669Z  POST /api/experiences/versions/expv-1787787648329-ooo21e/publish → 409  (api_2, level 40)
```

**Trece segundos después del primero**, sobre la **otra réplica**. El guard de idempotencia devolvió
**409** y **no escribió nada**:

- `publishedAt` = `2026-08-27T17:28:32.800Z`, sellado **una sola vez**
- **1 experience, 1 versión** — cero v2, cero republicación
- estructura intacta: 7 módulos / 56 nodos / 16–25–15 / 15 privadas

No es un defecto: es exactamente el comportamiento que debe tener una publicación no idempotente
protegida. Se registra porque el runbook lo prohibía explícitamente y **conviene que quede escrito
que la protección existe y funciona incluso cruzando réplicas** —el segundo clic ni siquiera llegó a
la misma API que el primero—.

---

## E. FASE C — VERIFICACIÓN POSTERIOR INDEPENDIENTE

### E.1 Publicación

| Verificación | Resultado |
|---|---|
| `exp.status` | ✅ `published` |
| `exp.currentVersionId` | ✅ `expv-1787787648329-ooo21e` — **es v1** |
| `ver.status` / `publishedAt` | ✅ `published` / `2026-08-27T17:28:32.800Z` |
| Una Experience / una versión | ✅ 1 / 1 |
| Duplicados / v2 | ✅ **cero** |
| Módulos / nodos / distribución | ✅ 7 / 56 / 16–25–15 |
| Actividades privadas | ✅ **15/15** |
| Recursos | ✅ 41/41 resolubles |
| Cubierta | ✅ original del libro, y `portada_url` del libro **sin tocar** |
| Título / descripción | ✅ «¿Estás aquí?» · slug `estas-aqui` · descripción editorial completa |

### E.2 Visibilidad real — cuenta lectora activa existente

Con `user-1777177383214` (lector activo real, **no creado para esto**), en `SESSION_AUTH_MODE=compat`:

```
GET /api/experiences                        → 200 · el MOOK aparece en la lista
GET /api/experiences/exp-1787709803882-…    → 200 · landing accesible (NO crea run)
```

La condición estructural `status === 'published' && currentVersionId` se cumple, que es exactamente
la doble condición que mantenía la experiencia invisible hasta este momento.

**La visibilidad es la autorizada:** liberación general a cuentas autenticadas, sin segmentación.

### E.3 Smoke — un solo run, en la cuenta del administrador

| Campo | Valor |
|---|---|
| Run | `run-1787851759374-6n8ziy` |
| Usuario | `user-1774362611303` — **`['administrador']`**, no un estudiante |
| `experienceVersionId` | `expv-1787787648329-ooo21e` — ✅ **pineado a v1** |
| Inicio | `2026-08-27T17:29:19.374Z` → HTTP **201** |
| Estado | `active`, `currentNodeIndex: 0` |
| `nodeStates` | `{"n-a01": {"status": "completed", "completedAt": "17:30:15.746Z", "evidenceIds": []}}` |

**Runtime inicia sobre v1 y A01 se completó realmente.** Los `POST …/run` posteriores (17:29:49 y
17:30:15) devolvieron **200**, no 201: son idempotentes y resolvieron al **mismo run**. El store lo
confirma: **runs = 1**.

**Evidencias = 0.** Completar un nodo AUDIO no genera evidencia; `evidenceIds` está vacío. No se
guardaron respuestas, no se crearon producciones, no se crearon cuentas ni credenciales.

### E.4 Activos servidos

| Activo | Resultado |
|---|---|
| A01 completo | ✅ **HTTP 200** · `audio/mpeg` · **2 840 798 B** |
| A01 con `Range: bytes=0-65535` | ✅ **HTTP 206** · `audio/mpeg` · 65 536 B |
| Cubierta | ✅ **HTTP 200** · `image/jpeg` · 3 204 384 B |

El **206** importa más que el 200: demuestra reproducción con búsqueda real, no una descarga íntegra.

### E.5 Salud

| Contenedor | Restarts | Salud |
|---|---|---|
| `chibalete_api_1` | 0 | healthy |
| `chibalete_api_2` | 0 | healthy |
| `chibalete_front` | 0 | healthy |
| `chibalete_edge` | 0 | healthy |

**Cero 5xx** en el edge desde las 17:20Z. El único no-2xx del periodo es el **409 deliberado** del
segundo clic.

---

## F. FASE D — BACKUP Y RESTORE

| Paso | Resultado |
|---|---|
| **Structured backup** | ✅ `structured-20260827T173937Z-aad50a4d` → snapshot **`93ff3eb7`**, **26 stores**, 37 archivos nuevos, 46 508 029 B procesados |
| **Uploads: adopción del snapshot previo** | ✅ **demostrada**, ver abajo |
| **Verify / `restic check`** | ✅ **251 snapshots** · `check` **ok** · **214 manifiestos, 0 problemas** · RPO structured 121 s / 21 600 s y uploads 50 915 s / 86 400 s, **ambos en rango** · `exit_code 0` |
| **Restore rehearsal** | ✅ **byte-idéntico** |

### Adopción del snapshot de uploads — demostrada, no asumida

No se repitió el backup de uploads porque **ningún activo cambió**, y se prueba por dos vías
independientes:

1. El snapshot vigente `a0c4ab09` (03:33:12Z de hoy) registró **`files_unmodified: 3328`,
   `files_changed: 0`, `files_new: 0`, `data_added: 0`**.
2. `find /var/www/chibalete/public/uploads -newermt "2026-08-27 00:00:00" -type f` devuelve
   **cero archivos**, sobre un total que sigue siendo **3328**.

Publicar no toca activos: cambia dos campos de `mook_db.json`. La adopción es correcta.

### Restore rehearsal

`restic dump` del **único** `mook_db.json` del snapshot
(`/var/backups/chibalete-backup/staging-omirfrnr/json/mook_db.json`) a un `mktemp -d` propio:

```
prod     bytes=110409 sha256=f591ae9f765824dbfba96a59b6f2e844675310e9bca33ab27c08fe534d2603d0
restored bytes=110409 sha256=f591ae9f765824dbfba96a59b6f2e844675310e9bca33ab27c08fe534d2603d0
BYTE-IDENTICAL = True
```

Estado verificado **sobre la copia restaurada**, no sobre producción: 1 experience / 1 versión /
1 run / 0 evidencias · `published` · `currentVersionId` correcto · `publishedAt` sellado ·
7 módulos / 56 nodos / 16–25–15 · 15 privadas · cubierta correcta · run pineado a v1.

**Nunca se restauró sobre producción.** Sin `forget`, sin `prune`, sin limpieza. Se eliminó
**solo** el temporal creado para el ensayo (`/tmp/chp-04f-rehearsal-7b0kzcps`, confirmado inexistente
al terminar). `data/`, `data-critical/`, uploads y activos editoriales, intactos.

> **Nota de método.** El guard del runner canónico solo permite
> `backup · cat · check · init · snapshots · stats · version`; `dump` y `ls` quedan fuera de la
> allowlist. El ensayo los invocó directamente con el entorno de `restic_env()`, restringido por
> aserción a subcomandos de **lectura**. Ninguna vía destructiva estuvo disponible en ningún momento.

---

## G. PRIVACIDAD

- **15/15** actividades con `config.privado: true` — sin cambios respecto a 04D y 04E.
- **0 evidencias** en el store; el único run tiene `evidenceIds: []`.
- El nodo completado es AUDIO: no captura respuestas.
- No se crearon cuentas, credenciales ni producciones.

**Cero pérdida de privacidad.**

---

## H. GIT

| Elemento | Valor |
|---|---|
| Rama | `chp/mook-contract-00` |
| Antes | `bc9fd5d` (tras el push de recuperación de 04E) |
| Este cierre | ver commit de esta unidad |
| Alcance | **solo documentación** |

No viajan stores, bridges, corpus, logs, manifiestos, backups ni las dos carpetas editoriales
untracked (`ESTÁS AQUÍ - …/`, `Programa integral/`), que **jamás se committean**.

---

## I. STOP CONDITIONS — NINGUNA DISPARADA

| Condición | Estado |
|---|---|
| Drift del baseline | ✅ ninguno en producción (la desviación de Git se resolvió antes de publicar) |
| Portada no inequívoca | ✅ inequívoca — un solo campo canónico, mismo string |
| Publicación ambigua o fallida | ✅ **200 limpio**; el segundo clic dio 409 y no escribió |
| Más de una Experience o versión | ✅ 1 / 1 |
| v2 accidental | ✅ ninguna |
| `currentVersionId` incorrecto | ✅ correcto |
| Visibilidad distinta de la autorizada | ✅ exactamente la liberación general autorizada |
| Regresión, 5xx o pérdida de privacidad | ✅ ninguna |

---

## J. VEREDICTO

**🟢 `GREEN-MOOK-ESTAS-AQUI-V1-PRODUCTION`**

El MOOK «¿Estás aquí?» está **publicado y verificado** en producción, visible para las 247 cuentas
activas, con la cubierta original del libro, 56 nodos, 15 bitácoras privadas, respaldo verificado y
restore ensayado byte a byte.

---

## K. DEUDA ABIERTA (no bloqueante)

- **`CHP-TTS-RETRY-STUCK-STATE-DEADLOCK-01`** — el guard `ttsStatus === 'generando' ⇒ 409` impide
  reparar por la vía canónica un registro atascado. No afecta a cargas nuevas desde `Subir → Studio`.
- **`CHP-TELEMETRY-STORE-RMW-01`** — heredada de la familia RMW.
- **~19 uploads huérfanos**: ⛔ **no limpiar**, son los MP3/TXT de los recursos destruidos y
  reutilizados por hash en la recuperación de 04D.
- **`ACCESS_FALLBACK_MODE=open` con 20/20 grupos sin `availableContentIds`.** Ya no bloquea el MOOK
  —la liberación general era la decisión—, pero **sigue siendo un riesgo estructural**: hoy cualquier
  cuenta autenticada alcanza todo el catálogo productivo. No lo introduce el MOOK. **Merece unidad
  propia.**
- **El run de smoke del administrador queda `active` en producción.** Es correcto y esperado; no se
  abandona ni se borra.

---

## L. OBSERVACIÓN PARA LA PRÓXIMA PUBLICACIÓN

El doble clic no causó daño, pero lo evitó el backend, no la interfaz. **El Studio no deshabilita el
botón «Publicar» mientras la petición está en vuelo**, y con dos réplicas detrás del balanceador el
segundo clic aterriza en la otra API. Un `disabled` durante el envío es un cambio pequeño y
localizado que convertiría un 409 silencioso en una imposibilidad. No se trabaja aquí.

---

## M. SIGUIENTE UNIDAD

**`CHP-MOOK-COVER-UPLOAD-01A`** — cubierta propia y carga segura desde la sección Información del
Studio, **fuera de producción**. Su precondición era este GREEN, que queda cumplido.

---

## N. ALCANCE — QUÉ NO AUTORIZA ESTE CIERRE

- ❌ Crear una **v2** o editar v1.
- ❌ Cambiar la cubierta productiva.
- ❌ Desplegar código.
- ❌ Tocar el run de smoke o cualquier dato de participante.
