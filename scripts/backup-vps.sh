#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Chibalete+ — Backup operacional pre-deploy
# Sprint 022 / Fase 2B.5
#
# Objetivo:
#   Primer línea de defensa contra corrupción operacional y deploys
#   fallidos. NO sustituye disaster recovery. Backup local, idempotente,
#   recuperable manualmente.
#
# Qué respalda (en orden de criticidad):
#   1. /var/www/chibalete/data           → data.tar.gz
#   2. /var/www/chibalete/data-critical  → data-critical.tar.gz
#   3. /var/www/chibalete/server         → server.tar.gz
#   4. /opt/chibaleteplus/docker-compose.yml → copia plana
#   5. /var/www/chibalete/public/uploads → uploads-manifest.txt
#                                          (sólo lista path+size+mtime,
#                                           NO contenido)
#
# Qué NO respalda:
#   - Imágenes Docker (chibalete/api:latest, chibalete/front:<tag>)
#     → conservadas por retention de Docker, no por este script.
#   - Contenido de uploads/ (puede pesar GBs).
#   - /var/lib/docker/ ni logs de container.
#
# Salida:
#   /root/backups/chibalete/<TS>/
#       ├── data.tar.gz
#       ├── data-critical.tar.gz
#       ├── server.tar.gz
#       ├── docker-compose.yml
#       ├── uploads-manifest.txt
#       ├── metadata.json
#       └── backup.log
#
# Uso:
#   sudo ./scripts/backup-vps.sh
#
# Variables overridables (sólo para testing local — NO usar en VPS):
#   SOURCE_DATA_BASE   (default /var/www/chibalete)
#   SOURCE_COMPOSE     (default /opt/chibaleteplus/docker-compose.yml)
#   BACKUP_BASE        (default /root/backups/chibalete)
#   RETENTION_DAYS     (default 7)
#   MIN_FREE_GB        (default 5)
#   FREE_MULTIPLIER    (default 3 — espacio libre debe ser ≥ N×tamaño fuentes)
#
# Exit codes:
#   0 → backup OK, retention aplicada
#   1 → fail-fast en validaciones (precondiciones)
#   2 → error durante ejecución (tar, copy, manifest)
#   3 → error en retention (backup OK pero cleanup falló)
# ─────────────────────────────────────────────────────────────────────

set -Eeuo pipefail

# ── Config (overridable para testing) ──────────────────────────────────
SOURCE_DATA_BASE="${SOURCE_DATA_BASE:-/var/www/chibalete}"
SOURCE_COMPOSE="${SOURCE_COMPOSE:-/opt/chibaleteplus/docker-compose.yml}"
BACKUP_BASE="${BACKUP_BASE:-/root/backups/chibalete}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
MIN_FREE_GB="${MIN_FREE_GB:-5}"
FREE_MULTIPLIER="${FREE_MULTIPLIER:-3}"

SOURCE_DATA="$SOURCE_DATA_BASE/data"
SOURCE_DATA_CRITICAL="$SOURCE_DATA_BASE/data-critical"
SOURCE_SERVER="$SOURCE_DATA_BASE/server"
SOURCE_UPLOADS="$SOURCE_DATA_BASE/public/uploads"

# UTC ISO-ish, file-safe (colons → hyphens)
TS="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
BACKUP_DIR="$BACKUP_BASE/$TS"
BACKUP_PARTIAL="$BACKUP_BASE/${TS}.partial"
LOG_FILE=""    # se asigna después de mkdir BACKUP_PARTIAL

# ── Helpers de logging ─────────────────────────────────────────────────
ts_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# log_raw imprime a stdout y, si LOG_FILE está seteado, también a archivo.
log_raw() {
  local level="$1"; shift
  local line
  line="[$(ts_now)] [$level] $*"
  echo "$line"
  if [ -n "$LOG_FILE" ] && [ -w "$(dirname "$LOG_FILE")" ]; then
    echo "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
}

log()   { log_raw "INFO"  "$*"; }
warn()  { log_raw "WARN"  "$*"; }
err()   { log_raw "ERROR" "$*" >&2; }
ok()    { log_raw "OK"    "$*"; }

fail() {
  local code="${2:-1}"
  err "$1"
  exit "$code"
}

# ── Trap ERR: log línea + comando + exit code ──────────────────────────
on_error() {
  local exit_code=$?
  local line="${BASH_LINENO[0]:-?}"
  local cmd="${BASH_COMMAND:-?}"
  err "FALLO en línea $line — comando: '$cmd' — exit=$exit_code"
  err "Backup ABORTADO. Artefactos parciales en: ${BACKUP_PARTIAL:-N/A}"
  err "Inspeccionar manualmente y eliminar si corresponde."
  exit "${exit_code:-2}"
}
trap on_error ERR

# ── Helpers de bytes ───────────────────────────────────────────────────
# du -sb es GNU coreutils; está en cualquier Debian/Ubuntu moderno.
# Devuelve bytes (entero) o 0 si el path no existe.
size_bytes() {
  local path="$1"
  [ -e "$path" ] || { echo 0; return; }
  du -sb "$path" 2>/dev/null | awk '{print $1}'
}

# Espacio libre en bytes del filesystem que contiene el path.
# df --output=avail está en GNU coreutils ≥ 8.21 (Debian 8+).
free_bytes() {
  local path="$1"
  df --output=avail -B1 "$path" 2>/dev/null | tail -1 | tr -d ' '
}

human_bytes() {
  numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "${1}B"
}

# SHA256 portable: prefiere sha256sum (Linux), cae a shasum -a 256 (macOS/WSL).
sha256_of() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$file" | awk '{print $1}'
  else
    echo "sha256-unavailable"
  fi
}

# ── FASE 0 — Pre-flight: validar precondiciones ────────────────────────
phase_preflight() {
  log "FASE 0: pre-flight (validando precondiciones)"

  # Paths fuente obligatorios
  for p in "$SOURCE_DATA" "$SOURCE_DATA_CRITICAL" "$SOURCE_SERVER"; do
    [ -d "$p" ] || fail "Path fuente no existe o no es directorio: $p"
  done
  log "  ✓ data, data-critical, server existen"

  [ -f "$SOURCE_COMPOSE" ] || fail "Compose canónico no encontrado: $SOURCE_COMPOSE"
  log "  ✓ docker-compose.yml encontrado"

  # uploads/ es opcional para fase preflight (el manifest se hace best-effort)
  if [ ! -d "$SOURCE_UPLOADS" ]; then
    warn "  ⚠ uploads/ no existe ($SOURCE_UPLOADS) — manifest se generará vacío"
  fi

  # BACKUP_BASE: crear si no existe; debe ser escribible; perms 0700
  if ! mkdir -p "$BACKUP_BASE" 2>/dev/null; then
    fail "No se puede crear BACKUP_BASE: $BACKUP_BASE (¿permisos? ¿correr como root?)"
  fi
  if [ ! -w "$BACKUP_BASE" ]; then
    fail "BACKUP_BASE no es escribible: $BACKUP_BASE"
  fi
  # Cierre defensivo: backups sólo legibles por owner (evita filtración por
  # umask laxo). Idempotente; no falla si ya está en 0700.
  chmod 700 "$BACKUP_BASE" || warn "  ⚠ no se pudo aplicar chmod 700 a $BACKUP_BASE (continuar)"
  log "  ✓ $BACKUP_BASE escribible (perms 0700)"

  # Idempotencia: si el TS ya existe, abortar (no pisar)
  if [ -e "$BACKUP_DIR" ]; then
    fail "Backup con TS=$TS ya existe en $BACKUP_DIR. Abort por seguridad."
  fi
  if [ -e "$BACKUP_PARTIAL" ]; then
    fail "Directorio .partial residual en $BACKUP_PARTIAL. Inspeccionar y limpiar manualmente antes de re-correr."
  fi

  # Cálculo de tamaño de fuentes y validación de espacio
  local size_data size_dc size_srv size_total free
  size_data=$(size_bytes "$SOURCE_DATA")
  size_dc=$(size_bytes "$SOURCE_DATA_CRITICAL")
  size_srv=$(size_bytes "$SOURCE_SERVER")
  size_total=$(( size_data + size_dc + size_srv ))

  free=$(free_bytes "$BACKUP_BASE")
  if [ -z "$free" ] || [ "$free" -eq 0 ]; then
    fail "No se pudo determinar espacio libre en $BACKUP_BASE"
  fi

  local min_bytes_floor=$(( MIN_FREE_GB * 1024 * 1024 * 1024 ))
  local min_bytes_proportional=$(( size_total * FREE_MULTIPLIER ))
  local min_bytes_required=$min_bytes_floor
  [ "$min_bytes_proportional" -gt "$min_bytes_required" ] && min_bytes_required=$min_bytes_proportional

  log "  ℹ tamaño fuentes: data=$(human_bytes "$size_data"), data-critical=$(human_bytes "$size_dc"), server=$(human_bytes "$size_srv"), total=$(human_bytes "$size_total")"
  log "  ℹ espacio libre en BACKUP_BASE: $(human_bytes "$free")"
  log "  ℹ requerido: max($(human_bytes "$min_bytes_floor"), ${FREE_MULTIPLIER}× total = $(human_bytes "$min_bytes_proportional")) = $(human_bytes "$min_bytes_required")"

  if [ "$free" -lt "$min_bytes_required" ]; then
    fail "Espacio libre insuficiente: $(human_bytes "$free") < $(human_bytes "$min_bytes_required")"
  fi
  log "  ✓ espacio libre suficiente"

  # Exportar para fases siguientes
  PRECOMPUTED_SIZE_DATA=$size_data
  PRECOMPUTED_SIZE_DC=$size_dc
  PRECOMPUTED_SIZE_SRV=$size_srv
  PRECOMPUTED_SIZE_TOTAL=$size_total
  PRECOMPUTED_FREE=$free
}

# ── FASE 1 — Crear directorio .partial ─────────────────────────────────
phase_create_dir() {
  log "FASE 1: creando directorio .partial"
  mkdir -p "$BACKUP_PARTIAL"
  # Perms 0700 antes de escribir nada adentro (los .tar.gz contienen JSONs
  # con datos de usuarios/audit/secrets; no deben quedar group/world-readable).
  # mv preserva perms, así que el rename a <TS>/ mantiene 0700 también.
  chmod 700 "$BACKUP_PARTIAL"
  LOG_FILE="$BACKUP_PARTIAL/backup.log"
  : > "$LOG_FILE"     # truncar/crear vacío
  log "  ✓ $BACKUP_PARTIAL creado (perms 0700), log → $LOG_FILE"
}

# ── FASE 2 — Tar de cada fuente crítica ────────────────────────────────
# Uso: tar_source <nombre> <source_path> <output_filename>
tar_source() {
  local name="$1"
  local src="$2"
  local out="$BACKUP_PARTIAL/$3"
  local parent base

  log "FASE 2.$name: tar $src → $3"

  parent="$(dirname "$src")"
  base="$(basename "$src")"

  # tar con cd a parent → archivo contiene rutas relativas (`base/...`),
  # no rutas absolutas. Restore: tar -xzf data.tar.gz -C /tmp/restore/
  # produce /tmp/restore/data/...
  if ! tar -czf "$out" -C "$parent" "$base"; then
    fail "tar falló para $name ($src)" 2
  fi

  if [ ! -s "$out" ]; then
    fail "tar produjo archivo vacío para $name: $out" 2
  fi

  local size sha
  size=$(stat -c%s "$out" 2>/dev/null || stat -f%z "$out" 2>/dev/null || echo 0)
  sha=$(sha256_of "$out")
  ok "  ✓ $3 → $(human_bytes "$size") sha256=${sha:0:16}…"

  # Variables para metadata.json (declaradas globalmente)
  case "$name" in
    data)          OUT_DATA_SIZE=$size;         OUT_DATA_SHA=$sha ;;
    data-critical) OUT_DATA_CRITICAL_SIZE=$size; OUT_DATA_CRITICAL_SHA=$sha ;;
    server)        OUT_SERVER_SIZE=$size;       OUT_SERVER_SHA=$sha ;;
  esac
}

phase_tar_critical() {
  tar_source "data"          "$SOURCE_DATA"          "data.tar.gz"
  tar_source "data-critical" "$SOURCE_DATA_CRITICAL" "data-critical.tar.gz"
  tar_source "server"        "$SOURCE_SERVER"        "server.tar.gz"
}

# ── FASE 3 — Copia plana docker-compose.yml ────────────────────────────
phase_copy_compose() {
  log "FASE 3: copiando docker-compose.yml"
  cp -p "$SOURCE_COMPOSE" "$BACKUP_PARTIAL/docker-compose.yml"
  local size sha
  size=$(stat -c%s "$BACKUP_PARTIAL/docker-compose.yml" 2>/dev/null || stat -f%z "$BACKUP_PARTIAL/docker-compose.yml" 2>/dev/null || echo 0)
  sha=$(sha256_of "$BACKUP_PARTIAL/docker-compose.yml")
  OUT_COMPOSE_SIZE=$size
  OUT_COMPOSE_SHA=$sha
  ok "  ✓ docker-compose.yml → $(human_bytes "$size")"
}

# ── FASE 4 — Manifiesto de uploads (sólo lista, no contenido) ──────────
phase_uploads_manifest() {
  log "FASE 4: generando uploads-manifest.txt"
  local manifest="$BACKUP_PARTIAL/uploads-manifest.txt"
  local file_count=0
  local total_bytes=0

  if [ -d "$SOURCE_UPLOADS" ]; then
    {
      echo "# uploads manifest — $SOURCE_UPLOADS"
      echo "# generated: $(ts_now)"
      echo "# format: PATH<TAB>SIZE_BYTES<TAB>MTIME_UTC"
      echo "#"
      # find ... -printf "%p\t%s\t%TY-%Tm-%Td %TH:%TM\n" → GNU find (Linux).
      # En el VPS es seguro. Para macOS/BSD habría que stat por archivo, pero
      # el script corre en VPS Debian/Ubuntu, así que usamos -printf.
      find "$SOURCE_UPLOADS" -type f -printf "%p\t%s\t%TY-%Tm-%TdT%TH:%TMZ\n" 2>/dev/null | sort
    } > "$manifest"

    # Resumen
    file_count=$(grep -cv '^#' "$manifest" 2>/dev/null || echo 0)
    total_bytes=$(awk -F'\t' '!/^#/ {s+=$2} END {print s+0}' "$manifest")
    {
      echo ""
      echo "# TOTAL: $file_count files, $(human_bytes "$total_bytes")"
    } >> "$manifest"
  else
    {
      echo "# uploads manifest — $SOURCE_UPLOADS"
      echo "# generated: $(ts_now)"
      echo "# WARN: source path does not exist"
      echo "# TOTAL: 0 files, 0B"
    } > "$manifest"
  fi

  OUT_UPLOADS_FILE_COUNT=$file_count
  OUT_UPLOADS_TOTAL_BYTES=$total_bytes
  ok "  ✓ uploads-manifest.txt → $file_count files, $(human_bytes "$total_bytes")"
}

# ── FASE 5 — metadata.json ─────────────────────────────────────────────
# Construido a mano para evitar dependencia en jq. Los valores son seguros
# (números, hashes hex, paths controlados, hostnames), no requieren escape JSON.
phase_metadata() {
  log "FASE 5: generando metadata.json"
  local meta="$BACKUP_PARTIAL/metadata.json"
  local hostname uname_a backup_user
  hostname=$(hostname 2>/dev/null || echo "unknown")
  uname_a=$(uname -srm 2>/dev/null || echo "unknown")
  backup_user=$(id -un 2>/dev/null || echo "unknown")

  cat > "$meta" <<EOF
{
  "schema_version": "1.0",
  "timestamp_utc": "$TS",
  "hostname": "$hostname",
  "uname": "$uname_a",
  "user": "$backup_user",
  "sources": {
    "data": "$SOURCE_DATA",
    "data_critical": "$SOURCE_DATA_CRITICAL",
    "server": "$SOURCE_SERVER",
    "compose": "$SOURCE_COMPOSE",
    "uploads": "$SOURCE_UPLOADS"
  },
  "artifacts": {
    "data.tar.gz": {
      "size_bytes": ${OUT_DATA_SIZE:-0},
      "sha256": "${OUT_DATA_SHA:-}"
    },
    "data-critical.tar.gz": {
      "size_bytes": ${OUT_DATA_CRITICAL_SIZE:-0},
      "sha256": "${OUT_DATA_CRITICAL_SHA:-}"
    },
    "server.tar.gz": {
      "size_bytes": ${OUT_SERVER_SIZE:-0},
      "sha256": "${OUT_SERVER_SHA:-}"
    },
    "docker-compose.yml": {
      "size_bytes": ${OUT_COMPOSE_SIZE:-0},
      "sha256": "${OUT_COMPOSE_SHA:-}"
    },
    "uploads-manifest.txt": {
      "file_count": ${OUT_UPLOADS_FILE_COUNT:-0},
      "total_bytes": ${OUT_UPLOADS_TOTAL_BYTES:-0}
    }
  },
  "preflight": {
    "source_total_bytes": ${PRECOMPUTED_SIZE_TOTAL:-0},
    "free_bytes_at_start": ${PRECOMPUTED_FREE:-0},
    "min_free_gb": $MIN_FREE_GB,
    "free_multiplier": $FREE_MULTIPLIER
  },
  "retention_days": $RETENTION_DAYS,
  "status": "ok"
}
EOF
  ok "  ✓ metadata.json escrito"
}

# ── FASE 6 — Atomic rename .partial → final ────────────────────────────
phase_finalize() {
  log "FASE 6: rename atómico .partial → final"
  mv "$BACKUP_PARTIAL" "$BACKUP_DIR"
  # Re-apuntar LOG_FILE al destino final (futuras escrituras)
  LOG_FILE="$BACKUP_DIR/backup.log"
  ok "  ✓ backup final en: $BACKUP_DIR"
}

# ── FASE 7 — Retention (sólo si llegamos hasta acá: backup OK) ─────────
phase_retention() {
  log "FASE 7: retention de $RETENTION_DAYS días"

  # Encontrar directorios timestamp con mtime > RETENTION_DAYS días
  # -mindepth/-maxdepth 1 → sólo top-level dirs en BACKUP_BASE
  # -type d → sólo directorios
  # -mtime +N → modificado hace más de N días (estricto)
  # ! -name *.partial → nunca borrar partials (si existen son evidencia
  #                     de fallos pasados que el operador debe revisar)
  local to_delete
  to_delete=$(find "$BACKUP_BASE" \
    -mindepth 1 -maxdepth 1 \
    -type d \
    ! -name '*.partial' \
    -mtime "+$RETENTION_DAYS" \
    2>/dev/null || true)

  if [ -z "$to_delete" ]; then
    log "  ℹ ningún backup excede $RETENTION_DAYS días, nada que borrar"
    return 0
  fi

  local count=0
  while IFS= read -r dir; do
    [ -z "$dir" ] && continue
    log "  ✗ borrando (>$RETENTION_DAYS días): $dir"
    if ! rm -rf -- "$dir"; then
      err "rm -rf falló en $dir — continuar (no abortar todo el script)"
      return 3
    fi
    count=$((count + 1))
  done <<< "$to_delete"

  ok "  ✓ retention completada — $count directorios eliminados"
}

# ── FASE 8 — Resumen final ─────────────────────────────────────────────
phase_summary() {
  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo " ✅ BACKUP COMPLETADO"
  echo "─────────────────────────────────────────────────────────────"
  echo " Timestamp UTC : $TS"
  echo " Destino       : $BACKUP_DIR"
  echo " Artefactos    :"
  if command -v ls >/dev/null 2>&1; then
    ls -lh "$BACKUP_DIR" 2>/dev/null | tail -n +2 | awk '{printf "                   %s  %s\n", $5, $NF}'
  fi
  echo ""
  echo " Restore manual (ejemplo data/):"
  echo "   tar -xzf $BACKUP_DIR/data.tar.gz -C /tmp/restore-$TS/"
  echo "   diff -r /tmp/restore-$TS/data $SOURCE_DATA   # inspeccionar"
  echo ""
  echo " Verificar integridad de un artefacto:"
  echo "   sha256sum $BACKUP_DIR/data.tar.gz"
  echo "   jq '.artifacts.\"data.tar.gz\".sha256' $BACKUP_DIR/metadata.json"
  echo "   # Ambos valores deben coincidir."
  echo "─────────────────────────────────────────────────────────────"

  # Sentinel D1 — última línea estable de stdout en camino exitoso.
  # Consumido por scripts/deploy-backend.sh (Fase 2B.7) para capturar
  # el TS del backup recién creado de forma robusta:
  #   BACKUP_TS=$(ssh "$VPS_HOST" "$REMOTE_BACKUP_SCRIPT" | tail -1 | sed 's/^BACKUP_TS=//')
  # Es la ÚLTIMA línea, prefijo fijo "BACKUP_TS=", sin espacios, parseable
  # con cualquier herramienta. NO emitir esta línea en path de fallo.
  echo "BACKUP_TS=$TS"
}

# ── MAIN ───────────────────────────────────────────────────────────────
main() {
  log "Chibalete+ backup-vps.sh — TS=$TS"
  log "  SOURCE_DATA_BASE = $SOURCE_DATA_BASE"
  log "  BACKUP_BASE      = $BACKUP_BASE"
  log "  RETENTION_DAYS   = $RETENTION_DAYS"
  log "  MIN_FREE_GB      = $MIN_FREE_GB"

  phase_preflight
  phase_create_dir
  phase_tar_critical
  phase_copy_compose
  phase_uploads_manifest
  phase_metadata
  phase_finalize

  # Retention: si falla, no abortar todo (backup ya está OK).
  # Capturar exit code y propagar como aviso.
  if ! phase_retention; then
    warn "retention falló pero backup principal está OK"
    phase_summary
    exit 3
  fi

  phase_summary
  exit 0
}

main "$@"
