#!/bin/bash
# Orquestador de validacion de CHP-BACKUP-01B.
#
# Se ejecuta SIEMPRE dentro del toolchain Linux aislado, con el repositorio
# montado read-only en /repo y red deshabilitada. Ver ../README.md.
set -uo pipefail

UNIT_DIR="${UNIT_DIR:-/repo/ops/backup/CHP-BACKUP-01B}"
INSTALL_DIR="${INSTALL_DIR:-/opt/chibalete-backup}"
export PYTHONDONTWRITEBYTECODE=1

FAILURES=0
step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
pass() { printf '  PASS  %s\n' "$1"; }

step "0. Entorno"
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
# Las units apuntan a /opt/chibalete-backup: se materializa en tmpfs para que
# systemd-analyze pueda resolver ExecStart. El repositorio sigue read-only.
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
UNITS_TMP=/work/units-standalone
mkdir -p "$UNITS_TMP"
cp "$UNIT_DIR"/systemd/* "$UNITS_TMP/"
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

step "7. Suite funcional (24 casos + integracion restic)"
if python3 "$UNIT_DIR/tests/test_suite.py"; then
  pass "suite funcional GREEN"
else
  fail "suite funcional RED"
fi

printf '\n=== VALIDACION GLOBAL: %s ===\n' "$([ "$FAILURES" -eq 0 ] && echo GREEN || echo RED)"
printf 'FAILURES=%s\n' "$FAILURES"
exit "$FAILURES"
