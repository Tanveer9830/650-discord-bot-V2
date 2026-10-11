'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, OWNER, fakeMember, fakeRole, fakeGuild, perms, nid } = require('./helpers');
const { extractUrls, hostOf, analyzeUrl, domainMatches, isInvite, registrableDomain } = require('../src/security/links');
const { evaluateMessage, containsBlockedWord, normaliseForWords, createSpamTracker } = require('../src/security/automod');
const { canActOnMember, memberHas } = require('../src/security/permissions');
const { createDeduper } = require('../src/security/dedupe');
const { createCooldowns } = require('../src/security/cooldowns');
const { createJoinMonitor } = require('../src/security/antiraid');

test('owner authority comes only from the verified numeric ID (env seed or DB row)', () => {
  const { services, repos } = makeApp();
  assert.equal(services.owners.isGlobalOwner(OWNER), true);
  assert.equal(services.owners.isGlobalOwner('123456789012345678'), false);
  // A server Administrator is NOT a global owner.
  assert.equal(services.owners.isGlobalOwner('222222222222222222'), false);
  services.owners.addOwner({ actorId: OWNER, targetId: '333333333333333333' });
  assert.equal(services.owners.isGlobalOwner('333333333333333333'), true);
  assert.equal(repos.owners.has('333333333333333333'), true);
});

test('env-seeded owners cannot be removed, and the last owner can never be removed', () => {
  const { services } = makeApp();
  assert.throws(() => services.owners.removeOwner({ actorId: OWNER, targetId: OWNER }), /configuration/i);
  services.owners.addOwner({ actorId: OWNER, targetId: '333333333333333333' });
  services.owners.removeOwner({ actorId: OWNER, targetId: '333333333333333333' });
  assert.equal(services.owners.isGlobalOwner('333333333333333333'), false);
});

test('confirmations are single-use, expire, and bind to the original actor', () => {
  const clock = { t: 1_800_000_000 };
  const { repos } = makeApp();
  const { createConfirmationService } = require('../src/security/confirmations');
  const svc = createConfirmationService({ repos, clock: () => clock.t, ttlSeconds: 120 });
  const id = svc.create({ action: 'owner.add', actorId: OWNER, payload: { userId: '1' } });
  assert.throws(() => svc.consume({ id, action: 'owner.add', actorId: '999999999999999999' }), /Only the person who started/i);
  const payload = svc.consume({ id, action: 'owner.add', actorId: OWNER });
  assert.equal(payload.userId, '1');
  assert.throws(() => svc.consume({ id, action: 'owner.add', actorId: OWNER }), /no longer exists|already used/i);
  const id2 = svc.create({ action: 'owner.add', actorId: OWNER, payload: {} });
  clock.t += 121;
  assert.throws(() => svc.consume({ id: id2, action: 'owner.add', actorId: OWNER }), /expired/i);
});

test('link analysis: hosts, invites, and suffix-safe blocklist matching', () => {
  assert.deepEqual(extractUrls('see https://Example.com/a and http://x.org'), ['https://Example.com/a', 'http://x.org']);
  assert.equal(hostOf('https://Sub.Example.com/path'), 'sub.example.com');
  assert.equal(isInvite('join discord.gg/abc123'), true);
  assert.equal(isInvite('visit example.com'), false);
  assert.equal(domainMatches('a.evil.com', 'evil.com'), true);
  assert.equal(domainMatches('evil.com.au', 'evil.com'), false);
  // Blocking a country-code second-level domain must not block the whole suffix.
  assert.equal(domainMatches('shop.example.co.uk', 'example.co.uk'), true);
  assert.equal(domainMatches('example.com', 'co.uk'), false);
  assert.equal(domainMatches('evilco.uk', 'co.uk'), false, 'matches whole labels only');
  assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('shop.example.com.au'), 'example.com.au');
  assert.equal(registrableDomain('x.evil.com'), 'evil.com');
});

test('automod word filter normalises leetspeak and separators, and only blocks listed words', () => {
  assert.equal(normaliseForWords('N1TR0'), 'nitro');
  assert.equal(containsBlockedWord('this is b4d stuff', ['bad']), 'bad');
  assert.equal(containsBlockedWord('a perfectly fine sentence', ['bad']), null);
  const result = evaluateMessage({ content: 'you are BAD', settings: { enabled: 1, word_filter: 1 }, words: ['bad'] });
  assert.equal(result.rule, 'word_filter');
  assert.equal(evaluateMessage({ content: 'BAD', settings: { enabled: 0, word_filter: 1 }, words: ['bad'] }), null, 'disabled automod ignores everything');
});

test('automod evaluates links and invites according to settings', () => {
  const off = evaluateMessage({ content: 'https://example.org/page', settings: { enabled: 1, block_links: 0, block_invites: 0 }, words: [] });
  assert.equal(off, null);
  const on = evaluateMessage({ content: 'https://example.org/page', settings: { enabled: 1, block_links: 1, block_invites: 0 }, words: [] });
  assert.equal(on.rule, 'link');
  const invite = evaluateMessage({ content: 'discord.gg/abcdef', settings: { enabled: 1, block_links: 0, block_invites: 1 }, words: [] });
  assert.equal(invite.rule, 'invite');
  const blocked = evaluateMessage({ content: 'see https://files.evil.com/x', settings: { enabled: 1, block_links: 0 }, words: [], blockedDomains: ['evil.com'] });
  assert.equal(blocked.rule, 'blocked_domain');
  const phish = evaluateMessage({ content: 'free https://paypal-login.xyz/verify', settings: { enabled: 1 }, words: [] });
  assert.equal(phish.rule, 'phishing');
});

test('spam tracker flags bursts beyond the configured limit within the window', () => {
  const tracker = createSpamTracker();
  let count = 0;
  for (let i = 0; i < 6; i += 1) count = tracker.record('u', 1000 + i * 100, 8000);
  assert.equal(count, 6, 'six messages inside the window');
  const settings = { enabled: 1, anti_spam: 1, spam_max_messages: 5 };
  assert.equal(evaluateMessage({ content: 'hi', settings, spam: { count } }).rule, 'spam');
  const calm = createSpamTracker();
  let calmCount = 0;
  for (let i = 0; i < 6; i += 1) calmCount = calm.record('u', 1000 + i * 10_000, 8000);
  assert.equal(calmCount, 1, 'spaced-out messages never accumulate');
});

test('role hierarchy: nobody acts on a member at or above their own highest role, and the bot must outrank the target', () => {
  const guild = fakeGuild({ ownerId: '999999999999999999', botPosition: 10 });
  const actor = fakeMember({ id: '100000000000000001', highestPosition: 5 });
  const peer = fakeMember({ id: '100000000000000002', highestPosition: 5 });
  const lower = fakeMember({ id: '100000000000000003', highestPosition: 2 });
  const guildOwner = fakeMember({ id: '999999999999999999', highestPosition: 99 });
  const bot = guild.members.me;
  assert.equal(canActOnMember({ actor, target: lower, bot, guildOwnerId: guild.ownerId }).ok, true);
  assert.equal(canActOnMember({ actor, target: peer, bot, guildOwnerId: guild.ownerId }).ok, false);
  assert.equal(canActOnMember({ actor, target: guildOwner, bot, guildOwnerId: guild.ownerId }).ok, false);
  const weakBot = fakeMember({ id: '555555555555555556', highestPosition: 1 });
  assert.equal(canActOnMember({ actor, target: lower, bot: weakBot, guildOwnerId: guild.ownerId }).ok, false);
});

test('memberHas reads Discord permission bits only (no role-name or ID shortcuts)', () => {
  const member = fakeMember({ id: '100000000000000009', permissions: ['KickMembers'] });
  const { PermissionFlagsBits } = require('discord.js');
  assert.equal(memberHas(member, PermissionFlagsBits.KickMembers), true);
  assert.equal(memberHas(member, PermissionFlagsBits.BanMembers), false);
  const plain = { id: '100000000000000010', permissions: perms([]) };
  assert.equal(memberHas(plain, PermissionFlagsBits.Administrator), false);
});

test('dedupe and cooldowns', () => {
  let now = 0;
  const d = createDeduper({ ttlMs: 1000, clock: () => now });
  assert.equal(d.check('i1'), false);
  assert.equal(d.check('i1'), true, 'second sighting is a duplicate');
  now = 2000;
  assert.equal(d.check('i1'), false, 'entry expires after the TTL');
  let t = 0;
  const c = createCooldowns(() => t);
  assert.equal(c.take('k', 5000), 0, 'first use is allowed');
  assert.equal(c.take('k', 5000), 5000, 'second use reports remaining milliseconds');
  t = 5001;
  assert.equal(c.take('k', 5000), 0);
});

test('join monitor flags a burst of joins inside the window', () => {
  const monitor = createJoinMonitor();
  let last = null;
  for (let i = 0; i < 5; i += 1) last = monitor.record({ guildId: 'g', nowMs: i * 100, threshold: 5, windowMs: 10000 });
  assert.equal(last.raid, true);
  assert.equal(last.count, 5);
  assert.equal(monitor.record({ guildId: 'g', nowMs: 600, threshold: 5, windowMs: 10000 }).raid, false, 'alerts are rate-limited to one per window');
  assert.equal(nid().length, 18);
  assert.ok(fakeRole);
});
