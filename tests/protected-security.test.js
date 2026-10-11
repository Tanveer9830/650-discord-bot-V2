'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, OWNER, fakeMember, fakeGuild, fakeClock, perms, testConfig, silentLogger } = require('./helpers');
const { migrate, MIGRATIONS } = require('../src/database/migrations');
const { openDatabase } = require('../src/database/connection');
const { createProtectedAuth } = require('../src/security/protectedAuth');
const { evaluateProtectedAction, findExecutor } = require('../src/events/antinuke');
const { createRepos } = require('../src/database/repos');

const GUILD_A = '111111111111111111';
const GUILD_B = '222222222222222222';
const ADMIN = '333333333333333333';
const USER = '444444444444444444';
const BOT_ID = '555555555555555555';
const ACTOR = '666666666666666666';

test('migration 002 upgrades an existing 001 database without touching its data', () => {
  const db = openDatabase(':memory:');
  migrate(db, [MIGRATIONS[0]]);
  db.prepare("INSERT INTO guild_settings (guild_id, log_channel_id) VALUES (?, ?)").run(GUILD_A, '777777777777777777');
  db.prepare("INSERT INTO economy_accounts (guild_id, user_id, balance) VALUES (?, ?, ?)").run(GUILD_A, USER, 250);

  const result = migrate(db);
  assert.deepEqual(result.applied, ['002_protected_security']);
  assert.equal(db.prepare('SELECT log_channel_id FROM guild_settings WHERE guild_id = ?').get(GUILD_A).log_channel_id, '777777777777777777');
  assert.equal(db.prepare('SELECT balance FROM economy_accounts WHERE guild_id = ? AND user_id = ?').get(GUILD_A, USER).balance, 250);
  assert.equal(migrate(db).applied.length, 0, 'second run is a no-op');
  db.close();
});

test('protected audit history is append-only at the database level', () => {
  const { repos } = makeApp();
  const db = repos.db;
  repos.protection.audit({ guildId: GUILD_A, action: 'test.entry', actorId: OWNER });
  assert.throws(() => db.prepare('UPDATE protected_audit SET action = ? WHERE id = 1').run('tampered'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM protected_audit WHERE id = 1').run(), /append-only/);
});

test('a grant applies only to the server it was made in (no global leakage)', () => {
  const { repos, services } = makeApp();
  const nowSec = services.clock.seconds();
  assert.ok(repos.protection.grant({ guildId: GUILD_A, userId: USER, capability: 'channels', authorizedBy: OWNER }));
  assert.deepEqual(services.protectedAuth.grantsFor({ guildId: GUILD_A, userId: USER }), ['channels']);
  assert.deepEqual(services.protectedAuth.grantsFor({ guildId: GUILD_B, userId: USER }), [], 'other server must not inherit the grant');
  assert.deepEqual(repos.protection.activeCapabilities({ guildId: GUILD_B, userId: USER, nowSec }), []);
});

test('a duplicate active grant is refused; revoke then re-grant works; history is kept', () => {
  const { repos, services } = makeApp();
  assert.ok(repos.protection.grant({ guildId: GUILD_A, userId: USER, capability: 'bans', authorizedBy: OWNER }));
  assert.equal(repos.protection.grant({ guildId: GUILD_A, userId: USER, capability: 'bans', authorizedBy: OWNER }), null);
  const nowSec = services.clock.seconds();
  assert.equal(repos.protection.revoke({ guildId: GUILD_A, userId: USER, capability: 'bans', actorId: OWNER, nowSec }), true);
  assert.deepEqual(services.protectedAuth.grantsFor({ guildId: GUILD_A, userId: USER }), []);
  assert.ok(repos.protection.grant({ guildId: GUILD_A, userId: USER, capability: 'bans', authorizedBy: OWNER }));
  assert.equal(repos.protection.grantHistory({ guildId: GUILD_A }).length, 2, 'the revoked row remains in history');
  const actions = repos.protection.recentAudit({ guildId: GUILD_A, limit: 10 }).map((r) => r.action);
  assert.ok(actions.includes('whitelist.grant') && actions.includes('whitelist.revoke'));
});

test('expired grants stop applying without any manual cleanup', () => {
  const clock = fakeClock();
  const { repos, services } = makeApp({ clock });
  const nowSec = clock.seconds();
  repos.protection.grant({ guildId: GUILD_A, userId: USER, capability: 'roles', authorizedBy: OWNER, expiresAt: nowSec + 3600 });
  assert.deepEqual(services.protectedAuth.grantsFor({ guildId: GUILD_A, userId: USER }), ['roles']);
  clock.advance(7200 * 1000);
  assert.deepEqual(services.protectedAuth.grantsFor({ guildId: GUILD_A, userId: USER }), [], 'expired grant must not apply');
});

test('only the verified numeric global owner passes protected authorization', () => {
  const { services, repos, clock } = makeApp();
  const auth = createProtectedAuth({ owners: services.owners, repos, clock });
  assert.equal(auth.isGlobalOwner(OWNER), true);
  assert.doesNotThrow(() => auth.assertGlobalOwner(OWNER));
  // A server Administrator, a non-snowflake name, or an empty value is never the owner.
  assert.equal(auth.isGlobalOwner(ADMIN), false);
  assert.throws(() => auth.assertGlobalOwner(ADMIN), /verified global owner/);
  assert.equal(auth.isGlobalOwner('TanveerOwner'), false);
  assert.equal(auth.isGlobalOwner(undefined), false);
});

test('fail closed: an owner-lookup error denies protected operations', () => {
  const { repos, clock } = makeApp();
  const brokenOwners = { isGlobalOwner: () => { throw new Error('database unavailable'); } };
  const auth = createProtectedAuth({ owners: brokenOwners, repos, clock });
  assert.equal(auth.isGlobalOwner(OWNER), false);
  assert.throws(() => auth.assertGlobalOwner(OWNER), /verified global owner/);
});

test('fail closed: an unavailable whitelist yields no exemption, so detection still applies', () => {
  const { services, repos, clock } = makeApp();
  const brokenRepos = { ...repos, protection: { activeCapabilities: () => { throw new Error('disk I/O error'); } } };
  const auth = createProtectedAuth({ owners: services.owners, repos: brokenRepos, clock });
  assert.deepEqual(auth.grantsFor({ guildId: GUILD_A, userId: USER }), []);
});

test('protected grant confirmation is owner-only and single-use', async () => {
  const { services, repos, app } = makeApp();
  const handler = app.components.get('protect');
  assert.ok(handler, 'protect component handler is registered');
  const token = services.confirmations.create({
    action: 'protection.whitelist.grant',
    actorId: OWNER,
    payload: { guildId: GUILD_A, userId: USER, capability: 'channels', hours: null, reason: 'test' },
  });
  const interactionFor = (actorId) => ({
    customId: `protect:confirm:${token}`,
    update: async (payload) => ({ updated: true, payload }),
  });
  // An administrator who clicks the button is refused, and the confirmation stays unused.
  await assert.rejects(
    handler.run({ interaction: interactionFor(ADMIN), user: { id: ADMIN }, isGlobalOwner: false }),
    /verified global owner/,
  );
  assert.equal(repos.protection.activeCapabilities({ guildId: GUILD_A, userId: USER, nowSec: services.clock.seconds() }).length, 0);
  // The owner's click applies the change once.
  await handler.run({ interaction: interactionFor(OWNER), user: { id: OWNER }, isGlobalOwner: true });
  assert.deepEqual(services.protectedAuth.grantsFor({ guildId: GUILD_A, userId: USER }), ['channels']);
  // Re-using the same confirmation fails.
  await assert.rejects(handler.run({ interaction: interactionFor(OWNER), user: { id: OWNER }, isGlobalOwner: true }), /no longer exists|already used/);
});

test('administrators cannot disable anti-nuke; the attempt is recorded as a high-severity incident', async () => {
  const { app, repos } = makeApp();
  const guild = fakeGuild({ id: GUILD_A });
  const cmd = app.registry.actions.get('security.antinuke.disable');
  assert.ok(cmd, 'disable action exists');
  const ctx = { guild, user: { id: ADMIN }, repos, services: app.services, respond: async () => null };
  await assert.rejects(cmd.run(ctx), /Only the verified global owner/);
  const incidents = repos.incidents.recent(GUILD_A, 5);
  assert.ok(incidents.some((i) => i.kind === 'protection.tamper_attempt' && i.severity === 'high'));
});

test('admins can tune thresholds, but enabling, disabling and response mode are protected', () => {
  const { repos } = makeApp();
  repos.protection.updateSettings({ guildId: GUILD_A, changes: { ban_limit: 9 }, actorId: ADMIN });
  assert.equal(repos.protection.getSettings(GUILD_A).ban_limit, 9);
  assert.throws(() => repos.protection.updateSettings({ guildId: GUILD_A, changes: { response_mode: 'nope' }, actorId: OWNER }), /Invalid response mode/);
  assert.throws(() => repos.protection.updateSettings({ guildId: GUILD_A, changes: { owner_id: '1' }, actorId: OWNER }), /not allowed/);
  // Every settings change writes an audit entry with before and after values.
  const entry = repos.protection.recentAudit({ guildId: GUILD_A }).find((r) => r.action === 'antinuke.settings.updated');
  assert.ok(entry && entry.details.includes('ban_limit'));
});

/** Build a guild whose audit log names an executor for every action. */
function guildWithAudit({ actorId, permissions = ['8'], botPermissions = ['ViewAuditLog', 'ManageRoles'] }) {
  const guild = fakeGuild({ id: GUILD_A, ownerId: '999999999999999999', botPermissions });
  guild.fetchAuditLogs = async () => ({
    entries: new Map([[1, { id: '1', executorId: actorId, targetId: null, createdTimestamp: Date.now() }]]),
  });
  guild.members.cache.set(actorId, fakeMember({ id: actorId, permissions, highestPosition: 5 }));
  return guild;
}

function depsFor(app, logger = silentLogger()) {
  return { repos: app.repos, services: app.services, logger };
}

test('end to end: a burst of channel deletions by one user trips the alert once', async () => {
  const { app, repos } = makeApp();
  const client = { user: { id: BOT_ID }, channels: { fetch: async () => null } };
  const guild = guildWithAudit({ actorId: ACTOR });
  const deps = depsFor(app);
  const outcomes = [];
  for (let i = 0; i < 4; i += 1) {
    outcomes.push((await evaluateProtectedAction({ guild, client, ruleKey: 'channel_delete', actorId: ACTOR, targetId: `c${i}`, deps })).action);
  }
  assert.deepEqual(outcomes, ['none', 'none', 'alert', 'none'], 'alert on the threshold, not again within the window');
  const incidents = repos.incidents.recent(GUILD_A, 10).filter((i) => i.kind === 'antinuke.channel_delete');
  assert.equal(incidents.length, 1);
});

test('end to end: a protected whitelist entry suppresses the response for that user only', async () => {
  const { app, repos } = makeApp();
  const client = { user: { id: BOT_ID }, channels: { fetch: async () => null } };
  repos.protection.grant({ guildId: GUILD_A, userId: ACTOR, capability: 'channels', authorizedBy: OWNER });
  const guild = guildWithAudit({ actorId: ACTOR });
  const deps = depsFor(app);
  for (let i = 0; i < 5; i += 1) {
    const r = await evaluateProtectedAction({ guild, client, ruleKey: 'channel_delete', actorId: ACTOR, deps });
    assert.equal(r.action, 'none');
  }
  // The same burst from a different, non-whitelisted user still alerts.
  const other = '777777777777777770';
  guild.members.cache.set(other, fakeMember({ id: other, highestPosition: 5 }));
  let last;
  for (let i = 0; i < 3; i += 1) last = await evaluateProtectedAction({ guild, client, ruleKey: 'channel_delete', actorId: other, deps });
  assert.equal(last.action, 'alert');
});

test('end to end: a server administrator is not exempt from anti-nuke', async () => {
  const { app } = makeApp();
  const client = { user: { id: BOT_ID }, channels: { fetch: async () => null } };
  const guild = guildWithAudit({ actorId: ADMIN, permissions: ['Administrator'] });
  const deps = depsFor(app);
  let last;
  for (let i = 0; i < 5; i += 1) last = await evaluateProtectedAction({ guild, client, ruleKey: 'ban', actorId: ADMIN, deps });
  assert.equal(last.action, 'alert', 'administrator permission alone grants no anti-nuke exemption');
});

test('end to end: the bot\'s own actions and unattributed actions are never counted as attacks', async () => {
  const { app, repos } = makeApp();
  const client = { user: { id: BOT_ID }, channels: { fetch: async () => null } };
  const guild = guildWithAudit({ actorId: BOT_ID });
  const deps = depsFor(app);
  for (let i = 0; i < 6; i += 1) {
    assert.equal((await evaluateProtectedAction({ guild, client, ruleKey: 'channel_delete', actorId: BOT_ID, deps })).action, 'none');
  }
  const unattributed = await evaluateProtectedAction({ guild, client, ruleKey: 'channel_delete', actorId: null, deps });
  assert.equal(unattributed.note, 'unattributed');
  assert.equal(repos.incidents.recent(GUILD_A, 20).filter((i) => i.kind.startsWith('antinuke.unattributed')).length, 1);
});

test('end to end: restrict mode removes hazardous roles from the actor, and only when the bot outranks them', async () => {
  const { app, repos } = makeApp();
  const client = { user: { id: BOT_ID }, channels: { fetch: async () => null } };
  repos.protection.updateSettings({ guildId: GUILD_A, changes: { response_mode: 'restrict' }, actorId: OWNER });
  const guild = guildWithAudit({ actorId: ACTOR });
  const adminRole = { id: '880000000000000001', position: 3, managed: false, permissions: perms(['Administrator']) };
  const plainRole = { id: '880000000000000002', position: 2, managed: false, permissions: perms(['SendMessages']) };
  const actor = guild.members.cache.get(ACTOR);
  actor.roles.cache.set(adminRole.id, adminRole);
  actor.roles.cache.set(plainRole.id, plainRole);
  const removed = [];
  actor.roles.remove = async (ids) => { removed.push(...ids); };
  const deps = depsFor(app);
  let result;
  for (let i = 0; i < 5; i += 1) result = await evaluateProtectedAction({ guild, client, ruleKey: 'ban', actorId: ACTOR, deps });
  assert.equal(result.action, 'restrict');
  assert.deepEqual(removed, [adminRole.id], 'only the hazardous role is removed');
});

test('findExecutor fails safe: no audit-log permission yields no actor and a reason', async () => {
  const guild = fakeGuild({ id: GUILD_A, botPermissions: ['SendMessages'] });
  const result = await findExecutor(guild, 22, USER);
  assert.equal(result.actorId, null);
  assert.match(result.reason, /View Audit Log/);
});

test('the protection command module is owner-only and registered', () => {
  const { app } = makeApp();
  const mod = app.registry.modules.find((m) => m.name === 'protection');
  assert.ok(mod, 'protection module exists');
  assert.equal(mod.access, 'owner');
  for (const action of app.registry.modules.filter((m) => m.name === 'protection')) {
    assert.equal(action.access, 'owner');
  }
  assert.ok(app.registry.actions.has('protection.whitelist.grant'));
  assert.ok(app.registry.actions.has('security.antinuke.set'));
});
