#!/bin/bash
# Daily restart for the backend server, so it never runs on stale code for long — this
# session found the running server can go many hours (once ~25h) without picking up changes
# made to server.ts, since editing the file doesn't restart the already-running process.
# Run via cron at 6am daily (see the crontab entry this project's setup registered) — safe to
# also run by hand anytime.

set -e

PROJECT_DIR="/home/nico/Aiventra-new"
LOG_DIR="$HOME/.local/share/odysai-server"
LOG_FILE="$LOG_DIR/server.log"
# cron runs with a minimal PATH — node/npx are managed by nvm, not on cron's default PATH.
NODE_BIN="$HOME/.nvm/versions/node/v20.20.1/bin"

mkdir -p "$LOG_DIR"
cd "$PROJECT_DIR"

echo "[$(date -Iseconds)] Restarting server..." >> "$LOG_FILE"

pkill -f "tsx server.ts" 2>/dev/null || true
sleep 2

PATH="$NODE_BIN:$PATH" nohup "$NODE_BIN/npx" tsx server.ts >> "$LOG_FILE" 2>&1 &
disown

sleep 3
if curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health | grep -q 200; then
    echo "[$(date -Iseconds)] Server restarted successfully." >> "$LOG_FILE"
else
    echo "[$(date -Iseconds)] WARNING: server did not respond healthy after restart." >> "$LOG_FILE"
fi

# Unlike localtunnel (used earlier this session), cloudflared reconnects to a restarted
# backend on its own — verified by test, not assumed. Deliberately NOT touching the tunnel
# here: killing it would force a new random *.trycloudflare.com URL on every 6am restart,
# breaking the already-built APK daily for no reason. Leave it alone.
echo "[$(date -Iseconds)] Tunnel left untouched (cloudflared reconnects to the restarted backend on its own)." >> "$LOG_FILE"
