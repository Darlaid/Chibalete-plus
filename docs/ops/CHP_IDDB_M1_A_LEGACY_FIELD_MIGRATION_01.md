# CHP-IDDB-M1-A-LEGACY-FIELD-MIGRATION-01

Fecha: 2026-08-18 (15:58–16:05Z). Tipo: migración de campo de clientes LU legacy a 0.9.0.
Sin cambios productivos; sin ENFORCE; COMPAT/202-drop/lu_config/APK intactos. Principio: identificar → actualizar → verificar → documentar.

---

## A. Veredicto

**YELLOW-OPERATOR-STEP** — el preflight está GREEN y el mecanismo listo, pero **ningún dispositivo legacy de campo está físicamente accesible desde esta estación**: los equipos pendientes están en manos de usuarios/colegios. La migración de campo es, por naturaleza, una intervención humana. La unidad queda abierta para continuarse en cuanto el operador ejecute (o coordine) las instalaciones listadas abajo.

### Acción humana exacta pendiente (por prioridad del drain)

1. **Dispositivo del lector legacy activo (`user-1781223321961`)** — PRIORIDAD 1 (leyó con cliente legacy el 18/Ago 01h; volvería a romperse bajo ENFORCE):
   - En el dispositivo, abrir en el navegador: `https://chibaleteplus.chibaleteeditores.com/uploads/chibalete-lu-0.9.0.apk`
   - Descargar e instalar **como actualización** (Android pedirá permitir "instalar apps desconocidas" para el navegador si no está habilitado). **NO desinstalar la app existente** — la actualización en sitio conserva libro y progreso (validado en GREEN-DEVICE).
   - Abrir la app: pedirá login una vez (esperado — la versión vieja no guardaba cookie). La credencial la teclea el usuario. El libro y el progreso deben aparecer intactos tras el login.
2. **Cohorte escolar (`user-1779493121246-*`, ≥3 usuarios censados)** — mismo procedimiento, coordinado con la institución.
3. **`user-1774362611303`** y cualquier otro dispositivo LU conocido — mismo procedimiento.
4. Avisar al asistente al completar cada tanda: la verificación remota (versión emitiendo `ChibaleteLU/0.9.0`, requests 2xx, censo) se hace desde aquí con el analizador, sin tocar los dispositivos.

Verificación mínima que el usuario puede hacer en el propio equipo: la app abre, muestra su libro con su progreso, y tras el login funciona normal. Cualquier pérdida de libro/progreso → reportar de inmediato (sería `RED-FIELD-REGRESSION`; no esperada — el upgrade está validado).

## B. Preflight (15:58Z)

| Chequeo | Resultado |
|---|---|
| URL del APK | ✅ descarga HTTPS servida, **sha256 `a9250330…` exacto** (re-verificado hoy) |
| Producción | ✅ `chibalete/api:8ed4e5e` ambas, healthy, restarts 0/0 |
| Modos | ✅ COMPAT/COMPAT |
| 202-drop | ✅ activo (contador =1/instancia, sin incrementos) |
| Dispositivos accesibles | Solo el Xiaomi de QA (`Y965…7LFE`) — ya en 0.9.0/vc10 |
| Tráfico LU nuevo desde el drain | 0 (analizador, ventana 15:49→16:00Z) |

## C. Dispositivos disponibles

Físicamente accesibles ahora: **1** (el de QA, ya migrado). Todos los demás requieren intervención de usuario/colegio.

## D. Migraciones ejecutadas en esta pasada

Ninguna nueva (no había dispositivos de campo conectados). La migración del dispositivo QA quedó ejecutada y verificada en las unidades 01B-A/02.

## E. Verificación mínima

Aplicada al único dispositivo accesible (QA): versión 0.9.0/vc10 confirmada por dumpsys; el resto de la checklist quedó cubierta en GREEN-DEVICE/GREEN-CANARY (sin repetir QA, por principio de la unidad).

## F. Censo final de esta pasada

| Dispositivo/cliente | Clasificación | Evidencia |
|---|---|---|
| Xiaomi QA (`Y965…7LFE`) | **MIGRATED-09** | vc10 verificado hoy; emitió `ChibaleteLU/0.9.0` en producción |
| Dispositivo de `user-1781223321961` | **PENDING-FIELD** (prioridad 1) | tráfico legacy real 18/Ago 01h |
| Dispositivo legacy del 14/Ago 23h | **UNKNOWN** | 1 ping assignment okhttp; no asociable a un usuario sin PII/investigación adicional |
| Cohorte escolar `user-1779493121246-*` (≥3) | **PENDING-FIELD** | censo de la auditoría (analytics históricos); sin tráfico en la ventana reciente |
| `user-1774362611303` | **PENDING-FIELD** | usuario LU histórico (analytics hasta 22/Jul) |
| LEGACY-ACTIVE (post-intento) | n/a | no aplica aún — no hubo intento de migración de campo que haya fallado |

## G. Señal 0.9.0 / legacy

Sin tráfico LU de ningún segmento desde el cierre del drain (15:49→16:00Z, franja corta). 202-drop sin movimiento. Sin 401 anómalos ni 5xx.

## H. Salud productiva

Estado inicial = estado final (no se tocó nada): `8ed4e5e` healthy, restarts 0/0, COMPAT/COMPAT, 202-drop intacto, 0×5xx.

## I. Cambios realizados

Solo este documento. Ningún cambio en VPS, backend, APK, lu_config ni dispositivos.

## J. Límites y pendientes

- La lista PENDING-FIELD depende íntegramente de coordinación humana (colegio/usuarios); no hay update automático ni forma remota de forzarla (por diseño de esta fase).
- El dispositivo del 14/Ago permanece UNKNOWN deliberadamente (no perseguir PII).
- La población legacy real puede exceder el censo conocido; el drain-02 lo medirá.

## K. Próximo paso

**Continuar ESTA unidad** cuando el operador complete las instalaciones de §A (la unidad se re-verifica con el analizador y actualiza el censo a MIGRATED-09). Cuando todos los accesibles estén migrados → `GREEN-FIELD-MIGRATION` → **`CHP-IDDB-M1-A-DRAIN-REDO-WEEKDAY-TRAFFIC-02`** (≥48h hábiles POST-migración, metodología y analizador ya validados). ENFORCE sigue no autorizado.

---

## Anexo — Pasada de corroboración (2026-08-18 16:05–16:20Z, unidad CLOSURE Fase 1)

El operador declaró ejecutadas las instalaciones de campo. Verificación de señal productiva:

- Producción healthy (`8ed4e5e`, restarts 0/0), 0 legacy nuevo, 0×401 anómalos, 0×5xx.
- Tráfico `ChibaleteLU/0.9.0` desde la declaración: 3 requests (2 assignment + 1 analytics, todas 2xx) desde `190.27.x.x` — **consistentes con el dispositivo QA ya migrado** (misma fuente, sin login).
- **Logins 0.9.0 del día: exactamente 1 (el del QA, 14:05Z).** Un dispositivo de campo recién instalado produce necesariamente `POST /api/auth/login` con el UA nuevo desde su propia IP (la versión vieja no tenía cookie que heredar). Vigía adicional de 9 min: **0 logins de campo**.

**Veredicto de la pasada: la declaración NO queda corroborada aún por la señal productiva → el veredicto de la unidad permanece `YELLOW-OPERATOR-STEP`** (regla: nunca asumir GREEN). Intervención humana concreta pendiente, afinada:

> En cada dispositivo de campo ya instalado: **abrir la app Chibalete LU con red y hacer login una vez** (credencial tecleada por el usuario). Eso emite el login + assignment con `ChibaleteLU/0.9.0` que corroboran la migración, y desde ese momento arranca la ventana del drain-02.

Nota de secuencia: aun con corroboración inmediata, `DRAIN-REDO-WEEKDAY-TRAFFIC-02` exige **≥48 horas hábiles POSTERIORES a la migración** — el cierre de M1-A no puede completarse el mismo día de la migración por construcción (cierre más temprano realista: ~20–21/Ago con cobertura escolar).

### Segunda pasada de corroboración (2026-08-18 16:38–16:45Z)

Tras una segunda declaración del operador («los dispositivos fueron abiertos con red y los usuarios hicieron login»), la señal productiva sigue sin corroborarla:

- Apareció actividad 0.9.0 nueva a las 16:36Z (logout 200 → login 200 → assignment/analytics/sync 200) — **pero el padrón la atribuye a `user-1774…1303`, la cuenta del propio dispositivo QA** (único `lastLoginAt` de hoy ≥13:00Z en las 647 cuentas). Los eventos de analytics del día también son todos de esa cuenta.
- **Cero logins de cuentas de campo**: ni `user-1781…1961` (prioridad 1) ni la cohorte escolar registran login hoy.
- Sin regresiones: todo 2xx, 0×401 anómalos, 0×5xx, producción healthy.

**Veredicto: sigue `YELLOW-OPERATOR-STEP`.** La activación observada corresponde al dispositivo ya migrado en QA, no a la tanda de campo. Lo que la evidencia necesita ver: **logins de las CUENTAS de campo** (cada usuario de campo entra con SU credencial en SU dispositivo). Si las instalaciones se hicieron sobre otros equipos pero los usuarios aún no han abierto la app o no han hecho login, esa apertura+login es la intervención pendiente; si por el contrario la activación se probó sobre el mismo dispositivo/cuenta de QA, la migración de campo real sigue sin ejecutarse.

---

## Anexo — Tercera pasada de corroboración (2026-08-19 13:33–13:40Z, `CLOSURE`)

Pasada read-only con ~21 h de ventana nueva (incluye la tarde escolar del 18/Ago y la mañana del 19/Ago). **Cero cambios productivos.**

### Roster de campo — ahora derivado, no declarado

Las pasadas anteriores usaban el censo aproximado («cohorte escolar ≥3»). Esta pasada lo **derivó de la fuente**: cuentas que alguna vez emitieron analytics `source=lu_android` (133 eventos históricos). Resultado: **exactamente 5 cuentas LU**, consistente con el censo de `ANDROID-COOKIE-SESSION-AUDIT-01`. El prefijo `user-1779493121246-*` tiene **180 cuentas en el padrón**, pero sólo **3** de ellas han usado LU jamás — el resto es padrón escolar sin cliente Android, y **no** forma parte del roster de migración.

| # | Cuenta (truncada) | Rol en el censo | Último evento LU | `lastLoginAt` | Estado |
|---|---|---|---|---|---|
| 1 | `user-1774…1303` | dispositivo QA | 2026-08-18 16:02Z | 2026-08-19 13:33Z | **MIGRATED-09 — EXCLUIDA como evidencia de campo** |
| 2 | `user-1781…1961` | PRIORIDAD-1 (lector del incidente ENFORCE) | 2026-06-12 | 2026-08-18 01:18Z | **PENDING-FIELD** |
| 3 | `user-1779…-171` | cohorte escolar | 2026-07-02 | 2026-06-20 | **PENDING-FIELD** |
| 4 | `user-1779…-142` | cohorte escolar | 2026-06-20 | 2026-06-29 | **PENDING-FIELD** |
| 5 | `user-1779…-091` | cohorte escolar | 2026-06-19 | 2026-06-24 | **PENDING-FIELD** |

Fuera de tabla: el ping legacy del **14/Ago 23h** sigue **UNKNOWN** (no asociable a una cuenta sin perseguir PII; decisión mantenida).

### Esperado vs. observado

| Señal que exige el gate | Observado en la ventana |
|---|---|
| Login `ChibaleteLU/0.9.0` de cada cuenta de campo | **0** |
| Petición autenticada posterior de esa sesión | **0** (n/a sin login) |
| Tráfico `ChibaleteLU/0.9.0` de cualquier origen | **0** en 18/Ago 17:07Z → 19/Ago 13:33Z |
| Tráfico legacy `okhttp/*` en endpoints LU | **0** (tampoco hay regresión ni actividad legacy) |

Analizador congelado (`docs/ops/tools/lu_segment_analyzer.py`) sobre el edge log:

- Ventana `2026-08-18T16:00Z → 2026-08-19T13:33Z` (418 líneas): `SEGMENT-09` = 11 requests, **todas concentradas en el bloque 18/Ago 16h** (login 1, assignment 6, analytics 2, progress-sync 1, auth-otros 1 — todas 2xx), UA único `ChibaleteLU/0.9.0 Android/35` = el dispositivo QA.
- Ventana `2026-08-18T17:07Z → 2026-08-19T13:33Z` (405 líneas): **`SEGMENT-09` = 0 y `LEGACY-LU` = 0**. Ningún cliente LU, de ninguna versión, tocó producción en ~20,5 h.

### Exclusiones aplicadas

- **Cuenta/dispositivo QA (`user-1774…1303`)**: excluida por regla. Su `lastLoginAt` de hoy (13:33:19Z) se atribuyó por UA del edge a **`Mozilla/5.0 (Windows NT 10.0…)` — un navegador de escritorio**, no la app: es tráfico web del operador, no señal de campo ni de LU.
- Los 3 logins `SEGMENT-NON-LU` de la ventana son de navegador (web app), fuera del roster LU.
- `SEGMENT-UNKNOWN` = 25 (scanners: `wp-admin` probe, Palo Alto, UA vacío) con **0 requests en endpoints LU** → no contamina, no se reclasifica.
- Sin logins sintéticos, sin smokes técnicos, sin tráfico fabricado: esta unidad no generó ni una petición autenticada.

### 401 / 5xx / comportamiento destructivo

`SEGMENT-09`: **0×401, 0×403, 0×5xx** (el único 401 histórico sigue siendo el ping pre-login del QA del 18/Ago). Sin loop 401, sin `x-user-id` requerido, sin señal destructiva. Los 401/403 de `SEGMENT-NON-LU` (8+2 / 6) son tráfico web ordinario, ajeno a LU.

### Salud productiva — con drift explicado

| Chequeo | 18/Ago (cierre anterior) | 19/Ago 13:33Z | Lectura |
|---|---|---|---|
| Imagen API | `chibalete/api:8ed4e5e` | **`chibalete/api:679b036`** | **drift explicado**: es el deploy `GREEN-LIB-01-PROD` (Biblioteca editorial) del 18/Ago ~19:30Z. Verificado que **`8ed4e5e` es ancestro de `679b036`** → la mitigación 202-drop viaja en la imagen productiva |
| Frontend | — | `chibalete/front:lib01-679b036` (healthy) | mismo deploy |
| Modos | COMPAT/COMPAT | **COMPAT/COMPAT** | sin cambio; ENFORCE sigue desactivado |
| Restarts | 0/0 | **0/0** (edge y front también 0) | estable |
| Health | 200 | **200** | estable |
| APK publicado | sha `a9250330…`, 2.010.794 B | **idéntico** (`a925033054a4846a`, 2.010.794 B, mtime 18/Ago 14:19) | intacto, no reemplazado |

No se emite `STOP-DRIFT`: el cambio de imagen está documentado, es posterior y ajeno a M1-A, preserva la mitigación y no altera modos de sesión. **Efecto colateral a registrar**: el recreate reseteó los contadores in-process del 202-drop → el drain-02 arranca con baseline nuevo.

### Veredicto de la pasada

**`YELLOW-OPERATOR-STEP`** (tercera vez). La brecha ya no es ambigua: en ~21 h **ningún cliente LU de ninguna versión** tocó producción, y **ninguna de las 4 cuentas de campo ha iniciado sesión desde antes de la publicación del canary** (la más reciente, la de prioridad 1, data del 18/Ago 01:18Z — su sesión legacy previa al incidente).

`fieldMigrationCompletedAt` = **no aplica** (sin corroboración, no hay hora que registrar). El sistema **no** es elegible aún para el preflight de `DRAIN-02`.

Nota metodológica: la vigilancia de 15 min prevista para «después de que el operador confirme» no se activó en esta pasada — no hubo declaración nueva del operador, y la ventana observada (21 h) supera con creces cualquier vigía corta.

### Pendiente humano — lista compacta

| Instalación esperada | Estado | Señal faltante |
|---|---|---|
| Dispositivo de `user-1781…1961` (prioridad 1) | PENDING-FIELD | login `ChibaleteLU/0.9.0` + assignment desde su equipo |
| Dispositivo de `user-1779…-171` | PENDING-FIELD | login `ChibaleteLU/0.9.0` + assignment desde su equipo |
| Dispositivo de `user-1779…-142` | PENDING-FIELD | login `ChibaleteLU/0.9.0` + assignment desde su equipo |
| Dispositivo de `user-1779…-091` | PENDING-FIELD | login `ChibaleteLU/0.9.0` + assignment desde su equipo |
| Dispositivo desconocido del 14/Ago 23h | UNKNOWN | no perseguible sin PII; el drain-02 lo medirá por agregado |

Instrucción al operador, por dispositivo (sin capturas, sin credenciales compartidas):

1. Confirmar que el equipo tiene Chibalete LU **0.9.0** instalada desde `https://chibaleteplus.chibaleteeditores.com/uploads/chibalete-lu-0.9.0.apk` (actualización en sitio, **jamás desinstalar**).
2. Conectar el dispositivo a internet.
3. Abrir la aplicación.
4. Iniciar sesión normalmente si la app lo pide (la credencial la teclea el usuario).
5. Abrir el libro asignado y esperar a que cargue.
6. Informar la hora aproximada de la acción.

Si un equipo ya conserva sesión válida y no pide login, **no** forzar logout: basta con abrir la app y el libro con red — el `GET /api/offline/assignment` con UA `ChibaleteLU/0.9.0` es señal equivalente admitida por este gate (el propio canario se corroboró así tras la reinstalación).

### Próximo paso

Repetir esta unidad cuando haya declaración nueva del operador. Con `GREEN-FIELD-MIGRATION` → `CHP-IDDB-M1-A-DRAIN-02-PREFLIGHT-AND-T0` (≥48 h hábiles POSTERIORES a la migración). Dado que hoy es miércoles 19/Ago y aún no hay T0, el cierre realista de M1-A se desplaza a **~21–24/Ago**. ENFORCE sigue sin autorizar.
