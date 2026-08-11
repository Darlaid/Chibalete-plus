#!/bin/bash
# edge-instance.sh — drena o reincorpora una instancia de API en el edge, sin
# recrear ningun contenedor.
#
#   edge-instance.sh drain  api_1
#   edge-instance.sh rejoin api_1
#   edge-instance.sh status
#
# El cambio se aplica por `mv` ATOMICO dentro del directorio bind-mounted
# `/etc/nginx/dynamic/`, se valida con `nginx -t` ANTES de recargar, y se
# revierte solo si la validacion falla.
#
# Por que no se edita el nginx.conf principal: es un bind mount de FICHERO y su
# inodo queda anclado dentro del contenedor, asi que una sustitucion en el host
# no llega al edge aunque `nginx -t` y `reload` digan que todo fue bien.
# Ver docs/ops/EDGE_RELOADABLE_DRAIN_01.md.
set -uo pipefail

DYN_HOST=${DYN_HOST:-/opt/chibaleteplus/nginx/dynamic}
CONF=upstream-api.conf
EDGE=${EDGE:-chibalete_edge}
KEEPALIVE_WAIT=${KEEPALIVE_WAIT:-65}   # keepalive_timeout del pool: 60 s

die() { echo "ABORT: $*" >&2; exit 1; }

action=${1:-status}
instance=${2:-}

[ -d "$DYN_HOST" ] || die "no existe $DYN_HOST (¿esta desplegado el mount dinamico?)"
[ -f "$DYN_HOST/$CONF" ] || die "no existe $DYN_HOST/$CONF"

show() {
    echo "--- upstream efectivo en el contenedor ---"
    docker exec "$EDGE" sh -c "grep -A6 'upstream chibalete_api_pool' /etc/nginx/dynamic/$CONF" | sed 's/^/  /'
    local h c
    h=$(sha256sum "$DYN_HOST/$CONF" | cut -d' ' -f1)
    c=$(docker exec "$EDGE" sha256sum "/etc/nginx/dynamic/$CONF" | cut -d' ' -f1)
    echo "  sha host      : $h"
    echo "  sha contenedor: $c"
    [ "$h" = "$c" ] || die "host y contenedor divergen: el mount no esta sirviendo el fichero esperado"
    echo "  host == contenedor: SI"
}

case "$action" in
  status) show; exit 0;;
  drain|rejoin) [ -n "$instance" ] || die "falta la instancia (api_1 | api_2)";;
  *) die "accion desconocida: $action (drain | rejoin | status)";;
esac

case "$instance" in api_1|api_2) ;; *) die "instancia invalida: $instance";; esac
TARGET="chibalete_${instance}:3000"

# Nunca dejar el pool sin ningun backend activo.
if [ "$action" = drain ]; then
    activos=$(grep -cE "^\s*server chibalete_api_[12]:3000;\s*$" "$DYN_HOST/$CONF" || true)
    [ "$activos" -ge 2 ] || die "solo queda $activos backend activo; drenar dejaria el pool vacio"
fi

TMP="$DYN_HOST/.${CONF}.new.$$"
BAK="$DYN_HOST/.${CONF}.prev"
cp -a "$DYN_HOST/$CONF" "$BAK"

if [ "$action" = drain ]; then
    sed -E "s#^(\s*)server ${TARGET};\s*\$#\1server ${TARGET} down;#" "$DYN_HOST/$CONF" > "$TMP"
else
    sed -E "s#^(\s*)server ${TARGET} down;\s*\$#\1server ${TARGET};#" "$DYN_HOST/$CONF" > "$TMP"
fi

if cmp -s "$TMP" "$DYN_HOST/$CONF"; then
    rm -f "$TMP"; echo "sin cambios: $instance ya estaba en el estado pedido"; show; exit 0
fi

chmod --reference="$DYN_HOST/$CONF" "$TMP" 2>/dev/null || chmod 0644 "$TMP"
mv -f "$TMP" "$DYN_HOST/$CONF"        # rename atomico: el contenedor ve el inodo nuevo

if ! docker exec "$EDGE" nginx -t >/dev/null 2>&1; then
    echo "nginx -t FALLO; revirtiendo" >&2
    mv -f "$BAK" "$DYN_HOST/$CONF"
    docker exec "$EDGE" nginx -t 2>&1 | tail -2 >&2
    exit 1
fi
docker exec "$EDGE" nginx -s reload >/dev/null 2>&1 || die "reload fallo"
rm -f "$BAK"

echo "$action $instance aplicado; el efecto tarda hasta ${KEEPALIVE_WAIT}s por keepalive"
show
