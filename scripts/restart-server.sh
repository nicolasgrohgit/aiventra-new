#!/bin/bash
# Daily restart for the backend server, so it never runs on stale code for long — this
# session found the running server can go many hours (once ~25h) without picking up changes
# made to server.ts, since editing the file doesn't restart the already-running process.
# Run via cron at 6am daily (see the crontab entry this project's setup registered) — safe to
# also run by hand anytime.
#
# The server now runs as a systemd --user unit (odysai-server.service, see
# ~/.config/systemd/user/), enabled with `loginctl enable-linger` so the whole beta stack
# (mongo, server, tunnel) survives a reboot on its own. This script now just asks systemd to
# restart it, rather than manually pkill+nohup'ing the process — doing both would race, since
# systemd's own Restart=always would also try to relaunch a killed process, risking two
# instances fighting over port 3000.

LOG_DIR="$HOME/.local/share/odysai-server"
LOG_FILE="$LOG_DIR/server.log"

mkdir -p "$LOG_DIR"

echo "[$(date -Iseconds)] Restarting server (systemctl --user restart odysai-server.service)..." >> "$LOG_FILE"

systemctl --user restart odysai-server.service

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
