'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { canActOnMember, assertOk } = require('../security/permissions');
const { parseDuration, formatSeconds, discordTimestamp } = require('../utils/time');
const { isSnowflake } = require('../utils/ids');
const { UserError } = require('../utils/errors');
const ui = require('../utils/ui');
const { requireGuild, fetchMember, botMember, cleanReason, recordModCase, requireTextChannel } = require('./helpers');

const MAX_TIMEOUT_SECONDS = 28 * 86400; // Discord's maximum member timeout is 28 days.
const reasonOption = { type: 'string', name: 'reason', description: 'Reason (shown in the audit log)', required: false, maxLength: 450 };

/** Hierarchy and bot-capability checks before acting on a guild member. */
async function ensureCanModerate(ctx, guild, targetUser) {
  const target = await fetchMember(guild, targetUser.id);
  if (!target) throw new UserError('That user is not in this server.', { code: 'NOT_MEMBER' });
  const bot = await botMember(guild);
  const actor = ctx.member || (await fetchMember(guild, ctx.user.id));
  assertOk(canActOnMember({ actor, target, bot, guildOwnerId: guild.ownerId }));
  return target;
}

module.exports = defineModule({
  name: 'moderation',
  description: 'Kick, ban, timeout, message purge, and moderation history',
  category: 'moderation',
  dmPermission: false,
  defaultMemberPermissions: [PermissionFlagsBits.KickMembers],
  actions: {
    kick: {
      description: 'Kick a member from the server',
      permissions: [PermissionFlagsBits.KickMembers],
      botPermissions: [PermissionFlagsBits.KickMembers],
      options: [
        { type: 'user', name: 'user', description: 'Member to kick', required: true },
        reasonOption,
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const reason = cleanReason(ctx.interaction.options.getString('reason'));
        const target = await ensureCanModerate(ctx, guild, user);
        await target.kick(reason);
        const caseId = await recordModCase(ctx, { action: 'kick', targetId: user.id, reason });
        await ctx.respond({ embeds: [ui.success('Member kicked', `Case #${caseId} recorded.`)] });
      },
    },
    ban: {
      description: 'Ban a user from the server',
      permissions: [PermissionFlagsBits.BanMembers],
      botPermissions: [PermissionFlagsBits.BanMembers],
      options: [
        { type: 'user', name: 'user', description: 'User to ban', required: true },
        reasonOption,
        { type: 'integer', name: 'delete_days', description: 'Delete their recent messages (0-7 days)', required: false, min: 0, max: 7 },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const reason = cleanReason(ctx.interaction.options.getString('reason'));
        const days = ctx.interaction.options.getInteger('delete_days') ?? 0;
        const existing = await fetchMember(guild, user.id);
        if (existing) {
          const bot = await botMember(guild);
          assertOk(canActOnMember({ actor: ctx.member || (await fetchMember(guild, ctx.user.id)), target: existing, bot, guildOwnerId: guild.ownerId }));
        }
        await guild.bans.create(user.id, { reason, deleteMessageSeconds: days * 86400 });
        const caseId = await recordModCase(ctx, { action: 'ban', targetId: user.id, reason });
        await ctx.respond({ embeds: [ui.success('User banned', `Case #${caseId} recorded.`)] });
      },
    },
    unban: {
      description: 'Remove a ban by user ID',
      permissions: [PermissionFlagsBits.BanMembers],
      botPermissions: [PermissionFlagsBits.BanMembers],
      options: [
        { type: 'string', name: 'user_id', description: 'Numeric user ID to unban', required: true, minLength: 17, maxLength: 20 },
        reasonOption,
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const userId = ctx.interaction.options.getString('user_id', true).trim();
        if (!isSnowflake(userId)) throw new UserError('Enter a numeric Discord user ID.', { code: 'INVALID_ID' });
        const reason = cleanReason(ctx.interaction.options.getString('reason'));
        await guild.bans.remove(userId, reason).catch(() => {
          throw new UserError('That user is not banned here.', { code: 'NOT_BANNED' });
        });
        const caseId = await recordModCase(ctx, { action: 'unban', targetId: userId, reason });
        await ctx.respond({ embeds: [ui.success('Ban removed', `Case #${caseId} recorded.`)] });
      },
    },
    timeout: {
      description: 'Temporarily prevent a member from chatting',
      permissions: [PermissionFlagsBits.ModerateMembers],
      botPermissions: [PermissionFlagsBits.ModerateMembers],
      options: [
        { type: 'user', name: 'user', description: 'Member to time out', required: true },
        { type: 'string', name: 'duration', description: 'Length, e.g. 10m, 2h, 1d (max 28d)', required: true, maxLength: 32 },
        reasonOption,
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const seconds = parseDuration(ctx.interaction.options.getString('duration', true));
        if (!seconds || seconds > MAX_TIMEOUT_SECONDS) throw new UserError('Duration must be between 1s and 28 days (e.g. 10m, 2h, 1d).', { code: 'DURATION' });
        const reason = cleanReason(ctx.interaction.options.getString('reason'));
        const target = await ensureCanModerate(ctx, guild, user);
        await target.timeout(seconds * 1000, reason);
        const caseId = await recordModCase(ctx, { action: 'timeout', targetId: user.id, reason, durationSeconds: seconds });
        await ctx.respond({ embeds: [ui.success('Timeout applied', `${formatSeconds(seconds)} — ends ${discordTimestamp(Math.floor(Date.now() / 1000) + seconds)} (case #${caseId}).`)] });
      },
    },
    untimeout: {
      description: 'Remove an active timeout from a member',
      permissions: [PermissionFlagsBits.ModerateMembers],
      botPermissions: [PermissionFlagsBits.ModerateMembers],
      options: [
        { type: 'user', name: 'user', description: 'Member whose timeout to remove', required: true },
        reasonOption,
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const reason = cleanReason(ctx.interaction.options.getString('reason'));
        const target = await ensureCanModerate(ctx, guild, user);
        if (!target.isCommunicationDisabled()) throw new UserError('That member is not timed out.', { code: 'NOT_TIMED_OUT' });
        await target.timeout(null, reason);
        const caseId = await recordModCase(ctx, { action: 'untimeout', targetId: user.id, reason });
        await ctx.respond({ embeds: [ui.success('Timeout removed', `Case #${caseId} recorded.`)] });
      },
    },
    purge: {
      description: 'Bulk-delete recent messages in this channel',
      permissions: [PermissionFlagsBits.ManageMessages],
      botPermissions: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory],
      options: [
        { type: 'integer', name: 'count', description: 'How many recent messages to scan (1-100)', required: true, min: 1, max: 100 },
        { type: 'string', name: 'contains', description: 'Only delete messages containing this text', required: false, maxLength: 100 },
      ],
      cooldownMs: 5000,
      run: async (ctx) => {
        requireGuild(ctx);
        const channel = requireTextChannel(ctx.interaction.channel);
        const count = ctx.interaction.options.getInteger('count', true);
        const needle = (ctx.interaction.options.getString('contains') || '').toLowerCase();
        await ctx.defer(true);
        const fetched = await channel.messages.fetch({ limit: count });
        const cutoff = Date.now() - 14 * 86400 * 1000;
        const deletable = [...fetched.values()].filter((m) => m.createdTimestamp > cutoff && (!needle || m.content.toLowerCase().includes(needle)));
        if (!deletable.length) throw new UserError('No deletable messages matched (messages older than 14 days cannot be bulk-deleted).', { code: 'NOTHING' });
        const deleted = await channel.bulkDelete(deletable, true);
        const caseId = await recordModCase(ctx, { action: 'purge', targetId: channel.id, reason: needle ? `purge contains "${needle.slice(0, 60)}"` : 'purge' });
        await ctx.respond({ embeds: [ui.success('Messages deleted', `Deleted ${deleted.size} message(s). Case #${caseId}.`)] });
      },
    },
    history: {
      description: 'Show a user\u2019s recent moderation cases',
      permissions: [PermissionFlagsBits.ModerateMembers],
      options: [{ type: 'user', name: 'user', description: 'User to look up', required: true }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const rows = ctx.repos.modCases.history(guild.id, user.id, 10);
        const body = rows.length
          ? rows.map((r) => `**#${r.id}** ${r.action} — ${r.reason || 'no reason'} (${r.created_at.slice(0, 10)})`).join('\n')
          : 'No moderation cases on record.';
        await ctx.respond({ embeds: [ui.info('Moderation history', body)] });
      },
    },
  },
});
