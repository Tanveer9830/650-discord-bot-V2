'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tdb-test-'));
const baseEnv = { PATH: process.env.PATH, HOME: TMP, NODE_ENV: 'test', LOG_LEVEL: 'silent', DATABASE_PATH: path.join(TMP, 'bot.sqlite') };

function run(script, args = [], env = {}) {
  return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, ...args], {
    cwd: ROOT, env: { ...baseEnv, ...env }, encoding: 'utf8', timeout: 60000,
  });
}

test('--check validates config, migrations, and the registry without logging in', () => {
  const r = run('src/index.js', ['--check'], { DISCORD_TOKEN: '', OWNER_IDS: '' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Configuration OK|check passed|ok/i);
});

test('a missing token is a configuration error (exit 78, EX_CONFIG) with no secret echoed', () => {
  const r = run('src/index.js', [], { DISCORD_TOKEN: '' });
  assert.equal(r.status, 78);
  assert.match(r.stderr + r.stdout, /DISCORD_TOKEN/);
});

test('a malformed token and malformed owner IDs are rejected by name only', () => {
  const secret = 'NOT.A.REAL.TOKEN.SECRETVALUE123';
  const r = run('src/index.js', ['--check'], { DISCORD_TOKEN: secret, OWNER_IDS: 'abc' });
  assert.equal(r.status, 78);
  assert.doesNotMatch(r.stdout + r.stderr, /SECRETVALUE123/, 'the token value must never appear in output');
  assert.match(r.stdout + r.stderr, /DISCORD_TOKEN|OWNER_IDS/);
});

test('the default owner from the brief is applied when OWNER_IDS is unset', () => {
  const r = run('src/index.js', ['--check'], { DISCORD_TOKEN: '', OWNER_IDS: '' });
  assert.doesNotMatch(r.stdout + r.stderr, /1131248987173814336/, 'owner IDs are not printed');
  assert.match(r.stdout + r.stderr, /usingDefaultOwner|default owner/i);
});

test('register-commands dry run builds and summarises the payload without network access', () => {
  const r = run('scripts/register-commands.js', ['--scope', 'guild', '--dry-run', '--guild', '123456789012345678']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Dry run: nothing sent to Discord/);
  const { buildRegistry } = require('../src/commands');
  const expected = buildRegistry().payload().length;
  assert.match(r.stdout, new RegExp(`${expected} top-level commands`));
});

test('register-commands refuses global scope without credentials instead of guessing', () => {
  const r = run('scripts/register-commands.js', ['--scope', 'global'], { DISCORD_TOKEN: '', DISCORD_CLIENT_ID: '' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /DISCORD_CLIENT_ID|DISCORD_TOKEN/);
});

test('doctor passes local checks with a fresh database and reports missing credentials as warnings', () => {
  const r = run('scripts/doctor.js', [], { DISCORD_TOKEN: '', DISCORD_CLIENT_ID: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\[PASS\] Command registry valid/);
  assert.match(r.stdout, /\[WARN\] Discord token present/);
});

test('migrate script is idempotent', () => {
  const first = run('scripts/migrate.js', []);
  const second = run('scripts/migrate.js', []);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /none \(already up to date\)/);
});

test('every JavaScript file in the project parses', () => {
  const r = run('scripts/check-syntax.js', []);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test.after(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
});
