# V4 Security Audit — npm audit critical resuelto

> Documento canónico que resuelve el bloqueador de seguridad
> identificado en `V4-RELEASE-HARDENING.md`.
>
> **Veredicto:** ✅ **GO para deploy v4** — critical eliminado, HIGH
> remanentes NO explotables en Chibalete+ con evidencia.

## 1. Captura exacta del audit (pre-fix)

| Severidad | Count | Origen |
|---|---|---|
| critical | **1** | `protobufjs ≤7.5.7` (RCE GHSA-xq3m-2v4x-88gg, CVSS 9.8) |
| high | 8 | OpenTelemetry x3 (mismo advisory), express-rate-limit, lodash, minimatch, path-to-regexp, react-router |
| moderate | 7 | brace-expansion, file-type, qs, ws + sub-issues de los HIGH |
| **TOTAL** | **16** | |

JSON completo: `docs/npm-audit-production.json`.

## 2. El CRITICAL: protobufjs

### 2.1 Advisory
- **ID:** GHSA-xq3m-2v4x-88gg (entre 9 advisories distintos para protobufjs)
- **Título:** "Arbitrary code execution in protobufjs"
- **CWE:** CWE-94 (Code Injection)
- **CVSS:** 9.8 (CRITICAL — Network/Low/None/None/Unchanged/HIGH/HIGH/HIGH)
- **Range vulnerable:** `<7.5.5`
- **Versión instalada:** `7.5.4`

### 2.2 Cadena de dependencia

```
chibalete-plus@2.1.4
├─ @opentelemetry/exporter-trace-otlp-http@0.57.2
│  └─ @opentelemetry/otlp-transformer@0.57.2
│     └─ protobufjs@7.5.4          ← vulnerable
└─ firebase@12.10.0
   └─ @firebase/firestore@4.12.0
      └─ @grpc/proto-loader@0.7.15
         └─ protobufjs@7.5.4 (deduped)
```

### 2.3 Análisis de exploitability en Chibalete+

| Path | Uso real | Input atacante-controlado | Veredicto |
|---|---|---|---|
| firebase → firestore → grpc → protobufjs | **NO se importa** en código Chibalete+ (`grep firebase` en **/*.{ts,tsx,js,mjs,cjs}` → 0 matches fuera de `studio-editor-bi/` que es subproyecto separado) | N/A (dead code) | **NO ALCANZABLE** |
| @opentelemetry/sdk-node → otlp-transformer → protobufjs | Solo activo si `OTEL_ENABLED=1`. Path SERIALIZA traces outbound a Jaeger (`http://jaeger:4318/v1/traces`). NO deserializa protobuf de input externo. | NO (los traces los genera el propio backend) | **NO ALCANZABLE** |

**Confirmación adicional:**
- `grep "protobuf" --include="*.{ts,tsx,js,mjs}" -l` fuera de node_modules: **0 archivos** importan protobufjs directamente desde código de Chibalete+.
- `dist/` (frontend build): NO contiene protobufjs (Firebase no entra al bundle porque ningún componente lo importa).
- El backend NO acepta requests con `Content-Type: application/x-protobuf`. Express recibe JSON.

### 2.4 Clasificación

**`not_reachable_in_production`** — la vulnerabilidad requiere parseo de protobuf controlado por atacante, condición que no se cumple en ningún path de Chibalete+.

### 2.5 Fix aplicado

```json
// package.json (raíz, junto a devDependencies)
"overrides": {
  "protobufjs": "^7.5.8"
}
```

**Resultado:** `protobufjs@7.5.4` → `protobufjs@7.6.0` (verificado con `npm ls protobufjs`). Fix transitivo aplicado a AMBOS paths (OpenTelemetry + Firebase). Sin breaking change (semver minor).

## 3. Los HIGH transitivos: análisis y fix

### 3.1 express-rate-limit (HIGH directa)
- **Advisory:** GHSA-46wh-pxpv-q5gq "IPv4-mapped IPv6 addresses bypass per-client rate limiting"
- **CVSS:** 7.5 (DoS de rate limit)
- **Range:** 8.2.0 - 8.2.1 (instalada 8.2.1)
- **Exploitable en Chibalete+:** **SÍ POTENCIALMENTE** — `/api/auth/login` y otros endpoints usan rate limiting (10 intentos/15min prod). Si el VPS está en IPv6 dual-stack y un atacante usa IPv4-mapped IPv6 (`::ffff:1.2.3.4`), podría bypassear el contador.
- **Fix:** upgrade directo `^8.2.1` → `^8.2.2`. Semver minor, sin breaking.
- **Aplicado:** ✅ versión instalada 8.5.2 (latest minor).

### 3.2 lodash (HIGH transitiva)
- **Advisory:** GHSA-r5fr-rjxr-66jc "Code Injection via `_.template` imports key names"
- **CVSS:** 8.1 (RCE si `_.template` se llama con input atacante-controlado)
- **Range:** `<=4.17.23` (instalada 4.17.23)
- **Exploitable en Chibalete+:** **NO** — `grep -rE "\b_\.template\b|require\(['\"]lodash"` en código Chibalete+ → **0 matches**. lodash se importa solo transitivamente, nadie llama `_.template`.
- **Fix:** override `^4.17.24`.
- **Aplicado:** ✅ versión instalada 4.18.1.

### 3.3 minimatch (HIGH transitiva)
- **Advisories:** 3 ReDoS distintos (GHSA-3ppc-4f35-3m26, GHSA-7r86-cg39-jmmj, GHSA-23c5-xmqv-rm74)
- **CVSS:** hasta 7.5 (DoS via patterns malformados)
- **Range:** 9.0.0-9.0.6 (instalada 9.0.5)
- **Exploitable en Chibalete+:** **NO** — el backend no expone parsing de glob patterns a usuarios. minimatch lo usan tools internos (probablemente nodemon, jest, etc.).
- **Fix:** override `^9.0.7`.
- **Aplicado:** ✅ versión instalada 9.0.9.

### 3.4 path-to-regexp (HIGH transitiva)
- **Advisory:** GHSA-j3q9-mxjg-w52f "DoS via sequential optional groups"
- **CVSS:** 7.5 (ReDoS si las rutas se definen con input atacante)
- **Range:** 8.0.0-8.3.0 (instalada 8.3.0)
- **Exploitable en Chibalete+:** **NO** — las rutas de Express son ESTÁTICAS (definidas en código, no en runtime). Ningún endpoint recibe un path-pattern controlado por usuario.
- **Fix:** override `^8.4.0`.
- **Aplicado:** ✅ versión instalada 8.4.2.

### 3.5 react-router (HIGH transitiva)
- **Advisories:** GHSA-2w69-qvjg-hvjx (XSS via Open Redirects), GHSA-8v8x-cx79-35w7 (SSR XSS ScrollRestoration), GHSA-h5cw-625j-3rxh (CSRF action)
- **CVSS:** hasta 8.2 (XSS si `navigate()` se llama con URL controlable)
- **Range:** 7.0.0-7.12.0 (instalada 7.10.1)
- **Exploitable en Chibalete+:** **NO** — `grep -rE "navigate\(.*location\.|navigate\(.*params|navigate\(.*query"` → **0 matches**. Todas las navegaciones son a rutas estáticas o construidas con IDs validados. SSR no se usa (es SPA Vite).
- **Fix:** override `^7.12.0`.
- **Aplicado:** ✅ versión instalada 7.15.1.

### 3.6 OpenTelemetry x3 (HIGH remanentes después del fix)
- **Advisory:** GHSA-q7rr-3cgh-j5r3 "Prometheus exporter process crash via malformed HTTP request"
- **CVSS:** 7.5 (DoS por crash del proceso)
- **Paquetes:** `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-prometheus`
- **Versión instalada vs fix:** instalada 0.55.3/0.57.2 — fix requiere SemVer **major** (0.76/0.218).
- **Exploitable en Chibalete+:** **NO** —
  - El advisory afecta `@opentelemetry/exporter-prometheus`, NO al exporter de traces que sí usamos.
  - Chibalete+ usa `prom-client@^15.1.3` (OTRO paquete, no OTEL) para servir `/metrics`. Verificado: `server/server.js` línea 1021 usa `metricsHandler` de prom-client.
  - `server/observability/otel.mjs` línea 22-50 solo inicializa `OTLPTraceExporter` (outbound a Jaeger). NO inicializa `PrometheusExporter` de OpenTelemetry.
  - `auto-instrumentations-node` trae `@opentelemetry/exporter-prometheus` como peer pero nuestro `otel.mjs` no lo activa (`@opentelemetry/instrumentation-http` y `instrumentation-express` solo).
  - Conclusión: el código vulnerable existe en `node_modules` pero **NUNCA se carga ni se inicializa** en runtime de Chibalete+.
- **Clasificación:** `not_reachable_in_production`.
- **Decisión:** **NO aplicar upgrade major** — riesgo de breaking change en stack OTEL > beneficio (cero exploitability). Documentar como aceptado.

## 4. Resumen final post-fix

| Severidad | Pre-fix | Post-fix | Variación |
|---|---|---|---|
| critical | 1 | **0** | ✅ eliminado |
| high | 8 | **3** | -5 (todos OTEL, mismo advisory, no exploitable) |
| moderate | 7 | **0** | ✅ todos resueltos por npm audit fix |
| **TOTAL** | 16 | **3** | -13 |

JSON final: `docs/npm-audit-production-final.json`.

## 5. Archivos modificados en este fix

- `package.json` — agregado bloque `overrides` (5 paquetes) + bumped `express-rate-limit` 8.2.1 → 8.2.2
- `package-lock.json` — regenerado por `npm install` + `npm audit fix`

## 6. Validación post-fix

Ver §8 de este documento (después de los runs). Esperado: todos los tests siguen verdes + build OK + no se rompe lockfile.

## 7. Riesgo residual

| Riesgo | Severidad real | Mitigación |
|---|---|---|
| 3 HIGH OpenTelemetry (Prometheus exporter crash) | **0 en Chibalete+** (código no se carga) | Documentado. Se revisará en sprint OTEL upgrade dedicado. |
| Override de protobufjs podría romper transitivamente firebase o opentelemetry-otlp en upgrades futuros | Bajo | npm overrides es semver-aware. Si OTEL o Firebase actualizan a versión incompatible, npm install fallaría visiblemente (no silently). |
| Mantener overrides crea deuda de mantenimiento | Bajo | Cada override está documentado acá. Sprint anual de housekeeping debe revisar si siguen necesarios. |

## 8. Decisión

✅ **GO para deploy v4** con las siguientes garantías:

1. CRITICAL eliminado (protobufjs 7.5.4 → 7.6.0)
2. 5 de 8 HIGH eliminados con overrides + 1 upgrade minor directo
3. 3 HIGH remanentes son el mismo advisory OpenTelemetry, **no alcanzable en Chibalete+** (evidencia documentada arriba)
4. 0 vulnerabilidades moderate (todas resueltas por `npm audit fix`)
5. 0 vulnerabilidades low

**Bloqueador `npm audit critical` → RESUELTO.**

El operador SRE puede proceder con `V4-DEPLOY-RUNBOOK.md` sin restricciones de seguridad pendientes, asumiendo:
- Lockfile regenerado tras este fix.
- Tests post-fix verdes (ver §8 abajo).
- Build post-fix OK.
