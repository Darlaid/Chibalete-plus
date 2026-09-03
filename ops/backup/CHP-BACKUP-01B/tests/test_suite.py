#!/usr/bin/env python3
"""Suite funcional de CHP-BACKUP-01B.

Ejecutar SIEMPRE dentro del toolchain Linux aislado (ver ../README.md):
restic real, red deshabilitada, fixtures y passphrases sinteticas.

Cubre los 24 casos obligatorios, los escenarios de integracion con restic, el
preflight S3 firmado (P01-P28) y el cierre del auto-init local (L01-L08).
Las pruebas ejercitan comportamiento real: nada se sustituye por inspeccion de
texto salvo los barridos estaticos explicitamente marcados como
complementarios.

Desde CHP-BACKUP-01B-1-R3A ningun runner ordinario inicializa un destino vacio
—ni S3 ni filesystem—: los casos historicos que dependian del auto-init local
provisionan el repositorio explicitamente con `Env.provision_repository()`, que
es lo que hace la orden manual de provision.
"""

import ast
import datetime
import glob
import hashlib
import hmac
import http.server
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
UNIT_DIR = os.path.dirname(HERE)
RUNNERS_DIR = os.path.join(UNIT_DIR, "runners")
SYSTEMD_DIR = os.path.join(UNIT_DIR, "systemd")

sys.path.insert(0, RUNNERS_DIR)
sys.path.insert(0, HERE)

import fixtures  # noqa: E402
import sandbox  # noqa: E402
from chibalete_backup import errors  # noqa: E402
from chibalete_backup.config import load_config  # noqa: E402
from chibalete_backup.locking import SharedLock, StagingArea  # noqa: E402
from chibalete_backup.manifest import audit_manifest  # noqa: E402
from chibalete_backup import s3_preflight  # noqa: E402
from chibalete_backup.restic import Restic  # noqa: E402
from chibalete_backup.s3_preflight import RemoteState, ScopeVerdict  # noqa: E402
from chibalete_backup.safelog import SafeLogger  # noqa: E402
from chibalete_backup.sqlite_capture import capture_sqlite, source_journal_mode  # noqa: E402

# CHP-BACKUP-TEST-SANDBOX-GUARD-01 — el harness ya NO acepta rutas absolutas ni
# redirecciones. Crea su propio root bajo /tmp y todo cuelga de el.
#
# Antes habia cuatro rutas absolutas hardcodeadas: WORK_ROOT (redirigible con
# CHP_TEST_ROOT), y los tmpfs `/lowspace`, `/lowino` y `/fullfs`. Fuera del
# contenedor esas rutas se materializaban en el disco real y el caso de
# «filesystem lleno» escribia lastre hasta agotarlo. Sustituidas por el sandbox
# y por inyeccion de fallos determinista (sandbox.statvfs_fault_env /
# sandbox.enospc_restic_env): cero lastre, cero rutas absolutas.
SANDBOX_ROOT = None   # lo fija main(); ningun test debe escribir antes.
WORK_ROOT = None

RESULTS: list[tuple[str, str, str]] = []

class ToolUnavailable(RuntimeError):
    """La comprobacion no puede ejecutarse aqui: se reporta SKIP, no PASS."""


# --------------------------------------------------------------------------
# Utilidades
# --------------------------------------------------------------------------

# Contenido sintetico de la topologia Compose. Ni imagenes ni secretos reales:
# solo lo justo para que sea un YAML plausible y distinguible entre ambos.
# CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B: la topologia anade exactamente
# estas entradas al manifiesto. Los conteos historicos de stores se expresan
# como `<datos> + TOPOLOGY_STORE_COUNT` para que siga leyendose que la cifra de
# datos no cambio y que el unico delta es la topologia.
TOPOLOGY_STORE_COUNT = 2

TOPOLOGY_FIXTURE = {
    "docker-compose.yml": """services:
  front:
    image: synthetic/front:base
  api_1:
    image: synthetic/api:base
    env_file:
      - .env
""",
    "docker-compose.override.yml": """services:
  front:
    image: synthetic/front:override
  api_1:
    image: synthetic/api:override
""",
}


def build_topology(path: str) -> None:
    """Crea el directorio de topologia sintetico de un entorno de prueba.

    Ademas de los dos Compose escribe el ruido que el directorio real tiene y
    que NUNCA debe entrar al backup: .env y copias ad-hoc.
    """
    os.makedirs(path, exist_ok=True)
    for name, body in TOPOLOGY_FIXTURE.items():
        with open(os.path.join(path, name), "w", encoding="utf-8") as handle:
            handle.write(body)
    # Ruido deliberado: si alguna vez se recorriera el directorio, estos
    # apareceran en el manifiesto y las pruebas TP06/TP07 lo detectarian.
    noise = {
        ".env": "SYNTHETIC_NOT_A_SECRET=placeholder",
        "docker-compose.override.yml.bak-pre-x-1": "services: {}",
        "docker-compose.yml.bak.2026": "services: {}",
    }
    for name, body in noise.items():
        with open(os.path.join(path, name), "w", encoding="utf-8") as handle:
            handle.write(body)

def fresh(name: str) -> str:
    """Directorio limpio para un caso, SIEMPRE validado contra el sandbox.

    `assert_path_allowed` es la puerta: rechaza rutas vacias, relativas, con
    `..`, con symlinks que escapen, y cualquier cosa fuera del root o dentro de
    una ruta prohibida. `safe_rmtree` aplica la misma validacion antes de
    borrar, asi que un `name` malicioso no puede convertirse en un rm -rf.
    """
    if WORK_ROOT is None:
        raise sandbox.SandboxViolation("sandbox no inicializado: no se escribe nada")
    path = sandbox.assert_path_allowed(os.path.join(WORK_ROOT, name), SANDBOX_ROOT)
    if os.path.exists(path):
        sandbox.safe_rmtree(path, SANDBOX_ROOT)
    os.makedirs(path, exist_ok=True)
    return path


def systemd_unit_files():
    """Nombres de las units, saltando subdirectorios como `dropins/`.

    Varias comprobaciones trataban cada entrada de `systemd/` como archivo y
    reventaban con IsADirectoryError desde que existe `dropins/`.
    """
    return sorted(
        n for n in os.listdir(SYSTEMD_DIR)
        if os.path.isfile(os.path.join(SYSTEMD_DIR, n))
    )


def simulated_install_dir() -> str:
    """Instalacion SIMULADA del runner, siempre dentro del sandbox.

    Las units declaran `ExecStart=/opt/chibalete-backup/runners/...`, asi que
    `systemd-analyze` necesita que esa ruta exista para validarlas. Antes la
    suite usaba la ruta REAL, que en el VPS es la instalacion productiva y
    `run_all.sh` llegaba a sobrescribir con `cp -r`. Ahora se materializa una
    copia dentro del sandbox y nadie toca `/opt`.
    """
    d = sandbox.assert_path_allowed(
        os.path.join(SANDBOX_ROOT, "opt", "chibalete-backup"), SANDBOX_ROOT)
    if not os.path.isdir(os.path.join(d, "runners")):
        os.makedirs(d, exist_ok=True)
        shutil.copytree(RUNNERS_DIR, os.path.join(d, "runners"), dirs_exist_ok=True)
    return d


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
        self.topology = os.path.join(root, "topology-src")
        os.makedirs(self.base, exist_ok=True)
        os.makedirs(self.work, exist_ok=True)
        os.makedirs(self.topology, exist_ok=True)
        # CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B: la topologia Compose es
        # OBLIGATORIA, asi que todo entorno de prueba debe tenerla o el runner
        # aborta. Contenido sintetico: ninguna imagen ni secreto reales.
        build_topology(self.topology)
        fixtures.build_base(self.base, uploads_files=uploads_files)
        self.secrets = fixtures.build_config(
            self.config_dir,
            repository=config_kw.pop("repository", self.repo),
            cache_dir=os.path.join(self.work, "cache"),
            **config_kw,
        )

    def run(self, runner: str, extra=None, timeout: int = 600, expect=None, env=None):
        cmd = [
            sys.executable,
            os.path.join(RUNNERS_DIR, runner),
            "--config-dir", self.config_dir,
            "--work-dir", self.work,
            "--lock-path", self.lock,
        ]
        if runner != "verify_backup.py":
            cmd += ["--base-dir", self.base]
        # Solo structured_backup.py declara --topology-dir. Pasarselo a los
        # demas produciria "unrecognized arguments".
        if runner == "structured_backup.py":
            cmd += ["--topology-dir", self.topology]
        if extra:
            cmd += extra
        child_env = None
        if env:
            child_env = dict(os.environ)
            child_env.update(env)
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              env=child_env)
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
        if runner == "structured_backup.py":
            cmd += ["--topology-dir", self.topology]
        if extra:
            cmd += extra
        return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def restic(self):
        cfg = load_config(self.config_dir)
        return Restic(cfg, SafeLogger("test", "test", stream=open(os.devnull, "w")))

    def provision_repository(self):
        """Provision manual del repositorio, como la orden de provision real.

        Desde CHP-BACKUP-01B-1-R3A ningun runner ordinario puede inicializar un
        destino vacio —tampoco de filesystem—, asi que los casos historicos que
        antes se apoyaban en el auto-init deben provisionar explicitamente. Se
        usa `ensure_repository` directamente para no crear un snapshot y no
        alterar los conteos que esos casos verifican.
        """
        restic = self.restic()
        assert restic.ensure_repository(initialize_empty_repository=True) == "initialized"
        return restic

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


# `fill_filesystem` fue RETIRADA (CHP-BACKUP-TEST-SANDBOX-GUARD-01). Escribia
# lastre hasta agotar el dispositivo; fuera del contenedor eso era el disco del
# host. El escenario de ENOSPC lo cubre ahora `sandbox.enospc_restic_env`, que
# es determinista y no escribe un solo byte. El caso GS12 falla si el literal
# vuelve a aparecer en el harness.


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
    # Antes: un tmpfs de 1 MB en la ruta absoluta /lowspace. Ahora se inyecta
    # `os.statvfs` en el proceso hijo para que reporte el dispositivo sin
    # bloques libres. Mismo camino de codigo, cero dependencia del host.
    env = Env("c05")
    inflate_db(os.path.join(env.base, "data-critical/events.db"), 2000)
    proc = env.run("structured_backup.py",
                   env=sandbox.statvfs_fault_env(SANDBOX_ROOT, "lowspace"))
    assert proc.returncode == errors.InsufficientStagingSpace.exit_code, (
        f"rc={proc.returncode} stderr={proc.stderr[-400:]}"
    )
    assert "espacio insuficiente" in proc.stderr, proc.stderr
    assert not os.path.isdir(os.path.join(env.repo, "data")), "no debe iniciar staging ni repo"
    assert env.staging_dirs() == [], "no debe quedar staging"


@case("06", "inodos insuficientes en staging")
def test_insufficient_inodes():
    # Antes: tmpfs con `nr_inodes=20` en la ruta absoluta /lowino. Ahora el
    # hijo ve un dispositivo con espacio de sobra pero sin inodos libres, que es
    # justo la rama que distingue este caso del 05.
    env = Env("c06")
    proc = env.run("structured_backup.py",
                   env=sandbox.statvfs_fault_env(SANDBOX_ROOT, "lowino"))
    assert proc.returncode == errors.InsufficientStagingSpace.exit_code, (
        f"rc={proc.returncode} stderr={proc.stderr[-400:]}"
    )
    assert "inodos insuficientes" in proc.stderr, proc.stderr


@case("07", "ejecucion concurrente rechazada por el lock compartido")
def test_concurrency():
    env = Env("c07")
    env.provision_repository()
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
    env.provision_repository()
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
    env.provision_repository()
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
    env.provision_repository()
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
    env.provision_repository()
    env.run("uploads_backup.py", expect=0)
    manifest = env.manifests()[-1]
    assert manifest["uploads_file_count"] == 0, manifest
    assert manifest["uploads_total_bytes"] == 0, manifest
    assert len(env.snapshots(tag="uploads")) == 1


@case("14", "uploads multiples, sin copia local")
def test_uploads_multiple():
    env = Env("c14", uploads_files=8)
    env.provision_repository()
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
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    before = fixtures.snapshot_tree(env.base)
    env.run("structured_backup.py", expect=0)
    after = fixtures.snapshot_tree(env.base)
    assert_sources_untouched(before, after, "segunda ejecucion")
    assert len(env.snapshots(tag="structured")) == 2


@case("16", "cambio parcial y deduplicacion real de restic")
def test_partial_change_dedup():
    env = Env("c16", uploads_files=10)
    env.provision_repository()
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
    env.provision_repository()
    proc = env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    leo = [s for s in manifest["stores"] if "leo_" in s["logical_path"]]
    # 3 originales + leo_profile_db.json, anadido en CHP-BACKUP-01D.
    assert len(leo) == 4, f"se esperaban 4 stores leo_*, hay {len(leo)}"
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
    env2.provision_repository()
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


@case("19", "error real de restic propagado con codigo claro (ENOSPC inyectado)")
def test_restic_error():
    # ESTE es el caso que lleno el disco del VPS: llenaba /fullfs con lastre
    # hasta ENOSPC para que `restic init` fallase. Ahora el ENOSPC se inyecta
    # con un `restic` de pega delante en el PATH, que responde a `version` y
    # falla en todo lo demas con el mensaje real del kernel. Determinista y con
    # cero bytes de lastre; el camino ejercitado —clasificacion del fallo en
    # Restic.run y limpieza del staging— es exactamente el mismo.
    env = Env("c19")
    fault = sandbox.enospc_restic_env(SANDBOX_ROOT)

    # Sin autorizacion ni siquiera se intenta el init: bloquea antes.
    env.run("structured_backup.py", env=fault,
            expect=errors.RepositoryInitNotAuthorized.exit_code)
    assert not os.path.isdir(os.path.join(env.repo, "data")), "se creo un repositorio"

    # Con la autorizacion de provision se llega al init, que falla por ENOSPC.
    proc = env.run("structured_backup.py", extra=["--initialize-empty-repository"],
                   env=fault, expect=errors.ResticError.exit_code)
    assert "restic" in proc.stderr, proc.stderr
    assert "no space left on device" in proc.stderr.lower(), proc.stderr[-400:]
    assert env.staging_dirs() == [], "staging no limpiado tras error de restic"


@case("20", "limpieza posterior al error, sin borrar fuentes ni repositorio")
def test_cleanup_after_error():
    env = Env("c20")
    env.provision_repository()
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
    env.provision_repository()
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
    env.provision_repository()
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
    env.provision_repository()
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
    env.provision_repository()
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
    # 1 init: SOLO con la autorizacion manual de provision + 2 structured.
    env.run("structured_backup.py", extra=["--initialize-empty-repository"], expect=0)
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
    env.provision_repository()
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
    # Sin autorizacion el destino inexistente NO se inicializa.
    env.run("structured_backup.py", expect=errors.RepositoryInitNotAuthorized.exit_code)
    assert not os.path.exists(env.repo), "se creo el repositorio sin autorizacion"
    # Con autorizacion, si.
    env.run("structured_backup.py", extra=["--initialize-empty-repository"], expect=0)
    assert os.path.isdir(os.path.join(env.repo, "data"))

    env2 = Env("i3b", repository="/proc/imposible/repo")
    proc = env2.run("structured_backup.py", extra=["--initialize-empty-repository"])
    assert proc.returncode != 0, "una ruta de repositorio imposible debe fallar"


@case("I4", "integracion: manifiesto viaja dentro del snapshot")
def test_integration_manifest_in_snapshot():
    env = Env("i4")
    env.provision_repository()
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
    assert kinds == {"sqlite", "json", "topology"}, kinds
    methods = {s["capture_method"] for s in local["stores"]}
    assert "sqlite_online_backup_api" in methods


@case("I5", "integracion: verify no destructivo detecta repositorio sano")
def test_integration_verify():
    env = Env("i5")
    env.provision_repository()
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
    # La instalacion simulada vive DENTRO del sandbox. Antes se apuntaba a
    # `/opt/chibalete-backup`, que en el VPS es la instalacion real del runner.
    staging = simulated_install_dir()
    units_tmp = fresh("s1-units")
    for name in systemd_unit_files():
        target = os.path.join(units_tmp, name)
        shutil.copy(os.path.join(SYSTEMD_DIR, name), target)
        # Las units deben instalarse 0644: systemd avisa si son ejecutables.
        os.chmod(target, 0o644)

    assert os.path.isdir(staging), (
        "las units apuntan a /opt/chibalete-backup: debe existir para validar ExecStart"
    )
    # `systemd-analyze` no existe en toda imagen base. Si falta, esta
    # comprobacion no puede ejecutarse: se declara SALTADA de forma explicita,
    # nunca como PASS. El paso 5 de run_all.sh la cubre en el toolchain real.
    if shutil.which("systemd-analyze") is None:
        raise ToolUnavailable("systemd-analyze no esta en esta imagen")
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
    for name in systemd_unit_files():
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
# Preflight S3 (CHP-BACKUP-01B-1-R3) — servidor sintetico y utilidades
# --------------------------------------------------------------------------
#
# Todo lo que sigue es OFFLINE y sobre loopback: un servidor HTTP local que
# imita ListObjectsV2 y los errores de S3. Cero red real, cero Backblaze, cero
# credenciales reales. Las credenciales son sinteticas y solo se usan para
# firmar contra el servidor local.

S3_NS = "http://s3.amazonaws.com/doc/2006-03-01/"

# Host con la forma del endpoint aprobado. Se mantiene separado del path para
# no producir la cadena `<endpoint>/<bucket>` que el barrido de fugas persigue.
B2_HOST_SHAPE = "s3.us-west-004.backblazeb2.com"
B2_REGION_SHAPE = "us-west-004"

SYNTHETIC_BUCKET = "chp-backups-synthetic"
SYNTHETIC_KEY_ID = "005synthetickeyid0000000"
SYNTHETIC_SECRET = "synthetic-secret-key-value-000000"


def _list_xml(keys, prefix: str = "restic-prod/") -> bytes:
    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        f'<ListBucketResult xmlns="{S3_NS}">',
        f"<Name>{SYNTHETIC_BUCKET}</Name><Prefix>{prefix}</Prefix>",
        f"<KeyCount>{len(keys)}</KeyCount><MaxKeys>2</MaxKeys>",
        "<IsTruncated>false</IsTruncated>",
    ]
    for key in keys:
        parts.append(f"<Contents><Key>{key}</Key><Size>1</Size></Contents>")
    parts.append("</ListBucketResult>")
    return "".join(parts).encode("utf-8")


def _error_xml(code: str, message: str = "synthetic") -> bytes:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Error><Code>{code}</Code><Message>{message}</Message>"
        "<RequestId>synthetic-request</RequestId>"
        "<HostId>synthetic-host</HostId></Error>"
    ).encode("utf-8")


class _S3StubHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # silencio: la salida de la suite es el reporte
        pass

    def log_error(self, *args):
        pass

    def _handle(self):
        server = self.server
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)
        prefix = (query.get("prefix") or [""])[0]
        is_list = query.get("list-type") == ["2"]
        auth = self.headers.get("Authorization", "")
        server.seen.append({
            "method": self.command,
            "path": parsed.path,
            "prefix": prefix,
            "is_list": is_list,
            # Se registra SOLO si la cabecera existe y su algoritmo; jamas su valor.
            "authorized": bool(auth),
            "auth_algorithm": auth.split(" ", 1)[0] if auth else "",
        })
        status, body, delay = server.scenario(prefix, is_list, self.command)
        if delay:
            time.sleep(delay)
        self.send_response(status)
        self.send_header("Content-Type", "application/xml")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    do_GET = _handle
    do_HEAD = _handle
    do_PUT = _handle
    do_POST = _handle
    do_DELETE = _handle


class S3Stub:
    """Servidor S3 sintetico en loopback. Se cierra al salir del contexto."""

    def __init__(self, scenario):
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _S3StubHandler)
        self.httpd.scenario = scenario
        self.httpd.seen = []
        self.httpd.daemon_threads = True
        # Un cliente que abandona (timeout, TLS) rompe la escritura: es parte
        # de la prueba, no un fallo del servidor. No debe ensuciar el reporte.
        self.httpd.handle_error = lambda request, client_address: None
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=10)
        return False

    @property
    def port(self) -> int:
        return self.httpd.server_address[1]

    @property
    def seen(self) -> list:
        return self.httpd.seen

    def repository(self, bucket: str = SYNTHETIC_BUCKET, prefix: str = "restic-prod") -> str:
        return f"s3:http://127.0.0.1:{self.port}/{bucket}/{prefix}"

    def target(self, bucket: str = SYNTHETIC_BUCKET, prefix: str = "restic-prod"):
        return s3_preflight.parse_target({
            "RESTIC_REPOSITORY": self.repository(bucket, prefix),
            "AWS_DEFAULT_REGION": "synthetic-region-000",
            "AWS_ACCESS_KEY_ID": SYNTHETIC_KEY_ID,
            "AWS_SECRET_ACCESS_KEY": SYNTHETIC_SECRET,
        })


# Respuesta a todo lo que NO sea ListObjectsV2 (p. ej. el GET de `config` que
# hace restic): la clave no existe. Asi el destino se lee como "sin repositorio"
# y la decision recae, como debe, en el listado firmado.
NO_SUCH_KEY = (404, _error_xml("NoSuchKey"), 0.0)


def scenario_static(status: int, body: bytes, delay: float = 0.0):
    def handler(prefix, is_list, method):
        return (status, body, delay) if is_list else NO_SUCH_KEY
    return handler


def scenario_prefix_aware(approved_response, control_response):
    """Respuesta distinta para el prefijo aprobado y para el de control."""
    def handler(prefix, is_list, method):
        if not is_list:
            return NO_SUCH_KEY
        if prefix.startswith(s3_preflight.APPROVED_PREFIX):
            return approved_response
        return control_response
    return handler


class ScriptedRestic(Restic):
    """Restic real salvo `cat config` e `init`, que se guionizan.

    Permite ejercitar la clasificacion y el contrato de primer init contra el
    servidor S3 sintetico sin necesitar un repositorio restic remoto. La
    allowlist, el guard y toda la logica de `ensure_repository` son los reales.
    """

    def __init__(self, config, cat_rc: int = 1, cat_stderr: str = "", s3_timeout=2.0):
        super().__init__(config, SafeLogger("test", "s3", stream=open(os.devnull, "w")),
                         s3_timeout=s3_timeout)
        self.cat_rc = cat_rc
        self.cat_stderr = cat_stderr
        self.init_calls = 0

    def run(self, args, check: bool = True):
        self._guard(args)
        if args[:2] == ["cat", "config"]:
            return subprocess.CompletedProcess(args, self.cat_rc, "", self.cat_stderr)
        if args[0] == "init":
            self.init_calls += 1
            self.cat_rc = 0  # tras un init correcto el repositorio es legible
            return subprocess.CompletedProcess(args, 0, "created restic repository", "")
        return super().run(args, check=check)


def s3_config(name: str, repository: str):
    """Configuracion valida (root:root 0400) apuntando a `repository`."""
    root = fresh(name)
    config_dir = os.path.join(root, "etc")
    fixtures.build_config(config_dir, repository=repository,
                          access_key=SYNTHETIC_KEY_ID, secret_key=SYNTHETIC_SECRET)
    return load_config(config_dir)


def parse_env(repository: str, **overrides) -> dict:
    env = {
        "RESTIC_REPOSITORY": repository,
        "AWS_DEFAULT_REGION": B2_REGION_SHAPE,
        "AWS_ACCESS_KEY_ID": SYNTHETIC_KEY_ID,
        "AWS_SECRET_ACCESS_KEY": SYNTHETIC_SECRET,
    }
    env.update(overrides)
    return {k: v for k, v in env.items() if v is not None}


def approved_repository(bucket: str = SYNTHETIC_BUCKET, prefix: str = "restic-prod") -> str:
    """`s3:https://<endpoint aprobado>/<bucket>/<prefijo>` sin literal contiguo."""
    return "s3:https://" + B2_HOST_SHAPE + "/" + bucket + "/" + prefix


EMPTY_OK = (200, _list_xml([]), 0.0)
DENIED_403 = (403, _error_xml("AccessDenied"), 0.0)


# --------------------------------------------------------------------------
# Casos P01-P28 — contrato de estados, preflight S3 y primer init
# --------------------------------------------------------------------------

@case("P01", "repositorio existente: sin preflight S3 y sin init")
def test_p_existing_repository():
    with S3Stub(scenario_static(*EMPTY_OK)) as stub:
        config = s3_config("p01", stub.repository())
        restic = ScriptedRestic(config, cat_rc=0)
        assert restic.repository_state() is RemoteState.EXISTING_REPOSITORY
        assert restic.ensure_repository() == "existing"
        assert restic.init_calls == 0, "no debe inicializarse un repositorio existente"
        assert stub.seen == [], "con `cat config` correcto no se consulta S3"


@case("P02", "prefijo aprobado vacio: clasificacion por listado firmado")
def test_p_empty_prefix():
    with S3Stub(scenario_static(*EMPTY_OK)) as stub:
        result = s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
        assert result.state is RemoteState.EMPTY_APPROVED_PREFIX, result.state
        assert result.object_count == 0
        assert len(stub.seen) == 1, stub.seen
        request = stub.seen[0]
        assert request["method"] == "GET", "el preflight solo lee"
        assert request["is_list"], "debe usarse ListObjectsV2"
        assert request["prefix"] == "restic-prod/", request
        assert request["authorized"], "la peticion debe ir firmada"
        assert request["auth_algorithm"] == "AWS4-HMAC-SHA256", request


@case("P03", "prefijo vacio SIN autorizacion: bloqueo y cero init")
def test_p_empty_without_authorization():
    with S3Stub(scenario_static(*EMPTY_OK)) as stub:
        config = s3_config("p03", stub.repository())
        restic = ScriptedRestic(config)
        assert restic.repository_state() is RemoteState.EMPTY_APPROVED_PREFIX
        try:
            restic.ensure_repository()
            raise AssertionError("un prefijo vacio no puede inicializarse sin autorizacion")
        except errors.RepositoryInitNotAuthorized as exc:
            assert "autorizacion manual de provision" in str(exc), str(exc)
        assert restic.init_calls == 0
        assert not any(r["method"] != "GET" for r in stub.seen), "no debe escribirse nada"


@case("P04", "prefijo vacio CON autorizacion: exactamente un init verificado")
def test_p_empty_with_authorization():
    scenario = scenario_prefix_aware(approved_response=EMPTY_OK, control_response=DENIED_403)
    with S3Stub(scenario) as stub:
        config = s3_config("p04", stub.repository())
        restic = ScriptedRestic(config)
        assert restic.ensure_repository(initialize_empty_repository=True) == "initialized"
        assert restic.init_calls == 1, "debe ejecutarse exactamente un init"
        # Se comprobo el alcance de la clave ANTES de inicializar.
        control = [r for r in stub.seen if not r["prefix"].startswith("restic-prod")]
        assert control, "no se verifico el alcance de la credencial"
        assert all(r["method"] == "GET" for r in stub.seen)


@case("P05", "segunda ejecucion tras el init: idempotente, sin reinicializar")
def test_p_second_run_after_init():
    scenario = scenario_prefix_aware(approved_response=EMPTY_OK, control_response=DENIED_403)
    with S3Stub(scenario) as stub:
        config = s3_config("p05", stub.repository())
        restic = ScriptedRestic(config)
        assert restic.ensure_repository(initialize_empty_repository=True) == "initialized"
        requests_after_init = len(stub.seen)
        # Segunda ejecucion, incluso repitiendo la autorizacion.
        assert restic.ensure_repository(initialize_empty_repository=True) == "existing"
        assert restic.init_calls == 1, "la autorizacion no puede reinicializar"
        assert len(stub.seen) == requests_after_init, "no debe repetirse el preflight"
        # Y una ejecucion ordinaria (sin autorizacion) tampoco reinicializa.
        assert restic.ensure_repository() == "existing"
        assert restic.init_calls == 1


@case("P06", "objetos ajenos bajo el prefijo: bloqueo")
def test_p_foreign_objects():
    body = _list_xml(["restic-prod/documento-ajeno.txt", "restic-prod/otro.bin"])
    with S3Stub(scenario_static(200, body)) as stub:
        config = s3_config("p06", stub.repository())
        restic = ScriptedRestic(config)
        assert restic.repository_state() is RemoteState.FOREIGN_OBJECTS_PRESENT
        try:
            restic.ensure_repository(initialize_empty_repository=True)
            raise AssertionError("no se puede inicializar sobre objetos ajenos")
        except errors.RepositoryUnknownError as exc:
            assert "no es un repositorio restic identificable" in str(exc)
        assert restic.init_calls == 0


@case("P07", "restos de init parcial: bloqueo, no se reinicia encima")
def test_p_partial_init_leftovers():
    body = _list_xml(["restic-prod/keys/8f3a", "restic-prod/data/00/deadbeef"])
    with S3Stub(scenario_static(200, body)) as stub:
        config = s3_config("p07", stub.repository())
        # `cat config` falla: el config no llego a escribirse (init interrumpido).
        restic = ScriptedRestic(config, cat_stderr="Fatal: config does not exist")
        assert restic.repository_state() is RemoteState.FOREIGN_OBJECTS_PRESENT
        try:
            restic.ensure_repository(initialize_empty_repository=True)
            raise AssertionError("un init parcial no puede sobrescribirse")
        except errors.RepositoryUnknownError:
            pass
        assert restic.init_calls == 0


@case("P08", "credenciales invalidas: ACCESS_DENIED, nunca vacio")
def test_p_invalid_credentials():
    body = _error_xml("InvalidAccessKeyId")
    with S3Stub(scenario_static(403, body)) as stub:
        config = s3_config("p08", stub.repository())
        restic = ScriptedRestic(config)
        assert restic.repository_state() is RemoteState.ACCESS_DENIED
        try:
            restic.ensure_repository(initialize_empty_repository=True)
            raise AssertionError("una credencial invalida debe bloquear")
        except errors.S3PreflightError as exc:
            assert exc.exit_code == 24
            assert "denegacion de acceso" in str(exc)
        assert restic.init_calls == 0


@case("P09", "acceso denegado al prefijo: bloqueo")
def test_p_access_denied():
    with S3Stub(scenario_static(*DENIED_403)) as stub:
        result = s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
        assert result.state is RemoteState.ACCESS_DENIED
        assert result.error_code == "AccessDenied"
    # Tambien por status, aunque el cuerpo no traiga codigo reconocible.
    with S3Stub(scenario_static(401, b"")) as stub2:
        result2 = s3_preflight.probe_approved_prefix(stub2.target(), timeout=5)
        assert result2.state is RemoteState.ACCESS_DENIED, result2.state


@case("P10", "bucket inexistente: BUCKET_NOT_FOUND")
def test_p_bucket_not_found():
    body = _error_xml("NoSuchBucket")
    with S3Stub(scenario_static(404, body)) as stub:
        config = s3_config("p10", stub.repository())
        restic = ScriptedRestic(config)
        assert restic.repository_state() is RemoteState.BUCKET_NOT_FOUND
        try:
            restic.ensure_repository(initialize_empty_repository=True)
            raise AssertionError("un bucket inexistente debe bloquear")
        except errors.S3PreflightError as exc:
            assert "no existe" in str(exc)


@case("P11", "endpoint incorrecto: redireccion y host no aprobado")
def test_p_endpoint_mismatch():
    body = _error_xml("PermanentRedirect")
    with S3Stub(scenario_static(301, body)) as stub:
        result = s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
        assert result.state is RemoteState.ENDPOINT_OR_REGION_MISMATCH, result.state
    # Y antes de la red: un endpoint fuera del destino aprobado no se contacta.
    for bad in ("s3:https://s3.amazonaws.com" + "/" + SYNTHETIC_BUCKET + "/restic-prod",
                "s3:https://evil.example.net" + "/" + SYNTHETIC_BUCKET + "/restic-prod"):
        try:
            s3_preflight.parse_target(parse_env(bad))
            raise AssertionError(f"endpoint no aprobado aceptado: {bad}")
        except errors.ConfigError as exc:
            assert "aprobado" in str(exc) or "region" in str(exc), str(exc)


@case("P12", "region incorrecta: rechazo local y error remoto")
def test_p_region_mismatch():
    # Local: el host declara una region y AWS_DEFAULT_REGION dice otra.
    try:
        s3_preflight.parse_target(
            parse_env(approved_repository(), AWS_DEFAULT_REGION="eu-central-003")
        )
        raise AssertionError("region incoherente aceptada")
    except errors.ConfigError as exc:
        assert "region" in str(exc), str(exc)
    # Remoto: S3 responde con el error tipico de firma en region equivocada.
    body = _error_xml("AuthorizationHeaderMalformed")
    with S3Stub(scenario_static(400, body)) as stub:
        result = s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
        assert result.state is RemoteState.ENDPOINT_OR_REGION_MISMATCH, result.state


@case("P13", "timeout del preflight: NETWORK_OR_TLS_ERROR, jamas vacio")
def test_p_timeout():
    with S3Stub(scenario_static(200, _list_xml([]), delay=1.5)) as stub:
        result = s3_preflight.probe_approved_prefix(stub.target(), timeout=0.3)
        assert result.state is RemoteState.NETWORK_OR_TLS_ERROR, result.state
        assert result.object_count is None
    # Puerto cerrado: conexion rechazada.
    closed = socket.socket()
    closed.bind(("127.0.0.1", 0))
    dead_port = closed.getsockname()[1]
    closed.close()
    target = s3_preflight.parse_target(parse_env(
        f"s3:http://127.0.0.1:{dead_port}/{SYNTHETIC_BUCKET}/restic-prod"
    ))
    assert s3_preflight.probe_approved_prefix(target, timeout=2).state is (
        RemoteState.NETWORK_OR_TLS_ERROR
    )


@case("P14", "TLS invalido: NETWORK_OR_TLS_ERROR")
def test_p_tls_error():
    listener = socket.socket()
    listener.bind(("127.0.0.1", 0))
    listener.listen(4)
    listener.settimeout(0.2)
    port = listener.getsockname()[1]
    stop = threading.Event()

    def serve():
        while not stop.is_set():
            try:
                conn, _ = listener.accept()
            except OSError:
                continue
            try:
                # Texto plano en respuesta a un ClientHello: handshake imposible.
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n")
            except OSError:
                pass
            finally:
                conn.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        target = s3_preflight.parse_target(parse_env(
            f"s3:https://127.0.0.1:{port}/{SYNTHETIC_BUCKET}/restic-prod"
        ))
        result = s3_preflight.probe_approved_prefix(target, timeout=5)
        assert result.state is RemoteState.NETWORK_OR_TLS_ERROR, result.state
    finally:
        stop.set()
        thread.join(timeout=5)
        listener.close()


@case("P15", "XML malformado o inesperado: UNKNOWN_REMOTE_STATE")
def test_p_malformed_xml():
    for body in (b"<ListBucketResult><Contents>", b"no-soy-xml", b"",
                 b'<?xml version="1.0"?><OtraCosa/>'):
        with S3Stub(scenario_static(200, body)) as stub:
            result = s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
            assert result.state is RemoteState.UNKNOWN_REMOTE_STATE, (body, result.state)
    # KeyCount incoherente con el numero de objetos enumerados.
    inconsistent = _list_xml([]).replace(
        b"<IsTruncated>false</IsTruncated>",
        b"<IsTruncated>false</IsTruncated><Contents><Key>x</Key></Contents>",
    )
    with S3Stub(scenario_static(200, inconsistent)) as stub:
        result = s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
        assert result.state is RemoteState.UNKNOWN_REMOTE_STATE, result.state


@case("P16", "respuesta 5xx: UNKNOWN_REMOTE_STATE y bloqueo")
def test_p_server_error():
    for status in (500, 502, 503):
        with S3Stub(scenario_static(status, _error_xml("InternalError"))) as stub:
            config = s3_config(f"p16-{status}", stub.repository())
            restic = ScriptedRestic(config)
            assert restic.repository_state() is RemoteState.UNKNOWN_REMOTE_STATE, status
            try:
                restic.ensure_repository(initialize_empty_repository=True)
                raise AssertionError(f"{status} debe bloquear")
            except errors.S3PreflightError:
                pass
            assert restic.init_calls == 0


@case("P17", "listado fuera del prefijo denegado (403): alcance restringido")
def test_p_scope_restricted():
    scenario = scenario_prefix_aware(approved_response=EMPTY_OK, control_response=DENIED_403)
    with S3Stub(scenario) as stub:
        verdict = s3_preflight.probe_scope_restriction(stub.target(), timeout=5)
        assert verdict is ScopeVerdict.RESTRICTED, verdict
        probe = stub.seen[-1]
        assert probe["method"] == "GET", "la sonda de alcance solo lista"
        assert probe["prefix"].startswith(s3_preflight.SCOPE_PROBE_PREFIX), probe
        assert not probe["prefix"].startswith(s3_preflight.APPROVED_PREFIX)


@case("P18", "listado fuera del prefijo permitido (200): credencial demasiado amplia")
def test_p_scope_overbroad():
    # El prefijo de control responde 200: la clave lista fuera de restic-prod/.
    scenario = scenario_prefix_aware(approved_response=EMPTY_OK,
                                     control_response=(200, _list_xml([], "otro/"), 0.0))
    with S3Stub(scenario) as stub:
        assert s3_preflight.probe_scope_restriction(stub.target(), timeout=5) is (
            ScopeVerdict.OVERBROAD
        )
        config = s3_config("p18", stub.repository())
        restic = ScriptedRestic(config)
        try:
            restic.ensure_repository(initialize_empty_repository=True)
            raise AssertionError("una credencial demasiado amplia debe bloquear el init")
        except errors.OverbroadCredentialError as exc:
            assert exc.exit_code == 25
            assert "fuera del prefijo aprobado" in str(exc)
        assert restic.init_calls == 0, "no se inicializa con una clave sobre-permisiva"
    # Y cualquier resultado ambiguo tambien bloquea.
    scenario_amb = scenario_prefix_aware(approved_response=EMPTY_OK,
                                         control_response=(500, _error_xml("InternalError"), 0.0))
    with S3Stub(scenario_amb) as stub2:
        assert s3_preflight.probe_scope_restriction(stub2.target(), timeout=5) is (
            ScopeVerdict.AMBIGUOUS
        )
        config2 = s3_config("p18b", stub2.repository())
        restic2 = ScriptedRestic(config2)
        try:
            restic2.ensure_repository(initialize_empty_repository=True)
            raise AssertionError("un alcance ambiguo debe bloquear")
        except errors.OverbroadCredentialError:
            pass
        assert restic2.init_calls == 0


@case("P19", "el listado se dirige EXACTAMENTE al bucket configurado")
def test_p_bucket_binding():
    with S3Stub(scenario_static(*EMPTY_OK)) as stub:
        s3_preflight.probe_approved_prefix(stub.target(bucket="otro-bucket"), timeout=5)
        assert stub.seen[-1]["path"] == "/otro-bucket", stub.seen[-1]
        s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
        assert stub.seen[-1]["path"] == f"/{SYNTHETIC_BUCKET}", stub.seen[-1]
    # La firma cubre el bucket: cambiarlo cambia la peticion canonica.
    now = datetime.datetime(2026, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc)
    query = {"list-type": "2", "max-keys": "2", "prefix": "restic-prod/"}
    a = s3_preflight.build_signed_request(
        s3_preflight.parse_target(parse_env(approved_repository(bucket="bucket-a"))), query, now)
    b = s3_preflight.build_signed_request(
        s3_preflight.parse_target(parse_env(approved_repository(bucket="bucket-b"))), query, now)
    assert a["signature"] != b["signature"], "la firma no cubre el bucket"


@case("P20", "prefijo distinto del aprobado: rechazo local")
def test_p_prefix_binding():
    for bad_prefix in ("restic-dev", "restic-prod-2", "otro", "restic_prod"):
        try:
            s3_preflight.parse_target(parse_env(approved_repository(prefix=bad_prefix)))
            raise AssertionError(f"prefijo no aprobado aceptado: {bad_prefix}")
        except errors.ConfigError as exc:
            assert "prefijo no aprobado" in str(exc), str(exc)
    # Tampoco se admite bucket sin prefijo, ni prefijos anidados.
    for bad in ("s3:https://" + B2_HOST_SHAPE + "/" + SYNTHETIC_BUCKET,
                "s3:https://" + B2_HOST_SHAPE + "/" + SYNTHETIC_BUCKET + "/restic-prod/sub"):
        try:
            s3_preflight.parse_target(parse_env(bad))
            raise AssertionError(f"destino mal formado aceptado: {bad}")
        except errors.ConfigError:
            pass
    # El aprobado si se acepta.
    target = s3_preflight.parse_target(parse_env(approved_repository()))
    assert target.prefix == s3_preflight.APPROVED_PREFIX
    assert target.bucket == SYNTHETIC_BUCKET
    assert target.scheme == "https"


@case("P21", "secretos ausentes: el preflight no se intenta siquiera")
def test_p_missing_secrets():
    for missing in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION"):
        env = parse_env(approved_repository(), **{missing: None})
        try:
            s3_preflight.parse_target(env)
            raise AssertionError(f"configuracion sin {missing} aceptada")
        except errors.ConfigError:
            pass
    # Sin esquema explicito tampoco: no se adivina el endpoint.
    for bad in ("s3:" + B2_HOST_SHAPE + "/b/restic-prod",
                "s3:ftp://" + B2_HOST_SHAPE + "/b/restic-prod",
                "s3:https://user:pass@" + B2_HOST_SHAPE + "/b/restic-prod"):
        try:
            s3_preflight.parse_target(parse_env(bad))
            raise AssertionError(f"destino aceptado sin validar: {bad}")
        except errors.ConfigError:
            pass


@case("P22", "secreto vacio: rechazo antes de firmar")
def test_p_empty_secret():
    for empty in ("", "   "):
        for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
            try:
                s3_preflight.parse_target(parse_env(approved_repository(), **{key: empty}))
                raise AssertionError(f"{key} vacio aceptado")
            except errors.ConfigError as exc:
                assert "credenciales" in str(exc), str(exc)
    # HTTP en claro contra un host real: rechazado (solo loopback lo admite).
    try:
        s3_preflight.parse_target(parse_env("s3:http://" + B2_HOST_SHAPE + "/b/restic-prod"))
        raise AssertionError("transporte en claro aceptado contra un host real")
    except errors.ConfigError as exc:
        assert "HTTPS" in str(exc), str(exc)


@case("P23", "sanitizacion: ni cuerpos ni stderr crudos salen del preflight")
def test_p_sanitization():
    leak = "keyID-005SECRETO y endpoint interno backup.interno.example"
    body = _error_xml("AccessDenied", message=leak)
    with S3Stub(scenario_static(403, body)) as stub:
        result = s3_preflight.probe_approved_prefix(stub.target(), timeout=5)
    rendered = json.dumps(result.as_log_fields()) + repr(result) + (result.detail or "")
    for needle in ("SECRETO", "backup.interno.example", "synthetic-request", "synthetic-host"):
        assert needle not in rendered, f"fuga en la salida del preflight: {needle}"
    assert result.error_code == "AccessDenied"
    # Un <Code> con forma sospechosa no se propaga.
    weird = b'<?xml version="1.0"?><Error><Code>algo raro con espacios</Code></Error>'
    assert s3_preflight.classify_list_response(403, weird).error_code is None

    # El stderr de restic se reduce a una etiqueta de un conjunto cerrado.
    labels = set()
    samples = {
        "wrong password for repository": "wrong_password",
        "Fatal: config does not exist": "config_absent",
        "AccessDenied: 403": "access_denied",
        "NoSuchBucket: the bucket does not exist": "bucket_not_found",
        "PermanentRedirect": "endpoint_mismatch",
        "dial tcp 10.0.0.1:443: i/o timeout": "network_error",
        "ciphertext verification failed": "repository_corrupt",
        "": "no_output",
        "algo completamente distinto": "unclassified",
    }
    for stderr, expected in samples.items():
        label = s3_preflight.classify_restic_stderr(stderr)
        assert label == expected, (stderr, label, expected)
        labels.add(label)
        # La etiqueta es un identificador cerrado, no una copia del stderr.
        assert label.replace("_", "").isalpha() and len(label) <= 32, label
        assert "10.0.0.1" not in label and "443" not in label
    assert len(labels) == len(set(samples.values()))
    # Y un listado vacio contradicho por restic no puede clasificarse como vacio.
    with S3Stub(scenario_static(*EMPTY_OK)) as stub2:
        config = s3_config("p23", stub2.repository())
        restic = ScriptedRestic(config, cat_stderr="wrong password for repository")
        assert restic.repository_state() is RemoteState.UNKNOWN_REMOTE_STATE


@case("P24", "las units systemd no pueden autorizar el primer init")
def test_p_units_have_no_authorization():
    for name in systemd_unit_files():
        text = open(os.path.join(SYSTEMD_DIR, name), encoding="utf-8").read()
        assert "--initialize-empty-repository" not in text, f"{name} autoriza el init"
        assert "initialize_empty_repository" not in text, f"{name} autoriza el init"
        for raw in text.splitlines():
            line = raw.strip()
            if line.startswith("ExecStart="):
                assert "--" not in line.split("=", 1)[1], f"{name}: ExecStart con flags: {line}"
    # Tampoco por variable de entorno heredada: la autorizacion es solo un flag
    # `store_true` sin default externo.
    parser_source = open(os.path.join(RUNNERS_DIR, "structured_backup.py"), encoding="utf-8").read()
    assert '"--initialize-empty-repository",\n        action="store_true",' in parser_source, (
        "la autorizacion debe ser un flag store_true explicito"
    )
    assert "os.environ" not in parser_source, "la autorizacion no puede leerse del entorno"
    assert "os.getenv" not in parser_source
    # Los otros dos runners ni siquiera exponen la autorizacion.
    for runner in ("uploads_backup.py", "verify_backup.py"):
        source = open(os.path.join(RUNNERS_DIR, runner), encoding="utf-8").read()
        assert "initialize_empty_repository" not in source, f"{runner} no debe poder inicializar"


@case("P25", "prohibicion de init automatico: runners reales contra destino s3:")
def test_p_no_automatic_init():
    with S3Stub(scenario_static(*EMPTY_OK)) as stub:
        env = Env("p25", repository=stub.repository())
        # Runner estructurado SIN el flag: bloquea con codigo 23.
        proc = env.run("structured_backup.py", timeout=300,
                       expect=errors.RepositoryInitNotAuthorized.exit_code)
        assert "STOP — BACKUP-01B FIRST INIT NOT AUTHORIZED" in proc.stderr, proc.stderr
        # Runner de uploads: ni siquiera acepta la autorizacion.
        env.run("uploads_backup.py", timeout=300,
                expect=errors.RepositoryInitNotAuthorized.exit_code)
        rejected = env.run("uploads_backup.py", extra=["--initialize-empty-repository"],
                           timeout=300)
        assert rejected.returncode == 2, "el flag no debe existir en uploads_backup.py"
        # Nada se escribio en el destino: restic solo leyo (GET/HEAD) y el
        # preflight solo listo. Ningun PUT/POST/DELETE llego al bucket.
        methods = {r["method"] for r in stub.seen}
        assert methods <= {"GET", "HEAD"}, methods
        assert any(r["is_list"] and r["prefix"] == "restic-prod/" for r in stub.seen), (
            "no se ejecuto el preflight firmado del prefijo aprobado"
        )


@case("P26", "el preflight no introduce ninguna ruta destructiva")
def test_p_no_destructive_path():
    path = os.path.join(RUNNERS_DIR, "chibalete_backup", "s3_preflight.py")
    source = open(path, encoding="utf-8").read()

    # Dependencias REALES (no menciones en prosa): solo stdlib, cero SDK.
    allowed = {
        "enum", "hashlib", "hmac", "http.client", "re", "socket", "ssl",
        "urllib.parse", "xml.etree.ElementTree", "datetime", ".errors",
    }
    imported = set()
    for node in ast.walk(ast.parse(source, path)):
        if isinstance(node, ast.Import):
            imported.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            imported.add("." * node.level + (node.module or ""))
    assert imported <= allowed, f"dependencias no permitidas en s3_preflight.py: {imported - allowed}"
    for banned in ("boto3", "botocore", "subprocess", "os"):
        assert banned not in imported, f"s3_preflight.py importa {banned}"

    # Y solo emite lecturas: un unico GET, ningun verbo de escritura.
    verbs = {node.args[0].value for node in ast.walk(ast.parse(source, path))
             if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and node.func.attr == "request"
             and node.args and isinstance(node.args[0], ast.Constant)}
    assert verbs == {"GET"}, f"el preflight emite verbos distintos de GET: {verbs}"
    assert source.count("conn.request(") == 1, "solo debe existir un punto de salida HTTP"
    # La allowlist de restic sigue rechazando todo lo destructivo.
    with S3Stub(scenario_static(*EMPTY_OK)) as stub:
        config = s3_config("p26", stub.repository())
        restic = ScriptedRestic(config)
        for args in (["forget"], ["prune"], ["rm"], ["unlock"], ["init", "--prune"]):
            try:
                restic.run(args)
                raise AssertionError(f"no se rechazo: restic {' '.join(args)}")
            except errors.DestructiveCommandRejected:
                pass
        assert restic.init_calls == 0


@case("P27", "SigV4: peticion canonica, cadena a firmar y firma deterministicas")
def test_p_sigv4_vectors():
    target = s3_preflight.parse_target(parse_env(approved_repository()))
    now = datetime.datetime(2026, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc)
    query = {"list-type": "2", "max-keys": "2", "prefix": "restic-prod/"}
    signed = s3_preflight.build_signed_request(target, query, now)

    empty_hash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    expected_canonical = "\n".join([
        "GET",
        "/" + SYNTHETIC_BUCKET,
        "list-type=2&max-keys=2&prefix=restic-prod%2F",
        "host:" + B2_HOST_SHAPE,
        "x-amz-content-sha256:" + empty_hash,
        "x-amz-date:20260102T030405Z",
        "",
        "host;x-amz-content-sha256;x-amz-date",
        empty_hash,
    ])
    assert signed["canonical_request"] == expected_canonical, repr(signed["canonical_request"])

    expected_sts = "\n".join([
        "AWS4-HMAC-SHA256",
        "20260102T030405Z",
        "20260102/" + B2_REGION_SHAPE + "/s3/aws4_request",
        hashlib.sha256(expected_canonical.encode("utf-8")).hexdigest(),
    ])
    assert signed["string_to_sign"] == expected_sts, repr(signed["string_to_sign"])

    # Cadena de derivacion recalculada de forma independiente en la prueba.
    def mac(key, msg):
        return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

    derived = mac(("AWS4" + SYNTHETIC_SECRET).encode("utf-8"), "20260102")
    derived = mac(derived, B2_REGION_SHAPE)
    derived = mac(derived, "s3")
    derived = mac(derived, "aws4_request")
    expected_signature = hmac.new(derived, expected_sts.encode("utf-8"), hashlib.sha256).hexdigest()
    assert signed["signature"] == expected_signature, signed["signature"]
    assert len(signed["signature"]) == 64

    # Determinismo con reloj fijo y variacion con reloj distinto.
    assert s3_preflight.build_signed_request(target, query, now)["signature"] == expected_signature
    other = datetime.datetime(2026, 1, 2, 3, 4, 6, tzinfo=datetime.timezone.utc)
    assert s3_preflight.build_signed_request(target, query, other)["signature"] != expected_signature


@case("P28", "SigV4: cabecera presente y secreto ausente de todo el material")
def test_p_sigv4_no_secret_leak():
    target = s3_preflight.parse_target(parse_env(approved_repository()))
    now = datetime.datetime(2026, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc)
    signed = s3_preflight.build_signed_request(
        target, {"list-type": "2", "max-keys": "2", "prefix": "restic-prod/"}, now)

    authorization = signed["headers"]["Authorization"]
    assert authorization.startswith("AWS4-HMAC-SHA256 Credential=")
    assert "SignedHeaders=host;x-amz-content-sha256;x-amz-date" in authorization
    assert f"Credential={SYNTHETIC_KEY_ID}/20260102/{B2_REGION_SHAPE}/s3/aws4_request" in authorization

    material = "".join([
        signed["canonical_request"], signed["string_to_sign"],
        signed["signature"], signed["path"], authorization,
        repr(target), json.dumps(target.redacted_summary()),
    ])
    assert SYNTHETIC_SECRET not in material, "el secreto aparece en el material de firma"
    # El keyID viaja en Credential (lo exige SigV4) pero no en repr ni resumen.
    assert SYNTHETIC_KEY_ID not in repr(target)
    assert SYNTHETIC_KEY_ID not in json.dumps(target.redacted_summary())
    assert SYNTHETIC_SECRET not in repr(target)


# --------------------------------------------------------------------------
# Casos D01-D14 — stores JSON omitidos (CHP-BACKUP-01D-R1)
# --------------------------------------------------------------------------
#
# Los siete archivos que produccion lee pero el inventario original no
# respaldaba. Se anaden como stores independientes: ninguno sustituye ni
# fusiona a otro, y en particular users_db.json NO reemplaza a
# usuarios_colegios_oro.json.

NUEVOS_STORES = (
    "data/users_db.json",
    "data/progress_db.json",
    "data/lu_config.json",
    "data/leo_profile_db.json",
    "data/interventions_db.json",
    "data/submissions_db.json",
    "data/users_db.backup.1773870779.json",
)

STORES_PREVIOS = (
    "data-critical/events.db", "data/progress.db", "data/offline_assignments.db",
    "data-critical/insights.db",
    "data-critical/usuarios_colegios_oro.json", "data/groups_db.json",
    "data/access_db.json", "data/schools_db.json", "data/sections.json",
    "data/school_configs.json", "data/content.json", "data/content_db.json",
    "data/user_audit_log.json", "data/analytics_db.json",
    "data/leo_memory_db.json", "data/leo_evidence_db.json",
    "data/leo_interactions_db.json",
)

# Los tres nuevos que van marcados como potencialmente asociados a menores.
NUEVOS_MINORS = ("data/leo_profile_db.json", "data/interventions_db.json",
                 "data/submissions_db.json")


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


@case("D01", "inventario: 4 SQLite + 21 JSON declarados; 24 stores respaldados")
def test_d_inventario():
    from chibalete_backup import stores as S
    json_paths = [s.logical_path for s in S.JSON_STORES]
    sqlite_paths = [s.logical_path for s in S.SQLITE_STORES]
    # 21 = los 20 historicos + data/mook_db.json
    # (CHP-BACKUP-MOOK-STORE-COVERAGE-01). El manifiesto sigue trayendo 24
    # stores porque mook_db.json es opcional y los fixtures no lo crean: se
    # anota en `stores_absent`, no en `stores`.
    assert len(json_paths) == 21, f"se esperaban 21 JSON declarados, hay {len(json_paths)}"
    assert len(set(json_paths)) == 21, "hay logical_path duplicados"
    required_sqlite = [s for s in S.SQLITE_STORES if s.required]
    assert len(required_sqlite) == 4, required_sqlite
    for lp in NUEVOS_STORES:
        assert json_paths.count(lp) == 1, f"{lp} debe aparecer exactamente una vez"
    for lp in STORES_PREVIOS:
        assert lp in json_paths or lp in sqlite_paths, f"store previo perdido: {lp}"

    env = Env("d01")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    paths = [s["logical_path"] for s in manifest["stores"]]
    esperados = 24 + TOPOLOGY_STORE_COUNT
    assert len(manifest["stores"]) == esperados, (
        f"se esperaban {esperados} stores (24 de datos + topologia), "
        f"hay {len(manifest['stores'])}")
    kinds = {}
    for s in manifest["stores"]:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    assert kinds == {"sqlite": 4, "json": 20, "topology": TOPOLOGY_STORE_COUNT}, kinds
    for lp in NUEVOS_STORES:
        assert paths.count(lp) == 1, f"{lp} no aparece exactamente una vez en el manifiesto"
    for lp in STORES_PREVIOS:
        assert lp in paths, f"store previo ausente del manifiesto: {lp}"


@case("D02", "preservacion byte a byte: fuente == staging == manifiesto")
def test_d_byte_preservation():
    from chibalete_backup.json_capture import capture_json
    from chibalete_backup import stores as S
    env = Env("d02")
    log = SafeLogger("t", "t", stream=open(os.devnull, "w"))
    by_path = {s.logical_path: s for s in S.JSON_STORES}

    # 1) capture_json no transforma un solo byte, en las 7 formas distintas.
    for lp in NUEVOS_STORES:
        src = os.path.join(env.base, lp)
        dest = os.path.join(env.work, "bp-" + os.path.basename(lp))
        raw_before = open(src, "rb").read()
        result = capture_json(by_path[lp], src, dest, log)
        raw_after = open(dest, "rb").read()
        assert raw_before == raw_after, f"{lp}: los bytes cambiaron en la copia"
        assert open(src, "rb").read() == raw_before, f"{lp}: la FUENTE fue modificada"
        assert result["sha256"] == sha256_file(src) == sha256_file(dest), f"{lp}: sha256 divergente"
        assert result["bytes"] == len(raw_before) == os.path.getsize(src), lp

    # Formas concretas realmente ejercitadas por los fixtures.
    def raw(rel):
        return open(os.path.join(env.base, rel), "rb").read()

    assert raw("data/submissions_db.json") == b"[]", "array vacio de 2 bytes"
    assert raw("data/leo_profile_db.json") == b"{}", "objeto vacio"
    assert b"\r\n" in raw("data/lu_config.json"), "CRLF preservado"
    assert b"\r" not in raw("data/users_db.json"), "LF puro preservado"
    assert not raw("data/progress_db.json").endswith(b"\n"), "sin newline final"
    assert raw("data/interventions_db.json").endswith(b"\n"), "con newline final"
    assert not raw("data/users_db.backup.1773870779.json").endswith(b"\n"), "sin newline final"
    assert any(b > 127 for b in raw("data/users_db.json")), "UTF-8 no ASCII presente"

    # 2) el manifiesto del runner lleva el sha256 de la fuente, para los 20 JSON.
    env2 = Env("d02b")
    env2.provision_repository()
    before = fixtures.snapshot_tree(env2.base)
    env2.run("structured_backup.py", expect=0)
    manifest = env2.manifests()[-1]
    for store in manifest["stores"]:
        if store["kind"] != "json":
            continue
        src = os.path.join(env2.base, store["logical_path"])
        assert store["sha256"] == sha256_file(src), f"{store['logical_path']}: hash != fuente"
        assert store["bytes"] == os.path.getsize(src)
    assert_sources_untouched(before, fixtures.snapshot_tree(env2.base), "backup con 24 stores")


@case("D03", "fail-closed: store nuevo obligatorio ausente")
def test_d_missing_required():
    env = Env("d03")
    env.provision_repository()
    os.unlink(os.path.join(env.base, "data/users_db.json"))
    proc = env.run("structured_backup.py", expect=errors.SourceMissingError.exit_code)
    assert "data/users_db.json" in proc.stderr, proc.stderr
    assert len(env.snapshots(tag="structured")) == 0, "no debe crearse snapshot"


@case("D04", "fail-closed: JSON invalido en un store nuevo, antes de restic")
def test_d_invalid_json():
    env = Env("d04")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    before = len(env.snapshots())
    with open(os.path.join(env.base, "data/lu_config.json"), "w", encoding="utf-8") as handle:
        handle.write('{"roto": ')
    proc = env.run("structured_backup.py", expect=errors.JsonInvalidError.exit_code)
    assert "data/lu_config.json" in proc.stderr, proc.stderr
    assert len(env.snapshots()) == before, "no debe crearse snapshot con JSON invalido"
    assert env.staging_dirs() == [], "staging no limpiado"


@case("D05", "fail-closed: symlink rechazado")
def test_d_symlink_rejected():
    env = Env("d05")
    target = os.path.join(env.base, "data/interventions_db.json")
    os.unlink(target)
    os.symlink(os.path.join(env.base, "data/access_db.json"), target)
    proc = env.run("structured_backup.py", expect=errors.PreflightError.exit_code)
    assert "symlink" in proc.stderr, proc.stderr
    assert not os.path.exists(env.repo), "no debe crearse repositorio"


@case("D06", "fail-closed: escape del arbol de origen")
def test_d_path_escape():
    from chibalete_backup.preflight import _resolve_safe
    from chibalete_backup import errors as E
    env = Env("d06")
    outside = os.path.join(env.root, "fuera.json")
    with open(outside, "w", encoding="utf-8") as handle:
        handle.write("{}")
    try:
        _resolve_safe(env.base, "../fuera.json", "store JSON")
        raise AssertionError("una ruta con .. que escapa debe rechazarse")
    except E.PreflightError as exc:
        assert "escapa" in str(exc), str(exc)
    try:
        _resolve_safe(env.base, "/etc/passwd", "store JSON")
        raise AssertionError("una ruta absoluta debe rechazarse")
    except E.PreflightError as exc:
        assert "absoluta" in str(exc), str(exc)
    # Un symlink que apunta fuera tambien se rechaza (por ser symlink).
    link = os.path.join(env.base, "data/submissions_db.json")
    os.unlink(link)
    os.symlink(outside, link)
    try:
        _resolve_safe(env.base, "data/submissions_db.json", "store JSON")
        raise AssertionError("symlink hacia fuera debe rechazarse")
    except E.PreflightError:
        pass


@case("D07", "fail-closed: archivo no regular (FIFO)")
def test_d_not_regular():
    env = Env("d07")
    target = os.path.join(env.base, "data/lu_config.json")
    os.unlink(target)
    os.mkfifo(target)
    proc = env.run("structured_backup.py", expect=errors.PreflightError.exit_code)
    assert "no es un archivo regular" in proc.stderr, proc.stderr


@case("D08", "fail-closed: logical_path duplicado en el inventario")
def test_d_duplicate_logical_path():
    from chibalete_backup import preflight, stores as S
    original = S.JSON_STORES
    try:
        S.JSON_STORES = original + (S.JsonStore("data/users_db.json", "CANON"),)
        preflight.JSON_STORES = S.JSON_STORES
        try:
            preflight.assert_store_inventory_sane()
            raise AssertionError("un logical_path duplicado debe rechazarse")
        except errors.PreflightError as exc:
            assert "duplicado" in str(exc), str(exc)
    finally:
        S.JSON_STORES = original
        preflight.JSON_STORES = original
    preflight.assert_store_inventory_sane()


@case("D09", "fail-closed: dos stores con el mismo nombre de archivo se pisarian")
def test_d_duplicate_basename():
    from chibalete_backup import preflight, stores as S
    original = S.JSON_STORES
    try:
        # Ruta distinta, MISMO basename: en el staging una sobrescribiria a la otra.
        preflight.JSON_STORES = original + (S.JsonStore("data-critical/users_db.json", "CANON"),)
        try:
            preflight.assert_store_inventory_sane()
            raise AssertionError("un basename duplicado debe rechazarse")
        except errors.PreflightError as exc:
            assert "mismo nombre de archivo" in str(exc) or "pisarian" in str(exc), str(exc)
    finally:
        preflight.JSON_STORES = original
    # El inventario real esta sano: 21 basenames unicos (20 historicos +
    # mook_db.json, CHP-BACKUP-MOOK-STORE-COVERAGE-01).
    nombres = [os.path.basename(s.logical_path) for s in S.JSON_STORES]
    assert len(set(nombres)) == len(nombres) == 21, nombres


@case("D10", "privacidad: sin contenido, correos ni conteos individualizables")
def test_d_privacy():
    env = Env("d10")
    env.provision_repository()
    proc = env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    by_path = {s["logical_path"]: s for s in manifest["stores"]}

    for lp in NUEVOS_MINORS:
        s = by_path[lp]
        assert s["sensitivity"] == "minors", s
        assert s["retention_status"] == "NEEDS_LEGAL_REVIEW", s
        assert "aggregate_count" not in s, f"conteo individualizable en {lp}"
    hist = by_path["data/users_db.backup.1773870779.json"]
    assert hist["retention_status"] == "NEEDS_LEGAL_REVIEW", hist
    assert "aggregate_count" not in hist, "la copia historica no debe llevar conteo"
    # Los operativos si llevan conteo agregado (cardinalidad, no contenido).
    assert by_path["data/users_db.json"]["aggregate_count"] == 2
    assert by_path["data/progress_db.json"]["aggregate_count"] == 3
    assert by_path["data/lu_config.json"]["aggregate_count"] == 2

    # Cadenas que SOLO existen dentro del contenido de los siete archivos.
    blob = json.dumps(manifest) + proc.stdout + proc.stderr
    for needle in ("Sintético", "Ñandú", "Histórico", "sintetico-1", "historico-1",
                   "nombre_completo", "0.0.0-sintetica", "mediador", '"roles"'):
        assert needle not in blob, f"posible fuga de contenido: {needle}"
    assert audit_manifest(manifest) == []
    for label in ("passphrase", "access_key", "secret_key"):
        assert env.secrets[label] not in blob


@case("D11", "compatibilidad: manifiestos de 17 stores siguen siendo validos")
def test_d_backward_compatible_manifest():
    env = Env("d11")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    nuevo = env.manifests()[-1]

    # Manifiesto "historico" con el contrato anterior: 17 stores, sin los nuevos.
    antiguo = json.loads(json.dumps(nuevo))
    antiguo["stores"] = [s for s in nuevo["stores"] if s["logical_path"] in STORES_PREVIOS]
    antiguo["run_id"] = "structured-20260101T000000Z-historico"
    assert len(antiguo["stores"]) == 17, len(antiguo["stores"])
    assert audit_manifest(antiguo) == [], "un manifiesto anterior debe seguir siendo apto"
    assert antiguo["schema_version"] == nuevo["schema_version"] == 1, "el schema no cambia"

    # verify_backup lee ambos sin romperse.
    mdir = os.path.join(env.work, "manifests")
    with open(os.path.join(mdir, antiguo["run_id"] + ".json"), "w", encoding="utf-8") as handle:
        json.dump(antiguo, handle)
    env.run("uploads_backup.py", expect=0)
    proc = env.run("verify_backup.py", expect=0)
    assert '"manifests_verified"' in proc.stdout
    checked = [json.loads(l) for l in proc.stdout.splitlines()
               if l.startswith("{") and '"manifests_verified"' in l][-1]
    assert checked["checked"] == 3, checked
    assert checked["problems"] == 0, checked


@case("D12", "compatibilidad: restore de un snapshot con 24 stores")
def test_d_restore_24_stores():
    env = Env("d12")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    restore_dir = os.path.join(env.root, "restore")
    os.makedirs(restore_dir, exist_ok=True)
    snap = env.snapshots(tag="structured")[0]["id"]
    proc = subprocess.run(
        ["restic", "restore", snap, "--target", restore_dir],
        env=load_config(env.config_dir).restic_env(),
        capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-400:]
    staged = [p for p in glob.glob(os.path.join(restore_dir, "**", "staging-*"), recursive=True)
              if os.path.isdir(p)][0]
    man = json.load(open(os.path.join(staged, "manifest.json"), encoding="utf-8"))
    assert len(man["stores"]) == 24 + TOPOLOGY_STORE_COUNT, len(man["stores"])
    jdir = os.path.join(staged, "json")
    restaurados = sorted(os.listdir(jdir))
    assert len(restaurados) == 20, restaurados
    for lp in NUEVOS_STORES:
        name = os.path.basename(lp)
        assert name in restaurados, f"{name} no se restauro"
        assert sha256_file(os.path.join(jdir, name)) == sha256_file(os.path.join(env.base, lp)), (
            f"{lp}: el restore no es byte-identico a la fuente")

    # CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B: la topologia tiene que sobrevivir
    # a un restore REAL, no solo aparecer en el manifiesto. Va en su propia
    # carpeta, asi que no altera el conteo de `json/` de arriba.
    tdir = os.path.join(staged, "topology")
    restaurada = sorted(os.listdir(tdir))
    assert restaurada == [
        "docker-compose.override.yml",
        "docker-compose.yml",
    ], restaurada
    for name in restaurada:
        assert sha256_file(os.path.join(tdir, name)) == sha256_file(
            os.path.join(env.topology, name)), (
            f"topology/{name}: el restore no es byte-identico a la fuente")


@case("D13", "el store opcional ausente no rompe el backup")
def test_d_optional_absent():
    env = Env("d13")
    env.provision_repository()
    os.unlink(os.path.join(env.base, "data/users_db.backup.1773870779.json"))
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    paths = [s["logical_path"] for s in manifest["stores"]]
    assert "data/users_db.backup.1773870779.json" not in paths
    assert len(manifest["stores"]) == 23 + TOPOLOGY_STORE_COUNT, len(manifest["stores"])
    for lp in STORES_PREVIOS:
        assert lp in paths


@case("D14", "users_db.json y usuarios_colegios_oro.json coexisten sin fusionarse")
def test_d_no_merge():
    env = Env("d14")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    by_path = {s["logical_path"]: s for s in manifest["stores"]}
    a = by_path["data/users_db.json"]
    b = by_path["data-critical/usuarios_colegios_oro.json"]
    assert a["sha256"] != b["sha256"], "son archivos distintos: no deben compartir hash"
    assert a["bytes"] != b["bytes"]
    assert a["aggregate_count"] != b["aggregate_count"], "censos distintos, conteos distintos"
    assert a["sha256"] == sha256_file(os.path.join(env.base, "data/users_db.json"))
    assert b["sha256"] == sha256_file(os.path.join(env.base, "data-critical/usuarios_colegios_oro.json"))
    # Ninguno se canoniza sobre el otro: ambos siguen en disco sin tocar.
    assert os.path.exists(os.path.join(env.base, "data/users_db.json"))
    assert os.path.exists(os.path.join(env.base, "data-critical/usuarios_colegios_oro.json"))


# --------------------------------------------------------------------------
# Casos IW01-IW02 — sandbox de systemd e identity.db en WAL (CHP-IDDB-02B-B-H2)
# --------------------------------------------------------------------------
#
# `structured-backup.service` corre con ProtectSystem=strict: todo el
# filesystem queda de solo lectura salvo lo declarado en ReadWritePaths, y eso
# lo aplica el kernel aunque el proceso sea root.
#
# Un lector de una base SQLite en WAL necesita el indice de memoria compartida
# `<db>-shm`. Medido en H2 sobre copias de la base real, bajo el confinamiento
# efectivo del servicio:
#
#   - con `-wal` y `-shm` ya en disco, la captura funciona sin permiso de
#     escritura: SQLite reutiliza el indice existente;
#   - con `-wal` presente y `-shm` AUSENTE, el lector tiene que crearlo y la
#     captura falla con "unable to open database file" si el directorio no
#     esta en ReadWritePaths.
#
# El segundo caso es alcanzable en produccion en cuanto identity.db pase a WAL
# (server/db/identityDb.js fija journal_mode=WAL al abrirla). Por eso el
# directorio dedicado de identidad entra en la allowlist, y solo el.

SYSTEMD_IDENTITY_RW = "ReadWritePaths=/var/www/chibalete/identity"


def _structured_unit_lines():
    """Directivas efectivas de structured-backup.service, sin comentarios."""
    path = os.path.join(SYSTEMD_DIR, "structured-backup.service")
    lines = []
    for raw in open(path, encoding="utf-8"):
        line = raw.strip()
        if line and not line.startswith("#"):
            lines.append(line)
    return lines


@case("IW01", "sandbox: identity/ esta en ReadWritePaths y el arbol web NO")
def test_iw_identity_readwrite():
    lines = _structured_unit_lines()

    assert SYSTEMD_IDENTITY_RW in lines, (
        "structured-backup.service debe autorizar el directorio dedicado de "
        f"identidad; ReadWritePaths declarados: {[l for l in lines if l.startswith('ReadWritePaths')]}"
    )

    rw = [l.split("=", 1)[1] for l in lines if l.startswith("ReadWritePaths=")]
    # El arbol web completo NUNCA: abriria en escritura uploads, server y todo
    # lo demas para un proceso cuyo unico trabajo es leer stores.
    assert "/var/www/chibalete" not in rw, f"allowlist demasiado amplia: {rw}"
    assert "/" not in rw and "/var" not in rw and "/var/www" not in rw, rw
    # La allowlist es exactamente la esperada: ni un path de mas.
    assert sorted(rw) == sorted([
        "/var/backups/chibalete-backup",
        "/var/www/chibalete/data",
        "/var/www/chibalete/data-critical",
        "/var/www/chibalete/identity",
    ]), rw

    # identity/ no puede estar a la vez en solo lectura: se anularia el arreglo.
    ro = [l.split("=", 1)[1] for l in lines if l.startswith("ReadOnlyPaths=")]
    assert "/var/www/chibalete/identity" not in ro, ro
    assert "/var/www/chibalete" not in ro, (
        f"ReadOnlyPaths sobre el arbol web dejaria identity/ en solo lectura: {ro}"
    )


@case("IW02", "sandbox: el hardening del servicio no se relajo para conseguirlo")
def test_iw_hardening_intacto():
    lines = _structured_unit_lines()
    exigido = {
        "ProtectSystem=strict": "el confinamiento de filesystem es el que hace necesaria la allowlist",
        "NoNewPrivileges=true": None,
        "PrivateTmp=true": None,
        "PrivateDevices=true": None,
        "ProtectHome=true": None,
        "LockPersonality=true": None,
        "RestrictNamespaces=true": None,
        "RestrictSUIDSGID=true": None,
        "RestrictRealtime=true": None,
        "CapabilityBoundingSet=CAP_DAC_READ_SEARCH": None,
        "AmbientCapabilities=": None,
        "UMask=0077": None,
        "ProtectKernelModules=true": None,
        "ProtectKernelTunables=true": None,
        "ProtectControlGroups=true": None,
    }
    for directiva, motivo in exigido.items():
        assert directiva in lines, f"se perdio {directiva}" + (f" — {motivo}" if motivo else "")

    # Ni ProtectSystem degradado a full/true, ni usuario dinamico, ni root
    # aumentado con capacidades nuevas.
    for prohibido in ("ProtectSystem=full", "ProtectSystem=true", "ProtectSystem=no",
                      "DynamicUser=yes", "NoNewPrivileges=false", "PrivateTmp=false"):
        assert prohibido not in lines, f"hardening relajado: {prohibido}"
    for line in lines:
        if line.startswith("AmbientCapabilities="):
            assert line == "AmbientCapabilities=", f"se concedieron capacidades ambientales: {line}"

    # El servicio sigue ejecutando el mismo runner, sin envoltorios nuevos.
    execs = [l for l in lines if l.startswith("ExecStart")]
    assert execs == ["ExecStart=/usr/bin/python3 /opt/chibalete-backup/runners/structured_backup.py"], execs


# --------------------------------------------------------------------------
# Casos ID01-ID04 — ruta canonica de identity.db (CHP-IDDB-02B-B-H1)
# --------------------------------------------------------------------------
#
# `identity.db` dejo de ser un store futuro bajo `data-critical/` y pasa a su
# propio directorio dedicado `identity/` (contrato CHP-IDDB-02B-PATH-01, que es
# tambien lo que declara IDENTITY_DB en el compose).
#
# La correccion se aplico primero a mano sobre el runner instalado. Estos casos
# existen para que una reinstalacion del runner desde el repositorio no pueda
# revertirla en silencio y dejar la base de identidad fuera del backup.

IDENTITY_LOGICAL_PATH = fixtures.IDENTITY_REL
IDENTITY_LEGACY_PATH = fixtures.IDENTITY_LEGACY_REL


@case("ID01", "inventario: identity.db se declara en identity/, nunca en data-critical/")
def test_id_inventory_path():
    from chibalete_backup import stores as S
    sqlite_paths = [s.logical_path for s in S.SQLITE_STORES]
    json_paths = [s.logical_path for s in S.JSON_STORES]

    assert IDENTITY_LOGICAL_PATH in sqlite_paths, (
        f"identity.db debe declararse en {IDENTITY_LOGICAL_PATH}; hay {sqlite_paths}"
    )
    assert IDENTITY_LEGACY_PATH not in sqlite_paths, "la ruta legacy sigue declarada como SQLite"
    assert IDENTITY_LEGACY_PATH not in json_paths, "la ruta legacy sigue declarada como JSON"

    # Una sola declaracion en todo el inventario, cuelgue de donde cuelgue.
    declaradas = [p for p in sqlite_paths + json_paths if os.path.basename(p) == "identity.db"]
    assert declaradas == [IDENTITY_LOGICAL_PATH], declaradas

    store = next(s for s in S.SQLITE_STORES if s.logical_path == IDENTITY_LOGICAL_PATH)
    assert store.category == "CANON", store
    assert store.reconstructible is False, store
    # required=False a proposito: mientras identity_sqlite siga OFF, la ausencia
    # de la base no debe tumbar el backup de los otros 24 stores.
    assert store.required is False, store

    assert len(S.SQLITE_STORES) == 5, sqlite_paths
    assert len([s for s in S.SQLITE_STORES if s.required]) == 4, sqlite_paths


@case("ID02", "snapshot de 25 stores con identity.db presente, integra y sin tocar la fuente")
def test_id_snapshot_25():
    env = Env("id02")
    fixtures.build_identity_db(env.base)
    before = fixtures.snapshot_tree(env.base)
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]

    assert manifest["result"] == "ok", manifest["result"]
    assert len(manifest["stores"]) == 25 + TOPOLOGY_STORE_COUNT, len(manifest["stores"])
    kinds = {}
    for s in manifest["stores"]:
        kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    assert kinds == {"sqlite": 5, "json": 20, "topology": TOPOLOGY_STORE_COUNT}, kinds

    paths = [s["logical_path"] for s in manifest["stores"]]
    assert paths.count(IDENTITY_LOGICAL_PATH) == 1, paths
    assert IDENTITY_LEGACY_PATH not in paths, paths
    # Los otros 24 stores siguen ahi: identity.db se suma, no sustituye a nadie.
    for lp in STORES_PREVIOS:
        assert lp in paths, f"store previo ausente del manifiesto: {lp}"

    entry = {s["logical_path"]: s for s in manifest["stores"]}[IDENTITY_LOGICAL_PATH]
    assert entry["kind"] == "sqlite", entry
    assert entry["category"] == "CANON", entry
    assert entry["integrity_result"] == "ok", entry
    assert entry["bytes"] > 0, entry
    assert len(entry["sha256"]) == 64, entry
    # Ningun conteo de identidad viaja al manifiesto (design §8: solo metadata).
    assert "aggregate_count" not in entry, entry

    # La base productiva es de solo lectura para el backup, y al no estar en WAL
    # no debe aparecer ningun sidecar junto a ella.
    assert_sources_untouched(before, fixtures.snapshot_tree(env.base), "ID02")
    identity_dir = os.path.dirname(os.path.join(env.base, IDENTITY_LOGICAL_PATH))
    assert sorted(os.listdir(identity_dir)) == ["identity.db"], os.listdir(identity_dir)


@case("ID03", "restore real de identity.db: integridad, claves foraneas y conteos")
def test_id_restore():
    env = Env("id03")
    fixtures.build_identity_db(env.base)
    env.provision_repository()
    env.run("structured_backup.py", expect=0)

    restore_dir = os.path.join(env.root, "restore")
    os.makedirs(restore_dir, exist_ok=True)
    snap = env.snapshots(tag="structured")[0]["id"]
    proc = subprocess.run(
        ["restic", "restore", snap, "--target", restore_dir],
        env=load_config(env.config_dir).restic_env(),
        capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-400:]

    staged = [p for p in glob.glob(os.path.join(restore_dir, "**", "staging-*"), recursive=True)
              if os.path.isdir(p)][0]
    man = json.load(open(os.path.join(staged, "manifest.json"), encoding="utf-8"))
    assert len(man["stores"]) == 25 + TOPOLOGY_STORE_COUNT, len(man["stores"])

    # El staging nombra cada copia por basename: la copia restaurada es
    # sqlite/identity.db, venga de donde venga su ruta logica.
    restaurada = os.path.join(staged, "sqlite", "identity.db")
    assert os.path.isfile(restaurada), sorted(os.listdir(os.path.join(staged, "sqlite")))

    conn = sqlite3.connect(f"file:{restaurada}?mode=ro", uri=True)
    try:
        assert conn.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
        conteos = {
            "users": conn.execute("SELECT COUNT(*) FROM users").fetchone()[0],
            "institutions": conn.execute("SELECT COUNT(*) FROM institutions").fetchone()[0],
            "groups": conn.execute("SELECT COUNT(*) FROM groups_v2").fetchone()[0],
            "memberships": conn.execute("SELECT COUNT(*) FROM memberships").fetchone()[0],
            "tombstones": conn.execute("SELECT COUNT(*) FROM tombstones").fetchone()[0],
        }
    finally:
        conn.close()
    assert conteos == fixtures.IDENTITY_COUNTS, conteos


@case("ID04", "la ruta legacy no se respalda, y la ausencia de identity.db no rompe nada")
def test_id_legacy_path_ignored():
    env = Env("id04")
    # Senuelo en la ubicacion historica: existe en disco pero YA NO esta en el
    # inventario, asi que no debe entrar al snapshot por ninguna via.
    senuelo = fixtures.build_identity_db(env.base, rel=IDENTITY_LEGACY_PATH)
    assert os.path.isfile(senuelo)

    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    paths = [s["logical_path"] for s in manifest["stores"]]

    assert IDENTITY_LEGACY_PATH not in paths, "se respaldo la ruta legacy de identity.db"
    assert IDENTITY_LOGICAL_PATH not in paths, "no habia identity.db en la ruta canonica"
    # Sin identity.db en su sitio, el backup sigue siendo el de 24 stores.
    assert len(manifest["stores"]) == 24 + TOPOLOGY_STORE_COUNT, len(manifest["stores"])
    assert manifest["result"] == "ok", manifest["result"]
    for lp in STORES_PREVIOS:
        assert lp in paths, f"store previo ausente del manifiesto: {lp}"


# --------------------------------------------------------------------------
# Casos L01-L08 — cierre del auto-init local (CHP-BACKUP-01B-1-R3A)
# --------------------------------------------------------------------------
#
# La autorizacion manual es UNIFORME: un destino de filesystem vacio se trata
# exactamente igual que un prefijo S3 aprobado y vacio.

# Nombres plausibles que NUNCA deben autorizar un init desde el entorno.
FORBIDDEN_AUTH_ENVVARS = (
    "INITIALIZE_EMPTY_REPOSITORY",
    "CHP_INITIALIZE_EMPTY_REPOSITORY",
    "initialize_empty_repository",
    "RESTIC_INIT",
    "ALLOW_INIT",
    "BACKUP_ALLOW_INIT",
    "CHIBALETE_ALLOW_INIT",
)


@case("L01", "filesystem vacio SIN autorizacion: mismo bloqueo que S3")
def test_l_local_empty_without_authorization():
    env = Env("l01")
    restic = env.restic()
    assert restic.repository_state() is RemoteState.EMPTY_LOCAL_DIRECTORY
    try:
        restic.ensure_repository()
        raise AssertionError("un destino local vacio no puede inicializarse sin autorizacion")
    except errors.RepositoryInitNotAuthorized as exc:
        assert exc.exit_code == 23
        assert "autorizacion manual de provision" in str(exc), str(exc)
    assert not os.path.exists(env.repo), "se creo el repositorio sin autorizacion"
    # Un directorio existente pero vacio se comporta igual.
    os.makedirs(env.repo, exist_ok=True)
    assert restic.repository_state() is RemoteState.EMPTY_LOCAL_DIRECTORY
    try:
        restic.ensure_repository()
        raise AssertionError("un directorio vacio no puede inicializarse sin autorizacion")
    except errors.RepositoryInitNotAuthorized:
        pass
    assert os.listdir(env.repo) == [], "el destino fue tocado"


@case("L02", "filesystem vacio CON autorizacion: un init verificado")
def test_l_local_empty_with_authorization():
    env = Env("l02")
    restic = env.restic()
    assert restic.ensure_repository(initialize_empty_repository=True) == "initialized"
    assert os.path.isdir(os.path.join(env.repo, "data")), "restic init no creo el repositorio"
    # Verificacion posterior obligatoria: el destino queda legible.
    assert restic.repository_state() is RemoteState.EXISTING_REPOSITORY


@case("L03", "segunda ejecucion local: idempotente, sin reinicializar")
def test_l_local_second_run():
    env = Env("l03")
    env.provision_repository()
    after_init = fixtures.snapshot_tree(env.repo)
    assert after_init, "el repositorio quedo vacio tras el init"

    # Con autorizacion repetida: no reinicializa.
    assert env.restic().ensure_repository(initialize_empty_repository=True) == "existing"
    # Y sin autorizacion: tampoco falla ni reinicializa.
    assert env.restic().ensure_repository() == "existing"
    assert fixtures.snapshot_tree(env.repo) == after_init, "el repositorio fue reinicializado"

    # Los runners ordinarios operan con normalidad sobre el repo ya provisto.
    env.run("structured_backup.py", expect=0)
    env.run("structured_backup.py", expect=0)
    assert len(env.snapshots(tag="structured")) == 2


@case("L04", "structured_backup.py sin flag no inicializa un backend local")
def test_l_structured_runner_blocks():
    env = Env("l04")
    proc = env.run("structured_backup.py", expect=errors.RepositoryInitNotAuthorized.exit_code)
    assert "STOP — BACKUP-01B FIRST INIT NOT AUTHORIZED" in proc.stderr, proc.stderr
    assert not os.path.exists(env.repo), "el runner creo el repositorio sin autorizacion"
    assert env.staging_dirs() == [], "staging huerfano tras el bloqueo"
    # Ni siquiera repitiendo la ejecucion (no hay marca persistente que ceda).
    env.run("structured_backup.py", expect=errors.RepositoryInitNotAuthorized.exit_code)
    assert not os.path.exists(env.repo)


@case("L05", "uploads_backup.py no puede inicializar ni acepta la autorizacion")
def test_l_uploads_runner_blocks():
    env = Env("l05")
    proc = env.run("uploads_backup.py", expect=errors.RepositoryInitNotAuthorized.exit_code)
    assert "STOP — BACKUP-01B FIRST INIT NOT AUTHORIZED" in proc.stderr, proc.stderr
    assert not os.path.exists(env.repo)
    # El flag no existe en este runner: argparse lo rechaza.
    rejected = env.run("uploads_backup.py", extra=["--initialize-empty-repository"])
    assert rejected.returncode == 2, rejected.returncode
    assert "unrecognized arguments" in rejected.stderr, rejected.stderr
    assert not os.path.exists(env.repo)
    # Provisto el repositorio, el runner funciona con normalidad.
    env.provision_repository()
    env.run("uploads_backup.py", expect=0)


@case("L06", "verify_backup.py nunca inicializa nada")
def test_l_verify_runner_never_inits():
    env = Env("l06")
    proc = env.run("verify_backup.py", expect=errors.ResticError.exit_code)
    assert not os.path.exists(env.repo), "verify creo el repositorio"
    assert "--initialize-empty-repository" not in proc.stdout + proc.stderr
    rejected = env.run("verify_backup.py", extra=["--initialize-empty-repository"])
    assert rejected.returncode == 2, "verify no debe aceptar la autorizacion"
    assert not os.path.exists(env.repo)


@case("L07", "ninguna unit systemd puede introducir la autorizacion")
def test_l_units_cannot_authorize():
    for name in systemd_unit_files():
        text = open(os.path.join(SYSTEMD_DIR, name), encoding="utf-8").read()
        assert "initialize" not in text.lower(), f"{name} menciona la autorizacion"
        for raw in text.splitlines():
            line = raw.strip()
            if line.startswith("#") or not line:
                continue
            key, _, value = line.partition("=")
            # Ninguna inyeccion directa de entorno hacia el runner.
            assert key not in ("Environment", "PassEnvironment"), f"{name}: {line}"
            # El unico archivo de entorno admitido es el contrato aprobado.
            if key == "EnvironmentFile":
                assert value == "/etc/chibalete-backup/backup.env", f"{name}: {line}"
            if key == "ExecStart":
                argv = line.split("=", 1)[1].split()
                assert len(argv) == 2, f"{name}: ExecStart con argumentos extra: {line}"
                assert argv[0] == "/usr/bin/python3", line
                assert argv[1].endswith(".py"), line

    # Ese EnvironmentFile tampoco puede colar una autorizacion: el parser de
    # backup.env rechaza cualquier clave fuera de la lista permitida.
    for smuggled in FORBIDDEN_AUTH_ENVVARS:
        env = Env(f"l07-{smuggled.lower()}", uploads_files=0, extra_lines=(f"{smuggled}=1",))
        proc = env.run("structured_backup.py", expect=errors.ConfigError.exit_code)
        assert "no permitida" in proc.stderr, proc.stderr


@case("L08", "ninguna variable de entorno autoriza el primer init")
def test_l_no_environment_authorization():
    env = Env("l08")
    for name in FORBIDDEN_AUTH_ENVVARS:
        for value in ("1", "true", "yes"):
            proc = env.run("structured_backup.py", env={name: value},
                           expect=errors.RepositoryInitNotAuthorized.exit_code)
            assert "STOP — BACKUP-01B FIRST INIT NOT AUTHORIZED" in proc.stderr, (name, value)
            assert not os.path.exists(env.repo), f"{name}={value} autorizo un init"
    # Todas a la vez tampoco.
    proc = env.run("structured_backup.py",
                   env={n: "1" for n in FORBIDDEN_AUTH_ENVVARS},
                   expect=errors.RepositoryInitNotAuthorized.exit_code)
    assert not os.path.exists(env.repo)
    # El codigo tampoco consulta el entorno para decidirlo.
    for module in (os.path.join(RUNNERS_DIR, "structured_backup.py"),
                   os.path.join(RUNNERS_DIR, "chibalete_backup", "restic.py")):
        source = open(module, encoding="utf-8").read()
        assert "os.environ" not in source and "os.getenv" not in source, module


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Casos MK01-MK07 — cobertura de mook_db.json (CHP-BACKUP-MOOK-STORE-COVERAGE-01)
# --------------------------------------------------------------------------
#
# El store canonico del MOOK quedo fuera del inventario original porque no
# existia cuando se redacto. Estos casos fijan su cobertura para que una
# reinstalacion del runner no pueda volver a dejarlo fuera en silencio, y para
# demostrar que se restaura byte a byte.

MOOK_LOGICAL_PATH = fixtures.MOOK_REL


def _mook_entry(manifest, key="stores"):
    for entry in manifest[key]:
        if entry["logical_path"] == MOOK_LOGICAL_PATH:
            return entry
    return None


@case("MK01", "inventario: mook_db.json declarado una sola vez, opcional y sin conteo")
def test_mk_inventory():
    from chibalete_backup import stores as S
    json_paths = [s.logical_path for s in S.JSON_STORES]
    sqlite_paths = [s.logical_path for s in S.SQLITE_STORES]

    assert json_paths.count(MOOK_LOGICAL_PATH) == 1, json_paths
    assert MOOK_LOGICAL_PATH not in sqlite_paths, "mook_db.json no es una base SQLite"
    declaradas = [p for p in json_paths + sqlite_paths
                  if os.path.basename(p) == "mook_db.json"]
    assert declaradas == [MOOK_LOGICAL_PATH], declaradas

    store = next(s for s in S.JSON_STORES if s.logical_path == MOOK_LOGICAL_PATH)
    assert store.category == "CANON", store
    # Sin adaptador: `root_len` sobre un objeto de 4 claves fijas emitiria
    # siempre 4 y se leeria como un conteo real.
    assert store.count_adapter is None, store
    # `runs`/`evidence` acumulan trabajo de menores.
    assert store.sensitivity == S.SENSITIVITY_MINORS, store
    assert store.retention_status == S.RETENTION_NEEDS_LEGAL_REVIEW, store
    # Opcional: un entorno sin MOOK todavia no tiene el archivo.
    assert store.required is False, store

    # No se amplio ningun directorio ni se colo un glob.
    assert not any(ch in MOOK_LOGICAL_PATH for ch in "*?["), MOOK_LOGICAL_PATH
    assert MOOK_LOGICAL_PATH.startswith("data/"), MOOK_LOGICAL_PATH


@case("MK02", "mook_db.json presente: se respalda, se anota y la fuente no se toca")
def test_mk_present_included():
    env = Env("mk02")
    fixtures.build_mook_db(env.base)
    before = fixtures.snapshot_tree(env.base)
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]

    assert manifest["result"] == "ok", manifest["result"]
    # 24 historicos + mook_db.json. identity.db sigue ausente en este fixture.
    assert len(manifest["stores"]) == 25 + TOPOLOGY_STORE_COUNT, len(manifest["stores"])

    entry = _mook_entry(manifest)
    assert entry is not None, [s["logical_path"] for s in manifest["stores"]]
    assert entry["kind"] == "json", entry
    assert entry["category"] == "CANON", entry
    assert entry["status"] == "included", entry
    assert entry["integrity_result"] == "ok", entry
    assert entry["bytes"] == len(fixtures.MOOK_POBLADO), entry
    assert entry["sha256"] == sha256_file(os.path.join(env.base, MOOK_LOGICAL_PATH)), entry
    assert entry["sensitivity"] == "minors", entry
    assert entry["retention_status"] == "NEEDS_LEGAL_REVIEW", entry
    # Nunca un conteo: seria constante y enganoso.
    assert "aggregate_count" not in entry, entry
    # Estando presente, no puede figurar tambien como ausente.
    assert _mook_entry(manifest, "stores_absent") is None, manifest["stores_absent"]

    # Los 24 stores previos siguen ahi: mook_db.json se suma, no sustituye.
    paths = [s["logical_path"] for s in manifest["stores"]]
    for lp in STORES_PREVIOS:
        assert lp in paths, f"store previo ausente del manifiesto: {lp}"

    assert_sources_untouched(before, fixtures.snapshot_tree(env.base), "MK02")


@case("MK03", "mook_db.json ausente: backup ok y ausencia anotada explicitamente")
def test_mk_absent_tolerated():
    env = Env("mk03")
    assert not os.path.exists(os.path.join(env.base, MOOK_LOGICAL_PATH))
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]

    assert manifest["result"] == "ok", manifest["result"]
    # Sin MOOK el backup sigue siendo el de 24 stores: la ausencia no resta.
    assert len(manifest["stores"]) == 24 + TOPOLOGY_STORE_COUNT, len(manifest["stores"])
    assert _mook_entry(manifest) is None, "un store ausente no puede figurar como respaldado"

    # Lo esencial: la ausencia deja rastro y es distinguible de una perdida.
    ausente = _mook_entry(manifest, "stores_absent")
    assert ausente is not None, manifest["stores_absent"]
    assert ausente["status"] == "absent_optional", ausente
    assert ausente["kind"] == "json", ausente
    assert "sha256" not in ausente and "bytes" not in ausente, ausente


@case("MK04", "mook_db.json vacio pero valido: se respalda igual")
def test_mk_empty_valid():
    env = Env("mk04")
    fixtures.build_mook_db(env.base, raw=fixtures.MOOK_EMPTY)
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]

    entry = _mook_entry(manifest)
    assert entry is not None, "un MOOK vacio valido debe respaldarse, no omitirse"
    assert entry["status"] == "included", entry
    assert entry["bytes"] == len(fixtures.MOOK_EMPTY), entry
    assert entry["integrity_result"] == "ok", entry
    assert _mook_entry(manifest, "stores_absent") is None, manifest["stores_absent"]


@case("MK05", "restore real de mook_db.json: byte a byte y campos intactos")
def test_mk_restore_exact():
    env = Env("mk05")
    origen = fixtures.build_mook_db(env.base)
    bytes_origen = open(origen, "rb").read()
    env.provision_repository()
    env.run("structured_backup.py", expect=0)

    restore_dir = os.path.join(env.root, "restore")
    os.makedirs(restore_dir, exist_ok=True)
    snap = env.snapshots(tag="structured")[0]["id"]
    proc = subprocess.run(
        ["restic", "restore", snap, "--target", restore_dir],
        env=load_config(env.config_dir).restic_env(),
        capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-400:]

    staged = [p for p in glob.glob(os.path.join(restore_dir, "**", "staging-*"), recursive=True)
              if os.path.isdir(p)][0]
    restaurada = os.path.join(staged, "json", "mook_db.json")
    assert os.path.isfile(restaurada), sorted(os.listdir(os.path.join(staged, "json")))

    # Igualdad byte a byte contra la fuente.
    bytes_restaurados = open(restaurada, "rb").read()
    assert bytes_restaurados == bytes_origen, "el restore de mook_db.json no es byte-identico"
    assert sha256_file(restaurada) == sha256_file(origen)
    assert os.path.getsize(restaurada) == len(bytes_origen)

    # Y ademas parsea y conserva la estructura declarada.
    doc = json.loads(bytes_restaurados)
    assert [e["id"] for e in doc["experiences"]] == ["exp-sintetica-0001"], doc["experiences"]
    assert doc["experiences"][0]["slug"] == "experiencia-sintetica"
    assert doc["experiences"][0]["currentVersionId"] == "ver-sintetica-0001"
    assert [v["id"] for v in doc["versions"]] == ["ver-sintetica-0001"], doc["versions"]
    assert len(doc["versions"][0]["nodes"]) == 2, doc["versions"][0]
    assert doc["runs"] == [] and doc["evidence"] == []

    # El manifiesto restaurado declara el store como incluido.
    man = json.load(open(os.path.join(staged, "manifest.json"), encoding="utf-8"))
    assert _mook_entry(man)["sha256"] == sha256_file(origen)


@case("MK06", "mook_db.json ilegible o corrupto: el backup falla de forma visible")
def test_mk_unreadable_fails_loudly():
    # (a) JSON corrupto: aborta ANTES de invocar restic, sin snapshot.
    env = Env("mk06a")
    fixtures.build_mook_db(env.base, raw=b'{"experiences": [')
    env.provision_repository()
    proc = env.run("structured_backup.py", expect=errors.JsonInvalidError.exit_code)
    assert "mook_db.json" in proc.stderr, proc.stderr[-400:]
    assert env.snapshots(tag="structured") == [], "no debe quedar snapshot de una captura fallida"
    assert env.staging_dirs() == [], env.staging_dirs()

    # (b) No es un archivo regular: fail-closed en el preflight. Se usa un
    # directorio porque la suite corre como root y chmod 000 no le impide leer.
    env2 = Env("mk06b")
    os.makedirs(os.path.join(env2.base, MOOK_LOGICAL_PATH), exist_ok=True)
    env2.provision_repository()
    proc2 = env2.run("structured_backup.py", expect=errors.PreflightError.exit_code)
    assert "no es un archivo regular" in proc2.stderr, proc2.stderr[-400:]
    assert env2.snapshots(tag="structured") == [], "no debe quedar snapshot"

    # (c) Symlink: tampoco se sigue, aunque apunte a un JSON valido.
    env3 = Env("mk06c")
    real = os.path.join(env3.base, "data", "mook_real.json")
    os.makedirs(os.path.dirname(real), exist_ok=True)
    with open(real, "wb") as handle:
        handle.write(fixtures.MOOK_POBLADO)
    os.symlink(real, os.path.join(env3.base, MOOK_LOGICAL_PATH))
    env3.provision_repository()
    proc3 = env3.run("structured_backup.py", expect=errors.PreflightError.exit_code)
    assert "symlink" in proc3.stderr, proc3.stderr[-400:]


@case("MK07", "nada fuera de la allowlist entra, y los arboles fuente quedan intactos")
def test_mk_no_collateral():
    env = Env("mk07")
    fixtures.build_mook_db(env.base)

    # Senuelos con nombres vecinos: ninguno esta declarado en el inventario.
    senuelos = {
        "data/mook_db.json.bak": b'{"experiences": ["senuelo"]}',
        "data/mook_db.json.pre-deploy": b'{"experiences": ["senuelo"]}',
        "data/mook_backup.json": b'{"experiences": ["senuelo"]}',
        "data/mook_db_old.json": b'{"experiences": ["senuelo"]}',
        "data-critical/mook_db.json": b'{"experiences": ["senuelo"]}',
    }
    for rel, raw in senuelos.items():
        path = os.path.join(env.base, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(raw)

    before = fixtures.snapshot_tree(env.base)
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]

    declarados = {s["logical_path"] for s in manifest["stores"]}
    for rel in senuelos:
        assert rel not in declarados, f"entro un archivo no declarado: {rel}"
    assert MOOK_LOGICAL_PATH in declarados, declarados
    # Exactamente un mook_db.json en el manifiesto.
    assert sum(1 for p in declarados if os.path.basename(p) == "mook_db.json") == 1, declarados

    # Y tampoco entran al snapshot por otra via: el staging solo tiene el
    # basename declarado, no los senuelos.
    restore_dir = os.path.join(env.root, "restore")
    os.makedirs(restore_dir, exist_ok=True)
    snap = env.snapshots(tag="structured")[0]["id"]
    proc = subprocess.run(
        ["restic", "restore", snap, "--target", restore_dir],
        env=load_config(env.config_dir).restic_env(),
        capture_output=True, text=True, timeout=300,
    )
    assert proc.returncode == 0, proc.stderr[-400:]
    staged = [p for p in glob.glob(os.path.join(restore_dir, "**", "staging-*"), recursive=True)
              if os.path.isdir(p)][0]
    restaurados = sorted(os.listdir(os.path.join(staged, "json")))
    assert "mook_db.json" in restaurados, restaurados
    for ruido in ("mook_db.json.bak", "mook_backup.json", "mook_db_old.json",
                  "mook_db.json.pre-deploy"):
        assert ruido not in restaurados, restaurados

    # data/, data-critical/ y uploads: nada borrado, movido ni truncado.
    after = fixtures.snapshot_tree(env.base)
    assert_sources_untouched(before, after, "MK07")
    for rel in list(senuelos) + [MOOK_LOGICAL_PATH]:
        assert os.path.isfile(os.path.join(env.base, rel)), f"desaparecio del origen: {rel}"
    uploads_dir = os.path.join(env.base, fixtures.UPLOADS_REL)
    assert len(os.listdir(uploads_dir)) == 6, os.listdir(uploads_dir)


# --------------------------------------------------------------------------
# Casos GS01-GS12 — guard fail-closed del harness
# (CHP-BACKUP-TEST-SANDBOX-GUARD-01)
# --------------------------------------------------------------------------
#
# Estos casos prueban el GUARD, no el backup. Existen porque el harness llego a
# llenar el disco de un VPS productivo y a poder sobrescribir la instalacion
# real del runner. Cada uno fija una via de escape que ya no debe existir.

def _violates(fn, *a, **kw) -> str:
    """Ejecuta y exige SandboxViolation. Devuelve el mensaje."""
    try:
        fn(*a, **kw)
    except sandbox.SandboxViolation as exc:
        return str(exc)
    raise AssertionError(f"se esperaba SandboxViolation de {getattr(fn,'__name__',fn)}")


@case("GS01", "ejecucion normal: todo cuelga del sandbox y nada de /tmp se escapa")
def test_gs_normal_execution():
    assert SANDBOX_ROOT and os.path.isdir(SANDBOX_ROOT), SANDBOX_ROOT
    assert sandbox.is_sandbox(SANDBOX_ROOT), "el root no esta marcado"
    assert os.path.basename(SANDBOX_ROOT).startswith(sandbox.SANDBOX_PREFIX), SANDBOX_ROOT
    assert SANDBOX_ROOT == os.path.realpath(SANDBOX_ROOT), "el root no esta resuelto"
    assert not os.path.islink(SANDBOX_ROOT), "el root es un symlink"
    # Fuera del repositorio y de las rutas del sistema.
    assert not SANDBOX_ROOT.startswith(UNIT_DIR), SANDBOX_ROOT
    # La lista la declara el propio guard: los tests no repiten rutas a mano.
    for prohibida in sandbox.FORBIDDEN_PATHS:
        if prohibida == os.sep:
            continue
        assert not SANDBOX_ROOT.startswith(prohibida + "/"), SANDBOX_ROOT
    # Y el trabajo real de la suite vive dentro.
    assert WORK_ROOT.startswith(SANDBOX_ROOT + os.sep), WORK_ROOT
    env = Env("gs01")
    for p in (env.base, env.work, env.repo, env.config_dir):
        assert os.path.realpath(p).startswith(SANDBOX_ROOT + os.sep), p


@case("GS02", "host productivo simulado: aborta ANTES de escribir nada")
def test_gs_production_host_guard():
    # Se simula el host con un marcador que si existe en cualquier maquina;
    # asi se prueba la deteccion sin fabricar rutas productivas falsas.
    msg = _violates(sandbox.assert_not_production_host, markers=("/etc/hostname",))
    assert "HOST PRODUCTIVO" in msg, msg
    assert "no hay flag" in msg.lower(), "el mensaje debe dejar claro que no hay bypass"

    # Los marcadores reales son los del VPS, y ninguno debe existir aqui: si
    # existiera, la suite no habria llegado a ejecutarse.
    presentes = [m for m in sandbox.PRODUCTION_MARKERS if os.path.exists(m)]
    assert presentes == [], f"marcadores productivos presentes: {presentes}"

    # Y no hay variable de entorno que desactive el guard.
    fuente = open(os.path.join(HERE, "sandbox.py"), encoding="utf-8").read()
    cuerpo = fuente.split("def assert_not_production_host", 1)[1].split("\ndef ", 1)[0]
    assert "environ" not in cuerpo, "el guard de host consulta el entorno: es un bypass"


@case("GS03", "CHP_TEST_ROOT=/ rechazado")
def test_gs_test_root_slash():
    msg = _violates(sandbox.assert_no_test_root_override, {"CHP_TEST_ROOT": "/"})
    assert "CHP_TEST_ROOT" in msg, msg
    # Y aunque alguien la usara como ruta, el validador la rechaza igual.
    _violates(sandbox.assert_path_allowed, "/", SANDBOX_ROOT)


@case("GS04", "CHP_TEST_ROOT=/opt/chibalete-backup rechazado")
def test_gs_test_root_install_dir():
    _violates(sandbox.assert_no_test_root_override,
              {"CHP_TEST_ROOT": "/opt/chibalete-backup"})
    msg = _violates(sandbox.assert_path_allowed, "/opt/chibalete-backup", SANDBOX_ROOT)
    assert "prohibida" in msg, msg
    # La suite en ejecucion no la tiene definida.
    assert "CHP_TEST_ROOT" not in os.environ, "la suite corre con CHP_TEST_ROOT definida"


@case("GS05", "symlink hacia ruta prohibida rechazado")
def test_gs_symlink_escape():
    d = fresh("gs05")
    link = os.path.join(d, "puerta")
    os.symlink("/etc", link)
    msg = _violates(sandbox.assert_path_allowed, link, SANDBOX_ROOT)
    assert "prohibida" in msg, msg
    # Un symlink a otra parte del sistema tambien: lo que manda es el realpath.
    link2 = os.path.join(d, "puerta2")
    os.symlink(os.path.realpath(tempfile.gettempdir()), link2)
    _violates(sandbox.assert_path_allowed, link2, SANDBOX_ROOT)
    # El symlink sigue ahi: validar no borra.
    assert os.path.islink(link), "el guard borro el symlink en vez de rechazarlo"


@case("GS06", "traversal con .. rechazado")
def test_gs_traversal():
    for intento in ("../../etc", "../..", "a/../../../opt", "x/../../../../"):
        _violates(sandbox.assert_path_allowed,
                  os.path.join(SANDBOX_ROOT, intento), SANDBOX_ROOT)
    # Un `..` que se queda dentro SI es valido: el guard no es supersticioso.
    dentro = os.path.join(SANDBOX_ROOT, "tests", "..", "tests")
    assert sandbox.assert_path_allowed(dentro, SANDBOX_ROOT) == WORK_ROOT


@case("GS07", "ruta vacia, None o relativa rechazadas")
def test_gs_empty_variable():
    for malo in ("", "   ", None, 0, "relativa/sin/raiz", "./x"):
        _violates(sandbox.assert_path_allowed, malo, SANDBOX_ROOT)
        _violates(sandbox.safe_rmtree, malo, SANDBOX_ROOT)
    # El caso clasico: rm -rf "$VAR" con VAR vacia.
    msg = _violates(sandbox.destroy_sandbox, "")
    assert "vacia" in msg, msg


@case("GS08", "cleanup sin marcador rechazado")
def test_gs_cleanup_requires_marker():
    d = fresh("gs08")
    impostor = os.path.join(d, sandbox.SANDBOX_PREFIX + "impostor")
    os.makedirs(impostor, exist_ok=True)
    testigo = os.path.join(impostor, "no-borrar.txt")
    with open(testigo, "w", encoding="utf-8") as handle:
        handle.write("testigo")
    # Prefijo correcto pero SIN marcador: no se borra.
    msg = _violates(sandbox.destroy_sandbox, impostor)
    assert "marcador" in msg, msg
    assert os.path.isfile(testigo), "se borro un arbol sin marcador"
    assert not sandbox.is_sandbox(impostor)


@case("GS09", "cleanup con prefijo incorrecto rechazado")
def test_gs_cleanup_wrong_prefix():
    d = fresh("gs09")
    otro = os.path.join(d, "carpeta-cualquiera")
    os.makedirs(otro, exist_ok=True)
    # Marcador presente pero prefijo que no es el nuestro: tampoco se borra.
    with open(os.path.join(otro, sandbox.MARKER_NAME), "w", encoding="utf-8") as h:
        h.write("marcador plantado")
    msg = _violates(sandbox.destroy_sandbox, otro)
    assert "prefijo" in msg, msg
    assert os.path.isdir(otro), "se borro un arbol con prefijo incorrecto"
    # Y NINGUNA ruta critica declarada se borra jamas, tenga lo que tenga.
    for critica in sandbox.FORBIDDEN_PATHS:
        _violates(sandbox.destroy_sandbox, critica)
    for critica in sandbox.PRODUCTION_MARKERS:
        _violates(sandbox.destroy_sandbox, critica)


@case("GS10", "ENOSPC inyectado: sin lastre y sin tocar el disco")
def test_gs_enospc_without_ballast():
    antes = sandbox.tree_bytes(SANDBOX_ROOT)
    env = Env("gs10")
    proc = env.run("structured_backup.py", extra=["--initialize-empty-repository"],
                   env=sandbox.enospc_restic_env(SANDBOX_ROOT),
                   expect=errors.ResticError.exit_code)
    assert "no space left on device" in proc.stderr.lower(), proc.stderr[-300:]
    despues = sandbox.tree_bytes(SANDBOX_ROOT)
    # El fixture del Env ocupa algo; el ENOSPC en si no debe anadir megas.
    crecimiento = despues - antes
    assert crecimiento < 8 * 1024 * 1024, f"el caso ENOSPC crecio {crecimiento} B"
    # Y no existe ningun fichero de lastre en ninguna parte del sandbox.
    lastre = [os.path.join(dp, n)
              for dp, _dn, fn in os.walk(SANDBOX_ROOT) for n in fn
              if n == "ballast" or os.path.getsize(os.path.join(dp, n)) > 32 * 1024 * 1024]
    assert lastre == [], lastre


@case("GS11", "instalacion simulada dentro del sandbox; /opt real intacto")
def test_gs_simulated_install():
    d = simulated_install_dir()
    assert d.startswith(SANDBOX_ROOT + os.sep), d
    assert os.path.isfile(os.path.join(d, "runners", "structured_backup.py")), os.listdir(d)
    # El harness no puede escribir en la ruta real bajo ninguna via.
    _violates(sandbox.assert_path_allowed, "/opt/chibalete-backup", SANDBOX_ROOT)
    _violates(sandbox.assert_path_allowed, "/opt/chibalete-backup/runners", SANDBOX_ROOT)
    # Y si existiera de verdad, el guard de host habria abortado el arranque.
    assert "/opt/chibalete-backup" in sandbox.PRODUCTION_MARKERS


@case("GS12", "la ruta absoluta del incidente no vuelve como literal operativo")
def test_gs_no_ballast_path_literal():
    """Control de regresion sobre la ruta que lleno el disco del VPS.

    Se analiza el AST, no el texto: asi los comentarios y docstrings que
    EXPLICAN el incidente no cuentan (no existen para el AST) y solo se detecta
    la ruta usada de verdad como dato. Las unicas apariciones toleradas son las
    listas de rechazo del guard.
    """
    marca = "/full" + "fs"   # partido para no ser su propio ofensor
    listas_permitidas = {"FORBIDDEN_PATHS", "PRODUCTION_MARKERS"}
    ofensores = []

    for nombre in sorted(os.listdir(HERE)):
        if not nombre.endswith(".py"):
            continue
        ruta = os.path.join(HERE, nombre)
        arbol = ast.parse(open(ruta, encoding="utf-8").read(), filename=nombre)

        # Docstrings: se excluyen por estructura, no por heuristica de texto.
        docstrings = set()
        for nodo in ast.walk(arbol):
            if isinstance(nodo, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                cuerpo = getattr(nodo, "body", [])
                if (cuerpo and isinstance(cuerpo[0], ast.Expr)
                        and isinstance(cuerpo[0].value, ast.Constant)
                        and isinstance(cuerpo[0].value.value, str)):
                    docstrings.add(id(cuerpo[0].value))

        # Literales que son elementos de una lista de rechazo declarada.
        permitidos = set()
        for nodo in ast.walk(arbol):
            if not isinstance(nodo, ast.Assign):
                continue
            objetivos = {t.id for t in nodo.targets if isinstance(t, ast.Name)}
            if not (objetivos & listas_permitidas):
                continue
            for hijo in ast.walk(nodo.value):
                if isinstance(hijo, ast.Constant) and isinstance(hijo.value, str):
                    permitidos.add(id(hijo))

        for nodo in ast.walk(arbol):
            if not (isinstance(nodo, ast.Constant) and isinstance(nodo.value, str)):
                continue
            if marca not in nodo.value:
                continue
            if id(nodo) in docstrings or id(nodo) in permitidos:
                continue
            ofensores.append(f"{nombre}:{getattr(nodo, 'lineno', '?')}: {nodo.value[:60]!r}")

    assert ofensores == [], (
        "la ruta de lastre volvio como literal operativo:\n" + "\n".join(ofensores))

    # Y en los .sh, fuera de comentarios.
    for nombre in sorted(os.listdir(HERE)):
        if not nombre.endswith(".sh"):
            continue
        for n, linea in enumerate(open(os.path.join(HERE, nombre), encoding="utf-8"), 1):
            if marca in linea and not linea.strip().startswith("#"):
                ofensores.append(f"{nombre}:{n}")
    assert ofensores == [], "la ruta de lastre volvio a un script:\n" + "\n".join(ofensores)

    # Tampoco vuelven las otras rutas absolutas del incidente ni el lastre.
    # Las agujas se parten para que esta comprobacion no se detecte a si misma.
    fuente = open(os.path.join(HERE, "test_suite.py"), encoding="utf-8").read()
    assert ("def " + "fill_filesystem") not in fuente, "la funcion de lastre volvio al harness"
    for var in ("LOWSPACE", "LOWINO", "FULLFS"):
        assert (var + " =") not in fuente, f"volvio la constante {var}"


# --------------------------------------------------------------------------
# TP01-TP08 - topologia Compose efectiva (CHP-BACKUP-COMPOSE-OVERRIDE-COVERAGE-01B)
#
# Hasta 01A el backup canonico no respaldaba ningun Compose. El que gobierna
# que imagenes corren -docker-compose.override.yml- no estaba en ningun
# snapshot: RPO infinito sobre la topologia. Estas pruebas fijan que entra,
# que se preserva byte a byte, y sobre todo QUE NO entra.
# --------------------------------------------------------------------------

@case("TP01", "topologia: ambos Compose se copian y quedan en el manifiesto")
def test_topology_both_captured():
    env = Env("tp01")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    by_path = {item["logical_path"]: item for item in manifest["stores"]}
    for name in ("docker-compose.yml", "docker-compose.override.yml"):
        entry = by_path.get("topology/" + name)
        assert entry is not None, "falta en el manifiesto: " + name
        assert entry["kind"] == "topology", entry
        assert entry["category"] == "CFG", entry
        assert entry["status"] == "included", entry
        assert entry["integrity_result"] == "ok", entry
        assert len(entry["sha256"]) == 64, entry
        assert entry["bytes"] > 0, entry


@case("TP02", "topologia: bytes preservados (sha256 fuente == manifiesto)")
def test_topology_bytes_preserved():
    env = Env("tp02")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    manifest = env.manifests()[-1]
    by_path = {item["logical_path"]: item for item in manifest["stores"]}
    for name in ("docker-compose.yml", "docker-compose.override.yml"):
        source = os.path.join(env.topology, name)
        with open(source, "rb") as handle:
            expected = hashlib.sha256(handle.read()).hexdigest()
        got = by_path["topology/" + name]
        assert got["sha256"] == expected, name + ": sha256 no coincide con la fuente"
        assert got["bytes"] == os.path.getsize(source), name


@case("TP03", "topologia: ambos Compose son distinguibles entre si")
def test_topology_files_are_distinct():
    env = Env("tp03")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    by_path = {item["logical_path"]: item for item in env.manifests()[-1]["stores"]}
    base = by_path["topology/docker-compose.yml"]["sha256"]
    override = by_path["topology/docker-compose.override.yml"]["sha256"]
    assert base != override, "base y override no pueden compartir sha256 en el fixture"


@case("TP04", "topologia: falta el override -> fallo visible, sin snapshot")
def test_topology_missing_override_fails():
    env = Env("tp04")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    before = len(env.snapshots())
    os.unlink(os.path.join(env.topology, "docker-compose.override.yml"))
    proc = env.run("structured_backup.py", expect=errors.SourceMissingError.exit_code)
    assert "topologia" in proc.stderr, proc.stderr
    assert "docker-compose.override.yml" in proc.stderr, proc.stderr
    assert len(env.snapshots()) == before, "no debe crearse snapshot sin la topologia"
    assert env.staging_dirs() == [], "staging no limpiado"


@case("TP05", "topologia: symlink rechazado fail-closed")
def test_topology_symlink_rejected():
    env = Env("tp05")
    env.provision_repository()
    target = os.path.join(env.topology, "docker-compose.override.yml")
    outside = os.path.join(env.root, "fuera.yml")
    with open(outside, "w", encoding="utf-8") as handle:
        handle.write("services: {}")
    os.unlink(target)
    os.symlink(outside, target)
    proc = env.run("structured_backup.py", expect=errors.PreflightError.exit_code)
    assert "symlink" in proc.stderr, proc.stderr
    assert env.staging_dirs() == [], "staging no limpiado"


@case("TP06", "topologia: .env y copias ad-hoc NUNCA entran")
def test_topology_noise_excluded():
    env = Env("tp06")
    env.provision_repository()
    env.run("structured_backup.py", expect=0)
    paths = [item["logical_path"] for item in env.manifests()[-1]["stores"]]
    for prohibido in (".env", "bak-pre-", ".bak."):
        ofensores = [path for path in paths if prohibido in path]
        assert ofensores == [], "entro material excluido: " + repr(ofensores)
    topology_paths = sorted(path for path in paths if path.startswith("topology/"))
    assert topology_paths == [
        "topology/docker-compose.override.yml",
        "topology/docker-compose.yml",
    ], topology_paths


@case("TP07", "topologia: no se recorre el directorio padre")
def test_topology_parent_not_walked():
    env = Env("tp07")
    env.provision_repository()
    # Un archivo extra, con nombre no declarado, en el mismo directorio.
    extra = os.path.join(env.topology, "docker-compose.prod.yml")
    with open(extra, "w", encoding="utf-8") as handle:
        handle.write("services: {}")
    env.run("structured_backup.py", expect=0)
    paths = [item["logical_path"] for item in env.manifests()[-1]["stores"]]
    assert "topology/docker-compose.prod.yml" not in paths, paths
    assert len([path for path in paths if path.startswith("topology/")]) == 2, paths


@case("TP08", "topologia: el resolver rechaza nombres no declarados")
def test_topology_resolver_rejects_undeclared():
    from chibalete_backup import stores as stores_mod

    # Defensa en profundidad: aunque el runner solo itere el inventario fijo,
    # el resolver debe rechazar cualquier nombre no declarado, y todo lo que
    # sea una ruta en vez de un nombre.
    for nombre in ("otro.yml", "../fuera.yml", "sub/dir.yml", ".env"):
        try:
            stores_mod.resolve_topology_file(
                stores_mod.TopologyFile(nombre), tempfile.gettempdir()
            )
        except stores_mod.PreflightError:
            continue
        raise AssertionError("el resolver acepto un nombre no declarado: " + nombre)

    # El inventario declarado es exactamente de dos archivos, ambos obligatorios.
    assert [item.name for item in stores_mod.TOPOLOGY_FILES] == [
        "docker-compose.yml",
        "docker-compose.override.yml",
    ]
    assert all(item.required for item in stores_mod.TOPOLOGY_FILES)


def main() -> int:
    global SANDBOX_ROOT, WORK_ROOT

    # Guard fail-closed ANTES de escribir un solo byte: host productivo,
    # CHP_TEST_ROOT y creacion del root son lo primero que ocurre. Si algo de
    # esto falla, la suite no llega a tocar el filesystem.
    try:
        SANDBOX_ROOT = sandbox.create_sandbox()
    except sandbox.SandboxViolation as exc:
        print("SANDBOX GUARD: " + str(exc))
        print("SUITE_RESULT=RED")
        return 2

    WORK_ROOT = sandbox.assert_path_allowed(
        os.path.join(SANDBOX_ROOT, "tests"), SANDBOX_ROOT)
    os.makedirs(WORK_ROOT, exist_ok=True)
    sandbox.install_fault_tools(SANDBOX_ROOT)
    print(f"sandbox: {SANDBOX_ROOT}")

    tests = [obj for name, obj in sorted(globals().items()) if callable(obj) and hasattr(obj, "_case")]
    tests.sort(key=lambda fn: fn._case[0])
    failures = 0
    skipped = 0
    for fn in tests:
        cid, title = fn._case
        started = time.time()
        try:
            fn()
            elapsed = time.time() - started
            print(f"  PASS  [{cid}] {title}  ({elapsed:.1f}s)")
            RESULTS.append((cid, title, "PASS"))
        except ToolUnavailable as exc:
            skipped += 1
            print(f"  SKIP  [{cid}] {title}  ({exc})")
            RESULTS.append((cid, title, "SKIP"))
        except Exception as exc:  # noqa: BLE001 - reporte explicito
            failures += 1
            print(f"  FAIL  [{cid}] {title}")
            print(f"        {type(exc).__name__}: {exc}")
            RESULTS.append((cid, title, f"FAIL: {type(exc).__name__}"))
    # Consumo real de disco, medido y acotado. Un harness de pruebas no tiene
    # ninguna razon legitima para escribir cientos de megas: si se pasa del
    # presupuesto, es un fallo mas, no una nota al pie.
    usados = sandbox.tree_bytes(SANDBOX_ROOT)
    dentro = usados <= sandbox.DISK_BUDGET_BYTES
    if not dentro:
        failures += 1
        print(f"  FAIL  [DISK] consumo {usados} B supera el limite "
              f"{sandbox.DISK_BUDGET_BYTES} B")
    print()
    print(f"disco usado por la suite: {usados} B "
          f"({usados / 1024 / 1024:.1f} MB de {sandbox.DISK_BUDGET_BYTES // 1024 // 1024} MB)")

    # Cleanup validado: prefijo + marcador. Nunca una variable suelta.
    try:
        sandbox.destroy_sandbox(SANDBOX_ROOT)
        residuo = os.path.exists(SANDBOX_ROOT)
    except sandbox.SandboxViolation as exc:
        failures += 1
        residuo = True
        print(f"  FAIL  [CLEANUP] {exc}")
    if residuo:
        print(f"  aviso: quedo residuo en {SANDBOX_ROOT}")

    print(f"=== RESUMEN: {len(tests) - failures - skipped}/{len(tests)} PASS"
          f"{f', {skipped} SKIP' if skipped else ''}"
          f"{f', {failures} FAIL' if failures else ''} ===")
    print("SUITE_RESULT=" + ("GREEN" if failures == 0 else "RED"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
