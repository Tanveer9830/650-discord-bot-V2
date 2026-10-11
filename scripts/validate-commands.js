#!/usr/bin/env node
'use strict';

// Validates the command registry against Discord's structural rules and builds the exact payload
// that would be sent to Discord. Makes NO network calls.
const { buildRegistry } = require('../src/commands');
const { DISCORD_LIMITS } = require('../src/commands/framework');

let registry;
try {
  registry = buildRegistry();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
  return;
}
const payload = registry.payload();
const names = payload.map((c) => c.name);
const dupes = names.filter((n, i) => names.indexOf(n) !== i);
const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
const problems = [];
if (dupes.length) problems.push(`duplicate top-level names: ${dupes.join(', ')}`);
if (payload.length > DISCORD_LIMITS.topLevelCommands) problems.push('too many top-level commands');
if (problems.length) {
  process.stderr.write(`Registry problems:\n- ${problems.join('\n- ')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Registry valid.\n`);
  process.stdout.write(`Top-level commands: ${payload.length} / ${DISCORD_LIMITS.topLevelCommands}\n`);
  process.stdout.write(`Functional actions: ${registry.actions.size}\n`);
  process.stdout.write(`Registration payload: ${bytes} bytes\n`);
}
