'use strict';

const { defineModule } = require('./framework');
const ui = require('../utils/ui');
const { UserError } = require('../utils/errors');
const { BRAND } = require('../branding');
const { buttonRow } = require('../utils/components');

const OWNER_ONLY = { access: 'owner', category: 'owner', guildOnly: false, cooldownMs: 1000 };

function confirmRow(customPrefix, id) {
  return buttonRow([
    { customId: `owner:${customPrefix}:${id}`, label: 'Confirm change', style: 'Danger' },
    { customId: `owner:cancel:${id}`, label: 'Cancel', style: 'Secondary' },
  ]);
}

module.exports = defineModule({
  name: 'owner',
  description: 'Global owner controls (bot-wide; restricted to global owners)',
  category: 'owner',
  dmPermission: true,
  access: 'owner',
  actions: {
    status: {
      ...OWNER_ONLY,
      description: 'Bot-wide status: servers, owners, and database health',
      run: async (ctx) => {
        const guilds = ctx.client ? ctx.client.guilds.cache.size : 0;
        const owners = ctx.services.owners.listOwners().length;
        let dbOk = true;
        try {
          ctx.repos.db.prepare('SELECT 1 AS ok').get();
        } catch {
          dbOk = false;
        }
        await ctx.respond({
          embeds: [ui.info('Global status', undefined).addFields(
            { name: 'Servers', value: String(guilds), inline: true },
            { name: 'Global owners', value: String(owners), inline: true },
            { name: 'Database', value: dbOk ? 'Reachable' : 'ERROR', inline: true },
            { name: 'Environment', value: ctx.config.env, inline: true },
          )],
        });
      },
    },
    list: {
      ...OWNER_ONLY,
      description: 'List global owners (IDs only)',
      run: async (ctx) => {
        const rows = ctx.services.owners.listOwners().map((o) => `• \`${o.userId}\` — ${o.source === 'config' ? 'configured' : 'database'}`);
        await ctx.respond({ embeds: [ui.info('Global owners', rows.join('\n') || 'None')] });
      },
    },
    add: {
      ...OWNER_ONLY,
      description: 'Propose adding a global owner (requires confirmation)',
      options: [{ type: 'user', name: 'user', description: 'User to make a global owner', required: true }],
      run: async (ctx) => {
        const target = ctx.interaction.options.getUser('user', true);
        if (!ctx.isGlobalOwner) throw new UserError('Only global owners can change global ownership.', { code: 'NOT_OWNER' });
        if (ctx.services.owners.isGlobalOwner(target.id)) throw new UserError('That user is already a global owner.', { code: 'ALREADY_OWNER' });
        const id = ctx.services.confirmations.create({ action: 'owner.add', actorId: ctx.user.id, payload: { targetId: target.id } });
        await ctx.respond({
          embeds: [ui.warn('Confirm: add global owner', `Target ID: \`${target.id}\`\nGlobal owners receive bot-wide control. This expires in 2 minutes.`)],
          components: [confirmRow('add', id)],
        });
      },
    },
    remove: {
      ...OWNER_ONLY,
      description: 'Propose removing a database-managed global owner (requires confirmation)',
      options: [{ type: 'user', name: 'user', description: 'Owner to remove', required: true }],
      run: async (ctx) => {
        const target = ctx.interaction.options.getUser('user', true);
        if (!ctx.isGlobalOwner) throw new UserError('Only global owners can change global ownership.', { code: 'NOT_OWNER' });
        const id = ctx.services.confirmations.create({ action: 'owner.remove', actorId: ctx.user.id, payload: { targetId: target.id } });
        await ctx.respond({
          embeds: [ui.warn('Confirm: remove global owner', `Target ID: \`${target.id}\`\nThe last remaining owner can never be removed. Configured owners must be changed in configuration.`)],
          components: [confirmRow('remove', id)],
        });
      },
    },
    diagnostics: {
      ...OWNER_ONLY,
      description: 'Detailed runtime diagnostics (no secrets are shown)',
      run: async (ctx) => {
        const mem = process.memoryUsage();
        const migrations = ctx.repos.db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n;
        await ctx.respond({
          embeds: [ui.info('Owner diagnostics', `Brand: ${BRAND.attribution}`).addFields(
            { name: 'Node', value: process.version, inline: true },
            { name: 'Uptime', value: `${Math.floor(process.uptime())}s`, inline: true },
            { name: 'Heap used', value: `${Math.round(mem.heapUsed / 1048576)} MB`, inline: true },
            { name: 'Migrations applied', value: String(migrations), inline: true },
            { name: 'Servers cached', value: String(ctx.client ? ctx.client.guilds.cache.size : 0), inline: true },
            { name: 'Owner IDs configured', value: String(ctx.config.ownerIds.length), inline: true },
          )],
        });
      },
    },
  },
});

