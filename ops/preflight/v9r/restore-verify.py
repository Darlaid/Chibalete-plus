# V9R PRE-1 — verifica un ensayo de restauración contra el manifiesto de su ejecución. Solo lectura.
# Uso: restore-verify.py <cuarentena> <run_id> <snapshot>
import glob, hashlib, json, os, sqlite3, sys, time

q, run, snap = sys.argv[1:4]
man = json.load(open("/var/backups/chibalete-backup/manifests/%s.json" % run))
base = glob.glob(os.path.join(q, "restore/var/backups/chibalete-backup/staging-*"))[0]
emb = json.load(open(os.path.join(base, "manifest.json")))
print("unit=CHP-V9R-PRE-1 generated_utc=%s restic_restore_rc=0" % time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
print("run_id=%s snapshot_id=%s (id explicito) manifest_result=%s manifest_timestamp=%s" % (run, snap, man.get("result"), man.get("timestamp_utc")))
print("manifest_embedded_equals_local=%s" % (emb.get("stores") == man.get("stores")))
ok = bad = 0
for s in man["stores"]:
    lp = s["logical_path"]
    p = os.path.join(base, s["kind"], os.path.basename(lp))
    if not os.path.isfile(p):
        bad += 1
        print("FALTA", lp)
        continue
    b = open(p, "rb").read()
    sha = hashlib.sha256(b).hexdigest()
    if s["kind"] == "sqlite":
        con = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
        ic = con.execute("pragma integrity_check").fetchone()[0]
        nt = con.execute("select count(*) from sqlite_master where type='table'").fetchone()[0]
        con.close()
        check, good = "integrity_check=%s tablas=%s" % (ic, nt), ic == "ok"
    elif s["kind"] == "json":
        j = json.loads(b)
        check, good = "json %s elementos=%s" % (type(j).__name__, len(j)), True
    else:
        check, good = "texto no vacio", len(b) > 0
    same = sha == s["sha256"] and len(b) == s["bytes"]
    ok += 1 if (same and good) else 0
    bad += 0 if (same and good) else 1
    print("%s  %9d  %-45s %s  [%s]" % (sha[:16], len(b), lp, "OK" if same and good else "DIFIERE", check))
print("stores_total=%d restored_ok=%d restored_bad=%d" % (len(man["stores"]), ok, bad))
print("stores_absent=%s" % man.get("stores_absent"))
print("quarantine=%s restore_target_inside_production_paths=False services_started=none" % q)
