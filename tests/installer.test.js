'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SHELL_FILES = ['install.sh', 'update.sh', 'uninstall.sh', 'deploy/lib.sh'];

test('every shell script parses with bash -n', () => {
  for (const f of SHELL_FILES) {
    const r = spawnSync('bash', ['-n', path.join(ROOT, f)], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${f}: ${r.stderr}`);
  }
});

test('no script pipes a remote download into a shell or asks for GitHub credentials', () => {
  for (const f of SHELL_FILES) {
    const text = read(f);
    assert.doesNotMatch(text, /(curl|wget)[^\n|]*\|\s*(sudo\s+)?(ba|z)?sh/, `${f} pipes a download into a shell`);
    assert.doesNotMatch(text, /(curl|wget)[^\n|]*\|\s*sudo/, `${f} pipes a download into sudo`);
    assert.doesNotMatch(text, /read[^\n]*(password|GITHUB_TOKEN|PAT)/i, `${f} prompts for a credential`);
  }
});

test('the installer verifies the Node.js archive checksum before unpacking it', () => {
  const text = read('deploy/lib.sh');
  assert.match(text, /SHASUMS256\.txt/);
  assert.match(text, /sha256sum -c/);
  assert.ok(text.indexOf('sha256sum -c') < text.indexOf('tar -xJf'), 'checksum must be verified before extraction');
});

test('secret prompts are hidden and the env file is written 0640 root:tanveer-bot', () => {
  const text = read('install.sh');
  assert.match(text, /read -r -s -p "Discord bot token/);
  assert.match(text, /install -m 0640 -o root -g "\$SERVICE_USER"/);
});

test('install.sh refuses to run without root and prints the sudo hint', () => {
  if (process.getuid && process.getuid() === 0) return; // only meaningful for non-root runs
  const r = spawnSync('bash', [path.join(ROOT, 'install.sh')], { encoding: 'utf8', input: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /sudo/);
});

test('install.sh --help exits 0 without changing anything', () => {
  const r = spawnSync('bash', [path.join(ROOT, 'install.sh'), '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Tanveer Discord Bot installer/);
});

test('uninstall needs root and an explicit confirmation word', () => {
  if (process.getuid && process.getuid() === 0) return;
  const r = spawnSync('bash', [path.join(ROOT, 'uninstall.sh')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /root|sudo/);
});

test('the systemd unit renders with no leftover placeholders and has the hardening the docs promise', () => {
  const template = read('deploy/tanveer-discord-bot.service.template');
  const rendered = template
    .replace(/@APP_DIR@/g, '/opt/tanveer-discord-bot')
    .replace(/@DATA_DIR@/g, '/var/lib/tanveer-discord-bot')
    .replace(/@ENV_FILE@/g, '/etc/tanveer-discord-bot/bot.env')
    .replace(/@NODE_BIN@/g, '/opt/tanveer-node/current/bin/node')
    .replace(/@SERVICE_USER@/g, 'tanveer-bot');
  assert.doesNotMatch(rendered, /@[A-Z_]+@/);
  for (const line of [
    'User=tanveer-bot', 'NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=yes',
    'RestartPreventExitStatus=78', 'CapabilityBoundingSet=', 'Restart=on-failure', 'UMask=0077',
    'EnvironmentFile=/etc/tanveer-discord-bot/bot.env',
  ]) {
    assert.ok(rendered.includes(line), `unit is missing: ${line}`);
  }
  assert.doesNotMatch(rendered, /User=root/);
});

test('the sed rendering in deploy/lib.sh uses the same placeholder names as the template', () => {
  const lib = read('deploy/lib.sh');
  const template = read('deploy/tanveer-discord-bot.service.template');
  for (const placeholder of template.match(/@[A-Z_]+@/g)) {
    assert.ok(lib.includes(placeholder), `lib.sh does not render ${placeholder}`);
  }
});

test('.env.example documents every variable the config reads and contains no real secret', () => {
  const example = read('.env.example');
  const { parseConfig } = require('../src/config');
  for (const key of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'OWNER_IDS', 'DATABASE_PATH', 'BACKUP_DIR', 'LOG_LEVEL']) {
    assert.match(example, new RegExp(`^${key}=`, 'm'));
  }
  assert.match(example, /^DISCORD_TOKEN=$/m, 'token must be blank in the example');
  assert.match(example, /OWNER_IDS=1131248987173814336/);
  assert.ok(parseConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:' }).ownerIds.length >= 1);
});
