#!/usr/bin/env node
'use strict';

// Generates docs/command-inventory.json (machine-readable) and docs/COMMANDS.md (human-readable).
// Counts are derived from the code and the tests on disk. "registered" is read from data/command-registration.json,
// which is written ONLY after Discord confirms a registration; it is never assumed.
const fs = require('node:fs');
const path = require('node:path');
const { buildRegistry } = require('../src/commands');

const ROOT = path.resolve(__dirname, '..');

const REG_FILE = path.join(ROOT, 'data', 'command-registration.json');

function build() {
  const registry = buildRegistry();
  const described = registry.describe();
  const modules = registry.modules;
  const topLevel = modules.length;
  const groups = modules.reduce((n, m) => n + Object.keys(m.groups).length, 0);
  const leaves = described.length;
  const withHandler = described.filter((a) => a.hasHandler).length;
  // Coverage files are written by the test run: behaviour = specific assertions; smoke = dispatched without an unhandled error.
  const readKeys = (name) => {
    const file = path.join(ROOT, 'data', name);
    if (!fs.existsSync(file)) return new Set();
    try {
      return new Set(JSON.parse(fs.readFileSync(file, 'utf8')).actions || []);
    } catch {
      return new Set();
    }
  };
  const behaviour = readKeys('test-coverage-behaviour.json');
  const smoke = readKeys('test-coverage-smoke.json');
  const tested = described.filter((a) => behaviour.has(a.key)).map((a) => a.key);
  const smokeTested = described.filter((a) => smoke.has(a.key)).map((a) => a.key);
  const adminCats = new Set(['administration', 'moderation', 'security']);
  const adminActions = described.filter((a) => adminCats.has(a.category)).length;

  let registered = null;
  if (fs.existsSync(REG_FILE)) {
    try {
      registered = JSON.parse(fs.readFileSync(REG_FILE, 'utf8'));
    } catch {
      registered = null;
    }
  }
  const registeredTop = registered ? registered.topLevelCount : 0;
  const registeredSub = registered ? registered.subcommandCount : 0;
  const byCategory = described.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1;
    return acc;
  }, {});

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      topLevelCommands: topLevel,
      subcommandGroups: groups,
      subcommands: leaves - modules.filter((m) => m.standalone).length,
      functionalActions: withHandler,
      administrationAndModerationActions: adminActions,
      behaviourTestedActions: tested.length,
      smokeTestedActions: smokeTested.length,
      registeredTopLevelCommands: registeredTop,
      registeredSubcommands: registeredSub,
    },
    registration: registered
      ? { scope: registered.scope, registeredAt: registered.registeredAt, discordConfirmed: true }
      : { discordConfirmed: false, note: 'No registration has been confirmed by Discord from this checkout.' },
    byCategory,
    actions: described.map((a) => ({
      ...a,
      tested: tested.includes(a.key),
      smokeTested: smokeTested.includes(a.key),
    })),
  };
}

function markdown(inv) {
  const lines = [
    '# Command inventory',
    '',
    `Generated ${inv.generatedAt} by \`npm run inventory\`. Do not edit by hand.`,
    '',
    '## Counts (verified from code and tests)',
    '',
    `| Measure | Count |`,
    `| --- | ---: |`,
    `| Top-level slash commands | ${inv.counts.topLevelCommands} |`,
    `| Subcommand groups | ${inv.counts.subcommandGroups} |`,
    `| Subcommands (leaf actions, excluding standalone commands) | ${inv.counts.subcommands} |`,
    `| Functional actions with handlers | ${inv.counts.functionalActions} |`,
    `| Administration + moderation + security actions | ${inv.counts.administrationAndModerationActions} |`,
    `| Actions with behavioural tests (specific assertions) | ${inv.counts.behaviourTestedActions} |`,
    `| Actions dispatched by the smoke test without an unhandled error | ${inv.counts.smokeTestedActions} |`,
    `| Top-level commands confirmed registered with Discord | ${inv.counts.registeredTopLevelCommands} |`,
    `| Subcommands confirmed registered with Discord | ${inv.counts.registeredSubcommands} |`,
    '',
    `Registration: ${inv.registration.discordConfirmed ? `confirmed (${inv.registration.scope}) at ${inv.registration.registeredAt}` : 'NOT confirmed — no successful Discord registration recorded'}`,
    '',
    '## Actions',
    '',
    '| Action | Category | Access | Server-only | Behavioural test | Smoke test |',
    '| --- | --- | --- | --- | --- | --- |',
    ...inv.actions.map((a) => `| \`/${a.key.replace(/\./g, ' ')}\` | ${a.category} | ${a.access} | ${a.guildOnly ? 'yes' : 'no'} | ${a.tested ? 'yes' : 'no'} | ${a.smokeTested ? 'yes' : 'no'} |`),
    '',
  ];
  return lines.join('\n');
}

if (require.main === module) {
  const inv = build();
  fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'command-inventory.json'), `${JSON.stringify(inv, null, 2)}\n`);
  fs.writeFileSync(path.join(ROOT, 'docs', 'COMMANDS.md'), markdown(inv));
  process.stdout.write(`${JSON.stringify(inv.counts, null, 2)}\n`);
  process.stdout.write('Wrote docs/command-inventory.json and docs/COMMANDS.md\n');
}

module.exports = { build, markdown };
