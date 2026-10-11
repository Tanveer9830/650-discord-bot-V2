'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { UserError } = require('../utils/errors');
const { hostOf } = require('../security/links');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { requireGuild } = require('./helpers');
const { logIncident } = require('../events/incidents');
const { settingsFromRow, validateSettingsUpdate, DEFAULT_LIMITS } = require('../security/antinuke');

const ANTINUKE_TUNABLE = [
  { name: 'window_seconds', value: 'window_seconds' },
  ...Object.keys(DEFAULT_LIMITS).map((k) => ({ name: k, value: k })),
];

const manage = [PermissionFlagsBits.Administrator];
const KINDS = [
  { name: 'Security exemption (skip automod & anti-spam only)', value: 'security_exemption' },
  { name: 'Trusted integration (skip automod & anti-spam only)', value: 'trusted_integration' },
];
const BOUNDARY_NOTE = 'Whitelist entries only skip automod and anti-spam. They never grant command access, permissions, or global ownership.';
const MAX_ENTRIES = 200;
const DOMAIN_PATTERN = /^(?=.{4,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

function targetFromOptions(ctx) {
  const user = ctx.interaction.options.getUser('user');
  const role = ctx.interaction.options.getRole('role');
  if ((user ? 1 : 0) + (role ? 1 : 0) !== 1) throw new UserError('Choose exactly one target: a user or a role.', { code: 'TARGET' });
  return user ? { targetType: 'user', targetId: user.id, label: `user ${user.id}` } : { targetType: 'role', targetId: role.id, label: `role ${role.id}` };
}

const targetOptions = [
  { type: 'user', name: 'user', description: 'Single user to exempt', required: false },
  { type: 'role', name: 'role', description: 'Role to exempt (members with it)', required: false },
];

module.exports = defineModule({
  name: 'security',
  description: 'Whitelists, domain blocklist, security incidents, and audit log',
  category: 'security',
  dmPermission: false,
  defaultMemberPermissions: manage,
  groups: {
    whitelist: {
      description: 'Scoped exemptions from automod (not permissions)',
      actions: {
        add: {
          description: 'Exempt a user or role from automod',
          permissions: manage,
          options: [{ type: 'string', name: 'kind', description: 'Type of exemption', required: true, choices: KINDS }, ...targetOptions],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const kind = ctx.interaction.options.getString('kind', true);
            const { targetType, targetId, label } = targetFromOptions(ctx);
            if (ctx.repos.whitelist.list(guild.id).length >= MAX_ENTRIES) throw new UserError('The whitelist is full.', { code: 'LIMIT' });
            const added = ctx.repos.whitelist.add({ guildId: guild.id, kind, targetType, targetId, addedBy: ctx.user.id });
            if (!added) throw new UserError('That entry already exists.', { code: 'DUPLICATE' });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'security.whitelist.added', targetId, details: { kind, targetType } });
            await ctx.respond({ embeds: [ui.success('Whitelist entry added', `${kind} for ${label}.\n${BOUNDARY_NOTE}`)] });
          },
        },
        remove: {
          description: 'Remove a whitelist entry',
          permissions: manage,
          options: [{ type: 'string', name: 'kind', description: 'Type of exemption', required: true, choices: KINDS }, ...targetOptions],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const kind = ctx.interaction.options.getString('kind', true);
            const { targetType, targetId, label } = targetFromOptions(ctx);
            if (!ctx.repos.whitelist.remove({ guildId: guild.id, kind, targetType, targetId })) throw new UserError('No matching whitelist entry.', { code: 'NOT_FOUND' });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'security.whitelist.removed', targetId, details: { kind, targetType } });
            await ctx.respond({ embeds: [ui.success('Whitelist entry removed', `${kind} for ${label} removed.`)] });
          },
        },
        list: {
          description: 'List whitelist entries',
          permissions: manage,
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const rows = ctx.repos.whitelist.list(guild.id);
            const body = rows.length ? rows.map((r) => `• ${r.kind} — ${r.target_type} \`${r.target_id}\``).join('\n') : 'No entries.';
            await ctx.respond({ embeds: [ui.info('Whitelist', `${body}\n\n${BOUNDARY_NOTE}`)] });
          },
        },
      },
    },
    blocklist: {
      description: 'Domains blocked by automod (matches subdomains too)',
      actions: {
        add: {
          description: 'Block a domain (and its subdomains)',
          permissions: manage,
          options: [{ type: 'string', name: 'domain', description: 'Domain such as example.com', required: true, minLength: 4, maxLength: 253 }],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const raw = ctx.interaction.options.getString('domain', true).trim().toLowerCase();
            // Keep the host exactly as entered: matching already covers its subdomains.
            // Never reduce to a "registrable" domain, which would mis-handle suffixes such as co.uk.
            const host = hostOf(raw.includes('://') ? raw : `http://${raw}`);
            const domain = host || null;
            if (!domain || !DOMAIN_PATTERN.test(domain)) throw new UserError('Enter a valid domain such as example.com.', { code: 'DOMAIN' });
            if (!ctx.repos.blocklist.add(guild.id, domain, ctx.user.id)) throw new UserError('That domain is already blocked.', { code: 'DUPLICATE' });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'security.blocklist.added', details: { domain } });
            await ctx.respond({ embeds: [ui.success('Domain blocked', `\`${sanitizeText(domain, { maxLength: 253 })}\` and subdomains are now blocked.`)] });
          },
        },
        remove: {
          description: 'Unblock a domain',
          permissions: manage,
          options: [{ type: 'string', name: 'domain', description: 'Domain to unblock', required: true, minLength: 4, maxLength: 253 }],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const domain = ctx.interaction.options.getString('domain', true).trim().toLowerCase();
            if (!ctx.repos.blocklist.remove(guild.id, domain)) throw new UserError('That domain is not blocked.', { code: 'NOT_FOUND' });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'security.blocklist.removed', details: { domain } });
            await ctx.respond({ embeds: [ui.success('Domain unblocked', 'The domain is no longer blocked.')] });
          },
        },
        list: {
          description: 'List blocked domains',
          permissions: manage,
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const list = ctx.repos.blocklist.list(guild.id);
            await ctx.respond({ embeds: [ui.info('Blocked domains', list.length ? list.join('\n') : 'None configured.')] });
          },
        },
      },
    },
    antinuke: {
      description: 'Anti-nuke status and thresholds (disabling and response mode are owner-only)',
      actions: {
        status: {
          description: 'Show anti-nuke settings for this server',
          permissions: manage,
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const s = settingsFromRow(ctx.repos.protection.getSettings(guild.id));
            const lines = [
              `Enabled: ${s.enabled ? 'yes' : 'no'}`,
              `Response mode: ${s.responseMode} (set by the global owner)`,
              `Window: ${s.windowSeconds}s`,
              ...Object.entries(s.limits).map(([k, v]) => `${k}: ${v}`),
            ];
            await ctx.respond({ embeds: [ui.info('Anti-nuke status', lines.join('\n'))] });
          },
        },
        set: {
          description: 'Tune an anti-nuke threshold or the detection window',
          permissions: manage,
          options: [
            { type: 'string', name: 'setting', description: 'Which value to change', required: true, choices: ANTINUKE_TUNABLE },
            { type: 'integer', name: 'value', description: 'New value (limits 2-200, window 5-600 seconds)', required: true, min: 2, max: 600 },
          ],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const key = ctx.interaction.options.getString('setting', true);
            const value = ctx.interaction.options.getInteger('value', true);
            const check = validateSettingsUpdate({ [key]: value });
            if (!check.ok) throw new UserError(check.errors.join(' '), { code: 'INVALID' });
            ctx.repos.protection.updateSettings({ guildId: guild.id, changes: { [key]: value }, actorId: ctx.user.id });
            await ctx.respond({ embeds: [ui.success('Anti-nuke updated', `${key} is now ${value}. The change is audited.`)] });
          },
        },
        disable: {
          description: 'Attempt to disable anti-nuke (global owner only; attempts are recorded)',
          permissions: manage,
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            // Disabling protection is a protected policy change. Administrators cannot do it, and the attempt is logged.
            logIncident(ctx.repos, { guildId: guild.id, kind: 'protection.tamper_attempt', severity: 'high', details: `user ${ctx.user.id} tried to disable anti-nuke` });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'protection.tamper_attempt', details: { control: 'antinuke.disable' } });
            throw new UserError('Only the verified global owner can disable anti-nuke. This attempt has been recorded.', { code: 'NOT_OWNER' });
          },
        },
      },
    },
  },
  actions: {
    incidents: {
      description: 'Show recent security incidents (raids, spam, phishing)',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const rows = ctx.repos.incidents.recent(guild.id, 10);
        const body = rows.length
          ? rows.map((r) => `**#${r.id}** [${r.severity}] ${r.kind} — ${r.created_at.slice(0, 16).replace('T', ' ')}`).join('\n')
          : 'No incidents recorded.';
        await ctx.respond({ embeds: [ui.info('Security incidents', body)] });
      },
    },
    audit: {
      description: 'Show recent audit log entries for this server',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const rows = ctx.repos.audit.recent({ guildId: guild.id, limit: 10 });
        const body = rows.length
          ? rows.map((r) => `\`${r.created_at.slice(0, 16).replace('T', ' ')}\` ${r.action}${r.target_id ? ` → ${r.target_id}` : ''}`).join('\n')
          : 'No audit entries yet.';
        await ctx.respond({ embeds: [ui.info('Audit log', body)] });
      },
    },
  },
});
