#!/usr/bin/env bash
# Remove the Tanveer Discord Bot service and application files.
# Data (database and backups) and configuration are KEPT unless you pass --purge.
#   sudo bash uninstall.sh          keep data and configuration
#   sudo bash uninstall.sh --purge  also delete data, configuration, and the service account
set -Eeuo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/lib.sh
. "${SRC_DIR}/deploy/lib.sh"

PURGE=0
[ "${1:-}" = "--purge" ] && PURGE=1
require_root

echo "This stops and removes the ${APP_NAME} service and its application files in ${APP_DIR}."
if [ "$PURGE" -eq 1 ]; then
  echo "--purge also DELETES the database and backups in ${DATA_DIR} and the configuration in ${CONF_DIR}."
fi
read -r -p "Type UNINSTALL to continue: " answer </dev/tty
[ "$answer" = "UNINSTALL" ] || die "Cancelled. Nothing was changed."

if have_systemd; then
  systemctl stop "$APP_NAME" 2>/dev/null || true
  systemctl disable "$APP_NAME" 2>/dev/null || true
  rm -f "$UNIT_FILE"
  systemctl daemon-reload
  ok "Service stopped, disabled and unit removed"
fi

rm -rf "$APP_DIR"
ok "Application files removed from $APP_DIR"

if [ "$PURGE" -eq 1 ]; then
  rm -rf "$DATA_DIR" "$CONF_DIR"
  if id -u "$SERVICE_USER" >/dev/null 2>&1; then userdel "$SERVICE_USER" || true; fi
  ok "Data, configuration and service account removed"
else
  ok "Kept data in $DATA_DIR and configuration in $CONF_DIR (use --purge to delete them)"
fi
echo "Node.js in ${NODE_ROOT} was left in place. Remove it with: sudo rm -rf ${NODE_ROOT}"
