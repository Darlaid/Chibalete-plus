#!/usr/bin/env python3
# VPS-STORAGE-05 — inventario de imágenes chibalete/* por ImageID con tamaño exclusivo (solo lectura).
# Salida TSV: id12  created  unique_bytes  protegida(0/1)  tags(coma)
import json, subprocess, re

def sh(*a):
    return subprocess.run(a, capture_output=True, text=True).stdout

PROT = {'0dc5fc1e0f50', 'a00873c4b087', '423251d0b5c2', 'd8ba20851d7d', '9141cfb4fa96'}
UNITS = {'B': 1, 'kB': 1e3, 'KB': 1e3, 'MB': 1e6, 'GB': 1e9}
def size(s):
    m = re.match(r'([\d.]+)\s*([kKMG]?B)', s)
    return int(float(m.group(1)) * UNITS[m.group(2)]) if m else -1

uniq = {}
for l in sh('docker', 'system', 'df', '-v', '--format', '{{json .Images}}').splitlines():
    for im in json.loads(l):
        uniq[im['ID'].split(':')[-1][:12]] = size(im.get('UniqueSize', ''))
imgs = {}
for l in sh('docker', 'images', '--no-trunc', '--format', '{{.ID}}|{{.Repository}}:{{.Tag}}|{{.CreatedAt}}').splitlines():
    fid, tag, cr = l.split('|')
    i = fid.split(':')[1][:12]
    d = imgs.setdefault(i, {'tags': [], 'created': cr[:19]})
    d['tags'].append(tag)
for i, d in sorted(imgs.items(), key=lambda x: x[1]['created']):
    if not any(t.startswith('chibalete/') for t in d['tags']):
        continue
    print('\t'.join([i, d['created'], str(uniq.get(i, -1)), '1' if i in PROT else '0', ','.join(d['tags'])]))
