#!/usr/bin/env bash
# Polls OpenCode /session/status until all sessions are idle, then restarts the service.
#
# Usage: restart-watcher.sh <server_url> <timeout> <poll_interval> <lockfile> <logfile> <service>
#
# How OpenCode status works: SessionStatus is an in-memory Map.
# Busy sessions appear in GET /session/status; idle ones are removed.
# An empty JSON object {} = all idle.
#
# This script is spawned from a tool call, so the calling session is busy
# at spawn time. There's a brief idle gap between the tool result returning
# and the LLM streaming its response. To avoid restarting during that gap,
# we require idle to be seen on 3 consecutive checks before restarting.

set -euo pipefail

SERVER_URL="$1"
TIMEOUT="$2"
POLL="$3"
LOCKFILE="$4"
LOGFILE="$5"
SERVICE="$6"
IDLE_CONFIRMATIONS=3

exec > "$LOGFILE" 2>&1

log() { echo "[$(date -Is)] $1"; }

log "watcher started — timeout=${TIMEOUT}s poll=${POLL}s confirms=${IDLE_CONFIRMATIONS}"

end=$((SECONDS + TIMEOUT))
idle_count=0

while [ $SECONDS -lt $end ]; do
  status=$(curl -sf "${SERVER_URL}/session/status" 2>/dev/null) || {
    log "server unreachable — restarting"
    rm -f "$LOCKFILE"
    systemctl --user restart "$SERVICE"
    exit 0
  }

  busy=$(echo "$status" | jq '[to_entries[] | select(.value.type != "idle")] | length')

  if [ "$busy" = "0" ]; then
    idle_count=$((idle_count + 1))
    log "idle ($idle_count/$IDLE_CONFIRMATIONS)"
    if [ "$idle_count" -ge "$IDLE_CONFIRMATIONS" ]; then
      log "confirmed idle — restarting"
      rm -f "$LOCKFILE"
      systemctl --user restart "$SERVICE"
      exit 0
    fi
  else
    idle_count=0
    log "busy sessions: $busy"
  fi

  sleep "$POLL"
done

log "timed out after ${TIMEOUT}s"
rm -f "$LOCKFILE"
notify-send -t 10000 "OpenCode" "Restart timed out — sessions still busy after ${TIMEOUT}s"
exit 1
