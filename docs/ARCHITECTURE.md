# Architecture

## Layers

```
Discord gateway ──► src/events (messages, joins, leaves, interactions)
                         │
                         ▼
                 src/commands/dispatcher.js   one entry point for slash commands, autocomplete and buttons
                  │  dedupe by interaction ID → owner gate → server permissions → bot permissions
                  │  → cooldowns → handler → audit → friendly error handling
                         ▼
           src/commands/*.js  (23 modules: groups and subcommands, built from a declarative spec)
                         │
                         ▼
     src/services/*  (economy, leveling, giveaways, scheduler, customCommands, backups, calc)
                         │
                         ▼
     src/security/*  (owners, permissions, confirmations, automod, links, antiraid, dedupe, cooldowns)
                         │
                         ▼
     src/database/repos/*  (the only code that writes SQL)  ──►  SQLite (node:sqlite, WAL, migrations)
```

- **Composition root:** `src/app.js` (`createApp`) builds the database, migrations, repositories, services, registry, components, dispatcher and scheduler. It never connects to Discord, so tests and `--check` use the same graph.
- **Entry point:** `src/index.js`. `--check` validates configuration, migrations and the registry, then exits without logging in. Exit code `78` means a configuration error (systemd does not restart on it). Exit `1` means another startup failure.
- **Client:** `src/client.js` requests only `Guilds`, `GuildMembers`, `GuildMessages` and `MessageContent`. Mentions are disabled by default.

## Command model

- Modules are declared with `defineModule` in `src/commands/framework.js`. Each module is a top-level command. Subcommand groups are allowed one level deep, which is Discord's limit.
- A standalone module (for example `/about`) has a single action.
- Every action declares its access (`public` or `owner`), its server permissions, its bot permissions, its options, and an optional autocomplete handler.
- `src/commands/builder.js` converts the registry into Discord JSON. `src/commands/index.js` validates the whole registry at startup. Validation checks names, description lengths, option counts, nesting depth, duplicate names and handler presence.

## Persistence

- `node:sqlite` (built into Node 22) with `journal_mode=WAL`, foreign keys on, and `CHECK` constraints on every bounded value.
- Migrations are numbered SQL-in-JS files under `src/database/migrations/`. Each one runs once, in a transaction, and is recorded. Re-running applies nothing.
- Money changes go through `BEGIN IMMEDIATE`. Balances cannot go negative (`CHECK (balance >= 0)`). Every change writes an `economy_transactions` row.
- Guild settings and automod settings accept only allow-listed columns. Field names are never built from user input.

## Background work

`src/services/scheduler.js` runs every `SCHEDULER_INTERVAL_MS` (default 15 s), but only after Discord confirms the login. It:

1. ends giveaways whose end time has passed, picks winners with `crypto.randomInt`, and refreshes the message;
2. sends due reminders with mentions disabled, then marks them `sent` or `failed` (no retry loop);
3. purges expired confirmations.

A re-entrancy guard prevents overlapping ticks.

## Custom commands

Definitions are validated by `src/services/customCommands.js`: names are restricted, bodies are length-limited, mention syntax is rejected, placeholders must be on the allow-list, and substituted values are sanitised. There is no expression language. Rendering is a string substitution.

## Tests

`tests/*.test.js` run with `node:test`. They use an in-memory database, a fake clock and fake Discord objects.

- `branding`, `security`, `database`, `economy-leveling`, `community`, `custom-commands-backups`: unit and integration tests of services and repositories.
- `dispatcher`: 12 end-to-end checks through the real dispatcher (owner gate, permissions, confirmations, dedupe, mention-free output).
- `smoke-actions`: runs **every** action through the dispatcher and fails on any unhandled internal error. It has no behavioural assertions beyond that.
- `events`: real message events through a fake client (automod deletion, exemptions, bot filtering, XP, DMs).
- `registry`: Discord structural limits, mention-free policy, owner-only rules.
- `startup`: spawns the real entry point and scripts for exit codes and output.
- `installer`: shell syntax, forbidden download patterns, checksum-before-extract, the unit file's hardening.

Coverage is recorded in `data/test-coverage-*.json` during the test run. `npm run inventory` reads it, so the counts in COMMANDS.md come from the actual test run.
