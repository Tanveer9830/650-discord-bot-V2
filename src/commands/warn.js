'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { canActOnMember, assertOk } = require('../security/permissions');
const { UserError } = require('../utils/errors');
const ui = require('../utils/ui');
const { requireGuild, fetchMember, botMember, cleanReason, recordModCase } = require('./helpers');

const MAX_ACTIVE_WARNINGS = 100;

module.exports = defineModule({
  name: 'warn',
  description: 'Manage member warnings (recorded, auditable, reversible)',
  category: 'moderation',
  dmPermission: false,
  defaultMemberPermissions: [PermissionFlagsBits.ModerateMembers],
  actions: {
    add: {
      description: 'Warn a member with a reason',
      permissions: [PermissionFlagsBits.ModerateMembers],
      options: [
        { type: 'user', name: 'user', description: 'Member to warn', required: true },
        { type: 'string', name: 'reason', description: 'Reason for the warning', required: true, minLength: 1, maxLength: 450 },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const reason = cleanReason(ctx.interaction.options.getString('reason', true));
        if (user.id === ctx.user.id) throw new UserError('You cannot warn yourself.', { code: 'SELF' });
        const target = await fetchMember(guild, user.id);
        if (target) {
          const bot = await botMember(guild);
          const actor = ctx.member || (await fetchMember(guild, ctx.user.id));
          assertOk(canActOnMember({ actor, target, bot, guildOwnerId: guild.ownerId }));
        }
        const active = ctx.repos.warnings.listActive(guild.id, user.id, MAX_ACTIVE_WARNINGS);
        if (active.length >= MAX_ACTIVE_WARNINGS) throw new UserError('This member has reached the active warning limit.', { code: 'LIMIT' });
        const id = ctx.repos.warnings.add({ guildId: guild.id, userId: user.id, moderatorId: ctx.user.id, reason });
        const caseId = await recordModCase(ctx, { action: 'warn', targetId: user.id, reason });
        await ctx.respond({ embeds: [ui.success('Warning recorded', `Warning #${id} (case #${caseId}). Active warnings: ${active.length + 1}.`)] });
      },
    },
    list: {
      description: 'List a member\u2019s active warnings',
      permissions: [PermissionFlagsBits.ModerateMembers],
      options: [{ type: 'user', name: 'user', description: 'Member to check', required: true }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const rows = ctx.repos.warnings.listActive(guild.id, user.id, 25);
        const body = rows.length ? rows.map((w) => `**#${w.id}** — ${w.reason} (${w.created_at.slice(0, 10)})`).join('\n') : 'No active warnings.';
        await ctx.respond({ embeds: [ui.info('Active warnings', body)] });
      },
    },
    remove: {
      description: 'Deactivate one warning by its ID',
      permissions: [PermissionFlagsBits.ModerateMembers],
      options: [
        { type: 'user', name: 'user', description: 'Member the warning belongs to', required: true },
        { type: 'integer', name: 'warning_id', description: 'Warning ID from /warn list', required: true, min: 1 },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        const id = ctx.interaction.options.getInteger('warning_id', true);
        const changed = ctx.repos.warnings.deactivate(guild.id, user.id, id);
        if (!changed) throw new UserError('No active warning with that ID for this member.', { code: 'NOT_FOUND' });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'warn.removed', targetId: user.id, details: { warningId: id } });
        await ctx.respond({ embeds: [ui.success('Warning removed', `Warning #${id} deactivated.`)] });
      },
    },
    clear: {
      description: 'Deactivate all active warnings for a member',
      permissions: [PermissionFlagsBits.ModerateMembers],
      options: [
        { type: 'user', name: 'user', description: 'Member to clear', required: true },
        { type: 'boolean', name: 'confirm', description: 'Set to true to confirm clearing all warnings', required: true },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        if (!ctx.interaction.options.getBoolean('confirm', true)) throw new UserError('Set confirm to true to clear warnings.', { code: 'CONFIRM' });
        const count = ctx.repos.warnings.clear(guild.id, user.id);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'warn.cleared', targetId: user.id, details: { count } });
        await ctx.respond({ embeds: [ui.success('Warnings cleared', `${count} warning(s) deactivated.`)] });
      },
    },
  },
});
