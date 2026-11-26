# Samay test preview tunnel

Named Cloudflare Tunnel exposing the local Balmain scrape preview.

- **Public URL:** https://samay-test.cognaitive.in
- **Local origin:** http://127.0.0.1:5056 (`node preview-server.js`)
- **Tunnel name:** `samay-test`
- **Tunnel UUID:** `ffd37963-dd34-44ed-bd00-3e6e35fac31c`
- **Config:** `config.yml` (this folder) and `~/.cloudflared/config.yml`
- **Credentials:** `~/.cloudflared/<tunnel-uuid>.json` — never commit

## Keep it running

```bash
# 1) Preview server — only start if curl is not already 200
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5056/
# if not 200:
cd scripts/enrichment && node preview-server.js

# 2) Tunnel (separate process; LaunchAgent preferred)
cloudflared tunnel --config scripts/enrichment/tunnel/config.yml run samay-test
```

**Do not `kill` preview PIDs** unless the process is confirmed hung **and** `curl` to `:5056` fails. Recent SIGTERM/143 failures came from kill/restart races.

`run-preview.sh` checks for HTTP 200 first and will not rebind the port.

## DNS (already applied)

```bash
cloudflared tunnel route dns samay-test samay-test.cognaitive.in
# → "already configured to route to your tunnel"
```

Cloudflare zone `cognaitive.in` should show:

`samay-test` CNAME → `ffd37963-dd34-44ed-bd00-3e6e35fac31c.cfargotunnel.com` (proxied / orange cloud)

If missing, add that CNAME in the Cloudflare dashboard for zone **cognaitive.in**.

## Auth (optional Cloudflare Access)

The tunnel currently publishes the preview with **no Access gate** (anyone with the URL can hit it while your machine + tunnel are up). To lock it down:

1. Cloudflare Zero Trust → **Access** → **Applications** → Add application → Self-hosted
2. Application domain: `samay-test.cognaitive.in`
3. Policy: allow emails / Google Workspace / One-time PIN for reviewers only
4. Leave the tunnel + `config.yml` unchanged (Access sits in front of the hostname)

No secrets belong in this repo; Access policies live in the Cloudflare dashboard.

## Durable (macOS LaunchAgents)

Plists:

- `~/Library/LaunchAgents/in.cognaitive.samay-test-tunnel.plist`
- `~/Library/LaunchAgents/in.cognaitive.samay-preview-server.plist` (should call `run-preview.sh`, not raw `node`, to avoid port races)

```bash
# Tunnel (safe to keep loaded)
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/in.cognaitive.samay-test-tunnel.plist

# Preview agent — only if you want launchd to own it; prefer one healthy process
# Update ProgramArguments to: …/tunnel/run-preview.sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/in.cognaitive.samay-preview-server.plist
```

Disable:

```bash
launchctl bootout gui/$(id -u)/in.cognaitive.samay-test-tunnel
launchctl bootout gui/$(id -u)/in.cognaitive.samay-preview-server
```

Logs: `~/Library/Logs/samay-test-tunnel/`

## Merge empty-only (staff wins)

Preview UI panel **Merge preview** → `POST /api/merge-preview` and `GET /api/merge-policy`.

Default: fill empty/null/blank fields only; skip non-empty staff title/description/specs/prices/images unless `forceOverwrite=true`. Same policy in `lib/merge.js`, CLI `--existing` / `--force-overwrite`, and IMS `POST /api/import/csv`.
