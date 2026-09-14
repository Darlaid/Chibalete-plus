# CHP-LEO-AI-TRANSPARENCY-NOTICE-01A — Aviso de IA en las superficies activas de Leo

**Veredicto:** `GREEN-LEO-AI-TRANSPARENCY-NOTICE-LOCAL-AND-PUBLISHED`
**Alcance:** local. Publicado en `origin/chp/mook-contract-00`. **NO desplegado** (M1 sigue en drain).
**Fecha:** 2026-09-14.

Cierra el P1 §8 «Aviso visible de IA» inventariado en
`docs/ops/CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A.md` (fila 9 de la tabla de
evidencias): el nodo LEO de MOOK ya avisaba, pero el chat flotante y el
compañero de lectura no.

Esto **no** es un consentimiento, **no** es una política de privacidad y **no**
convierte M5 en GREEN.

---

## 1. Baseline (Fase 0)

| Comprobación | Resultado |
|---|---|
| Rama | `chp/mook-contract-00` |
| HEAD local | `a510631341287e5403b7adc45b12754c7af19b72` |
| `git ls-remote origin refs/heads/chp/mook-contract-00` | `a510631…` — idéntico, sin `fetch` |
| Tracked | limpio |
| Stashes | 3, sin abrir (`stash@{0..2}`) |
| Untracked | 5, sin abrir |
| `docs/ops/CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A.md` | presente |
| `docs/ops/CHP_LEO_AI_TRANSPARENCY_NOTICE_01A.md` | ausente |

Sin drift. No hubo `STOP-LEO-AI-NOTICE-BASELINE-CHANGED`.

---

## 2. Texto autoritativo (Fase 1)

**Fuente existente** — nodo LEO de MOOK, `pages/Experiencias.tsx:304`
(preview del Studio en `components/studio/ExperienceStudio.tsx:256`):

> Leo es un asistente de inteligencia artificial: conversarás con una IA que
> acompaña tu lectura, no con una persona. Leo no califica ni evalúa; las
> producciones las revisa siempre tu mediador humano.

La fuente **sí** identifica expresamente la inteligencia artificial, pero **no**
declara falibilidad, que el requisito exige. Adaptación mínima: una sola
cláusula insertada (`y puede equivocarse`), el resto verbatim.

**Texto adoptado en las dos superficies:**

> Leo es un asistente de inteligencia artificial y puede equivocarse:
> conversarás con una IA que acompaña tu lectura, no con una persona. Leo no
> califica ni evalúa; las producciones las revisa siempre tu mediador humano.

El texto no promete exactitud, no anuncia evaluación automática y no sustituye
al docente: dice lo contrario en su segunda oración. No es jurídico ni pide
aceptación.

`pages/Experiencias.tsx` **no se modificó** (fuera de la allowlist): el nodo LEO
de MOOK conserva su redacción original. El test fija que la cola del aviso sigue
siendo idéntica en ambas, para que la divergencia no crezca en silencio.

---

## 3. Superficies cubiertas

| Superficie | Componente | Dónde aparece el aviso | Momento |
|---|---|---|---|
| Chat flotante | `components/Chatbot.tsx` | banda estática entre el encabezado «Leo - Asistente» y el área de mensajes | al abrir el panel, antes del campo «Pregunta sobre libros…» |
| Compañero de lectura | `components/LeoCompanion.tsx` | banda estática entre el encabezado del diálogo (`h2#leo-companion-title`) y el cuerpo | al abrir el diálogo, antes de «Explicar vocabulario», «Pregunta sobre el texto» y del campo de texto |

En ambas es un `<p>` de nodo, no `title`, ni `aria-label`, ni tooltip, ni
documentación externa.

---

## 4. Allowlist exacta (Fase 2)

| Archivo | Cambio |
|---|---|
| `components/Chatbot.tsx` | +8 líneas (5 de comentario + el `<p>` del aviso) |
| `components/LeoCompanion.tsx` | +9 líneas (6 de comentario + el `<p>` del aviso) |
| `hooks/__tests__/useReducedMotion.structural.test.mjs` | +§13, 37 aserciones nuevas |
| `docs/ops/CHP_LEO_AI_TRANSPARENCY_NOTICE_01A.md` | nuevo (este documento) |

No se creó ningún test nuevo: el test estructural existente ya cubría ambas
superficies (§11 BIBLIOTECA-09 y LAYOUT-03) y basta para demostrar el requisito.

No se tocó backend, rutas, stores, prompts, modelos, proveedores, eventos,
materializador, schemas, navegación, `package.json`, workflows ni configuración.
Ninguna dependencia, componente compartido, servicio, flag, modal ni
consentimiento nuevo.

---

## 5. Implementación (Fase 3)

Mismo marcado en las dos superficies, con la banda discreta ya usada en el
proyecto (`text-xs` sobre `bg-gray-50` / `dark:bg-gray-900`, con la pareja de
color `gray-600` / `dark:gray-300` que CHP-WCAG-01C ya fijó por contraste):

```jsx
<p className="px-4 py-2 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
  Leo es un asistente de inteligencia artificial y puede equivocarse: …
</p>
```

Propiedades que el diseño garantiza por construcción:

- **Visible y en el orden natural del DOM**, antes de todo control que inicia la
  interacción con Leo.
- **No es live region** (`aria-live`, `role=status` y `role=alert` ausentes): no
  se anuncia durante el streaming de respuestas.
- **Estático y único**: no vive dentro del `map` de mensajes del chat ni dentro
  del bloque `mode === 'result'` del compañero, así que no se repite por
  mensaje ni por respuesta.
- **No exige aceptar, marcar ni cerrar nada**: no hay checkbox, botón de
  aceptación, bloqueo ni consentimiento.
- **No añade elementos focalizables**: el ciclo Tab y las trampas de foco de los
  diálogos quedan exactamente como los dejó CHP-WCAG-01B.
- **No toca** mensajes, payloads, prompts, llamadas a IA, puntos, tiempos,
  errores ni resultados de Leo.

---

## 6. Pruebas (Fase 4)

| Gate | Resultado |
|---|---|
| `hooks/__tests__/useReducedMotion.structural.test.mjs` (§13 nueva, 37 aserciones) | **141/141 ✓** (antes 104) |
| `server/__test__/mookAudioA11y.test.mjs` | **18/18 OK** |
| `npm run test:mook` (preservación; ningún archivo compartido modificado) | **verde**, exit 0 |
| `npm run build` | **✓ built in 1m 1s** |
| `npm run typecheck:baseline` | **✅ Sin regresiones TS (current == baseline)** |
| `npm run lint:evidence` | **OK — 866 archivos versionados, 0 violaciones** |
| `git diff --check` | limpio |

Los 15 requisitos de la Fase 4 quedan cubiertos por §13 (estructural) y por §7
(revalidación en Chrome real). CI no se modificó; no se corrigió ningún fallo
heredado.

---

## 7. Revalidación visual (Fase 5)

Entorno hermético local, misma receta de `CHP_WCAG_FIVE_SURFACES_01A` §2.1:
backend real en `:3010` con `NODE_ENV=test`, `SESSION_AUTH_MODE=off`,
`CHP_DATA_DIR`/`USERS_DB`/`GROUPS_DB`/`SCHOOLS_DB`/`ACCESS_DB`/`CONTENT_DB`/
`UPLOADS_ROOT`/`USER_AUDIT_DB` en el scratchpad de sesión, sin claves de IA;
micro-proxy `:3000 → :3010` inyectando el contrato dev `x-user-id`; Vite en
`:5173`. Padrón sintético (`ADM`) y un solo contenido de texto plano
(`fx-libro-01`, ficción). Capturas fuera del repositorio. Entorno apagado al
terminar.

### 7.1 Chat flotante

| Comprobación | Resultado |
|---|---|
| Apertura por teclado | `Shift+Tab` al FAB «Abrir chat con Leo» → `Enter` → panel abierto |
| Aviso visible antes de escribir | sí, primer nodo bajo el encabezado; precede al `<input>` (aviso `bottom` 575 px, input `top` 862 px) |
| Color / fondo / tamaño computados | `rgb(75,85,99)` sobre `rgb(249,250,251)`, 12 px |
| **Contraste medido en Chrome** | **7.23:1** (AA exige 4.5:1) |
| Live region | `aria-live`, `role`, `aria-hidden` = `null` |
| Tras enviar un mensaje y recibir respuesta de Leo | el aviso sigue apareciendo **1 vez** |
| Paradas de tabulación del panel | 4 (Minimizar, Dictar a Leo, campo, enviar) — el aviso no añade ninguna |
| Cierre | «Minimizar» por teclado cierra y el FAB vuelve |
| Scroll horizontal | ninguno |

### 7.2 Compañero de lectura

| Comprobación | Resultado |
|---|---|
| Apertura por teclado | `Shift+Tab` al botón «Pregúntale a Leo» del Modo Guiado → `Enter` |
| Aviso visible antes de pedir respuesta | sí; precede a «Explicar vocabulario», «Pregunta sobre el texto» y al campo |
| Posición en el DOM | tras `h2#leo-companion-title`, antes del cuerpo |
| **Contraste medido en Chrome** | **7.23:1** |
| Foco inicial | en el diálogo (`DIV` con `tabindex=-1`) — contrato 01B intacto |
| Ciclo Tab | permanece dentro del diálogo |
| **Escape** | cierra **y devuelve el foco** al botón «Pregúntale a Leo» |
| Focalizables dentro del aviso / checkboxes en el diálogo | 0 / 0 |
| Tras pedir una respuesta y recibirla | el aviso sigue apareciendo **1 vez** |

### 7.3 Reflow 320 / 479 px (iframe same-origin, media queries reales)

| Superficie | 320 px | 479 px |
|---|---|---|
| Chat flotante | sin scroll horizontal; aviso completo dentro del panel (1–319 px de su caja); no tapa el campo | sin scroll horizontal; panel entero visible; aviso completo |
| Compañero | sin scroll horizontal; aviso completo dentro del viewport; tarjeta entera visible; botones visibles y sin solape | ídem |

**Observación preexistente, no causada por esta unidad:** a 320 px el panel del
chat (`w-80` = 320 px anclado con `right-6` = 24 px) queda 24 px fuera del borde
izquierdo. El desplazamiento afecta por igual al encabezado, a los mensajes y al
campo de entrada; es geometría del panel anterior a este cambio y el aviso, que
vive dentro de esa caja, no lo agrava. No se corrigió: está fuera de la
allowlist y del alcance de esta unidad.

---

## 8. Contratos funcionales preservados

| Contrato | Evidencia |
|---|---|
| `POST /api/leo/ask` | llamada real observada en Chrome: `url:/api/leo/ask`, `method:POST`, claves del payload `contentId, chunkIndex, interactionType, payload, exactSentence, sessionMemory, difficultyLevel, pedagogicalStage` |
| Proveedor del chat | sigue siendo `chatConBibliotecario` de `services/geminiService` |
| Flujo lector | Modo Guiado abre, lee, abre y cierra el compañero, y continúa; `text.session_start` / `text.session_end` emitidos igual que antes |
| Diálogos, foco, Escape y restauración (CHP-WCAG-01B/01C) | verificados vivos en §7.2 y fijados en §13 del test |
| MOOK | `npm run test:mook` verde; `pages/Experiencias.tsx` intacto |

**Nota factual sobre el chat flotante:** el panel del chat no es un diálogo
modal y nunca tuvo contrato de `Escape` ni de restauración de foco (las unidades
WCAG establecieron esos contratos para `LeoCompanion` y para el panel de ajustes
del Guiado, no para el chat). Se comprobó que `Escape` no lo cierra y que al
minimizarlo el foco cae a `body`: **comportamiento preexistente, idéntico antes
y después de esta unidad**. No se modificó — está fuera del alcance.

---

## 9. Cero efectos productivos

- Sin deploy, sin SSH, sin Docker, sin HTTP productivo, sin cambios de flags.
- Sin cambios en backend, rutas, endpoints, prompts, modelos, proveedores,
  eventos, materializador, schemas ni navegación.
- `data/` intacto: mtimes de `content.json`, `users_db.json`, `groups_db.json`,
  `progress_db.json` y `access_db.json` idénticos antes y después.
- `public/uploads/` intacto (64 entradas antes y después).
- `data-critical/identity.db`, `insights.db` y `usuarios_colegios_oro.json`
  intactos.

### 9.1 Desviación registrada y resuelta — telemetría sintética en `data-critical/events.db`

Durante la revalidación visual el backend hermético se arrancó **sin**
`EVENTS_SQLITE_PATH`, que la receta de `CHP_WCAG_FIVE_SURFACES_01A` §2.1 sí
enumera. `server/eventsService.js:46` cae entonces al default
`../data-critical/events.db`, de modo que el navegador escribió **9 filas
sintéticas** en la base de eventos real (quedaron en el WAL; el archivo
`events.db` no cambió de mtime en ese momento).

- Contenido: `text.session_start` ×6, `text.session_end` ×2,
  `text.leo_interaction` ×1, del usuario ficticio `ADM` sobre el contenido
  ficticio `fx-libro-01`, en 7 sesiones sintéticas.
- Sin datos personales, sin usuarios reales, sin contenido real.
- `events.id` **2351–2359** (cola contigua de la tabla).
- **Ventana exacta:** `2026-09-14T16:54:07.892Z` – `2026-09-14T16:56:33.385Z`
  (`created_at` = `server_ts`). La primera redacción de este documento dio
  `16:48Z – 16:57Z`, que era un superconjunto estimado, no la ventana medida.

**Preflight en solo lectura** (`CHP-EVENTS-SYNTHETIC-CONTAMINATION-PREFLIGHT-01`,
2026-09-14): los cuatro marcadores —rango de ids, `user_id`, `content_id` y
ventana temporal— seleccionaban **independientemente el mismo conjunto de 9**;
ninguna fila legítima compartía marcador alguno. Impacto clasificado como
`HOT_STORE_ONLY`: `events.archive.db` no existe, y todo `insights.db` estaba
vacío (`materializer_state` sin filas y las 21 tablas de proyección en cero), de
modo que **ningún evento sintético alcanzó proyección, watermark ni archivo**.

**Purga ejecutada** el 2026-09-14 con autorización expresa de Nicolás Jiménez,
limitada a esas nueve filas:

- Copia recuperable previa mediante **SQLite Online Backup API** —no copia de
  archivo, porque las filas vivían en el WAL y solo el Backup API produce una
  instantánea consistente de db+WAL— fuera del repositorio, verificada con
  `integrity_check = ok` y 2359 filas.
- Predicado con **todos** los marcadores verificados: `id BETWEEN 2351 AND 2359`
  + `user_id='ADM'` + `content_id='fx-libro-01'` + `mode='text'` +
  `schema_version=1` + `event IN (…)` + `created_at BETWEEN …`.
- Transacción única: conteo previo 9 → `DELETE` → `changes() = 9` → `COMMIT`
  (cualquier desviación habría disparado `ROLLBACK`).
- Posterior: `integrity_check = ok`; segunda ejecución del predicado con **0
  candidatos**; 2359 → **2350** filas; `max(id) = 2350`; cero residuo por
  `user_id`, por `content_id` y por ventana temporal.
- **Cero daño colateral demostrado:** el digest SHA-256 de las 2350 filas
  legítimas es idéntico antes y después
  (`a8c05a93f16ba5a32877eda6b0bd156937017cc128be5ff46040495067ef780c`).
- `sqlite_sequence.events` se dejó intacto en 2359 (la tabla es `AUTOINCREMENT`),
  así que ningún evento futuro reutiliza los ids purgados.
- Copia temporal eliminada después de la purga, previa reverificación de su
  SHA-256.

**Checkpoint automático (efecto no anunciado de antemano).** Al cerrar la última
conexión, SQLite ejecutó su **checkpoint de cierre** propio del modo WAL y plegó
el WAL en el archivo principal: `events.db` pasó de 1 056 768 B (SHA-256
`e97f1cd6…1cbcc`, mtime 2026-08-19) a 1 064 960 B (SHA-256 `2483cf7f…0933`) y el
`-wal` quedó en 0 B. No se emitió ningún `wal_checkpoint`, `VACUUM` ni
compactación: es comportamiento intrínseco de escribir en una base WAL y
cerrarla, inseparable del borrado autorizado. El WAL contenía además escrituras
legítimas previas sin checkpointear; ninguna se perdió, como acredita el digest
de control de las 2350 filas.

No se modificaron proyecciones, `identity.db`, `usuarios_colegios_oro.json` ni
producción, y `events.archive.db` sigue sin existir.

---

## 10. P1 no tocados

De los 6 P1 de `CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A`, esta unidad cierra uno
(«aviso visible de IA») y deja intactos los demás:

- fallback `open` en producción;
- log del cuerpo de eventos (ya cerrado en `a510631`, sin desplegar);
- mediador de Leo sin scope (ya cerrado en `25d0a76`, sin desplegar);
- ausencia de aviso de privacidad;
- previews verbatim de Leo sin TTL.

Tampoco se tocaron retención, prompts, proveedores, Gemini, gamificación, CIS,
eventos, M1, LU, MOOK funcional, FilBo, pedagogía, backups, CI, runbooks ni los
P2 abiertos.

---

## 11. Único siguiente paso

Implementar, **apagada por defecto y solo con fixtures**, la caducidad de las
previews verbatim de Leo conforme a la política de retención aprobada
(`CHP_MOOK_EVENTS_RETENTION_POLICY_01B`).
