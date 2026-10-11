#!/usr/bin/env bash
# Update an installed Tanveer Discord Bot from this clone: pull, back up the database, sync, migrate, restart.
#   sudo bash update.sh            (pulls with --ff-only when this directory is a git clone)
#   sudo bash update.sh --no-pull  (use the files already in this directory)
set -Eeuo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
. "${SRC_DIR}/deploy/lib.sh"

PULL=1
[ "${1:-}" = "--no-pull" ] && PULL=0
trap 'die "Update stopped at line $LINENO. The service may be stopped; check: sudo systemctl status ${APP_NAME}"' ERR

require_root
[ -f "$ENV_FILE" ] || die "No installation found ($ENV_FILE is missing). Run install.sh first."
node_is_new_enough "$NODE_BIN" || die "Node.js is missing or too old. Run install.sh again."

if [ "$PULL" -eq 1 ] && [ -d "${SRC_DIR}/.git" ]; then
  info "Fetching the latest code (fast-forward only)"
  git -C "$SRC_DIR" -c safe.directory="$SRC_DIR" pull --ff-only
fi

info "Backing up the database before updating"
if [ -f "${DATA_DIR}/bot.sqlite" ]; then
  run_as_service scripts/backup.js
fi

info "Stopping the service"
if have_systemd; then systemctl stop "$APP_NAME" || true; fi

info "Updating application files"
sync_app "$SRC_DIR"

info "Applying database migrations and checking configuration"
run_as_service scripts/migrate.js
run_as_service src/index.js --check >/dev/null
ok "Migrations applied and configuration is valid"

if have_systemd; then
  render_unit
  systemctl start "$APP_NAME"
  sleep 5
  if systemctl is-active --quiet "$APP_NAME"; then
    ok "Updated and running. Follow the log with: sudo journalctl -u $APP_NAME -f"
  else
    warn "Updated, but the service is not running. Check: sudo journalctl -u $APP_NAME -n 50 --no-pager"
  fi
fi
echo "Slash command definitions changed? Re-register with: sudo runuser -u $SERVICE_USER -- env ENV_FILE=$ENV_FILE $NODE_BIN $APP_DIR/scripts/register-commands.js --scope global"
