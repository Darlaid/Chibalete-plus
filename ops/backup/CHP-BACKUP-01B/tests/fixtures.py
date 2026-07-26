"""Fixtures 100% sinteticos para las pruebas de CHP-BACKUP-01B.

Nada aqui procede de produccion. Passphrases generadas al vuelo con `secrets`,
datos generados con `os.urandom` y literales inventados.
"""

import json
import os
import secrets
import sqlite3

# Reproduce la forma del inventario real (CHP-BACKUP-01A §2.1 y §2.2), con
# contenido inventado.
SQLITE_FIXTURES = (
    ("data-critical/events.db", "events", 400),
    ("data/progress.db", "progress", 200),
    ("data/offline_assignments.db", "offline_book_assignments", 12),
    ("data-critical/insights.db", "rollups", 0),
)

JSON_FIXTURES = {
    "data-critical/usuarios_colegios_oro.json": [
        {"id": f"u{i}", "role": "lector", "hash": "bcrypt$synthetic"} for i in range(20)
    ],
    "data/groups_db.json": [{"id": f"g{i}", "type": "course"} for i in range(5)],
    "data/access_db.json": [{"scope": "group", "groupId": "g0"}],
    "data/schools_db.json": [{"id": "s1"}, {"id": "s2"}, {"id": "s3"}],
    "data/sections.json": [{"id": f"sec{i}"} for i in range(7)],
    "data/school_configs.json": [{"schoolId": "s1"}],
    "data/content.json": [{"id": f"c{i}"} for i in range(12)],
    "data/content_db.json": [{"id": "legacy1"}],
    "data/user_audit_log.json": [{"event": "synthetic"} for _ in range(30)],
    "data/analytics_db.json": [{"metric": "synthetic"} for _ in range(40)],
    "data/leo_memory_db.json": {"sessions": {"synthetic": []}},
    "data/leo_evidence_db.json": {"evidence": [], "version": 1},
    "data/leo_interactions_db.json": [{"turn": i} for i in range(15)],
}

# Los siete stores anadidos en CHP-BACKUP-01D se escriben como BYTES LITERALES,
# no con json.dump, para poder demostrar preservacion byte a byte con formas
# deliberadamente distintas: formateado, compacto, vacio, sin newline final,
# UTF-8 no ASCII, LF y CRLF. Todo el contenido es inventado.
RAW_JSON_FIXTURES = {
    # formateado (indent 2), UTF-8 no ASCII, LF, con newline final
    "data/users_db.json": (
        '[\n'
        '  {\n'
        '    "id": "sintetico-1",\n'
        '    "nombre_completo": "Nombre Sintético Ñandú",\n'
        '    "roles": ["lector"]\n'
        '  },\n'
        '  {\n'
        '    "id": "sintetico-2",\n'
        '    "nombre_completo": "Otro Sintético",\n'
        '    "roles": ["mediador"]\n'
        '  }\n'
        ']\n'
    ).encode("utf-8"),
    # compacto, SIN newline final
    "data/progress_db.json": b'[{"u":"sintetico-1","p":10},{"u":"sintetico-2","p":20},{"u":"s3","p":0}]',
    # objeto con CRLF y newline final
    "data/lu_config.json": b'{\r\n  "version": "0.0.0-sintetica",\r\n  "enabled": false\r\n}\r\n',
    # objeto vacio valido: NO debe descartarse por tener pocos bytes
    "data/leo_profile_db.json": b"{}",
    # array vacio valido con newline final
    "data/interventions_db.json": b"[]\n",
    # array vacio de 2 bytes, la forma real en produccion
    "data/submissions_db.json": b"[]",
    # copia historica: formateada, UTF-8, sin newline final
    "data/users_db.backup.1773870779.json": (
        '[\n'
        '  {"id": "historico-1", "nombre_completo": "Registro Histórico"}\n'
        ']'
    ).encode("utf-8"),
}

UPLOADS_REL = "public/uploads"


def build_base(base_dir: str, uploads_files: int = 6, upload_size: int = 20000) -> str:
    """Crea un arbol de datos sintetico con la forma de produccion."""
    for rel, table, rows in SQLITE_FIXTURES:
        path = os.path.join(base_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(f"CREATE TABLE IF NOT EXISTS {table}(id INTEGER PRIMARY KEY, payload TEXT)")
        if rows:
            conn.executemany(
                f"INSERT INTO {table}(payload) VALUES (?)",
                [(f"synthetic-{i}",) for i in range(rows)],
            )
        conn.commit()
        conn.close()

    for rel, payload in JSON_FIXTURES.items():
        path = os.path.join(base_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle)

    # Bytes literales: se escriben en binario para que ni el modo texto ni la
    # plataforma alteren los finales de linea.
    for rel, raw in RAW_JSON_FIXTURES.items():
        path = os.path.join(base_dir, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(raw)

    uploads_dir = os.path.join(base_dir, UPLOADS_REL)
    os.makedirs(uploads_dir, exist_ok=True)
    for i in range(uploads_files):
        with open(os.path.join(uploads_dir, f"asset{i}"), "wb") as handle:
            handle.write(os.urandom(upload_size))
    return base_dir


def build_config(
    config_dir: str,
    repository: str,
    cache_dir: str | None = None,
    passphrase: str | None = None,
    access_key: str | None = None,
    secret_key: str | None = None,
    mode: int = 0o400,
    uid: int = 0,
    gid: int = 0,
    omit: tuple[str, ...] = (),
    extra_lines: tuple[str, ...] = (),
    password_file: str | None = None,
) -> dict:
    """Crea /etc/chibalete-backup sintetico. Devuelve los valores generados."""
    os.makedirs(config_dir, exist_ok=True)
    os.chmod(config_dir, 0o700)

    passphrase = passphrase or secrets.token_urlsafe(32)
    access_key = access_key or ("005" + secrets.token_hex(11))
    secret_key = secret_key or secrets.token_urlsafe(30)
    pw_path = password_file or os.path.join(config_dir, "restic-password")

    lines = {
        "AWS_ACCESS_KEY_ID": access_key,
        "AWS_SECRET_ACCESS_KEY": secret_key,
        "AWS_DEFAULT_REGION": "synthetic-region-000",
        "RESTIC_REPOSITORY": repository,
        "RESTIC_PASSWORD_FILE": pw_path,
    }
    if cache_dir:
        lines["RESTIC_CACHE_DIR"] = cache_dir
    for key in omit:
        lines.pop(key, None)

    env_path = os.path.join(config_dir, "backup.env")
    with open(env_path, "w", encoding="utf-8") as handle:
        for key, value in lines.items():
            handle.write(f"{key}={value}\n")
        for extra in extra_lines:
            handle.write(extra + "\n")
    os.chown(env_path, uid, gid)
    os.chmod(env_path, mode)

    real_pw_path = os.path.join(config_dir, "restic-password")
    with open(real_pw_path, "w", encoding="utf-8") as handle:
        handle.write(passphrase)
    os.chown(real_pw_path, uid, gid)
    os.chmod(real_pw_path, 0o400)

    return {
        "config_dir": config_dir,
        "passphrase": passphrase,
        "access_key": access_key,
        "secret_key": secret_key,
        "repository": repository,
        "env_path": env_path,
        "password_path": real_pw_path,
    }


SQLITE_SIDECARS = ("-wal", "-shm")


def is_sidecar(rel_path: str) -> bool:
    """True si la ruta es un sidecar de SQLite (-wal / -shm).

    Un lector de una base en WAL crea o actualiza estos archivos: es
    comportamiento normal e inevitable de SQLite, no una mutacion de los datos.
    Los `.db` en si deben quedar byte-identicos y se comprueban aparte.
    """
    return rel_path.endswith(SQLITE_SIDECARS)


def split_sidecars(tree: dict) -> tuple[dict, dict]:
    main = {k: v for k, v in tree.items() if not is_sidecar(k)}
    sidecars = {k: v for k, v in tree.items() if is_sidecar(k)}
    return main, sidecars


def snapshot_tree(root: str) -> dict:
    """Huella (tamano, mtime_ns, sha256) de cada archivo bajo `root`."""
    import hashlib

    result = {}
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in sorted(filenames):
            path = os.path.join(dirpath, name)
            try:
                st = os.stat(path)
                digest = hashlib.sha256()
                with open(path, "rb") as handle:
                    for chunk in iter(lambda: handle.read(1 << 20), b""):
                        digest.update(chunk)
                result[os.path.relpath(path, root)] = (st.st_size, st.st_mtime_ns, digest.hexdigest())
            except OSError:
                continue
    return result
