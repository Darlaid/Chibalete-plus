# CHP-EDITORIAL-ROYALTIES-2026-01 — F2-B en producción (evidencia de cierre)

**Fecha:** 2026-10-22 (UTC) · **Commit desplegado:** `ffc563b2b066a0e757aa114ad2deb1944615b087` · **Plan:** `PLAN_GENERAL_V1_1.md` (sin cambios)
**Veredicto:** GREEN. Clasificación comercial desplegada; las 22 reglas siguen `unclassified` y ninguna es económicamente elegible.
**Implementación, matriz y defecto `b2c`:** `F2B_COMMERCIAL_MATRIX.md`.

## 1. Gate de CI

- `content-rmw` de `ffc563b` (run `39823381017`): el intento 1 falló en «Gate — pérdida de escrituras entre réplicas» (17:33Z). El intento 2, reejecutado sin tocar pruebas ni controles, salió **verde** (20:25–20:29Z). Ese mismo paso salió verde 3 de 3 en una reproducción local (`node:20-bookworm`, `npm ci`) y en `3cd95ae`, que tiene el mismo código de servidor. Se trata de una intermitencia preexistente.
- Resto del CI de `ffc563b`: identity-preflight (incluye `test:royalties`), image-integrity y gitleaks-head en verde. Los 5 jobs de `security` fallan igual que antes de F1-A (deuda independiente).

## 2. Despliegue

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Preflight | 20:32 | api_1/api_2 `royalties-f2a-36cc965` healthy, 0 reinicios; override `32d169c9…`; 8,8 GB libres |
| Respaldo previo | 20:33 | `structured-20261022T203301Z-5e0ef3f1` (snapshot `394cd5e3`, 32 stores) |
| Imagen | 20:35 | `chibalete/api:royalties-f2b-ffc563b` = `54c9e489a242…`, revisión `ffc563b`. Probada sobre sí misma (`accessB2cPreservation` 12/0, `commercialClassHttp` 39/0, `commercialClass` 58/0, `rightsHttp` 50/0). Tarball sha256 `91da9a38…` verificado en el VPS; el ID coincide en local y en el VPS |
| Rollback preparado | 20:37 | tag `rollback-pre-f2b` (`49475d4f`), override `.bak-pre-f2b-20261022T203745Z`, `/root/chp-f2b/ROLLBACK.txt` |
| api_1 | 20:37:59 → 20:38:11 healthy | solo la línea 40 del override |
| **Gate api_1** (pasos separados, solo lectura) | 20:38–20:42 | Ver §3. GREEN documentado antes de tocar api_2 |
| api_2 | 20:42:46 → 20:43:00 healthy | solo la línea 85 del override; override final `af0b7a43…` |
| Respaldo posterior | 20:43 | `structured-20261022T204345Z-8b247083` (snapshot `f5073130`, 32 stores) |

- Sin migraciones: `royalties.db` arranca en las dos réplicas sin aplicar nada (`[PUBLISHERS] royalties.db ready`, 0 líneas `royalties-migrate`).
- Frontend sin desplegar (`royalties-f1a-a3b704d`).

## 3. Gate de api_1 (antes de tocar api_2)

- Healthy, 0 reinicios, 0 respuestas 5xx, 0 `[ERROR]`, 0 `[RIGHTS`, 0 `access_commercial_class_set`.
- Tráfico real atendido: my-catalog 200, `/access` 200/304, progreso 200, biblioteca personal 200.
- Invariantes iguales al snapshot previo (ver §4).
- Sondas anónimas: health 200; matriz, atribución, clasificación (PUT), `POST /api/access`, derechos, titulares y catálogo responden 401.
- Sesión de administrador: matriz 200 `no-store` cuando atiende api_1 y 404 cuando atiende api_2 (todavía F2-A), lo que confirma qué réplica responde. Atribución 200. Catálogo idéntico en las dos réplicas (`111c38243d5a`).
- WARN clasificados como benignos: los «Unauthorized access attempt» son las sondas anónimas sin secreto, y el «Analytics: evento descartado» viene de un evento de otra sesión que el navegador tenía en cola y que se descartó correctamente.

## 4. Invariantes (snapshot previo, tras api_1, tras api_2 y final 21:01Z: idénticos)

| Invariante | Valor |
|---|---|
| `access_db.json` | sha `d4182a1d1152…`, 22 reglas, **0 con campos comerciales** |
| `b2c` | `order-900000001` (sha `f40a7988…`, idempotencia `production:order:900000001`, `revokedAt` 1790650325681) y `order-900000002` (sha `055afc8f…`, `production:order:900000002`, `revokedAt` 1790653125429), intactos |
| `content.json` | sha `9faaf685…`, 109 registros, 109 con `pub-chibalete-editores` |
| `royalties.db` | `integrity_check` ok; `0001` + `0002`; `rights_versions` = 0; triggers append-only presentes; 1 titular activo |
| `RIGHTS_ENFORCEMENT_MODE` | sin definir (`off`) |

## 5. Smokes por rol (sesiones legítimas, sin cambios en reglas reales)

| Rol | Comprobaciones | Resultado |
|---|---|---|
| Administrador (`-1774362611303`) | matriz 200 en ambas réplicas: 22 reglas, 22 `unclassified`, 0 elegibles, 0 con historial; atribución de lector `-092` + *La metamorfosis*: `access-v6-explicit-group-1776199266164`, `CLASS_UNCLASSIFIED`, no elegible; B2C revocado `-d51a98`: `NO_COVERING_RULE`; titulares 200; elegibilidad de derechos `NO_RIGHTS_VERSION`; catálogo 109, `111c38243d5a` | GREEN |
| Mediador (`-171`) | catálogo 109 con hash idéntico a F2-A (`111c38243d5a`), 0 campos contractuales/comerciales; `/access` 200 («acceso de mediador»); grupos 200; Aula Viva (curso de 80); visor PDF (206); matriz, atribución, derechos, elegibilidad y titulares 403; PUT de clasificación 403; `POST /api/access` 401 | GREEN |
| Lector (`-092`) | catálogo 89 con hash idéntico a F2-A (`bfef49de05bd`); my-catalog 89; `/access` 200 `allowed`; biblioteca personal 200; Biblioteca visible; visor PDF con reanudación; mismas denegaciones 403/401 | GREEN |

Estado final (21:01Z): api_1 y api_2 `royalties-f2b-ffc563b` healthy, 0 reinicios, 0 respuestas 5xx desde el despliegue; 8,0 GB libres.

## 6. Respaldo y restauración aislada

- Snapshot posterior `f5073130`. Se restauraron en `/root/chp-f2b/restore-3mgg` solo `access_db.json`, `royalties.db` y el manifiesto.
- `access_db.json`: sha `d4182a1d…`, igual al manifiesto y al archivo vivo; 22 reglas; los dos objetos `b2c` coinciden byte a byte con los vivos.
- `royalties.db`: sha `2ee6b408…`, igual al manifiesto y a la restauración de F2-A; íntegra, `0001` + `0002`, 0 derechos, titular y triggers idénticos.

## 7. Incidencias

- **Proveedores de IA (ajeno a F2-B):** TTS bajo demanda y `/api/leo/recap` siguen expuestos a cuotas agotadas (`F2A_PROD_EVIDENCE.md` §5.1). No hubo errores de proveedor durante esta ventana, así que no ocultan ninguna regresión.
- **CI `content-rmw`:** intermitencia registrada en §1.
- No hubo regresiones atribuibles al despliegue y no se usó el rollback.

## 8. Baseline para la siguiente unidad

- API: `chibalete/api:royalties-f2b-ffc563b` (`54c9e489`) en api_1 y api_2. Front: `royalties-f1a-a3b704d`. Override `af0b7a43…`. Rollback: `rollback-pre-f2b` (`49475d4f`) y `/root/chp-f2b/ROLLBACK.txt`.
- 22 reglas `unclassified` a la espera de aprobación individual (P9) y lista de cuentas internas (P7) pendiente.
- Último respaldo verificado: `structured-20261022T204345Z-8b247083`.
- F3-A2 no iniciada.
