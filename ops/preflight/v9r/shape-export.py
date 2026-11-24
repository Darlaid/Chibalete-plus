# V9R PRE-1 — forma de los almacenes de una copia RESTAURADA (cuarentena), sin ningún valor: para SQLite el esquema
# (sqlite_master), user_version y recuento de filas por tabla; para JSON el tipo, el número de elementos y la unión de
# claves con su tipo. Solo lectura. Uso: shape-export.py <cuarentena>
import glob, json, os, sqlite3, sys

q = sys.argv[1]
base = glob.glob(os.path.join(q, "restore/var/backups/chibalete-backup/staging-*"))[0]
out = {"sqlite": {}, "json": {}}
for p in sorted(glob.glob(os.path.join(base, "sqlite", "*.db"))):
    con = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    objs = con.execute("select type, name, tbl_name, sql from sqlite_master where sql is not null order by type desc, name").fetchall()
    tables = [o[1] for o in objs if o[0] == "table" and not o[1].startswith("sqlite_")]
    counts = {}
    for t in tables:
        try: counts[t] = con.execute('select count(*) from "%s"' % t).fetchone()[0]
        except Exception as e: counts[t] = "error: %s" % type(e).__name__
    out["sqlite"][os.path.basename(p)] = {
        "user_version": con.execute("pragma user_version").fetchone()[0],
        "journal_mode": con.execute("pragma journal_mode").fetchone()[0],
        "schema": [{"type": o[0], "name": o[1], "sql": o[3]} for o in objs],
        "rows": counts,
    }
    con.close()

def tname(v):
    return "null" if v is None else type(v).__name__

def keys_of(items):
    u = {}
    for it in items:
        if isinstance(it, dict):
            for k, v in it.items():
                u.setdefault(k, set()).add(tname(v))
    return {k: sorted(v) for k, v in sorted(u.items())}

for p in sorted(glob.glob(os.path.join(base, "json", "*.json"))):
    j = json.load(open(p, encoding="utf-8"))
    name = os.path.basename(p)
    if isinstance(j, list):
        out["json"][name] = {"type": "list", "n": len(j), "keys": keys_of(j)}
    elif isinstance(j, dict):
        sub = {}
        for k, v in j.items():
            if isinstance(v, list): sub[k] = {"type": "list", "n": len(v), "keys": keys_of(v)}
            elif isinstance(v, dict): sub[k] = {"type": "dict", "n": len(v), "value_keys": keys_of(v.values())}
            else: sub[k] = {"type": tname(v)}
        # las claves de primer nivel de algunos almacenes son identificadores de personas: solo se cuentan
        out["json"][name] = {"type": "dict", "n": len(j), "top": sub if len(j) <= 12 else "(%d claves, omitidas)" % len(j)}
print(json.dumps(out, ensure_ascii=False))
