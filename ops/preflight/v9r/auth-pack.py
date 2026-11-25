#!/usr/bin/env python3
"""V9R PRE-1 (cierre) — paquete de carga de autorizaciones C005 / A1 / A2 para GVA y AT.

Dos pasos, ninguno escribe en producción ni concede nada por sí mismo:

  roster  SOLO LECTURA. Lee el padrón y los grupos y escribe por la salida estándar la nómina de fichas que hacen
          falta para que los cursos reales sigan con mediación: una fila por mediador (C005) y dos por lector
          (A1 y A2). Las columnas de evidencia salen VACÍAS: las llena quien verifica, a partir del soporte.
          La salida contiene datos personales (nombres): se redirige a un lugar custodiado, nunca al repositorio.
              python3 auth-pack.py roster [--root /var/www/chibalete] > nomina.csv

  build   Lee la nómina ya diligenciada y la separa en tres clases, sin valores por defecto:
            lista           evidencia completa y verificada: se emite como línea para ops/a2/decision_operator.mjs
            por_aclarar     tiene algún dato de evidencia pero falta otro, o no está verificada: NO se emite
            no_obtenida     sin ningún dato de evidencia: NO se emite
          Las líneas van a la salida estándar; el resumen (solo recuentos y números de fila), a la de errores.
          Código de salida 1 si hay filas por aclarar, para que no se cargue un paquete a medias sin verlo.
              python3 auth-pack.py build nomina.csv > decisiones.ndjson
"""
import csv, json, re, sys

COLS = ['cuenta', 'nombre', 'rol', 'curso', 'tipo', 'documento', 'version', 'estado', 'fecha_acto', 'medio', 'capacidad',
        'verificacion', 'referencia', 'vigencia_hasta']
EVID = ['estado', 'fecha_acto', 'medio', 'capacidad', 'verificacion', 'referencia']
DOC = {'C005': ('005', 'mediator'), 'A1': ('004', 'legal_representative'), 'A2': ('004', 'legal_representative')}
MEDIA = {'paper', 'electronic_signature', 'verifiable_message', 'admin_record'}
CAPACITY = {'C005': {'mediator'}, 'A1': {'legal_representative', 'titular'}, 'A2': {'legal_representative', 'titular'}}
DAY = re.compile(r'^\d{4}-\d{2}-\d{2}$')


def roster(root):
    users = json.load(open(f'{root}/data-critical/usuarios_colegios_oro.json', encoding='utf8'))
    groups = json.load(open(f'{root}/data/groups_db.json', encoding='utf8'))
    by = {u['id']: u for u in users if u.get('id')}
    active = lambda i: by.get(i, {}).get('accountStatus', 'active') == 'active' and i in by
    w = csv.writer(sys.stdout, lineterminator='\n')
    w.writerow(COLS)
    seen = set()
    for g in groups:
        meds = [m for m in dict.fromkeys((g.get('mediatorIds') or []) + ([g['teacherId']] if g.get('teacherId') else [])) if active(m)]
        mem = [m for m in dict.fromkeys((g.get('memberIds') or []) + (g.get('studentIds') or [])) if active(m)]
        if not g.get('organizationId') or not meds or not mem:
            continue          # solo cursos con organización, mediador activo y lectores activos
        for uid, kinds in [(m, ['C005']) for m in meds] + [(m, ['A1', 'A2']) for m in mem]:
            for k in kinds:
                if (uid, k) in seen:
                    continue  # una decisión por titular y tipo, aunque esté en varios cursos
                seen.add((uid, k))
                u = by[uid]
                w.writerow([uid, u.get('nombre_completo', ''), (u.get('roles') or [u.get('rol')])[0], g['id'], k, DOC[k][0], f'{DOC[k][0]}@1.0'] + [''] * 7)


def build(path):
    ready, clarify, missing, out = 0, [], 0, []
    with open(path, encoding='utf-8-sig', newline='') as fh:
        for n, r in enumerate(csv.DictReader(fh), start=2):
            v = {k: (r.get(k) or '').strip() for k in COLS}
            if not any(v[k] for k in EVID):
                missing += 1
                continue
            why = [k for k in EVID if not v[k]]
            if v['tipo'] not in DOC: why.append('tipo')
            elif v['version'] != f"{DOC[v['tipo']][0]}@1.0" or v['capacidad'] not in CAPACITY[v['tipo']]: why.append('version/capacidad')
            if v['estado'] not in ('granted', 'denied', 'revoked'): why.append('estado')
            if not DAY.match(v['fecha_acto']): why.append('fecha_acto')
            if v['medio'] not in MEDIA: why.append('medio')
            if v['verificacion'] != 'verified': why.append('verificacion')
            if v['vigencia_hasta'] and not DAY.match(v['vigencia_hasta']): why.append('vigencia_hasta')
            if not v['cuenta']: why.append('cuenta')
            if why:
                clarify.append((n, sorted(set(why))))
                continue
            ready += 1
            out.append({'subjectId': v['cuenta'], 'kind': v['tipo'], 'status': v['estado'], 'actDay': v['fecha_acto'], 'version': v['version'],
                        'medium': v['medio'], 'capacity': v['capacidad'], 'verification': 'verified', 'requestRef': v['referencia'],
                        'validUntil': v['vigencia_hasta'] or None})
    for d in out:
        print(json.dumps(d, ensure_ascii=False))
    print(json.dumps({'lista': ready, 'por_aclarar': len(clarify), 'no_obtenida': missing,
                      'filas_por_aclarar': [{'fila': n, 'falta': w} for n, w in clarify[:200]]}, ensure_ascii=False), file=sys.stderr)
    return 1 if clarify else 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')   # la nómina lleva tildes: UTF-8 también fuera de Linux
    a = sys.argv[1:]
    if a[:1] == ['roster']:
        roster(a[a.index('--root') + 1] if '--root' in a else '/var/www/chibalete')
    elif a[:1] == ['build'] and len(a) == 2:
        sys.exit(build(a[1]))
    else:
        sys.exit(__doc__)
