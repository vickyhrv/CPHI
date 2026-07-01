#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time EC2 setup for CPHI Milan app
# Domain: cphi-milan.hrvglobal.ai  →  EC2 public IP (e.g. 100.58.232.162)
#
# BEFORE running:
#   1. DNS A record: cphi-milan.hrvglobal.ai → your EC2 public IP
#   2. Security group: inbound TCP 22, 80, 443
#   3. SSH into the instance as a user with sudo
#
# Usage (on EC2):
#   curl -fsSL https://raw.githubusercontent.com/vickyhrv/CPHI/main/deploy/setup-ec2.sh -o setup-ec2.sh
#   chmod +x setup-ec2.sh
#   sudo ./setup-ec2.sh
#
# Or clone repo first and run:
#   sudo bash deploy/setup-ec2.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="cphi-milan.hrvglobal.ai"
GIT_REPO="https://github.com/vickyhrv/CPHI.git"
APP_DIR="/opt/cphi-app"
DATA_DIR="/var/lib/cphi-milan/data"
APP_USER="cphi"
ENV_FILE="/etc/cphi-app/env"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-admin@hrvglobal.ai}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo bash $0"
  exit 1
fi

echo "==> Detecting OS..."
if [[ -f /etc/os-release ]]; then
  # shellcheck source=/dev/null
  source /etc/os-release
else
  echo "Unsupported OS (no /etc/os-release)"
  exit 1
fi

install_packages_ubuntu() {
  apt-get update -y
  apt-get install -y curl git nginx certbot python3-certbot-nginx ufw
}

install_packages_amazon() {
  dnf update -y
  dnf install -y curl git nginx certbot python3-certbot-nginx firewalld
}

install_node() {
  if command -v node >/dev/null 2>&1 && [[ "$(node -p "process.versions.node.split('.')[0]")" -ge 22 ]]; then
    echo "Node $(node -v) already OK"
    return
  fi
  echo "==> Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  if [[ "${ID}" == "ubuntu" || "${ID}" == "debian" ]]; then
    apt-get install -y nodejs
  else
  # Amazon Linux — use NodeSource RHEL path or nvm fallback
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    dnf install -y nodejs
  fi
  node -v
}

case "${ID}" in
  ubuntu|debian)
    install_packages_ubuntu
    install_node
    ;;
  amzn|amazon|fedora|rhel|centos)
    install_packages_amazon
    # Node 22 on Amazon Linux
    if ! command -v node >/dev/null 2>&1; then
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      dnf install -y nodejs
    fi
    ;;
  *)
    echo "OS ${ID} not fully tested. Use Ubuntu 22.04 LTS or Amazon Linux 2023."
    exit 1
    ;;
esac

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [[ "${NODE_MAJOR}" -lt 22 ]]; then
  echo "ERROR: Node 22+ required (app uses built-in SQLite). Found: $(node -v)"
  exit 1
fi

echo "==> Creating app user and directories..."
id -u "${APP_USER}" &>/dev/null || useradd --system --home "${APP_DIR}" --shell /usr/sbin/nologin "${APP_USER}"
mkdir -p "${APP_DIR}" "${DATA_DIR}" /etc/cphi-app /var/log/cphi-app
chown -R "${APP_USER}:${APP_USER}" "${DATA_DIR}" /var/log/cphi-app

fix_app_permissions() {
  chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
}

ensure_nginx_can_start() {
  # Another web server often holds port 80 on fresh VPS images
  for svc in apache2 httpd; do
    if systemctl is-active --quiet "${svc}" 2>/dev/null; then
      echo "    Stopping ${svc} (conflicts with nginx on port 80)..."
      systemctl stop "${svc}" || true
      systemctl disable "${svc}" || true
    fi
  done
  if command -v ss >/dev/null 2>&1; then
    if ss -tlnp | grep -q ':80 '; then
      echo "    Port 80 in use before nginx start:"
      ss -tlnp | grep ':80 ' || true
    fi
  fi
}

echo "==> Cloning application..."
if [[ ! -d "${APP_DIR}/.git" ]]; then
  git clone "${GIT_REPO}" "${APP_DIR}"
else
  echo "Repo exists at ${APP_DIR}, pulling latest..."
  git -C "${APP_DIR}" pull --ff-only origin main || true
fi

# git clone/pull runs as root — cphi user must own the app dir before npm ci
fix_app_permissions

echo "==> Installing npm dependencies..."
cd "${APP_DIR}"
sudo -u "${APP_USER}" env HOME="${APP_DIR}" npm ci --omit=dev

echo "==> Environment file..."
cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
PORT=3000
DATABASE_PATH=${DATA_DIR}/cphi.db
CPHI_USERS_FILE=/etc/cphi-app/users.json
EOF
chmod 640 "${ENV_FILE}"
chown root:"${APP_USER}" "${ENV_FILE}"

USERS_FILE="/etc/cphi-app/users.json"
if [[ ! -f "${USERS_FILE}" ]]; then
  if [[ -n "${CPHI_USERS_JSON:-}" ]]; then
    echo "${CPHI_USERS_JSON}" > "${USERS_FILE}"
  else
    cp "${APP_DIR}/deploy/users.example.json" "${USERS_FILE}"
    echo "    Created ${USERS_FILE} from template — EDIT PASSWORDS before going live!"
  fi
  chmod 600 "${USERS_FILE}"
  chown "${APP_USER}:${APP_USER}" "${USERS_FILE}"
fi

fix_app_permissions

echo "==> systemd service..."
cp "${APP_DIR}/deploy/cphi-app.service" /etc/systemd/system/cphi-app.service
systemctl daemon-reload
systemctl enable cphi-app
systemctl restart cphi-app

echo "==> Nginx..."
cp "${APP_DIR}/deploy/nginx/cphi-milan.conf" /etc/nginx/sites-available/cphi-milan.conf 2>/dev/null \
  || cp "${APP_DIR}/deploy/nginx/cphi-milan.conf" /etc/nginx/conf.d/cphi-milan.conf

if [[ -d /etc/nginx/sites-enabled ]]; then
  ln -sf /etc/nginx/sites-available/cphi-milan.conf /etc/nginx/sites-enabled/cphi-milan.conf
  rm -f /etc/nginx/sites-enabled/default
fi
rm -f /etc/nginx/conf.d/default.conf 2>/dev/null || true

ensure_nginx_can_start
nginx -t
systemctl enable nginx
if ! systemctl restart nginx; then
  echo "ERROR: nginx failed to start. Run:"
  echo "  sudo systemctl status nginx.service"
  echo "  sudo journalctl -xeu nginx.service --no-pager | tail -40"
  echo "  sudo ss -tlnp | grep ':80'"
  exit 1
fi

echo "==> Firewall (UFW on Ubuntu)..."
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH || true
  ufw allow 'Nginx Full' || true
  ufw --force enable || true
fi

echo "==> Checking DNS for ${DOMAIN}..."
RESOLVED="$(getent ahostsv4 "${DOMAIN}" | awk '{print $1; exit}' || true)"
PUBLIC_IP="$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null || curl -fsS --max-time 5 ifconfig.me 2>/dev/null || true)"
echo "    Domain resolves to: ${RESOLVED:-unknown}"
echo "    This server public IP: ${PUBLIC_IP:-unknown}"
if [[ -n "${RESOLVED}" && -n "${PUBLIC_IP}" && "${RESOLVED}" != "${PUBLIC_IP}" ]]; then
  echo "    WARNING: DNS may not point to this server yet. Fix A record before SSL."
fi

echo "==> Obtaining SSL certificate (Certbot)..."
if certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m "${CERTBOT_EMAIL}" --redirect; then
  echo "SSL certificate installed."
else
  echo "Certbot failed — ensure DNS A record points here, ports 80/443 open, then run:"
  echo "  sudo certbot --nginx -d ${DOMAIN}"
fi

echo "==> Health check..."
sleep 2
if curl -fsS "http://127.0.0.1:3000/api/health" >/dev/null 2>&1; then
  echo "App health: OK (local)"
else
  echo "App health: check logs with: journalctl -u cphi-app -n 50 --no-pager"
fi

echo ""
echo "════════════════════════════════════════════════════════════"
echo " Setup complete!"
echo "   App:     https://${DOMAIN}"
echo "   Data:    ${DATA_DIR}/cphi.db"
echo "   Logs:    journalctl -u cphi-app -f"
echo "   Update:  sudo bash ${APP_DIR}/deploy/deploy.sh"
echo "════════════════════════════════════════════════════════════"
