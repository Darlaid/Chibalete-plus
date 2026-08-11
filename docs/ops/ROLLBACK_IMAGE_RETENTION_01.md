# CHP-OPS-ROLLBACK-IMAGE-RETENTION-01 — Proteger las imágenes de rollback del prune automático

**Cambio:** quitar `-a` de la limpieza automática de imágenes Docker.

**Motivo:** con `-a`, esa tarea borró la imagen de rollback del despliegue vivo.

---

## 1. El incidente

El **2026-08-11 a las 00:45 UTC**, `/etc/cron.d/docker-image-prune` ejecutó:

```
docker image prune -af --filter "until=24h"
```

y eliminó **`chibalete/api:2945fa8`**, que era la imagen de rollback del
despliegue en producción.

`docker image prune -a` elimina *«all unused images, not just dangling ones»*.
Y ahí está la trampa: **una imagen deja de estar "in use" en el instante en que
el último contenedor que la referenciaba pasa a otra versión**. Es decir, la
imagen N-1 se vuelve elegible justo cuando se despliega N, y con
`--filter until=24h` desaparece al día siguiente, en silencio.

Por eso sobrevivieron imágenes mucho más antiguas —`chibalete/front` de siete
semanas, las de Studio BI, el stack de observabilidad—: **todas están en uso**.
La única que se perdió fue precisamente la que hacía falta para volver atrás.

### El artefacto está perdido

`chibalete/api:2945fa8` **no se puede recuperar**. Reconstruir desde el mismo
commit produce un artefacto **distinto**: cambian capas base, timestamps y
dependencias resueltas en el momento del build. Un rebuild **no es** el mismo
artefacto inmutable y no debe presentarse como equivalente.

```
2945fa8 exact rollback artifact = LOST
```

La imagen que debe preservarse como rollback del próximo despliegue es
**`chibalete/api:7a44d8f`**.

## 2. Política

**La limpieza automática PUEDE eliminar:**
- imágenes *dangling* (sin etiqueta) que superen el filtro de antigüedad;
- residuo de build sin etiquetar.

**La limpieza automática NO PUEDE eliminar:**
- imágenes en uso por un contenedor;
- imágenes etiquetadas de producción;
- el rollback N-1 etiquetado;
- cualquier imagen preservada explícitamente.

**Prohibido como tarea automática**, y verificado por
`ops/maintenance/__tests__/prunePolicy.test.mjs`:

| Prohibido | Por qué |
|---|---|
| `docker image prune -a` / `--all` | borra imágenes etiquetadas sin usar — el caso del incidente |
| `docker system prune` | arrastra contenedores, redes y, con `--volumes`, datos |
| `--volumes` en cualquier forma | nunca automático |

**Política adoptada:**

```
45 0 * * * root docker image prune -f --filter "until=24h" > /dev/null 2>&1
```

Verificado contra Docker **29.4.1**, cuya ayuda confirma la semántica:
`-a, --all  Remove all unused images, not just dangling ones`. Sin `-a`, el
alcance queda en imágenes dangling y **toda imagen etiquetada sobrevive**.

Nota de expectativa: hoy el sistema tiene **0 imágenes dangling y 0 bytes
reclamables** en imágenes, así que esta tarea recuperará poco o nada. Su valor
es de higiene, no de espacio. El consumo real está en el **build cache**
(≈8,5 GB reclamables), que es una unidad de lifecycle aparte.

## 3. Tag de rollback

Además del tag inmutable por commit se mantiene un alias operacional:

```bash
docker tag chibalete/api:<commit> chibalete/api:rollback-current
```

- **No sustituye** al tag por commit, que sigue siendo la referencia inmutable.
- **No implica rebuild**: es otra referencia al mismo ImageID.
- Sirve para que un rollback de urgencia no dependa de recordar el SHA anterior.

Estado actual: `chibalete/api:7a44d8f` y `chibalete/api:rollback-current`
apuntan ambas a `sha256:368306d3…`, el mismo ImageID que corren `api_1` y
`api_2`.

## 4. Procedimiento N / N-1 en cada despliegue

Al desplegar una versión nueva:

1. antes de recrear contenedores, comprobar que el tag por commit **saliente**
   sigue presente;
2. mover `rollback-current` al commit **saliente** (el que queda como N-1):
   `docker tag chibalete/api:<commit-saliente> chibalete/api:rollback-current`;
3. desplegar N;
4. verificar que N-1 conserva su tag por commit **y** el alias.

Mientras una imagen tenga etiqueta, el prune ya no la toca.

## 5. Verificación

```bash
# la tarea instalada no puede llevar -a ni system prune
cat /etc/cron.d/docker-image-prune
node ops/maintenance/__tests__/prunePolicy.test.mjs

# current y rollback apuntan al mismo ImageID que los contenedores
docker image inspect chibalete/api:rollback-current --format '{{.Id}}'
docker inspect -f '{{.Image}}' chibalete_api_1 chibalete_api_2
```

## 6. Fuera de alcance

No se resuelven aquí, y merecen una unidad de lifecycle propia: retención de
varias releases, límite de disco, limpieza de `*-candidate` antiguos, purga del
build cache y limpieza manual histórica.

## 7. Deuda declarada

El fichero `ops/maintenance/docker-image-prune` es ahora la fuente de verdad
versionada, pero **la instalación sigue siendo manual**: copiarlo a
`/etc/cron.d/docker-image-prune` con modo `0644 root:root`. No hay ningún job de
CI que ejecute `prunePolicy.test.mjs`, así que la guarda protege solo si alguien
la corre. Ambas cosas son mejorables en una unidad posterior.
