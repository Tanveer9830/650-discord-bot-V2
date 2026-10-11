'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { canManageRole, assertOk } = require('../security/permissions');
const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { buttonRow } = require('../utils/components');
const { requireGuild, requireTextChannel, botMember, fetchMember } = require('./helpers');

const manage = [PermissionFlagsBits.ManageRoles];

module.exports = defineModule({
  name: 'buttonroles',
  description: 'Post a panel where members toggle roles with buttons',
  category: 'community',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    create: {
      description: 'Post a button-role panel in this channel (up to 3 roles)',
      permissions: manage,
      botPermissions: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
      options: [
        { type: 'string', name: 'title', description: 'Panel title', required: true, minLength: 1, maxLength: 100 },
        { type: 'role', name: 'role1', description: 'First role', required: true },
        { type: 'role', name: 'role2', description: 'Second role', required: false },
        { type: 'role', name: 'role3', description: 'Third role', required: false },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = requireTextChannel(ctx.interaction.channel);
        const title = sanitizeText(ctx.interaction.options.getString('title', true), { maxLength: 100 });
        const roles = [1, 2, 3].map((i) => ctx.interaction.options.getRole(`role${i}`)).filter(Boolean);
        const unique = [...new Map(roles.map((r) => [r.id, r])).values()];
        if (unique.length !== roles.length) throw new UserError('Each role may appear only once in a panel.', { code: 'DUPLICATE' });
        const bot = await botMember(guild);
        const actor = ctx.member || (await fetchMember(guild, ctx.user.id));
        for (const role of unique) assertOk(canManageRole({ actor, role, bot, guildOwnerId: guild.ownerId }));
        const row = buttonRow(unique.map((role) => ({
          customId: `brole:${role.id}`,
          label: sanitizeText(role.name, { maxLength: 40 }),
          style: 'Primary',
        })));
        await channel.send({
          embeds: [ui.info(title, 'Press a button to add or remove the matching role.')],
          components: [row],
        });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'buttonroles.created', targetId: channel.id, details: { roles: unique.map((r) => r.id) } });
        await ctx.respond({ embeds: [ui.success('Panel posted', `Added ${unique.length} role button(s).`)] });
      },
    },
  },
});
