'use strict';

/**
 * Anti-nuke decision logic. Pure functions only: no Discord or database access,
 * so thresholds, windows, exemptions and response planning are unit-tested directly.
 *
 * Detection is per (server, acting user, rule) inside a sliding window. A rule that trips
 * produces ONE alert per window, so a single burst cannot flood the log channel.
 * Conservative defaults: the default response is "alert" (never automatic punishment).
 */

/** Capabilities that a protected whitelist entry can grant. 'all' covers every rule. */
const CAPABILITIES = Object.freeze(['all', 'channels', 'roles', 'bans', 'kicks', 'webhooks', 'bots', 'permissions', 'guild_settings']);

/** Response ladder. 'restrict' removes hazardous roles from the actor and needs owner approval. */
const RESPONSE_MODES = Object.freeze(['log', 'alert', 'restrict']);

/**
 * Detection rules. `limitKey` names a configurable threshold; `fixedLimit` is used for rules
 * where a single occurrence is already suspicious (unauthorised bot, privilege escalation).
 */
const RULES = Object.freeze({
  channel_delete: { capability: 'channels', limitKey: 'channel_delete_limit', severity: 'high', label: 'Mass channel deletion' },
  channel_create: { capability: 'channels', limitKey: 'channel_create_limit', severity: 'medium', label: 'Mass channel creation' },
  role_delete: { capability: 'roles', limitKey: 'role_delete_limit', severity: 'high', label: 'Mass role deletion' },
  role_create: { capability: 'roles', limitKey: 'role_create_limit', severity: 'medium', label: 'Mass role creation' },
  ban: { capability: 'bans', limitKey: 'ban_limit', severity: 'high', label: 'Mass banning' },
  kick: { capability: 'kicks', limitKey: 'kick_limit', severity: 'high', label: 'Mass kicking' },
  webhook_change: { capability: 'webhooks', limitKey: 'webhook_limit', severity: 'medium', label: 'Suspicious webhook activity' },
  bot_add: { capability: 'bots', fixedLimit: 1, severity: 'high', label: 'Bot added to the server' },
  permission_escalation: { capability: 'permissions', fixedLimit: 1, severity: 'high', label: 'Privileged role granted' },
  guild_settings: { capability: 'guild_settings', fixedLimit: 1, severity: 'high', label: 'Dangerous server setting changed' },
  // Protection tamper: the bot's own role was removed. Never exemptible.
  protection_tamper: { capability: null, fixedLimit: 1, severity: 'high', label: 'Bot role or protection tampered with' },
});

/** Permissions that make a role dangerous. Used when deciding what 'restrict' may strip. */
const HAZARDOUS_PERMISSIONS = Object.freeze(['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageWebhooks', 'BanMembers', 'KickMembers']);

const DEFAULT_LIMITS = Object.freeze({
  channel_delete_limit: 3,
  channel_create_limit: 5,
  role_delete_limit: 3,
  role_create_limit: 5,
  ban_limit: 5,
  kick_limit: 5,
  webhook_limit: 3,
});

const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  responseMode: 'alert',
  windowSeconds: 10,
  limits: DEFAULT_LIMITS,
});

/** Convert a database settings row (snake_case) into the logic's shape. Missing row = defaults. */
function settingsFromRow(row) {
  if (!row) return { ...DEFAULT_SETTINGS, limits: { ...DEFAULT_LIMITS } };
  const limits = {};
  for (const key of Object.keys(DEFAULT_LIMITS)) limits[key] = row[key];
  return {
    enabled: row.enabled === 1,
    responseMode: row.response_mode,
    windowSeconds: row.window_seconds,
    limits,
  };
}

/** Limit that applies to a rule, with the window and enablement settings already resolved. */
function limitFor(settings, ruleKey) {
  const rule = RULES[ruleKey];
  if (!rule) throw new Error(`Unknown anti-nuke rule: ${ruleKey}`);
  if (rule.fixedLimit !== undefined) return rule.fixedLimit;
  return settings.limits[rule.limitKey];
}

/**
 * Sliding-window counter. record() returns the number of events for the key inside the window,
 * including the one just recorded, and whether an alert should be raised now.
 * Alerts are suppressed for the rest of the window once raised.
 */
function createBurstTracker({ maxKeys = 5000 } = {}) {
  const events = new Map();
  const alertedUntil = new Map();

  function prune(nowMs, windowMs) {
    if (events.size <= maxKeys) return;
    for (const [key, list] of events) {
      const fresh = list.filter((t) => nowMs - t < windowMs);
      if (fresh.length === 0) events.delete(key);
      else events.set(key, fresh);
    }
    for (const [key, until] of alertedUntil) {
      if (until <= nowMs) alertedUntil.delete(key);
    }
  }

  return {
    record({ key, nowMs, windowMs, limit }) {
      prune(nowMs, windowMs);
      const list = (events.get(key) || []).filter((t) => nowMs - t < windowMs);
      list.push(nowMs);
      events.set(key, list);
      const count = list.length;
      const tripped = count >= limit;
      const suppressed = alertedUntil.has(key) && alertedUntil.get(key) > nowMs;
      const shouldAlert = tripped && !suppressed;
      if (shouldAlert) alertedUntil.set(key, nowMs + windowMs);
      return { count, tripped, shouldAlert };
    },
    size: () => events.size,
  };
}

/** A user holds a capability when an active grant is for that capability or for 'all'. */
function holdsCapability(grants, capability) {
  if (!capability) return false;
  return grants.includes('all') || grants.includes(capability);
}

/**
 * Decide what to do about a rule trigger. Pure: callers provide every fact.
 *   actor: { isGuildOwner, isBot, hazardousRoleIds, roleCanBeManaged }
 * Returns { action: 'none' | 'log' | 'alert' | 'restrict', stripRoleIds, note }.
 */
function planResponse({ settings, ruleKey, tripped, shouldAlert, grants = [], actor = {} }) {
  if (!settings.enabled) return { action: 'none', stripRoleIds: [], note: 'anti-nuke disabled' };
  const rule = RULES[ruleKey];
  if (!rule) throw new Error(`Unknown anti-nuke rule: ${ruleKey}`);
  if (!tripped) return { action: 'none', stripRoleIds: [], note: 'below threshold' };
  if (rule.capability && holdsCapability(grants, rule.capability)) {
    return { action: 'none', stripRoleIds: [], note: 'actor holds a protected whitelist grant' };
  }
  if (!shouldAlert) return { action: 'none', stripRoleIds: [], note: 'already alerted in this window' };
  if (settings.responseMode === 'log') return { action: 'log', stripRoleIds: [], note: 'logged only' };
  if (settings.responseMode === 'alert') return { action: 'alert', stripRoleIds: [], note: 'operators alerted' };

  // restrict: only when the bot can act and the policy allows it. Otherwise fall back to alert.
  if (actor.isBot) return { action: 'alert', stripRoleIds: [], note: 'the bot never restricts itself' };
  if (actor.isGuildOwner) return { action: 'alert', stripRoleIds: [], note: 'the server owner cannot be restricted by the bot' };
  if (!actor.roleCanBeManaged) return { action: 'alert', stripRoleIds: [], note: 'bot role is not above the actor' };
  const strip = [...(actor.hazardousRoleIds || [])];
  if (strip.length === 0) return { action: 'alert', stripRoleIds: [], note: 'no hazardous roles to remove' };
  return { action: 'restrict', stripRoleIds: strip, note: 'hazardous roles removed' };
}

/** Validation for threshold updates made by server administrators. Returns { ok, errors }. */
function validateSettingsUpdate(update) {
  const errors = [];
  const allowed = new Set(['window_seconds', ...Object.keys(DEFAULT_LIMITS)]);
  for (const [key, value] of Object.entries(update)) {
    if (!allowed.has(key)) {
      errors.push(`${key} cannot be changed here.`);
      continue;
    }
    if (!Number.isInteger(value)) {
      errors.push(`${key} must be a whole number.`);
      continue;
    }
    if (key === 'window_seconds' && (value < 5 || value > 600)) errors.push('window_seconds must be between 5 and 600.');
    if (key !== 'window_seconds' && (value < 2 || value > 200)) errors.push(`${key} must be between 2 and 200.`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  CAPABILITIES,
  RESPONSE_MODES,
  RULES,
  HAZARDOUS_PERMISSIONS,
  DEFAULT_LIMITS,
  DEFAULT_SETTINGS,
  settingsFromRow,
  limitFor,
  createBurstTracker,
  holdsCapability,
  planResponse,
  validateSettingsUpdate,
};
