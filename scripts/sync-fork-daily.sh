#!/usr/bin/env bash
set -euo pipefail

REPO="$HOME/Projects/openclaw"
LOG_DIR="$HOME/Library/Logs/openclaw"
LOG_FILE="$LOG_DIR/fork-sync.log"

mkdir -p "$LOG_DIR"

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting fork sync"
  cd "$REPO"
  git fetch --prune upstream
  git fetch --prune arifork
  git push arifork upstream/main:main
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Fork sync complete"
} >> "$LOG_FILE" 2>&1
