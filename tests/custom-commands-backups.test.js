'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, OWNER } = require('./helpers');
const { validateDefinition, render } = require('../src/services/customCommands');
const { buildSnapshot, restoreSnapshot, parseSnapshot, MAX_PAYLOAD_BYTES } = require('../src/services/backups');

const G = '123456789012345678';
const G2 = '123456789012345999';

test('custom command definitions accept safe templates only', () => {
  const ok = validateDefinition({ name: 'Welcome', kind: 'text', body: 'Hello {member} from {server}' }, { builtinNames: ['ping'], existingNames: [] });
  assert.equal(ok.name, 'welcome');
  assert.equal(ok.minPermission, 'everyone');
  assert.throws(() => validateDefinition({ name: 'ping', kind: 'text', body: 'x' }, { builtinNames: ['ping'] }), /built-in/);
  assert.throws(() => validateDefinition({ name: 'a', kind: 'text', body: 'x' }), /2 to 32/);
  assert.throws(() => validateDefinition({ name: 'ok', kind: 'script', body: 'x' }), /text or embed/);
  assert.throws(() => validateDefinition({ name: 'ok', kind: 'text', body: 'hi @everyone' }), /mentions/);
  assert.throws(() => validateDefinition({ name: 'ok', kind: 'text', body: 'hi <@123456789012345678>' }), /mentions/);
  assert.throws(() => validateDefinition({ name: 'ok', kind: 'text', body: '{process}' }), /Unknown placeholder/);
  assert.throws(() => validateDefinition({ name: 'ok', kind: 'embed', body: 'x' }), /title/);
  assert.throws(() => validateDefinition({ name: 'ok', kind: 'text', body: 'x', minPermission: 'administrator' }), /everyone/);
  assert.throws(() => validateDefinition({ name: 'dup', kind: 'text', body: 'x' }, { existingNames: ['dup'] }), /already exists/);
});

test('rendering substitutes sanitized values and never executes anything', () => {
  const def = validateDefinition({ name: 'hi', kind: 'text', body: 'Hi {member}, welcome to {server} ({members})' });
  const out = render(def, { server: 'Cool @everyone Server', member: 'bob', members: 42 });
  assert.match(out.content, /Hi bob, welcome to Cool @\u200beveryone Server \(42\)/);
  const injected = render(validateDefinition({ name: 'xy', kind: 'text', body: '{member}' }), { member: '`'.repeat(10) + 'x', server: 's', members: 1 });
  assert.doesNotMatch(injected.content, /`{3}/);
});

test('backups capture settings and restore them, scoped to the same guild', () => {
  const { repos, app } = makeApp();
  repos.automod.update(G, { enabled: 1, block_links: 1 });
  repos.automod.addWord(G, 'forbidden', OWNER);
  repos.blocklist.add(G, 'evil.example', OWNER);
  repos.whitelist.add({ guildId: G, kind: 'trusted_integration', targetType: 'role', targetId: '400000000000000001', addedBy: OWNER });
  const snap = buildSnapshot(repos, G);
  assert.equal(snap.version, 1);
  assert.doesNotMatch(JSON.stringify(snap), /balance|transaction/i, 'no user economy data is captured');

  // Change the live config, then restore.
  repos.automod.removeWord(G, 'forbidden');
  repos.blocklist.remove(G, 'evil.example');
  const result = restoreSnapshot(repos, G, JSON.parse(JSON.stringify(snap)), { actorId: OWNER });
  assert.equal(result.restored, true);
  assert.deepEqual(repos.automod.words(G), ['forbidden']);
  assert.deepEqual(repos.blocklist.list(G), ['evil.example']);
  assert.throws(() => restoreSnapshot(repos, G2, snap, { actorId: OWNER }), /different server/);
  app.close();
});

test('damaged or tampered backups are rejected before anything is written', () => {
  const { repos, app } = makeApp();
  repos.automod.addWord(G, 'keep', OWNER);
  assert.throws(() => parseSnapshot({ version: 2 }), /damaged|incompatible/);
  const bad = { version: 1, guildId: G, createdAt: 'x', settings: {}, automod: { enabled: 9 }, automodWords: [], antiraid: {}, whitelist: [], blocklist: [] };
  assert.throws(() => restoreSnapshot(repos, G, bad, { actorId: OWNER }), /damaged/);
  assert.deepEqual(repos.automod.words(G), ['keep'], 'nothing changed after a rejected restore');
  assert.ok(MAX_PAYLOAD_BYTES > 0);
  app.close();
});
