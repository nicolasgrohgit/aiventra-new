#!/bin/bash
# Builds the Android preview APK, preferring EAS's cloud builders and falling back to a local
# build only once the monthly free-tier cloud quota is used up.
#
# Why: this project originally built exclusively on EAS's cloud (see docs/beta-deploy.md) —
# it costs nothing on the free tier, doesn't touch this laptop's own CPU/RAM, and can't be
# OOM-killed by whatever else is running locally. It switched to `eas build --local` only
# after that monthly quota ran out. Free-tier quotas reset every billing cycle, so rather than
# permanently defaulting to the local (riskier) path, check the actual remaining cloud quota
# each time via `eas account:usage` and pick automatically.
#
# Usage: bash scripts/build-apk.sh
# Override the EAS account name with EAS_ACCOUNT_NAME if this is ever used on another account.

set -euo pipefail
cd "$(dirname "$0")/.."

ACCOUNT="${EAS_ACCOUNT_NAME:-nicolas.groh}"
VERSION=$(node -p "require('./package.json').version")
OUTPUT_APK="public/odys-ai-${VERSION}.apk"

echo "Checking EAS cloud build quota for account '$ACCOUNT'..."
USAGE_JSON=$(npx eas account:usage "$ACCOUNT" --non-interactive --json 2>/dev/null)

if ! echo "$USAGE_JSON" | node -e "JSON.parse(require('fs').readFileSync(0,'utf8'))" 2>/dev/null; then
    echo "Could not read EAS account usage (network issue or CLI error) — falling back to local build."
    exec bash scripts/build-local-apk.sh --output "$OUTPUT_APK"
fi

read -r REMAINING USED LIMIT USED_A LIMIT_A <<EOF
$(echo "$USAGE_JSON" | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const overall = d.builds.plan;
const android = d.builds.android.plan;
const remaining = Math.min(overall.limit - overall.used, android.limit - android.used);
console.log(remaining, overall.used, overall.limit, android.used, android.limit);
")
EOF

echo "EAS cloud usage this cycle: ${USED}/${LIMIT} builds total, ${USED_A}/${LIMIT_A} Android — ${REMAINING} Android build(s) of quota remaining."

if [ "$REMAINING" -gt 0 ]; then
    echo "Using an EAS cloud build (quota available, no local machine load)."
    BUILD_JSON=$(npx eas build --profile preview --platform android --non-interactive --json 2>/dev/null)
    ARCHIVE_URL=$(echo "$BUILD_JSON" | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const b = Array.isArray(d) ? d[0] : d;
if (String(b.status).toUpperCase() !== 'FINISHED' || !b.artifacts || !b.artifacts.applicationArchiveUrl) {
  console.error('Build did not finish successfully: status=' + b.status);
  process.exit(1);
}
console.log(b.artifacts.applicationArchiveUrl);
")
    echo "Cloud build finished. Downloading artifact into ${OUTPUT_APK}..."
    curl -sSL "$ARCHIVE_URL" -o "$OUTPUT_APK"
    echo "Saved to ${OUTPUT_APK}."
else
    echo "Cloud quota exhausted for this billing cycle — falling back to a local build."
    bash scripts/build-local-apk.sh --output "$OUTPUT_APK"
fi
