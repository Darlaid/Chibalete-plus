#!/usr/bin/env python3
# VPS-STORAGE-05 — verificación previa de una imagen candidata por ImageID (solo lectura). Uso: recheck5.py <image-id-12>
# Sale con 1 si no se cumple cualquier condición. Imprime una línea JSON con la evidencia.
import json, subprocess, sys

iid12 = sys.argv[1]
# Conjunto protegido por ImageID (producción vigente + rollback inmediato + excepción del compose base)
PROTEGIDOS = {'0dc5fc1e0f50': 'api vigente edinf-41b1bc7', 'a00873c4b087': 'front vigente edinf-41b1bc7',
              '423251d0b5c2': 'api rollback inmediato regalias-c8f491e', 'd8ba20851d7d': 'front rollback inmediato regalias-c8f491e',
              '9141cfb4fa96': 'front referenciada por docker-compose.yml base'}

def sh(*a):
    return subprocess.run(a, capture_output=True, text=True)

def fail(motivo, **kw):
    print(json.dumps({'id': iid12, 'OK': False, 'motivo': motivo, **kw})); sys.exit(1)

if iid12 in PROTEGIDOS: fail('protegida: ' + PROTEGIDOS[iid12])
rows = [l.split() for l in sh('docker', 'images', '--no-trunc', '--format', '{{.ID}} {{.Repository}}:{{.Tag}}').stdout.splitlines()]
full = {r[0] for r in rows if r[0].split(':')[1][:12] == iid12}
if len(full) != 1: fail('imagen ausente o id ambiguo')
full_id = full.pop()
tags = [r[1] for r in rows if r[0] == full_id]
if not tags or not all(t.startswith('chibalete/api:') or t.startswith('chibalete/front:') for t in tags): fail('propietario no demostrado', tags=tags)
cont_ancestor = sh('docker', 'ps', '-aq', '--filter', f'ancestor={full_id}').stdout.split()
cont_ids = sh('docker', 'ps', '-aq').stdout.split()
cont_by_id = [x for x in sh('docker', 'inspect', '-f', '{{.Image}}', *cont_ids).stdout.split() if x == full_id]
live_cfg = open('/opt/chibaleteplus/docker-compose.override.yml').read() + open('/opt/chibaleteplus/docker-compose.yml').read()
in_live = [t for t in tags if t in live_cfg]
rb = open('/root/chp-edinf01/ROLLBACK.txt').read()
in_rb = [t for t in tags if t.split(':')[1] in rb] + ([iid12] if iid12 in rb else [])
# El rollback inmediato y la producción siguen completos
present = {r[0].split(':')[1][:12] for r in rows}
missing = [k for k in PROTEGIDOS if k not in present]
ok = not cont_ancestor and not cont_by_id and not in_live and not in_rb and not missing
print(json.dumps({'id': iid12, 'tags': tags, 'contenedores': len(cont_ancestor) + len(cont_by_id), 'en_compose_vivo': in_live,
                  'en_rollback_vigente': in_rb, 'protegidas_ausentes': missing, 'OK': ok}))
sys.exit(0 if ok else 1)
