#!/usr/bin/env bash
# Start preview-server only if :5056 is not already healthy.
# Avoids LaunchAgent KeepAlive races that SIGTERM a live server.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-5056}"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || true)"
if [[ "$CODE" == "200" ]]; then
  echo "preview already healthy on :${PORT} — holding LaunchAgent without rebinding"
  exec tail -f /dev/null
fi
cd "$ROOT"
exec /usr/local/bin/node preview-server.js
