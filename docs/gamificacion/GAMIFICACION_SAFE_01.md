# GAMIFICACION-SAFE-01: aislamiento de pruebas y cierre de `mission`

**Fecha:** 2026-10-30 · **Base:** `8d351fd` (G4-04) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** pruebas, guard de pruebas y un bloqueo en `policy.mjs`. Sin esquema, migraciones, obra, ciclo, tarifas ni flags activos. Actualiza la matriz de emisión de [G4-04](GAMIFICACION_G4_04_ALINEACION.md) §2-3.

## 1. Inventario

El riesgo era mayor que las diez suites conocidas: **60 suites** arrancan `server.js` o subprocesos que lo hacen. 36 no importaban `testMode.mjs`, y este solo redirigía cuatro stores. Además, el guard de `fs` no alcanza a SQLite, que es nativo.

| Store | Antes | Ahora |
|---|---|---|
| `events`, `archive`, `insights`, `progress` | Temporal solo con `testMode` | Temporal en las 60 |
| `offline_assignments`, `royalties`, `gamification` | Real por defecto | Temporal por defecto en `testMode` |
| `identity`, `sessions` | Real por defecto si la suite no los fija | Abrir el real falla |
| JSON configurables (`groups`, `schools`, `leo_evidence`) | Real si no se fijan | Lectura permitida; escritura bloqueada |
| Rutas fijas: `leo_memory_db`, `leo_profile_db`, `analytics_db`, `lu_config`, `content.json` de Leo | Escribibles | Lectura permitida; escritura bloqueada. **No se redirigen:** requeriría tocar el servidor |
| Abrir SQLite fijo (`analyticsHealth`, `archiveRotation`) | Posible | Falla si cae en un store real |

`validate-local.mjs` y `productionCanaryRuntimeBinding.test.mjs` no arrancan el servidor. `scripts/royalties/a11yLab*.mjs` sí, pero son herramientas manuales con entorno propio, no pruebas, y quedan **fuera de esta protección**.

## 2. Mecanismo

- **`scripts/test-real-store-guard.mjs`:** además de `fs`, envuelve el constructor de `better-sqlite3`; bloquea también la apertura en solo lectura, porque en WAL ya toca el `-shm`. Node 20 no consulta `require.cache` al hacer `import` de un paquete CJS, de ahí los dos módulos auxiliares `test-real-store-guard-hooks.mjs` y `-sqlite.mjs`. Cubre también imports nombrados y `cp`.
- **`server/__test__/helpers/testMode.mjs`:** carga el guard, lo hereda a todo subproceso por `NODE_OPTIONS`, apaga `EXPERIENCE_EVENTS_BACKBONE_ENABLED`, `LEO_EVENTS_BACKBONE_ENABLED`, `ARCHIVE_ROTATION_ENABLED`, `SNAPSHOT_HISTORY_ENABLED` y `AULA_VIVA_SCHEDULER_ENABLED`, y hace fallar la suite al salir si hubo un bloqueo, aunque el código bajo prueba lo capture.
- **`realStoreGuard.test.js`:** prueba todo lo anterior y falla si una suite nueva arranca `server.js` sin `testMode`.

## 3. `mission`

`mission` entra en `PM_LOCKED_SOURCES`: una regla con `pm > 0` se rechaza, y una regla antigua se fuerza a 0. **Ninguna fuente puede emitir PM en producción.** El XP de `mission` no cambia y sigue sin llamador.

Las pruebas de topes, idempotencia, concurrencia y saldo usan `__test__/helpers/pmMechanicsHarness.mjs`: un hook de carga, solo de pruebas, que retira `mission` del bloqueo en ese proceso. No hay flag, variable ni fuente en producción. `emissionLocks.test.mjs` verifica el bloqueo real sin el arnés.

## 4. Incidente durante esta unidad

**El primer guard SQLite no funcionó y su prueba negativa creó dos archivos vacíos:** `data/robado.db` y `data-critical/robado.db`, de 0 bytes, ignorados por Git. La medición de huella lo detectó. Ningún archivo preexistente cambió.

- Se conservan porque la unidad prohíbe borrar en esas carpetas. Su retirada queda a decisión humana.
- Las pruebas negativas ahora usan `fileMustExist` sobre un nombre inexistente: si el guard fallara, no se crea nada.

## 5. Fallos e intermitentes

| Suite | Resultado | Clasificación |
|---|---|---|
| `leoMediatorScope` | 1 ✗, comprobación de texto sobre `server.js` | **Preexistente:** igual en `8d351fd` |
| `libraryInstitutionalPersonal` | 1 ✗, política no-store de `/api/content` | **Preexistente:** igual en `8d351fd` |
| `identityCanonicalSource` (`test:identity`) | 1 ✗: el padrón local ya existe | **Preexistente y local.** Corta la cadena `test:identity` en esta máquina |
| `contentGlobalReadOnlyPolicy` | `fetch failed` una vez; 3/3 al repetir | Coherente con el puerto `pid % N` de G4-01, sin confirmar en esta corrida |
| `identityShadowCompare` | **Intermitente sin causa:** 81 ✓, 7 ✗ una vez (500 y JSON ilegible en la posición 151297); después 9/9 con 95 ✓ | No reproducido. No se añadieron reintentos |
| `mookHooksHttp` arranque | No reapareció | Sigue sin causa determinada |
