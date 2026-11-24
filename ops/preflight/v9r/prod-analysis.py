# V9R PRE-1 — análisis de SOLO LECTURA sobre la copia restaurada (cuarentena). Salida: únicamente recuentos e
# identificadores de CURSOS/OBRAS (nunca de personas ni nombres). Uso: prod-analysis.py <cuarentena>
import glob, json, os, sqlite3, sys, time
from collections import Counter

q = sys.argv[1]
base = glob.glob(os.path.join(q, "restore/var/backups/chibalete-backup/staging-*"))[0]
J = lambda n: json.load(open(os.path.join(base, "json", n), encoding="utf-8"))
DB = lambda n: sqlite3.connect("file:%s?mode=ro" % os.path.join(base, "sqlite", n), uri=True)
now = time.time() * 1000
out = {}

users = J("usuarios_colegios_oro.json"); groups = J("groups_db.json"); rules = J("access_db.json"); content = J("content.json")
by_id = {u.get("id"): u for u in users if isinstance(u, dict)}
roles = Counter()
for u in users:
    for r in (u.get("roles") or ["(sin rol)"]): roles[r] += 1
out["cuentas"] = {"total": len(users), "por_rol": dict(roles), "por_estado": dict(Counter(str(u.get("accountStatus")) for u in users)),
                  "b2c_marcadas": sum(1 for u in users if u.get("b2c")), "creadas_por_tienda": sum(1 for u in users if u.get("createdVia") == "b2c-provision"),
                  "representadas": sum(1 for u in users if u.get("representation") or u.get("representedBy") or u.get("reader"))}

# Reglas de acceso
def alive(r):
    e = r.get("expiresAt")
    return not (isinstance(e, (int, float)) and now > e)
out["reglas"] = {"total": len(rules), "por_ambito": dict(Counter(str(r.get("scope")) for r in rules)), "vigentes": sum(1 for r in rules if alive(r)),
                 "de_usuario_b2c": sum(1 for r in rules if r.get("scope") == "user" and r.get("b2c")),
                 "de_usuario_no_b2c": sum(1 for r in rules if r.get("scope") == "user" and not r.get("b2c")),
                 "campos": sorted({k for r in rules for k in r})}

# Cursos: obras asociadas (regla del servidor: reglas de grupo vigentes + availableContentIds/collectionIds heredados)
member_ids = lambda g: set(map(str, (g.get("memberIds") or []) + (g.get("studentIds") or [])))
gout = []
for g in groups:
    gid = g.get("id")
    titles, cols, allw = set(), set(), False
    for r in rules:
        if r.get("scope") == "group" and str(r.get("scopeId")) == gid and alive(r):
            titles |= set(map(str, r.get("titleIds") or [])); cols |= set(map(str, r.get("collectionIds") or []))
    a = g.get("availableContentIds")
    if a == "all": allw = True
    elif isinstance(a, list): titles |= set(map(str, a))
    cols |= set(map(str, g.get("collectionIds") or []))
    meds = [m for m in (g.get("mediatorIds") or [])]
    gout.append({"id": gid, "tipo": g.get("type"), "miembros": len(member_ids(g)), "mediadores": len(meds), "mediadores_sin_cuenta": sum(1 for m in meds if m not in by_id),
                 "mediadores_inactivos": sum(1 for m in meds if m in by_id and by_id[m].get("accountStatus") not in (None, "active")),
                 "titulos": len(titles), "colecciones": len(cols), "todas": allw, "con_obras": bool(allw or titles or cols),
                 "organizationId": bool(g.get("organizationId")), "miembros_sin_cuenta": sum(1 for m in member_ids(g) if m not in by_id)})
out["grupos"] = {"total": len(groups), "por_tipo": dict(Counter(str(g.get("type")) for g in groups)),
                 "sin_obras": [x for x in gout if not x["con_obras"]], "sin_mediador": [x["id"] for x in gout if x["mediadores"] == 0],
                 "con_mediadores_sin_cuenta": [x["id"] for x in gout if x["mediadores_sin_cuenta"]], "con_miembros_sin_cuenta": {x["id"]: x["miembros_sin_cuenta"] for x in gout if x["miembros_sin_cuenta"]},
                 "sin_organizacion": [x["id"] for x in gout if not x["organizationId"]], "detalle": gout}
med_ids = {m for g in groups for m in (g.get("mediatorIds") or [])}
reader_ids = {m for g in groups for m in member_ids(g)}
out["mediacion"] = {"mediadores_distintos": len(med_ids), "lectores_en_grupos": len(reader_ids),
                    "cuentas_con_rol_mediador_sin_grupo": sum(1 for u in users if any(r in ("mediador", "profesor") for r in (u.get("roles") or [])) and u.get("id") not in med_ids)}

# Lectura personal: cuentas personales y lectores de colegio con obras solo por regla propia B2C
group_of = {}
for g in groups:
    for m in member_ids(g): group_of.setdefault(m, []).append(g)
def group_titles(uid):
    t = set()
    for g in group_of.get(uid, []):
        x = next(z for z in gout if z["id"] == g.get("id"))
        if x["todas"]: return None
        for r in rules:
            if r.get("scope") == "group" and str(r.get("scopeId")) == g.get("id"): t |= set(map(str, r.get("titleIds") or []))
        a = g.get("availableContentIds")
        if isinstance(a, list): t |= set(map(str, a))
    return t
personal_accounts = {u.get("id") for u in users if u.get("b2c") and not group_of.get(u.get("id"))}
own_rules = {}
for r in rules:
    if r.get("scope") == "user" and r.get("b2c"): own_rules.setdefault(str(r.get("scopeId")), set()).update(map(str, r.get("titleIds") or []))
mixed = {}
for uid, t in own_rules.items():
    if uid in personal_accounts or not group_of.get(uid): continue
    gt = group_titles(uid)
    if gt is None: continue
    only = t - gt
    if only: mixed[uid] = only
out["lectura_personal"] = {"cuentas_personales": len(personal_accounts), "lectores_de_colegio_con_obras_propias": len(mixed), "titulares_de_reglas_b2c": len(own_rules)}

ev = DB("events.db"); cols = [c[1] for c in ev.execute("pragma table_info(events)")]
out["events_db"] = {"columnas": cols, "filas": ev.execute("select count(*) from events").fetchone()[0],
                    "desde": ev.execute("select min(server_ts) from events").fetchone()[0], "hasta": ev.execute("select max(server_ts) from events").fetchone()[0],
                    "usuarios_distintos": ev.execute("select count(distinct user_id) from events").fetchone()[0]}
def personal_event_count(con, table):
    n = 0
    for uid in personal_accounts:
        n += con.execute("select count(*) from %s where user_id = ?" % table, (uid,)).fetchone()[0]
    for uid, works in mixed.items():
        for w in works: n += con.execute("select count(*) from %s where user_id = ? and content_id = ?" % table, (uid, w)).fetchone()[0]
    return n
out["events_db"]["de_lectura_personal"] = personal_event_count(ev, "events")
ar = DB("events.archive.db"); at = [r[0] for r in ar.execute("select name from sqlite_master where type='table'")][0]
out["events_archive"] = {"tabla": at, "filas": ar.execute("select count(*) from %s" % at).fetchone()[0], "desde": ar.execute("select min(server_ts) from %s" % at).fetchone()[0], "hasta": ar.execute("select max(server_ts) from %s" % at).fetchone()[0]}

ins = DB("insights.db")
prof = [r[0] for r in ins.execute("select user_id from user_reading_profiles")]
sig_users = [r[0] for r in ins.execute("select distinct scope_id from signal_snapshots where scope_type = 'user'")]
tabs = [r[0] for r in ins.execute("select name from sqlite_master where type='table'")]
out["insights_db"] = {"perfiles": len(prof), "perfiles_de_cuentas_personales": sum(1 for u in prof if u in personal_accounts), "perfiles_de_lectores_con_obras_propias": sum(1 for u in prof if u in mixed),
                      "perfiles_sin_cuenta_en_padron": sum(1 for u in prof if u not in by_id),
                      "senales_usuarios": len(sig_users), "senales_de_cuentas_personales": sum(1 for u in sig_users if u in personal_accounts), "senales_de_lectores_con_obras_propias": sum(1 for u in sig_users if u in mixed),
                      "senales_por_ambito": dict(ins.execute("select scope_type, count(*) from signal_snapshots group by 1").fetchall()),
                      "tablas_del_registro_de_procedencia": [t for t in tabs if t in ("pedagogical_context_intervals", "reading_session_receipts")],
                      "materializer_state": [dict(zip([c[0] for c in ins.execute("select * from materializer_state").description], r)) for r in ins.execute("select * from materializer_state")]}

an = J("analytics_db.json")
ts = [e.get("timestamp") for e in an if isinstance(e.get("timestamp"), (int, float))]
out["analytics_db"] = {"eventos": len(an), "tope_rodante": 50000, "desde": min(ts) if ts else None, "hasta": max(ts) if ts else None,
                       "de_lu": sum(1 for e in an if e.get("source") == "lu_android"), "con_constancia_de_recepcion": sum(1 for e in an if e.get("receivedAt")),
                       "de_cuentas_personales": sum(1 for e in an if e.get("userId") in personal_accounts)}

pg = DB("progress.db"); pt = [r[0] for r in pg.execute("select name from sqlite_master where type='table'")][0]
pcols = [c[1] for c in pg.execute("pragma table_info(%s)" % pt)]
out["progress_db"] = {"tabla": pt, "columnas": pcols, "filas": pg.execute("select count(*) from %s" % pt).fetchone()[0]}
idb = DB("identity.db")
out["identity_db"] = {t: idb.execute('select count(*) from "%s"' % t).fetchone()[0] for t in [r[0] for r in idb.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%'")]}
off = DB("offline_assignments.db"); ot = [r[0] for r in off.execute("select name from sqlite_master where type='table'")][0]
out["offline_assignments"] = {"filas": off.execute("select count(*) from %s" % ot).fetchone()[0]}
out["contenido"] = {"total": len(content), "por_tipo": dict(Counter(str(c.get("type")) for c in content))}
out["lu_config"] = J("lu_config.json")
print(json.dumps(out, ensure_ascii=False, default=str))
