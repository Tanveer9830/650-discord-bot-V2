# Roadmap and honest status

The original brief asks for a large bot. This repository delivers a tested foundation in one milestone. The rest is planned, not claimed.

## Milestone 1: foundation (this repository)

**Built and covered by automated tests** (`npm test`, 184 tests, all passing at the time of writing):

- Configuration with name-only error messages, exit code 78 for configuration errors, and no secret echoed.
- SQLite schema with migrations, CHECK constraints, a transaction ledger for economy, and idempotent re-runs.
- Owner model: verified numeric IDs, env seed, DB rows, confirmation-gated changes, last-owner protection, audit.
- Dispatcher: deduplication, owner gate, server and bot permission checks, cooldowns, friendly errors, mention-free output.
- Moderation, warnings, automod (word filter, links, invites, blocklist, anti-spam, suspicious links), anti-raid join detection, whitelist, blocklist, audit and incident logs.
- Economy (balances, daily, work, pay, shop, history, leaderboard), leveling (XP, level roles, announcements).
- Giveaways (scheduler ends them and refreshes messages), polls, reminders (scheduler delivers them), tickets, button roles, verification, embeds, calculator, timestamps.
- Custom commands (owner-managed templates), backups (validated, transactional restore, cross-server refusal).
- Command registry validation against Discord's structural limits, plus generated inventory.
- Installer scripts (`install.sh`, `update.sh`, `uninstall.sh`), systemd unit template, `.env.example`, operator scripts.

**Built but NOT verified end to end**

- Live Discord behaviour: the bot has not logged in to Discord, and no server has been tested. Event handlers are exercised only with fake clients.
- Command registration with Discord: the script is written and its dry run works, but nothing has been registered.
- `install.sh` on Ubuntu: the sandbox was Debian 12 with no systemd and no root access. The installer was syntax-checked and its non-root paths tested. The full install, systemd start, and checksum download were not run.
- `shellcheck`: not installed in the sandbox, so no lint pass was run on the shell scripts.
- Scheduler in a live process: tested by calling `tick()` directly, not by running the timer inside the bot.
- Behavioural tests cover 10 of 100 actions. The smoke test dispatches all 100 but only checks that none raise an unhandled error. Full behavioural coverage is planned for milestone 2.

## Milestone 2 (in progress): protected security and automatic registration

**Built in phase 1, covered by automated tests (`npm test`, 231 tests at the time of writing):**

- Migration `002_protected_security`: anti-nuke settings, the owner-managed protected whitelist (per server, per capability, with expiry and revoke history), and an append-only protected audit (`src/database/migrations/002_protected_security.js`). Migration 001 is unchanged, and an upgrade test confirms existing data survives.
- Central owner authorisation, fail-closed (`src/security/protectedAuth.js`).
- Anti-nuke detection, thresholds, alert-once-per-window, exemptions and response planning (`src/security/antinuke.js`, unit-tested with false-positive cases), plus gateway wiring (`src/events/antinuke.js`) that resolves actors through the audit log.
- Owner-only `/protection` commands and confirmation flow; admin `/security antinuke status|set|disable` (disable is refused and logged).
- Automatic, idempotent slash-command registration at startup (`AUTO_REGISTER_COMMANDS`, default on). Registration is verified by reading the commands back from Discord before the state is recorded.
- CI workflow (`.github/workflows/ci.yml`): locked install, syntax, registry validation, tests, shell syntax, `npm audit`, and secret scanning.

**Built but NOT verified against live Discord** (no credentials in this environment): the gateway wiring, audit-log actor lookup, automatic registration, and the actual Discord registration count.

## Not built yet

| Area | Status |
| --- | --- |
| Lavalink music | Not started. Needs a Lavalink server, so it is a separate milestone. |
| OAuth2 dashboard | Not started. Needs an HTTP server, OAuth2 code flow with PKCE and state checks, CSRF protection, and a session store. |
| 650+ actions (150+ admin, 500+ general) | 110 implemented (see docs/COMMANDS.md). |
| Multi-language help, per-server custom branding | Not started. |
| Protected branding change with preview and confirmation | Not started. |
| Protected Lavalink configuration workflow | Not started. |
| Installer changes for dashboard and Lavalink selection (independent) | Not started. The current installer does not ask about either component. |

## Next milestones (planned)

1. **M2: verification.** Behavioural tests for every action. Run the bot against a test server and record results. Run `shellcheck` on the shell scripts. Test the installer on a real Ubuntu VM with systemd.
2. **M3: expansion.** Add actions in groups of about 50, keeping each group inside Discord's option limits. Keep the command count per module within limits and use subcommand groups to stay under 100 top-level commands.
3. **M4: dashboard.** Read-only dashboard first, then write actions behind a confirmation.
4. **M5: music.** Lavalink integration with queue, skip, and volume controls.

## Discord limits the design respects

- Max 100 global chat-input commands per application, and 100 per guild.
- Max 25 options per command level, subcommands included. Subcommand groups go one level deep.
- Names are 1–32 lowercase characters. Descriptions are 1–100 characters.
- Choices are capped at 25.
- The registration validator in `src/commands/framework.js` enforces these before any request is sent.
