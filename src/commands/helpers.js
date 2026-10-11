'use strict';

const { UserError } = require('../utils/errors');
const { sanitizeText, NO_MENTIONS } = require('../utils/text');
const ui = require('../utils/ui');

function requireGuild(ctx) {
  if (!ctx.guild) throw new UserError('This command can only be used inside a server.', { code: 'GUILD_ONLY' });
  return ctx.guild;
}

/** Fetch a guild member by ID; returns null when the user is not in the server. */
async function fetchMember(guild, userId) {
  if (!guild || !userId) return null;
  const cached = guild.members.cache.get(userId);
  if (cached) return cached;
  return guild.members.fetch(userId).catch(() => null);
}

async function botMember(guild) {
  return guild.members.me || guild.members.fetchMe();
}

function requireTextChannel(channel) {
  if (!channel || !channel.isTextBased() || channel.isDMBased()) {
    throw new UserError('Please use a text channel in this server.', { code: 'CHANNEL_TYPE' });
  }
  return channel;
}

function cleanReason(text, fallback = 'No reason provided') {
  const value = sanitizeText(text ?? '', { maxLength: 450 }).trim();
  return value.length ? value : fallback;
}

/** Post a plain (non-pinging) log embed to the configured log channel, if any. */
async function postLog(ctx, embed) {
  const settings = ctx.repos.guild.get(ctx.guild.id);
  if (!settings || !settings.log_channel_id) return false;
  try {
    const channel = await ctx.client.channels.fetch(settings.log_channel_id);
    if (!channel || !channel.isTextBased()) return false;
    await channel.send({ embeds: [embed], allowedMentions: NO_MENTIONS });
    return true;
  } catch (error) {
    ctx.logger.warn('Log channel post failed', { reason: error.message });
    return false;
  }
}

/** Record a moderation case, an audit entry, and a log-channel notice. */
async function recordModCase(ctx, { action, targetId, reason, durationSeconds = null }) {
  const caseId = ctx.repos.modCases.insert({
    guildId: ctx.guild.id,
    action,
    targetId,
    moderatorId: ctx.user.id,
    reason,
    durationSeconds,
  });
  ctx.services.audit({ guildId: ctx.guild.id, actorId: ctx.user.id, action: `mod.${action}`, targetId, details: { caseId, durationSeconds } });
  await postLog(ctx, ui.info(`Case #${caseId}: ${action}`, `Target ID: ${targetId}\nModerator ID: ${ctx.user.id}\nReason: ${reason}`, ui.COLORS.warn));
  return caseId;
}

module.exports = { requireGuild, fetchMember, botMember, requireTextChannel, cleanReason, postLog, recordModCase };
