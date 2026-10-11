#!/usr/bin/env node
'use strict';

// Syntax-checks every JavaScript file in the project using the Node.js parser (no external linter needed).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'data', 'coverage']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    process.stderr.write(`SYNTAX ERROR: ${path.relative(ROOT, file)}\n${result.stderr}\n`);
  }
}
process.stdout.write(`Checked ${files.length} JavaScript files; ${failures} with syntax errors.\n`);
process.exitCode = failures ? 1 : 0;
