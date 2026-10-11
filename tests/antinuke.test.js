'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RULES, DEFAULT_SETTINGS, settingsFromRow, limitFor, createBurstTracker, planResponse, validateSettingsUpdate, holdsCapability,
} = require('../src/security/antinuke');

const base = () => ({ ...DEFAULT_SETTINGS, limits: { ...DEFAULT_SETTINGS.limits } });
const SECOND = 1000;

test('anti-nuke defaults are conservative: enabled, alert-only, sane thresholds', () => {
  const s = settingsFromRow(null);
  assert.equal(s.enabled, true);
  assert.equal(s.responseMode, 'alert', 'the default response must never be automatic punishment');
  assert.equal(s.windowSeconds, 10);
  assert.equal(s.limits.channel_delete_limit, 3);
  assert.equal(s.limits.ban_limit, 5);
});

test('settingsFromRow maps a database row, including disabled state', () => {
  const row = { enabled: 0, response_mode: 'log', window_seconds: 30, channel_delete_limit: 4, channel_create_limit: 6, role_delete_limit: 4, role_create_limit: 6, ban_limit: 7, kick_limit: 7, webhook_limit: 4 };
  const s = settingsFromRow(row);
  assert.equal(s.enabled, false);
  assert.equal(s.responseMode, 'log');
  assert.equal(limitFor(s, 'ban'), 7);
  assert.equal(limitFor(s, 'bot_add'), 1, 'fixed-limit rules ignore configurable thresholds');
});

test('burst tracker trips at the threshold and does not trip on fewer events', () => {
  const t = createBurstTracker();
  const opts = { key: 'g:a:channel_delete', windowMs: 10 * SECOND, limit: 3 };
  assert.equal(t.record({ ...opts, nowMs: 0 }).tripped, false);
  assert.equal(t.record({ ...opts, nowMs: 1 * SECOND }).tripped, false);
  const third = t.record({ ...opts, nowMs: 2 * SECOND });
  assert.equal(third.tripped, true);
  assert.equal(third.shouldAlert, true);
  assert.equal(third.count, 3);
});

test('false positives: slow, spaced-out actions never trip the window', () => {
  const t = createBurstTracker();
  // Three channel deletions a minute apart are normal moderation work, not a nuke.
  for (let i = 0; i < 10; i += 1) {
    const r = t.record({ key: 'g:a:channel_delete', windowMs: 10 * SECOND, limit: 3, nowMs: i * 60 * SECOND });
    assert.equal(r.tripped, false, `event ${i} should not trip`);
  }
});

test('an alert is raised once per window, so a single burst cannot flood the log channel', () => {
  const t = createBurstTracker();
  const opts = { key: 'g:a:ban', windowMs: 10 * SECOND, limit: 2 };
  t.record({ ...opts, nowMs: 0 });
  assert.equal(t.record({ ...opts, nowMs: 100 }).shouldAlert, true);
  assert.equal(t.record({ ...opts, nowMs: 200 }).shouldAlert, false, 'suppressed inside the same window');
  assert.equal(t.record({ ...opts, nowMs: 300 }).tripped, true, 'still tripped, just not re-alerted');
});

test('counts are separate per acting user and per rule', () => {
  const t = createBurstTracker();
  t.record({ key: 'g:a:ban', windowMs: 10 * SECOND, limit: 2, nowMs: 0 });
  assert.equal(t.record({ key: 'g:b:ban', windowMs: 10 * SECOND, limit: 2, nowMs: 1 }).tripped, false, 'different user');
  assert.equal(t.record({ key: 'g:a:kick', windowMs: 10 * SECOND, limit: 2, nowMs: 2 }).tripped, false, 'different rule');
});

test('fixed-limit rules (bot added, privilege granted, tamper) trip on the first occurrence', () => {
  const t = createBurstTracker();
  const r = t.record({ key: 'g:a:bot_add', windowMs: 10 * SECOND, limit: limitFor(base(), 'bot_add'), nowMs: 0 });
  assert.equal(r.tripped, true);
});

test('planResponse: nothing happens below threshold or when anti-nuke is disabled', () => {
  assert.equal(planResponse({ settings: base(), ruleKey: 'ban', tripped: false, shouldAlert: false }).action, 'none');
  assert.equal(planResponse({ settings: { ...base(), enabled: false }, ruleKey: 'ban', tripped: true, shouldAlert: true }).action, 'none');
});

test('planResponse: log mode records only, alert mode alerts, restrict mode removes hazardous roles', () => {
  const trip = { tripped: true, shouldAlert: true };
  assert.equal(planResponse({ settings: { ...base(), responseMode: 'log' }, ruleKey: 'ban', ...trip }).action, 'log');
  assert.equal(planResponse({ settings: base(), ruleKey: 'ban', ...trip }).action, 'alert');
  const restrict = planResponse({
    settings: { ...base(), responseMode: 'restrict' },
    ruleKey: 'ban',
    ...trip,
    actor: { roleCanBeManaged: true, hazardousRoleIds: ['r1', 'r2'] },
  });
  assert.equal(restrict.action, 'restrict');
  assert.deepEqual(restrict.stripRoleIds, ['r1', 'r2']);
});

test('restrict never targets the guild owner, the bot, or roles the bot cannot manage', () => {
  const trip = { tripped: true, shouldAlert: true };
  const restrict = { ...base(), responseMode: 'restrict' };
  assert.equal(planResponse({ settings: restrict, ruleKey: 'ban', ...trip, actor: { isGuildOwner: true, roleCanBeManaged: true, hazardousRoleIds: ['r'] } }).action, 'alert');
  assert.equal(planResponse({ settings: restrict, ruleKey: 'ban', ...trip, actor: { isBot: true, roleCanBeManaged: true, hazardousRoleIds: ['r'] } }).action, 'alert');
  assert.equal(planResponse({ settings: restrict, ruleKey: 'ban', ...trip, actor: { roleCanBeManaged: false, hazardousRoleIds: ['r'] } }).action, 'alert');
  assert.equal(planResponse({ settings: restrict, ruleKey: 'ban', ...trip, actor: { roleCanBeManaged: true, hazardousRoleIds: [] } }).action, 'alert');
});

test('a protected grant exempts the actor for the matching capability only', () => {
  const trip = { tripped: true, shouldAlert: true };
  assert.equal(planResponse({ settings: base(), ruleKey: 'channel_delete', ...trip, grants: ['channels'] }).action, 'none');
  assert.equal(planResponse({ settings: base(), ruleKey: 'channel_delete', ...trip, grants: ['all'] }).action, 'none');
  assert.equal(planResponse({ settings: base(), ruleKey: 'ban', ...trip, grants: ['channels'] }).action, 'alert', 'a different capability does not exempt');
});

test('protection tamper cannot be exempted, even by an "all" grant', () => {
  const trip = { tripped: true, shouldAlert: true };
  assert.equal(RULES.protection_tamper.capability, null);
  assert.equal(holdsCapability(['all'], RULES.protection_tamper.capability), false);
  assert.equal(planResponse({ settings: base(), ruleKey: 'protection_tamper', ...trip, grants: ['all'] }).action, 'alert');
});

test('validateSettingsUpdate allows thresholds and window only, within bounds', () => {
  assert.equal(validateSettingsUpdate({ ban_limit: 8, window_seconds: 20 }).ok, true);
  assert.equal(validateSettingsUpdate({ ban_limit: 1 }).ok, false, 'below minimum');
  assert.equal(validateSettingsUpdate({ window_seconds: 601 }).ok, false, 'above maximum');
  assert.equal(validateSettingsUpdate({ ban_limit: 2.5 }).ok, false, 'not an integer');
  // enabled and response_mode are protected owner-only policy: not changeable through this validator.
  const protectedAttempt = validateSettingsUpdate({ enabled: 0 });
  assert.equal(protectedAttempt.ok, false);
  assert.match(protectedAttempt.errors[0], /cannot be changed/);
});
