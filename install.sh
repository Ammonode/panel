#!/usr/bin/env bash
# Ammonode panel installer for Ubuntu 22.04+ and Debian 12+.
#
#   curl -sSL https://raw.githubusercontent.com/Ammonode/panel/main/install.sh | sudo bash
#
# Non interactive:
#   sudo bash install.sh --domain panel.example.com --email you@example.com \
#     --username admin --password 'a-strong-password' --yes
set -euo pipefail

DOMAIN=""
ADMIN_EMAIL=""
ADMIN_USER="admin"
ADMIN_PASS=""
BRANCH="main"
REPO="https://github.com/Ammonode/panel.git"
DIR="/var/www/ammonode"
WEBSERVER="caddy"
ASSUME_YES=0

usage() {
  cat <<EOF
Usage: install.sh [options]
  --domain <name>       Domain or IP the panel is reached on
  --email <address>     Email of the first administrator
  --username <name>     Username of the first administrator (default: admin)
  --password <secret>   Password of the first administrator
  --branch <name>       Git branch or tag to install (default: main)
  --dir <path>          Install directory (default: /var/www/ammonode)
  --no-webserver        Do not install Caddy; serve on port 3000 only
  --yes                 Do not ask for confirmation
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="$2"; shift 2 ;;
    --email) ADMIN_EMAIL="$2"; shift 2 ;;
    --username) ADMIN_USER="$2"; shift 2 ;;
    --password) ADMIN_PASS="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --dir) DIR="$2"; shift 2 ;;
    --no-webserver) WEBSERVER="none"; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
# Read from the terminal even when the script itself comes from a pipe.
ask() {
  local prompt="$1" var="$2" secret="${3:-}"
  if [ -n "${!var}" ]; then return; fi
  [ -r /dev/tty ] || fail "Missing value for: $prompt (no terminal to ask on, pass it as an option)."
  if [ "$secret" = "secret" ]; then read -rsp "$prompt: " "${var?}" </dev/tty; echo; else read -rp "$prompt: " "${var?}" </dev/tty; fi
}

[ "$(id -u)" -eq 0 ] || fail "Run this script as root (sudo)."
. /etc/os-release
case "$ID" in
  ubuntu|debian) ;;
  *) fail "Unsupported system: $PRETTY_NAME. Use Ubuntu 22.04+ or Debian 12+, or the Docker setup." ;;
esac
HAS_SYSTEMD=0
[ -d /run/systemd/system ] && HAS_SYSTEMD=1

ask "Domain or IP for the panel (e.g. panel.example.com)" DOMAIN
ask "Admin email" ADMIN_EMAIL
ask "Admin password (min. 8 characters)" ADMIN_PASS secret
[ ${#ADMIN_PASS} -ge 8 ] || fail "The admin password must be at least 8 characters."

IS_IP=0
[[ "$DOMAIN" =~ ^[0-9.]+$ || "$DOMAIN" == "localhost" ]] && IS_IP=1
if [ "$WEBSERVER" = "caddy" ] && [ $IS_IP -eq 1 ]; then
  SCHEME="http"
else
  SCHEME=$([ "$WEBSERVER" = "caddy" ] && echo https || echo http)
fi
APP_URL="$SCHEME://$DOMAIN"
[ "$WEBSERVER" = "none" ] && APP_URL="http://$DOMAIN:3000"

if [ $ASSUME_YES -eq 0 ] && [ -r /dev/tty ]; then
  echo
  echo "  Panel URL:   $APP_URL"
  echo "  Directory:   $DIR"
  echo "  Admin:       $ADMIN_USER <$ADMIN_EMAIL>"
  echo "  Web server:  $WEBSERVER"
  read -rp "Continue? [Y/n] " ok </dev/tty
  [[ "$ok" =~ ^[Nn] ]] && exit 1
fi

export DEBIAN_FRONTEND=noninteractive
info "Installing system packages"
apt-get update -qq
apt-get install -y -qq curl unzip git ca-certificates gnupg openssl postgresql >/dev/null

if [ $HAS_SYSTEMD -eq 1 ]; then
  systemctl enable --now postgresql >/dev/null 2>&1
else
  service postgresql start >/dev/null
fi

if ! command -v bun >/dev/null 2>&1; then
  info "Installing Bun"
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local/bun bash >/dev/null 2>&1
  ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
fi
bun --version >/dev/null || fail "Bun could not be installed."

info "Creating database"
DB_PASS="$(openssl rand -hex 24)"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='ammonode'" | grep -q 1; then
  sudo -u postgres psql -qc "ALTER USER ammonode WITH PASSWORD '$DB_PASS';"
else
  sudo -u postgres psql -qc "CREATE USER ammonode WITH PASSWORD '$DB_PASS';"
fi
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='ammonode'" | grep -q 1 \
  || sudo -u postgres psql -qc "CREATE DATABASE ammonode OWNER ammonode;"

id ammonode >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin ammonode

info "Downloading Ammonode ($BRANCH)"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q --depth 1 origin "$BRANCH" && git -C "$DIR" checkout -q FETCH_HEAD
else
  mkdir -p "$(dirname "$DIR")"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

info "Installing dependencies and building the web interface"
bun install --frozen-lockfile >/dev/null
bun run build >/dev/null

if [ ! -f .env ]; then
  info "Writing configuration"
  cat > .env <<EOF
APP_URL=$APP_URL
APP_PORT=3000
APP_KEY=$(openssl rand -base64 32)
APP_ENV=production
APP_TIMEZONE=UTC
DATABASE_URL=postgres://ammonode:$DB_PASS@127.0.0.1:5432/ammonode
STORAGE_PATH=$DIR/storage
TRUST_PROXY=$([ "$WEBSERVER" = "caddy" ] && echo true || echo false)
EOF
else
  # Keep APP_KEY (it encrypts stored secrets); only refresh the database password.
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=postgres://ammonode:$DB_PASS@127.0.0.1:5432/ammonode#" .env
fi
chmod 600 .env
mkdir -p storage

info "Preparing the database"
bun apps/server/src/cli.ts migrate >/dev/null
bun apps/server/src/cli.ts seed >/dev/null
bun apps/server/src/cli.ts user:make --admin --email "$ADMIN_EMAIL" --username "$ADMIN_USER" --password "$ADMIN_PASS" >/dev/null 2>&1 \
  || echo "    (an account with this email or username already exists, skipped)"
chown -R ammonode:ammonode "$DIR"

if [ $HAS_SYSTEMD -eq 1 ]; then
  info "Creating the ammonode service"
  cat > /etc/systemd/system/ammonode.service <<EOF
[Unit]
Description=Ammonode panel
After=network.target postgresql.service

[Service]
User=ammonode
Group=ammonode
WorkingDirectory=$DIR
ExecStart=/usr/local/bin/bun apps/server/src/index.ts
Restart=always
RestartSec=3
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable ammonode >/dev/null 2>&1
  # Restart (not just start) so a re-run picks up the new database password.
  systemctl restart ammonode
else
  info "No systemd found: start the panel with"
  echo "    cd $DIR && sudo -u ammonode bun apps/server/src/index.ts"
fi

if [ "$WEBSERVER" = "caddy" ]; then
  info "Installing Caddy (automatic HTTPS)"
  if ! command -v caddy >/dev/null 2>&1; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq && apt-get install -y -qq caddy >/dev/null
  fi
  SITE="$DOMAIN"
  [ $IS_IP -eq 1 ] && SITE=":80"
  cat > /etc/caddy/Caddyfile <<EOF
$SITE {
	encode zstd gzip
	reverse_proxy 127.0.0.1:3000
}
EOF
  if [ $HAS_SYSTEMD -eq 1 ]; then systemctl reload caddy 2>/dev/null || systemctl restart caddy; fi
fi

echo
info "Ammonode is installed: $APP_URL"
echo "    Sign in as $ADMIN_USER, then add a node under Admin > Nodes and install the daemon on it:"
echo "    https://ammonode.github.io/docs/guide/install-daemon"
