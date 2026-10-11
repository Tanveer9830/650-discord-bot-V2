'use strict';

const { defineModule } = require('./framework');
const { PermissionFlagsBits } = require('discord.js');
const { renderCompactBanner } = require('../branding');
const { missingPermissions, flagNames } = require('../security/permissions');
const { botMember } = require('./helpers');
const ui = require('../utils/ui');

const { REQUIRED_BOT_PERMISSIONS } = require('../security/botPermissions');

module.exports = defineModule({
  name: 'diagnostics',
  description: 'Health checks and permission diagnostics',
  category: 'utility',
  dmPermission: false,
  defaultMemberPermissions: [PermissionFlagsBits.ManageGuild],
  actions: {
    status: {
      description: 'Show bot health (uptime, latency, database)',
      guildOnly: false,
      cooldownMs: 5000,
      category: 'utility',
      run: async (ctx) => {
        let dbOk = true;
        try {
          ctx.repos.db.prepare('SELECT 1 AS ok').get();
        } catch {
          dbOk = false;
        }
        const ws = ctx.client ? ctx.client.ws.ping : -1;
        const banner = renderCompactBanner({ color: false, width: 60 });
        await ctx.respond({
          content: `\`\`\`\n${banner}\n\`\`\``,
          embeds: [ui.info('Bot health', undefined).addFields(
            { name: 'Gateway', value: ws >= 0 ? `${ws} ms` : 'unavailable', inline: true },
            { name: 'Database', value: dbOk ? 'OK' : 'ERROR', inline: true },
            { name: 'Uptime', value: `${Math.floor(process.uptime())} s`, inline: true },
          )],
        });
      },
    },
    permissions: {
      description: 'Check that the bot has the server permissions it needs',
      category: 'administration',
      cooldownMs: 5000,
      run: async (ctx) => {
        const me = await botMember(ctx.guild);
        const missing = flagNames(missingPermissions(me, REQUIRED_BOT_PERMISSIONS));
        const embed = missing.length
          ? ui.warn('Missing permissions', `The bot is missing: ${missing.join(', ')}`)
          : ui.success('Permissions OK', 'The bot has every permission the commands in this build need.');
        await ctx.respond({ embeds: [embed] });
      },
    },
  },
});

