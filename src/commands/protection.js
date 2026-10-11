'use strict';

const { defineModule } = require('./framework');
const ui = require('../utils/ui');
const { UserError } = require('../utils/errors');
const { buttonRow } = require('../utils/components');
const { isSnowflake } = require('../utils/ids');
const { CAPABILITIES, RESPONSE_MODES } = require('../security/antinuke');

/**
 * Protected security controls. Every action here requires a verified GLOBAL OWNER (numeric ID).
 * Server administrators cannot use these commands and never receive protected privileges.
 */
const OWNER_ONLY = { access: 'owner', category: 'owner', guildOnly: false, cooldownMs: 2000 };
const CAPABILITY_CHOICES = CAPABILITIES.map((c) => ({ name: c, value: c }));
const MODE_CHOICES = RESPONSE_MODES.map((m) => ({ name: m, value: m }));
const MAX_GRANT_HOURS = 24 * 365;

function parseSnowflake(raw, label) {
  const value = String(raw || '').trim();
  if (!isSnowflake(value)) throw new UserError(`${label} must be a numeric Discord ID (17-20 digits).`, { code: 'INVALID_ID' });
  return value;
}

function guildOption() {
  return { type: 'string', name: 'guild_id', description: 'Server ID the change applies to', required: true, minLength: 17, maxLength: 20 };
}

function userOption(description = 'Numeric Discord user ID') {
  return { type: 'string', name: 'user_id', description, required: true, minLength: 17, maxLength: 20 };
}

function capabilityOption() {
  return { type: 'string', name: 'capability', description: 'Protected capability', required: true, choices: CAPABILITY_CHOICES };
}

function requireOwner(ctx) {
  if (!ctx.isGlobalOwner) throw new UserError('Only the verified global owner can use protected security controls.', { code: 'NOT_OWNER' });
}

async function proposeChange(ctx, { action, guildId, payload, title, summary }) {
  const id = ctx.services.confirmations.create({ action, actorId: ctx.user.id, guildId, payload });
  await ctx.respond({
    embeds: [ui.warn(title, `${summary}\n\nThis confirmation expires in 2 minutes and works only for you.`)],
    components: [buttonRow([
      { customId: `protect:confirm:${id}`, label: 'Confirm', style: 'Danger' },
      { customId: `protect:cancel:${id}`, label: 'Cancel', style: 'Secondary' },
    ])],
  });
}

module.exports = defineModule({
  name: 'protection',
  description: 'Protected security controls: anti-nuke mode, protected whitelist, audit (global owner only)',
  category: 'owner',
  dmPermission: true,
  access: 'owner',
  groups: {
    whitelist: {
      description: 'Server-scoped protected whitelist (global owner only)',
      actions: {
        grant: {
          ...OWNER_ONLY,
          description: 'Propose granting an anti-nuke capability in one server (confirmation required)',
          options: [
            guildOption(),
            userOption('User to grant the capability to'),
            capabilityOption(),
            { type: 'integer', name: 'hours', description: `Expire after this many hours (1-${MAX_GRANT_HOURS}); omit for no expiry`, required: false, min: 1, max: MAX_GRANT_HOURS },
            { type: 'string', name: 'reason', description: 'Why this grant is needed (kept in the audit history)', required: false, maxLength: 200 },
          ],
          run: async (ctx) => {
            requireOwner(ctx);
            const guildId = parseSnowflake(ctx.interaction.options.getString('guild_id', true), 'Server ID');
            const userId = parseSnowflake(ctx.interaction.options.getString('user_id', true), 'User ID');
            const capability = ctx.interaction.options.getString('capability', true);
            const hours = ctx.interaction.options.getInteger('hours') ?? null;
            const reason = ctx.interaction.options.getString('reason') ?? null;
            if (!CAPABILITIES.includes(capability)) throw new UserError('Unknown capability.', { code: 'INVALID' });
            if (ctx.repos.protection.activeCapabilities({ guildId, userId, nowSec: ctx.services.clock.seconds() }).includes(capability)) {
              throw new UserError('That user already has this capability in this server.', { code: 'DUPLICATE' });
            }
            await proposeChange(ctx, {
              action: 'protection.whitelist.grant',
              guildId,
              payload: { guildId, userId, capability, hours, reason },
              title: 'Confirm protected whitelist grant',
              summary: `Server: \`${guildId}\`\nUser: \`${userId}\`\nCapability: \`${capability}\`\nExpiry: ${hours ? `${hours} hour(s)` : 'none'}\nReason: ${reason || 'not given'}`,
            });
          },
        },
        revoke: {
          ...OWNER_ONLY,
          description: 'Revoke an active protected whitelist grant',
          options: [guildOption(), userOption('User whose grant to revoke'), capabilityOption()],
          run: async (ctx) => {
            requireOwner(ctx);
            const guildId = parseSnowflake(ctx.interaction.options.getString('guild_id', true), 'Server ID');
            const userId = parseSnowflake(ctx.interaction.options.getString('user_id', true), 'User ID');
            const capability = ctx.interaction.options.getString('capability', true);
            const revoked = ctx.repos.protection.revoke({ guildId, userId, capability, actorId: ctx.user.id, nowSec: ctx.services.clock.seconds() });
            if (!revoked) throw new UserError('No active grant matches that server, user and capability.', { code: 'NOT_FOUND' });
            await ctx.respond({ embeds: [ui.success('Grant revoked', `\`${capability}\` revoked for \`${userId}\` in \`${guildId}\`. The change is in the protected audit history.`)] });
          },
        },
        list: {
          ...OWNER_ONLY,
          description: 'List active protected whitelist grants in one server',
          options: [guildOption()],
          run: async (ctx) => {
            requireOwner(ctx);
            const guildId = parseSnowflake(ctx.interaction.options.getString('guild_id', true), 'Server ID');
            const rows = ctx.repos.protection.listActive({ guildId, nowSec: ctx.services.clock.seconds() });
            const body = rows.length
              ? rows.map((r) => `• \`${r.user_id}\` — ${r.capability}${r.expires_at ? ` (expires <t:${r.expires_at}:R>)` : ''}`).join('\n')
              : 'No active protected grants in this server.';
            await ctx.respond({ embeds: [ui.info('Protected whitelist', body)] });
          },
        },
        history: {
          ...OWNER_ONLY,
          description: 'Show grant history (including revoked and expired rows)',
          options: [guildOption()],
          run: async (ctx) => {
            requireOwner(ctx);
            const guildId = parseSnowflake(ctx.interaction.options.getString('guild_id', true), 'Server ID');
            const rows = ctx.repos.protection.grantHistory({ guildId, limit: 15 });
            const body = rows.length
              ? rows.map((r) => `#${r.id} \`${r.user_id}\` ${r.capability} by \`${r.authorized_by}\` — ${r.revoked_at ? 'revoked' : 'active'}`).join('\n')
              : 'No grants recorded.';
            await ctx.respond({ embeds: [ui.info('Grant history', body)] });
          },
        },
      },
    },
  },
  actions: {
    status: {
      ...OWNER_ONLY,
      description: 'Show anti-nuke settings and active protected grant count for one server',
      options: [guildOption()],
      run: async (ctx) => {
        requireOwner(ctx);
        const guildId = parseSnowflake(ctx.interaction.options.getString('guild_id', true), 'Server ID');
        const s = ctx.repos.protection.getSettings(guildId);
        const grants = ctx.repos.protection.listActive({ guildId, nowSec: ctx.services.clock.seconds() }).length;
        await ctx.respond({
          embeds: [ui.info('Protection status', undefined).addFields(
            { name: 'Anti-nuke', value: s.enabled ? 'Enabled' : 'Disabled', inline: true },
            { name: 'Response mode', value: s.response_mode, inline: true },
            { name: 'Window', value: `${s.window_seconds}s`, inline: true },
            { name: 'Active grants', value: String(grants), inline: true },
          )],
        });
      },
    },
    mode: {
      ...OWNER_ONLY,
      description: 'Change anti-nuke enabled state or response mode (confirmation required)',
      options: [
        guildOption(),
        { type: 'string', name: 'response_mode', description: 'log = record only; alert = notify log channel; restrict = also remove hazardous roles', required: false, choices: MODE_CHOICES },
        { type: 'boolean', name: 'enabled', description: 'Turn anti-nuke on or off', required: false },
      ],
      run: async (ctx) => {
        requireOwner(ctx);
        const guildId = parseSnowflake(ctx.interaction.options.getString('guild_id', true), 'Server ID');
        const mode = ctx.interaction.options.getString('response_mode');
        const enabled = ctx.interaction.options.getBoolean('enabled');
        if (mode === null && enabled === null) throw new UserError('Choose a response_mode, enabled, or both.', { code: 'INVALID' });
        const changes = {};
        if (mode !== null) changes.response_mode = mode;
        if (enabled !== null) changes.enabled = enabled ? 1 : 0;
        await proposeChange(ctx, {
          action: 'protection.settings.update',
          guildId,
          payload: { guildId, changes },
          title: 'Confirm protection change',
          summary: `Server: \`${guildId}\`\nChanges: ${Object.entries(changes).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        });
      },
    },
    audit: {
      ...OWNER_ONLY,
      description: 'Show the protected audit history for one server',
      options: [guildOption()],
      run: async (ctx) => {
        requireOwner(ctx);
        const guildId = parseSnowflake(ctx.interaction.options.getString('guild_id', true), 'Server ID');
        const rows = ctx.repos.protection.recentAudit({ guildId, limit: 15 });
        const body = rows.length
          ? rows.map((r) => `\`${r.created_at.slice(0, 16).replace('T', ' ')}\` ${r.action} by \`${r.actor_id}\`${r.target_id ? ` → \`${r.target_id}\`` : ''}${r.capability ? ` (${r.capability})` : ''}`).join('\n')
          : 'No protected audit entries yet.';
        await ctx.respond({ embeds: [ui.info('Protected audit', body)] });
      },
    },
  },
});
