#!/usr/bin/env bash
# Mirror workspace enrichment → LaunchAgent-safe runtime (outside Documents TCC).
# Run after editing preview-server / brands / output under scripts/enrichment.
# Restarts the preview LaunchAgent so Node reloads (run-preview.sh otherwise
# holds a healthy :5056 process forever and ignores disk updates).
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${HOME}/Library/Application Support/samay-enrichment"
LABEL="in.cognaitive.samay-preview-server"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"
PORT="${PORT:-5056}"
mkdir -p "$DEST"
rsync -a --delete \
  --exclude '.DS_Store' \
  --exclude 'node_modules' \
  "${SRC}/" "${DEST}/"
chmod +x "${DEST}/tunnel/run-preview.sh"
echo "Synced → ${DEST}"

restart_preview() {
  local uid
  uid="$(id -u)"
  if [[ ! -f "$PLIST" ]]; then
    echo "No LaunchAgent plist at ${PLIST} — skip restart"
    return 0
  fi
  launchctl bootout "gui/${uid}/${LABEL}" 2>/dev/null || true
  # Free :5056 (old node) and any leftover run-preview holders
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -t -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      # shellcheck disable=SC2086
      kill ${pids} 2>/dev/null || true
    fi
  fi
  pkill -f "${DEST}/tunnel/run-preview.sh" 2>/dev/null || true
  sleep 0.4
  launchctl bootstrap "gui/${uid}" "$PLIST"
  local i code=000
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || true)"
    if [[ "$code" == "200" ]]; then
      echo "Preview restarted on :${PORT}"
      return 0
    fi
    sleep 0.4
  done
  echo "Warning: preview did not become healthy on :${PORT} (last HTTP ${code})" >&2
  return 1
}

if [[ "${SYNC_RESTART:-1}" != "0" ]]; then
  restart_preview
fi
