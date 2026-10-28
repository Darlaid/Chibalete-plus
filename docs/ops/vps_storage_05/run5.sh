#!/usr/bin/env bash
# VPS-STORAGE-05 — aplica la retención (vigente + rollback inmediato) en lotes de máx. 4 imágenes.
# Se ejecuta en el VPS. Se detiene ante el primer fallo de verificación previa o posterior.
set -uo pipefail
D=/root/chp-vps-storage-05; cd $D
PROT_IDS="0dc5fc1e0f50 a00873c4b087 423251d0b5c2 d8ba20851d7d 9141cfb4fa96 c6a863981aae 0d4caccfde60 33bf9feb1c93 ab70b5a4e2cc 4803eae87d6f"
SHA0=$(sha256sum /opt/chibaleteplus/docker-compose.override.yml /opt/chibaleteplus/docker-compose.yml | cut -c1-64 | tr '\n' ' ')
TAR0=$(ls /root/chp-*/*.tar.gz | wc -l)
docker exec -i -w /app chibalete_api_2 node - < /root/chp-edinf01/snapshot.cjs > snap0.json || { echo "STOP: snapshot inicial"; exit 1; }
present_all=$(docker images --no-trunc -q | cut -c8-19 | sort -u)
awk -F'\t' '$4==0{print $1}' inventario.tsv | while read i; do echo "$present_all" | grep -q "^$i$" && echo $i; done > cola.txt
n=${N0:-0}
while read -r -u 3 a && { read -r -u 3 b; read -r -u 3 c; read -r -u 3 d; true; }; do
  n=$((n+1)); L=$D/lote$n.log; S=$(date -u +%FT%TZ)
  echo "== lote $n $S" | tee $L
  docker exec -i -w /app chibalete_api_2 node - < /root/chp-edinf01/snapshot.cjs > snapB.json || { echo "STOP: snapshot previo" | tee -a $L; exit 1; }
  ids="$a ${b:-} ${c:-} ${d:-}"; b=; c=; d=
  for i in $ids; do
    python3 recheck5.py $i >> $L || { echo "STOP: verificación previa fallida $i" | tee -a $L; tail -1 $L; exit 1; }
  done
  echo "antes $(df --output=avail,pcent -B1 / | tail -1)" | tee -a $L
  for i in $ids; do
    B=$(df --output=avail -B1 / | tail -1)
    for t in $(docker images --no-trunc --format '{{.ID}} {{.Repository}}:{{.Tag}}' | awk -v i=$i 'substr($1,8,12)==i{print $2}'); do
      echo "$(date -u +%FT%TZ) docker rmi $t" >> $L
      docker rmi "$t" >> $L 2>&1 || { echo "STOP: docker rmi falló $t" | tee -a $L; exit 1; }
    done
    A=$(df --output=avail -B1 / | tail -1)
    docker image inspect $i >/dev/null 2>&1 && { echo "STOP: $i sigue presente" | tee -a $L; exit 1; }
    echo "   $i retirada delta $(( (A-B)/1048576 )) MiB" | tee -a $L
  done
  echo "despues $(df --output=avail,pcent -B1 / | tail -1)" | tee -a $L
  # Validación posterior del lote
  up=$(docker ps --format '{{.Status}}' | grep -c Up)
  rs=$(docker inspect -f '{{.RestartCount}}' $(docker ps -q) | awk '{s+=$1} END{print s}')
  hl=$(docker inspect -f '{{.Name}} {{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' chibalete_api_1 chibalete_api_2 chibalete_front chibalete_edge studio_bi_api | grep -vc ' healthy$')
  rd=0; for c in chibalete_api_1 chibalete_api_2; do docker exec $c sh -c 'wget -qO- http://127.0.0.1:3000/api/health/ready' | grep -q '"status":"ready"' && rd=$((rd+1)); done
  flags=$(for c in chibalete_api_1 chibalete_api_2; do docker exec $c sh -c 'echo "[$ECONOMIC_INGEST_MODE][$RIGHTS_ENFORCEMENT_MODE]"'; done | tr '\n' ' ')
  er=$(( $(docker logs --since $S chibalete_api_1 2>&1 | grep -c '\[ERROR\]') + $(docker logs --since $S chibalete_api_2 2>&1 | grep -c '\[ERROR\]') ))
  x5=$(docker logs --since $S chibalete_edge 2>&1 | grep -cE '" 5[0-9][0-9] ')
  miss=0; present=$(docker images --no-trunc -q | cut -c8-19 | sort -u); for p in $PROT_IDS; do echo "$present" | grep -q "^$p$" || miss=$((miss+1)); done
  sha=$(sha256sum /opt/chibaleteplus/docker-compose.override.yml /opt/chibaleteplus/docker-compose.yml | cut -c1-64 | tr '\n' ' ')
  tars=$(ls /root/chp-*/*.tar.gz | wc -l)
  docker exec -i -w /app chibalete_api_2 node - < /root/chp-edinf01/snapshot.cjs > snap.json
  dat=$(python3 -c "import json;print(json.load(open('snap.json'))==json.load(open('snapB.json')))")
  if [ "$dat" != True ]; then
    wr=$(docker logs --since $S chibalete_edge 2>&1 | grep -cE '"(POST|PUT|PATCH|DELETE) /api/[^"]*" 2[0-9][0-9] ')
    python3 -c "import json;a=json.load(open('snapB.json'));b=json.load(open('snap.json'));print('   cambios de datos en:',[k+'/'+j for k in b for j in (b[k] if isinstance(b[k],dict) else {}) if a.get(k,{}).get(j)!=b[k][j]] or [k for k in b if a.get(k)!=b[k]])" | tee -a $L
    [ $wr -gt 0 ] && { echo "   explicados por $wr escrituras de la aplicación (edge, 2xx)" | tee -a $L; docker logs --since $S chibalete_edge 2>&1 | grep -E '"(POST|PUT|PATCH|DELETE) /api/[^"]*" 2[0-9][0-9] ' | awk '{print $4, $6, $7, $9}' | tee -a $L; dat=True; }
  fi
  echo "post: up=$up/11 restarts=$rs no_healthy=$hl ready=$rd/2 flags=$flags error=$er 5xx=$x5 protegidas_ausentes=$miss compose_igual=$([ "$sha" = "$SHA0" ] && echo si || echo NO) tarballs=$tars/$TAR0 datos_iguales=$dat" | tee -a $L
  [ $up = 11 ] && [ $rs = 0 ] && [ $hl = 0 ] && [ $rd = 2 ] && [ "$flags" = "[][] [][] " ] && [ $er = 0 ] && [ $x5 = 0 ] && [ $miss = 0 ] && [ "$sha" = "$SHA0" ] && [ $tars = $TAR0 ] && [ $dat = True ] \
    || { echo "STOP: validación posterior del lote $n" | tee -a $L; exit 1; }
  echo "== fin lote $n $(date -u +%FT%TZ)" | tee -a $L
done 3< cola.txt
echo "COLA AGOTADA tras $n lotes"
