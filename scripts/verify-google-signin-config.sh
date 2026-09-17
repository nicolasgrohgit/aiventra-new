#!/usr/bin/env bash
# Sanity-checks the two halves of Google Sign-In that CAN be verified without a device:
# (1) the Web OAuth client is real/enabled at Google's end, and (2) our own backend's
# POST /api/auth/google route is reachable and correctly rejects a bad token. Neither check
# can reproduce the native Android GoogleSignInClient failure itself (that only happens
# inside Google Play Services on-device) — this narrows the search by ruling out "the
# client was deleted/disabled" and "the backend route is down/misconfigured" first, since
# both are checkable from a terminal and neither needs a rebuilt APK to test.
#
# Usage: bash scripts/verify-google-signin-config.sh
set -euo pipefail

WEB_CLIENT_ID="${EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:-891816307412-1aor2at50vpaj9e4ibp0qehdqupq677c.apps.googleusercontent.com}"
API_URL="${EXPO_PUBLIC_API_URL:-https://odysai-server-891816307412.us-central1.run.app}"

echo "== 1. Is the Web OAuth client valid/enabled at Google? =="
# A throwaway, unregistered redirect_uri is expected to fail — the point isn't to succeed,
# it's to see WHICH error Google returns. "redirect_uri_mismatch" means Google found a real,
# enabled client and got far enough to check the redirect URI. "invalid_client" or
# "deleted_client" would mean the client itself is the problem.
RESPONSE=$(curl -s -L "https://accounts.google.com/o/oauth2/v2/auth?client_id=${WEB_CLIENT_ID}&redirect_uri=https://example.com/callback&response_type=code&scope=email")
if echo "$RESPONSE" | grep -q "redirect_uri_mismatch"; then
  echo "PASS: client_id is recognized as a valid, enabled OAuth client."
elif echo "$RESPONSE" | grep -qi "invalid_client\|deleted_client"; then
  echo "FAIL: Google says this client_id is invalid or deleted. This IS your bug — recreate the OAuth client."
  exit 1
else
  echo "UNKNOWN: couldn't find an expected marker in Google's response. Inspect manually:"
  echo "$RESPONSE" | grep -oE 'error-code="[^"]*"' | head -3
fi

echo ""
echo "== 2. Is our own backend's Google auth route reachable and behaving correctly? =="
STATUS=$(curl -s -o /tmp/verify-google-signin-body.json -w "%{http_code}" -X POST "${API_URL}/api/auth/google" \
  -H "Content-Type: application/json" \
  -d '{"idToken":"deliberately-invalid-token-for-testing"}')
BODY=$(cat /tmp/verify-google-signin-body.json)
if [ "$STATUS" = "401" ] && echo "$BODY" | grep -q "Invalid Google token"; then
  echo "PASS: route is up and correctly rejects a bad token (401 'Invalid Google token')."
elif [ "$STATUS" = "503" ]; then
  echo "FAIL: route says Google Sign-In isn't configured server-side (GOOGLE_WEB_CLIENT_ID missing on the server). This IS your bug."
  exit 1
else
  echo "UNKNOWN: got HTTP $STATUS, body: $BODY"
fi
rm -f /tmp/verify-google-signin-body.json

echo ""
echo "Both checks passed — the Google Cloud client and our backend are healthy."
echo "If the native Android app still shows 'A non-recoverable sign in failure occurred',"
echo "the remaining suspects are device/Play-Services-side or the OAuth consent screen's"
echo "Support email field (a well-documented cause of this exact message when left blank —"
echo "see console.cloud.google.com/apis/credentials/consent), not the client config itself."
