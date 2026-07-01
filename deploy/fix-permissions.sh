#!/usr/bin/env bash
# Fix permissions after a failed setup (EACCES on npm ci)
# Run on EC2: sudo bash deploy/fix-permissions.sh
set -euo pipefail

APP_DIR="/opt/cphi-app"
DATA_DIR="/var/lib/cphi-milan/data"
APP_USER="cphi"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

echo "==> Fixing ownership..."
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}" 2>/dev/null || true

echo "==> Installing dependencies..."
cd "${APP_DIR}"
sudo -u "${APP_USER}" env HOME="${APP_DIR}" npm ci --omit=dev

echo "==> Restarting app..."
systemctl restart cphi-app || true
systemctl enable cphi-app 2>/dev/null || true

sleep 2
if systemctl is-active --quiet cphi-app; then
  echo "Done — cphi-app is running."
else
  echo "Start manually: sudo systemctl start cphi-app"
  journalctl -u cphi-app -n 20 --no-pager
fi
