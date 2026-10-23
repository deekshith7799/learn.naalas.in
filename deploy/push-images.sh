#!/usr/bin/env bash
# Build the two app images (API and web) and push them to Docker Hub.
#   docker login                       (once)
#   bash deploy/push-images.sh         (tag = date, e.g. 20261015-1430)
#   bash deploy/push-images.sh v1.2    (your own tag)
# The lab databases use the official postgres / mysql / mongo images, so only two images are yours.
set -euo pipefail
cd "$(dirname "$0")/.."

U="${DOCKERHUB_USER:-}"
[ -z "$U" ] && [ -f .env ] && U="$(grep -E '^DOCKERHUB_USER=' .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
[ -n "$U" ] || { echo "Set DOCKERHUB_USER=<your Docker Hub username> in .env"; exit 1; }
TAG="${1:-$(date +%Y%m%d-%H%M)}"

for svc in server:server web:client; do
  name="${svc%%:*}"; dir="${svc##*:}"
  img="$U/dba-academy-$name"
  echo ">> Building $img:$TAG"
  docker build --platform linux/amd64 -t "$img:$TAG" -t "$img:latest" "./$dir"
  echo ">> Pushing $img"
  docker push "$img:$TAG"
  docker push "$img:latest"
done

echo
echo "Pushed $U/dba-academy-server and $U/dba-academy-web with tags: $TAG and latest"
echo "On the server:  bash k8s/deploy.sh $TAG"
