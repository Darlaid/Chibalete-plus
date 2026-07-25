#!/usr/bin/env python3
"""Suite funcional de CHP-BACKUP-01B.

Ejecutar SIEMPRE dentro del toolchain Linux aislado (ver ../README.md):
restic real, red deshabilitada, fixtures y passphrases sinteticas.

Cubre los 24 casos obligatorios y los 16 escenarios de integracion con restic.
Las pruebas ejercitan comportamiento real: nada se sustituye por inspeccion de
texto salvo los dos barridos estaticos explicitamente marcados como
complementarios.
"""

import json
import os
import shutil
import signal
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT_DIR = os.path.dirname(HERE)
RUNNERS_DIR = os.path.join(UNIT_DIR, "runners")
SYSTEMD_DIR = os.path.join(UNIT_DIR, "systemd")

sys.path.insert(0, RUNNERS_DIR)
sys.path.insert(0, HERE)

import fixtures  # noqa: E402
from chibalete_backup import errors  # noqa: E402
from chibalete_backup.config import load_config  # noqa: E402
from chibalete_backup.locking import SharedLock, StagingArea  # noqa: E402
from chibalete_backup.manifest import audit_manifest  # noqa: E402
from chibalete_backup.restic import Restic  # noqa: E402
from chibalete_backup.safelog import SafeLogger  # noqa: E402
from chibalete_backup.sqlite_capture import capture_sqlite, source_journal_mode  # noqa: E402

WORK_ROOT = os.environ.get("CHP_TEST_ROOT", "/work/tests")
LOWSPACE = "/lowspace"
LOWINO = "/lowino"
FULLFS = "/fullfs"

RESULTS: list[tuple[str, str, str]] = []


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------

def fresh(name: str) -> str:
    path = os.path.join(WORK_ROOT, name)
    if os.path.exists(path):
        shutil.rmtree(path, ignore_errors=True)
    os.makedirs(path, exist_ok=True)
    return path


class Env:
    """Entorno completo de una prueba: base, config, repo, work, lock."""

    def __init__(self, name: str, uploads_files: int = 6, **config_kw):
        root = fresh(name)
        self.root = root
        self.base = os.path.join(root, "base")
        self.work = os.path.join(root, "work")
        self.config_dir = os.path.join(root, "etc")
        self.repo = os.path.join(root, "repo")
        self.lock = os.path.join(root, "lock")
        os.makedirs(self.base, exist_ok=True)
        os.makedirs(self.work, exist_ok=True)
        fixtures.build_base(self.base, uploads_files=uploads_files)
        self.secrets = fixtures.build_config(
            self.config_dir,
            repository=config_kw.pop("repository", self.repo),
            cache_dir=os.path.join(self.work, "cache"),
            **config_kw,
        )

    def run(self, runner: str, extra=None, timeout: int = 600, expect=None):
        cmd = [
            sys.executable,
            os.path.join(RUNNERS_DIR, runner),
            "--config-dir", self.config_dir,
            "--work-dir", self.work,
            "--lock-path", self.lock,
        ]
        if runner != "verify_backup.py":
            cmd += ["--base-dir", self.base]
        if extra:
            cmd += extra
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if expect is not None and proc.returncode != expect:
            raise AssertionError(
                f"{runner} rc={proc.returncode} (esperado {expect}); stderr={proc.stderr[-500:]}"
            )
        return proc

    def popen(self, runner: str, extra=None):
        cmd = [
            sys.executable,
            os.path.join(RUNNERS_DIR, runner),
            "--config-dir", self.config_dir,
            "--work-dir", self.work,
            "--lock-path", self.lock,
            "--base-dir", self.base,
        ]
        if extra:
            cmd += extra
        return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def restic(self):
        cfg = load_config(self.config_dir)
        return Restic(cfg, SafeLogger("test", "test", stream=open(os.devnull, "w")))

    def snapshots(self, tag=None):
        return self.restic().snapshots(tag=tag)

    def manifests(self):
        out = []
        mdir = os.path.join(self.work, "manifests")
        if not os.path.isdir(mdir):
            return out
        for name in sorted(os.listdir(mdir)):
            with open(os.path.join(mdir, name), encoding="utf-8") as handle:
                out.append(json.load(handle))
        return out

    def staging_dirs(self):
        if not os.path.isdir(self.work):
            return []
        return [n for n in os.listdir(self.work) if n.startswith(("staging-", "uploads-manifest-"))]

    def repo_initialized(self) -> bool:
        return os.path.isdir(os.path.join(self.repo, "data"))

    @staticmethod
    def backup_summary(proc, event: str = "restic_backup_done") -> dict:
        """Cifras REALES devueltas por restic, leidas del log del runner."""
        found = None
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line.startswith("{"):
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("event") == event:
                found = record
        if found is None:
            raise AssertionError(f"no se encontro el evento {event} en la salida del runner")
        return found


def inflate_db(path: str, rows: int) -> None:
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE IF NOT EXISTS bulk(id INTEGER PRIMARY KEY, blob TEXT)")
    conn.executemany(
        "INSERT INTO bulk(blob) VALUES (?)", [("x" * 200,) for _ in range(rows)]
    )
    conn.commit()
    conn.close()


def fill_filesystem(path: str) -> None:
    os.makedirs(path, exist_ok=True)
    target = os.path.join(path, "ballast")
    try:
        with open(target, "wb") as handle:
            while True:
                handle.write(b"\0" * 4096)
                handle.flush()
    except OSError:
        pass


def assert_sources_untouched(before: dict, after: dict, context: str = "") -> None:
    """Invariante real: los datos no cambian.

    Los `.db`, los JSON y los uploads deben quedar byte-identicos. Los sidecars
    `-wal`/`-shm` SI pueden aparecer o cambiar: SQLite los crea y actualiza para
    dar servicio a cualquier lector de una base en WAL. Lo que se exige de ellos
    es que el `-wal` no crezca con datos nuevos escritos por el backup.
    """
    main_before, side_before = fixtures.split_sidecars(before)
    main_after, side_after = fixtures.split_sidecars(after)
    assert main_before == main_after, (
        f"{context}: datos fuente modificados: "
        f"{sorted(set(main_before.items()) ^ set(main_after.items()))[:4]}"
    )
    for name, meta in side_after.items():
        if name.endswith("-wal") and name not in side_before:
            assert meta[0] == 0, f"{context}: el backup dejo un -wal con datos: {name} ({meta[0]} B)"


def case(cid: str, title: str):
    def wrapper(fn):
        fn._case = (cid, title)
        return fn
    return wrapper


# --------------------------------------------------------------------------
# Casos 1-7 — configuracion, preflight, concurrencia
# --------------------------------------------------------------------------

@case("01", "configuracion ausente")
def test_config_missing():
    env = Env("c01")
    os.unlink(env.secrets["env_path"])
    proc = env.run("structured_backup.py", expect=errors.ConfigError.exit_code)
    assert "ausente" in proc.stderr, proc.stderr
    assert not env.repo_initialized(), "sin configuracion no debe crearse repositorio"


@case("02", "permisos inseguros en backup.env y restic-password")
def test_insecure_permissions():
    env = Env("c02", mode=0o644)
    proc = env.run("structured_backup.py", expect=errors.ConfigError.exit_code)
    assert "permisos inseguros" in proc.stderr, proc.stderr

    env2 = Env("c02b")
    os.chmod(env2.secrets["password_path"], 0o644)
    proc2 = env2.run("structured_backup.py", expect=errors.ConfigError.exit_code)
    assert "permisos inseguros" in proc2.stderr, proc2.stderr

    env3 = Env("c02c")
    os.chown(env3.secrets["env_path"], 1000, 1000)
    proc3 = env3.run("structured_backup.py", expect=errors.ConfigError.exit_code)
    assert "propietario incorrecto" in proc3.stderr, proc3.stderr


@case("03", "variables incompletas y claves prohibidas")
def test_incomplete_vars():
    env = Env("c03", omit=("AWS_DEFAULT_REGION",))
    proc = env.run("structured_backup.py", expect=errors.ConfigError.exit_code)
    assert "AWS_DEFAULT_REGION" in proc.stderr, proc.stderr

    env2 = Env("c03b", extra_lines=("RESTIC_PASSWORD=deberia-ser-rechazada",))
    proc2 = env2.run("structured_backup.py", expect=errors.ConfigError.exit_code)
    assert "prohibida" in proc2.stderr, proc2.stderr

    env3 = Env("c03c")
    # RESTIC_PASSWORD_FILE apuntando fuera de la ruta prevista.
    data = open(env3.secrets["env_path"], encoding="utf-8").read()
    os.chmod(env3.secrets["env_path"], 0o600)
    with open(env3.secrets["env_path"], "w", encoding="utf-8") as handle:
        handle.write(data.replace(env3.secrets["password_path"], "/tmp/otra-passphrase"))
    os.chmod(env3.secrets["env_path"], 0o400)
    proc3 = env3.run("structured_backup.py", expect=errors.ConfigError.exit_code)
    assert "no apunta a la ruta prevista" in proc3.stderr, proc3.stderr


@case("04", "destino no vacio que no es repositorio restic")
def test_unknown_repository():
    env = Env("c04")
    os.makedirs(env.repo, exist_ok=True)
    with open(os.path.join(env.repo, "objeto-desconocido.bin"), "wb") as handle:
        handle.write(os.urandom(64))
    proc = env.run("structured_backup.py", expect=errors.RepositoryUnknownError.exit_code)
    assert "no es un repositorio restic identificable" in proc.stderr, proc.stderr
    assert os.path.exists(os.path.join(env.repo, "objeto-desconocido.bin")), "no debe tocar el destino"


@case("05", "espacio insuficiente en staging")
def test_insufficient_space():
    env = Env("c05")
    inflate_db(os.path.join(env.base, "data-critical/events.db"), 20000)
    small_work = os.path.join(LOWSPACE, "work")
    proc = subprocess.run(
        [
            sys.executable, os.path.join(RUNNERS_DIR, "structured_backup.py"),
            "--config-dir", env.config_dir, "--base-dir", env.base,
            "--work-dir", small_work, "--lock-path", env.lock,
        ],
        capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == errors.InsufficientStagingSpace.exit_code, (
        f"rc={proc.returncode} stderr={proc.stderr[-400:]}"
    )
    assert "espacio insuficiente" in proc.stderr, proc.stderr
    assert not os.path.isdir(os.path.join(env.repo, "data")), "no debe iniciar staging ni repo"


@case("06", "inodos insuficientes en staging")
def test_insufficient_inodes():
    env = Env("c06")
    st = os.statvfs(LOWINO)
    assert st.f_files > 0, "el filesystem de prueba debe reportar inodos"
    ino_work = os.path.join(LOWINO, "work")
    proc = subprocess.run(
        [
            sys.executable, os.path.join(RUNNERS_DIR, "structured_backup.py"),
            "--config-dir", env.config_dir, "--base-dir", env.base,
            "--work-dir", ino_work, "--lock-path", env.lock,
        ],
        capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == errors.InsufficientStagingSpace.exit_code, (
        f"rc={proc.returncode} stderr={proc.stderr[-400:]}"
    )
    assert "inodos insuficientes" in proc.stderr, proc.stderr


@case("07", "ejecucion concurrente rechazada por el lock compartido")
def test_concurrency():
    env = Env("c07")
    with SharedLock(env.lock):
        proc = env.run("structured_backup.py", expect=errors.LockBusy.exit_code)
        assert "lock" in proc.stderr, proc.stderr
        # El lock es COMPARTIDO entre los tres runners.
        proc2 = env.run("uploads_backup.py", expect=errors.LockBusy.exit_code)
        assert "lock" in proc2.stderr
        proc3 = env.run("verify_backup.py", expect=errors.LockBusy.exit_code)
        assert "lock" in proc3.stderr
    # Liberado el lock, el runner vuelve a operar.
    env.run("structured_backup.py", expect=0)


# --------------------------------------------------------------------------
# Casos 8-10 — SQLite
# --------------------------------------------------------------------------

@case("08", "SQLite valida: copia consistente, fuente intacta")
def test_sqlite_valid():
    env = Env("c08")
    src = os.path.join(env.base, "data/progress.db")
    before = fixtures.snapshot_tree(env.base)
    dest = os.path.join(env.work, "progress.copy.db")
    log = SafeLogger("t", "t", stream=open(os.devnull, "w"))
    result = capture_sqlite(src, dest, log)
    assert result["integrity_result"] == "ok"
    assert result["capture_method"] == "sqlite_online_backup_api"
    assert len(result["sha256"]) == 64
    assert result["bytes"] > 0
    after = fixtures.snapshot_tree(env.base)
    assert_sources_untouched(before, after, "captura SQLite")
    # El .db en si debe ser byte-identico, explicitamente.
    assert before["data/progress.db"] == after["data/progress.db"], "el .db fuente cambio"
    assert source_journal_mode(src) == "wal"


@case("09", "SQLite corrupta: falla cerrado y descarta la copia")
def test_sqlite_corrupt():
    env = Env("c09")
    corrupt = os.path.join(env.base, "data/progress.db")
    with open(corrupt, "wb") as handle:
        handle.write(b"NO-SOY-UNA-BASE-SQLITE" * 100)
    for side in ("-wal", "-shm"):
        if os.path.exists(corrupt + side):
            os.unlink(corrupt + side)
    dest = os.path.join(env.work, "corrupt.copy.db")
    log = SafeLogger("t", "t", stream=open(os.devnull, "w"))
    try:
        capture_sqlite(corrupt, dest, log)
        raise AssertionError("la captura de una base corrupta debio fallar")
    except errors.SqliteCaptureError:
        pass
    assert not os.path.exists(dest), "la copia invalida debe eliminarse"
    # Y el runner completo falla cerrado, sin crear snapshot.
    proc = env.run("structured_backup.py", expect=errors.SqliteCaptureError.exit_code)
    assert "STOP — BACKUP-01B SQLITE CONSISTENCY NOT PROVEN" in proc.stderr
    assert env.staging_dirs() == [], "staging no limpiado tras el fallo"


@case("10", "SQLite WAL con escritor concurrente durante la copia")
def test_sqlite_wal_concurrent():
    env = Env("c10")
    src = os.path.join(env.base, "data-critical/events.db")
    inflate_db(src, 8000)
    before_mode = source_journal_mode(src)
    assert before_mode == "wal"

    writer = sqlite3.connect(src, timeout=30.0)
    writer.execute("CREATE TABLE IF NOT EXISTS concurrent(id INTEGER PRIMARY KEY, v TEXT)")
    writer.commit()

    inserted = {"n": 0}

    import threading
    stop = threading.Event()

    def churn():
        conn = sqlite3.connect(src, timeout=30.0)
        while not stop.is_set():
            conn.execute("INSERT INTO concurrent(v) VALUES ('live')")
            conn.commit()
            inserted["n"] += 1
            time.sleep(0.001)
        conn.close()

    thread = threading.Thread(target=churn, daemon=True)
    thread.start()
    time.sleep(0.05)
    dest = os.path.join(env.work, "events.copy.db")
    log = SafeLogger("t", "t", stream=open(os.devnull, "w"))
    result = capture_sqlite(src, dest, log)
    stop.set()
    thread.join(timeout=10)
    writer.close()

    assert inserted["n"] > 0, "el escritor concurrente no llego a escribir"
    assert result["integrity_result"] == "ok", "la copia bajo escritura no es integra"
    # La copia es utilizable y coherente.
    conn = sqlite3.connect(f"file:{dest}?mode=ro", uri=True)
    assert conn.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    rows = conn.execute("SELECT count(*) FROM bulk").fetchone()[0]
    conn.close()
    assert rows == 8000, f"copia incoherente: bulk={rows}"
    assert source_journal_mode(src) == "wal", "el journal_mode de la fuente cambio"


# --------------------------------------------------------------------------
# Casos 11-12 — JSON
# --------------------------------------------------------------------------

@case("11", "JSON valido: hash, conteo agregado y captura")
def test_json_valid():
    env = Env("c11")
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    by_path = {s["logical_path"]: s for s in manifest["stores"]}
    groups = by_path["data/groups_db.json"]
    assert groups["kind"] == "json"
    assert groups["integrity_result"] == "ok"
    assert len(groups["sha256"]) == 64
    assert groups["aggregate_count"] == 5, groups


@case("12", "JSON invalido: falla ANTES de restic")
def test_json_invalid():
    env = Env("c12")
    env.run("structured_backup.py", expect=0)
    before = len(env.snapshots())
    target = os.path.join(env.base, "data/content.json")
    with open(target, "w", encoding="utf-8") as handle:
        handle.write('{"roto": ')
    proc = env.run("structured_backup.py", expect=errors.JsonInvalidError.exit_code)
    assert "JSON invalido" in proc.stderr, proc.stderr
    assert len(env.snapshots()) == before, "no debe crearse snapshot con JSON invalido"
    assert env.staging_dirs() == [], "staging no limpiado"


# --------------------------------------------------------------------------
# Casos 13-16 — uploads, idempotencia, deduplicacion
# --------------------------------------------------------------------------

@case("13", "uploads vacios")
def test_uploads_empty():
    env = Env("c13", uploads_files=0)
    env.run("uploads_backup.py", expect=0)
    manifest = env.manifests()[-1]
    assert manifest["uploads_file_count"] == 0, manifest
    assert manifest["uploads_total_bytes"] == 0, manifest
    assert len(env.snapshots(tag="uploads")) == 1


@case("14", "uploads multiples, sin copia local")
def test_uploads_multiple():
    env = Env("c14", uploads_files=8)
    env.run("uploads_backup.py", expect=0)
    manifest = env.manifests()[-1]
    assert manifest["uploads_file_count"] == 8, manifest
    assert manifest["uploads_total_bytes"] == 8 * 20000, manifest
    # Invariante clave: NADA de los uploads quedo copiado localmente.
    assert env.staging_dirs() == []
    total_work = sum(
        os.path.getsize(os.path.join(dp, f))
        for dp, _dn, fn in os.walk(env.work)
        for f in fn
        if "cache" not in dp
    )
    uploads_bytes = manifest["uploads_total_bytes"]
    assert total_work < uploads_bytes, (
        f"el work dir ({total_work} B) sugiere copia local de uploads ({uploads_bytes} B)"
    )


@case("15", "segunda ejecucion sin cambios")
def test_second_run_no_changes():
    env = Env("c15")
    env.run("structured_backup.py", expect=0)
    before = fixtures.snapshot_tree(env.base)
    env.run("structured_backup.py", expect=0)
    after = fixtures.snapshot_tree(env.base)
    assert_sources_untouched(before, after, "segunda ejecucion")
    assert len(env.snapshots(tag="structured")) == 2


@case("16", "cambio parcial y deduplicacion real de restic")
def test_partial_change_dedup():
    env = Env("c16", uploads_files=10)
    first = Env.backup_summary(env.run("uploads_backup.py", expect=0))
    assert first["files_new"] == 10, first

    second = Env.backup_summary(env.run("uploads_backup.py", expect=0))
    assert second["files_new"] == 0, second
    assert second["files_unmodified"] == 10, second
    assert second["data_added"] < first["data_added"] / 10, (
        f"sin deduplicacion: primera={first['data_added']} segunda={second['data_added']}"
    )

    # Cambio parcial: un unico archivo modificado de diez.
    target = os.path.join(env.base, fixtures.UPLOADS_REL, "asset3")
    with open(target, "wb") as handle:
        handle.write(os.urandom(20000))
    third = Env.backup_summary(env.run("uploads_backup.py", expect=0))
    assert third["files_changed"] == 1, third
    assert third["files_unmodified"] == 9, third
    assert third["data_added"] < first["data_added"] / 2, (
        f"el cambio parcial no se deduplico: {third['data_added']} vs {first['data_added']}"
    )


# --------------------------------------------------------------------------
# Casos 17-20 — leo, interrupcion, error de restic, limpieza
# --------------------------------------------------------------------------

@case("17", "leo_* incluidos, etiquetados y sin exposicion")
def test_leo_no_exposure():
    env = Env("c17")
    proc = env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    leo = [s for s in manifest["stores"] if "leo_" in s["logical_path"]]
    assert len(leo) == 3, f"se esperaban 3 stores leo_*, hay {len(leo)}"
    for store in leo:
        assert store["sensitivity"] == "minors", store
        assert store["retention_status"] == "NEEDS_LEGAL_REVIEW", store
        assert "aggregate_count" not in store, f"conteo individualizable en {store['logical_path']}"
        assert len(store["sha256"]) == 64
    # Ni el manifiesto ni los logs contienen contenido de los stores leo_*.
    blob = json.dumps(manifest) + proc.stdout + proc.stderr
    for needle in ("sessions", "evidence", "turn"):
        assert f'"{needle}"' not in blob, f"posible contenido leo_* expuesto: {needle}"
    assert audit_manifest(manifest) == []


@case("18", "interrupcion: staging limpiado y lock liberado")
def test_interruption():
    # 18a — contrato de limpieza ante interrupcion (determinista, en proceso).
    env = Env("c18")
    staged_path = None
    try:
        with StagingArea(env.work) as staging:
            staged_path = staging.path
            os.makedirs(os.path.join(staging.path, "sqlite"), exist_ok=True)
            raise KeyboardInterrupt("interrupcion sintetica")
    except KeyboardInterrupt:
        pass
    assert staged_path and not os.path.exists(staged_path), "staging no limpiado tras interrupcion"

    # 18b — SIGTERM real a mitad de staging.
    env2 = Env("c18b")
    inflate_db(os.path.join(env2.base, "data-critical/events.db"), 120000)
    proc = env2.popen("structured_backup.py")
    seen = False
    deadline = time.time() + 60
    while time.time() < deadline:
        if env2.staging_dirs():
            seen = True
            break
        if proc.poll() is not None:
            break
        time.sleep(0.02)
    assert seen, "no se observo staging en vuelo: prueba no concluyente"
    proc.send_signal(signal.SIGTERM)
    proc.communicate(timeout=120)
    assert proc.returncode != 0, "la interrupcion debe reflejarse en el codigo de salida"
    assert env2.staging_dirs() == [], "staging huerfano tras SIGTERM"
    with SharedLock(env2.lock):
        pass  # si esto no lanza, el lock quedo libre


@case("19", "error real de restic propagado con codigo claro")
def test_restic_error():
    fill_filesystem(FULLFS)
    env = Env("c19", repository=os.path.join(FULLFS, "repo"))
    proc = env.run("structured_backup.py", expect=errors.ResticError.exit_code)
    assert "restic" in proc.stderr, proc.stderr
    assert env.staging_dirs() == [], "staging no limpiado tras error de restic"


@case("20", "limpieza posterior al error, sin borrar fuentes ni repositorio")
def test_cleanup_after_error():
    env = Env("c20")
    env.run("structured_backup.py", expect=0)
    snaps_before = len(env.snapshots())
    sources_before = fixtures.snapshot_tree(env.base)

    with open(os.path.join(env.base, "data/access_db.json"), "w", encoding="utf-8") as handle:
        handle.write("{no-json")
    env.run("structured_backup.py", expect=errors.JsonInvalidError.exit_code)

    assert env.staging_dirs() == [], "temporales huerfanos"
    assert len(env.snapshots()) == snaps_before, "se perdieron o anadieron snapshots"
    after = fixtures.snapshot_tree(env.base)
    del after["data/access_db.json"], sources_before["data/access_db.json"]
    assert_sources_untouched(sources_before, after, "limpieza tras error")
    with SharedLock(env.lock):
        pass


# --------------------------------------------------------------------------
# Casos 21-24 — invariantes de seguridad
# --------------------------------------------------------------------------

@case("21", "ausencia total de forget/prune/eliminacion")
def test_no_destructive():
    env = Env("c21")
    env.run("structured_backup.py", expect=0)
    restic = env.restic()
    for args in (
        ["forget"],
        ["forget", "--dry-run"],
        ["forget", "--keep-daily", "7"],
        ["prune"],
        ["rm"],
        ["unlock"],
        ["backup", "--prune", "/tmp"],
    ):
        try:
            restic.run(args)
            raise AssertionError(f"no se rechazo: restic {' '.join(args)}")
        except errors.DestructiveCommandRejected:
            pass
    # El repositorio sigue intacto tras los intentos.
    assert len(env.snapshots()) == 1

    # Barrido estatico complementario: busca INVOCACIONES, no prosa. La
    # allowlist (restic.py) y esta misma prueba quedan excluidas porque su
    # cometido es, precisamente, nombrar y rechazar esos subcomandos.
    import re
    # En Python, restic solo se invoca via Restic.run([...]): se busca esa forma.
    # La prosa de docstrings puede nombrar `restic forget` para prohibirlo, y eso
    # no es una invocacion: por eso el patron shell se aplica solo a .sh/.service.
    py_invocation = re.compile(
        r"""\.run\(\s*\[\s*["'](forget|prune|rm|remove|delete)["']"""
        r"""|subprocess\.[a-z_]+\(\s*\[?\s*["']restic["']\s*,\s*["'](forget|prune)["']"""
    )
    sh_invocation = re.compile(r"""^[^#\n]*\brestic\s+(forget|prune|rm|remove)\b""", re.MULTILINE)

    offenders = []
    for dirpath, _dn, filenames in os.walk(UNIT_DIR):
        if "__pycache__" in dirpath:
            continue
        for name in filenames:
            if name in ("restic.py", "test_suite.py", "run_all.sh"):
                continue  # allowlist, su prueba y el orquestador que la audita
            if name.endswith(".py"):
                pattern = py_invocation
            elif name.endswith((".sh", ".service", ".timer")):
                pattern = sh_invocation
            else:
                continue
            path = os.path.join(dirpath, name)
            text = open(path, encoding="utf-8", errors="replace").read()
            for match in pattern.finditer(text):
                offenders.append(f"{name}: {match.group(0).strip()[:60]}")
    assert not offenders, f"invocacion destructiva fuera de la allowlist: {offenders}"


@case("22", "ausencia de secretos en stdout/stderr")
def test_no_secret_leak():
    env = Env("c22")
    outputs = []
    outputs.append(env.run("structured_backup.py", expect=0))
    outputs.append(env.run("uploads_backup.py", expect=0))
    outputs.append(env.run("verify_backup.py"))
    blob = "".join(p.stdout + p.stderr for p in outputs)
    assert blob.strip(), "los runners no emitieron salida: la prueba seria vacua"
    for label in ("passphrase", "access_key", "secret_key"):
        assert env.secrets[label] not in blob, f"FUGA de {label} en la salida de los runners"
    # Tampoco en los manifiestos.
    for manifest in env.manifests():
        text = json.dumps(manifest)
        for label in ("passphrase", "access_key", "secret_key"):
            assert env.secrets[label] not in text, f"FUGA de {label} en manifiesto"
        assert audit_manifest(manifest) == []


@case("23", "cero modificacion de las fuentes")
def test_sources_untouched():
    env = Env("c23")
    before = fixtures.snapshot_tree(env.base)
    modes_before = {
        rel: source_journal_mode(os.path.join(env.base, rel))
        for rel, _t, _r in fixtures.SQLITE_FIXTURES
    }
    env.run("structured_backup.py", expect=0)
    env.run("uploads_backup.py", expect=0)
    env.run("verify_backup.py")
    after = fixtures.snapshot_tree(env.base)
    assert_sources_untouched(before, after, "ciclo completo de los 3 runners")
    # Cada .db, explicitamente byte-identico.
    for rel, _t, _r in fixtures.SQLITE_FIXTURES:
        assert before[rel] == after[rel], f"el .db fuente cambio: {rel}"
    modes_after = {
        rel: source_journal_mode(os.path.join(env.base, rel))
        for rel, _t, _r in fixtures.SQLITE_FIXTURES
    }
    assert modes_before == modes_after == {rel: "wal" for rel, _t, _r in fixtures.SQLITE_FIXTURES}


@case("24", "idempotencia de ejecuciones repetidas")
def test_idempotency():
    env = Env("c24")
    for _ in range(3):
        env.run("structured_backup.py", expect=0)
        env.run("uploads_backup.py", expect=0)
    assert len(env.snapshots(tag="structured")) == 3
    assert len(env.snapshots(tag="uploads")) == 3
    env.run("verify_backup.py", expect=0)
    manifests = env.manifests()
    assert len(manifests) == 6
    run_ids = {m["run_id"] for m in manifests}
    assert len(run_ids) == 6, "los run_id deben ser unicos"
    for manifest in manifests:
        assert manifest["result"] == "ok"
        assert manifest["schema_version"] == 1


# --------------------------------------------------------------------------
# Integracion restic (escenarios 1-16 de la Fase 9)
# --------------------------------------------------------------------------

@case("I1", "integracion: init / structured / uploads / snapshots / check")
def test_integration_core():
    env = Env("i1", uploads_files=5)
    assert not os.path.exists(env.repo)
    env.run("structured_backup.py", expect=0)  # 1 init + 2 structured
    assert os.path.isdir(os.path.join(env.repo, "data")), "restic init no creo el repositorio"
    env.run("uploads_backup.py", expect=0)  # 3 uploads
    snaps = env.snapshots()  # 4 snapshots
    tags = [t for s in snaps for t in (s.get("tags") or [])]
    assert "structured" in tags and "uploads" in tags, tags
    assert env.restic().check() is True  # 5 check
    # 12 repositorio valido existente: la segunda corrida lo reutiliza.
    env.run("structured_backup.py", expect=0)
    assert len(env.snapshots(tag="structured")) == 2


@case("I2", "integracion: passphrase incorrecta falla cerrado y no destruye")
def test_integration_wrong_passphrase():
    env = Env("i2")
    env.run("structured_backup.py", expect=0)
    config_before = fixtures.snapshot_tree(env.repo)

    os.chmod(env.secrets["password_path"], 0o600)
    with open(env.secrets["password_path"], "w", encoding="utf-8") as handle:
        handle.write("passphrase-sintetica-incorrecta")
    os.chmod(env.secrets["password_path"], 0o400)

    proc = env.run("structured_backup.py")
    assert proc.returncode != 0, "una passphrase incorrecta debe fallar"
    assert proc.returncode == errors.RepositoryUnknownError.exit_code, proc.returncode
    config_after = fixtures.snapshot_tree(env.repo)
    assert config_before == config_after, "el repositorio fue alterado con passphrase incorrecta"


@case("I3", "integracion: repositorio inexistente se inicializa; ruta imposible falla")
def test_integration_missing_repo():
    env = Env("i3")
    assert not os.path.exists(env.repo)
    env.run("structured_backup.py", expect=0)
    assert os.path.isdir(os.path.join(env.repo, "data"))

    env2 = Env("i3b", repository="/proc/imposible/repo")
    proc = env2.run("structured_backup.py")
    assert proc.returncode != 0, "una ruta de repositorio imposible debe fallar"


@case("I4", "integracion: manifiesto viaja dentro del snapshot")
def test_integration_manifest_in_snapshot():
    env = Env("i4")
    env.run("structured_backup.py", expect=0)
    snaps = env.snapshots(tag="structured")
    assert len(snaps) == 1
    local = env.manifests()[-1]
    assert local["backup_type"] == "structured"
    assert local["stores"], "el manifiesto no registro stores"
    assert local["logical_host"] == "chibalete-prod"
    assert local["runner_version"]
    assert local["duration_seconds"] >= 0
    assert local["warnings"] == []
    kinds = {s["kind"] for s in local["stores"]}
    assert kinds == {"sqlite", "json"}, kinds
    methods = {s["capture_method"] for s in local["stores"]}
    assert "sqlite_online_backup_api" in methods


@case("I5", "integracion: verify no destructivo detecta repositorio sano")
def test_integration_verify():
    env = Env("i5")
    env.run("structured_backup.py", expect=0)
    env.run("uploads_backup.py", expect=0)
    proc = env.run("verify_backup.py", expect=0)
    assert '"restic_check"' in proc.stdout
    assert '"result": "ok"' in proc.stdout or '"result":"ok"' in proc.stdout
    snaps_before = len(env.snapshots())
    env.run("verify_backup.py", expect=0)
    assert len(env.snapshots()) == snaps_before, "verify no debe alterar snapshots"


# --------------------------------------------------------------------------
# systemd
# --------------------------------------------------------------------------

@case("S1", "systemd-analyze verify sin advertencias textuales")
def test_systemd_units():
    staging = "/opt/chibalete-backup"
    units_tmp = "/work/units"
    os.makedirs(units_tmp, exist_ok=True)
    for name in os.listdir(SYSTEMD_DIR):
        target = os.path.join(units_tmp, name)
        shutil.copy(os.path.join(SYSTEMD_DIR, name), target)
        # Las units deben instalarse 0644: systemd avisa si son ejecutables.
        os.chmod(target, 0o644)

    assert os.path.isdir(staging), (
        "las units apuntan a /opt/chibalete-backup: debe existir para validar ExecStart"
    )
    problems = []
    for name in sorted(os.listdir(units_tmp)):
        proc = subprocess.run(
            ["systemd-analyze", "verify", os.path.join(units_tmp, name)],
            capture_output=True, text=True, timeout=120,
        )
        combined = (proc.stdout + proc.stderr).strip()
        if proc.returncode != 0:
            problems.append(f"{name}: rc={proc.returncode}")
        for marker in ("Unknown key", "Failed", "error", "Ignoring", "ignoring", "not executable"):
            if marker.lower() in combined.lower():
                problems.append(f"{name}: '{marker}' -> {combined[:200]}")
    assert not problems, "; ".join(problems)

    # Ninguna unit ejecuta retencion destructiva: se inspeccionan las
    # directivas efectivas, ignorando comentarios.
    for name in os.listdir(SYSTEMD_DIR):
        for raw in open(os.path.join(SYSTEMD_DIR, name), encoding="utf-8"):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            lowered = line.lower()
            for bad in ("forget", "prune", "restic rm", "--keep-"):
                assert bad not in lowered, f"{name}: directiva destructiva '{bad}' -> {line}"
    # Cadencias exigidas.
    structured = open(os.path.join(SYSTEMD_DIR, "structured-backup.timer"), encoding="utf-8").read()
    assert "00,06,12,18:00:00" in structured
    uploads = open(os.path.join(SYSTEMD_DIR, "uploads-backup.timer"), encoding="utf-8").read()
    assert "*-*-* 03:30:00" in uploads
    verify = open(os.path.join(SYSTEMD_DIR, "backup-verify.timer"), encoding="utf-8").read()
    assert "Sun " in verify


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

def main() -> int:
    os.makedirs(WORK_ROOT, exist_ok=True)
    tests = [obj for name, obj in sorted(globals().items()) if callable(obj) and hasattr(obj, "_case")]
    tests.sort(key=lambda fn: fn._case[0])
    failures = 0
    for fn in tests:
        cid, title = fn._case
        started = time.time()
        try:
            fn()
            elapsed = time.time() - started
            print(f"  PASS  [{cid}] {title}  ({elapsed:.1f}s)")
            RESULTS.append((cid, title, "PASS"))
        except Exception as exc:  # noqa: BLE001 - reporte explicito
            failures += 1
            print(f"  FAIL  [{cid}] {title}")
            print(f"        {type(exc).__name__}: {exc}")
            RESULTS.append((cid, title, f"FAIL: {type(exc).__name__}"))
    print()
    print(f"=== RESUMEN: {len(tests) - failures}/{len(tests)} PASS ===")
    print("SUITE_RESULT=" + ("GREEN" if failures == 0 else "RED"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
