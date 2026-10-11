'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { testConfig } = require('./helpers');
const { registerCommands, countLeaves } = require('../scripts/register-commands');
const { buildRegistry } = require('../src/commands');

const CLIENT_ID = '123456789012345678';
const GUILD_ID = '987654321098765432';
// A format-valid but fake token, assembled at runtime so no secret-shaped literal is stored in the repository.
const TOKEN = ['MTIzNDU2Nzg5MDEyMzQ1Njc4', 'abcdef', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('.');

function tempState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tanveer-reg-'));
  return path.join(dir, 'command-registration.json');
}

function fakeRest({ putResult = null, getResult = null, putError = null } = {}) {
  const calls = { put: 0, get: 0 };
  const registry = buildRegistry();
  const payload = registry.payload();
  return {
    calls,
    async put(route, { body }) {
      calls.put += 1;
      if (putError) throw putError;
      return putResult || body.map((c, i) => ({ id: String(i + 1), name: c.name }));
    },
    async get() {
      calls.get += 1;
      if (getResult) return getResult;
      return payload.map((c, i) => ({ id: String(i + 1), name: c.name }));
    },
  };
}

function config() {
  return testConfig({ DISCORD_CLIENT_ID: CLIENT_ID, DISCORD_TOKEN: TOKEN, NODE_ENV: 'test' });
}

test('registration is verified by read-back and the state is recorded only after success', async () => {
  const stateFile = tempState();
  const rest = fakeRest();
  const r = await registerCommands({ config: config(), scope: 'guild', guildId: GUILD_ID, stateFile, rest });
  assert.equal(r.status, 'registered');
  assert.equal(r.verified, true);
  assert.equal(rest.calls.put, 1);
  assert.equal(rest.calls.get, 1, 'the commands are read back from Discord');
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(state.verified, true);
  assert.equal(state.commands.length, r.count);
});

test('an unchanged definition on the same target sends no request (idempotent, no restart churn)', async () => {
  const stateFile = tempState();
  await registerCommands({ config: config(), scope: 'guild', guildId: GUILD_ID, stateFile, rest: fakeRest() });
  const rest = fakeRest();
  const r = await registerCommands({ config: config(), scope: 'guild', guildId: GUILD_ID, stateFile, rest });
  assert.equal(r.status, 'unchanged');
  assert.equal(rest.calls.put, 0);
});

test('a read-back mismatch is a failure and is never recorded as success', async () => {
  const stateFile = tempState();
  const rest = fakeRest({ getResult: [{ id: '1', name: 'about' }] });
  const r = await registerCommands({ config: config(), scope: 'guild', guildId: GUILD_ID, stateFile, rest });
  assert.equal(r.status, 'failed');
  assert.equal(r.verified, false);
  assert.equal(fs.existsSync(stateFile), false, 'no success state is written after a failed verification');
});

test('API errors are reported as failures without throwing into the caller', async () => {
  const stateFile = tempState();
  const r = await registerCommands({ config: config(), scope: 'guild', guildId: GUILD_ID, stateFile, rest: fakeRest({ putError: new Error('Missing Access') }) });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /Missing Access/);
  assert.equal(fs.existsSync(stateFile), false);
});

test('guild scope without a valid guild ID and missing credentials are refused before any request', async () => {
  const stateFile = tempState();
  const rest = fakeRest();
  const noGuild = await registerCommands({ config: config(), scope: 'guild', guildId: null, stateFile, rest });
  assert.equal(noGuild.status, 'failed');
  const noToken = await registerCommands({ config: testConfig({ NODE_ENV: 'test' }), scope: 'global', stateFile, rest });
  assert.equal(noToken.status, 'failed');
  assert.match(noToken.error, /DISCORD_CLIENT_ID|DISCORD_TOKEN/);
  assert.equal(rest.calls.put, 0);
});

test('the command library has at least 100 distinct subcommand entries within Discord top-level limits', () => {
  const registry = buildRegistry();
  const topLevel = registry.payload().length;
  const leaves = countLeaves(registry.modules);
  assert.ok(topLevel <= 100, `top-level ${topLevel} must not exceed Discord's 100 global command limit`);
  assert.ok(leaves >= 100, `expected at least 100 subcommand entries, found ${leaves}`);
});
