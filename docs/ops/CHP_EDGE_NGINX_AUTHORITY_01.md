# CHP-EDGE-NGINX-AUTHORITY-01A — Autoridad versionada del edge

Veredicto: `GREEN-EDGE-NGINX-BASELINE-TRACKED-AND-PUBLISHED`.
Fecha: 2026-09-05 (UTC).
Alcance: versionar, byte a byte, la configuración que ya gobierna el edge.
Cero cambios productivos: no se editó, recargó ni recreó nada.

---

## 1. Rutas

| Rol | Ruta |
|---|---|
| Producción (host) | `/opt/chibaleteplus/nginx/nginx.conf` |
| Producción (contenedor) | `/etc/nginx/nginx.conf` |
| Repositorio | `ops/edge/nginx.conf` |

## 2. Igualdad byte a byte

| Origen | SHA-256 | Bytes |
|---|---|---:|
| Host de producción | `543beec6a413d0769ea95cf17d26b38474c8fb1342e9311dfcfc70c70ece72ef` | 8353 |
| Dentro del contenedor `chibalete_edge` | `543beec6…72ef` | 8353 |
| Working tree `ops/edge/nginx.conf` | `543beec6…72ef` | 8353 |
| Blob Git (`git show :ops/edge/nginx.conf`) | `543beec6…72ef` | 8353 |

230 líneas, terminación LF exclusivamente (0 bytes CR), termina en salto de
línea, 36 bytes no ASCII procedentes de los comentarios en español. Modo del
archivo en el host: `644`, propietario `root`.

El archivo se transportó codificado en base64 y se escribió en binario, de modo
que ninguna capa intermedia pudo reinterpretar saltos de línea.

## 3. Evidencia del bind mount

```text
/opt/chibaleteplus/nginx/nginx.conf -> /etc/nginx/nginx.conf  ro=true  type=bind
```

Es un bind mount de **fichero**, no de directorio. Su inodo queda anclado dentro
del contenedor: sustituir el fichero en el host de forma atómica cambia el inodo
y el edge sigue leyendo la versión anterior, mientras `nginx -t` y el reload
responden con éxito. Esa es exactamente la trampa que documenta
`ops/edge/dynamic/upstream-api.conf`, y la razón por la que el pool de upstreams
se movió a `/etc/nginx/dynamic/`, que sí es un bind mount de directorio.

## 4. Validación

`docker exec chibalete_edge nginx -t` sobre la configuración vigente:

```text
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Dos avisos preexistentes de `ssl_stapling` sin respondedor OCSP en el
certificado de `studio.chibaleteeditores.com`. No los introduce esta unidad y no
se corrigen aquí.

El bloque que sirve los archivos sigue intacto y es el mismo en el archivo
versionado, en la línea 162:

```nginx
location ^~ /uploads/ {
  alias /var/uploads/;
  access_log off;
  expires 30d;
  add_header Cache-Control "public, max-age=2592000, immutable";
  add_header X-Content-Type-Options "nosniff";
}
```

Estado del edge tras la unidad: `healthy`, `RestartCount = 0`, arrancado el
2026-08-11, tres semanas de uptime sin cambio.

## 5. Gate de secretos

El archivo no contiene material sensible en línea. Comprobado sin imprimir su
contenido: cero bloques de clave privada, cero certificados embebidos, cero
`auth_basic`, cero literales de contraseña, token o admin secret, cero
`Set-Cookie`, cero cabeceras `Authorization` con valor literal y cero cadenas
base64 largas.

Lo que sí contiene, y que esta unidad considera versionable:

- nombres de dominio y de contenedor;
- rutas a certificados en `/etc/letsencrypt/live/…` y a
  `/etc/nginx/ssl/ticket.key`, que son referencias, no material;
- `include /etc/nginx/dynamic/*.conf` y `include /etc/nginx/mime.types`;
- los resolvers públicos `1.1.1.1` y `8.8.8.8`.

## 6. `nginx.prod.conf` no es la configuración productiva

El repositorio ya contenía dos configuraciones de nginx. Ninguna corresponde al
edge desplegado:

| Archivo | `/uploads/` | Topología |
|---|---|---|
| `nginx.conf` (raíz) | `proxy_pass http://host.docker.internal:3000` | dev local, alias `/chibaleteplus/` |
| `nginx.prod.conf` | `proxy_pass http://api` | upstream único `api`, solo puerto 80 |
| `ops/edge/nginx.conf` (este) | `alias /var/uploads/` | `chibalete_api_pool`, `chibalete_front_upstream`, `studio_bi_upstream`, TLS y HTTP/3 |

La divergencia importa: quien leyera `nginx.prod.conf` concluiría que los
archivos de `/uploads/` pasan por la API y pueden autorizarse con un middleware
de Express. En producción no es así: nginx los sirve desde disco y la aplicación
nunca ve la petición. Esta unidad no modifica `nginx.prod.conf`.

## 7. Deuda documental no corregida

Varios runbooks ordenan editar `/opt/chibaleteplus/nginx/nginx.conf` a mano en
el host, entre ellos `docs/m3/CDN-RUNBOOK.md`. Quedan como deuda documental: no
se tocan en esta unidad. A partir de ahora la fuente de verdad es
`ops/edge/nginx.conf`, y cualquier cambio debería nacer ahí.

## 8. Procedimiento de despliegue futuro

Esta unidad **solo documenta** el procedimiento. No lo ejecuta.

```text
Un reemplazo atómico del archivo host cambia el inodo y no es visible
para el contenedor actual. Por tanto, el deploy futuro deberá:

1. validar el candidato antes del swap;
2. respaldar el archivo host;
3. reemplazarlo de forma controlada;
4. recrear únicamente el contenedor edge;
5. validar health y rutas;
6. restaurar el backup y recrear edge ante fallo.
```

El paso 4 es el que cierra la trampa del inodo: un `reload` no basta, hace falta
recrear el contenedor para que vuelva a resolver la ruta del bind mount.

## 9. Salto de línea: cuidado al desplegar desde Windows

Este repositorio tiene `core.autocrlf = true` y `.gitattributes` solo fija
`eol=lf` para `*.sh`. Para `ops/edge/nginx.conf` los atributos quedan sin
especificar, así que Git avisa de que en un futuro checkout sobre Windows
materializará CRLF en el working tree.

Consecuencia práctica: **el blob es la autoridad, no el working tree en
Windows**. Un despliegue futuro debe tomar los bytes del blob, por ejemplo con
`git show <rev>:ops/edge/nginx.conf`, o de un checkout en Linux. Un archivo con
CRLF dejaría de ser byte-idéntico al que hoy corre en producción.

Fijar una regla de `.gitattributes` para `*.conf` es la corrección limpia. Esta
unidad tiene prohibido modificar `.gitattributes`, así que queda anotado para
una unidad posterior.
