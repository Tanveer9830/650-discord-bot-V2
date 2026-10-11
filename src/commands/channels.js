'use strict';

const { PermissionFlagsBits, ChannelType } = require('discord.js');
const { defineModule } = require('./framework');
const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { requireGuild } = require('./helpers');

const manage = [PermissionFlagsBits.ManageChannels];
const channelOpt = { type: 'channel', name: 'channel', description: 'Channel (defaults to this channel)', required: false, channelTypes: ['GuildText', 'GuildAnnouncement'] };

function targetChannel(ctx) {
  const chosen = ctx.interaction.options.getChannel('channel');
  const channel = chosen || ctx.interaction.channel;
  if (!channel || !channel.isTextBased() || channel.isDMBased()) throw new UserError('Pick a text channel in this server.', { code: 'CHANNEL_TYPE' });
  return channel;
}

async function setSendPermission(ctx, channel, allowed) {
  const everyone = ctx.guild.roles.everyone;
  await channel.permissionOverwrites.edit(everyone, { SendMessages: allowed ? null : false }, {
    reason: `${allowed ? 'Unlocked' : 'Locked'} by ${ctx.user.id} via bot`,
  });
}

module.exports = defineModule({
  name: 'channel',
  description: 'Channel administration: lock, unlock, slowmode, and topic',
  category: 'administration',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    lock: {
      description: 'Stop @everyone from sending messages in a channel',
      permissions: manage,
      botPermissions: manage,
      options: [channelOpt],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = targetChannel(ctx);
        await setSendPermission(ctx, channel, false);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'channel.locked', targetId: channel.id });
        await ctx.respond({ embeds: [ui.success('Channel locked', `Locked channel ID \`${channel.id}\`.`)] });
      },
    },
    unlock: {
      description: 'Restore default send permission for @everyone',
      permissions: manage,
      botPermissions: manage,
      options: [channelOpt],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = targetChannel(ctx);
        await setSendPermission(ctx, channel, true);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'channel.unlocked', targetId: channel.id });
        await ctx.respond({ embeds: [ui.success('Channel unlocked', `Unlocked channel ID \`${channel.id}\`.`)] });
      },
    },
    slowmode: {
      description: 'Set slowmode for a channel (0 disables)',
      permissions: manage,
      botPermissions: manage,
      options: [
        { type: 'integer', name: 'seconds', description: 'Seconds between messages (0-21600)', required: true, min: 0, max: 21600 },
        channelOpt,
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = targetChannel(ctx);
        const seconds = ctx.interaction.options.getInteger('seconds', true);
        await channel.setRateLimitPerUser(seconds, `Set by ${ctx.user.id} via bot`);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'channel.slowmode', targetId: channel.id, details: { seconds } });
        await ctx.respond({ embeds: [ui.success('Slowmode updated', seconds ? `${seconds}s between messages.` : 'Slowmode disabled.')] });
      },
    },
    topic: {
      description: 'Set a channel topic',
      permissions: manage,
      botPermissions: manage,
      options: [
        { type: 'string', name: 'text', description: 'Topic text (max 1024 characters)', required: true, minLength: 0, maxLength: 1024 },
        channelOpt,
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = targetChannel(ctx);
        const text = sanitizeText(ctx.interaction.options.getString('text', true), { maxLength: 1024 });
        await channel.setTopic(text, `Set by ${ctx.user.id} via bot`);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'channel.topic', targetId: channel.id });
        await ctx.respond({ embeds: [ui.success('Topic updated', 'The channel topic has been changed.')] });
      },
    },
  },
});

