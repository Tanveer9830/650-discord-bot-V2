'use strict';

/**
 * Smoke test over EVERY functional action in the registry.
 * Each action is dispatched as a global owner with Administrator in a fake server, using generic option values.
 * Expected user errors (UserError) are fine. Anything the dispatcher reports as an UNHANDLED error means
 * a broken repo call, a wrong signature, or a missing method, and fails the test for that action.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, OWNER, fakeGuild, fakeMember, fakeRole, fakeInteraction } = require('./helpers');
const { createLogger } = require('../src/utils/logger');
const { buildRegistry } = require('../src/commands');

const ADMIN_USER = { id: OWNER, username: 'owner', tag: 'owner#0001', bot: false };
const TARGET_ID = '100000000000000013';

function sampleValue(opt, guild) {
  switch (opt.type) {
    case 'string':
      if (opt.choices && opt.choices.length) return opt.choices[0].value;
      if (opt.name === 'expression') return '1 + 1';
      if (opt.name === 'color') return '#3B82F6';
      if (opt.name === 'kind') return 'text';
      return 'sample';
    case 'integer':
    case 'number':
      // Use the option's real minimum so the valid path is exercised (Discord enforces these limits too).
      return opt.min ?? 1;
    case 'boolean':
      return true;
    case 'user':
      return { id: TARGET_ID, username: 'target', tag: 'target#0001', bot: false, displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
    case 'role':
      return fakeRole({ id: '400000000000000001', name: 'sample', position: 1, guild });
    case 'channel':
      return { id: '222222222222222222', name: 'general', type: 0, isTextBased: () => true, isDMBased: () => false, send: async () => ({ id: 'msg' }), messages: { fetch: async () => new Map() }, bulkDelete: async () => new Map(), permissionOverwrites: { edit: async () => null }, setRateLimitPerUser: async () => null, setTopic: async () => null, edit: async () => null };
    default:
      return null;
  }
}

function buildOptions(action, guild) {
  const values = {};
  for (const opt of action.options || []) values[opt.name] = sampleValue(opt, guild);
  return values;
}

const registry = buildRegistry();
const fs = require('node:fs');
const path = require('node:path');
// Actions that completed without an unhandled error. Written for `npm run inventory` (data/test-coverage-smoke.json).
const smokeOk = new Set();
test.after(() => {
  const file = path.resolve(__dirname, '..', 'data', 'test-coverage-smoke.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ generatedAt: new Date().toISOString(), actions: [...smokeOk].sort() }, null, 2)}\n`);
});

function parseKey(key) {
  const parts = key.split('.');
  if (parts.length === 1) return { commandName: parts[0] };
  if (parts.length === 2) return { commandName: parts[0], sub: parts[1] };
  return { commandName: parts[0], group: parts[1], sub: parts[2] };
}

for (const [key, action] of registry.actions) {
  test(`smoke: /${key.replace(/\./g, ' ')} runs without an unhandled error`, async () => {
    const errors = [];
    const logger = createLogger({ level: 'error', stream: null, errorStream: null, sink: (rec) => errors.push(rec) });
    const { app, dispatcher, repos } = makeApp({ logger });
    const admin = fakeMember({ id: OWNER, permissions: ['Administrator'], highestPosition: 100, username: 'owner' });
    const target = fakeMember({ id: TARGET_ID, permissions: [], highestPosition: 1, username: 'target' });
    const guild = fakeGuild({ members: [admin, target] });
    const sampleRole = fakeRole({ id: '400000000000000001', name: 'sample', position: 1, guild });
    sampleRole.delete = async () => sampleRole;
    guild.roles.cache.set(sampleRole.id, sampleRole);
    guild.roles.create = async (data) => ({ ...fakeRole({ id: '400000000000000002', name: data.name, position: 1, guild }), delete: async () => null });
    guild.fetchOwner = async () => admin;
    const interaction = fakeInteraction({
      guild,
      user: ADMIN_USER,
      ...parseKey(key),
      options: buildOptions(action, guild),
    });
    await dispatcher.handle(interaction);
    const unhandled = errors.filter((e) => e.msg === 'Unhandled command error' && e.action === key);
    assert.deepEqual(unhandled.map((u) => u.data.reason), [], `${key} raised: ${unhandled.map((u) => u.data.reason).join('; ')}`);
    assert.ok(interaction.responses.length >= 1, `${key} produced no response`);
    assert.ok(repos, 'repos available');
    smokeOk.add(key);
    app.close();
  });
}
