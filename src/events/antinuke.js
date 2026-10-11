'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const ui = require('../utils/ui');
const { fetchMember, postLog } = require('../commands/helpers');
const { logIncident } = require('./incidents');
const { RULES, HAZARDOUS_PERMISSIONS, settingsFromRow, limitFor, planResponse } = require('../security/antinuke');

/** Look-back for matching audit-log entries. Audit entries appear within a few seconds of the action. */
const AUDIT_LOOKBACK_MS = 15000;
const AUDIT_FETCH_LIMIT = 25;
/** Guild settings that an attacker typically changes to weaken a server. */
const WATCHED_GUILD_FIELDS = ['verificationLevel', 'explicitContentFilter', 'defaultMessageNotifications', 'mfaLevel', 'vanityURLCode'];

/**
 * Identify who performed an action via the audit log. Returns { actorId, reason }.
 * Failure is never silent: an unknown actor is reported as a reason, and the caller records it.
 */
async function findExecutor(guild, type, targetId = null) {
  const me = guild.members.me;
  if (!me || !me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    return { actorId: null, reason: 'missing View Audit Log permission' };
  }
  const logs = await guild.fetchAuditLogs({ type, limit: AUDIT_FETCH_LIMIT });
  const now = Date.now();
  for (const entry of logs.entries.values()) {
    if (now - entry.createdTimestamp > AUDIT_LOOKBACK_MS) continue;
    if (targetId && entry.targetId !== targetId) continue;
    const actorId = entry.executorId || (entry.executor && entry.executor.id) || null;
    return { actorId, reason: actorId ? null : 'audit entry without executor' };
  }
  return { actorId: null, reason: 'no matching audit entry' };
}

/**
 * Shared decision path for every monitored action:
 * count per actor and rule, check protected grants, plan the response, record and alert.
 * Exported for tests (the discord-facing wrappers only gather facts).
 */
async function evaluateProtectedAction({ guild, client, ruleKey, actorId, targetId = null, deps }) {
  const { repos, services, logger } = deps;
  const rule = RULES[ruleKey];
  if (!rule) throw new Error(`Unknown anti-nuke rule: ${ruleKey}`);

  if (!actorId) {
    logIncident(repos, { guildId: guild.id, kind: `antinuke.unattributed.${ruleKey}`, severity: 'low', details: 'actor could not be identified from the audit log' });
    return { action: 'none', note: 'unattributed' };
  }
  if (client.user && actorId === client.user.id) return { action: 'none', note: 'the bot itself' };

  const settings = settingsFromRow(repos.protection.getSettings(guild.id));
  if (!settings.enabled) return { action: 'none', note: 'anti-nuke disabled' };

  const limit = limitFor(settings, ruleKey);
  const tracked = services.antinukeTracker.record({
    key: `${guild.id}:${actorId}:${ruleKey}`,
    nowMs: Date.now(),
    windowMs: settings.windowSeconds * 1000,
    limit,
  });
  if (!tracked.tripped) return { action: 'none', note: 'below threshold' };

  const grants = services.protectedAuth.grantsFor({ guildId: guild.id, userId: actorId });
  const actorMember = await fetchMember(guild, actorId);
  const bot = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  const hazardousRoleIds = actorMember
    ? [...actorMember.roles.cache.values()]
      .filter((role) => !role.managed && role.id !== guild.id && HAZARDOUS_PERMISSIONS.some((p) => role.permissions.has(PermissionFlagsBits[p])))
      .map((role) => role.id)
    : [];
  const roleCanBeManaged = Boolean(bot && actorMember
    && bot.permissions.has(PermissionFlagsBits.ManageRoles)
    && bot.roles.highest.position > actorMember.roles.highest.position);

  const plan = planResponse({
    settings,
    ruleKey,
    tripped: tracked.tripped,
    shouldAlert: tracked.shouldAlert,
    grants,
    actor: {
      isGuildOwner: actorId === guild.ownerId,
      isBot: Boolean(actorMember && actorMember.user && actorMember.user.bot),
      hazardousRoleIds,
      roleCanBeManaged,
    },
  });
  if (plan.action === 'none') return plan;

  let restricted = false;
  if (plan.action === 'restrict' && actorMember) {
    try {
      await actorMember.roles.remove(plan.stripRoleIds, `TANVEER anti-nuke: ${rule.label}`);
      restricted = true;
    } catch (error) {
      logger.warn('Anti-nuke restrict failed', { reason: error.message });
    }
  }
  const finalAction = plan.action === 'restrict' && !restricted ? 'alert' : plan.action;

  logIncident(repos, {
    guildId: guild.id,
    kind: `antinuke.${ruleKey}`,
    severity: rule.severity,
    details: `actor ${actorId}: ${tracked.count}/${limit} in ${settings.windowSeconds}s; action ${finalAction} (${plan.note}); target ${targetId || 'n/a'}`,
  });
  services.audit({ guildId: guild.id, actorId: null, action: 'antinuke.trigger', targetId: actorId, details: { rule: ruleKey, count: tracked.count, limit, action: finalAction } });

  if (finalAction !== 'log') {
    const lines = [
      `Rule: ${rule.label}`,
      `Acting user ID: ${actorId}`,
      `Count: ${tracked.count} (limit ${limit} in ${settings.windowSeconds}s)`,
      `Response: ${finalAction === 'restrict' ? 'hazardous roles removed' : finalAction === 'alert' ? 'operators alerted' : finalAction}`,
      '',
      'Recovery: review the audit log, then restore any deleted or changed items from backup if needed.',
      'If the action was legitimate, a verified global owner can grant a protected whitelist entry.',
    ];
    await postLog({ guild, client, repos, logger }, ui.warn('Anti-nuke alert', lines.join('\n')));
  }
  return { action: finalAction, note: plan.note };
}

/** Attach anti-nuke listeners. Every listener is isolated; a failure is logged and never crashes the bot. */
function registerAntiNuke(client, deps) {
  const { logger } = deps;
  const safe = (name, fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      logger.error(`Anti-nuke handler failed: ${name}`, { reason: error && error.message });
    }
  };
  const run = (guild, ruleKey, actorId, targetId) => evaluateProtectedAction({ guild, client, ruleKey, actorId, targetId, deps });

  client.on('channelDelete', safe('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const { actorId } = await findExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    await run(channel.guild, 'channel_delete', actorId, channel.id);
  }));

  client.on('channelCreate', safe('channelCreate', async (channel) => {
    if (!channel.guild) return;
    const { actorId } = await findExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    await run(channel.guild, 'channel_create', actorId, channel.id);
  }));

  client.on('roleDelete', safe('roleDelete', async (role) => {
    const { actorId } = await findExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    await run(role.guild, 'role_delete', actorId, role.id);
  }));

  client.on('roleCreate', safe('roleCreate', async (role) => {
    const { actorId } = await findExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    await run(role.guild, 'role_create', actorId, role.id);
  }));

  client.on('guildBanAdd', safe('guildBanAdd', async (ban) => {
    const { actorId } = await findExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    await run(ban.guild, 'ban', actorId, ban.user.id);
  }));

  client.on('guildMemberRemove', safe('guildMemberRemove:kick', async (member) => {
    // A kick is a removal with a MemberKick audit entry for the same target. Leaves produce no entry.
    // No matching kick entry means a voluntary leave, which is not a monitored action.
    const { actorId } = await findExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!actorId) return;
    await run(member.guild, 'kick', actorId, member.id);
  }));

  client.on('webhooksUpdate', safe('webhooksUpdate', async (channel) => {
    if (!channel.guild) return;
    const types = [AuditLogEvent.WebhookCreate, AuditLogEvent.WebhookUpdate, AuditLogEvent.WebhookDelete];
    for (const type of types) {
      const { actorId } = await findExecutor(channel.guild, type, null);
      if (actorId) {
        await run(channel.guild, 'webhook_change', actorId, channel.id);
        return;
      }
    }
    logIncident(deps.repos, { guildId: channel.guild.id, kind: 'antinuke.unattributed.webhook_change', severity: 'low', details: 'webhook change without an identifiable actor' });
  }));

  client.on('guildMemberAdd', safe('guildMemberAdd:bot', async (member) => {
    if (!member.user.bot) return;
    const { actorId } = await findExecutor(member.guild, AuditLogEvent.BotAdd, member.id);
    await run(member.guild, 'bot_add', actorId, member.id);
  }));

  client.on('guildMemberUpdate', safe('guildMemberUpdate', async (oldMember, newMember) => {
    const guild = newMember.guild;
    const oldIds = new Set(oldMember.roles.cache.keys());
    const added = [...newMember.roles.cache.values()].filter((r) => !oldIds.has(r.id));
    const removed = [...oldMember.roles.cache.keys()].filter((id) => !newMember.roles.cache.has(id));

    // Protection tamper: the bot lost a role. Always treated as an incident, never exempt.
    if (client.user && newMember.id === client.user.id && removed.length > 0) {
      const { actorId } = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
      await run(guild, 'protection_tamper', actorId, newMember.id);
      return;
    }
    // Privilege escalation: a hazardous role was granted to a member (not to the bot).
    if (newMember.id !== (client.user && client.user.id)) {
      const hazardous = added.some((role) => !role.managed && HAZARDOUS_PERMISSIONS.some((p) => role.permissions.has(PermissionFlagsBits[p])));
      if (hazardous) {
        const { actorId } = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
        await run(guild, 'permission_escalation', actorId, newMember.id);
      }
    }
  }));

  client.on('guildUpdate', safe('guildUpdate', async (oldGuild, newGuild) => {
    const changed = WATCHED_GUILD_FIELDS.filter((field) => oldGuild[field] !== newGuild[field]);
    if (changed.length === 0) return;
    const { actorId } = await findExecutor(newGuild, AuditLogEvent.GuildUpdate, null);
    await run(newGuild, 'guild_settings', actorId, null);
  }));
}

module.exports = { registerAntiNuke, evaluateProtectedAction, findExecutor, WATCHED_GUILD_FIELDS };
