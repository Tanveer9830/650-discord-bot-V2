'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { makeApp, OWNER, fakeGuild, fakeMember, fakeInteraction, lastResponse } = require('./helpers');

// Actions with behavioural assertions in this file are recorded in data/test-coverage-behaviour.json (read by `npm run inventory`).
const exercised = new Set();
const COVERAGE_FILE = path.resolve(__dirname, '..', 'data', 'test-coverage-behaviour.json');
test.after(() => {
  fs.mkdirSync(path.dirname(COVERAGE_FILE), { recursive: true });
  fs.writeFileSync(COVERAGE_FILE, `${JSON.stringify({ generatedAt: new Date().toISOString(), actions: [...exercised].sort() }, null, 2)}\n`);
});
function keyOf(opts) {
  if (opts.customId) return null;
  return [opts.commandName, opts.group, opts.sub].filter(Boolean).join('.');
}

const ADMIN = '100000000000000010';
const MOD = '100000000000000011';
const MEMBER = '100000000000000012';
const TARGET = '100000000000000013';

function userObj(id, username = `user${id.slice(-3)}`) {
  return { id, username, tag: `${username}#0001`, bot: false };
}

function setup() {
  const ctx = makeApp();
  const admin = fakeMember({ id: ADMIN, permissions: ['Administrator'], highestPosition: 50, username: 'admin' });
  const mod = fakeMember({ id: MOD, permissions: ['KickMembers', 'ManageGuild', 'ManageMessages', 'ModerateMembers'], highestPosition: 20, username: 'mod' });
  const member = fakeMember({ id: MEMBER, permissions: [], highestPosition: 1, username: 'member' });
  const target = fakeMember({ id: TARGET, permissions: [], highestPosition: 1, username: 'target' });
  const guild = fakeGuild({ members: [admin, mod, member, target] });
  const run = async (opts) => {
    const interaction = fakeInteraction({ guild, ...opts });
    const key = keyOf(opts);
    if (key) exercised.add(key);
    await ctx.dispatcher.handle(interaction);
    return interaction;
  };
  return { ...ctx, guild, run, admin, mod, member, target };
}

test('/about answers with the exact creator attribution and no mentions', async () => {
  const { run, app } = setup();
  const i = await run({ commandName: 'about', user: userObj(MEMBER) });
  const text = JSON.stringify(lastResponse(i).payload);
  assert.match(text, /Made by Tanveer/);
  assert.match(text, /Discord: tanveer5637/);
  assert.doesNotMatch(text, /tanvir/i);
  assert.deepEqual(lastResponse(i).payload.allowedMentions, { parse: [] });
  app.close();
});

test('/owner add is denied for non-owners and the denial is audited', async () => {
  const { run, app, repos } = setup();
  const i = await run({ commandName: 'owner', sub: 'add', options: { user: userObj(TARGET) }, user: userObj(ADMIN) });
  assert.match(JSON.stringify(lastResponse(i).payload), /restricted to the bot/);
  assert.equal(repos.owners.has(TARGET), false);
  const audit = repos.audit.recent({ limit: 10 });
  assert.ok(audit.some((a) => a.action === 'command.denied.owner' && a.actor_id === ADMIN), 'denial recorded in audit log');
  app.close();
});

test('owner ownership change needs a confirm button clicked by the same owner', async () => {
  const { run, app, repos } = setup();
  const proposed = await run({ commandName: 'owner', sub: 'add', options: { user: userObj(TARGET) }, user: userObj(OWNER) });
  const confirmId = lastResponse(proposed).payload.components[0].components[0].data.custom_id;
  assert.match(confirmId, /^owner:add:/);
  assert.equal(repos.owners.has(TARGET), false, 'nothing changes until confirmed');

  // A second, genuinely authorised owner must still be refused: the confirmation belongs to its creator.
  const SECOND_OWNER = '333333333333333333';
  repos.owners.add(SECOND_OWNER, OWNER);
  const imposter = await run({ customId: confirmId, user: userObj(SECOND_OWNER) });
  assert.match(JSON.stringify(lastResponse(imposter).payload), /Only the person who started/);
  assert.equal(repos.owners.has(TARGET), false);

  await run({ customId: confirmId, user: userObj(OWNER) });
  assert.equal(repos.owners.has(TARGET), true, 'the owner confirmation applies the change');
  app.close();
});

test('moderation kick enforces the invoker\u2019s server permission', async () => {
  const { run, app } = setup();
  const denied = await run({ commandName: 'moderation', sub: 'kick', options: { user: userObj(TARGET), reason: 'test' }, user: userObj(MEMBER) });
  assert.match(JSON.stringify(lastResponse(denied).payload), /server permissions/);
  const allowed = await run({ commandName: 'moderation', sub: 'kick', options: { user: userObj(TARGET), reason: 'test' }, user: userObj(MOD) });
  assert.doesNotMatch(JSON.stringify(lastResponse(allowed).payload), /server permissions/);
  app.close();
});

test('global owners do NOT bypass server permissions', async () => {
  const { run, app, guild } = setup();
  const ownerMember = fakeMember({ id: OWNER, permissions: [], highestPosition: 1, username: 'owner' });
  guild.members.cache.set(OWNER, ownerMember);
  const i = await run({ commandName: 'moderation', sub: 'kick', options: { user: userObj(TARGET) }, user: userObj(OWNER) });
  assert.match(JSON.stringify(lastResponse(i).payload), /server permissions/);
  app.close();
});

test('whitelist management requires Administrator, not merely ManageGuild', async () => {
  const { run, app, repos } = setup();
  const denied = await run({ commandName: 'security', group: 'whitelist', sub: 'add', options: { kind: 'security_exemption', user: userObj(TARGET) }, user: userObj(MOD) });
  assert.match(JSON.stringify(lastResponse(denied).payload), /server permissions/);
  assert.equal(repos.whitelist.list(lastGuildId()).length, 0);
  const ok = await run({ commandName: 'security', group: 'whitelist', sub: 'add', options: { kind: 'security_exemption', user: userObj(TARGET) }, user: userObj(ADMIN) });
  assert.doesNotMatch(JSON.stringify(lastResponse(ok).payload), /server permissions/);
  assert.equal(repos.whitelist.list(lastGuildId()).length, 1);
  app.close();
  function lastGuildId() { return '123456789012345678'; }
});

test('the same interaction ID is processed only once', async () => {
  const { run, app } = setup();
  const first = await run({ commandName: 'utility', sub: 'calc', options: { expression: '2+2' }, user: userObj(MEMBER) });
  const replay = fakeInteraction({ commandName: 'utility', sub: 'calc', options: { expression: '2+2' }, user: userObj(MEMBER), guild: first.guild });
  replay.id = first.id;
  await app.dispatcher.handle(replay);
  assert.equal(replay.responses.length, 0, 'duplicate delivery produces no response');
  app.close();
});

test('/calc returns the result and rejects code-like input', async () => {
  const { run, app } = setup();
  const ok = await run({ commandName: 'utility', sub: 'calc', options: { expression: '(12 + 8) * 3 ^ 2' }, user: userObj(MEMBER) });
  assert.match(JSON.stringify(lastResponse(ok).payload), /180/);
  const bad = await run({ commandName: 'utility', sub: 'calc', options: { expression: 'process.exit()' }, user: userObj(MEMBER) });
  assert.doesNotMatch(JSON.stringify(lastResponse(bad).payload), /180/);
  app.close();
});

test('/economy daily credits a server member and records a ledger entry', async () => {
  const { run, app, repos } = setup();
  const i = await run({ commandName: 'economy', sub: 'daily', user: userObj(MEMBER) });
  assert.doesNotMatch(JSON.stringify(lastResponse(i).payload), /wait|cooldown/i);
  assert.ok(repos.economy.account('123456789012345678', MEMBER).balance > 0);
  assert.equal(repos.economy.history('123456789012345678', MEMBER).length, 1);
  app.close();
});

test('custom commands: owner creates a template, anyone runs it, and mentions never fire', async () => {
  const { run, app } = setup();
  const created = await run({ commandName: 'customcommand', sub: 'create', options: { name: 'greet', kind: 'text', body: 'Hi {member}, welcome to {server}!' }, user: userObj(OWNER) });
  assert.match(JSON.stringify(lastResponse(created).payload), /created/i);
  const denied = await run({ commandName: 'customcommand', sub: 'create', options: { name: 'evil', kind: 'text', body: 'hi' }, user: userObj(MEMBER) });
  assert.match(JSON.stringify(lastResponse(denied).payload), /restricted to the bot/);
  const ran = await run({ commandName: 'customcommand', sub: 'run', options: { name: 'greet' }, user: userObj(MEMBER) });
  const payload = lastResponse(ran).payload;
  assert.match(JSON.stringify(payload), /Hi user012, welcome to Test Server!/);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  app.close();
});

test('backup restore requires a confirmation clicked by the same admin', async () => {
  const { run, app, repos, guild } = setup();
  await run({ commandName: 'backup', sub: 'create', options: { label: 'before' }, user: userObj(ADMIN) });
  const backupId = repos.backups.list('123456789012345678')[0].id;
  const asked = await run({ commandName: 'backup', sub: 'restore', options: { id: backupId }, user: userObj(ADMIN) });
  const confirm = lastResponse(asked).payload.components[0].components[0].data.custom_id;
  assert.match(confirm, /^backup:confirm:/);
  // A second administrator must not be able to confirm the first administrator's restore.
  const ADMIN2 = '100000000000000014';
  guild.members.cache.set(ADMIN2, fakeMember({ id: ADMIN2, permissions: ['Administrator'], highestPosition: 50, username: 'admin2' }));
  const imposter = await run({ customId: confirm, user: userObj(ADMIN2) });
  assert.match(JSON.stringify(lastResponse(imposter).payload), /Only the person who started/);
  const done = await run({ customId: confirm, user: userObj(ADMIN) });
  assert.doesNotMatch(JSON.stringify(lastResponse(done).payload), /Only the person|no longer exists/);
  app.close();
});

test('a mod-only command is hidden from members in the registry metadata', async () => {
  const { app, registry } = { ...setup(), registry: undefined };
  const { buildRegistry } = require('../src/commands');
  const reg = buildRegistry();
  const kick = reg.actions.get('moderation.kick');
  assert.ok(kick.permissions.includes(PermissionFlagsBits.KickMembers));
  assert.ok(registry === undefined);
  app.close();
});
