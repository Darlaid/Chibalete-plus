#!/usr/bin/env python3
# CHP-IDDB-M1-A-LEGACY-OBSERVABILITY-SEGMENTED-01 — analizador de segmentos.
# READ-ONLY: consume el access log del edge por stdin (docker logs chibalete_edge).
# Uso:
#   docker logs chibalete_edge 2>&1 | python3 segment_analyzer.py [--since ISO8601]
#
# Reglas de segmentación (reproducibles):
#   SEGMENT-09              UA empieza por "ChibaleteLU/0.9.0"
#   SEGMENT-LU-VERSIONED-OTRO  UA "ChibaleteLU/<v>" con v != 0.9.0 (futuras/regresiones)
#   SEGMENT-LEGACY-LU       UA "okhttp/*" sobre endpoints exclusivos de LU
#                           (0.7.1 y 0.8.0 son INDISTINGUIBLES entre sí: ambas okhttp/4.12.0)
#   SEGMENT-NON-LU          navegadores (Mozilla), curl/wget/python/Go/bots declarados,
#                           health interno (IPs 172.* / 127.* / IP del host)
#   SEGMENT-UNKNOWN         todo lo demás (incl. okhttp fuera de endpoints LU:
#                           NO se reclasifica como legacy por conveniencia)
import sys, re, datetime as dt
from collections import defaultdict

LINE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] "(?P<method>[A-Z]+) (?P<path>[^ "?]+)[^"]*" '
    r'(?P<status>\d{3}) \d+ "[^"]*" "(?P<ua>[^"]*)"'
)

LU_ENDPOINT_PREFIXES = (
    '/api/offline/assignment',
    '/api/progress/',        # sync + item (paths con userId)
    '/api/analytics/events',
    '/api/auth/login',
    '/api/lu/version',
)

INTERNAL_IP_PREFIXES = ('172.', '127.', '72.60.158.97')

def is_lu_endpoint(path):
    return any(path.startswith(p) for p in LU_ENDPOINT_PREFIXES)

def classify(ip, path, ua):
    if ua.startswith('ChibaleteLU/0.9.0'):
        return 'SEGMENT-09'
    if ua.startswith('ChibaleteLU/'):
        return 'SEGMENT-LU-VERSIONED-OTRO'
    if ua.startswith('okhttp/'):
        return 'SEGMENT-LEGACY-LU' if is_lu_endpoint(path) else 'SEGMENT-UNKNOWN'
    if ua.startswith('Mozilla') or 'bot' in ua.lower() or ua.startswith(('curl', 'Wget', 'python', 'Go-http', 'Prometheus')):
        return 'SEGMENT-NON-LU'
    if any(ip.startswith(p) for p in INTERNAL_IP_PREFIXES):
        return 'SEGMENT-NON-LU'
    return 'SEGMENT-UNKNOWN'

def endpoint_group(path):
    if path.startswith('/api/offline/assignment'): return 'assignment'
    if path.startswith('/api/progress/item/'):     return 'progress-read'
    if '/sync' in path and path.startswith('/api/progress/'): return 'progress-sync'
    if path.startswith('/api/analytics/events'):   return 'analytics'
    if path.startswith('/api/v1/events'):          return 'v1-events'
    if path.startswith('/api/playback-events'):    return 'playback'
    if path.startswith('/api/auth/login'):         return 'login'
    if path.startswith('/api/auth/'):              return 'auth-otros'
    if path.startswith('/api/health'):             return 'health'
    if path.startswith('/api/'):                   return 'api-otros'
    if path.startswith('/uploads/'):               return 'uploads'
    return 'no-api'

def status_class(s):
    if s == '202': return '202'
    if s == '401': return '401'
    if s == '403': return '403'
    c = s[0]
    return {'2': '2xx', '3': '3xx', '4': '4xx-otros', '5': '5xx'}.get(c, '???')

since = None
if len(sys.argv) >= 3 and sys.argv[1] == '--since':
    since = dt.datetime.fromisoformat(sys.argv[2]).replace(tzinfo=dt.timezone.utc)

seg_total = defaultdict(int)
seg_ep_st = defaultdict(int)
seg_ua = defaultdict(lambda: defaultdict(int))
seg_hours = defaultdict(lambda: defaultdict(int))
first_ts, last_ts = None, None
parsed, skipped = 0, 0

for raw in sys.stdin:
    m = LINE.match(raw)
    if not m:
        skipped += 1
        continue
    ts = dt.datetime.strptime(m.group('ts'), '%d/%b/%Y:%H:%M:%S %z')
    if since and ts < since:
        continue
    parsed += 1
    first_ts = min(first_ts, ts) if first_ts else ts
    last_ts = max(last_ts, ts) if last_ts else ts
    ua = m.group('ua')
    path = m.group('path')
    seg = classify(m.group('ip'), path, ua)
    seg_total[seg] += 1
    seg_ep_st[(seg, endpoint_group(path), status_class(m.group('status')))] += 1
    seg_ua[seg][ua[:60]] += 1
    seg_hours[seg][ts.strftime('%m-%d %Hh')] += 1

print(f'ventana: {first_ts} -> {last_ts}  lineas_parseadas={parsed} no_parseadas={skipped}')
print('\n== TOTALES POR SEGMENTO ==')
for seg in sorted(seg_total, key=seg_total.get, reverse=True):
    print(f'  {seg}: {seg_total[seg]}')

print('\n== SEGMENTO x ENDPOINT x STATUS ==')
for (seg, ep, st), n in sorted(seg_ep_st.items()):
    if seg == 'SEGMENT-NON-LU' and ep in ('health', 'no-api') :
        continue  # ruido operativo; total ya contado arriba
    print(f'  {seg} | {ep} | {st} = {n}')

print('\n== UAs POR SEGMENTO (top 5, truncados) ==')
for seg, uas in seg_ua.items():
    tops = sorted(uas.items(), key=lambda kv: -kv[1])[:5]
    print(f'  {seg}:')
    for ua, n in tops:
        print(f'      {n:5d}  {ua}')

print('\n== DISTRIBUCION HORARIA (solo segmentos LU) ==')
for seg in ('SEGMENT-09', 'SEGMENT-LEGACY-LU', 'SEGMENT-LU-VERSIONED-OTRO'):
    if seg in seg_hours:
        print(f'  {seg}: ' + ', '.join(f'{h}={n}' for h, n in sorted(seg_hours[seg].items())))
