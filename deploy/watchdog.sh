#!/usr/bin/env bash
# Keeps DBA Academy running: starts any container that stopped and restarts the API if it stops answering.
# deploy/ec2-setup.sh installs this as a cron job (every 5 minutes). Safe to run by hand.
# Maintenance: create the file deploy/.paused to make the watchdog do nothing; delete it to resume.
set -u
cd "$(dirname "$0")/.."

log() { echo "$(date '+%F %T') $*"; }

command -v docker >/dev/null 2>&1 || exit 0
[ -f deploy/.paused ] && exit 0
[ -f .env ] || exit 0

# 1. Any service not running? Start it again (no rebuild).
running=$(docker compose ps --status running --services 2>/dev/null | sort | tr '\n' ' ')
wanted=$(docker compose config --services 2>/dev/null | sort | tr '\n' ' ')
if [ -n "$wanted" ] && [ "$running" != "$wanted" ]; then
  log "not all services running (running: ${running:-none}) -> docker compose up -d"
  docker compose up -d >/dev/null 2>&1 || log "docker compose up -d failed"
fi

# 2. API running but not answering its health check? Restart it.
cid=$(docker compose ps -q server 2>/dev/null | head -n1)
if [ -n "$cid" ]; then
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$cid" 2>/dev/null)
  if [ "$health" = "unhealthy" ]; then
    log "API unhealthy -> docker compose restart server"
    docker compose restart server >/dev/null 2>&1 || log "restart failed"
  fi
fi
