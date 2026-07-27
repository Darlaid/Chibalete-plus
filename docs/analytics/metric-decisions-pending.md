# Decisiones de métricas — APROBADAS

**Unidad:** CHP-METRICS-CONTRACT-01A → **aprobadas en 01B** · `HUMAN_APPROVED`

**D1–D10 quedaron aprobadas.** El motor de referencia (contrato v2) las
implementa. Se conserva el razonamiento original —opciones, impacto y riesgo—
porque documenta *por qué* se decidió así.

---

### D1 · Definición de «entrada»

- **A** — cada `*.session_start` emitido.
- **B** — cada sesión reconstruida por ventana de inactividad.

**Recomendación: B.** El 32 % de las sesiones nunca cierra y varios emisores no
emiten `session_start`; contar el evento subcuenta y depende del visor.
**Impacto:** Villas 99 entradas (B) frente a un recuento por evento que además
varía por modo. **Riesgo de B:** dos visitas separadas por menos del idle se
funden en una.

### D2 · Estrategia de sesión

- **A** — límites explícitos (`session_start` … `session_end`).
- **B** — ventana de inactividad.

**Recomendación: B como principal, A como fallback cuando existan ambos extremos.**
**Impacto:** A produce 264 sesiones con máximos de 50 h (pestañas abandonadas);
B produce 172 con p99 de 119 min. **Riesgo:** B no distingue "leyendo" de
"pestaña abierta"; por eso el tiempo se acota (D5).

### D3 · Umbral de inactividad

- **A** — 5 min · **B** — 15 min · **C** — 30 min.

**Recomendación: B (15 min).** **Impacto en Villas:** 128 / **99** / 92 sesiones
y 25,2 / **22,8** / 20,6 h. La curva se aplana tras 15 min, así que 30 min añade
poco y arriesga fundir visitas distintas. **Riesgo:** una lectura pausada larga
se parte en dos con 5 min.

### D4 · «Lector activo»

- **A** — ≥1 evento en el periodo.
- **B** — ≥1 sesión con duración > 0.
- **C** — ≥1 evento de lectura (excluye telemetría y sistema).

**Recomendación: C.** Hoy el 30 % del volumen son eventos de sistema
(`chunk_audio_*`, `pb_*`), que no prueban que alguien leyera. **Impacto:** con A,
Villas tiene 37 activos; con C bajará y hay que medirlo antes de publicarlo.
**Riesgo:** C es más estricto y hará caer los números frente al histórico.

### D5 · Tiempo en plataforma

- **A** — Σ duraciones de sesión sin tope.
- **B** — Σ duraciones acotadas a 4 h por sesión.

**Recomendación: B.** **Impacto:** 2 sesiones de Villas se acotan hoy; sin tope,
una sola de 50 h dominaría el total. **Riesgo:** subestima maratones legítimas;
por eso el motor declara `CAPPED_SESSIONS_n` en `reason`.

### D6 · Tiempo de lectura

- **A** — igualarlo al tiempo en plataforma.
- **B** — dejarlo `NOT_DEFINED` hasta definir "lectura efectiva".

**Recomendación: B.** No existe evidencia en el evento de si el usuario leía o
tenía la pestaña abierta. **Impacto:** la tarjeta "tiempo de lectura" no se puede
publicar todavía. **Riesgo de A:** publicar como lectura un tiempo que no lo es.

### D7 · Periodo por defecto

- **A** — todo el histórico · **B** — últimos 30 días · **C** — curso académico.

**Recomendación: B**, declarado siempre en la respuesta. **Impacto:** el
histórico va de 2026-05-08 a 2026-07-25; con 30 días muchas cifras caen.
**Riesgo:** comparar entre periodos distintos sin verlo.

### D8 · Eventos no atribuibles

- **A** — excluirlos silenciosamente.
- **B** — excluirlos de las métricas institucionales **y publicarlos en buckets**.
- **C** — repartirlos.

**Recomendación: B.** C es inaceptable: inventa atribución. **Impacto:** 2.753
eventos (14,1 % del total) quedan fuera de las cifras institucionales pero
visibles. **Riesgo:** que alguien lea "16.712" como si fuera el total.

### D9 · Instituciones sin actividad

- **A** — ocultarlas · **B** — mostrarlas con `NO_ACTIVITY` · **C** — mostrarlas con 0.

**Recomendación: B.** Nuevo Bosque tiene 90 lectores y cero actividad medida:
ocultarla esconde el hecho más accionable del sistema. **Riesgo de C:** se
confunde con "sin datos".

### D10 · Lenguaje de «Sin datos» y «Sin actividad»

- **A** — un único "Sin datos".
- **B** — dos etiquetas: «Sin actividad registrada» (cero medido) y «Sin datos
  suficientes» (no medible), más «Pendiente de cálculo» para `NOT_MATERIALIZED`.

**Recomendación: B.** Es la traducción visible de la regla vinculante *cero solo
significa cero medido*. **Riesgo:** más texto en pantalla; se compensa con el
tooltip de cobertura.

---

## Decisión transversal sugerida

Publicar **siempre** el par *(valor, cobertura)*. «37 lectores activos» sin
«de 90» es una media verdad, y en Nuevo Bosque la cobertura del 0 % es
precisamente la señal que hay que ver.

---

## Resoluciones aprobadas (CHP-METRICS-CONTRACT-01B)

| Decisión | Resolución |
|---|---|
| D1 · Entrada | inicio de una sesión reconstruida |
| D2 · Sesión | ventana de inactividad + `session_end` cierra antes + `session_start` abre si no hay activa; `session_id` no es autoridad; un evento de sistema no abre sesión |
| D3 · Umbral | **15 min** |
| D4 · Actividad y lectura | **se divide en dos métricas** (ver abajo) |
| D5 · Tiempo en plataforma | `min(última − primera actividad atribuible, 4 h)`; `elapsed_ms` solo corrobora; `cappedSessions` en `reason` |
| D6 · Tiempo de lectura | **`NOT_DEFINED`**, sin estimación ni reetiquetado |
| D7 · Periodo | últimos 30 días por defecto, configurable, siempre declarado |
| D8 · No atribuibles | fuera de las métricas institucionales, visibles en los seis buckets |
| D9 · Sin actividad | `status=NO_ACTIVITY`, `value=0`, `measured=true`; no se ocultan |
| D10 · Estados visibles | etiquetas fijadas en `STATUS_LABEL` |

### D4 se divide en dos métricas — no es una sola

| Métrica | Definición | Denominador |
|---|---|---|
| `usersWithActivity` | usuario registrado con ≥1 evento atribuible **no sistémico** | `registeredUsers` |
| `activeReaders` | **lector elegible** con ≥1 evento `READING_ACTIVITY` | `eligibleReaders` |

Estar presente no es leer. Medido en producción sobre Villas: **37 usuarios con
actividad frente a 21 lectores activos**. Publicar una sola cifra habría inflado
la lectura en un 76 %.

### Corrección de vocabulario poblacional

«Registrados» **ya no** significa «miembros de grupos». Son cinco poblaciones
distintas y el motor las reporta por separado:

| Término | Significado |
|---|---|
| `registeredUsers` | pertenecen a la organización, por `organizationId` declarado **o** por pertenencia a uno de sus grupos. **No depende de que existan eventos.** |
| `registeredReaders` | los anteriores con rol lector — se reporta el conteo real, no se asume que todos lo sean |
| `eligibleReaders` | lectores registrados en ≥1 grupo `ACTIVE_REAL` de esa organización — **denominador de cobertura** |
| `usersWithActivity` | registrados con actividad no sistémica |
| `activeReaders` | elegibles con lectura |

Efecto de la corrección en producción: FilBo pasa de mostrarse con **44** a
**46 registrados** (los 2 sin grupo se reportan aparte) y Externado de **0** a
**2**.
