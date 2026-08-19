#!/bin/bash
# Exposes the local backend (:3000) to the public internet via a Cloudflare quick tunnel —
# TEMPORARY, beta-only infrastructure. See docs/gcp-migration.md: once this moves to GCP,
# this whole script disappears, replaced by a real public IP/domain. Don't invest further in
# this beyond keeping it working for the beta.
#
# Why cloudflared over localtunnel (used earlier this session): localtunnel's free public
# relay proved unreliable under repeated reconnects (subdomain requests silently fell back to
# random names even from a clean process state, most likely rate-limiting) and its tunnel
# client went silently stale on every backend restart, needing an explicit kill+reconnect.
# cloudflared's quick tunnel is backed by Cloudflare's real infrastructure, is far more
# stable in practice, and — confirmed by test — survives a backend restart on its own with no
# reconnect needed. Trade-off: quick tunnels (no Cloudflare account) can't have a fixed
# hostname — every fresh start of this script gets a new random *.trycloudflare.com URL,
# unlike localtunnel's fixed-subdomain design. In practice this matters less than it sounds:
# since a backend restart no longer requires restarting the tunnel too (see
# restart-server.sh), the URL now only changes when this script itself is actually
# restarted, not on every server restart.
#
# Requires the cloudflared binary at ~/.local/bin/cloudflared (installed once this session,
# not tracked in this repo — see docs/gcp-migration.md for how it was obtained).

PORT=3000
CLOUDFLARED="$HOME/.local/bin/cloudflared"

if [ ! -x "$CLOUDFLARED" ]; then
    echo "cloudflared not found at $CLOUDFLARED"
    echo "Install: curl -Ls https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o $CLOUDFLARED && chmod +x $CLOUDFLARED"
    exit 1
fi

echo "============================================="
echo "Cloudflare Quick Tunnel"
echo "============================================="
echo "Starting tunnel on port $PORT..."
echo "Self-healing: restarts automatically if the tunnel process itself dies. Does NOT need"
echo "to restart when the backend does (verified: cloudflared reconnects to a restarted"
echo "backend on its own) — the URL only changes if this script restarts, not the server."
echo "Ctrl+C to stop for good."
echo "Please wait a few seconds..."

FIRST_RUN=true

while true; do
    TEMP_LOG=$(mktemp)
    "$CLOUDFLARED" tunnel --url "http://localhost:$PORT" > "$TEMP_LOG" 2>&1 &
    TUNNEL_PID=$!

    URL=""
    for i in {1..20}; do
        sleep 1
        URL=$(grep -o -E "https://[a-zA-Z0-9.-]+\.trycloudflare\.com" "$TEMP_LOG" | head -n 1)
        if [ -n "$URL" ]; then
            break
        fi
    done

    if [ -n "$URL" ] && [ "$FIRST_RUN" = true ]; then
        echo "============================================="
        echo "Your Tunnel URL: $URL"
        echo "============================================="
        echo "No password/IP confirmation needed (unlike localtunnel)."
        echo "Set this as EXPO_PUBLIC_API_URL in eas.json before building the APK."
        echo "============================================="
        FIRST_RUN=false
    elif [ -z "$URL" ]; then
        echo "[$(date -Iseconds)] Failed to get tunnel URL. Log output:"
        cat "$TEMP_LOG"
    else
        echo "[$(date -Iseconds)] Tunnel reconnected at $URL (this is a NEW URL — update eas.json and rebuild if it differs from what's currently deployed)"
    fi

    rm -f "$TEMP_LOG"

    # Blocks until the tunnel process actually dies, then the outer loop restarts it
    wait $TUNNEL_PID
    echo "[$(date -Iseconds)] Tunnel process exited — reconnecting in 3s..."
    sleep 3
done
