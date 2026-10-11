#!/usr/bin/env node
'use strict';

// Local diagnostics. Never prints secret values. Exit code 0 only when every required check passes.
const fs = require('node:fs');
const path = require('node:path');
const { loadDotEnv, parseConfig, describeConfig } = require('../src/config');
const { renderCompactBanner, detectTerminal } = require('../src/branding');
const { buildRegistry } = require('../src/commands');
const { openDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrations');

const ROOT = path.resolve(__dirname, '..');
const results = [];
const check = (name, ok, detail = '', { warnOnly = false } = {}) => results.push({ name, ok, detail, warnOnly });

async function main() {
  const term = detectTerminal();
  process.stdout.write(`${renderCompactBanner({ color: term.color, width: term.width })}\n\n`);

  const major = Number(process.versions.node.split('.')[0]);
  const minor = Number(process.versions.node.split('.')[1]);
  check('Node.js >= 22.13', major > 22 || (major === 22 && minor >= 13), process.version);

  loadDotEnv();
  let config = null;
  try {
    config = parseConfig(process.env);
    check('Configuration valid', true, JSON.stringify(describeConfig(config)));
  } catch (error) {
    check('Configuration valid', false, error.issues ? error.issues.join('; ') : error.message);
  }

  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const mode = fs.statSync(envPath).mode & 0o777;
    check('.env not readable by other users', (mode & 0o077) === 0, `mode ${mode.toString(8)}`, { warnOnly: true });
  }

  if (config) {
    check('Discord token present (value not shown)', Boolean(config.discord.token), '', { warnOnly: true });
    check('Discord client ID present', Boolean(config.discord.clientId), '', { warnOnly: true });
    try {
      const db = openDatabase(config.database.path);
      const migration = migrate(db);
      check('Database opens and migrations are current', true, `${migration.current.length} migration(s) on record`);
      const quick = db.prepare('PRAGMA quick_check').get();
      check('Database quick_check', quick.quick_check === 'ok', String(quick.quick_check));
      db.close();
    } catch (error) {
      check('Database opens and migrations are current', false, error.message);
    }
  }

  try {
    const registry = buildRegistry();
    check('Command registry valid', true, `${registry.modules.length} top-level, ${registry.actions.size} actions`);
  } catch (error) {
    check('Command registry valid', false, error.message.split('\n')[0]);
  }

  if (process.argv.includes('--network')) {
    try {
      const res = await fetch('https://discord.com/api/v10/gateway', { signal: AbortSignal.timeout(8000) });
      check('Discord API reachable', res.ok, `HTTP ${res.status}`);
    } catch (error) {
      check('Discord API reachable', false, error.name);
    }
  }

  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? 'PASS' : r.warnOnly ? 'WARN' : 'FAIL';
    if (!r.ok && !r.warnOnly) failed += 1;
    process.stdout.write(`[${mark}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}\n`);
  }
  process.stdout.write(failed ? `\n${failed} required check(s) failed.\n` : '\nAll required checks passed.\n');
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  process.stderr.write(`Doctor crashed: ${error.message}\n`);
  process.exitCode = 1;
});
