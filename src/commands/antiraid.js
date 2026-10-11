'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const ui = require('../utils/ui');
const { requireGuild } = require('./helpers');

const manage = [PermissionFlagsBits.ManageGuild];

module.exports = defineModule({
  name: 'antiraid',
  description: 'Detect and respond to bursts of new members joining',
  category: 'security',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    setup: {
      description: 'Configure join-burst detection',
      permissions: manage,
      options: [
        { type: 'boolean', name: 'enabled', description: 'Enable join-burst detection', required: true },
        { type: 'integer', name: 'join_threshold', description: 'Joins within the window that count as a raid (3-200)', required: false, min: 3, max: 200 },
        { type: 'integer', name: 'window_seconds', description: 'Sliding window in seconds (5-600)', required: false, min: 5, max: 600 },
        { type: 'boolean', name: 'kick_new_joins', description: 'Kick joiners while a raid is flagged', required: false },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const fields = { enabled: ctx.interaction.options.getBoolean('enabled', true) ? 1 : 0 };
        const threshold = ctx.interaction.options.getInteger('join_threshold');
        const windowSeconds = ctx.interaction.options.getInteger('window_seconds');
        const kick = ctx.interaction.options.getBoolean('kick_new_joins');
        if (threshold !== null) fields.join_threshold = threshold;
        if (windowSeconds !== null) fields.window_seconds = windowSeconds;
        if (kick !== null) fields.kick_new_joins = kick ? 1 : 0;
        const s = ctx.repos.antiraid.update(guild.id, fields);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'antiraid.configured', details: { enabled: s.enabled } });
        await ctx.respond({ embeds: [ui.success('Anti-raid updated', `Enabled: ${s.enabled ? 'yes' : 'no'}\nThreshold: ${s.join_threshold} joins / ${s.window_seconds}s\nKick joiners during raid: ${s.kick_new_joins ? 'yes' : 'no'}`)] });
      },
    },
    status: {
      description: 'Show anti-raid settings and recent detections',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const s = ctx.repos.antiraid.get(guild.id);
        const incidents = ctx.repos.incidents.recent(guild.id, 5).filter((i) => i.kind === 'raid');
        await ctx.respond({ embeds: [ui.info('Anti-raid status', `Enabled: ${s.enabled ? 'yes' : 'no'}\nThreshold: ${s.join_threshold} joins / ${s.window_seconds}s\nRecent raid detections: ${incidents.length}`)] });
      },
    },
  },
});
