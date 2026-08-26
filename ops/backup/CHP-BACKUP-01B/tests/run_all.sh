#!/bin/bash
# Orquestador de validacion de CHP-BACKUP-01B.
#
# Se ejecuta SIEMPRE dentro del toolchain Linux aislado, con el repositorio
# montado read-only en /repo y red deshabilitada. Ver ../README.md.
set -uo pipefail

UNIT_DIR="${UNIT_DIR:-/repo/ops/backup/CHP-BACKUP-01B}"
export PYTHONDONTWRITEBYTECODE=1

FAILURES=0
step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
pass() { printf '  PASS  %s\n' "$1"; }

# --------------------------------------------------------------------------
# GUARD FAIL-CLOSED (CHP-BACKUP-TEST-SANDBOX-GUARD-01)
#
# Va ANTES de cualquier escritura, mkdir o cp. El 2026-08-26 este script se
# ejecuto sobre el VPS productivo: llenaba el disco raiz y su `cp -r` habria
# sobrescrito la instalacion real del runner en /opt/chibalete-backup.
#
# No hay flag de bypass. Si el host tiene marcadores de Chibalete+, la unica
# salida es ejecutar la suite en un contenedor desechable sin mounts.
# --------------------------------------------------------------------------
PRODUCTION_MARKERS="/var/www/chibalete /opt/chibalete-backup /etc/chibalete-backup /opt/chibaleteplus /var/backups/chibalete-backup"
FOUND=""
for marker in $PRODUCTION_MARKERS; do
  [ -e "$marker" ] && FOUND="$FOUND $marker"
done
if [ -n "$FOUND" ]; then
  printf '\n=== STOP — HOST PRODUCTIVO DETECTADO ===\n'
  printf 'La suite de backup NUNCA se ejecuta directamente en un VPS productivo.\n'
  printf 'Marcadores presentes:%s\n' "$FOUND"
  printf 'Ejecutala en un contenedor desechable sin mounts productivos (ver README §2).\n'
  printf 'No hay flag para saltarse esta comprobacion.\n'
  printf 'SUITE_RESULT=RED\n'
  exit 2
fi

if [ -n "${CHP_TEST_ROOT+definida}" ]; then
  printf '\n=== STOP — CHP_TEST_ROOT definida ===\n'
  printf 'Esa variable dejo de existir: redirigia el harness a rutas arbitrarias.\n'
  printf 'SUITE_RESULT=RED\n'
  exit 2
fi

# Sandbox propio: mktemp bajo /tmp, resuelto, con marcador, y limpiado solo si
# ambos coinciden. Nunca /opt, nunca una variable suelta en el rm.
SANDBOX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/chp-backup-tests.XXXXXXXX")"
SANDBOX_ROOT="$(realpath "$SANDBOX_ROOT")"
case "$SANDBOX_ROOT" in
  */chp-backup-tests.*) : ;;
  *) printf 'STOP — prefijo de sandbox inesperado: %s\nSUITE_RESULT=RED\n' "$SANDBOX_ROOT"; exit 2 ;;
esac
touch "$SANDBOX_ROOT/.chp-backup-sandbox"
INSTALL_DIR="$SANDBOX_ROOT/opt/chibalete-backup"

cleanup_sandbox() {
  # Doble llave antes de borrar: prefijo correcto Y marcador presente.
  [ -n "${SANDBOX_ROOT:-}" ] || return 0
  case "$SANDBOX_ROOT" in */chp-backup-tests.*) : ;; *) return 0 ;; esac
  [ -f "$SANDBOX_ROOT/.chp-backup-sandbox" ] || return 0
  rm -rf -- "$SANDBOX_ROOT"
}
trap cleanup_sandbox EXIT

step "0. Entorno"
printf '  sandbox: %s\n' "$SANDBOX_ROOT"
printf '  restic:  %s\n' "$(restic version)"
printf '  python:  %s\n' "$(python3 --version)"
NON_LOOPBACK=0
for iface in /sys/class/net/*; do
  [ -e "$iface" ] || continue
  [ "$(basename "$iface")" = "lo" ] || NON_LOOPBACK=$((NON_LOOPBACK + 1))
done
printf '  ifaces:  %s\n' "$(echo /sys/class/net/* | tr ' ' '\n' | xargs -n1 basename | tr '\n' ' ')"
if [ "$NON_LOOPBACK" -eq 0 ]; then
  pass "red deshabilitada (solo loopback)"
else
  fail "hay $NON_LOOPBACK interfaz(ces) de red activa(s)"
fi

step "1. Preparacion del arbol de instalacion simulado"
# Las units apuntan a /opt/chibalete-backup, asi que systemd-analyze necesita
# una ruta que exista para resolver ExecStart. Se materializa DENTRO del
# sandbox: antes se copiaba sobre /opt/chibalete-backup, que en el VPS es la
# instalacion productiva. El repositorio sigue read-only.
mkdir -p "$INSTALL_DIR"
cp -r "$UNIT_DIR/runners" "$INSTALL_DIR/"
cp "$UNIT_DIR/README.md" "$INSTALL_DIR/" 2>/dev/null || true
if [ -f "$INSTALL_DIR/runners/structured_backup.py" ]; then
  pass "runners disponibles en $INSTALL_DIR"
else
  fail "no se pudo preparar $INSTALL_DIR"
fi

step "2. Syntax check de Python (sin escribir bytecode)"
if python3 - "$UNIT_DIR" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
bad = []
for path in sorted(root.rglob("*.py")):
    source = path.read_text(encoding="utf-8")
    try:
        compile(source, str(path), "exec")
    except SyntaxError as exc:
        bad.append(f"{path}: {exc}")
for entry in bad:
    print("   ", entry)
sys.exit(1 if bad else 0)
PY
then
  pass "todos los .py compilan"
else
  fail "error de sintaxis en Python"
fi

step "3. Syntax check de Bash"
SH_OK=1
while IFS= read -r script; do
  if ! bash -n "$script"; then
    fail "bash -n: $script"
    SH_OK=0
  fi
done < <(find "$UNIT_DIR" -name '*.sh' -type f)
[ "$SH_OK" = "1" ] && pass "todos los .sh parsean"

step "4. shellcheck"
SC_OK=1
while IFS= read -r script; do
  if ! shellcheck "$script"; then
    fail "shellcheck: $script"
    SC_OK=0
  fi
done < <(find "$UNIT_DIR" -name '*.sh' -type f)
[ "$SC_OK" = "1" ] && pass "shellcheck limpio"

step "5. systemd-analyze verify (con inspeccion textual)"
UNITS_TMP="$SANDBOX_ROOT/units-standalone"
mkdir -p "$UNITS_TMP"
find "$UNIT_DIR/systemd" -maxdepth 1 -type f -exec cp {} "$UNITS_TMP/" \;
chmod 0644 "$UNITS_TMP"/*
SD_OK=1
for unit in "$UNITS_TMP"/*; do
  OUTPUT=$(systemd-analyze verify "$unit" 2>&1)
  RC=$?
  if [ "$RC" -ne 0 ]; then
    fail "systemd-analyze rc=$RC en $(basename "$unit")"
    SD_OK=0
  fi
  if [ -n "$OUTPUT" ]; then
    fail "systemd-analyze emitio texto en $(basename "$unit"): $OUTPUT"
    SD_OK=0
  fi
done
[ "$SD_OK" = "1" ] && pass "6 units validas y silenciosas"

step "6. Barrido de credenciales y comandos destructivos en los entregables"
LEAKS=$(grep -rniE 'AKIA[0-9A-Z]{16}|backblazeb2\.com/[a-z0-9]|-----BEGIN [A-Z ]*PRIVATE KEY' \
  "$UNIT_DIR" --include='*.py' --include='*.sh' --include='*.service' --include='*.timer' \
  --include='*.example' --include='*.md' || true)
if [ -z "$LEAKS" ]; then
  pass "sin credenciales ni endpoints reales"
else
  fail "posible credencial/endpoint real: $LEAKS"
fi

# Se buscan INVOCACIONES, no menciones en prosa. restic.py es la allowlist:
# nombra esos subcomandos justamente para rechazarlos, y su comportamiento real
# lo verifica el caso 21 de la suite.
DESTRUCTIVE=$(grep -rnE '\.run\(\s*\[\s*"(forget|prune|rm|remove|delete)"|^[^#]*ExecStart=.*(forget|prune)' \
  "$UNIT_DIR/runners" "$UNIT_DIR/systemd" --exclude='restic.py' || true)
if [ -z "$DESTRUCTIVE" ]; then
  pass "sin invocaciones destructivas en runners ni units"
else
  fail "invocacion destructiva detectada: $DESTRUCTIVE"
fi

step "7. Suite funcional (24 obligatorios + integracion restic + preflight S3 + cierre de init)"
if python3 "$UNIT_DIR/tests/test_suite.py"; then
  pass "suite funcional GREEN"
else
  fail "suite funcional RED"
fi

step "8. Suite de capacity (CHP-BACKUP-CAPACITY-01B: preflight, budget, recovery points)"
if python3 "$UNIT_DIR/tests/test_capacity.py"; then
  pass "suite de capacity GREEN"
else
  fail "suite de capacity RED"
fi

printf '\n=== VALIDACION GLOBAL: %s ===\n' "$([ "$FAILURES" -eq 0 ] && echo GREEN || echo RED)"
printf 'FAILURES=%s\n' "$FAILURES"
exit "$FAILURES"
