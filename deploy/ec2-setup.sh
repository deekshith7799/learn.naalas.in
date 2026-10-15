#!/usr/bin/env bash
# One-command setup for a fresh Ubuntu 22.04/24.04 EC2 instance.
# Usage (from inside the dba-academy folder):  bash deploy/ec2-setup.sh
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Docker (and make sure it starts again after every reboot)
if ! command -v docker >/dev/null 2>&1; then
  echo ">> Installing Docker..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
sudo systemctl enable --now docker >/dev/null 2>&1 || true

# 2. Swap: the app plus the practice-lab databases run several engines, swap is a cheap safety net
if [ "$(swapon --show --noheadings | wc -l)" -eq 0 ]; then
  echo ">> Adding a 2 GB swap file..."
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# 3. .env
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -hex 16)|" .env
  sed -i "s|^LAB_ADMIN_PASSWORD=.*|LAB_ADMIN_PASSWORD=$(openssl rand -hex 16)|" .env
  sed -i "s|^SIGNUP_CODE=.*|SIGNUP_CODE=$(openssl rand -hex 4)|" .env
  echo
  echo ">> Created .env with random secrets, database passwords and a team sign-up code."
  echo ">> Now edit it: set DOMAIN, ADMIN_EMAIL and ADMIN_PASSWORD, then run this script again."
  echo "     nano .env"
  exit 0
fi

# Upgrading an older .env that predates the practice lab / sign-up
if ! grep -q '^LAB_ADMIN_PASSWORD=' .env; then
  echo "LAB_ADMIN_PASSWORD=$(openssl rand -hex 16)" >> .env
  echo ">> Added LAB_ADMIN_PASSWORD to .env"
fi
if ! grep -q '^SIGNUP_CODE=' .env; then
  echo "SIGNUP_CODE=$(openssl rand -hex 4)" >> .env
  echo ">> Added a random SIGNUP_CODE to .env (leave it empty to turn sign-up off)"
fi

# 4. Refuse to start with placeholder values
if grep -qE '^[A-Z_]+=change-this|^ADMIN_EMAIL=you@example\.com|^DOMAIN=localhost' .env; then
  echo "!! Edit .env first: set your real DOMAIN, ADMIN_EMAIL and ADMIN_PASSWORD (no 'change-this' or you@example.com left)."
  echo "   (Leave SIGNUP_CODE empty if you want sign-up turned off.)"
  exit 1
fi

# 5. Start. Every container has restart: unless-stopped, so they come back after a crash or an EC2 reboot.
echo ">> Building and starting (first run downloads the PostgreSQL, MySQL and MongoDB images)..."
sudo docker compose up -d --build

# 6. Watchdog: every 5 minutes, start anything that stopped and restart the API if it stops answering
command -v crontab >/dev/null 2>&1 || sudo apt-get install -y cron >/dev/null
sudo systemctl enable --now cron >/dev/null 2>&1 || true
echo "*/5 * * * * root /bin/bash $(pwd)/deploy/watchdog.sh >> /var/log/dba-academy-watchdog.log 2>&1" | sudo tee /etc/cron.d/dba-academy >/dev/null
sudo chmod 644 /etc/cron.d/dba-academy

CODE="$(grep '^SIGNUP_CODE=' .env | cut -d= -f2-)"
echo
echo ">> Done. Check status with:  ./academy status   (or: sudo docker compose ps)"
echo ">> It restarts by itself after a crash or reboot; a watchdog checks every 5 minutes."
echo ">> Open https://$(grep '^DOMAIN=' .env | cut -d= -f2) (DNS A record must point to this server)."
echo ">> Admin sign-in: ADMIN_EMAIL / ADMIN_PASSWORD from .env."
if [ -n "$CODE" ]; then
  echo ">> Team sign-up code (share with your team): $CODE"
else
  echo ">> Sign-up is OFF (SIGNUP_CODE is empty): add people from the Admin page."
fi
