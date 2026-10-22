# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-A en producción (evidencia de cierre)

**Fecha:** 2026-10-22 (UTC) · **Commit:** `a3b704d4de5fe1730bfc05ec1336f5a403c08a26` · **Plan:** `PLAN_GENERAL_V1_1.md` (sin cambios)
**Veredicto:** GREEN

## 1. Preflight y seguridad

- Rama `chp/epub-mainfile-r1-release`, HEAD = origin = `a3b704d`; delta runtime frente a producción limitado a `server/royalties/`, `server/db/migrate.js`, `server/server.js` (+91 líneas, solo añadidos), un script npm y tres archivos de front (`SubirContenido.tsx`, `dataService.ts`, `types/index.ts`). Lockfile, Dockerfile e imagen base sin cambios.
- Baseline previo: API `immersive-retention-9c00d1c` (`5bde24a6`), front `contentprotect-final-cbc8e2d` (`7265576a`).
- Vulnerabilidades críticas/altas conocidas (OSV sobre el lockfile de `a3b704d`) evaluadas contra `/api/admin/publishers`, con evidencia de código:
  - `proxy-addr` (crítica, confianza por subred): Express usa `trust proxy: 1` (función `i < 1`, sin parseo de direcciones); `req.ip` solo alimenta logs y rate-limit.
  - Autenticación: con `SESSION_AUTH_MODE=enforce`, `requireAdminAccess` resuelve identidad por cookie firmada o admin-secret file-only; los GET exigen además `requireAdminRead` (administrador de plataforma).
  - SQL parametrizado; columnas en lista blanca (`ALLOWED`).
  - `multer`, `brace-expansion`: DoS fuera de estas rutas. `@grpc/grpc-js`: solo cliente. `react-router` RSC: no usado (`HashRouter`). Imagen base con el mismo digest que producción.
  - Clasificación: **NO EXPLOTABLE** para el alcance de F1-A.

## 2. Despliegue

| Paso | Hora (UTC) | Resultado |
|---|---|---|
| Respaldo previo | 13:32 | `structured-20261022T133203Z-f461597d` (31 stores) |
| api_1 → `royalties-f1a-a3b704d` (`0800e27c`) | 13:38 | healthy; `0001_publishers` aplicada; anónimos 401 |
| api_2 → misma imagen | 13:51 | healthy; migración no reaplicada |
| `stores.py` (`0224aa51`) + respaldo | 13:54 | `structured-20261022T135440Z-0c567573` (32 stores); restauración de `royalties.db` con sha igual al manifiesto e `integrity_check` ok |
| front → `royalties-f1a-a3b704d` (`fd45a980`) | 13:56 | healthy; edge recargado |

- Integridad de transferencia: sha256 de los tarballs verificado en el VPS; IDs de imagen idénticos en local y en el VPS.
- Entorno y mounts de las réplicas idénticos a los previos.
- Rollback preparado (no usado): tags `rollback-pre-f1a`, copia del override y `stores.py` previo en `/root/chp-f1a/`.

## 3. Almacén económico

- `data-critical/royalties.db`: `integrity_check` ok, WAL, `_migrations` = `0001_publishers` (una fila), `publishers` = 1 (`pub-chibalete-editores`, activo).
- Incluido en el respaldo estructurado como CANON no reconstructible.

## 4. Asignación editorial

Autorizada expresamente para los 109 registros del catálogo, de cualquier tipo. Es responsabilidad editorial **administrativa**: no acredita titularidad autoral ni elegibilidad económica, que se resuelven en F2-A.

- Censo previo: 109 registros `disponible`, ninguno con `publisherId`. Por tipo: 43 libro (10 son capítulos MOOK hijos), 9 libro_album, 23 articulo_pedagogico, 17 podcast, 10 guia, 5 video, 2 contexto_pedagogico.
- Mecanismo: script de uso único en un contenedor efímero de la imagen desplegada; toma `withFileLock(content.json, 'contentLock')` (el mismo lock que las réplicas), relee el archivo dentro del lock, escribe con tmp + rename como `writeJSON`, aborta ante un `publisherId` distinto. No se usó `POST /api/content` para no ejecutar `applyContentTextVersion`, defaults ni TTS.
- Dry-run: 109 cambios, 0 conflictos; serialización idéntica byte a byte a la de `writeJSON`.
- Respaldo previo: `structured-20261022T140943Z-fac019c9` (snapshot `039673d4`).
- Aplicación (14:10:07Z): `content.json` `d8cf6abd…` → `9faaf685…`, 109 cambios. Segunda ejecución: 0 cambios.
- Verificación independiente: mismos ids y orden, 109/109 con `pub-chibalete-editores`, **0 diferencias en cualquier otro campo**; uploads (3398 archivos), resto de `data/` y `data-critical/` sin cambios.
- Respaldo posterior: `structured-20261022T141411Z-f568fe9c` (snapshot `da584455`); `content.json` restaurado con sha `9faaf685…`.

## 5. Smoke funcional

| Actor | Comprobaciones | Resultado |
|---|---|---|
| Administrador | `/api/admin/publishers` 200 + `no-store` (6/6); catálogo 109 con 109 `publisherId`; Subir contenidos → Editar «La metamorfosis» muestra «Chibalete Editores» preseleccionado; salida sin guardar (0 escrituras, `content.json` sin cambios) | GREEN |
| Mediador | titulares 403 (GET/POST); catálogo consistente entre réplicas; `/access` 200; grupos 200; Aula Viva, Biblioteca; seis modos: PDF, Guiado, Inmersivo (manifest completo, sin reproducir, 0 llamadas a TTS), Álbum, Audio, Vídeo | GREEN |
| Lector | catálogo 89 (mismo universo que antes), `/access` 200 en ambas réplicas; titulares 403 (lista y detalle); visor PDF operativo; el catálogo solo expone `publisherId` (id), sin razón social, NIT, contactos ni datos económicos | GREEN |

Estado final (14:22Z): api_1, api_2 y front healthy con `royalties-f1a-a3b704d`, 0 reinicios; desde 13:38Z 0 respuestas 5xx, 0 `[ERROR]`, 0 llamadas a TTS.

## 6. Deuda independiente (no intervenida)

- CI `content-rmw`: intermitencia preexistente en el gate de réplicas (en `a3b704d` pasó al reintento).
- CI `security`: fallos históricos (evidence-hardening, osv, trivy fs, gitleaks-history, trivy-image) presentes desde antes de F1-A; propuesta SEC-DEPS-02.
- `/#/admin/metricas` (página legacy fuera del menú): «Error 401 al cargar colegios»; `legacyMetricsSchoolsHandler` resuelve el usuario sin la sesión de cookie. Preexistente, sin relación con F1-A.

## 7. Baseline para F2-A

- API y front: `royalties-f1a-a3b704d` (api `0800e27c`, front `fd45a980`).
- `royalties.db`: `publishers` con `pub-chibalete-editores`; sin `rights_versions`.
- `content.json`: 109 registros, todos con `publisherId = pub-chibalete-editores`, sha `9faaf685…`.
- `stores.py` de producción: `0224aa51…` (32 stores).
- Último respaldo verificado: `structured-20261022T141411Z-f568fe9c`.
- F2-A no iniciada.
