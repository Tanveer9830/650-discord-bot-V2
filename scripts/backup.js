#!/usr/bin/env node
'use strict';

// Creates a consistent, integrity-checked copy of the SQLite database (VACUUM INTO works while the bot runs).
const fs = require('node:fs');
const path = require('node:path');
const { loadDotEnv, parseConfig } = require('../src/config');
const { openDatabase } = require('../src/database/connection');
const { DatabaseSync } = require('node:sqlite');

loadDotEnv();
const config = parseConfig(process.env);
const dir = path.resolve(config.backupDir);
fs.mkdirSync(dir, { recursive: true, mode: 0o750 });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `bot-${stamp}.sqlite`);

const db = openDatabase(config.database.path);
try {
  db.prepare('VACUUM INTO ?').run(target);
} finally {
  db.close();
}
try {
  fs.chmodSync(target, 0o600);
} catch {
  // Non-POSIX filesystems may not support chmod; the directory permissions still apply.
}
const check = new DatabaseSync(target);
const result = check.prepare('PRAGMA integrity_check').get();
check.close();
if (result.integrity_check !== 'ok') {
  fs.unlinkSync(target);
  process.stderr.write('Backup failed integrity check and was removed.\n');
  process.exitCode = 1;
} else {
  process.stdout.write(`Backup written and verified: ${target}\n`);
}
