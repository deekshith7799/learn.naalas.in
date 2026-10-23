#!/usr/bin/env bash
# Deploy (or update) DBA Academy on Kubernetes. Safe to run again any time.
#   bash k8s/deploy.sh                 uses IMAGE_TAG from .env (default: latest)
#   bash k8s/deploy.sh 20261015-1430   deploy that image tag
#   bash k8s/deploy.sh --local         Docker Desktop / any cluster without Traefik: no ingress, use port-forward
set -euo pipefail
cd "$(dirname "$0")/.."
fail() { echo "ERROR: $*" >&2; exit 1; }

TAG_ARG=""; LOCAL=0
for a in "$@"; do case "$a" in --local) LOCAL=1 ;; *) TAG_ARG="$a" ;; esac; done

[ -f .env ] || fail "No .env here. Run: bash k8s/install-k3s.sh   (or copy .env.example to .env)"
get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '\r' || true; }

if grep -qE '^[A-Z_]+=change-this|^ADMIN_EMAIL=you@example\.com' .env; then
  fail "Edit .env first: it still has change-this... / you@example.com placeholders (the server refuses to start with them)."
fi
DOCKERHUB_USER="$(get DOCKERHUB_USER)"; ACME_EMAIL="$(get ACME_EMAIL)"; DOMAIN="$(get DOMAIN)"
TAG="${TAG_ARG:-$(get IMAGE_TAG)}"; TAG="${TAG:-latest}"
[ -n "$DOCKERHUB_USER" ] || fail "Set DOCKERHUB_USER in .env (your Docker Hub username)."
if [ "$LOCAL" = 0 ]; then
  [ -n "$ACME_EMAIL" ] || fail "Set ACME_EMAIL in .env (Let's Encrypt sends certificate warnings there)."
  case "$DOMAIN" in ""|localhost|http*|https*) fail "Set DOMAIN in .env to your real domain, e.g. learn.example.com (no http://)." ;; esac
fi
for v in "$DOCKERHUB_USER" "$ACME_EMAIL" "$DOMAIN" "$TAG"; do
  [[ "$v" =~ ^[A-Za-z0-9@._+:/-]*$ ]] || fail "Unexpected characters in DOCKERHUB_USER / ACME_EMAIL / DOMAIN / tag: $v"
done
IMAGE_SERVER="$DOCKERHUB_USER/dba-academy-server:$TAG"; IMAGE_WEB="$DOCKERHUB_USER/dba-academy-web:$TAG"

if kubectl get ns >/dev/null 2>&1; then K="kubectl"
elif command -v k3s >/dev/null 2>&1; then K="sudo k3s kubectl"
else fail "kubectl cannot reach a cluster. On the server run: bash k8s/install-k3s.sh"; fi
echo ">> Deploying $IMAGE_SERVER and $IMAGE_WEB"

$K apply -f k8s/00-namespace.yaml

# Secrets (kept in the cluster, built from .env; the temp file is removed straight away)
tmp="$(mktemp)"; chmod 600 "$tmp"; trap 'rm -f "$tmp"' EXIT
{
  for k in POSTGRES_PASSWORD JWT_SECRET ADMIN_EMAIL ADMIN_PASSWORD LAB_ADMIN_PASSWORD SIGNUP_CODE OPEN_ACCESS; do echo "$k=$(get $k)"; done
  echo "DATABASE_URL=postgres://academy:$(get POSTGRES_PASSWORD)@db:5432/academy"
} > "$tmp"
$K create secret generic academy-secrets -n academy --from-env-file="$tmp" --dry-run=client -o yaml | $K apply -f -
rm -f "$tmp"

# Private Docker Hub repos: a read-only access token makes the cluster able to pull them
if [ -n "$(get DOCKERHUB_TOKEN)" ]; then
  $K create secret docker-registry regcred -n academy --docker-username="$DOCKERHUB_USER" \
    --docker-password="$(get DOCKERHUB_TOKEN)" --dry-run=client -o yaml | $K apply -f -
  $K patch serviceaccount default -n academy -p '{"imagePullSecrets":[{"name":"regcred"}]}' >/dev/null
fi

render() { sed -e "s|\${IMAGE_SERVER}|$IMAGE_SERVER|g" -e "s|\${IMAGE_WEB}|$IMAGE_WEB|g" -e "s|\${DOMAIN}|$DOMAIN|g" -e "s|\${ACME_EMAIL}|$ACME_EMAIL|g" "$1"; }
files="k8s/10-database.yaml k8s/20-lab.yaml k8s/30-app.yaml k8s/50-network-policy.yaml k8s/70-backup.yaml"
[ "$LOCAL" = 1 ] || files="$files k8s/60-ingress.yaml"
for f in $files; do render "$f" | $K apply -f -; done

# Same tag re-pushed (e.g. "latest"): force the pods to pull it
if [ "$TAG" = latest ]; then $K -n academy rollout restart deploy/server deploy/web >/dev/null; fi

echo ">> Waiting for the pods (first start downloads about 1 GB of images)..."
for r in sts/db deploy/server deploy/web; do
  if ! $K -n academy rollout status "$r" --timeout=600s; then
    echo; echo "!! $r did not become ready. Recent logs:"
    $K -n academy logs "$r" --tail=30 2>&1 || true
    echo "More: $K -n academy describe pod -l app=${r#*/}"
    exit 1
  fi
done
$K -n academy get pods

echo
if [ "$LOCAL" = 1 ]; then
  echo "Open it with:   $K -n academy port-forward svc/web 8080:8080     then http://localhost:8080"
else
  echo "Open https://$DOMAIN (the first HTTPS certificate takes about a minute; DNS must already point at this server)."
fi
echo "Admin sign-in: $(get ADMIN_EMAIL)"
sc="$(get SIGNUP_CODE)"; if [ -n "$sc" ]; then echo "Team sign-up code (share with your team): $sc"; else echo "Sign-up is OFF (SIGNUP_CODE is empty)."; fi
echo "MySQL and MongoDB labs need 30-60 seconds more after first start:  $K -n academy get pods"
