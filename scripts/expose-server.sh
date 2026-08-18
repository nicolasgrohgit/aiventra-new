#!/bin/bash

PORT=3000
# A fixed subdomain keeps the tunnel URL stable across restarts, so a beta APK built once
# (with EXPO_PUBLIC_API_URL baked in at build time) keeps working after you restart this
# script — without it, localtunnel hands out a random URL every run and every restart
# would mean rebuilding and redistributing the APK. Override via TUNNEL_SUBDOMAIN if
# "odysai-beta" is already taken — localtunnel subdomains are first-come-first-served
# globally, not reserved per account.
SUBDOMAIN="${TUNNEL_SUBDOMAIN:-odysai-beta}"

echo "============================================="
echo "Localtunnel Secure Exposer"
echo "============================================="
echo "Starting tunnel on port $PORT with subdomain '$SUBDOMAIN'..."
echo "Please wait a few seconds..."

# Start localtunnel and redirect output to a temp log file
TEMP_LOG=$(mktemp)
npx localtunnel --port $PORT --subdomain "$SUBDOMAIN" > "$TEMP_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for URL to appear in logs
URL=""
for i in {1..15}; do
    sleep 1
    URL=$(grep -o -E "https://[a-zA-Z0-9.-]+\.loca\.lt" "$TEMP_LOG" | head -n 1)
    if [ -n "$URL" ]; then
        break
    fi
done

if [ -n "$URL" ]; then
    # Give localtunnel a moment to register the tunnel agent socket
    sleep 2
    
    # Query the headers of the generated URL to find the registered agent IP
    AGENT_IP=$(curl -s -I "$URL" | grep -i "x-localtunnel-agent-ips" | grep -o -E "[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+")
    
    if [ -z "$AGENT_IP" ]; then
        # Fallback if header lookup fails
        AGENT_IP=$(curl -s icanhazip.com || curl -s ipinfo.io/ip || echo "Unknown")
    fi
    
    echo "============================================="
    echo "Your Tunnel URL: $URL"
    echo "Your Tunnel Password (Public IP): $AGENT_IP"
    echo "============================================="
    echo "Please enter the password above if prompted by localtunnel."
    echo "============================================="
else
    echo "Failed to get tunnel URL. Here is the log output:"
    cat "$TEMP_LOG"
fi

# Clean up temp file when script exits
trap "rm -f $TEMP_LOG" EXIT

# Wait on the localtunnel process
wait $TUNNEL_PID
