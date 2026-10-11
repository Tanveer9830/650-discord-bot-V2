'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { defineModule } = require('./framework');
const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { requireGuild } = require('./helpers');

const manage = [PermissionFlagsBits.ManageGuild];
const MAX_OPEN_TICKETS = 100;
const CLOSE_DELAY_MS = 5000;

function channelSlug(name) {
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `ticket-${slug || 'member'}`;
}

module.exports = defineModule({
  name: 'ticket',
  description: 'Private support tickets for members',
  category: 'community',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    setup: {
      description: 'Choose the ticket category and support role',
      permissions: manage,
      botPermissions: [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles],
      options: [
        { type: 'channel', name: 'category', description: 'Category where tickets are created', required: true, channelTypes: ['GuildCategory'] },
        { type: 'role', name: 'support_role', description: 'Role that can see every ticket', required: true },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const category = ctx.interaction.options.getChannel('category', true);
        const role = ctx.interaction.options.getRole('support_role', true);
        ctx.repos.guild.update(guild.id, { ticket_category_id: category.id, ticket_support_role_id: role.id });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'ticket.setup', targetId: category.id, details: { supportRoleId: role.id } });
        await ctx.respond({ embeds: [ui.success('Tickets configured', `Category: \`${category.id}\`\nSupport role: \`${role.id}\``)] });
      },
    },
    open: {
      description: 'Open a private support ticket',
      botPermissions: [PermissionFlagsBits.ManageChannels],
      options: [{ type: 'string', name: 'topic', description: 'What do you need help with?', required: false, maxLength: 300 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const settings = ctx.repos.guild.get(guild.id);
        if (!settings || !settings.ticket_category_id || !settings.ticket_support_role_id) {
          throw new UserError('Tickets are not configured yet. Ask a server admin to run /ticket setup.', { code: 'NOT_CONFIGURED' });
        }
        if (ctx.repos.tickets.openForUser(guild.id, ctx.user.id)) throw new UserError('You already have an open ticket.', { code: 'DUPLICATE' });
        if (ctx.repos.tickets.countOpen(guild.id) >= MAX_OPEN_TICKETS) throw new UserError('Too many tickets are open right now. Please try later.', { code: 'LIMIT' });
        const topic = sanitizeText(ctx.interaction.options.getString('topic') || 'No topic given', { maxLength: 300 });
        const everyone = guild.roles.everyone.id;
        const bot = guild.members.me;
        const channel = await guild.channels.create({
          name: channelSlug(ctx.user.username),
          type: ChannelType.GuildText,
          parent: settings.ticket_category_id,
          topic: `Ticket for opener ID ${ctx.user.id}`,
          permissionOverwrites: [
            { id: everyone, deny: [PermissionFlagsBits.ViewChannel] },
            { id: ctx.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: settings.ticket_support_role_id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
            ...(bot ? [{ id: bot.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] }] : []),
          ],
          reason: `Ticket opened by ${ctx.user.id}`,
        });
        ctx.repos.tickets.insert({ guildId: guild.id, channelId: channel.id, openerId: ctx.user.id });
        await channel.send({
          embeds: [ui.info('Support ticket', `Opened by **${sanitizeText(ctx.user.username, { maxLength: 64 })}**\nTopic: ${topic}\n\nA staff member will reply here. Use \`/ticket close\` when finished.`)],
          allowedMentions: { parse: [] },
        });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'ticket.opened', targetId: channel.id });
        await ctx.respond({ embeds: [ui.success('Ticket opened', `Go to <#${channel.id}>`)] });
      },
    },
    close: {
      description: 'Close the ticket in this channel',
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const ticket = ctx.repos.tickets.byChannel(ctx.interaction.channelId);
        if (!ticket || ticket.status !== 'open' || ticket.guild_id !== guild.id) throw new UserError('This is not an open ticket channel.', { code: 'NOT_TICKET' });
        const settings = ctx.repos.guild.get(guild.id) || {};
        const isOpener = ticket.opener_id === ctx.user.id;
        const isStaff = ctx.member && settings.ticket_support_role_id && ctx.member.roles.cache.has(settings.ticket_support_role_id);
        const canManage = ctx.member && ctx.member.permissions.has(PermissionFlagsBits.ManageChannels);
        if (!isOpener && !isStaff && !canManage && !ctx.isGlobalOwner) {
          throw new UserError('Only the opener or support staff can close this ticket.', { code: 'NOT_ALLOWED' });
        }
        ctx.repos.tickets.close(ctx.interaction.channelId, ctx.user.id);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'ticket.closed', targetId: ctx.interaction.channelId });
        await ctx.respond({ embeds: [ui.success('Ticket closed', 'This channel will be deleted in 5 seconds.')], ephemeral: false });
        const channel = ctx.interaction.channel;
        setTimeout(() => {
          channel.delete(`Ticket closed by ${ctx.user.id}`).catch((e) => ctx.logger.warn('Ticket channel deletion failed', { reason: e.message }));
        }, CLOSE_DELAY_MS).unref();
      },
    },
  },
});
