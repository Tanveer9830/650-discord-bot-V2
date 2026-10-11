#!/usr/bin/env node
'use strict';

/**
 * Register slash commands with Discord.
 *   node scripts/register-commands.js --scope guild            (uses DISCORD_DEV_GUILD_ID; instant)
 *   node scripts/register-commands.js --scope guild --guild ID
 *   node scripts/register-commands.js --scope global           (production; can take up to ~1 hour to propagate)
 * Flags: --dry-run (no network), --force (re-send even if the definition is unchanged).
 *
 * The same registerCommands() function runs automatically when the bot starts (see src/index.js),
 * so a restart never needs a manual registration step. It is idempotent: when the definition hash
 * and target match the stored state, no request is sent.
 *
 * The state file is written ONLY after Discord confirms the registration by reading the commands back.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes, DiscordAPIError } = require('discord.js');
const { loadDotEnv, parseConfig, SNOWFLAKE } = require('../src/config');
const { buildRegistry } = require('../src/commands');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_STATE_FILE = path.join(ROOT, 'data', 'command-registration.json');

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

function readState(stateFile) {
  if (!fs.existsSync(stateFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(stateFile, state) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o750 });
  const tmp = `${stateFile}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o640 });
  fs.renameSync(tmp, stateFile);
}

/**
 * Register the command payload for one scope. Never throws for Discord API errors: returns a
 * status object so the caller (CLI or startup) can report it. Rate limits are retried by discord.js.
 *
 * Returns { status: 'registered' | 'unchanged' | 'dry-run' | 'failed', ... }.
 */
async function registerCommands({
  config, scope, guildId = null, force = false, dryRun = false, stateFile = DEFAULT_STATE_FILE, registry = buildRegistry(), rest = null,
}) {
  const payload = registry.payload();
  const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const topLevelCount = payload.length;
  const subcommandCount = countLeaves(registry.modules);
  const base = { hash, topLevelCount, subcommandCount, scope, guildId: guildId || null };
  if (scope === 'guild' && (!guildId || !SNOWFLAKE.test(guildId))) {
    return { ...base, status: 'failed', error: 'Guild scope needs a valid guild ID (DISCORD_DEV_GUILD_ID or --guild).' };
  }
  const clientId = config.discord.clientId;
  if (!dryRun && !clientId) return { ...base, status: 'failed', error: 'DISCORD_CLIENT_ID is required to register commands.' };
  if (!dryRun && !config.discord.token) return { ...base, status: 'failed', error: 'DISCORD_TOKEN is required to register commands.' };
  if (dryRun) return { ...base, status: 'dry-run' };

  const state = readState(stateFile);
  const sameTarget = state && state.scope === scope && state.guildId === (guildId || null) && state.clientId === clientId;
  if (sameTarget && state.hash === hash && state.verified && !force) {
    return { ...base, status: 'unchanged', registeredAt: state.registeredAt };
  }

  const api = rest || new REST({ version: '10' }).setToken(config.discord.token);
  const route = scope === 'guild' ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId);
  let response;
  try {
    response = await api.put(route, { body: payload });
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      return {
        ...base,
        status: 'failed',
        error: `Discord rejected the registration (code ${error.code}, HTTP ${error.status}): ${error.message}`,
        details: error.rawError && error.rawError.errors ? JSON.stringify(error.rawError.errors).slice(0, 2000) : null,
      };
    }
    return { ...base, status: 'failed', error: `Registration request failed: ${error.message}` };
  }
  if (!Array.isArray(response) || response.length !== topLevelCount) {
    return { ...base, status: 'failed', error: 'Discord responded, but the response did not match the submitted definition. Not recording success.' };
  }

  // Verify through the API: read the commands back and compare names and count.
  let readBack;
  try {
    readBack = await api.get(route);
  } catch (error) {
    return { ...base, status: 'failed', error: `Registration sent, but read-back verification failed: ${error.message}`, verified: false };
  }
  const expectedNames = payload.map((c) => c.name).sort();
  const actualNames = Array.isArray(readBack) ? readBack.map((c) => c.name).sort() : [];
  const verified = JSON.stringify(expectedNames) === JSON.stringify(actualNames);
  if (!verified) {
    return { ...base, status: 'failed', verified: false, error: `Read-back mismatch: expected ${expectedNames.length} names, Discord reports ${actualNames.length}.` };
  }

  const registeredAt = new Date().toISOString();
  writeState(stateFile, {
    scope,
    guildId: guildId || null,
    clientId,
    hash,
    verified: true,
    topLevelCount: response.length,
    subcommandCount,
    registeredAt,
    commands: readBack.map((c) => ({ name: c.name, id: c.id })),
  });
  return { ...base, status: 'registered', verified: true, registeredAt, count: readBack.length };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  loadDotEnv();
  const config = parseConfig(process.env);
  const registry = buildRegistry();
  const guildId = args.scope === 'guild' ? (args.guild || config.discord.devGuildId) : null;
  const probe = await registerCommands({ config, scope: args.scope, guildId, dryRun: true, registry });
  process.stdout.write(`Definition: ${probe.topLevelCount} top-level commands, ${probe.subcommandCount} subcommands/actions, hash ${probe.hash.slice(0, 12)}\n`);
  if (args.dryRun) {
    if (probe.status === 'failed') {
      process.stderr.write(`${probe.error}\n`);
      return 1;
    }
    process.stdout.write(`Dry run: nothing sent to Discord. Scope: ${args.scope}${guildId ? ` (guild ${guildId})` : ''}\n`);
    return 0;
  }
  const result = await registerCommands({ config, scope: args.scope, guildId, force: args.force, registry });
  if (result.status === 'failed') {
    process.stderr.write(`${result.error}\n`);
    if (result.details) process.stderr.write(`Details: ${result.details}\n`);
    return 1;
  }
  if (result.status === 'unchanged') {
    process.stdout.write('Already registered with this exact definition on this target. Skipping (use --force to resend).\n');
    return 0;
  }
  process.stdout.write(`Discord confirmed and read back ${result.count} top-level command(s) for ${args.scope} scope at ${result.registeredAt}.\n`);
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

module.exports = { parseArgs, countLeaves, registerCommands, DEFAULT_STATE_FILE };
