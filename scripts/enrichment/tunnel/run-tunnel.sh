#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
exec cloudflared tunnel --config "$ROOT/config.yml" run samay-test
