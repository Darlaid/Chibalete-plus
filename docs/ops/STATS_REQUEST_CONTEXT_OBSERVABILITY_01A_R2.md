# Telemetría del request context — CHP-STATS-LEGACY-PERF-OBS-01A-R2

**Estado:** implementado y validado **en local**. No desplegado.
**Rama:** `chp/stats-request-context-observability-01a` (desde `4c407af`).
**Producción al cierre:** `chibalete/api:4c407af`, flag `off` en ambas API.

---

## 1. Por qué esta ruta existe

El canary productivo del request context (`CHP-STATS-LEGACY-PERF-01H`) se
detuvo porque **no había forma de observar el ciclo de vida de los contextos**
desde fuera del proceso. Los ocho contadores existían, pero sus únicos
consumidores eran tres archivos de test: ningún endpoint los publicaba.

Sin esa señal, el gate central del canary —«contextos creados = liberados,
activos a cero»— no era verificable, y su condición `CONTEXT LEAK` no tenía
instrumento capaz de dispararse.

## 2. Por qué NO se amplió `/api/system/metrics`

Porque **no es admin-only**, pese a su middleware `requireAdminAccess`.

`requireAdminAccess` desvía todos los `GET` a `allowAuthenticatedGetOrReject`,
que concede paso a cualquier principal autenticado. Verificado con dobles
sintéticos sobre la factoría real:

| Petición | Resultado |
|---|---|
| `GET` sin cabeceras | 401 |
| `GET` con `x-user-id` de **lector** | **200** |
| `GET` con `x-user-id` de **mediador** | **200** |
| `GET` con `x-user-id` de administrador | 200 |
| `GET` con `x-user-id` inexistente | 401 |
| `POST` con `x-user-id` de lector | 401 |
| `POST` con `x-user-id` de administrador | 200 |

No es un defecto oculto: el fix P0 de 2026-05 cerró el bypass **anónimo** y
conservó a propósito el acceso autenticado sin rol, porque el preflight
`GET /api/content/:id/access` que usa todo visor depende de ello. `server.js` lo
documenta, incluido el residual de IDOR de lectura entre usuarios autenticados.

Publicar ahí la telemetría del proceso la habría dejado legible para cualquier
cuenta de estudiante. No es PII, pero sí superficie de reconocimiento sobre el
tamaño y la actividad de la instalación.

**Esta unidad no cambia esa autorización.** El endurecimiento de los 16 `GET`
afectados es deuda registrada aparte: `CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01`.

## 3. Por qué no se acepta el rol desde `x-user-id`

`x-user-id` es una cabecera que el cliente controla por completo. Resolver un
rol a partir de ella sirve para *identificar* en un modelo de confianza interno,
no para *autorizar* una superficie operacional. Una ruta que expone el estado
del proceso debe exigir una credencial que el cliente no pueda fabricar.

## 4. La ruta

```
GET /api/admin/system/metrics/request-context
```

Autorización: **exclusivamente el ADMIN_SECRET canónico file-only**.

Respuesta 200:

```json
{
  "ok": true,
  "metricsRequestContext": {
    "enabled": false,
    "scope": "process",
    "createdTotal": 0,
    "disposedTotal": 0,
    "active": 0,
    "progressUsersIndexedTotal": 0,
    "eventUsersIndexedTotal": 0,
    "memoHitsTotal": 0,
    "memoMissesTotal": 0,
    "legacyFallbackCallsTotal": 0,
    "studentComputationsTotal": 0,
    "buildDurationMsTotal": 0
  }
}
```

`Cache-Control: no-store`. Sin escrituras, sin abrir stores, sin crear contexto y
sin alterar ningún contador —verificado comparando el snapshot antes y después
de consultarla—.

**No la usa el frontend** y no debe añadirse a navegación, UI ni SDK público.

## 5. El middleware

`server/lib/operationalAdminAuth.js` → `requireOperationalAdminSecret`.

- Reutiliza el lector file-only auditado (`readAdminSecret`), que abre con
  `O_NOFOLLOW`, valida uid/gid, modo `0400`, `nlink` y tamaño desde el
  descriptor ya abierto (sin TOCTOU), zeroiza el buffer y **nunca consulta
  `process.env`**.
- Compara sobre digests SHA-256 con `timingSafeEqual`. Hashear ambos lados evita
  que `timingSafeEqual` lance por longitudes distintas, lo cual filtraría la
  longitud del secreto.
- Ignora por completo `x-user-id`, `x-role`, cookies, query y body.
- Sin candidato en la cabecera **no toca el disco**: la ruta no es un probe del
  filesystem.
- Falla cerrado y con la **misma** respuesta `401 {"error":"No autorizado"}` ante
  cabecera ausente, secreto incorrecto o archivo canónico inválido. Cualquier
  detalle adicional sería un oráculo.

No modifica el gateway compartido `headerMatchesAdminSecret`, que conserva su
comparación `===` documentada (SEC-08 quedó fuera de su alcance).

## 6. Los ocho contadores reales

| Campo publicado | Contador de origen | Semántica |
|---|---|---|
| `createdTotal` | `metrics_request_context_created_total` | contextos creados |
| `disposedTotal` | `metrics_request_context_disposed_total` | contextos liberados |
| `progressUsersIndexedTotal` | `metrics_request_context_progress_records_indexed` | **usuarios** con progreso indexados |
| `eventUsersIndexedTotal` | `metrics_request_context_events_indexed` | **usuarios** con eventos indexados |
| `memoHitsTotal` | `metrics_student_memo_hits_total` | reutilizaciones dentro de una petición |
| `memoMissesTotal` | `metrics_student_memo_misses_total` | cálculos de alumno **con** contexto |
| `legacyFallbackCallsTotal` | `metrics_legacy_fallback_calls_total` | cálculos de alumno **sin** contexto |
| `buildDurationMsTotal` | `metrics_request_context_build_duration_ms` | coste **acumulado** de construcción |

**Nombres históricos engañosos, traducidos aquí:** `progress_records_indexed`
cuenta usuarios, no registros (es `progressByUser.size`); `events_indexed` igual;
`build_duration_ms` es un acumulado del proceso, no la duración de la última
petición.

## 7. Los dos campos derivados

```
active                   = max(0, createdTotal - disposedTotal)
studentComputationsTotal = memoMissesTotal + legacyFallbackCallsTotal
```

`active` es fiable porque `dispose()` va siempre en un `finally`, es idempotente
(`if (this.disposed) return;`) y solo lo invoca quien creó el contexto: un
contexto recibido del llamador no se libera dos veces. El clamp es defensivo —un
negativo indicaría un bug, no un estado observable—.

Los *hits* **no** se suman a los cálculos: son reutilizaciones dentro de la misma
petición, y sumarlos inflaría la cifra.

## 8. Lo que deliberadamente NO se expone

`generationGuardFailuresTotal` y `contextErrorsTotal` **no existen**. La guarda
`assertUsable()` lanza si el contexto está liberado o si `generation` cambió tras
un `init()` posterior, pero **no cuenta**. Instrumentarla sería modificar lógica
productiva, fuera del alcance de esta unidad. Publicar un cero fijo sería peor
que no publicarlo: parecería una señal.

**No existe ningún reset**, ni por HTTP ni exportado. Los contadores solo vuelven
a cero al reiniciar el proceso.

## 9. Alcance y lectura desde un canary

Los contadores son **de proceso**:

- no se agregan entre `api_1` y `api_2`: cada instancia responde lo suyo;
- vuelven a cero al **recrear el contenedor**, que es exactamente lo que ocurre
  al cambiar el flag;
- todos son monotónicos **salvo `active`**.

Uso previsto en el canary de una sola API:

1. tras recrear `api_1` con el flag `on`, leer el snapshot → línea base;
2. ejecutar el bloque de medición;
3. releer: `createdTotal` debe haber subido en las rutas de clase A y B, y
   **no** en las de clase C;
4. tras 60 s sin sondas, `active` debe ser 0 y `createdTotal = disposedTotal`;
5. `api_2` con el flag `off` debe mostrar `enabled:false` y `createdTotal:0`.

**RSS no sustituye esto.** La memoria residente es ruidosa —GC, caché de V8,
buffers de audio— y un contexto retenido pesa poco frente a ese ruido. `active`
responde a la pregunta exacta: *¿quedó algún contexto vivo sin petición?*

## 10. Privacidad

El snapshot son doce campos: un booleano, una constante de alcance y diez
enteros no negativos. Sin identificadores, sin instituciones, sin grupos, sin
rutas, sin timestamps, sin cabeceras y sin secretos. Verificado por test sobre la
serialización completa.

## 11. Límites conocidos

- **No mide latencia por ruta.** El canary la mide desde el cliente.
- **`buildDurationMsTotal` es acumulado**: para obtener un promedio hay que
  dividir entre `createdTotal`, y no es un percentil.
- **La resolución de `Date.now()` es de milisegundos**: construcciones muy
  rápidas pueden acumular 0.
- **No hay ventana temporal**: los contadores cubren desde el arranque del
  proceso. Un canary debe trabajar con diferencias entre dos lecturas.
- **La comparación del gateway compartido sigue siendo `===`**. Esta ruta usa
  tiempo constante, pero las demás rutas administrativas no cambian.

## 12. Verificación

```bash
npm run test:request-context-telemetry   # 87 aserciones
```

Incluido en el job bloqueante `identity-preflight`. Sin red: el middleware se
ejercita con un lector inyectado y la ruta con un servidor efímero en
`127.0.0.1`.
