"""Guard fail-closed del harness de pruebas (CHP-BACKUP-TEST-SANDBOX-GUARD-01).

POR QUE EXISTE
--------------
El 2026-08-26 la suite se ejecuto fuera de su contenedor sobre el VPS
productivo. El caso de «filesystem lleno» escribia lastre en la ruta ABSOLUTA
y hardcodeada `/fullfs` hasta agotar el dispositivo: en el sandbox eso es un
tmpfs de 1 MB, pero en un host real fueron 48,4 GB y el disco raiz llego al
100 %. Los cuatro containers de la aplicacion quedaron `unhealthy` y la
ejecucion programada de `structured-backup` fallo. Ademas `run_all.sh` copiaba
los runners a `/opt/chibalete-backup`, que en el VPS es la INSTALACION REAL.

La leccion no es «acuerdate de usar el contenedor»: es que el harness no debia
ser capaz de hacer eso. Este modulo lo convierte en fail-closed.

CONTRATO
--------
1. Ningun test escribe fuera de un root creado por el propio harness bajo /tmp.
2. El harness se niega a arrancar en un host que parezca productivo.
3. No hay flag de bypass. La unica forma de ejecutar la suite en un host con
   marcadores de Chibalete+ es no ejecutarla.
4. `CHP_TEST_ROOT` ya no redirige nada: si esta definida, el harness aborta.
5. El borrado exige marcador propio y prefijo correcto; jamas se acepta una
   ruta vacia, relativa, con `..`, con symlinks o fuera del sandbox.
6. El consumo total de disco esta acotado y medido.
"""

import errno
import os
import shutil
import stat
import tempfile
import uuid

# Nombre del marcador que identifica un sandbox creado por este harness. El
# borrado recursivo SOLO se permite sobre un arbol que lo contenga.
MARKER_NAME = ".chp-backup-sandbox"

# Prefijo obligatorio del root. Se comprueba ademas del marcador para que un
# marcador plantado a mano en otro sitio no sea suficiente.
SANDBOX_PREFIX = "chp-backup-tests."

# Presupuesto total de disco de la suite. Deliberadamente pequeno: el harness
# no tiene ninguna razon legitima para escribir cientos de megas.
DISK_BUDGET_BYTES = 100 * 1024 * 1024  # 100 MB

# Marcadores de un host productivo de Chibalete+. Si CUALQUIERA existe, el
# harness no arranca. No son rutas que la suite necesite: son justamente las
# que jamas debe poder tocar.
PRODUCTION_MARKERS = (
    "/var/www/chibalete",        # arbol de datos y uploads
    "/opt/chibalete-backup",     # instalacion real del runner
    "/etc/chibalete-backup",     # secretos del backup
    "/opt/chibaleteplus",        # compose de la aplicacion
    "/var/backups/chibalete-backup",  # staging y manifiestos reales
)

# Rutas que nunca pueden ser destino de escritura, borrado ni fixture. Se
# rechaza la ruta exacta, cualquier descendiente y cualquier ascendiente.
FORBIDDEN_PATHS = (
    "/",
    "/fullfs",
    "/lowspace",
    "/lowino",
    "/opt",
    "/opt/chibalete-backup",
    "/var",
    "/var/www",
    "/var/www/chibalete",
    "/var/backups",
    "/etc",
    "/root",
    "/home",
    "/usr",
    "/boot",
    "/data",
    "/data-critical",
    "/uploads",
)

# Nombres de directorio que delatan un arbol de datos productivo aunque cuelgue
# de otra raiz (p. ej. un bind mount en otro punto de montaje).
FORBIDDEN_BASENAMES = ("data-critical", "uploads")


class SandboxViolation(RuntimeError):
    """El harness intento salirse de su caja. Siempre es fatal."""


def _real(path: str) -> str:
    """realpath sin resolver a traves de una ruta vacia o relativa."""
    if not isinstance(path, str) or path.strip() == "":
        raise SandboxViolation("ruta vacia o no textual: destino inaceptable")
    if not os.path.isabs(path):
        raise SandboxViolation(f"ruta relativa inaceptable: {path!r}")
    return os.path.realpath(path)


def _is_within(child: str, parent: str) -> bool:
    """True si `child` es `parent` o cuelga de el. Ambos ya normalizados."""
    if child == parent:
        return True
    return child.startswith(parent.rstrip("/") + "/")


def forbidden_hit(resolved: str) -> str | None:
    """Describe por que `resolved` (ya absoluto y resuelto) es inaceptable.

    `/` se trata aparte a proposito: TODA ruta absoluta cuelga de la raiz, asi
    que compararla como prefijo rechazaria el sandbox tambien. De `/` solo se
    prohibe la coincidencia exacta.
    """
    for forbidden in FORBIDDEN_PATHS:
        f = os.path.normpath(forbidden)
        if f == os.sep:
            if resolved == os.sep:
                return "destino es la raiz del filesystem"
            continue
        if _is_within(resolved, f):
            return f"destino dentro de ruta prohibida {f}"
        # Padre de una prohibida: borrar /x que contiene /x/var/www seria igual
        # de destructivo.
        if _is_within(f, resolved):
            return f"destino es ascendiente de ruta prohibida {f}"
    return None


def assert_not_production_host(markers=PRODUCTION_MARKERS) -> None:
    """Aborta si el host presenta marcadores de produccion de Chibalete+.

    Fail-closed y SIN bypass: no se consulta ninguna variable de entorno ni
    ningun flag. Un contenedor de CI o un portatil de desarrollo no tienen
    estas rutas; el VPS las tiene todas.
    """
    encontrados = [m for m in markers if os.path.exists(m)]
    if encontrados:
        raise SandboxViolation(
            "HOST PRODUCTIVO DETECTADO — la suite de backup no se ejecuta aqui. "
            f"Marcadores presentes: {', '.join(encontrados)}. "
            "Ejecutala en un contenedor desechable sin mounts productivos. "
            "No hay flag para saltarse esta comprobacion."
        )


def assert_no_test_root_override(env=None) -> None:
    """`CHP_TEST_ROOT` dejo de existir como punto de redireccion.

    Antes permitia apuntar el harness a cualquier ruta absoluta, que es
    exactamente como se llego a escribir sobre el disco del VPS. Ahora su sola
    presencia —definida, aunque sea vacia— aborta la ejecucion.
    """
    env = os.environ if env is None else env
    if "CHP_TEST_ROOT" in env:
        raise SandboxViolation(
            "CHP_TEST_ROOT ya no se admite: el harness crea su propio sandbox "
            "bajo /tmp y no acepta redirecciones. Deja de definirla."
        )


def assert_path_allowed(path: str, sandbox_root: str) -> str:
    """Valida un destino de escritura/borrado. Devuelve la ruta resuelta.

    Rechaza: rutas vacias, relativas, prohibidas, ascendientes de prohibidas,
    traversal con `..`, symlinks que escapen y cualquier cosa fuera del root.
    """
    root = _real(sandbox_root)
    resolved = _real(path)

    problema = forbidden_hit(resolved)
    if problema:
        raise SandboxViolation(f"{problema}: {path!r}")

    if os.path.basename(resolved) in FORBIDDEN_BASENAMES:
        raise SandboxViolation(f"destino con nombre de store productivo: {path!r}")

    if not _is_within(resolved, root):
        raise SandboxViolation(
            f"destino fuera del sandbox: {path!r} -> {resolved} (root {root})"
        )
    return resolved


def create_sandbox() -> str:
    """Crea el root de pruebas y lo marca. Es la unica fuente de rutas.

    `/tmp/chp-backup-tests.<aleatorio>`, resuelto con realpath y verificado sin
    symlinks en el propio root.
    """
    assert_no_test_root_override()
    assert_not_production_host()

    base = os.path.realpath(tempfile.gettempdir())
    root = os.path.realpath(tempfile.mkdtemp(prefix=SANDBOX_PREFIX, dir=base))

    if os.path.basename(root).find(SANDBOX_PREFIX) != 0:
        raise SandboxViolation(f"prefijo de sandbox inesperado: {root}")
    # El root no puede ser un symlink ni haberse resuelto a otro sitio.
    if os.path.islink(root):
        raise SandboxViolation(f"el root del sandbox es un symlink: {root}")
    problema = forbidden_hit(root)
    if problema:
        raise SandboxViolation(
            f"{problema}: el sandbox no puede vivir ahi ({root}). "
            "Revisa TMPDIR: debe apuntar a un /tmp normal."
        )

    with open(os.path.join(root, MARKER_NAME), "w", encoding="utf-8") as handle:
        handle.write(uuid.uuid4().hex + "\n")
    os.chmod(root, stat.S_IRWXU)
    return root


def is_sandbox(root: str) -> bool:
    """True solo si `root` tiene el prefijo y el marcador de este harness."""
    try:
        resolved = _real(root)
    except SandboxViolation:
        return False
    if not os.path.basename(resolved).startswith(SANDBOX_PREFIX):
        return False
    return os.path.isfile(os.path.join(resolved, MARKER_NAME))


def destroy_sandbox(root: str) -> None:
    """Borra el sandbox. Doble llave: prefijo correcto Y marcador presente."""
    resolved = _real(root)
    if not os.path.basename(resolved).startswith(SANDBOX_PREFIX):
        raise SandboxViolation(f"prefijo incorrecto, no se borra: {root!r}")
    if not os.path.isfile(os.path.join(resolved, MARKER_NAME)):
        raise SandboxViolation(f"sin marcador {MARKER_NAME}, no se borra: {root!r}")
    problema = forbidden_hit(resolved)
    if problema:
        raise SandboxViolation(f"borrado peligroso — {problema}: {root!r}")
    shutil.rmtree(resolved, ignore_errors=True)


def safe_rmtree(path: str, sandbox_root: str) -> None:
    """Borrado recursivo validado contra el sandbox."""
    resolved = assert_path_allowed(path, sandbox_root)
    if resolved == _real(sandbox_root):
        raise SandboxViolation("safe_rmtree no borra el root; usa destroy_sandbox")
    shutil.rmtree(resolved, ignore_errors=True)


def tree_bytes(root: str) -> int:
    """Bytes ocupados por el arbol, contando cada inodo una sola vez."""
    total = 0
    vistos = set()
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            p = os.path.join(dirpath, name)
            try:
                st = os.lstat(p)
            except OSError:
                continue
            if st.st_ino and st.st_ino in vistos:
                continue
            vistos.add(st.st_ino)
            total += st.st_size
    return total


def assert_within_disk_budget(root: str, budget: int = DISK_BUDGET_BYTES) -> int:
    """Falla si la suite se pasa del presupuesto de disco."""
    used = tree_bytes(root)
    if used > budget:
        raise SandboxViolation(
            f"la suite consumio {used} bytes, por encima del limite de {budget}"
        )
    return used


# --- Inyeccion de fallos ------------------------------------------------------
# Sustituye a los tmpfs `/lowspace`, `/lowino` y `/fullfs`. No escribe un solo
# byte de lastre: parchea `os.statvfs` en el proceso HIJO mediante un
# `sitecustomize` que se inyecta por PYTHONPATH, y provee un `restic` de pega
# para el caso de ENOSPC. El codigo de produccion no se toca.

FAULT_DIR_NAME = "_faults"

_SITECUSTOMIZE = '''\
"""Inyeccion de fallos para las pruebas del backup. NO viaja a produccion."""
import errno
import os

_MODE = os.environ.get("CHP_FAULT_STATVFS")
if _MODE:
    _real_statvfs = os.statvfs

    class _Result:
        """statvfs_result no es instanciable; se replica lo que lee el runner."""
        def __init__(self, base, bavail, favail, files):
            self.f_bsize = base.f_bsize
            self.f_frsize = base.f_frsize
            self.f_blocks = base.f_blocks
            self.f_bfree = bavail
            self.f_bavail = bavail
            self.f_files = files
            self.f_ffree = favail
            self.f_favail = favail
            self.f_flag = base.f_flag
            self.f_namemax = base.f_namemax

    def _statvfs(path):
        base = _real_statvfs(path)
        if _MODE == "lowspace":
            # Casi cero bloques disponibles: cualquier estimacion supera el hueco.
            return _Result(base, 1, base.f_favail, base.f_files)
        if _MODE == "lowino":
            # Espacio de sobra pero practicamente sin inodos.
            return _Result(base, base.f_bavail, 2, 1000)
        return base

    os.statvfs = _statvfs
'''

_FAKE_RESTIC = '''\
#!/bin/sh
# `restic` de pega: falla siempre como si el dispositivo estuviera lleno.
# Determinista y sin escribir un solo byte. Sustituye al tmpfs de lastre.
if [ "$1" = "version" ]; then
  echo "restic 0.16.4 compiled with go1.22.2 on linux/amd64"
  exit 0
fi
echo "Fatal: create repository at destination failed: write blob: no space left on device" >&2
exit 1
'''


def install_fault_tools(sandbox_root: str) -> str:
    """Materializa el sitecustomize y el restic de pega dentro del sandbox."""
    d = assert_path_allowed(os.path.join(sandbox_root, FAULT_DIR_NAME), sandbox_root)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "sitecustomize.py"), "w", encoding="utf-8") as handle:
        handle.write(_SITECUSTOMIZE)
    bindir = os.path.join(d, "bin")
    os.makedirs(bindir, exist_ok=True)
    fake = os.path.join(bindir, "restic")
    with open(fake, "w", encoding="utf-8") as handle:
        handle.write(_FAKE_RESTIC)
    os.chmod(fake, 0o755)
    return d


def statvfs_fault_env(sandbox_root: str, mode: str) -> dict:
    """Entorno que hace fallar la comprobacion de capacidad del runner hijo."""
    if mode not in ("lowspace", "lowino"):
        raise ValueError(f"modo de fallo desconocido: {mode}")
    d = os.path.join(_real(sandbox_root), FAULT_DIR_NAME)
    previo = os.environ.get("PYTHONPATH", "")
    return {
        "CHP_FAULT_STATVFS": mode,
        "PYTHONPATH": d + (os.pathsep + previo if previo else ""),
    }


def enospc_restic_env(sandbox_root: str) -> dict:
    """Entorno que pone el `restic` de pega delante del real en el PATH."""
    bindir = os.path.join(_real(sandbox_root), FAULT_DIR_NAME, "bin")
    return {"PATH": bindir + os.pathsep + os.environ.get("PATH", "")}
