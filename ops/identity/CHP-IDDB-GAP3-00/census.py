#!/usr/bin/env python3
"""CHP-IDDB-02C-GAP3-GROUPS-00 — censo read-only de grupos. Sin PII.

Cruza: groups_db.json (autoridad) x identity.db (groups/memberships/
exclusions) x schools_db.json x access_db.json x padron x mapa atestado
01C-R1. Solo agregados y aliases hasheados.
"""
import collections
import hashlib
import json
import sqlite3
import sys

GROUPS = "/var/www/chibalete/data/groups_db.json"
SCHOOLS = "/var/www/chibalete/data/schools_db.json"
ACCESS = "/var/www/chibalete/data/access_db.json"
PADRON = "/var/www/chibalete/data-critical/usuarios_colegios_oro.json"
IDB = "/var/www/chibalete/identity/identity.db"
MAP01C = "/root/chp-iddb-01c-r1/GROUP_INSTITUTION_MAPPING_01C_R1.json"

sha = lambda s: hashlib.sha256(str(s).encode()).hexdigest()
h8 = lambda s: sha(s)[:8]
h16 = lambda s: sha(s)[:16]

groups = json.load(open(GROUPS))
schools = json.load(open(SCHOOLS))
access = json.load(open(ACCESS))
padron = json.load(open(PADRON))
map01c = {g["groupAlias"]: g for g in json.load(open(MAP01C))["groups"]}

con = sqlite3.connect(f"file:{IDB}?mode=ro", uri=True)
sq_groups = {r[0]: {"institution_id": r[1], "name": r[2], "type": r[3], "status": r[4]}
             for r in con.execute("SELECT group_id, institution_id, name, type, status "
                                  "FROM groups WHERE deleted_at IS NULL")}
mem_by_group = collections.Counter(
    r[0] for r in con.execute("SELECT group_id FROM memberships"))
mem_total = sum(mem_by_group.values())
excl_group = {r[0] for r in con.execute(
    "SELECT reference_hash FROM migration_exclusions WHERE entity='group'")}
sq_insts = {r[0] for r in con.execute("SELECT institution_id FROM institutions")}

canon_inst_ids = {str(s.get("id")) for s in schools}
padron_by_id = {str(u.get("id")): u for u in padron}
synthetic_users = {str(u["id"]) for u in padron if u.get("_loadtest_marker")}
real_users = set(padron_by_id) - synthetic_users

# users.groupIds referencias inversas
user_groupids_refs = collections.Counter()
for u in padron:
    for gid in (u.get("groupIds") or []):
        user_groupids_refs[str(gid)] += 1

json_ids = [str(g.get("id")) for g in groups]
dup_ids = [i for i, c in collections.Counter(json_ids).items() if c > 1]

rows = []
agg = collections.Counter()
sem_mismatch = []
for g in groups:
    gid = str(g.get("id"))
    alias = "GRP_" + h8(gid)
    members = [str(m) for m in (g.get("memberIds") or g.get("studentIds") or [])]
    mediators = [str(m) for m in (g.get("mediatorIds") or
                                  ([g["teacherId"]] if g.get("teacherId") else []))]
    org = g.get("organizationId")
    in_sq = gid in sq_groups
    cls2 = "CANONICAL_MATCH" if in_sq else "JSON_ONLY"
    if in_sq:
        s = sq_groups[gid]
        if (str(s["institution_id"]) != str(org) or s["name"] != g.get("name")
                or s["type"] != (g.get("type") or "course")):
            cls2 = "SEMANTIC_MISMATCH"
            sem_mismatch.append(alias)
    m01 = map01c.get(alias)
    inst_class = ("CANONICAL_INSTITUTION" if str(org) in canon_inst_ids
                  else "SYNTHETIC_ORG" if str(org or "").startswith("lt-")
                  else "UNRESOLVED_NO_ORG" if not org else "LEGACY_ORG_UNKNOWN")
    synth_members = sum(1 for m in members if m in synthetic_users)
    real_members = sum(1 for m in members if m in real_users)
    dangling_members = sum(1 for m in members if m not in padron_by_id)
    med_real = sum(1 for m in mediators if m in real_users)
    med_dangling = sum(1 for m in mediators if m not in padron_by_id)
    marker = bool(g.get("_loadtest_marker")) or gid.startswith("lt-")
    rows.append({
        "alias": alias,
        "cross": cls2,
        "excluded_02a": h16(gid) in excl_group,
        "map01c_class": m01["resolutionClass"] if m01 else "NOT_IN_01C_MAP",
        "map01c_disposition": m01.get("migrationDisposition") if m01 else None,
        "type": g.get("type") or "(none)",
        "inst_ref": inst_class,
        "has_grade": bool(g.get("grade")), "has_gradeLevel": bool(g.get("gradeLevel")),
        "has_section": bool(g.get("section")),
        "grade_conflict": bool(g.get("grade")) and bool(g.get("gradeLevel"))
                          and str(g.get("gradeLevel")) not in str(g.get("grade")),
        "members": len(members), "members_synth": synth_members,
        "members_real": real_members, "members_dangling": dangling_members,
        "mediators": len(mediators), "mediators_real": med_real,
        "mediators_dangling": med_dangling,
        "canon_memberships_sqlite": mem_by_group.get(gid, 0),
        "user_groupids_backrefs": user_groupids_refs.get(gid, 0),
        "synthetic_marker": marker,
        "has_avail_content": bool(g.get("availableContentIds")),
        "has_access_window": bool(g.get("accessStartsAt") or g.get("accessEndsAt")),
    })
    agg[cls2] += 1

# access rules -> group refs
access_group_refs = []
for r in access:
    if r.get("scope") == "group":
        gid = str(r.get("scopeId"))
        access_group_refs.append({
            "rule": str(r.get("id")), "group_alias": "GRP_" + h8(gid),
            "group_in_json": gid in set(json_ids),
            "group_in_sqlite": gid in sq_groups,
            "group_synthetic": gid.startswith("lt-") or any(
                row["alias"] == "GRP_" + h8(gid) and row["synthetic_marker"]
                for row in rows),
            "titleIds": len(r.get("titleIds") or []),
            "expired": False if r.get("expiresAt") in (None,) else None,
        })

# memberships canonicas: ¿todas apuntan a los 4 canonicos?
mem_outside = {k: v for k, v in mem_by_group.items() if k not in sq_groups}
mem_to_json_only = {("GRP_" + h8(k)): v for k, v in mem_by_group.items()
                    if k in set(json_ids) and k not in sq_groups}

# users.groupIds hacia grupos inexistentes en JSON
dangling_backrefs = {("GRP_" + h8(k)): v for k, v in user_groupids_refs.items()
                     if k not in set(json_ids)}

out = {
    "totals": {
        "json_groups": len(groups), "sqlite_groups": len(sq_groups),
        "memberships_total": mem_total,
        "cross": dict(agg),
        "sqlite_only": [a for a in
                        ("GRP_" + h8(k) for k in sq_groups if k not in set(json_ids))],
        "semantic_mismatch": sem_mismatch,
        "duplicate_json_ids": len(dup_ids),
    },
    "memberships": {
        "pointing_outside_sqlite_groups": {("GRP_" + h8(k)): v
                                           for k, v in mem_outside.items()},
        "pointing_to_json_only": mem_to_json_only,
        "all_227_on_canonical": len(mem_outside) == 0,
    },
    "access_group_refs": access_group_refs,
    "user_groupids_dangling_backrefs": dangling_backrefs,
    "rows": rows,
}
json.dump(out, sys.stdout, indent=1, sort_keys=True)
print()
