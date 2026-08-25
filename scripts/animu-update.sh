#!/usr/bin/env bash
#
# Animu GitHub Auto-Update Script
#
# Safely checks for and applies fast-forward updates from GitHub to CT102,
# restarts the service, verifies health, and rolls back if health checks fail.
#
# Design guarantees:
# - Exclusive non-overlapping execution via flock
# - Refuses update if deployment working tree has uncommitted tracked changes or untracked files
# - Fetches and fast-forwards only (never non-ff, never merges/rebase)
# - Exits 0 quietly if remote commit is unchanged
# - Records rollback commit prior to modifying live checkout
# - Validates service active state and /api/health HTTP 200
# - Automatically rolls back to prior commit and restarts service on failure
# - Safe logging without credentials or profile secrets
# - Independent from application secrets, profile.json, and runtime state
#

set -euo pipefail

# Configurable environment with production defaults
APP_DIR="${ANIMU_DIR:-/root/animu}"
BRANCH="${ANIMU_BRANCH:-python-rewrite}"
REMOTE="${ANIMU_REMOTE:-origin}"
SERVICE_NAME="${ANIMU_SERVICE:-animu.service}"
HEALTH_URL="${ANIMU_HEALTH_URL:-http://127.0.0.1:3210/api/health}"
HEALTH_TIMEOUT="${ANIMU_HEALTH_TIMEOUT:-30}"

# Lock file management
LOCK_FILE="${ANIMU_LOCK_FILE:-/run/lock/animu-update.lock}"
if ! touch "$LOCK_FILE" 2>/dev/null; then
  LOCK_FILE="/tmp/animu-update.lock"
fi

log() {
  echo "[animu-update] $(date -u +'%Y-%m-%dT%H:%M:%SZ') INFO: $*"
}

log_err() {
  echo "[animu-update] $(date -u +'%Y-%m-%dT%H:%M:%SZ') ERROR: $*" >&2
}

restart_service() {
  if [ -n "${ANIMU_RESTART_CMD:-}" ]; then
    eval "$ANIMU_RESTART_CMD"
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl restart "$SERVICE_NAME"
  else
    log "Warning: systemctl not found; skipping service restart."
    return 0
  fi
}

is_service_active() {
  if [ -n "${ANIMU_CHECK_ACTIVE_CMD:-}" ]; then
    eval "$ANIMU_CHECK_ACTIVE_CMD"
  elif command -v systemctl >/dev/null 2>&1; then
    systemctl is-active --quiet "$SERVICE_NAME"
  else
    return 0
  fi
}

check_health() {
  local url="$1"
  local timeout="$2"
  local elapsed=0
  local interval=2
  local http_code="000"

  while [ "$elapsed" -lt "$timeout" ]; do
    sleep "$interval"
    elapsed=$((elapsed + interval))

    # Verify service is active before querying health
    if ! is_service_active; then
      continue
    fi

    # Query health endpoint
    if command -v curl >/dev/null 2>&1; then
      http_code=$(curl -s -o /dev/null -w "%{http_code}" -m 3 "$url" 2>/dev/null || echo "000")
    elif command -v python3 >/dev/null 2>&1; then
      http_code=$(python3 -c "
import urllib.request, sys
try:
    with urllib.request.urlopen('$url', timeout=3) as r:
        sys.stdout.write(str(r.getcode()))
except urllib.error.HTTPError as e:
    sys.stdout.write(str(e.code))
except Exception:
    sys.stdout.write('000')
" 2>/dev/null || echo "000")
    else
      http_code="000"
    fi

    if [ "$http_code" = "200" ]; then
      log "Health check passed (HTTP 200, elapsed: ${elapsed}s)."
      return 0
    fi
  done

  log_err "Health check timed out after ${timeout}s (last HTTP code: ${http_code})."
  return 1
}

rollback() {
  local target="$1"
  log_err "ROLLBACK: Rolling back working tree to ${target:0:8}..."
  git -C "$APP_DIR" reset --hard "$target"

  # Re-install dependencies if requirements.txt exists
  local pip_bin="${APP_DIR}/venv/bin/pip"
  if [ -x "$pip_bin" ] && [ -f "${APP_DIR}/requirements.txt" ]; then
    log_err "ROLLBACK: Re-installing dependencies for rollback commit..."
    "$pip_bin" install -r "${APP_DIR}/requirements.txt" --quiet || true
  fi

  log_err "ROLLBACK: Restarting $SERVICE_NAME on rolled-back commit..."
  restart_service || true

  if check_health "$HEALTH_URL" "$HEALTH_TIMEOUT"; then
    log_err "ROLLBACK: Service successfully restored to healthy state on ${target:0:8}."
  else
    log_err "ROLLBACK CRITICAL: Service remained unhealthy after rollback to ${target:0:8}."
  fi
}

main() {
  # 1. Acquire exclusive lock
  exec 200>"$LOCK_FILE"
  if ! flock -n 200; then
    log "Another update process is already active. Skipping this cycle."
    exit 0
  fi

  # 2. Validate application directory and git repo
  if [ ! -d "$APP_DIR" ]; then
    log_err "Application directory $APP_DIR does not exist."
    exit 1
  fi

  if ! git -C "$APP_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    log_err "Application directory $APP_DIR is not a git repository."
    exit 1
  fi

  # 3. Check for dirty deployment checkout
  if ! git -C "$APP_DIR" diff --quiet || ! git -C "$APP_DIR" diff --cached --quiet; then
    log_err "Deployment checkout at $APP_DIR has uncommitted tracked changes. Refusing to update dirty repository."
    exit 1
  fi

  if [ -n "$(git -C "$APP_DIR" status --porcelain)" ]; then
    log_err "Deployment checkout at $APP_DIR has untracked files. Refusing to update dirty repository."
    exit 1
  fi

  # 4. Fetch target remote and branch
  log "Polling remote '$REMOTE' for branch '$BRANCH'..."
  if ! git -C "$APP_DIR" fetch "$REMOTE" "$BRANCH" --quiet; then
    log_err "Failed to fetch $REMOTE/$BRANCH. Check network connectivity or git credentials."
    exit 1
  fi

  # 5. Resolve commit hashes
  local prev_commit
  local target_commit
  prev_commit=$(git -C "$APP_DIR" rev-parse HEAD)
  target_commit=$(git -C "$APP_DIR" rev-parse "${REMOTE}/${BRANCH}")

  # 6. Check if update is needed
  if [ "$prev_commit" = "$target_commit" ]; then
    log "No update needed. Current commit ${prev_commit:0:8} matches ${REMOTE}/${BRANCH}."
    exit 0
  fi

  # 7. Verify fast-forward compatibility
  if ! git -C "$APP_DIR" merge-base --is-ancestor "$prev_commit" "$target_commit"; then
    log_err "Cannot fast-forward: ${target_commit:0:8} is not a direct descendant of ${prev_commit:0:8}. Non-fast-forward update rejected."
    exit 1
  fi

  # 8. Record rollback target before modifying checkout
  local rollback_target="$prev_commit"
  log "Update found: ${prev_commit:0:8} -> ${target_commit:0:8}. Recorded rollback target ${rollback_target:0:8}."

  # 9. Fast-forward merge
  log "Applying fast-forward merge to ${target_commit:0:8}..."
  if ! git -C "$APP_DIR" merge --ff-only "${REMOTE}/${BRANCH}"; then
    log_err "Fast-forward merge failed. Aborting."
    exit 1
  fi

  # 10. Update Python dependencies if requirements.txt changed
  if ! git -C "$APP_DIR" diff --quiet "$rollback_target" "$target_commit" -- requirements.txt 2>/dev/null; then
    log "requirements.txt changed; updating Python dependencies..."
    local pip_bin="${APP_DIR}/venv/bin/pip"
    if [ -x "$pip_bin" ]; then
      if ! "$pip_bin" install -r "${APP_DIR}/requirements.txt" --quiet; then
        log_err "Failed to install updated Python dependencies. Initiating rollback..."
        rollback "$rollback_target"
        exit 1
      fi
    else
      log "Notice: venv pip not found at $pip_bin, skipping pip install."
    fi
  fi

  # 11. Restart service
  log "Restarting $SERVICE_NAME..."
  if ! restart_service; then
    log_err "Failed to restart $SERVICE_NAME. Initiating rollback..."
    rollback "$rollback_target"
    exit 1
  fi

  # 12. Verify health
  log "Verifying health endpoint at $HEALTH_URL (timeout: ${HEALTH_TIMEOUT}s)..."
  if ! check_health "$HEALTH_URL" "$HEALTH_TIMEOUT"; then
    log_err "Post-update health check failed! Initiating rollback..."
    rollback "$rollback_target"
    exit 1
  fi

  local current_commit
  current_commit=$(git -C "$APP_DIR" rev-parse --short HEAD)
  log "Update succeeded! Animu is running commit $current_commit and healthy."
  exit 0
}

main "$@"
