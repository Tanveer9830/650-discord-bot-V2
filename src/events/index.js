'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { NO_MENTIONS, sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { evaluateMessage, createSpamTracker } = require('../security/automod');
const { memberHas, canActOnMember } = require('../security/permissions');
const { fetchMember, botMember, postLog } = require('../commands/helpers');
const { logIncident } = require('./incidents');
const { renderTemplate } = require('./templates');
const { registerAntiNuke } = require('./antinuke');

/** Attach gateway event handlers. Each handler is isolated: an error is logged and never crashes the process. */
function registerEvents(client, deps) {
  const { logger, dispatcher, services, repos, config } = deps;
  const spam = services.spamTracker || createSpamTracker();

  const safe = (name, fn) => async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      logger.error(`Event handler failed: ${name}`, { reason: error && error.message, stack: error && error.stack });
    }
  };

  client.on('interactionCreate', safe('interactionCreate', (interaction) => dispatcher.handle(interaction)));

  client.on('messageCreate', safe('messageCreate', async (message) => {
    if (!message.guild || message.system) return;
    const guild = message.guild;
    const trustedIntegration = repos.whitelist.isExempt({ guildId: guild.id, kind: 'trusted_integration', userId: message.author.id, roleIds: [] })
      || (message.webhookId && repos.whitelist.isExempt({ guildId: guild.id, kind: 'trusted_integration', userId: message.webhookId, roleIds: [] }));
    if (message.author.bot && !trustedIntegration) return;

    const settings = repos.automod.get(guild.id);
    const member = message.member || (await fetchMember(guild, message.author.id));
    const roleIds = member ? [...member.roles.cache.keys()] : [];
    const exempt = repos.whitelist.isExempt({ guildId: guild.id, kind: 'security_exemption', userId: message.author.id, roleIds })
      || Boolean(trustedIntegration);

    if (settings.enabled && !exempt) {
      const spamCount = settings.anti_spam
        ? spam.record(`${guild.id}:${message.author.id}`, Date.now(), settings.spam_window_seconds * 1000)
        : 0;
      const violation = evaluateMessage({
        content: message.content,
        settings,
        words: repos.automod.words(guild.id),
        blockedDomains: repos.blocklist.list(guild.id),
        spam: { count: spamCount },
      });
      if (violation) {
        await enforceViolation({ message, member, violation, settings, deps: { repos, services, logger } });
        return;
      }
    }

    // Leveling: only real messages that passed automod earn XP.
    if (member && message.content && message.content.trim().length > 0) {
      const result = services.leveling.awardMessage(guild.id, message.author.id);
      if (result && result.leveledUp) await handleLevelUp({ message, member, result, repos, logger });
    }
  }));

  client.on('guildMemberAdd', safe('guildMemberAdd', async (member) => {
    const guild = member.guild;
    const raid = repos.antiraid.get(guild.id);
    if (raid.enabled) {
      const verdict = services.joinMonitor.record({ guildId: guild.id, nowMs: Date.now(), threshold: raid.join_threshold, windowMs: raid.window_seconds * 1000 });
      if (verdict.raid) {
        logIncident(repos, { guildId: guild.id, kind: 'raid', severity: 'high', details: `${verdict.count} joins in ${raid.window_seconds}s` });
        await postLog({ guild, client, repos, logger }, ui.warn('Possible raid detected', `${verdict.count} members joined within ${raid.window_seconds}s.`));
      }
      if (verdict.raid && raid.kick_new_joins) {
        const bot = await botMember(guild);
        if (bot.permissions.has(PermissionFlagsBits.KickMembers) && bot.roles.highest.position > member.roles.highest.position) {
          await member.kick('Anti-raid: joined during a flagged join burst').catch((e) => logger.warn('Anti-raid kick failed', { reason: e.message }));
        }
      }
    }
    const settings = repos.guild.get(guild.id);
    if (settings && settings.welcome_channel_id && settings.welcome_message) {
      const channel = await client.channels.fetch(settings.welcome_channel_id).catch(() => null);
      if (channel && channel.isTextBased()) {
        const text = renderTemplate(settings.welcome_message, { server: guild.name, members: guild.memberCount, member: member.user.username });
        await channel.send({ content: text, allowedMentions: NO_MENTIONS }).catch((e) => logger.warn('Welcome message failed', { reason: e.message }));
      }
    }
  }));

  client.on('guildMemberRemove', safe('guildMemberRemove', async (member) => {
    const guild = member.guild;
    const settings = repos.guild.get(guild.id);
    if (settings && settings.goodbye_channel_id && settings.goodbye_message) {
      const channel = await client.channels.fetch(settings.goodbye_channel_id).catch(() => null);
      if (channel && channel.isTextBased()) {
        const text = renderTemplate(settings.goodbye_message, { server: guild.name, members: guild.memberCount, member: member.user.username });
        await channel.send({ content: text, allowedMentions: NO_MENTIONS }).catch((e) => logger.warn('Goodbye message failed', { reason: e.message }));
      }
    }
  }));

  registerAntiNuke(client, { logger, repos, services, config });

  return { spam };
}

async function enforceViolation({ message, member, violation, settings, deps }) {
  const { repos, services, logger } = deps;
  const guild = message.guild;
  const me = await botMember(guild);
  let deleted = false;
  if (me.permissions.has(PermissionFlagsBits.ManageMessages) && message.deletable) {
    await message.delete().then(() => { deleted = true; }).catch((e) => logger.warn('Automod delete failed', { reason: e.message }));
  }
  let timedOut = false;
  if (violation.rule === 'spam' && member && me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    const verdict = canActOnMember({ actor: me, target: member, bot: me, guildOwnerId: guild.ownerId });
    if (verdict.ok && member.moderatable) {
      await member.timeout(settings.timeout_seconds * 1000, 'Automod: message flood').then(() => { timedOut = true; }).catch(() => null);
    }
  }
  const severity = ['phishing', 'blocked_domain', 'invite'].includes(violation.rule) ? 'high' : violation.rule === 'word_filter' ? 'low' : 'medium';
  logIncident(repos, { guildId: guild.id, kind: `automod.${violation.rule}`, severity, details: `user ${message.author.id}: ${violation.reason}` });
  services.audit({ guildId: guild.id, actorId: null, action: 'automod.action', targetId: message.author.id, details: { rule: violation.rule, deleted, timedOut } });
  await postLog({ guild, client: message.client, repos, logger }, ui.warn('Automod action', `Rule: ${violation.rule}\nUser ID: ${message.author.id}\nChannel ID: ${message.channelId}\nDeleted: ${deleted ? 'yes' : 'no'}\nTimed out: ${timedOut ? 'yes' : 'no'}`));
}

async function handleLevelUp({ message, member, result, repos, logger }) {
  const guild = message.guild;
  const rewards = repos.levels.levelRolesUpTo(guild.id, result.newLevel);
  const bot = await botMember(guild);
  for (const reward of rewards) {
    const role = guild.roles.cache.get(reward.role_id);
    if (role && !member.roles.cache.has(role.id) && bot.roles.highest.position > role.position && bot.permissions.has(PermissionFlagsBits.ManageRoles)) {
      await member.roles.add(role, 'Level reward').catch((e) => logger.warn('Level role failed', { reason: e.message }));
    }
  }
  if (result.announceChannelId) {
    const channel = await message.client.channels.fetch(result.announceChannelId).catch(() => null);
    if (channel && channel.isTextBased()) {
      await channel.send({
        content: sanitizeText(`🎉 ${message.author.username} reached level ${result.newLevel}!`, { maxLength: 300 }),
        allowedMentions: NO_MENTIONS,
      }).catch(() => null);
    }
  }
}

module.exports = { registerEvents, enforceViolation };
