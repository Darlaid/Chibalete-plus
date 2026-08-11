# CHP-EDGE-DRAIN-01 — Configuración recargable del edge y drain por instancia

**Problema:** cambiar la configuración del edge no funcionaba, y lo hacía en
silencio. **Solución:** mover la parte que necesita cambiar a un directorio
bind-mounted.

---

## 1. La causa raíz

`chibalete_edge` monta su configuración como **bind mount de fichero único**:

```yaml
volumes:
  - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
```

Un bind mount de fichero **ancla el inodo**. Cuando se sustituye el fichero en
el host —y casi cualquier forma de escribirlo crea un inodo nuevo: `sed -i`,
`mv`, muchos editores— el contenedor **sigue leyendo el inodo viejo**.

Lo peligroso es que todo parece correcto:

```
docker exec chibalete_edge nginx -t   →  syntax ok
docker exec chibalete_edge nginx -s reload  →  rc=0, workers nuevos
```

Ambos operan sobre el fichero antiguo. Medido el 2026-08-11: host inode
`4194764` con el cambio, contenedor inode `4194763` sin él y con mtime del
**2026-06-25**. Un intento de drenar `api_1` pasó todas las comprobaciones y
`api_1` siguió sirviendo **20 de 40** peticiones diecisiete minutos después.

Esto afecta a **cualquier** cambio del edge —upstreams, rate limits, cabeceras,
TLS—, no solo al drain.

## 2. La solución

La configuración principal sigue siendo un fichero (estable, cambia poco). La
parte que necesita cambiar en caliente se mueve a un **directorio**:

```yaml
volumes:
  - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
  - ./nginx/dynamic:/etc/nginx/dynamic:ro      # ← nuevo
```

En `nginx.conf`, el bloque `upstream chibalete_api_pool { ... }` se sustituye
por:

```nginx
include /etc/nginx/dynamic/*.conf;
```

y su contenido pasa a `nginx/dynamic/upstream-api.conf`.

**Por qué un directorio sí funciona:** el mount de directorio no ancla inodos de
los ficheros que contiene; cada ruta se resuelve al abrirla. Un `mv` atómico
dentro del directorio produce un inodo nuevo que el contenedor **sí** ve.

**Por qué `/etc/nginx/dynamic` y no `conf.d`:** `conf.d` ya existe en la imagen
`nginx:alpine` con un `default.conf`. Montar encima lo enmascararía. `dynamic`
no existe en la imagen, así que no tapa nada. (Dato: `nginx.conf` **no** incluye
`conf.d`, así que ese `default.conf` nunca se cargó.)

**Por qué solo el pool de API:** `chibalete_front_upstream` y
`studio_bi_upstream` se quedan en el fichero principal. Delta mínimo y riesgo
cero para Studio Editor BI, que comparte este edge.

## 3. Prueba aislada

Reproducido con la misma imagen y el mismo tipo de mount, con dos backends
dummy, red interna y sin puertos publicados:

| Fase | Reparto | Evidencia |
|---|---|---|
| Inicial | `b1=10 b2=10` | ambos en el pool |
| Drain (`b1 down`) | **`b1=0 b2=20`** | inode host `566498 → 566499`; el contenedor ve **el mismo inodo nuevo** y el mismo sha |
| Rejoin | `b1=10 b2=10` | comportamiento restaurado |

`nginx -t` correcto en ambas transiciones. Es el contraste exacto con el mount
de fichero, donde host y contenedor divergen de inodo.

## 4. Operación

```bash
ops/edge/edge-instance.sh status
ops/edge/edge-instance.sh drain  api_1
ops/edge/edge-instance.sh rejoin api_1
```

El script:

- edita por `mv` **atómico** dentro del directorio dinámico;
- valida con `nginx -t` **antes** de recargar y **revierte** si falla;
- se niega a drenar si dejaría el pool sin backends activos;
- comprueba que el sha del host y el del contenedor coinciden, que es la
  verificación que faltaba en el modelo anterior.

**El efecto tarda hasta 60 s.** El pool declara `keepalive 64` con
`keepalive_timeout 60s`, así que los workers siguen sirviendo conexiones
persistentes ya establecidas tras la recarga. Verificar antes de ese plazo da un
falso negativo.

## 5. Cómo verificar el enrutado

Usar `GET /api/health`, que devuelve `"instance"` con el id del contenedor y
**está exento del rate limiter** (`skip` explícito en `server.js`).

**No usar logins fallidos**: el `loginLimiter` es **por instancia** (10 por
ventana de 15 min en producción), así que una sonda de 20 intentos agota ambos
limitadores y las siguientes mediciones dan un falso negativo — parece drenado
cuando en realidad todo devuelve 429.

## 6. Verificación obligatoria tras cualquier cambio del edge

`nginx -t` **no es suficiente**. Siempre:

```bash
diff <(sha256sum /opt/chibaleteplus/nginx/nginx.conf | cut -d' ' -f1) \
     <(docker exec chibalete_edge sha256sum /etc/nginx/nginx.conf | cut -d' ' -f1)
docker exec chibalete_edge nginx -T | grep -A6 'upstream chibalete_api_pool'
```

## 7. Rollback

Revertir el volumen del compose, restaurar el `nginx.conf` con el bloque
`upstream` en línea, borrar `nginx/dynamic/` y recrear el edge. El backup previo
vive en `/root/chp-edge-drain-01/rollback/`.

## 8. Deuda declarada

**La configuración productiva del edge no está versionada.** El `nginx.conf`
real (dos vhosts, HTTP/3, certificado SAN compartido) y el `docker-compose.yml`
de producción viven solo en `/opt/chibaleteplus/` del VPS. Lo que hay en el repo
—`nginx.conf`, `nginx.prod.conf`, `docker-compose.yml`— es material de
desarrollo y está divergido.

Consecuencia: para el edge **no se puede exigir «definición repo = definición
desplegada»**, y el rollback depende de los backups del VPS. Este documento y
`ops/edge/` versionan el patrón y la operativa, no la configuración completa.
Importarla es una unidad aparte.
