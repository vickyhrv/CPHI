#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Redeploy / update CPHI app on EC2 (run after git push)
#
# Usage on server:
#   sudo bash /opt/cphi-app/deploy/deploy.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP_DIR="/opt/cphi-app"
APP_USER="cphi"
BRANCH="${BRANCH:-main}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "App not installed. Run deploy/setup-ec2.sh first."
  exit 1
fi

echo "==> Pulling ${BRANCH}..."
git -C "${APP_DIR}" fetch origin
git -C "${APP_DIR}" checkout "${BRANCH}"
git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"

# git pull as root leaves root-owned files — fix before npm
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"

echo "==> npm install..."
cd "${APP_DIR}"
sudo -u "${APP_USER}" env HOME="${APP_DIR}" npm ci --omit=dev

echo "==> Restarting service..."
systemctl restart cphi-app
sleep 2

if systemctl is-active --quiet cphi-app; then
  echo "==> cphi-app is running."
else
  echo "ERROR: cphi-app failed to start. Logs:"
  journalctl -u cphi-app -n 30 --no-pager
  exit 1
fi

if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null; then
  echo "==> Health check passed."
else
  echo "WARN: Health endpoint did not respond (auth may be required for some routes)."
fi

echo "Deploy done. https://cphi-milan.hrvglobal.ai"
