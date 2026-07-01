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
UPLOAD_DIR="/var/lib/cphi-milan/uploads"
BRANCH="${BRANCH:-main}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "App not installed. Run deploy/setup-ec2.sh first."
  exit 1
fi

fix_app_permissions() {
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

ensure_git_safe() {
  # sudo git as root on a cphi-owned repo triggers "dubious ownership"
  git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
  sudo -u "${APP_USER}" git config --global --add safe.directory "${APP_DIR}" 2>/dev/null || true
}

fix_app_permissions
ensure_git_safe

echo "==> Ensuring upload directory..."
mkdir -p "${UPLOAD_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${UPLOAD_DIR}"
ENV_FILE="/etc/cphi-app/env"
if [[ -f "${ENV_FILE}" ]] && ! grep -q '^UPLOAD_DIR=' "${ENV_FILE}"; then
  echo "UPLOAD_DIR=${UPLOAD_DIR}" >> "${ENV_FILE}"
  echo "    Added UPLOAD_DIR to ${ENV_FILE}"
fi

echo "==> Pulling ${BRANCH}..."
sudo -u "${APP_USER}" env HOME="${APP_DIR}" git -C "${APP_DIR}" fetch origin
sudo -u "${APP_USER}" env HOME="${APP_DIR}" git -C "${APP_DIR}" checkout "${BRANCH}"
sudo -u "${APP_USER}" env HOME="${APP_DIR}" git -C "${APP_DIR}" pull --ff-only origin "${BRANCH}"

fix_app_permissions

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
