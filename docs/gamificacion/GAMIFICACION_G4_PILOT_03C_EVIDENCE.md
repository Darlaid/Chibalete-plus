# G4-PILOT-GATE-03C — Primer borrador editorial MOOK en producción

**Fecha:** 2026-11-06, 00:34–00:40Z. **Veredicto:** `GREEN_PROD_DRAFT`.
**Fuente del contenido:** `docs/gamificacion/GAMIFICACION_G4_PILOT_03A_FICHA.md` (§4), copiado literalmente.

## Producción

- API `chibalete/api:ratelimit-f11fecd` (`c9758857…`) ×2; front `chibalete/front:uxfix-b18f6f0`.
- Gamificación apagada: 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`, sin `gamification.db` y sin clave de sujeto.
- `mook_review` sigue en `XP_LOCKED_SOURCES`.

## Preflight

- **Obra:** `content-1775766806680`, «Cuentos de la selva» (Horacio Quiroga).
  - `libro`, `disponible`, sin padre ni partes; `workBlock` = null.
  - El TXT del Modo Guiado existe.
- **Acceso:** 20 reglas activas cubren la obra, entre ellas los dos grupos «Grado 005» (80 lectores y 10 mediadores cada uno).
- **MOOK:** 2 experiencias (`estas-aqui` publicada, otro borrador sin versiones), 5 versiones, 2 runs, 0 evidencias.
  - No existía el slug `selva-tortuga-gigante` ni ninguna experiencia con «tortuga».
  - Ningún nodo referenciaba la obra.
- **Respaldo:** `structured-backup` del 2026-11-06 a las 00:01Z, ok; `data/mook_db.json` capturado íntegro. `backup-verify` del 2026-11-01, ok.
- **Privacidad por código:** `listPublished` exige `published` y `currentVersionId`; `experienceDetail` y `startRun` exigen `published`.
  - El borrador previo ya era invisible en `/api/experiences`.

## Carga

Hecha con las dos operaciones que usa el guardado de Studio, con la sesión del administrador:
1. `POST /api/experiences` → 201.
2. `POST /api/experiences/:id/versions` → 201.

La carga (SHA-256 `e326432f…`) se comparó antes del envío: 22 de 22 textos son literales de la ficha.

| | |
|---|---|
| Experiencia | `exp-1793925477270-j1onug` · `selva-tortuga-gigante` · **`draft`** · `currentVersionId` = null · sin imagen |
| Versión | `expv-1793925477472-portnp` · v1 · **`draft`** · `publishedAt` = null |
| Título / público / duración | La tortuga que no se rindió · Lectores de 7 a 11 años, con acompañamiento del mediador. · 2 sesiones de 40 minutos |
| Objetivos | Los 3 de la ficha |
| `m1` «Leer el cuento» | `n-leer` READING → `content-1775766806680`, con instrucciones · `n-comprender` ACTIVITY: 3 preguntas `text_short`, no privada; un calentamiento sin XP |
| `m2` «Pensar y escribir» | `n-reflexion-1` PRODUCTION «¿Por qué lo hizo?», 40–150 palabras · `n-reflexion-2` PRODUCTION «Una carta para la tortuga», 30–120 palabras; ambas → `content-1775766806680`, con consigna y criterio de revisión de la ficha |

**Decisiones de la Dirección en esta unidad:**
- Los títulos de módulo son los de la ficha, no los de la orden («Leer y comprender» / «Reflexionar y escribir»).
- El encuadre histórico se queda **fuera de Studio**, como guion para el mediador (ficha §6, paso 5).
- «Piloto: Grado 005» no aparece en ningún texto cargado.

## Verificación (solo lecturas)

- La experiencia existe una vez y su versión es la única. Comparada campo a campo con la carga: 0 diferencias.
- Orden: READING → ACTIVITY → PRODUCTION → PRODUCTION, todos obligatorios.
- `productionWorkRef` da la obra con `issue` = null en los dos nodos PRODUCTION: la obra se ofrece antes, en `n-leer`.
- `publishVersion` simulado sobre una copia en memoria: publicable. **No se publicó.** El archivo real sigue en `draft`.
- En las dos réplicas, tras la caché de 30 s:
  - Studio lista 3 experiencias y la del piloto como `draft` (`publishedVersion` = null).
  - `/api/experiences` sigue mostrando solo `estas-aqui`.
  - `GET /api/experiences/:id` → 404 `NOT_PUBLISHED`; `/route` → 404.
- No se usó ninguna vista previa ni se inició ningún run.

## Integridad

- Huellas en `/root/chp-mookdraft/`.
- **Único cambio:** `data/mook_db.json`, con +1 experiencia y +1 versión; 0 entidades modificadas o borradas; runs = 2, evidencias = 0.
- **Idénticos:** padrón, catálogo, grupos, accesos, entregas, progreso, 3524 uploads; 0 `.tmp`/`.lock`; sin `gamification.db`.
- **Logs:** solo `[MOOK] experience created` y `[MOOK] draft v1 created`. 0 errores, 0 5xx y 0 líneas de gamificación, ledger o reconciliación.
- **Bitácora:** entrada en `/root/deploys.log`.
- El borrador entra en el próximo `structured-backup` programado; no se lanzó un respaldo manual.

## Pendientes

- **Audio de la obra:** el manifiesto de abril (111 B) no tiene ningún `.mp3`. No se regeneró. La experiencia no debe prometer audio. No bloquea el borrador; sí debe resolverse o comunicarse antes de abrirla a lectores.
- **Antes de publicar (ficha §5 y §6), cada punto con su propia orden:**
  - PRIV-6;
  - clave de sujeto;
  - registro de exclusiones;
  - desbloqueo de `mook_review`;
  - conjunto de reglas aprobado;
  - fijar `GAMIFICATION_MOOK_SINCE` y, **después**, publicar la versión;
  - pautas y encuadre para los mediadores de Grado 005.
