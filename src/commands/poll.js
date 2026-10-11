'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { UserError } = require('../utils/errors');
const { sanitizeText, NO_MENTIONS } = require('../utils/text');
const ui = require('../utils/ui');
const { pollEmbed, pollRows } = require('../services/pollView');
const { requireGuild, requireTextChannel } = require('./helpers');

const manage = [PermissionFlagsBits.ManageMessages];

module.exports = defineModule({
  name: 'poll',
  description: 'Create polls with button voting (one vote per member)',
  category: 'community',
  dmPermission: false,
  defaultMemberPermissions: [],
  actions: {
    create: {
      description: 'Create a poll with 2-4 options',
      guildOnly: true,
      botPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
      options: [
        { type: 'string', name: 'question', description: 'Poll question', required: true, minLength: 1, maxLength: 300 },
        { type: 'string', name: 'option1', description: 'First option', required: true, minLength: 1, maxLength: 80 },
        { type: 'string', name: 'option2', description: 'Second option', required: true, minLength: 1, maxLength: 80 },
        { type: 'string', name: 'option3', description: 'Third option (optional)', required: false, minLength: 1, maxLength: 80 },
        { type: 'string', name: 'option4', description: 'Fourth option (optional)', required: false, minLength: 1, maxLength: 80 },
      ],
      cooldownMs: 10000,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = requireTextChannel(ctx.interaction.channel);
        const question = sanitizeText(ctx.interaction.options.getString('question', true), { maxLength: 300 });
        const labels = [1, 2, 3, 4].map((i) => ctx.interaction.options.getString(`option${i}`)).filter((v) => v && v.trim());
        if (labels.length < 2) throw new UserError('A poll needs at least two options.', { code: 'OPTIONS' });
        const clean = labels.map((l) => sanitizeText(l.trim(), { maxLength: 80 }));
        if (new Set(clean.map((c) => c.toLowerCase())).size !== clean.length) throw new UserError('Poll options must be distinct.', { code: 'DUPLICATE' });
        const id = ctx.repos.polls.create({ guildId: guild.id, channelId: channel.id, question, options: clean, createdBy: ctx.user.id });
        const poll = ctx.repos.polls.get(id);
        const options = ctx.repos.polls.options(id);
        const message = await channel.send({ embeds: [pollEmbed(poll, options, [])], components: pollRows(poll, options), allowedMentions: NO_MENTIONS });
        ctx.repos.polls.setMessage(id, message.id);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'poll.created', targetId: channel.id, details: { pollId: id } });
        await ctx.respond({ embeds: [ui.success('Poll created', `Poll #${id} is live in <#${channel.id}>.`)] });
      },
    },
    results: {
      description: 'Show the current tally for a poll',
      guildOnly: true,
      options: [{ type: 'integer', name: 'id', description: 'Poll ID', required: true, min: 1 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const id = ctx.interaction.options.getInteger('id', true);
        const poll = ctx.repos.polls.get(id);
        if (!poll || poll.guild_id !== guild.id) throw new UserError('No poll with that ID in this server.', { code: 'NOT_FOUND' });
        await ctx.respond({ embeds: [pollEmbed(poll, ctx.repos.polls.options(id), ctx.repos.polls.tally(id))] });
      },
    },
    close: {
      description: 'Close a poll so it stops accepting votes',
      guildOnly: true,
      permissions: manage,
      options: [{ type: 'integer', name: 'id', description: 'Poll ID', required: true, min: 1 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const id = ctx.interaction.options.getInteger('id', true);
        const poll = ctx.repos.polls.get(id);
        if (!poll || poll.guild_id !== guild.id) throw new UserError('No poll with that ID in this server.', { code: 'NOT_FOUND' });
        if (!ctx.repos.polls.close(id)) throw new UserError('That poll is already closed.', { code: 'CLOSED' });
        const closed = ctx.repos.polls.get(id);
        try {
          const channel = await ctx.client.channels.fetch(poll.channel_id);
          const message = await channel.messages.fetch(poll.message_id);
          await message.edit({ embeds: [pollEmbed(closed, ctx.repos.polls.options(id), ctx.repos.polls.tally(id))], components: [] });
        } catch (error) {
          ctx.logger.warn('Could not update poll message', { pollId: id, reason: error.message });
        }
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'poll.closed', details: { pollId: id } });
        await ctx.respond({ embeds: [ui.success('Poll closed', `Poll #${id} is closed.`)] });
      },
    },
  },
});

