'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { defineModule } = require('./framework');
const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { requireGuild } = require('./helpers');

const MESSAGE_PLACEHOLDERS = 'Placeholders: {server}, {members}, {member}';
const channelOpt = (description) => ({ type: 'channel', name: 'channel', description, required: true, channelTypes: ['GuildText', 'GuildAnnouncement'] });
const messageOpt = { type: 'string', name: 'message', description: `Message text. ${MESSAGE_PLACEHOLDERS}`, required: true, minLength: 1, maxLength: 1000 };

function validateTemplate(text) {
  const unknown = [...text.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]).filter((p) => !['server', 'members', 'member'].includes(p));
  if (unknown.length) throw new UserError(`Unknown placeholder(s): ${[...new Set(unknown)].join(', ')}.`, { code: 'PLACEHOLDER' });
  return text;
}

/** Shared for welcome/goodbye: writes a text channel and template into guild settings. */
function templateAction({ channelField, messageField, label }) {
  return {
    set: {
      description: `Set the ${label} channel and message`,
      permissions: [PermissionFlagsBits.ManageGuild],
      options: [channelOpt(`Channel for ${label} messages`), messageOpt],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = ctx.interaction.options.getChannel('channel', true);
        if (!channel.isTextBased() || channel.isDMBased() || channel.type === ChannelType.GuildVoice) {
          throw new UserError('Pick a text channel.', { code: 'CHANNEL_TYPE' });
        }
        const message = validateTemplate(ctx.interaction.options.getString('message', true));
        ctx.repos.guild.update(guild.id, { [channelField]: channel.id, [messageField]: message });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: `config.${label}.set`, targetId: channel.id });
        await ctx.respond({ embeds: [ui.success(`${label[0].toUpperCase()}${label.slice(1)} messages enabled`, `Channel ID: ${channel.id}\nPreview: ${sanitizeText(message.replace('{server}', guild.name).replace('{members}', String(guild.memberCount ?? 0)).replace('{member}', 'New member'), { maxLength: 300 })}`)] });
      },
    },
    disable: {
      description: `Turn off ${label} messages`,
      permissions: [PermissionFlagsBits.ManageGuild],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        ctx.repos.guild.update(guild.id, { [channelField]: null, [messageField]: null });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: `config.${label}.disabled` });
        await ctx.respond({ embeds: [ui.success(`${label[0].toUpperCase()}${label.slice(1)} messages disabled`, 'Settings cleared.')] });
      },
    },
  };
}

module.exports = defineModule({
  name: 'config',
  description: 'Server configuration: overview, welcome, goodbye, and logging',
  category: 'administration',
  dmPermission: false,
  defaultMemberPermissions: [PermissionFlagsBits.ManageGuild],
  actions: {
    view: {
      description: 'Show this server\u2019s current configuration',
      permissions: [PermissionFlagsBits.ManageGuild],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const s = ctx.repos.guild.get(guild.id) || {};
        const show = (v) => (v ? `\`${v}\`` : 'not set');
        await ctx.respond({
          embeds: [ui.info('Server configuration', undefined).addFields(
            { name: 'Log channel', value: show(s.log_channel_id), inline: true },
            { name: 'Welcome channel', value: show(s.welcome_channel_id), inline: true },
            { name: 'Goodbye channel', value: show(s.goodbye_channel_id), inline: true },
            { name: 'Verify role', value: show(s.verify_role_id), inline: true },
            { name: 'Ticket category', value: show(s.ticket_category_id), inline: true },
            { name: 'Ticket support role', value: show(s.ticket_support_role_id), inline: true },
          )],
        });
      },
    },
  },
  groups: {
    welcome: { description: 'Welcome messages for new members', actions: templateAction({ channelField: 'welcome_channel_id', messageField: 'welcome_message', label: 'welcome' }) },
    goodbye: { description: 'Goodbye messages for members who leave', actions: templateAction({ channelField: 'goodbye_channel_id', messageField: 'goodbye_message', label: 'goodbye' }) },
    logs: {
      description: 'Moderation and security log channel',
      actions: {
        set: {
          description: 'Set the moderation and security log channel',
          permissions: [PermissionFlagsBits.ManageGuild],
          options: [channelOpt('Channel that receives moderation logs')],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const channel = ctx.interaction.options.getChannel('channel', true);
            if (!channel.isTextBased() || channel.isDMBased()) throw new UserError('Pick a text channel.', { code: 'CHANNEL_TYPE' });
            ctx.repos.guild.update(guild.id, { log_channel_id: channel.id });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'config.logs.set', targetId: channel.id });
            await ctx.respond({ embeds: [ui.success('Log channel set', `Channel ID: \`${channel.id}\``)] });
          },
        },
        disable: {
          description: 'Stop posting moderation logs',
          permissions: [PermissionFlagsBits.ManageGuild],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            ctx.repos.guild.update(guild.id, { log_channel_id: null });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'config.logs.disabled' });
            await ctx.respond({ embeds: [ui.success('Log channel disabled', 'Moderation logs will no longer be posted.')] });
          },
        },
      },
    },
  },
});
