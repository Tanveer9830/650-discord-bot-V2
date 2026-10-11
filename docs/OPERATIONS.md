# Operations

## Service

```bash
sudo systemctl status tanveer-discord-bot
sudo systemctl restart tanveer-discord-bot
sudo journalctl -u tanveer-discord-bot -f           # live log (JSON lines)
sudo journalctl -u tanveer-discord-bot -n 100 --no-pager
```

Exit code `78` means the configuration is invalid. The service is not restarted for that code. Fix `/etc/tanveer-discord-bot/bot.env`, then run `sudo systemctl start tanveer-discord-bot`. A wrong token shows up as a login failure in the log, and the service keeps retrying on other failures.

## Configuration

Edit `/etc/tanveer-discord-bot/bot.env` (keep it `0640 root:tanveer-bot`), or re-run `sudo bash install.sh --reconfigure`. Variables are documented in `.env.example`. Restart the service after any change.

| Variable | Default | Notes |
| --- | --- | --- |
| `DISCORD_TOKEN` | — | Secret. Required to run. |
| `DISCORD_CLIENT_ID` | — | Required for command registration. |
| `DISCORD_DEV_GUILD_ID` | — | Optional. Enables instant guild-scope registration. |
| `OWNER_IDS` | `1131248987173814336` | Comma-separated numeric IDs. |
| `DATABASE_PATH` | `./data/bot.sqlite` | The unit sets `/var/lib/tanveer-discord-bot/bot.sqlite`. |
| `BACKUP_DIR` | `./data/backups` | The unit sets `/var/lib/tanveer-discord-bot/backups`. |
| `LOG_LEVEL` / `LOG_FORMAT` | `info` / `json` | |
| `COMMAND_COOLDOWN_MS` | `1500` | Per user, per action. Global owners bypass cooldowns. |
| `SCHEDULER_INTERVAL_MS` | `15000` | Giveaway and reminder polling. |

## Registering slash commands

Discord keeps its own copy of the command definitions, so registration is a separate step.

```bash
sudo runuser -u tanveer-bot -- env ENV_FILE=/etc/tanveer-discord-bot/bot.env \
  /opt/tanveer-node/current/bin/node /opt/tanveer-discord-bot/scripts/register-commands.js --scope guild --guild <TEST_SERVER_ID>
sudo runuser -u tanveer-bot -- env ENV_FILE=/etc/tanveer-discord-bot/bot.env \
  /opt/tanveer-node/current/bin/node /opt/tanveer-discord-bot/scripts/register-commands.js --scope global
```

- Guild registration is instant. Global registration can take up to about an hour.
- The script writes `data/command-registration.json` **only after Discord returns a confirmed response** that matches the submitted command count. If the definition has not changed since the last successful registration, it does nothing. Use `--force` to resend.
- Each registration replaces all commands for that scope. Commands removed from the code are removed from Discord.

## Backups and restore

- Automatic: `update.sh` writes a verified backup before every update.
- Manual: `npm run backup` (run as the service user). It uses `VACUUM INTO` and checks `PRAGMA integrity_check` before reporting success. Files are `0600`.
- Restore: stop the service, then `node scripts/restore-db.js <backup.sqlite> --yes`. The current database is **moved aside** (`*.pre-restore-<time>`), never deleted. Start the service and run `npm run doctor`.
- Per-server configuration backups are in-bot: `/backup create`, `/backup list`, `/backup restore` (Administrator, with confirmation).

## Updating

From your clone directory: `sudo bash update.sh`. It pulls with `--ff-only`, backs up the database, stops the service, syncs files, installs production dependencies, applies migrations, checks configuration, and restarts. If the pull fails, nothing else runs.

## Uninstalling

`sudo bash uninstall.sh` removes the service and app files and keeps data and configuration. `sudo bash uninstall.sh --purge` also deletes the database, backups, configuration and service account. Both need you to type `UNINSTALL`.

## Health checks

`npm run doctor` (inside the app directory, as the service user) reports Node version, configuration shape (no secrets), file permissions on the env file, database integrity, and command-registry validity. Add `--network` to test reachability of the Discord API.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Service exits 78 | `journalctl` shows which variable is invalid. |
| Service keeps restarting | `journalctl -n 100`. Login failures usually mean a wrong or reset token. |
| Slash commands missing | Register them (see above). Global commands can take up to an hour. |
| "CHECK constraint" message to a user | A value was outside a stored range. The bot says so without showing SQL. |
| Bot cannot moderate someone | The bot's role must be above the target's, and it needs the matching permission. |
