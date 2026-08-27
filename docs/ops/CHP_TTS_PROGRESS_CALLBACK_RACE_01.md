# CHP-TTS-PROGRESS-CALLBACK-RACE-01 — un progreso tardío pisaba el estado terminal

Veredicto: **GREEN-TTS-PROGRESS-RACE-FIX-DEPLOYED**  ·  *(era `…-LOCAL` hasta el despliegue)*

**Desplegado el 2026-08-27** en ambas APIs (`910c735`) y los 14 registros atascados quedaron
reconciliados. Ver §10. **Nada de esto autoriza publicar el MOOK.**

| | |
|---|---|
| Rama | `chp/mook-contract-00` |
| Producción | `910c735` en `api_1` y `api_2` (era `acc2227` antes del despliegue) |
| Gate | integrado en `npm run test:content-rmw` → check bloqueante `content-rmw` |

---

## 1. Cómo apareció

Durante `CHP-MOOK-ESTAS-AQUI-04D-R10` la recuperación del mook «¿Estás aquí?»
cerró correctamente —41/41 recursos, 10/10 páginas, v1 DRAFT, cero publicación—
pero la verificación independiente encontró **14 recursos con
`ttsStatus:"generando"`** y `processingStatus.status:"processing"`, con el audio
**ya generado al 100 %**.

Son exactamente los 14 recursos **textuales nuevos** (8 `articulo_pedagogico` +
6 `libro`). Los 5 podcasts nuevos quedaron bien en `no_iniciado`, y **ninguno de
los 22 supervivientes sufrió regresión**.

## 2. Causa raíz

Cadena completa: `generateAudioForContent` → `onProgress` → `withFileLock` →
`content.json`.

1. `POST /api/content` **fuerza** `ttsStatus:'generando'` y encola TTS para todo
   contenido nuevo con `texto_plano_url`, ignorando lo que traiga el body. No hay
   otra ruta canónica de alta, así que el cliente no puede evitarlo.
2. `ttsService` invoca `onProgress` **de forma síncrona**, una vez por chunk.
   **Nunca emite `completed`**: solo `processing` y `error_proveedor`. El estado
   terminal lo pone siempre el llamador, en su `.then()`.
3. Cada llamada lanzaba una **tarea desligada** —`(async () => { … })()`— que
   competía por `withFileLock(DB_FILE)`.
4. Ese lock (`server/usersLock.js`) es **polling con reintentos cada 40 ms y sin
   cola FIFO**. El contendiente recién llegado prueba `openSync` de inmediato; los
   que ya esperaban duermen hasta su siguiente tick. Así, el `completed` final
   suele **ganar el lock libre** y un `processing` rezagado lo **pisa después**.
5. Los fallos de escritura desaparecían en `catch (e) { /* ignore */ }`.

**Por qué se volvió determinista:** los chunks de audio ya estaban en caché desde
la carga original (los MP3 son del 26-ago 02:05). La caché acierta **por índice**
—`manifest[i].file` existente y no vacío—, así que los 14 jobs recorrieron todos
sus chunks en milisegundos y todos los callbacks colapsaron en la misma ventana.
Con ≥2 `processing` pendientes cuando llega `completed`, perder la carrera es lo
normal, no lo excepcional: **14 de 14**. En la carga original cada frase tardaba
segundos de síntesis real y los callbacks iban bien separados.

**Alcance:** el defecto es **intra-proceso**, dentro de una sola réplica. Las dos
tareas que compiten viven en el mismo Node.

**Relación con `CHP-CONTENT-STORE-RMW-01`:** distinta familia. Allí se **perdían**
escrituras por releer una caché vieja *dentro* del lock, entre réplicas. Aquí
**ambas escrituras aterrizan**; el problema es el **orden**. El arreglo RMW
(invalidar antes de leer) hace correcta cada escritura individual, pero no las
ordena. Por eso hacía falta esto además de aquello.

**Consumidores del contrato `onProgress`:** dos, ambos en `server/server.js` —
`POST /api/content` y `POST /api/content/:id/retry`.

## 3. Segundo defecto, destapado por el test

La ruta de **retry nunca alcanzaba `listo`**. Su `.then()` solo registraba en el
log; como `ttsService` no emite `completed`, una regeneración correcta se quedaba
en `generando` **para siempre**. Preexistente e independiente de la carrera, pero
crítico: el retry es justo la vía por la que se remedian los registros atascados,
así que dejarlo roto habría hecho hueco el arreglo. Se cierra con el mismo patrón
que el alta, y **solo cuando el job corrió de verdad** (`!r.duplicateSkipped`).

## 4. La corrección

`server/ttsProgressWriter.js` (nuevo, 70 líneas) — una **cadena de promesas por
job**:

```js
const escribir = (status) => {
    cadena = cadena.then(async () => {
        const esTerminal = ESTADOS_TERMINALES.has(status && status.status);
        if (terminal && !esTerminal) return;   // un progreso tardío no revierte
        if (esTerminal) terminal = true;
        await persist(status);
    }).catch((err) => { onError(err, status); });   // observable, nunca tragado
    return cadena;
};
```

Los dos consumidores pasan a construir su escritor y **esperan** el estado
terminal (`await onProgress(finalStatus)`).

Lo que **no** se hizo: sin cola global, sin dependencias nuevas, sin store nuevo,
sin tocar proveedor ni formato de audio, sin refactor del TTS, sin locks globales
y sin regenerar contenido existente. `persist` sigue haciendo su propio
read-modify-write dentro de `withFileLock` con invalidación previa: **la
protección cross-réplica queda intacta** — aquí solo se ordena, no se cambia cómo
se escribe.

### Invariantes garantizadas

| Invariante | Cómo |
|---|---|
| `completed`/`listo` no retrocede | serialización + guard terminal por job |
| `error` no se sobrescribe con progreso viejo | mismo guard |
| Una regeneración explícita sí reabre `generando` | job nuevo ⇒ escritor nuevo ⇒ `terminal=false` |
| El progreso normal se sigue viendo | los `processing` se aplican en orden |
| RMW cross-réplica protegido | `persist` no cambió |
| Fallos terminales observables | `onError` con `contentId` + `status` + mensaje, sin datos sensibles |

## 5. Pruebas

`server/__test__/ttsProgressRace.test.mjs` — **26 aserciones**, cuatro bloques:

- **[0] Ratchet estructural** sobre `server.js`: cero escritores desligados
  (firma `(async () => { try { await withFileLock(DB_FILE`), cero `catch` vacíos,
  `await onProgress(` presente, dos usos del escritor. Determinista.
- **[1] Contrato del escritor**, determinista y sin red: orden de escritura,
  `processing` tardío tras `completed` descartado, `processing` tras error
  descartado, regeneración legítima permitida, fallo de persistencia notificado,
  cadena que sobrevive a un fallo intermedio.
- **[2] Reproducción del incidente**: servidor real, 14 recursos textuales con la
  **caché de audio sembrada** (por índice, como en producción) y claves de
  proveedor vacías. Exige 14/14 en `listo` y `processingStatus.status:'completed'`.
- **[3] No regresión**: 20 altas desde **dos procesos** sobre el store compartido
  sin perder ninguna, 0 duplicados, los 14 anteriores intactos, retry legítimo que
  vuelve a estado terminal, 0 locks y 0 temporales huérfanos, stores ajenos
  intactos.

Aislamiento: todo en `mkdtemp`, cero red, cero proveedor real, cero stores
productivos, cero `sleep` frágiles (se espera a que el estado deje de moverse).

### Control negativo

Contra el árbol **pre-fix**, la suite cierra en rojo reproduciendo el incidente:

```text
✗ 14/14 terminan en ttsStatus="listo"   listo=0 generando=14
✗ ninguno queda en "generando"          14 en generando
✗ processingStatus terminal es "completed"  ["processing", …]
ttsProgressRace — PASS 11 / FAIL 7
```

Repetido después en una copia desechable desactivando **solo** la serialización
(el resto del fix intacto): `listo=0 generando=14`, `PASS 20 / FAIL 5`. La copia
se eliminó; el árbol versionado nunca cambió.

## 6. Validaciones

| | |
|---|---|
| `npm run test:content-rmw` | **29 + 27 + 26 = 82**, 0 fallos |
| `npm run test:mook` | GREEN |
| `npm run lint:evidence` | 811 archivos, 0 violaciones |
| `realStoreGuard` | 16/16 |
| `npm run typecheck:baseline` | sin regresiones |
| `npm run build` | ok |
| `npm run test:session-browser` | SKIP (POSIX-only) — corre en CI |

La regresión se integró en el gate bloqueante existente (`test:content-rmw` →
check `content-rmw`, ya *required* en `main`). **No se creó un workflow nuevo.**

## 7. Rollback

Producción corre `910c735`. La imagen anterior `chibalete/api:acc2227`
(`0e1d9087e94e`) —que **contiene el defecto**— se conserva, y el override quedó
respaldado en `/root/chp-r11-override.bak.yml`.

- Revertir el despliegue: devolver `image:` a `chibalete/api:acc2227` en las dos
  entradas del override y recrear en rolling. Los 14 registros ya reconciliados
  **no revierten**: son datos, no código, y su estado terminal es el correcto.
- Revertir el fix en el repo: `git revert` del commit de código.
  `server/ttsProgressWriter.js` queda huérfano y puede borrarse.
- Revertir solo el gate: quitar `ttsProgressRace.test.mjs` del script
  `test:content-rmw` en `package.json`.

## 8. Estado del MOOK al cierre

| | |
|---|---|
| Catálogo | 108 · 0 duplicados |
| Recursos | 41/41 · hashes servidos 41/41 |
| `ttsStatus` | 16 `no_iniciado` + **25 `listo`** · **0 en `generando`** |
| Experience | `exp-1787709803882-9ym4tt`, `draft` |
| Versión | `expv-1787787648329-ooo21e`, v1 `draft` |
| `currentVersionId` | `null` |
| Published / runs / evidence | 0 / 0 / 0 |
| Registros atascados | **0 — los 14 reconciliados** |

Backups: previo `339e66e3` + `433b46cd`; programado tras la carga `701a0bd8`
(108 registros); **posterior al cierre `0fd2ff39` + `0135c0e7` + verify ok**, con
restore rehearsal de `mook_db.json` **byte-idéntico** en temporal.

## 9. Ficheros

| fichero | cambio |
|---|---|
| `server/ttsProgressWriter.js` | nuevo — escritor serializado por job |
| `server/server.js` | los dos consumidores usan el escritor y esperan el estado terminal; el retry emite `completed` |
| `server/__test__/ttsProgressRace.test.mjs` | nuevo — 26 aserciones |
| `package.json` | `test:content-rmw` encadena la regresión |
| `docs/ops/CHP_TTS_PROGRESS_CALLBACK_RACE_01.md` | este documento |

---

## 10. Cierre: desplegado y reconciliado (2026-08-27)

**Deploy.** Imagen `chibalete/api:910c735` construida desde `git archive` (SHA-256
`45d09ee6…5108cb30`, idéntico en local y VPS). Rolling `api_1` → verificación → `api_2`. Ambas
healthy, `RestartCount=0`, stores byte-idénticos, frontend y edge sin tocar, 0 5xx.

**El fix no bastaba para desatascar los 14.** El guard del retry devuelve `409 already_running`
exactamente cuando `ttsStatus` es `generando`, así que **el estado atascado bloqueaba su propia
reparación**. Verificado en producción: 13 × 409 y 1 × 502 transitorio, **cero escrituras, cero
jobs, cero chunks**. Es un `return` anterior al lock y a la cola.

> Corrección de lo que este documento afirmaba antes: el fix permite que un retry **termine** bien,
> pero no que **empiece** sobre un registro atascado. La prueba local no lo detectó porque
> reintentaba un registro ya en `listo`, donde el guard nunca se dispara.

**Reconciliación metadata-only.** Vía `POST /api/content`, reponiendo el estado terminal exacto del
código (`ttsStatus: 'listo'`, `processingStatus: {100, 0, 0, 'completed', <ISO>}`). 14 POST → 14 × 200
→ 14 `CONTENT_SAVE_SUCCESS`, **0 `Triggering TTS`**, 0 chunks nuevos, 0 coste. Los 41 recursos
conservan todo lo demás byte-idéntico; los 27 no atascados no se tocaron.

**Estado final:** 25/25 recursos textuales en `listo/completed`, 16 podcasts en `no_iniciado`,
**0 en `generando`**.

**Deuda derivada, no bloqueante:** `CHP-TTS-RETRY-STUCK-STATE-DEADLOCK-01`. El guard impide reparar
por la vía canónica un registro atascado en `generando`. No afecta a las cargas normales desde
Studio —con `910c735` ningún registro nuevo puede quedar atascado— y los que lo estaban ya están
reconciliados.
