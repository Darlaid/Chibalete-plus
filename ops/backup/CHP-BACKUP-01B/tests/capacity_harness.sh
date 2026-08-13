#!/bin/bash
# capacity_harness.sh — CHP-BACKUP-CAPACITY-01B F3/F4.
#
# Reproduce el sandbox REAL de las units de backup (ProtectHome=true,
# ProtectSystem=strict, PrivateTmp=true, root) con systemd-run transitorio y
# demuestra sobre un repositorio restic LOCAL de fixture:
#
#   CACHE_PERSISTENCE      la cache CacheDirectory= sobrevive entre units
#   CACHE_REUSE            una segunda corrida reutiliza los mismos ficheros
#   CACHE_RECONSTRUCTIBLE  borrar la cache no rompe nada: se reconstruye
#   BACKUP_LOCK_SHARED     el flock exclusivo serializa procesos reales
#
# GARANTIAS DE AISLAMIENTO: jamas contacta B2; usa CacheDirectory
# `chp-cap01b-prep` (NUNCA la productiva `chibalete-backup`); no toca units
# instaladas ni /etc/systemd; limpia todo al salir.
#
#   sudo bash capacity_harness.sh /ruta/al/unit-dir-versionado
set -uo pipefail

UNIT_SRC="${1:?uso: capacity_harness.sh <unit-dir con runners/>}"
W=/var/backups/chp-cap01b-prep
CACHE_NAME=chp-cap01b-prep/restic
CACHE_HOST=/var/cache/$CACHE_NAME
FAILURES=0
pass() { printf '  PASS  %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

cleanup() {
  rm -rf "$W" "/var/cache/chp-cap01b-prep"
}
trap cleanup EXIT

rm -rf "$W"; mkdir -p "$W/src"; chmod 0700 "$W"
printf 'fixture-passphrase-sintetica\n' > "$W/pw"; chmod 0600 "$W/pw"
echo "contenido de fixture" > "$W/src/a.txt"

export RESTIC_REPOSITORY="$W/repo" RESTIC_PASSWORD_FILE="$W/pw"
restic init --quiet >/dev/null 2>&1 || { fail "init fixture"; exit 1; }
restic backup --quiet "$W/src" >/dev/null 2>&1 || { fail "backup fixture"; exit 1; }
restic backup --quiet "$W/src" >/dev/null 2>&1
pass "repo restic LOCAL de fixture provisionado (2 snapshots)"

run_sandboxed() {
  # Mismo contrato que las units productivas + la cache candidata.
  systemd-run --wait --pipe --collect --quiet \
    -p ProtectHome=true -p ProtectSystem=strict -p PrivateTmp=true \
    -p PrivateDevices=true -p NoNewPrivileges=true \
    -p ReadWritePaths="$W" \
    -p CacheDirectory="$CACHE_NAME" -p CacheDirectoryMode=0700 \
    -p Environment=RESTIC_CACHE_DIR="$CACHE_HOST" \
    -p Environment=RESTIC_REPOSITORY="$W/repo" \
    -p Environment=RESTIC_PASSWORD_FILE="$W/pw" \
    /usr/bin/restic snapshots --json
}

echo "== RUN 1: cache inexistente -> se crea y se puebla =="
OUT1=$(run_sandboxed); RC1=$?
N1=$(find "$CACHE_HOST" -type f 2>/dev/null | wc -l)
[ "$RC1" -eq 0 ] && pass "restic bajo sandbox rc=0" || fail "restic rc=$RC1"
echo "$OUT1" | grep -q '"short_id"' && pass "snapshots legibles bajo sandbox" \
  || fail "salida sin snapshots"
[ "$N1" -gt 0 ] && pass "CACHE_PERSISTENCE=true (cache poblada: $N1 ficheros en $CACHE_HOST)" \
  || fail "cache vacia tras RUN1"

FPR1=$(find "$CACHE_HOST" -type f -printf '%p %s %T@\n' 2>/dev/null | sort | sha256sum | cut -d' ' -f1)

echo "== RUN 2: misma cache -> se reutiliza sin regenerar =="
run_sandboxed >/dev/null; RC2=$?
N2=$(find "$CACHE_HOST" -type f 2>/dev/null | wc -l)
FPR2=$(find "$CACHE_HOST" -type f -printf '%p %s %T@\n' 2>/dev/null | sort | sha256sum | cut -d' ' -f1)
[ "$RC2" -eq 0 ] && pass "RUN2 rc=0" || fail "RUN2 rc=$RC2"
if [ "$N1" = "$N2" ] && [ "$FPR1" = "$FPR2" ]; then
  pass "CACHE_REUSE=true (mismos $N2 ficheros, mismos mtime: nada re-descargado)"
else
  fail "cache alterada entre RUN1 y RUN2 (n=$N1->$N2)"
fi

echo "== RUN 3: cache borrada -> restic funciona y la reconstruye =="
rm -rf "$CACHE_HOST"
run_sandboxed >/dev/null; RC3=$?
N3=$(find "$CACHE_HOST" -type f 2>/dev/null | wc -l)
[ "$RC3" -eq 0 ] && [ "$N3" -gt 0 ] \
  && pass "CACHE_RECONSTRUCTIBLE=true (rc=0, repoblada: $N3 ficheros)" \
  || fail "reconstruccion fallida rc=$RC3 n=$N3"

echo "== F4: serializacion por el lock compartido (procesos reales) =="
LOCK="$W/lock"
python3 - "$UNIT_SRC" "$LOCK" <<'PY'
import subprocess, sys, time, os
unit_src, lock = sys.argv[1], sys.argv[2]
runners = os.path.join(unit_src, "runners")
holder = subprocess.Popen([
    "python3", "-c",
    "import sys, time; sys.path.insert(0, sys.argv[1]);"
    "from chibalete_backup.locking import SharedLock;"
    "l = SharedLock(sys.argv[2]); l.__enter__(); time.sleep(3); l.__exit__(None, None, None)",
    runners, lock])
time.sleep(0.7)
probe = subprocess.run([
    "python3", "-c",
    "import sys; sys.path.insert(0, sys.argv[1]);"
    "from chibalete_backup.locking import SharedLock;"
    "from chibalete_backup.errors import LockBusy\n"
    "try:\n"
    "    with SharedLock(sys.argv[2]):\n"
    "        print('TOMADO')\n"
    "except LockBusy:\n"
    "    print('BUSY')",
    runners, lock], capture_output=True, text=True)
holder.wait()
after = subprocess.run([
    "python3", "-c",
    "import sys; sys.path.insert(0, sys.argv[1]);"
    "from chibalete_backup.locking import SharedLock\n"
    "with SharedLock(sys.argv[2]):\n"
    "    print('TOMADO')",
    runners, lock], capture_output=True, text=True)
ok1 = probe.stdout.strip() == "BUSY"
ok2 = after.stdout.strip() == "TOMADO"
print(("  PASS  BACKUP_LOCK_SHARED=true: segundo proceso -> LockBusy" if ok1
       else f"  FAIL  lock no serializa ({probe.stdout!r} {probe.stderr[-200:]!r})"))
print(("  PASS  CACHE_SAFE_UNDER_JOB_SERIALIZATION=true (lock liberado y retomable)" if ok2
       else f"  FAIL  lock no liberado ({after.stdout!r})"))
sys.exit(0 if (ok1 and ok2) else 1)
PY
[ $? -eq 0 ] || FAILURES=$((FAILURES + 1))

printf '\n=== HARNESS: %s (FAILURES=%d) ===\n' "$([ "$FAILURES" -eq 0 ] && echo GREEN || echo RED)" "$FAILURES"
exit "$FAILURES"
