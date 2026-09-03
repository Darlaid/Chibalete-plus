# CHP-IDENTITY-FIELD-PUBLIC-DOWNLOAD-PAGE-DEPLOY-01

Fecha: 2026-09-03. Tipo: **evidencia de despliegue productivo, frontend-only**. Carril A de
`CHP-ROADMAP-2026-05`.

Cierra la cadena `01B` (implementación) → `01C` (preflight read-only) → **`01D` (deploy)** →
`01E` (este registro documental).

```text
GREEN-PUBLIC-LU-PAGE-DEPLOYED
```

La página pública de descarga de Chibalete LU está en producción. Es la primera URL de la plataforma
que se abre **sin sesión**.

---

## 1. Qué se desplegó

```text
Commit desplegado:  9842238e3f5817b4790b4147913a0465f54223d1
Rama:               chp/mook-contract-00
Imagen construida:  chibalete/front:lupub-9842238
Image ID observado: fe2109339ff8
Bundle:             index-C0uh9tGy.js  →  index-CtsJKdMt.js
```

El commit toca **tres archivos que entran en la imagen** —`App.tsx`, `config/routePermissions.ts` y
`pages/ChibaleteLU.tsx`— más documentación de `docs/ops/` (excluida por `.dockerignore`) y un test
`.mjs` que el bundler no importa. Cero `server/`, cero dependencias, cero cambios de datos.

El cambio funcional es doble y mínimo: la ruta pasa de `access: 'authenticated'` a `access: 'public'`
en `routePermissions.ts`, y en `App.tsx` deja de envolverse en `<Layout>` —que monta Navbar y
Chatbot— para renderizarse aislada. Autenticados y anónimos ven exactamente la misma página.

## 2. Integridad de la cadena build → producción

El build se hizo **en la máquina del operador** desde el commit fijado, con el árbol *tracked*
limpio, y se transfirió como artefacto:

```text
docker build --pull -f Dockerfile.front -t chibalete/front:lupub-9842238 .
docker save | gzip  →  artefacto de 22 MB
sha256 local == sha256 remoto           (verificado antes del load)
docker load en el VPS
Image ID local == Image ID remoto == fe2109339ff8
```

La coincidencia de Image ID entre el build local y el daemon del VPS es la prueba de que la imagen
que corre es **la misma que se construyó desde `9842238`**, no una reconstrucción equivalente. El
VPS no construye: no hay checkout Git del frontend en producción y no debe haberlo.

Gates verificados **sobre la imagen, antes de transferirla**:

```text
imagen contiene  {path:"/chibalete-lu",access:"public"}      OK
control negativo /biblioteca, /soporte, /clubs = authenticated  OK
```

## 3. Único cambio de configuración productiva

```text
/opt/chibaleteplus/docker-compose.override.yml:108
    image: chibalete/front:ret-162c3e6
  → image: chibalete/front:lupub-9842238
```

**Una sola línea.** El `diff` contra el backup confirmó `108c108` y nada más. La configuración
mergeada resuelta antes de aplicar mostró que sólo cambiaba `front`:

```text
chibalete/api:e70c0f1      (sin cambio)
nginx:alpine               (sin cambio)
chibalete/front:lupub-9842238   (nuevo)
chibalete/api:e70c0f1      (sin cambio)
```

Producción está gobernada por `docker-compose.override.yml`, que `docker compose` auto-mergea sobre
el `docker-compose.yml` base. El archivo base declara valores obsoletos y **no** es el punto de
cambio. Ver la deuda 1 de §7.

### Alcance de la recreación

```text
docker compose up -d --no-deps front
```

Se recreó **únicamente `front`**. El backend `chibalete/api:e70c0f1` permaneció intacto en ambas
réplicas: `/api/health` devolvió el mismo `commit` (`2945fa8`), la misma `instance` y un `uptime`
continuo de siete días antes y después. `api_1` y `api_2` conservaron su antigüedad de proceso.

El **edge no se recreó**. Sólo se ejecutaron `nginx -t` y `nginx -s reload`.

### Por qué el reload del edge era obligatorio

El edge define un upstream **estático**:

```nginx
upstream chibalete_front_upstream {
  server chibalete_front:80;
  keepalive 32;
}
```

nginx resuelve ese nombre **una sola vez, al cargar la configuración**. Recrear el contenedor le
asigna una IP nueva en `chibalete_net`, de modo que sin el reload el edge seguiría apuntando a una
dirección muerta y respondería 502. El bloque `resolver` presente en la configuración no rescata
upstreams estáticos. El reload no es una formalidad del runbook: es la condición para que el deploy
sea visible.

La invalidación de caché, en cambio, es automática: `location /` y `location = /index.html`
responden `Cache-Control: no-store`, y `/assets/` es `immutable` sobre nombres con hash de
contenido. El primer `GET /` posterior al reload ya entrega el `index.html` que referencia el bundle
nuevo.

## 4. Comprobaciones productivas

### Verificadas por HTTP

```text
GET /                        200
bundle servido               index-CtsJKdMt.js        (antes index-C0uh9tGy.js)
bundle trae                  {path:"/chibalete-lu",access:"public"}
control negativo             /biblioteca, /soporte, /clubs siguen "authenticated"
GET /api/health              200, commit 2945fa8, instancia y uptime sin cambio
GET /api/lu/version          200 anónimo, version 0.9.0
HEAD /uploads/…-0.9.0.apk    200 anónimo, 2 010 794 bytes
```

### Verificadas en navegador, sin sesión

`curl` **no puede probar** el comportamiento de `#/chibalete-lu`: el fragmento no se envía al
servidor y la ruta la resuelve el router en el cliente. Estas comprobaciones se hicieron en un
navegador sin sesión iniciada:

```text
https://chibaleteplus.chibaleteeditores.com/#/chibalete-lu

acceso anónimo               la URL NO redirige — la página carga
versión mostrada             0.9.0
botón «Descargar para Android»  presente y operativo
aislamiento                  sin Navbar, sin Chatbot
instrucciones                actualización sobre instalación existente y primera instalación
control negativo             /#/biblioteca sigue redirigiendo a /#/bienvenida
```

El baseline previo al deploy, medido en el mismo navegador sin sesión, era el contrario:
`/#/chibalete-lu` redirigía a `/#/bienvenida`.

### Salud posterior

```text
chibalete_edge     healthy   RestartCount=0   nginx:alpine
chibalete_front    healthy   RestartCount=0   chibalete/front:lupub-9842238
chibalete_api_1    healthy   RestartCount=0   chibalete/api:e70c0f1
chibalete_api_2    healthy   RestartCount=0   chibalete/api:e70c0f1

logs frontend      sin errores
logs edge          sin 5xx
espacio VPS        44 GB libres (59 % usado)
```

El único `warn` del edge en la ventana es un aviso de *buffering* a archivo temporal del bundle de
412 KB. Es comportamiento normal de nginx, no un fallo.

## 5. Rollback vigente

```text
chibalete/front:ret-162c3e6                     → c5c9883efb31
chibalete/front:rollback-20260903-ret-162c3e6   → c5c9883efb31   (alias fijado al Image ID)
/opt/chibaleteplus/docker-compose.override.yml.bak-pre-lupub-20260903T221256Z
```

El alias se creó **antes** de construir nada, para que el punto de retorno no dependiera de que
nadie reetiquetase `ret-162c3e6`. Ambos tags apuntan al mismo Image ID.

Procedimiento de vuelta atrás, ≤2 minutos: restaurar el backup del override →
`docker compose up -d --no-deps front` → `nginx -t` y `nginx -s reload`. **No reconstruye código
antiguo** (la imagen ya está en el daemon) y **no toca datos persistentes**: los seis bind mounts del
frontend son todos de sólo lectura y de propiedad del host.

### Nota sobre el registro en `deploys.log`

La primera entrada escrita en `/root/deploys.log` dejó truncado el nombre del backup del override
(`override .bak-pre-lupub-`, sin el sello temporal), porque la variable se expandió en el shell local
en lugar del remoto. Se corrigió con una **segunda entrada append-only** que nombra el archivo real,
siguiendo la convención ya usada en la entrada del 28 de agosto. El backup existe y fue verificado
por contenido antes del cambio; **el despliegue no se vio afectado**. Se registra aquí por
trazabilidad, no como incidente.

## 6. Qué significa —y qué no— para la migración de campo

Lo que este despliegue **sí** aporta: existe por fin una **URL pública, estable y anónima** a la que
una campaña externa puede apuntar. Era uno de los bloqueantes declarados en
`CHP_IDENTITY_FIELD_UPDATE_CAMPAIGN_01.md` §12.

Lo que **no** aporta, y no debe deducirse en ningún reporte derivado:

```text
publicar la página  !=  notificar a ningún dispositivo
publicar la página  !=  descargar
publicar la página  !=  instalar
publicar la página  !=  migrar
```

Ningún APK del parque tiene receptor: no hay FCM, worker ni receiver, y `forceUpdate` sólo pinta un
banner en la web. **Publicar esta página no alcanza por sí sola a ningún equipo `0.7.1` ni `0.8.0`.**
La migración sigue dependiendo de una campaña externa vía institución, que **no está autorizada**.

Invariantes que este despliegue **no** modifica:

```text
180        = cuentas escolares, no equipos
T0         = no definido
drain      = no iniciado
ENFORCE    = prohibido
campaña    = no iniciada
```

## 7. Deudas registradas, no resueltas

Ninguna de estas afecta el veredicto GREEN del despliegue. Se registran para unidades separadas.

1. **Los runbooks apuntan al archivo compose equivocado.** `deployment_guide.md` §11-F4 y §14, y
   `docs/sprint022-frontend-deploy.md` §4.2, indican editar el `image:` de
   `/opt/chibaleteplus/docker-compose.yml`. Producción está gobernada por
   `docker-compose.override.yml`. Seguir el runbook literalmente produciría un **deploy fantasma**:
   el `sed` no encontraría el tag antiguo en el archivo base, el override seguiría fijando la imagen
   anterior, y el contenedor se recrearía con código viejo mientras el registro diría que todo salió
   bien. Es un fallo silencioso, no ruidoso. Es al menos el quinto despliegue consecutivo que va por
   el override.

2. **`pages/__tests__/ChibaleteLUPublic.structural.test.mjs` no está conectado.** Pasa **84/84** en
   local, pero no figura en ningún script de `package.json` ni en `.github/`: CI no lo ejecuta nunca.
   El gate que sí cubrió este commit fue `image-integrity`, que construye `Dockerfile.front` como
   paso bloqueante.

3. **El artefacto de transferencia permanece en `/tmp` del VPS** (22 MB). No se limpió en la unidad
   de despliegue y no se limpia aquí.

Observación sobre el alcance real de la edición: `CHP_IDENTITY_FIELD_UPDATE_CAMPAIGN_01.md` §13
afirmaba, en la **misma frase** que exigía verificar la URL, que el gate `0.7.1` seguía abierto —algo
que §5 del mismo documento declara **RESUELTO** desde el 2026-08-29—. Era una frase heredada de antes
de esa actualización. Al reescribir §13 para retirar el pendiente de URL, esa afirmación caduca
quedó eliminada con ella; no era separable sin dejar el documento contradiciéndose a sí mismo. Es el
único cambio de esta unidad que va más allá de la URL, y se registra explícitamente aquí.

## 8. Límites de esta unidad

Este documento es **posterior** al despliegue y sólo registra evidencia ya conservada. No se
ejecutaron SSH, HTTP, Docker, builds ni deploys para escribirlo. No se corrigieron runbooks, CI,
código, tests ni workflows. No se tocaron `data/`, `data-critical/`, uploads ni recursos editoriales.
No contiene IP, credenciales, cookies, tokens ni rutas temporales de la máquina del operador.

## 9. Único siguiente paso

Corregir los runbooks productivos que todavía apuntan al archivo compose equivocado —deuda 1 de
§7—, en una unidad separada. No es la campaña: la campaña sigue sin autorizar.
