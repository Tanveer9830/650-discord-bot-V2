# Command inventory

Generated 2026-10-10T05:11:41.578Z by `npm run inventory`. Do not edit by hand.

## Counts (verified from code and tests)

| Measure | Count |
| --- | ---: |
| Top-level slash commands | 23 |
| Subcommand groups | 7 |
| Subcommands (leaf actions, excluding standalone commands) | 99 |
| Functional actions with handlers | 100 |
| Administration + moderation + security actions | 49 |
| Actions with behavioural tests (specific assertions) | 10 |
| Actions dispatched by the smoke test without an unhandled error | 100 |
| Top-level commands confirmed registered with Discord | 0 |
| Subcommands confirmed registered with Discord | 0 |

Registration: NOT confirmed — no successful Discord registration recorded

## Actions

| Action | Category | Access | Server-only | Behavioural test | Smoke test |
| --- | --- | --- | --- | --- | --- |
| `/about` | branding | public | no | yes | yes |
| `/utility ping` | utility | public | no | no | yes |
| `/utility avatar` | utility | public | no | no | yes |
| `/utility serverinfo` | utility | public | yes | no | yes |
| `/utility userinfo` | utility | public | no | no | yes |
| `/utility calc` | utility | public | no | yes | yes |
| `/utility timestamp` | utility | public | no | no | yes |
| `/utility base64` | utility | public | no | no | yes |
| `/owner status` | owner | owner | no | no | yes |
| `/owner list` | owner | owner | no | no | yes |
| `/owner add` | owner | owner | no | yes | yes |
| `/owner remove` | owner | owner | no | no | yes |
| `/owner diagnostics` | owner | owner | no | no | yes |
| `/diagnostics status` | utility | public | no | no | yes |
| `/diagnostics permissions` | administration | public | yes | no | yes |
| `/config view` | administration | public | yes | no | yes |
| `/config welcome set` | administration | public | yes | no | yes |
| `/config welcome disable` | administration | public | yes | no | yes |
| `/config goodbye set` | administration | public | yes | no | yes |
| `/config goodbye disable` | administration | public | yes | no | yes |
| `/config logs set` | administration | public | yes | no | yes |
| `/config logs disable` | administration | public | yes | no | yes |
| `/moderation kick` | moderation | public | yes | yes | yes |
| `/moderation ban` | moderation | public | yes | no | yes |
| `/moderation unban` | moderation | public | yes | no | yes |
| `/moderation timeout` | moderation | public | yes | no | yes |
| `/moderation untimeout` | moderation | public | yes | no | yes |
| `/moderation purge` | moderation | public | yes | no | yes |
| `/moderation history` | moderation | public | yes | no | yes |
| `/warn add` | moderation | public | yes | no | yes |
| `/warn list` | moderation | public | yes | no | yes |
| `/warn remove` | moderation | public | yes | no | yes |
| `/warn clear` | moderation | public | yes | no | yes |
| `/automod status` | security | public | yes | no | yes |
| `/automod enable` | security | public | yes | no | yes |
| `/automod disable` | security | public | yes | no | yes |
| `/automod addword` | security | public | yes | no | yes |
| `/automod removeword` | security | public | yes | no | yes |
| `/automod words` | security | public | yes | no | yes |
| `/automod links` | security | public | yes | no | yes |
| `/automod spam` | security | public | yes | no | yes |
| `/security incidents` | security | public | yes | no | yes |
| `/security audit` | security | public | yes | no | yes |
| `/security whitelist add` | security | public | yes | yes | yes |
| `/security whitelist remove` | security | public | yes | no | yes |
| `/security whitelist list` | security | public | yes | no | yes |
| `/security blocklist add` | security | public | yes | no | yes |
| `/security blocklist remove` | security | public | yes | no | yes |
| `/security blocklist list` | security | public | yes | no | yes |
| `/antiraid setup` | security | public | yes | no | yes |
| `/antiraid status` | security | public | yes | no | yes |
| `/role create` | administration | public | yes | no | yes |
| `/role delete` | administration | public | yes | no | yes |
| `/role assign` | administration | public | yes | no | yes |
| `/role remove` | administration | public | yes | no | yes |
| `/channel lock` | administration | public | yes | no | yes |
| `/channel unlock` | administration | public | yes | no | yes |
| `/channel slowmode` | administration | public | yes | no | yes |
| `/channel topic` | administration | public | yes | no | yes |
| `/buttonroles create` | community | public | yes | no | yes |
| `/verification setup` | community | public | yes | no | yes |
| `/verification disable` | community | public | yes | no | yes |
| `/ticket setup` | community | public | yes | no | yes |
| `/ticket open` | community | public | yes | no | yes |
| `/ticket close` | community | public | yes | no | yes |
| `/giveaway start` | community | public | yes | no | yes |
| `/giveaway end` | community | public | yes | no | yes |
| `/giveaway reroll` | community | public | yes | no | yes |
| `/giveaway list` | community | public | yes | no | yes |
| `/poll create` | community | public | yes | no | yes |
| `/poll results` | community | public | yes | no | yes |
| `/poll close` | community | public | yes | no | yes |
| `/reminder set` | utility | public | no | no | yes |
| `/reminder list` | utility | public | no | no | yes |
| `/reminder cancel` | utility | public | no | no | yes |
| `/economy balance` | economy | public | yes | no | yes |
| `/economy daily` | economy | public | yes | yes | yes |
| `/economy work` | economy | public | yes | no | yes |
| `/economy pay` | economy | public | yes | no | yes |
| `/economy leaderboard` | economy | public | yes | no | yes |
| `/economy history` | economy | public | yes | no | yes |
| `/economy setup` | economy | public | yes | no | yes |
| `/economy shop add` | economy | public | yes | no | yes |
| `/economy shop list` | economy | public | yes | no | yes |
| `/economy shop buy` | economy | public | yes | no | yes |
| `/level rank` | community | public | yes | no | yes |
| `/level leaderboard` | community | public | yes | no | yes |
| `/level setup` | community | public | yes | no | yes |
| `/level roles add` | community | public | yes | no | yes |
| `/level roles remove` | community | public | yes | no | yes |
| `/customcommand create` | owner | owner | no | yes | yes |
| `/customcommand list` | owner | owner | no | no | yes |
| `/customcommand preview` | owner | owner | no | no | yes |
| `/customcommand delete` | owner | owner | no | no | yes |
| `/customcommand toggle` | owner | owner | no | no | yes |
| `/customcommand run` | owner | public | yes | yes | yes |
| `/backup create` | administration | public | yes | yes | yes |
| `/backup list` | administration | public | yes | no | yes |
| `/backup restore` | administration | public | yes | yes | yes |
| `/embed create` | administration | public | yes | no | yes |
