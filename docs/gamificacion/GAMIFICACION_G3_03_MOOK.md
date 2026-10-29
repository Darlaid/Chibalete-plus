# GAMIFICACION-G3-03: MOOK como primera fuente de hechos

**Fecha:** 2026-10-29 · **Base:** `66cf596` (G3-02 publicado; CI 4/4 en verde, incluido `backup-capacity` con `backup-suite-sandboxed`) · **Producción:** `g0-f4836d1`, sin cambios.
**Estado:** conexión **inerte por defecto**. Sin `GAMIFICATION_ENABLED=1` **y** sin `GAMIFICATION_MOOK_SINCE`, nada se programa, nada se abre y nada se escribe. **Ningún flag activado y ningún usuario real conectado.**

## 1. Contratos MOOK implementados (`server/gamification/mookSource.mjs`)

| Fuente | Qué cuenta | `sourceEventId` (determinista) | Qué NO cuenta |
|---|---|---|---|
| `mook_review` / `evidence_reviewed` | Evidencia `REVIEWED` con `decision === 'aprobado'` y `reviewedAt ≥ corte` | El id de la evidencia | `con_comentarios`, cualquier otra decisión, evidencia sin revisar y evidencia anterior al corte. **No generan siquiera un hecho** |
| `mook_experience` / `experience_completed` | Run `completed` con `completedAt ≥ corte` | `usuario:versión` (una vez por versión, aunque el lector repita la ruta) | Runs activos o abandonados y runs anteriores al corte |

**Sujeto:** se resuelve con el padrón canónico (`USERS_DB`) y la regla de cuenta activa del servidor (`isUserActive`):

| Caso | Decisión, sin emisión |
|---|---|
| Inexistente | `rejected_not_eligible` |
| Sintético (`isSyntheticUser`) | `rejected_excluded_user` |
| Inactivo | `rejected_inactive_account` |
| **Autorrevisión** (revisor = autor) | `rejected_self_review` |

Los montos, el grado y los topes los fija `policy.mjs` (G3-02). MOOK no aporta cantidades.

**No se modificaron las reglas pedagógicas ni los permisos de MOOK.** Solo se lee lo que el servidor ya escribió.

### Enganches en `server.js` (aditivos)

| Punto | Enganche |
|---|---|
| `POST /api/experiences/review/:evidenceId` | `onMookEvidenceReviewed(ev)` **después de `res.json`** |
| `emitCompletionEvents` cuando `out.experienceTransitioned` | `onMookRunUpdated(run)`. Cubre las dos rutas que completan un run: `nodes/:nodeId/complete` y la entrega de evidencia |
| `app.listen` | `startMookReconciler(...)` |
| Imports | `mookSource.mjs` e `isSyntheticUser` |

Los ganchos **nunca lanzan ni esperan**: delegan en `intake.scheduleFact` (G3-02), que corre después de la respuesta con su propia conexión y un busy de 150 ms, y desiste ante cualquier fallo.

## 2. Estrategia de reconciliación

- **Corte de activación explícito (`GAMIFICATION_MOOK_SINCE`, ISO 8601):** es la manera segura de distinguir la historia elegible.
  - **Sin corte, o con un corte inválido:** la reconciliación y los ganchos **quedan desactivados**, con un aviso en el log al arrancar.
  - **Con corte:** nada anterior entra; no hay puntos retroactivos. Aun así, la historia anterior sigue siendo legible, y el reconciliador la filtra en cada barrido.
- **Barrido completo por diferencia de conjuntos** (G3-02), sin marca de agua.
- **Programación:**
  - un barrido inicial a los `GAMIFICATION_RECONCILE_INITIAL_DELAY_MS` (por defecto 60 s; antes abre y migra la base, fuera de cualquier petición);
  - después, cada `GAMIFICATION_RECONCILE_INTERVAL_MS` (por defecto **15 min**, mínimo **1 min**);
  - temporizadores `unref`.
- **Una ejecución efectiva a la vez:**
  - entre réplicas, un lock `O_EXCL` en `<base>.reconcile.lock` sobre el bind mount compartido (mismo mecanismo que `server/usersLock.js`); si otra réplica lo tiene, el barrido **se salta** y no espera;
  - un lock con más de 10 min se considera huérfano y se libera;
  - dentro de una réplica, un guard en memoria impide barridos superpuestos.
- **Conexión propia con busy de 250 ms:** ante contención el barrido se corta y el siguiente lo retoma; es idempotente.
- **Recuperación tras reinicio:** una caída entre la escritura MOOK y el gancho deja el hecho solo en `mook_db.json`, y el siguiente barrido lo registra una sola vez.

## 3. Pruebas

| Suite | Resultado | Cubre |
|---|---|---|
| `mookSource.test.mjs` | **45 ✓** | (1) Aprobada: 1 hecho, aunque el gancho se repita 3 veces y luego reconcilie. (2) Autorrevisión sin recompensa. (3) `con_comentarios`, otras decisiones y evidencia sin revisar no producen ningún hecho. (4) Experiencia idempotente, también al repetir la ruta. (5) **Dos procesos** reconciliando a la vez: exactamente 50 hechos, ninguno duplicado y sin lock huérfano. (6) Evento perdido recuperado tras un reinicio. (7) Nada anterior al corte (el borde `≥` sí cuenta). (8) Flag OFF o sin corte: ni archivos, ni hechos, ni temporizadores. Además: sujetos inactivos, sintéticos e inexistentes; lock vigente (se salta) y lock huérfano (se libera); intervalo con su mínimo |
| `mookHooksHttp.test.mjs` | **14 ✓** | `server.js` real por HTTP en tres modos (**OFF**, **motor roto** con la base corrupta y **ON**). Iniciar ruta (201), entregar producción que completa la experiencia (201) y revisión `aprobado` (200) dan **respuestas idénticas** y un `mook_db.json` equivalente en los tres. Ningún otro store cambia. La base corrupta queda intacta. En ON hay exactamente 2 hechos (revisión y experiencia), 30 PM y 50 XP según la regla, sin duplicados del barrido de arranque. En OFF no se crea la base |
| Núcleo, concurrencia, backup y aislamiento | **138 / 36 / 14 / 16 ✓** | Aserciones estructurales nuevas: `server.js` importa **solo** `mookSource.mjs`; engancha solo revisión, experiencia y reconciliador; el gancho de revisión va después de `res.json`; ni lectura, ni progreso, ni Leo, ni acceso llaman al motor. La única escritura de archivo del módulo es su lock |

## 4. Riesgos residuales

1. **Lock basado en `mtime`.** Un barrido de más de 10 min se consideraría huérfano. Con MOOK, un barrido dura milisegundos; una fuente masiva necesitaría renovar el lock.
2. **Pausa del event loop.** Cada gancho con contención puede pausarlo hasta unos 150 ms, y cada barrido hasta unos 250 ms. Está acotado.
3. **Coste de los ganchos.** Con el flag ON, cada gancho lee el padrón (`readJSON` en caché) para resolver al sujeto. Con el flag OFF no lo lee.
4. **Responsabilidades de quien active.** La reconciliación depende de que el corte y el conjunto de reglas se definan con cuidado: ningún conjunto de reglas está aprobado. Sin reglas vigentes, los hechos fallan con `NO_ACTIVE_RULES` y se recuperan cuando existan.
5. **Pendiente antes de activar:** desplegar el runner de backups, la DPIA, decidir sobre `con_comentarios` (hoy excluido por diseño) y un conjunto de reglas aprobado por Finanzas.
