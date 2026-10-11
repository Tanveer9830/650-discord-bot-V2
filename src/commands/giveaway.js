'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { defineModule } = require('./framework');
const { parseDuration } = require('../utils/time');
const { UserError } = require('../utils/errors');
const { sanitizeText, NO_MENTIONS } = require('../utils/text');
const ui = require('../utils/ui');
const { giveawayEmbed, enterRow } = require('../services/giveawayView');
const { pickWinners } = require('../services/giveaways');
const { randomInt } = require('node:crypto');
const { requireGuild, requireTextChannel } = require('./helpers');

const manage = [PermissionFlagsBits.ManageGuild];

/** Edit the original giveaway message to reflect its current state (best effort). */
async function refreshGiveawayMessage(ctx, id) {
  const g = ctx.repos.giveaways.get(id);
  if (!g || !g.message_id || !ctx.client) return;
  try {
    const channel = await ctx.client.channels.fetch(g.channel_id);
    const message = await channel.messages.fetch(g.message_id);
    const winners = g.winners ? JSON.parse(g.winners) : null;
    await message.edit({ embeds: [giveawayEmbed(g, ctx.repos.giveaways.entries(id).length, winners)], components: [] });
  } catch (error) {
    ctx.logger.warn('Could not refresh giveaway message', { giveawayId: id, reason: error.message });
  }
}
const MAX_DURATION = 30 * 86400;

module.exports = defineModule({
  name: 'giveaway',
  description: 'Run giveaways with a button entry and secure random winners',
  category: 'community',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    start: {
      description: 'Start a giveaway that ends after a duration',
      permissions: manage,
      botPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
      options: [
        { type: 'string', name: 'prize', description: 'What is being given away', required: true, minLength: 1, maxLength: 200 },
        { type: 'string', name: 'duration', description: 'How long it runs, e.g. 30m, 2h, 3d (max 30d)', required: true, maxLength: 32 },
        { type: 'integer', name: 'winners', description: 'Number of winners (1-20)', required: false, min: 1, max: 20 },
        { type: 'channel', name: 'channel', description: 'Channel for the giveaway (default: this channel)', required: false, channelTypes: ['GuildText', 'GuildAnnouncement'] },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const prize = sanitizeText(ctx.interaction.options.getString('prize', true), { maxLength: 200 });
        const seconds = parseDuration(ctx.interaction.options.getString('duration', true));
        if (!seconds || seconds > MAX_DURATION) throw new UserError('Duration must be between 1s and 30 days.', { code: 'DURATION' });
        const winners = ctx.interaction.options.getInteger('winners') ?? 1;
        const chosen = ctx.interaction.options.getChannel('channel') || ctx.interaction.channel;
        const channel = requireTextChannel(chosen && chosen.type !== ChannelType.GuildCategory ? chosen : null);
        const endsAt = Math.floor(Date.now() / 1000) + seconds;
        const id = ctx.repos.giveaways.insert({ guildId: guild.id, channelId: channel.id, hostId: ctx.user.id, prize, winnerCount: winners, endsAt });
        const record = ctx.repos.giveaways.get(id);
        const message = await channel.send({ embeds: [giveawayEmbed(record, 0)], components: [enterRow(id)], allowedMentions: NO_MENTIONS });
        ctx.repos.giveaways.setMessage(id, message.id);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'giveaway.started', targetId: channel.id, details: { giveawayId: id } });
        await ctx.respond({ embeds: [ui.success('Giveaway started', `Giveaway #${id} is live in <#${channel.id}>.`)] });
      },
    },
    end: {
      description: 'End an active giveaway now and pick winners',
      permissions: manage,
      options: [{ type: 'integer', name: 'id', description: 'Giveaway ID', required: true, min: 1 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const id = ctx.interaction.options.getInteger('id', true);
        const g = ctx.repos.giveaways.get(id);
        if (!g || g.guild_id !== guild.id) throw new UserError('No giveaway with that ID in this server.', { code: 'NOT_FOUND' });
        if (g.status !== 'active') throw new UserError('That giveaway is not active.', { code: 'NOT_ACTIVE' });
        const entries = ctx.repos.giveaways.entries(id);
        const picked = pickWinners(entries, g.winner_count, (m) => randomInt(m));
        ctx.repos.giveaways.finish(id, picked);
        await refreshGiveawayMessage(ctx, id);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'giveaway.ended', targetId: g.channel_id, details: { giveawayId: id, winners: picked.length } });
        await ctx.respond({ embeds: [ui.success('Giveaway ended', `Winners selected: ${picked.length}. Entries: ${entries.length}.`)] });
      },
    },
    reroll: {
      description: 'Pick new winners for an ended giveaway',
      permissions: manage,
      options: [{ type: 'integer', name: 'id', description: 'Giveaway ID', required: true, min: 1 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const id = ctx.interaction.options.getInteger('id', true);
        const g = ctx.repos.giveaways.get(id);
        if (!g || g.guild_id !== guild.id) throw new UserError('No giveaway with that ID in this server.', { code: 'NOT_FOUND' });
        if (g.status !== 'ended') throw new UserError('Only ended giveaways can be rerolled.', { code: 'NOT_ENDED' });
        const previous = new Set(g.winners ? JSON.parse(g.winners) : []);
        const candidates = ctx.repos.giveaways.entries(id).filter((u) => !previous.has(u));
        if (!candidates.length) throw new UserError('No other entries are available to reroll.', { code: 'NO_CANDIDATES' });
        const picked = pickWinners(candidates, g.winner_count, (m) => randomInt(m));
        ctx.repos.giveaways.setWinners(id, picked);
        await refreshGiveawayMessage(ctx, id);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'giveaway.rerolled', details: { giveawayId: id } });
        await ctx.respond({ embeds: [ui.success('Giveaway rerolled', `New winner(s): ${picked.map((w) => `user ${w}`).join(', ')}`)] });
      },
    },
    list: {
      description: 'List recent giveaways in this server',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const rows = ctx.repos.giveaways.list(guild.id, 10);
        const body = rows.length ? rows.map((g) => `**#${g.id}** ${g.status} — ${sanitizeText(g.prize, { maxLength: 60 })}`).join('\n') : 'No giveaways yet.';
        await ctx.respond({ embeds: [ui.info('Giveaways', body)] });
      },
    },
  },
});

