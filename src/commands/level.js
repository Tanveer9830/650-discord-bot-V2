'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { canManageRole, assertOk } = require('../security/permissions');
const { UserError } = require('../utils/errors');
const { sanitizeText, NO_MENTIONS } = require('../utils/text');
const { xpForLevel } = require('../services/leveling');
const ui = require('../utils/ui');
const { requireGuild, fetchMember, botMember } = require('./helpers');

const manage = [PermissionFlagsBits.ManageGuild];

module.exports = defineModule({
  name: 'level',
  description: 'XP, levels, leaderboards, and level-up role rewards',
  category: 'community',
  dmPermission: false,
  actions: {
    rank: {
      description: 'Show a member\u2019s level and XP',
      options: [{ type: 'user', name: 'user', description: 'Member to check (default: you)', required: false }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user') || ctx.user;
        const u = ctx.repos.levels.user(guild.id, user.id);
        const next = xpForLevel(u.level + 1);
        await ctx.respond({
          embeds: [ui.info(`Rank: ${sanitizeText(user.username, { maxLength: 64 })}`, `Level **${u.level}** · XP **${u.xp}** · next level at **${next}** XP`)],
          allowedMentions: NO_MENTIONS,
        });
      },
    },
    leaderboard: {
      description: 'Top members by XP',
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const rows = ctx.repos.levels.leaderboard(guild.id, 10);
        const body = rows.length ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — level ${r.level} (${r.xp} XP)`).join('\n') : 'No XP recorded yet.';
        await ctx.respond({ embeds: [ui.info('XP leaderboard', body)], ephemeral: false });
      },
    },
    setup: {
      description: 'Enable leveling and choose where level-up notices are posted',
      permissions: manage,
      options: [
        { type: 'boolean', name: 'enabled', description: 'Enable XP gain from messages', required: true },
        { type: 'channel', name: 'announce_channel', description: 'Where level-ups are announced (default: no announcements)', required: false, channelTypes: ['GuildText', 'GuildAnnouncement'] },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const enabled = ctx.interaction.options.getBoolean('enabled', true);
        const channel = ctx.interaction.options.getChannel('announce_channel');
        const saved = ctx.repos.levels.updateSettings(guild.id, { enabled, announceChannelId: channel ? channel.id : undefined });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'level.configured', details: { enabled } });
        await ctx.respond({ embeds: [ui.success('Leveling updated', `Enabled: ${saved.enabled ? 'yes' : 'no'}\nAnnouncements: ${saved.announce_channel_id ? `<#${saved.announce_channel_id}>` : 'off'}`)] });
      },
    },
  },
  groups: {
    roles: {
      description: 'Roles granted when members reach a level',
      actions: {
        add: {
          description: 'Grant a role when a member reaches a level',
          permissions: manage,
          botPermissions: [PermissionFlagsBits.ManageRoles],
          options: [
            { type: 'integer', name: 'level', description: 'Level required (1-500)', required: true, min: 1, max: 500 },
            { type: 'role', name: 'role', description: 'Role to grant', required: true },
          ],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const level = ctx.interaction.options.getInteger('level', true);
            const role = ctx.interaction.options.getRole('role', true);
            const bot = await botMember(guild);
            const actor = ctx.member || (await fetchMember(guild, ctx.user.id));
            assertOk(canManageRole({ actor, role, bot, guildOwnerId: guild.ownerId }));
            ctx.repos.levels.setLevelRole(guild.id, level, role.id);
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'level.role.added', targetId: role.id, details: { level } });
            await ctx.respond({ embeds: [ui.success('Level role saved', `Level ${level} grants role \`${role.id}\`.`)] });
          },
        },
        remove: {
          description: 'Stop granting a role at a level',
          permissions: manage,
          options: [{ type: 'integer', name: 'level', description: 'Level whose reward to remove', required: true, min: 1, max: 500 }],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const level = ctx.interaction.options.getInteger('level', true);
            if (!ctx.repos.levels.removeLevelRole(guild.id, level)) throw new UserError('No role reward exists for that level.', { code: 'NOT_FOUND' });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'level.role.removed', details: { level } });
            await ctx.respond({ embeds: [ui.success('Level role removed', `Level ${level} no longer grants a role.`)] });
          },
        },
      },
    },
  },
});
