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
