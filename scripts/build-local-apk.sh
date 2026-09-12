#!/bin/bash
# Preflight-checked wrapper around a local EAS Android build.
#
# The 0.0.41 local build (2026-09-11) never produced an APK: its Gradle/Kotlin build daemon
# (a Java process) was killed by the kernel OOM-killer about 80 minutes in, mid-compile, with
# no "BUILD FAILED" message — just a dead daemon log. This dev machine only has 16GB RAM, and
# a release Android build's JS bundler + Gradle daemon + Kotlin daemon can together need
# several GB on top of whatever else is already open (confirmed: a Chrome tab was also
# OOM-killed 30 minutes earlier in that same session). This has happened more than once.
#
# Rather than repeat that an hour into a build with no clear error, refuse to start below a
# minimum free-memory threshold and let you close things first.
#
# Usage: bash scripts/build-local-apk.sh [extra eas build args]
# Defaults to: eas build --local --platform android --profile preview
# Override the threshold with EAS_BUILD_MIN_AVAILABLE_MB (default 8192, i.e. 8GB).

MIN_AVAILABLE_MB="${EAS_BUILD_MIN_AVAILABLE_MB:-8192}"

available_mb=$(free -m | awk '/^Mem:/{print $7}')

if [ "$available_mb" -lt "$MIN_AVAILABLE_MB" ]; then
    echo "============================================="
    echo "Not enough free memory to safely start a local build."
    echo "Available: ${available_mb}MB   Required: ${MIN_AVAILABLE_MB}MB"
    echo "============================================="
    echo "A past local build was OOM-killed mid-compile when memory ran low. Refusing to"
    echo "start rather than risk repeating that an hour in."
    echo ""
    echo "Top memory users right now:"
    ps -eo pid,comm,%mem,rss --sort=-%mem --no-headers | head -10 |
        awk '{printf "  %-8s %-20s %5s%%  %6.0f MB\n", $1, $2, $3, $4/1024}'
    echo ""
    echo "Close some of the above (browser windows/tabs are usually the biggest offenders),"
    echo "then re-run: bash scripts/build-local-apk.sh"
    exit 1
fi

echo "Memory check passed (${available_mb}MB available, need ${MIN_AVAILABLE_MB}MB). Starting local build..."
npx eas build --local --platform android --profile preview "$@"
