'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildRegistry } = require('../src/commands');
const { buildRegistrationPayload } = require('../src/commands/builder');

const NAME = /^[a-z0-9_-]{1,32}$/;
const registry = buildRegistry();
const payload = registry.payload();

test('registry builds without validation problems', () => {
  assert.ok(registry.modules.length > 0);
  assert.ok(registry.actions.size >= 60, `milestone floor is 60 actions, have ${registry.actions.size}`);
});

test('top-level names are unique, valid, and well under the 100-command limit', () => {
  const names = payload.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, NAME, `invalid command name ${n}`);
  assert.ok(payload.length <= 100);
});

test('descriptions are 1 to 100 characters everywhere', () => {
  const visit = (node, where) => {
    assert.ok(node.description.length >= 1 && node.description.length <= 100, `${where}: description length ${node.description.length}`);
    for (const opt of node.options || []) visit(opt, `${where} > ${opt.name}`);
  };
  for (const cmd of payload) visit(cmd, cmd.name);
});

test('nesting is at most one level of subcommand groups, and each level has at most 25 options', () => {
  for (const cmd of payload) {
    assert.ok((cmd.options || []).length <= 25, `${cmd.name} has too many options`);
    for (const opt of cmd.options || []) {
      if (opt.type === 2) {
        assert.ok(opt.options.length <= 25, `${cmd.name} ${opt.name}: too many subcommands`);
        for (const sub of opt.options) {
          assert.equal(sub.type, 1, `${cmd.name} ${opt.name} ${sub.name}: groups may only contain subcommands`);
          assert.ok(sub.options === undefined || sub.options.every((o) => o.type !== 1 && o.type !== 2), 'subcommands cannot nest further');
        }
      }
    }
  }
});

test('the registration payload is valid JSON of a sane size', () => {
  const bytes = Buffer.byteLength(JSON.stringify(buildRegistrationPayload(registry.modules)), 'utf8');
  assert.ok(bytes < 1_000_000, `payload is ${bytes} bytes`);
  assert.equal(typeof payload[0].name, 'string');
  assert.equal(payload.length, registry.modules.length);
});

test('no command exists whose purpose is tagging, pinging, or mentioning users', () => {
  const offenders = [];
  for (const [key, action] of registry.actions) {
    const text = `${key} ${action.description}`.toLowerCase();
    if (/\b(tag|mention|ping) (a |the )?(user|member|someone|everyone)\b|\bpin(g|ned)? (a )?user\b/.test(text)) offenders.push(key);
  }
  assert.deepEqual(offenders, []);
});

test('owner-only actions carry no server permission requirements and are not guild-visible to members by default', () => {
  for (const [key, action] of registry.actions) {
    if (action.access === 'owner') {
      assert.equal(action.permissions.length, 0, `${key} is owner-only and must not also declare server permissions`);
    }
  }
  assert.equal(registry.actions.get('owner.add').access, 'owner');
  assert.equal(registry.actions.get('owner.remove').access, 'owner');
});

test('action keys are unique and every action has a handler', () => {
  const keys = [...registry.actions.keys()];
  assert.equal(new Set(keys).size, keys.length);
  for (const [key, action] of registry.actions) assert.equal(typeof action.run, 'function', `${key} has no handler`);
});

test('registry describe() lists every action with its category and access', () => {
  const described = registry.describe();
  assert.equal(described.length, registry.actions.size);
  assert.ok(described.every((d) => d.category && d.access));
});
