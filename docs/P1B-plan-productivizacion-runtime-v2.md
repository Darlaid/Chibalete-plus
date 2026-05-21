# PLAN P1-B — PRODUCTIVIZACIÓN DEL RUNTIME INMERSIVO V2

**Origen:** Auditoría 2026-05, FASE 3. Decisión del usuario: productivizar V2 detrás de kill-switch flag y detener el dual-maintenance.
**Naturaleza:** plan. **No se modifica código** hasta aprobación de cada fase. Respeta CLAUDE.md (cambios progresivos, no romper V1 hasta que V2 lo reemplace verificado).

---

## 1. Contexto y por qué V2

| | V1 (productivo hoy) | V2 (construido, muerto tras dev-flag) |
|---|---|---|
| Arquitectura | Acoplado al render React; índice activo = `useState`; `<audio>` en JSX; 3 planos de control + ≥5 guards anti-stale | FSM real, independiente de React, OperationQueue, store observable, isolation-audited |
| Tests | ~1000 asserts **regex sobre fuente** (no detectaron el crash de `canStartAudio`) | Tests behaviorales de integración |
| Estado | Parcheado por acreción (~6 sprints M-5.4.x) | Mecánicamente completo, nunca cableado a ruta prod |

El equipo ya construyó la solución correcta. El plan es **terminarla y conmutar**, no añadir un guard 19 a V1.

---

## 2. Estrategia: kill-switch reversible en runtime

**Principio:** V1 y V2 coexisten detrás de un flag con **rollback instantáneo sin deploy**. Nada se borra hasta que V2 esté verificado en producción.

- **Flag de servidor (no solo localStorage):** un valor `IMMERSIVE_RUNTIME` resoluble por: (1) override por `localStorage` (dev/QA), (2) cohorte por usuario/colegio servida por backend, (3) default global. Permite **canary** (1 colegio → N% → 100%) y **kill-switch** (revertir a V1 cambiando un valor, sin redeploy).
- Hoy el gate es `localStorage.IMMERSIVE_RUNTIME==='v2-local'` + un bloque "NO mergear a main" en `App.tsx`. Fase 0 convierte eso en un selector de runtime soportado en producción.

---

## 3. Fases (cada una con gate de salida; ninguna avanza sin la anterior verde)

### Fase 0 — Cierre del crash latente y red de seguridad (prerequisito duro)
- Fix verificado de `useImmersivePlayback.ts:3040` (`canStartAudio` ReferenceError) — ítem P0.6 del Master Plan, **independiente de V1/V2** (V1 sigue en prod durante la migración; no puede crashear el diagnóstico).
- Añadir ≥1 test **behavioral** (Vitest+jsdom) que ejecute realmente el hook V1 (play→advance→pause) — hoy no existe ninguno; sin esto no hay forma de saber si la migración regresiona V1.
- **Gate:** crash cerrado + test behavioral V1 verde en CI.

### Fase 1 — Paridad funcional V2 vs V1 (auditoría dirigida)
- Matriz de paridad: por cada capability de V1 (perSentence, perChunkNoAnchors, perChunkWithAnchors, recovery tab-hide, autoplay-block, navegación manual, gapless, INV-1..18) → ¿implementada/equivalente en V2? ¿gap?
- Identificar gaps reales y estimarlos. (V2 está "mecánicamente completo" — esta fase confirma si "completo" == "paritario".)
- **Gate:** matriz de paridad cerrada con cero gaps bloqueantes (o gaps con plan).

### Fase 2 — Wire-up de V2 en ruta de producción detrás del flag
- Resolver `IMMERSIVE_RUNTIME` desde backend (cohorte) con fallback a V1.
- Ruta inmersiva selecciona runtime por el flag resuelto. **V1 permanece como default global** y como fallback de kill-switch.
- Telemetría comparativa obligatoria (vía la observabilidad de P2): tasa de `AUDIO_SPLIT_BRAIN`, drift detectado, stuck-playback, recovery success, por runtime.
- **Gate:** V2 alcanzable en prod solo para cohorte interna/QA; V1 intacto para todos los demás; dashboards comparativos vivos.

### Fase 3 — Verificación real (no regex)
- Automatizar el smoke **S-2-mini con Playwright** (Apache-2.0, ya en uso para a11y) sobre contenido `perChunkNoAnchors` real (p.ej. "Guerra") — el smoke que la doc `M5.4.9` admite **nunca se ejecutó**.
- Smoke en device/condición real: mobile (timers throttled), tab-hide, autoplay-block, red lenta.
- Formalizar la FSM de V2 con **XState** (MIT) → model-based testing + visualizer.
- **Gate:** S-2-mini automatizado verde en CI + smoke mobile manual firmado.

### Fase 4 — Canary progresivo
- 1 colegio → telemetría 1 semana → si métricas V2 ≥ V1 (menos stuck/drift, igual o mejor recovery) → ampliar N% → 100%.
- Kill-switch documentado y probado: revertir cohorte a V1 sin deploy, en < 5 min.
- **Gate:** V2 al 100% con métricas de campo ≥ V1 sostenidas 2 semanas.

### Fase 5 — Retiro de V1 y fin del dual-maintenance
- Solo tras Fase 4 sostenida: eliminar V1 (`useImmersivePlayback.ts`, `immersivePlaybackMachine.js`, el árbol V1 de `VisorInmersivo.tsx`), el bloque "NO mergear" de `App.tsx`, los ~1000 tests regex (reemplazados por los behaviorales), y `lint-immersive-guards` si los invariantes ya viven en la FSM XState.
- **Gate:** una sola arquitectura inmersiva en el repo; CI sin tests regex-theater.

---

## 4. Reglas de seguridad del plan
- **V1 nunca se toca para "mejorarlo" durante la migración** — solo el fix de crash de Fase 0 (que es de seguridad, no de feature). Cualquier esfuerzo en V1 es deuda muerta.
- **Ningún borrado de V1 antes de Fase 5.** Kill-switch siempre disponible hasta entonces.
- **Dependencia con P2 (observabilidad):** Fase 2+ requiere la telemetría de P2 para decidir el canary con datos, no por intuición. Secuenciar P1-B Fase 2 después de P2 mínimo viable.
- Sin nuevas deps fuera de MIT/Apache/BSD: XState (MIT), Vitest (MIT), Playwright (Apache-2.0, ya presente).

## 5. Resumen ejecutivo del plan
Fase 0 (cerrar crash + red de tests V1) → Fase 1 (paridad) → Fase 2 (wire-up tras flag, V1 default) → Fase 3 (verificación Playwright/XState real) → Fase 4 (canary con telemetría) → Fase 5 (retiro V1). Reversible en cada punto vía kill-switch. El dual-maintenance termina solo en Fase 5, con datos de campo, no antes.
