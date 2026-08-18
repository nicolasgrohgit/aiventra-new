#!/bin/bash
# Manage the local test MongoDB instance used for real end-to-end testing against the
# actual `npm run server` backend. This is a plain binary install (no Docker/apt/sudo),
# living outside the repo at ~/.local/share/odysai-mongodb — safe to delete entirely to
# reset, since it holds nothing but local dev/test data.
#
# The database user (odys_user / odysai db) already matches MONGODB_URI in .env — no
# further configuration needed after `start`.
#
# Usage: scripts/local-mongo.sh {start|stop|status}

set -e

INSTALL_DIR="$HOME/.local/share/odysai-mongodb"
MONGOD="$INSTALL_DIR/bin/bin/mongod"
DATA="$INSTALL_DIR/data"
LOG="$INSTALL_DIR/log/mongod.log"
PID="$INSTALL_DIR/mongod.pid"

if [ ! -x "$MONGOD" ]; then
  echo "MongoDB binary not found at $MONGOD"
  echo "This script expects the one-time local install to have already run."
  exit 1
fi

case "$1" in
  start)
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
      echo "Already running (pid $(cat "$PID"))."
      exit 0
    fi
    "$MONGOD" --dbpath "$DATA" --port 27017 --bind_ip 127.0.0.1 \
      --logpath "$LOG" --pidfilepath "$PID" --auth --fork
    echo "Started. Logs: $LOG"
    ;;
  stop)
    if [ ! -f "$PID" ]; then
      echo "Not running (no pidfile)."
      exit 0
    fi
    "$MONGOD" --dbpath "$DATA" --pidfilepath "$PID" --shutdown
    echo "Stopped."
    ;;
  status)
    if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
      echo "Running (pid $(cat "$PID"))."
    else
      echo "Not running."
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
