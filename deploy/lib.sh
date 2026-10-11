#!/usr/bin/env bash
# Shared helpers for install.sh, update.sh and uninstall.sh. Sourced, never executed directly.
# Nothing here downloads and executes a script. Node.js is fetched as a versioned archive and checked against
# the official SHASUMS256.txt before it is unpacked.

APP_NAME="tanveer-discord-bot"
APP_DIR="/opt/tanveer-discord-bot"
DATA_DIR="/var/lib/tanveer-discord-bot"
CONF_DIR="/etc/tanveer-discord-bot"
ENV_FILE="${CONF_DIR}/bot.env"
UNIT_FILE="/etc/systemd/system/${APP_NAME}.service"
SERVICE_USER="tanveer-bot"
NODE_VERSION="22.22.3"
NODE_ROOT="/opt/tanveer-node"
NODE_BIN="${NODE_ROOT}/current/bin/node"
NODE_NPM_CLI="${NODE_ROOT}/current/lib/node_modules/npm/bin/npm-cli.js"

info() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m OK\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mERROR\033[0m %s\n' "$*" >&2; exit 1; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "This step needs root. Run it with sudo, for example: sudo bash $(basename "$0")"
  fi
}

check_os() {
  local id=""
  if [ -r /etc/os-release ]; then
    # shellcheck disable=SC1091
    id="$(. /etc/os-release && printf '%s' "${ID:-}")"
  fi
  case "$id" in
    ubuntu|debian) ok "Operating system: $id" ;;
    *)
      if [ "${TANVEER_ALLOW_OS:-0}" = "1" ]; then
        warn "Unsupported OS '${id:-unknown}'. Continuing because TANVEER_ALLOW_OS=1."
      else
        die "Supported systems are Ubuntu and Debian (found '${id:-unknown}'). Set TANVEER_ALLOW_OS=1 to try anyway."
      fi
      ;;
  esac
}

node_is_new_enough() {
  local bin="$1" v major minor
  [ -x "$bin" ] || return 1
  v="$("$bin" -p 'process.versions.node' 2>/dev/null)" || return 1
  major="${v%%.*}"
  minor="${v#*.}"; minor="${minor%%.*}"
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 13 ]; }
}

install_node() {
  if node_is_new_enough "$NODE_BIN"; then
    ok "Node.js already installed at $NODE_BIN"
    return 0
  fi
  local arch
  case "$(uname -m)" in
    x86_64) arch="linux-x64" ;;
    aarch64) arch="linux-arm64" ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac
  local name="node-v${NODE_VERSION}-${arch}"
  local base="https://nodejs.org/dist/v${NODE_VERSION}"
  local tmp
  tmp="$(mktemp -d)"
  info "Downloading Node.js ${NODE_VERSION} (${arch}) from the official release"
  curl --fail --silent --show-error --location -o "${tmp}/${name}.tar.xz" "${base}/${name}.tar.xz"
  curl --fail --silent --show-error --location -o "${tmp}/SHASUMS256.txt" "${base}/SHASUMS256.txt"
  if ! (cd "$tmp" && grep " ${name}.tar.xz\$" SHASUMS256.txt | sha256sum -c --status -); then
    rm -rf "$tmp"
    die "Checksum mismatch for the Node.js download. Nothing was installed."
  fi
  mkdir -p "${NODE_ROOT}/v${NODE_VERSION}"
  tar -xJf "${tmp}/${name}.tar.xz" -C "${NODE_ROOT}/v${NODE_VERSION}" --strip-components=1
  ln -sfn "${NODE_ROOT}/v${NODE_VERSION}" "${NODE_ROOT}/current"
  rm -rf "$tmp"
  node_is_new_enough "$NODE_BIN" || die "Installed Node.js did not meet the minimum version."
  ok "Node.js $("$NODE_BIN" -p 'process.version') installed at $NODE_BIN"
}

ensure_system_user() {
  if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
    useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin --user-group "$SERVICE_USER"
    ok "Created system user $SERVICE_USER (no login shell)"
  fi
}

ensure_dirs() {
  install -d -m 0755 -o root -g root "$APP_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "$DATA_DIR"
  install -d -m 0750 -o "$SERVICE_USER" -g "$SERVICE_USER" "${DATA_DIR}/backups"
  install -d -m 0750 -o root -g "$SERVICE_USER" "$CONF_DIR"
}

# Copy the source tree into APP_DIR. Excludes VCS data, dependencies, runtime data, and any local .env.
sync_app() {
  local src="$1"
  tar -C "$src" --exclude=./.git --exclude=./node_modules --exclude=./data --exclude=./.env --exclude=./.env.local -cf - . \
    | tar -C "$APP_DIR" -xf -
  (cd "$APP_DIR" && PATH="$(dirname "$NODE_BIN"):$PATH" "$NODE_BIN" "$NODE_NPM_CLI" ci --omit=dev --no-audit --no-fund --loglevel=error)
  chown -R root:root "$APP_DIR"
  find "$APP_DIR" -type d -exec chmod 0755 {} +
  find "$APP_DIR" -type f -exec chmod 0644 {} +
  ok "Application files synced to $APP_DIR and dependencies installed"
}

# Run a Node script as the service user, with the environment file, from the app directory.
run_as_service() {
  (cd "$APP_DIR" && runuser -u "$SERVICE_USER" -- env -i PATH=/usr/bin:/bin HOME="$DATA_DIR" \
    ENV_FILE="$ENV_FILE" NODE_ENV=production \
    DATABASE_PATH="${DATA_DIR}/bot.sqlite" BACKUP_DIR="${DATA_DIR}/backups" \
    "$NODE_BIN" --disable-warning=ExperimentalWarning "$@")
}

render_unit() {
  local template="${APP_DIR}/deploy/${APP_NAME}.service.template"
  [ -f "$template" ] || die "Missing systemd template: $template"
  sed -e "s|@APP_DIR@|${APP_DIR}|g" \
      -e "s|@DATA_DIR@|${DATA_DIR}|g" \
      -e "s|@ENV_FILE@|${ENV_FILE}|g" \
      -e "s|@NODE_BIN@|${NODE_BIN}|g" \
      -e "s|@SERVICE_USER@|${SERVICE_USER}|g" \
      "$template" > "${UNIT_FILE}.tmp"
  install -m 0644 -o root -g root "${UNIT_FILE}.tmp" "$UNIT_FILE"
  rm -f "${UNIT_FILE}.tmp"
  systemctl daemon-reload
  ok "systemd unit installed at $UNIT_FILE"
}

have_systemd() {
  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

print_banner() {
  local banner="${APP_DIR}/branding/banner-full.txt"
  if [ -f "$banner" ]; then cat "$banner"; fi
}
