#!/usr/bin/env bash
# One-time setup of an Ubuntu EC2 server for Kubernetes (k3s): swap, k3s itself, and a starter .env.
# Docker is NOT needed on the server: k3s pulls your images from Docker Hub.
#   bash k8s/install-k3s.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Swap: a cheap safety net, the lab runs three database engines
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo ">> Adding a 2 GB swap file..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 2. k3s (single-node Kubernetes with Traefik ingress and local disk storage; starts at boot)
if ! command -v k3s >/dev/null 2>&1; then
  echo ">> Installing k3s..."
  curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644
fi
echo ">> Waiting for the node to be Ready..."
for _ in $(seq 1 60); do
  if sudo k3s kubectl get nodes 2>/dev/null | grep -qE ' Ready'; then break; fi
  sleep 3
done
sudo k3s kubectl get nodes

# 3. Starter .env with random secrets
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
  sed -i "s|^LAB_ADMIN_PASSWORD=.*|LAB_ADMIN_PASSWORD=$(openssl rand -hex 16)|" .env
  sed -i "s|^SIGNUP_CODE=.*|SIGNUP_CODE=$(openssl rand -hex 4)|" .env
  echo
  echo ">> Created .env with random secrets."
fi
echo
echo "Next: nano .env and set  DOMAIN, ADMIN_EMAIL, ADMIN_PASSWORD, DOCKERHUB_USER, ACME_EMAIL"
echo "Then: bash k8s/deploy.sh <image-tag>"
