'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { parseHexColor } = require('../utils/color');
const { sanitizeText, NO_MENTIONS } = require('../utils/text');
const ui = require('../utils/ui');
const { requireGuild, requireTextChannel } = require('./helpers');

module.exports = defineModule({
  name: 'embed',
  description: 'Post a custom embed to this channel',
  category: 'administration',
  dmPermission: false,
  defaultMemberPermissions: [PermissionFlagsBits.ManageMessages],
  actions: {
    create: {
      description: 'Post a custom embed (title, text, colour)',
      permissions: [PermissionFlagsBits.ManageMessages],
      botPermissions: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
      options: [
        { type: 'string', name: 'title', description: 'Embed title (max 256)', required: true, minLength: 1, maxLength: 256 },
        { type: 'string', name: 'description', description: 'Embed text (max 4000)', required: true, minLength: 1, maxLength: 4000 },
        { type: 'string', name: 'color', description: 'Colour such as #3B82F6', required: false, maxLength: 7 },
      ],
      cooldownMs: 5000,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = requireTextChannel(ctx.interaction.channel);
        const title = sanitizeText(ctx.interaction.options.getString('title', true), { maxLength: 256 });
        const description = sanitizeText(ctx.interaction.options.getString('description', true), { maxLength: 4000 });
        const color = parseHexColor(ctx.interaction.options.getString('color')) ?? ui.COLORS.primary;
        await channel.send({ embeds: [ui.info(title, description, color)], allowedMentions: NO_MENTIONS });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'embed.posted', targetId: channel.id });
        await ctx.respond({ embeds: [ui.success('Embed posted', 'Your embed was posted in this channel.')] });
      },
    },
  },
});
