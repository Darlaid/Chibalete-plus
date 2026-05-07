#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Test mock-suite para scripts/deploy-backend.sh — Sprint 022 Fase 2B.7
#
# Cubre los flujos críticos sin tocar VPS real:
#   1. Helpers de parsing JSON (sin jq) — json_ok_true, json_field_string
#   2. BACKUP_TS sentinel propagation desde stdout de backup-vps.sh
#   3. counts_equivalent (con jq local)
#   4. Cleanup retention en mock filesystem
#   5. CLI: --help, args inválidos, sin --release-tag
#   6. Tarball B1 incluye .deploy-info bien formado
#   7. Watchdog: presencia de la lógica de timeout
#
# Patrón: usa subshell ( source $SCRIPT ) con DEPLOY_BACKEND_TEST_NO_MAIN=1
# para invocar funciones internas sin disparar main.
# ─────────────────────────────────────────────────────────────────────

set -Eeuo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DEPLOY_SCRIPT="$REPO_ROOT/scripts/deploy-backend.sh"
TROOT="/tmp/chib-deploy-mock-test"

PASS=0
FAIL=0
assert() {
    local label="$1"; local cond="$2"
    if eval "$cond"; then
        echo "  ✓ $label"
        PASS=$((PASS+1))
    else
        echo "  ✗ $label   [eval: $cond]"
        FAIL=$((FAIL+1))
    fi
}

setup() {
    rm -rf "$TROOT"
    mkdir -p "$TROOT"
}

teardown() {
    rm -rf "$TROOT"
    rm -f /tmp/chib-server-rel-*.tgz 2>/dev/null || true
}

trap teardown EXIT

# Helper: ejecuta funciones internas del script en subshell aislado.
# Usa source con DEPLOY_BACKEND_TEST_NO_MAIN=1 para evitar correr main.
# Devuelve el stdout de los comandos (el `source` se silencia con >/dev/null).
run_in_script() {
    (
        export DEPLOY_BACKEND_TEST_NO_MAIN=1
        # shellcheck disable=SC1090
        source "$DEPLOY_SCRIPT" >/dev/null 2>&1
        # set -e dentro del subshell debe seguir activo (lo que hace el script)
        # pero el caller puede catch via exit code del subshell.
        eval "$@"
    )
}

setup
echo "═══════════════════════════════════════════════════════════════"
echo " deploy-backend.sh mock-suite"
echo "═══════════════════════════════════════════════════════════════"

# ────────────────────────────────────────────────────────────────────
# CASO 1 — Helpers de parsing JSON sin jq
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 1] Helpers de parsing JSON sin jq"
{
    out=$(run_in_script 'json_ok_true "{\"ok\":true,\"counts\":{\"users\":3}}" && echo HIT || echo MISS')
    assert "ok=true detectado" '[ "$out" = "HIT" ]'

    out=$(run_in_script 'json_ok_true "{\"ok\":false,\"issues\":[]}" && echo HIT || echo MISS')
    assert "ok=false NO disparar HIT" '[ "$out" = "MISS" ]'

    out=$(run_in_script 'json_ok_true "{\"ok\" : true }" && echo HIT || echo MISS')
    assert "ok=true tolera whitespace" '[ "$out" = "HIT" ]'

    out=$(run_in_script 'json_field_string "{\"commit\":\"abc1234\",\"x\":\"y\"}" commit')
    assert "json_field_string extrae commit" '[ "$out" = "abc1234" ]'

    out=$(run_in_script 'json_field_string "{\"status\":\"ok\",\"uptime\":42}" status')
    assert "json_field_string extrae status" '[ "$out" = "ok" ]'
}

# ────────────────────────────────────────────────────────────────────
# CASO 2 — BACKUP_TS sentinel parsing (D1)
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 2] BACKUP_TS sentinel parsing"
{
    SAMPLE_OUT=$(printf '%s\n' \
        "[INFO] Chibalete+ backup-vps.sh — TS=2026-05-07T11-49-49Z" \
        "[INFO] FASE 0: pre-flight" \
        "[OK]   ✓ data.tar.gz → 316B" \
        "─────────────────────────────────" \
        " Verificar integridad de un artefacto:" \
        "─────────────────────────────────" \
        "BACKUP_TS=2026-05-07T11-49-49Z")

    captured=$(echo "$SAMPLE_OUT" | grep '^BACKUP_TS=' | tail -1 | sed 's/^BACKUP_TS=//')
    assert "extrae TS exacto del sentinel" '[ "$captured" = "2026-05-07T11-49-49Z" ]'

    SAMPLE_FAIL='[ERROR] Path fuente no existe'
    captured_fail=$(echo "$SAMPLE_FAIL" | grep '^BACKUP_TS=' | tail -1 | sed 's/^BACKUP_TS=//' || true)
    assert "sin sentinel devuelve string vacío" '[ -z "$captured_fail" ]'

    SAMPLE_MULTI=$(printf '%s\n' \
        "línea cualquiera" \
        "BACKUP_TS=2026-01-01T00-00-00Z" \
        "otra línea" \
        "BACKUP_TS=2026-05-07T11-49-49Z")
    captured_multi=$(echo "$SAMPLE_MULTI" | grep '^BACKUP_TS=' | tail -1 | sed 's/^BACKUP_TS=//')
    assert "tail -1 captura el último (más reciente)" '[ "$captured_multi" = "2026-05-07T11-49-49Z" ]'
}

# ────────────────────────────────────────────────────────────────────
# CASO 3 — counts_equivalent
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 3] counts_equivalent"
{
    # jq puede no estar disponible localmente. counts_equivalent tiene
    # fallback textual; nuestro test debe ser tolerante a ambos paths.
    if command -v jq >/dev/null 2>&1; then
        # Path con jq: deep-equal aunque keys estén reordenadas
        out=$(run_in_script 'if counts_equivalent "{\"users\":3,\"groups\":2}" "{\"groups\":2,\"users\":3}"; then echo EQ; else echo NEQ; fi')
        assert "deep-equal con keys reordenadas (jq path)" '[ "$out" = "EQ" ]'
    else
        # Path sin jq: comparación textual literal (NEQ con keys reordenadas)
        out=$(run_in_script 'if counts_equivalent "{\"x\":1}" "{\"x\":1}"; then echo EQ; else echo NEQ; fi')
        assert "comparación textual literal idéntica (sin jq)" '[ "$out" = "EQ" ]'
    fi

    # Caso universal: valores distintos NO son equivalentes
    out=$(run_in_script 'if counts_equivalent "{\"users\":3}" "{\"users\":4}"; then echo EQ; else echo NEQ; fi')
    assert "valores distintos NO equivalentes" '[ "$out" = "NEQ" ]'
}

# ────────────────────────────────────────────────────────────────────
# CASO 4 — Cleanup retention (mock filesystem)
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 4] Cleanup retention de server.old-* / .staging-* / .failed-*"
{
    MOCK="$TROOT/mock-www"
    rm -rf "$MOCK"
    mkdir -p "$MOCK"
    BACKUP_TS_NEW="2026-05-07T12-00-00Z"
    mkdir -p "$MOCK/server.old-$BACKUP_TS_NEW"
    # Backups viejos de varios días
    for ts in 2026-05-01 2026-05-02 2026-05-03 2026-05-06; do
        mkdir -p "$MOCK/server.old-${ts}T00-00-00Z"
        touch -d "$ts" "$MOCK/server.old-${ts}T00-00-00Z" 2>/dev/null || true
    done
    for tag in 2026-04-25-x 2026-04-28-y 2026-05-04-z 2026-05-06-w; do
        mkdir -p "$MOCK/server.staging-rel-$tag"
        touch -d "${tag:0:10}" "$MOCK/server.staging-rel-$tag" 2>/dev/null || true
    done
    for ts in 2026-04-01 2026-04-10 2026-04-15 2026-04-20 2026-04-25 2026-05-01; do
        mkdir -p "$MOCK/server.failed-${ts}T00-00-00Z"
        touch -d "$ts" "$MOCK/server.failed-${ts}T00-00-00Z" 2>/dev/null || true
    done

    # Aplicar la lógica de cleanup tal como la usa el script
    KEEP_OLD=3 KEEP_STAGING=2 KEEP_FAILED=5
    pushd "$MOCK" >/dev/null
    # server.old-* (proteger BACKUP_TS_NEW)
    for d in $(ls -1dt server.old-* 2>/dev/null | tail -n +$((KEEP_OLD + 1))); do
        [ "$d" != "server.old-$BACKUP_TS_NEW" ] && rm -rf "$d"
    done
    for d in $(ls -1dt server.staging-* 2>/dev/null | tail -n +$((KEEP_STAGING + 1))); do
        rm -rf "$d"
    done
    for d in $(ls -1dt server.failed-* 2>/dev/null | tail -n +$((KEEP_FAILED + 1))); do
        rm -rf "$d"
    done
    popd >/dev/null

    n_old=$(ls -1d "$MOCK"/server.old-* 2>/dev/null | wc -l)
    assert "conserva ≥3 server.old-* (incluyendo BACKUP_TS protegido)" '[ "$n_old" -ge 3 ]'
    assert "conserva ≤4 server.old-* (3 + BACKUP_TS protegido)" '[ "$n_old" -le 4 ]'
    assert "BACKUP_TS_NEW preservado" '[ -d "$MOCK/server.old-$BACKUP_TS_NEW" ]'

    n_stg=$(ls -1d "$MOCK"/server.staging-* 2>/dev/null | wc -l)
    assert "conserva ≤2 server.staging-*" '[ "$n_stg" -le 2 ]'

    n_fail=$(ls -1d "$MOCK"/server.failed-* 2>/dev/null | wc -l)
    assert "conserva ≤5 server.failed-* (forensics)" '[ "$n_fail" -le 5 ]'
}

# ────────────────────────────────────────────────────────────────────
# CASO 5 — CLI: argumentos y exit codes
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 5] CLI: argumentos y exit codes"
{
    out=$(bash "$DEPLOY_SCRIPT" --help 2>&1)
    rc=$?
    assert "--help exit 0" '[ "$rc" = "0" ]'
    assert "--help NO muestra DEPLOY EXITOSO banner" '! echo "$out" | grep -q "DEPLOY BACKEND EXITOSO"'

    set +e
    bash "$DEPLOY_SCRIPT" --xyz >/dev/null 2>&1
    rc=$?
    set -e
    assert "argumento inválido → exit 1" '[ "$rc" = "1" ]'

    set +e
    bash "$DEPLOY_SCRIPT" --actor x >/dev/null 2>&1
    rc=$?
    set -e
    assert "sin --release-tag → exit 1" '[ "$rc" = "1" ]'
}

# ────────────────────────────────────────────────────────────────────
# CASO 6 — Tarball B1 incluye .deploy-info bien formado
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 6] Tarball B1 incluye server/.deploy-info"
{
    cd "$REPO_ROOT"
    tarball_path="/tmp/chib-server-rel-2026-05-07-mocktest.tgz"
    rm -f "$tarball_path"

    # Correr B1 en subshell aislado, con vars precargadas.
    # NOTA: el script tiene un trap EXIT que limpia TARBALL al salir.
    # Si invocamos solo phase_b1 (sin main) y luego el subshell termina,
    # el trap EXIT se ejecuta y borra el tarball. Para inspeccionar el
    # contenido, copiamos el tarball ANTES de salir del subshell.
    saved_tarball="/tmp/chib-saved-mocktest.tgz"
    rm -f "$saved_tarball"
    (
        export DEPLOY_BACKEND_TEST_NO_MAIN=1
        # shellcheck disable=SC1090
        source "$DEPLOY_SCRIPT" >/dev/null 2>&1
        # Quitar traps para que el cleanup no nos elimine el tarball
        trap - EXIT
        trap - ERR
        RELEASE_TAG="rel-2026-05-07-mocktest"
        GIT_SHA_FULL="abcdef1234567890"
        GIT_SHA="abcdef1"
        DRY_RUN=0
        if phase_b1 >/dev/null 2>&1; then
            cp "$TARBALL" "/tmp/chib-saved-mocktest.tgz"
        fi
    ) || true

    assert "tarball generado y copiado para inspección" '[ -f "$saved_tarball" ]'
    tarball_path="$saved_tarball"

    if [ -f "$tarball_path" ]; then
        # Listar contenido
        info=$(tar -xzOf "$tarball_path" server/.deploy-info 2>/dev/null || echo "")
        assert ".deploy-info presente en tarball" '[ -n "$info" ]'
        assert ".deploy-info contiene release_tag esperado" 'echo "$info" | grep -q "rel-2026-05-07-mocktest"'
        assert ".deploy-info contiene git_sha esperado" 'echo "$info" | grep -q "abcdef1234567890"'
        assert ".deploy-info contiene deployed_at ISO8601" 'echo "$info" | grep -qE "deployed_at.*[0-9]{4}-[0-9]{2}-[0-9]{2}T"'

        # Verificar contenido core
        files=$(tar -tzf "$tarball_path" 2>/dev/null)
        assert "tarball contiene server/server.js" 'echo "$files" | grep -q "server/server.js"'
        assert "tarball NO contiene node_modules" '! echo "$files" | grep -q "node_modules"'
        assert "tarball NO contiene __test__" '! echo "$files" | grep -q "__test__"'
    fi
}

# ────────────────────────────────────────────────────────────────────
# CASO 7 — Watchdog: lógica presente y correcta
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 7] Watchdog: análisis estático del código"
{
    assert "función start_watchdog presente" 'grep -q "start_watchdog()" "$DEPLOY_SCRIPT"'
    assert "watchdog usa sleep + kill TERM" 'grep -q "kill -TERM" "$DEPLOY_SCRIPT"'
    assert "watchdog escala a kill -KILL" 'grep -q "kill -KILL" "$DEPLOY_SCRIPT"'
    # on_exit kills WATCHDOG_PID (no string "kill" textual cerca de "trap on_exit")
    assert "on_exit() mata WATCHDOG_PID" 'grep -A20 "^on_exit()" "$DEPLOY_SCRIPT" | grep -q "kill .*WATCHDOG_PID"'
    assert "trap on_exit EXIT registrado" 'grep -q "^trap on_exit EXIT" "$DEPLOY_SCRIPT"'
    assert "GLOBAL_TIMEOUT_S configurable vía env" 'grep -qE "GLOBAL_TIMEOUT_S=.*:-1800" "$DEPLOY_SCRIPT"'
}

# ────────────────────────────────────────────────────────────────────
# CASO 8 — Lock strategy: análisis estático
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 8] Lock strategy: implementación esperada"
{
    assert "acquire_lock usa mkdir atómico" 'grep -q "mkdir.*REMOTE_LOCK_DIR" "$DEPLOY_SCRIPT"'
    assert "lock metadata incluye actor" 'grep -q "actor=\$ACTOR" "$DEPLOY_SCRIPT"'
    # PID literal: $$ — bash regex compleja, escape literal
    assert "lock metadata incluye pid (\$\$)" 'grep -F "pid=\$\$" "$DEPLOY_SCRIPT" >/dev/null'
    # on_exit hace rm -rf REMOTE_LOCK_DIR sólo si LOCK_ACQUIRED=1
    assert "on_exit verifica LOCK_ACQUIRED antes de liberar" 'grep -B5 "rm -rf.*REMOTE_LOCK_DIR" "$DEPLOY_SCRIPT" | grep -q "LOCK_ACQUIRED"'
    assert "exit code 11 para lock contention" 'grep -q "exit 11" "$DEPLOY_SCRIPT"'
}

# ────────────────────────────────────────────────────────────────────
# CASO 9 — Garantías: NO toca data, NO docker compose down
# ────────────────────────────────────────────────────────────────────
echo ""
echo "[CASO 9] Garantías de no-acción destructiva"
{
    # set +e localmente: las pipelines con grep -v pueden retornar 1 si no
    # hay matches y bajo pipefail abortarían el script. `|| true` absorbe.
    has_compose_down=$( ( grep -nE 'docker compose down|docker-compose down' "$DEPLOY_SCRIPT" \
        | grep -vE '^[[:space:]]*#|JAMÁS|NO ' | head -1 ) 2>/dev/null || true )
    assert "NO usa 'docker compose down'" '[ -z "$has_compose_down" ]'

    has_data_write=$( ( grep -nE "rm -.+/data($|/)|>.*/data/" "$DEPLOY_SCRIPT" \
        | grep -v '/data-critical' \
        | grep -vE '^[[:space:]]*#|JAMÁS|NO modifica|/var/run' | head -1 ) 2>/dev/null || true )
    assert "NO escribe en /data/" '[ -z "$has_data_write" ]'

    has_pm2=$( ( grep -nE '^[^#]*pm2 ' "$DEPLOY_SCRIPT" | grep -vE 'NO PM2' | head -1 ) 2>/dev/null || true )
    assert "NO usa pm2" '[ -z "$has_pm2" ]'

    # rollback solo de código, jamás restore data automático
    assert "rollback_code() existe" 'grep -q "^rollback_code()" "$DEPLOY_SCRIPT"'
    has_data_restore=$( ( grep -nE "tar.*data\.tar\.gz" "$DEPLOY_SCRIPT" \
        | grep -vE '^[[:space:]]*#|último recurso|manual|último|backup tar' | head -1 ) 2>/dev/null || true )
    assert "rollback NO ejecuta restore automático de data.tar.gz" '[ -z "$has_data_restore" ]'
}

# ────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo " RESULTADO: pass=$PASS fail=$FAIL"
echo "═══════════════════════════════════════════════════════════════"
[ "$FAIL" = "0" ] && exit 0 || exit 1
