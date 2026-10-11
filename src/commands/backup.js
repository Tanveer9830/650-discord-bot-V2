'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { buildSnapshot, restoreSnapshot, MAX_PAYLOAD_BYTES } = require('../services/backups');
const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { buttonRow } = require('../utils/components');
const { requireGuild } = require('./helpers');

module.exports = defineModule({
  name: 'backup',
  description: 'Back up and restore this server\u2019s bot configuration',
  category: 'administration',
  dmPermission: false,
  defaultMemberPermissions: [PermissionFlagsBits.ManageGuild],
  actions: {
    create: {
      description: 'Save a snapshot of this server\u2019s bot settings',
      permissions: [PermissionFlagsBits.ManageGuild],
      options: [{ type: 'string', name: 'label', description: 'Label for this backup', required: true, minLength: 1, maxLength: 64 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const label = sanitizeText(ctx.interaction.options.getString('label', true), { maxLength: 64 }).trim() || 'backup';
        const snapshot = buildSnapshot(ctx.repos, guild.id);
        const id = ctx.repos.backups.insert({ guildId: guild.id, label, createdBy: ctx.user.id, payload: snapshot });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'backup.created', details: { backupId: id } });
        await ctx.respond({ embeds: [ui.success('Backup saved', `Backup #${id} (${label}). Size limit ${MAX_PAYLOAD_BYTES.toLocaleString('en-US')} bytes.`)] });
      },
    },
    list: {
      description: 'List recent backups for this server',
      permissions: [PermissionFlagsBits.ManageGuild],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const rows = ctx.repos.backups.list(guild.id, 10);
        const body = rows.length
          ? rows.map((b) => `**#${b.id}** ${sanitizeText(b.label, { maxLength: 64 })} — ${b.created_at.slice(0, 16).replace('T', ' ')} (${b.size_bytes} bytes)`).join('\n')
          : 'No backups yet.';
        await ctx.respond({ embeds: [ui.info('Backups', body)] });
      },
    },
    restore: {
      description: 'Restore a backup (asks for confirmation first)',
      permissions: [PermissionFlagsBits.Administrator],
      options: [{ type: 'integer', name: 'id', description: 'Backup ID from /backup list', required: true, min: 1 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const id = ctx.interaction.options.getInteger('id', true);
        const backup = ctx.repos.backups.get(guild.id, id);
        if (!backup) throw new UserError('No backup with that ID exists for this server.', { code: 'NOT_FOUND' });
        const token = ctx.services.confirmations.create({ action: 'backup.restore', actorId: ctx.user.id, guildId: guild.id, payload: { backupId: id } });
        await ctx.respond({
          embeds: [ui.warn('Confirm restore', `Restoring backup #${id} replaces this server\u2019s current bot settings, automod lists, whitelist, and blocklist. User balances and history are not changed. Expires in 2 minutes.`)],
          components: [buttonRow([
            { customId: `backup:confirm:${token}`, label: 'Restore backup', style: 'Danger' },
            { customId: `backup:cancel:${token}`, label: 'Cancel', style: 'Secondary' },
          ])],
        });
      },
    },
  },
});
