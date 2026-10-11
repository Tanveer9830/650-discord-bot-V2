#!/usr/bin/env node
'use strict';

/**
 * Register slash commands with Discord.
 *   node scripts/register-commands.js --scope guild            (uses DISCORD_DEV_GUILD_ID; instant)
 *   node scripts/register-commands.js --scope guild --guild ID
 *   node scripts/register-commands.js --scope global           (production; can take up to ~1 hour to propagate)
 * Flags: --dry-run (no network), --force (re-send even if the definition is unchanged).
 *
 * The registration state file is written ONLY after Discord returns a confirmed response.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes, DiscordAPIError } = require('discord.js');
const { loadDotEnv, parseConfig } = require('../src/config');
const { buildRegistry } = require('../src/commands');
const { SNOWFLAKE } = require('../src/config');

const ROOT = path.resolve(__dirname, '..');
const STATE_FILE = path.join(ROOT, 'data', 'command-registration.json');

function parseArgs(argv) {
  const args = { scope: null, guild: null, dryRun: false, force: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--scope') args.scope = argv[++i];
    else if (a === '--guild') args.guild = argv[++i];
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--force') args.force = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!['guild', 'global'].includes(args.scope)) throw new Error('Use --scope guild or --scope global.');
  return args;
}

function countLeaves(modules) {
  return modules.reduce((n, m) => n + Object.values(m.groups).reduce((g, grp) => g + Object.keys(grp.actions).length, 0) + Object.keys(m.actions).length, 0);
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true, mode: 0o750 });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
  fs.renameSync(tmp, STATE_FILE);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  loadDotEnv();
  const config = parseConfig(process.env);
  const registry = buildRegistry();
  const payload = registry.payload();
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const topLevelCount = payload.length;
  const subcommandCount = countLeaves(registry.modules);

  const guildId = args.scope === 'guild' ? (args.guild || config.discord.devGuildId) : null;
  if (args.scope === 'guild' && (!guildId || !SNOWFLAKE.test(guildId))) {
    throw new Error('Guild scope needs a valid guild ID: pass --guild or set DISCORD_DEV_GUILD_ID.');
  }
  const clientId = config.discord.clientId;
  if (!args.dryRun && !clientId) throw new Error('DISCORD_CLIENT_ID is required to register commands.');
  if (!args.dryRun && !config.discord.token) throw new Error('DISCORD_TOKEN is required to register commands.');

  process.stdout.write(`Definition: ${topLevelCount} top-level commands, ${subcommandCount} subcommands/actions, hash ${hash.slice(0, 12)}\n`);
  if (args.dryRun) {
    process.stdout.write(`Dry run: nothing sent to Discord. Scope: ${args.scope}${guildId ? ` (guild ${guildId})` : ''}\n`);
    return 0;
  }

  const state = readState();
  const sameTarget = state && state.scope === args.scope && state.guildId === (guildId || null) && state.clientId === clientId;
  if (sameTarget && state.hash === hash && !args.force) {
    process.stdout.write('Already registered with this exact definition on this target. Skipping (use --force to resend).\n');
    return 0;
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  const route = args.scope === 'guild' ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  let response;
  try {
    response = await rest.put(route, { body: payload });
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      process.stderr.write(`Discord rejected the registration (code ${error.code}, HTTP ${error.status}): ${error.message}\n`);
      if (error.rawError && error.rawError.errors) {
        process.stderr.write(`Details: ${JSON.stringify(error.rawError.errors).slice(0, 2000)}\n`);
      }
      return 1;
    }
    throw error;
  }
  if (!Array.isArray(response) || response.length !== topLevelCount) {
    process.stderr.write('Discord responded, but the response did not match the submitted definition. Not recording success.\n');
    return 1;
  }

  const registeredAt = new Date().toISOString();
  writeState({
    scope: args.scope,
    guildId: guildId || null,
    clientId,
    hash,
    topLevelCount: response.length,
    subcommandCount,
    registeredAt,
    commands: response.map((c) => ({ name: c.name, id: c.id })),
  });
  process.stdout.write(`Discord confirmed ${response.length} top-level command(s) for ${args.scope} scope at ${registeredAt}.\n`);
  if (args.scope === 'global') {
    process.stdout.write('Global commands can take up to about an hour to appear in every server.\n');
  }
  return 0;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, countLeaves };
