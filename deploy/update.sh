#!/usr/bin/env bash
# Pull the latest code from git and rebuild only what changed (Docker Compose install).
#   bash deploy/update.sh           update
#   bash deploy/update.sh --force   rebuild web and server even if nothing changed
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "ERROR: $*" >&2; exit 1; }

git rev-parse --git-dir >/dev/null 2>&1 || fail "This folder is not a git clone. Clone your repo first: git clone <repo-url> dba-academy"
[ -f .env ] || fail "No .env here (it is never stored in git). Copy it from your old install."
D=docker; docker info >/dev/null 2>&1 || D="sudo docker"

before="$(git rev-parse HEAD)"
git pull --ff-only || fail "git pull failed (local edits on the server?). Check: git status"
after="$(git rev-parse HEAD)"

svc=()
if [ "${1:-}" = "--force" ]; then
  svc=(web server)
elif [ "$before" != "$after" ]; then
  changed="$(git diff --name-only "$before" "$after")"
  if echo "$changed" | grep -qE '^docker-compose\.yml$'; then svc=(web server)
  else
    echo "$changed" | grep -q '^client/' && svc+=(web)
    echo "$changed" | grep -q '^server/' && svc+=(server)
  fi
  echo "Changed files:"; echo "$changed" | sed 's/^/  /'
else
  echo "Already up to date ($after)."
fi

if [ "${#svc[@]}" -gt 0 ]; then
  echo ">> Rebuilding: ${svc[*]}"
  $D compose up -d --build "${svc[@]}"
else
  # Nothing to rebuild; still apply any .env change
  $D compose up -d
fi

echo ">> Waiting for the API..."
for _ in $(seq 1 30); do
  if $D compose exec -T server wget -qO- http://127.0.0.1:4000/api/health >/dev/null 2>&1; then
    echo "API: healthy"; $D compose ps; exit 0
  fi
  sleep 3
done
echo "API did not become healthy. Logs: $D compose logs --tail=40 server"; exit 1
