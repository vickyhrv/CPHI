# Deploy CPHI Milan on AWS EC2

**Domain:** `cphi-milan.hrvglobal.ai`  
**Example IP:** `100.58.232.162`

## 1. DNS (do this first)

In your DNS provider (where `hrvglobal.ai` is managed):

| Type | Name        | Value            | TTL |
|------|-------------|------------------|-----|
| A    | cphi-milan  | 100.58.232.162   | 300 |

Wait until it resolves:

```bash
nslookup cphi-milan.hrvglobal.ai
```

## 2. EC2 security group

Allow inbound:

| Port | Purpose |
|------|---------|
| 22   | SSH     |
| 80   | HTTP (Certbot + redirect) |
| 443  | HTTPS   |

Recommended: **Ubuntu 22.04 LTS**, `t3.small` or larger.

## 3. One-time setup (on the EC2 instance)

SSH in:

```bash
ssh -i your-key.pem ubuntu@100.58.232.162
```

Run setup:

```bash
sudo apt-get update -y
sudo apt-get install -y git
git clone https://github.com/vickyhrv/CPHI.git /tmp/cphi-setup
cd /tmp/cphi-setup
chmod +x deploy/setup-ec2.sh deploy/deploy.sh
sudo CERTBOT_EMAIL=you@hrvglobal.ai bash deploy/setup-ec2.sh
```

Optional: set admin email for Let's Encrypt:

```bash
export CERTBOT_EMAIL=admin@hrvglobal.ai
```

## 4. After setup

- Open **https://cphi-milan.hrvglobal.ai**
- Login with team credentials (see `auth.js`)

## 5. Deploy updates (after `git push`)

On the server:

```bash
sudo bash /opt/cphi-app/deploy/deploy.sh
```

## Paths on server

| What        | Path |
|-------------|------|
| App code    | `/opt/cphi-app` |
| SQLite DB   | `/var/lib/cphi-milan/data/cphi.db` |
| Environment | `/etc/cphi-app/env` |
| Nginx       | `/etc/nginx/sites-available/cphi-milan.conf` |
| Service     | `systemctl status cphi-app` |

## Useful commands

```bash
# App logs
sudo journalctl -u cphi-app -f

# Restart app
sudo systemctl restart cphi-app

# Nginx test + reload
sudo nginx -t && sudo systemctl reload nginx

# Renew SSL (auto via cron; manual test)
sudo certbot renew --dry-run
```

## Login credentials (not in GitHub)

Passwords live in **`/etc/cphi-app/users.json`** on the server only (never committed).

After setup, edit passwords:

```bash
sudo nano /etc/cphi-app/users.json
sudo systemctl restart cphi-app
```

Or pass JSON at setup time:

```bash
sudo CPHI_USERS_JSON='[{"username":"hrvadmin","password":"YourSecret","displayName":"HRV Admin"}]' bash deploy/setup-ec2.sh
```

**Important:** This repo was public with old hardcoded passwords in git history — **change all passwords** after deploy.

## Troubleshooting

**EACCES npm / permission denied** — run:

```bash
sudo chown -R cphi:cphi /opt/cphi-app
sudo -u cphi env HOME=/opt/cphi-app bash -c 'cd /opt/cphi-app && npm ci --omit=dev'
sudo systemctl restart cphi-app
```

Or: `sudo bash /opt/cphi-app/deploy/fix-permissions.sh`

**502 Bad Gateway** — app not running:

```bash
sudo systemctl status cphi-app
sudo journalctl -u cphi-app -n 50
```

**Certbot failed** — DNS not propagated or port 80 blocked. Fix DNS/security group, then:

```bash
sudo certbot --nginx -d cphi-milan.hrvglobal.ai
```

**Node version error** — need Node 22+:

```bash
node -v   # must be v22.x or higher
```
