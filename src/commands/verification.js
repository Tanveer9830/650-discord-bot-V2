'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { canManageRole, assertOk } = require('../security/permissions');
const { UserError } = require('../utils/errors');
const ui = require('../utils/ui');
const { buttonRow } = require('../utils/components');
const { requireGuild, requireTextChannel, botMember, fetchMember } = require('./helpers');

const manage = [PermissionFlagsBits.ManageGuild];

module.exports = defineModule({
  name: 'verification',
  description: 'Member verification: a button that grants a role',
  category: 'community',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    setup: {
      description: 'Post a verify button that grants a role',
      permissions: manage,
      botPermissions: [PermissionFlagsBits.ManageRoles, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks],
      options: [{ type: 'role', name: 'role', description: 'Role granted when a member verifies', required: true }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const channel = requireTextChannel(ctx.interaction.channel);
        const role = ctx.interaction.options.getRole('role', true);
        const bot = await botMember(guild);
        const actor = ctx.member || (await fetchMember(guild, ctx.user.id));
        assertOk(canManageRole({ actor, role, bot, guildOwnerId: guild.ownerId }));
        if (role.id === guild.id) throw new UserError('@everyone cannot be the verification role.', { code: 'ROLE' });
        ctx.repos.guild.update(guild.id, { verify_role_id: role.id });
        await channel.send({
          embeds: [ui.info('Verification', 'Press the button below to verify and gain access to the server.')],
          components: [buttonRow([{ customId: 'verify:start', label: 'Verify me', style: 'Success' }])],
        });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'verification.setup', targetId: channel.id, details: { roleId: role.id } });
        await ctx.respond({ embeds: [ui.success('Verification enabled', 'The verify panel has been posted.')] });
      },
    },
    disable: {
      description: 'Stop granting the verification role',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        ctx.repos.guild.update(guild.id, { verify_role_id: null });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'verification.disabled' });
        await ctx.respond({ embeds: [ui.success('Verification disabled', 'Existing panels will no longer grant a role.')] });
      },
    },
  },
});
