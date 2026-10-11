# Tanveer Discord Bot

```
 ████████╗  █████╗  ███╗   ██╗ ██╗   ██╗ ███████╗ ███████╗ ██████╗
 ╚══██╔══╝ ██╔══██╗ ████╗  ██║ ██║   ██║ ██╔════╝ ██╔════╝ ██╔══██╗
    ██║    ███████║ ██╔██╗ ██║ ██║   ██║ █████╗   █████╗   ██████╔╝
    ██║    ██╔══██║ ██║╚██╗██║ ╚██╗ ██╔╝ ██╔══╝   ██╔══╝   ██╔══██╗
    ██║    ██║  ██║ ██║ ╚████║  ╚████╔╝  ███████╗ ███████╗ ██║  ██║
    ╚═╝    ╚═╝  ╚═╝ ╚═╝  ╚═══╝   ╚═══╝   ╚══════╝ ╚══════╝ ╚═╝  ╚═╝
        M A D E   B Y   T A N V E E R   |   Discord: tanveer5637
```

Made by Tanveer | Discord: tanveer5637

A self-hosted Discord bot for moderation, economy, leveling, giveaways, polls, reminders, tickets, custom commands and server backups. It is written in JavaScript on Node.js 22 with SQLite. It has no native build step.

> **Status: milestone 2, phase 1.** The bot has 110 functional actions across 24 top-level commands, including the owner-verified protected whitelist and anti-nuke detection. Slash commands register automatically at startup. This is not yet the 650+ action target. Live Discord registration has not been verified in this environment. Lavalink music and the OAuth dashboard are not built yet. See [docs/ROADMAP.md](docs/ROADMAP.md) for the honest state of every item and [docs/COMMANDS.md](docs/COMMANDS.md) for the generated command list.

## Install on Ubuntu (or Debian) with systemd

```bash
git clone https://github.com/Tanveer9830/New-and-funnal-bot.git
cd New-and-funnal-bot
sudo bash install.sh
```

The installer:

- installs Node.js 22 from the official release archive and checks its SHA-256 against the published `SHASUMS256.txt`;
- creates the `tanveer-bot` system account (no login shell) and runs the bot as that account;
- copies the app to `/opt/tanveer-discord-bot` and keeps data in `/var/lib/tanveer-discord-bot`;
- asks for the bot token (input hidden), the application (client) ID, owner user IDs, and an optional test server ID;
- writes `/etc/tanveer-discord-bot/bot.env` with mode `0640` (owner `root`, group `tanveer-bot`);
- runs the database migrations and a configuration check, installs the hardened systemd unit, and starts it.

It never asks for a GitHub password or token, and it never pipes a remote script into a shell. Use `sudo bash install.sh --reconfigure` to change credentials. For automation, set `TANVEER_NONINTERACTIVE=1` with `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` in the environment.

Before the first run, enable the **Server Members Intent** and **Message Content Intent** in the Discord developer portal (Bot page). The bot needs both.

Other scripts:

| Command | Purpose |
| --- | --- |
| `sudo bash update.sh` | Pull (fast-forward only), back up the database, sync, migrate, restart |
| `sudo bash uninstall.sh` | Stop and remove the service and app files; keeps data unless `--purge` |
| `npm run doctor` | Local diagnostics; never prints secret values |
| `npm run backup` | Verified online backup (`VACUUM INTO`) into `BACKUP_DIR` |
| `npm run register:guild` / `npm run register:global` | Register slash commands with Discord |
| `npm run inventory` | Regenerate `docs/COMMANDS.md` and `docs/command-inventory.json` |

## Develop locally

```bash
npm install
cp .env.example .env        # then edit .env; never commit it
npm run check               # validate config, migrations and the command registry (no Discord login)
npm test                    # 231 automated tests
npm start                   # run the bot (needs DISCORD_TOKEN)
```

## What it does (milestone 1)

- **Owners:** the global owner is the verified numeric ID `1131248987173814336` by default, set through `OWNER_IDS`. Only numeric IDs grant ownership. Usernames, display names, dashboard values and server Administrator permission never do. Ownership changes need a confirmation button clicked by the same owner, and they are audited. The last owner can never be removed.
- **Moderation:** kick, ban, unban, timeout, untimeout, purge, history, warnings. Role hierarchy is checked. The bot needs the matching Discord permission.
- **Automod:** word filter, link and invite blocking, domain blocklist, anti-spam, anti-raid join-burst detection, and suspicious-link heuristics. The whitelist only exempts members or roles from automod and anti-spam.
- **Economy:** balances, daily and work rewards, transfers, a shop, and an append-only transaction ledger. Each change runs in one `BEGIN IMMEDIATE` transaction.
- **Leveling:** message XP (15–25 per message, 60-second cooldown), level-up announcements, and level roles.
- **Giveaways, polls, reminders, tickets, button roles, verification, embeds, a safe calculator, and timestamps.**
- **Custom commands** (global owner only): safe text and embed templates with `{server}`, `{member}` and `{members}` placeholders. There is no scripting and no arbitrary code.
- **Backups:** save and restore a server's bot configuration. Restore needs Administrator and a confirmation. Balances and history are never restored.
- **No tagging commands:** no command exists to ping or mention a user. Every bot message is sent with `allowedMentions: { parse: [] }`.

## Documentation

- [docs/COMMANDS.md](docs/COMMANDS.md): every command and action, generated from code.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): layers, data flow, and the database.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): running, logs, backups, updates, troubleshooting.
- [docs/SECURITY.md](docs/SECURITY.md): threat model, controls, and known limits.
- [docs/ROADMAP.md](docs/ROADMAP.md): what is done, what is verified, and what is not.

## Licence

Unlicensed (private project). Made by Tanveer | Discord: tanveer5637.
