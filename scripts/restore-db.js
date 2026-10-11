#!/usr/bin/env node
'use strict';

// Restores a verified backup. Stop the service first. The current database is MOVED aside, never deleted.
//   node scripts/restore-db.js data/backups/bot-....sqlite --yes
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { loadDotEnv, parseConfig } = require('../src/config');

const args = process.argv.slice(2);
const source = args.find((a) => !a.startsWith('--'));
const confirmed = args.includes('--yes');

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

(function main() {
  if (!source) return fail('Usage: node scripts/restore-db.js <backup.sqlite> --yes');
  if (!confirmed) return fail('Refusing to restore without --yes. Stop the bot service first (systemctl stop tanveer-discord-bot).');
  loadDotEnv();
  const config = parseConfig(process.env);
  const src = path.resolve(source);
  if (!fs.existsSync(src)) return fail('Backup file not found.');
  const check = new DatabaseSync(src, { readOnly: true });
  const ok = check.prepare('PRAGMA integrity_check').get().integrity_check === 'ok';
  check.close();
  if (!ok) return fail('Backup failed integrity check. Nothing was changed.');

  const dbPath = path.resolve(config.database.path);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (fs.existsSync(dbPath)) {
    const aside = `${dbPath}.pre-restore-${stamp}`;
    fs.renameSync(dbPath, aside);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(dbPath + suffix)) fs.renameSync(dbPath + suffix, `${aside}${suffix}`);
    }
    process.stdout.write(`Current database moved to ${aside}\n`);
  }
  fs.copyFileSync(src, dbPath);
  fs.chmodSync(dbPath, 0o600);
  process.stdout.write(`Restored ${path.basename(src)} to ${dbPath}. Start the service and check: npm run doctor\n`);
})();
