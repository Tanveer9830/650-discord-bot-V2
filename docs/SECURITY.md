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

## Protected security (milestone 2, phase 1)

- **Global Owner** is authorised only by the numeric Discord ID in `OWNER_IDS` (default `1131248987173814336`). Usernames, nicknames, display names, roles and Administrator permission never grant it. Central checks live in `src/security/protectedAuth.js` and fail closed on any error.
- **Protected whitelist** (`/protection whitelist grant|revoke|list|history`) is owner-only. Each row grants ONE capability (`channels`, `roles`, `bans`, `kicks`, `webhooks`, `bots`, `permissions`, `guild_settings`, or `all`) to ONE user in ONE server, optionally with an expiry. A grant in one server never applies in another. Grants require a confirmation button that only the owner who started it can press, and it expires after 2 minutes.
- **Anti-nuke** (`src/security/antinuke.js`, `src/events/antinuke.js`) watches channel, role, ban, kick, webhook, bot-addition, privilege-grant, dangerous guild-setting and bot-tamper events. It identifies the actor from the audit log and counts per actor and rule inside a sliding window. Defaults are conservative: detection is on, the response is `alert` only, and an alert is raised once per window.
- **Response ladder**: `log` (record only), `alert` (post to the log channel), `restrict` (remove hazardous roles from the actor, only when the bot outranks them and the actor is not the server owner or the bot). Only the global owner can change the mode or turn anti-nuke off. An administrator who tries to disable it is refused and the attempt is recorded as a high-severity incident.
- **Audit**: `protected_audit` is append-only (database triggers reject UPDATE and DELETE). Every grant, revoke and settings change records before and after values.

## Known limits (be honest about these)

- Automod heuristics are not a malware scanner. Suspicious-link detection flags common scam patterns for review. It is not a substitute for a reputation service.
- The anti-raid join monitor counts joins in memory. A restart clears its window.
- Cooldowns and deduplication are in memory and reset on restart.
- The bot has not been penetration tested.
- Dashboard OAuth2 security is not implemented yet, because the dashboard is not built.

## Reporting

Report security issues privately to the maintainer (Tanveer | Discord: tanveer5637). Do not post tokens, env files or database contents in issues.

### Anti-nuke limits

- Discord's audit log can be delayed or incomplete. If the bot lacks View Audit Log, or no entry matches within 15 seconds, the actor is unknown and the event is recorded as `antinuke.unattributed` and is not counted.
- Anti-nuke does not prevent a determined attacker. It detects bursts, alerts operators and can strip hazardous roles, but it cannot undo deletions. Recover with backups (`/backup`).
- Role permission changes on existing roles (a role gaining Administrator) are not monitored yet. Only member role grants are.
- The bot's own role hierarchy limits what `restrict` can do. Owners of the server cannot be restricted.

