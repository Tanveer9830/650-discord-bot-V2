'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { canManageRole, assertOk, canActOnMember } = require('../security/permissions');
const { UserError } = require('../utils/errors');
const { parseHexColor } = require('../utils/color');
const ui = require('../utils/ui');
const { requireGuild, fetchMember, botMember, cleanReason } = require('./helpers');

const manage = [PermissionFlagsBits.ManageRoles];
const roleOpt = { type: 'role', name: 'role', description: 'Role to change', required: true };
const userOpt = { type: 'user', name: 'user', description: 'Member to change', required: true };

async function checkRole(ctx, guild, role) {
  const bot = await botMember(guild);
  const actor = ctx.member || (await fetchMember(guild, ctx.user.id));
  assertOk(canManageRole({ actor, role, bot, guildOwnerId: guild.ownerId }));
  return bot;
}

module.exports = defineModule({
  name: 'role',
  description: 'Create, delete, assign, and remove server roles',
  category: 'administration',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    create: {
      description: 'Create a new role',
      permissions: manage,
      botPermissions: manage,
      options: [
        { type: 'string', name: 'name', description: 'Role name (1-100 characters)', required: true, minLength: 1, maxLength: 100 },
        { type: 'string', name: 'color', description: 'Hex colour such as #3B82F6', required: false, maxLength: 7 },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const name = ctx.interaction.options.getString('name', true).trim();
        const color = parseHexColor(ctx.interaction.options.getString('color'));
        const role = await guild.roles.create({ name, color: color ?? undefined, reason: `Created by ${ctx.user.id} via bot` });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'role.created', targetId: role.id });
        await ctx.respond({ embeds: [ui.success('Role created', `Role ID: \`${role.id}\``)] });
      },
    },
    delete: {
      description: 'Delete a role (requires confirm=true)',
      permissions: manage,
      botPermissions: manage,
      options: [
        roleOpt,
        { type: 'boolean', name: 'confirm', description: 'Set to true to delete the role permanently', required: true },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const role = ctx.interaction.options.getRole('role', true);
        if (!ctx.interaction.options.getBoolean('confirm', true)) throw new UserError('Set confirm to true to delete this role.', { code: 'CONFIRM' });
        await checkRole(ctx, guild, role);
        await role.delete(`Deleted by ${ctx.user.id} via bot`);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'role.deleted', targetId: role.id });
        await ctx.respond({ embeds: [ui.success('Role deleted', 'The role has been removed from the server.')] });
      },
    },
    assign: {
      description: 'Give a role to a member',
      permissions: manage,
      botPermissions: manage,
      options: [userOpt, roleOpt],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const role = ctx.interaction.options.getRole('role', true);
        const target = await fetchMember(guild, user.id);
        if (!target) throw new UserError('That user is not in this server.', { code: 'NOT_MEMBER' });
        if (target.roles.cache.has(role.id)) throw new UserError('The member already has that role.', { code: 'ALREADY' });
        const bot = await checkRole(ctx, guild, role);
        assertOk(canActOnMember({ actor: ctx.member || (await fetchMember(guild, ctx.user.id)), target, bot, guildOwnerId: guild.ownerId }));
        await target.roles.add(role, `Assigned by ${ctx.user.id} via bot`);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'role.assigned', targetId: user.id, details: { roleId: role.id } });
        await ctx.respond({ embeds: [ui.success('Role assigned', `Role ID \`${role.id}\` added.`)] });
      },
    },
    remove: {
      description: 'Remove a role from a member',
      permissions: manage,
      botPermissions: manage,
      options: [userOpt, roleOpt, { type: 'string', name: 'reason', description: 'Reason for the audit log', required: false, maxLength: 200 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const role = ctx.interaction.options.getRole('role', true);
        const reason = cleanReason(ctx.interaction.options.getString('reason'), 'No reason');
        const target = await fetchMember(guild, user.id);
        if (!target) throw new UserError('That user is not in this server.', { code: 'NOT_MEMBER' });
        if (!target.roles.cache.has(role.id)) throw new UserError('The member does not have that role.', { code: 'NOT_HELD' });
        const bot = await checkRole(ctx, guild, role);
        assertOk(canActOnMember({ actor: ctx.member || (await fetchMember(guild, ctx.user.id)), target, bot, guildOwnerId: guild.ownerId }));
        await target.roles.remove(role, `${reason} (by ${ctx.user.id})`);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'role.removed', targetId: user.id, details: { roleId: role.id } });
        await ctx.respond({ embeds: [ui.success('Role removed', `Role ID \`${role.id}\` removed.`)] });
      },
    },
  },
});
