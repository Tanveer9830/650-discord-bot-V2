# Security

## Threat model (short)

- Server members can run commands, press buttons and post messages. They must not be able to escalate to bot owner powers, change server settings they lack permission for, or make the bot ping people.
- Server administrators must not be able to take over the bot's global owner powers.
- Anyone with the bot token controls the bot. The token is the main secret.

## Controls

| Area | Control |
| --- | --- |
| Global owner | Verified numeric IDs only (`OWNER_IDS`, default `1131248987173814336`, plus the `bot_owners` table). Never usernames, display names, dashboard values or server Administrator. |
| Owner changes | Confirmation button bound to the creator (`owner:add|remove|cancel:<id>`), 120-second TTL, single use, audited. Env-seeded owners cannot be removed by command. The last owner cannot be removed. |
| Owner gate | `access: 'owner'` actions are denied for everyone else and the denial is audited (`command.denied.owner`). |
| Server permissions | Checked for everyone, owners included. Global ownership does not bypass Discord permissions. |
| Hierarchy | Moderation actions use `canActOnMember`. Nobody acts on members at or above their own highest role, or the server owner. The bot must outrank the target. |
| Whitelist and blocklist | Require Administrator (stricter than ManageGuild). Whitelist entries only skip automod and anti-spam. |
| Mentions | Every bot response is sent with `allowedMentions: { parse: [] }`. There is no command whose purpose is to tag or ping people. |
| Custom commands | Templates only. Mention syntax and unknown placeholders are rejected. Only the global owner can create or delete them. |
| Backups | Schema-validated with `zod` before any write. Restores run in one transaction that rolls back on failure. A backup from another server is refused. |
| SQL | Parameterised statements. Field names are checked against allow-lists, never interpolated from user input. |
| Expressions | `/utility calc` uses a small tokenizer and parser. It does not call `eval` or `Function`. Length is capped at 120 characters. |
| Secrets in logs | The logger redacts known secret keys and registered token values. Config errors name the variable but never print its value. |
| Process | Non-root service account, no login shell, `0640` env file, systemd hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, empty capability set, `RestrictAddressFamilies`). Exit `78` is not restarted. |
| Installer | Checksum-verified Node.js archive. No `curl | bash`. No GitHub credentials requested. |
| Git hygiene | `.gitignore` excludes `.env`, databases, backups, logs and `node_modules`. `.env.example` holds placeholders only. |

## Known limits (be honest about these)

- Automod heuristics are not a malware scanner. Suspicious-link detection flags common scam patterns for review. It is not a substitute for a reputation service.
- The anti-raid join monitor counts joins in memory. A restart clears its window.
- Cooldowns and deduplication are in memory and reset on restart.
- The bot has not been penetration tested.
- Dashboard OAuth2 security is not implemented yet, because the dashboard is not built.

## Reporting

Report security issues privately to the maintainer (Tanveer | Discord: tanveer5637). Do not post tokens, env files or database contents in issues.
