# CHP-EDITORIAL-ROYALTIES-2026-01 — F2-A en producción (evidencia de cierre)

**Fecha:** 2026-10-22 (UTC) · **Commit:** `36cc965f2d5799aabdf2316b416e65772b797acf` · **Plan:** `PLAN_GENERAL_V1_1.md` (sin cambios)
**Veredicto:** GREEN. Registro de derechos desplegado, vacío y con el cumplimiento apagado (`off`).
**Auditoría e implementación:** `F2A_IMPACT_AUDIT.md`.

## 1. Preflight

- Rama `chp/epub-mainfile-r1-release` = origin = `36cc965`, árbol limpio.
- CI de `36cc965`: identity-preflight (incluye `test:royalties`), content-rmw, backup-suite-sandboxed, capacity-suite, image-integrity y gitleaks-head en verde. Los 5 jobs de `security` fallan igual que antes de F1-A (deuda independiente).
- Delta desde F1-A: `server/`, `ops/` (pruebas de respaldo), `docs/` y una línea de script en `package.json`. **Sin cambios de frontend → frontend no desplegado.**
- Producción previa: api_1/api_2 `royalties-f1a-a3b704d` (`0800e27c`), `SESSION_AUTH_MODE=enforce`, `UPLOADS_AUTHZ_MODE=strict`, `ACCESS_FALLBACK_MODE=restricted`; `royalties.db` íntegra con `0001_publishers` y `pub-chibalete-editores`; 109/109 contenidos con `publisherId`.

## 2. Despliegue

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Respaldo previo | 15:53 | `structured-20261022T155356Z-1fc8f18b` (snapshot `2e3b6ef6`) |
| Imagen | 15:55 | `chibalete/api:royalties-f2a-36cc965` = `49475d4f87f6…`, revisión `36cc965`; tarball sha256 `86ad323a…` verificado en el VPS; ID igual en local y VPS |
| api_1 | 15:56 | healthy; `[royalties-migrate] applied 0002_rights_versions` |
| api_2 | 16:00 | healthy; sin reaplicar la migración |
| Respaldo posterior | 16:01 | `structured-20261022T160108Z-997ce8fb` (snapshot `bb345a60`, 32 stores) |

- Override: solo cambiaron las líneas 40 y 85 (imagen). Mounts idénticos entre réplicas. `RIGHTS_ENFORCEMENT_MODE` **no está definida** (el código la trata como `off`).
- Rollback preparado y no usado: tag `rollback-pre-f2a` (`0800e27c`), copia del override y `ROLLBACK.txt` en `/root/chp-f2a/`. La migración `0002` es aditiva: la imagen F1-A ignora migraciones que no conoce, así que el rollback no toca `royalties.db`.

## 3. Almacén

- `royalties.db`: `integrity_check` ok; `_migrations` = `0001_publishers` (13:38:11) y `0002_rights_versions` (15:56:36), una vez cada una; triggers `rights_versions_no_update` y `rights_versions_no_delete`; **`rights_versions` = 0 filas**; `publishers` = 1 (`pub-chibalete-editores`, activo, sin cambios).
- Restauración aislada desde `bb345a60`: sha `2ee6b408…` igual al del manifiesto; integridad, migraciones, triggers, 0 derechos y titular idénticos.
- Runner de respaldo sin cambios (`stores.py` `0224aa51…`): `royalties.db` es el mismo archivo.

## 4. Smokes por rol (sesiones legítimas, sin registros de prueba)

| Rol | Comprobaciones | Resultado |
|---|---|---|
| Administrador | titulares, derechos y elegibilidad 200 + `no-store` en ambas réplicas; `enforcementMode: "off"`; 0 versiones; 109/109 con `publisherId`; **0 de 109 obras económicamente elegibles** (`NO_RIGHTS_VERSION`) | GREEN |
| Mediador | catálogo 109 con hash idéntico al previo (`111c38243d5a`); `/access` 200; grupos 200; Aula Viva y Biblioteca; visor PDF sin TTS; derechos, elegibilidad, titulares y altas 403; sin datos contractuales | GREEN |
| Lector | catálogo 89 con hash idéntico al previo (`bfef49de05bd`); my-catalog 89; `/access` 200; visor PDF; caché de archivos igual (portada pública, PDF/TXT `private, no-store`); derechos, elegibilidad, titulares y altas 403; sin datos contractuales | GREEN |
| Anónimo | derechos, elegibilidad, titulares y catálogo 401 | GREEN |

Estado final (16:20Z): api_1 y api_2 healthy, 0 reinicios, `content.json` sin cambios (`9faaf685…`), 0 líneas `[RIGHTS`.

## 5. Incidencias

### 5.1 TTS bajo demanda sin cuota (independiente de F2-A)

- **Evidencia:** api_1, 15:56:47Z y 15:56:51Z, dos `POST /api/tts` → 503 para una sesión de lector. OpenAI: `429 You have no credits remaining`; Gemini (fallback): `429 quota exceeded`; breaker de OpenAI abierto 5 min. Son los únicos 5xx desde el despliegue.
- **Atribución:** `/api/tts` no cambió en F2-A; el cumplimiento está en `off` y no se registró ninguna decisión de derechos. Es el agotamiento de créditos ya documentado en IMM-TTS-03.
- **Alcance:** cualquier lectura que pida TTS bajo demanda (Modo Guiado con voz e Inmersivo en títulos sin audio pregenerado o al reanudar a mitad de chunk). El audio pregenerado y el resto de modos no se ven afectados.
- **Ampliación (2026-10-22 17:00:48Z, api_2):** `POST /api/leo/recap` → 500 para una sesión de administración. Gemini respondió `503 high demand` y el fallback a OpenAI, `429 no credits`. Mientras OpenAI siga sin créditos, **Leo también falla cuando Gemini no está disponible**. Ajeno a F2-A/F2-B (`/api/leo/recap` no se modificó).
- **Recuperación (fuera de esta unidad):** recargar créditos de OpenAI o ampliar la cuota de Gemini; comprobar con una única llamada mínima desde una réplica; confirmar que el breaker se cierra. No se cambiaron proveedores ni credenciales.

### 5.2 Disciplina de despliegue

- **Qué pasó:** api_2 se actualizó en el mismo comando que leyó los logs de api_1, antes de revisar ese resultado. Los logs traían los 2 errores de §5.1; resultaron independientes y no exigían rollback, pero la decisión se tomó después de haber tocado api_2.
- **Requisito obligatorio para futuros despliegues:** la inspección de logs y salud de api_1 (5xx, `[ERROR]`, reinicios) se ejecuta y **se lee** en un paso propio; solo con su resultado revisado y clasificado se lanza el cambio de api_2, en un comando separado. Ningún comando mezcla la verificación de una réplica con la modificación de la siguiente.

## 6. Riesgos que bloquean la activación (no el despliegue)

1. `/api/tts` y `/api/leo/recap` no son atribuibles a una obra.
2. Portadas públicas en caché del edge.
3. Descargas ya presentes en LU no se revocan.
4. La ingesta de Leo necesita una prueba de autorización específica antes de `enforce`.
5. Sin interfaz de administración de derechos hasta F5-A (operación por API).

## 7. Baseline para F2-B

- API: `chibalete/api:royalties-f2a-36cc965` (`49475d4f`) en api_1 y api_2. Front: `royalties-f1a-a3b704d` (`fd45a980`). Override `32d169c9…`.
- `royalties.db`: `0001` + `0002`; `publishers` = 1; `rights_versions` = 0; `RIGHTS_ENFORCEMENT_MODE` ausente (`off`).
- `content.json`: 109 registros, `publisherId = pub-chibalete-editores`, sha `9faaf685…`.
- `access_db.json`: sin cambios desde F1-A; F2-B añadirá `commercialClass`.
- Último respaldo verificado: `structured-20261022T160108Z-997ce8fb`.
- F2-B no iniciada.
