'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { validateDefinition, render, PERMISSION_LABELS } = require('../services/customCommands');
const { parseHexColor } = require('../utils/color');
const { UserError } = require('../utils/errors');
const { sanitizeText, NO_MENTIONS } = require('../utils/text');
const ui = require('../utils/ui');
const { requireGuild, fetchMember } = require('./helpers');
const { memberHas } = require('../security/permissions');

const OWNER = { access: 'owner', category: 'owner', guildOnly: false, cooldownMs: 1000 };
const PERMISSION_FLAG = {
  everyone: null,
  manage_messages: PermissionFlagsBits.ManageMessages,
  manage_guild: PermissionFlagsBits.ManageGuild,
};

function nameOption(description = 'Custom command name') {
  return { type: 'string', name: 'name', description, required: true, minLength: 2, maxLength: 32 };
}

function requireDefinition(ctx, name) {
  const def = ctx.repos.customCommands.get(String(name).toLowerCase());
  if (!def) throw new UserError('No custom command with that name exists.', { code: 'NOT_FOUND' });
  return def;
}

function toEmbed(rendered) {
  const embed = ui.info(rendered.title || 'Message', rendered.content, rendered.color ?? ui.COLORS.primary);
  return rendered.kind === 'embed' ? embed : embed.setTitle(null).setDescription(rendered.content);
}

module.exports = defineModule({
  name: 'customcommand',
  description: 'Global custom commands built from safe templates (owner-managed)',
  category: 'owner',
  dmPermission: true,
  actions: {
    create: {
      ...OWNER,
      description: 'Create a safe template command (global, owner-only)',
      options: [
        nameOption('Name: letters, digits, _ or -, 2-32 characters'),
        { type: 'string', name: 'kind', description: 'Template type', required: true, choices: [{ name: 'Text', value: 'text' }, { name: 'Embed', value: 'embed' }] },
        { type: 'string', name: 'body', description: 'Message body. Placeholders: {server} {member} {members}', required: true, minLength: 1, maxLength: 2000 },
        { type: 'string', name: 'title', description: 'Title (required for embeds)', required: false, maxLength: 256 },
        { type: 'string', name: 'color', description: 'Embed colour, e.g. #3B82F6', required: false, maxLength: 7 },
        { type: 'string', name: 'min_permission', description: 'Who may run it', required: false, choices: [
          { name: 'Everyone', value: 'everyone' },
          { name: 'Manage Messages', value: 'manage_messages' },
          { name: 'Manage Server', value: 'manage_guild' },
        ] },
      ],
      run: async (ctx) => {
        const o = ctx.interaction.options;
        const builtinNames = ctx.services.builtinNames || new Set();
        const existingNames = new Set(ctx.repos.customCommands.list().map((c) => c.name));
        const def = validateDefinition({
          name: o.getString('name', true),
          kind: o.getString('kind', true),
          body: o.getString('body', true),
          title: o.getString('title'),
          color: parseHexColor(o.getString('color')),
          minPermission: o.getString('min_permission') || 'everyone',
        }, { builtinNames, existingNames });
        ctx.repos.customCommands.insert({ ...def, actorId: ctx.user.id });
        ctx.services.audit({ actorId: ctx.user.id, action: 'customcommand.created', details: { name: def.name, kind: def.kind } });
        await ctx.respond({ embeds: [ui.success('Custom command created', `Run it with \`/customcommand run name:${def.name}\`.`)] });
      },
    },
    list: {
      ...OWNER,
      description: 'List all custom commands and their state',
      run: async (ctx) => {
        const rows = ctx.repos.customCommands.list();
        const body = rows.length
          ? rows.map((r) => `\`${r.name}\` — ${r.kind}, ${r.enabled ? 'enabled' : 'disabled'}, needs ${PERMISSION_LABELS[r.min_permission]}`).join('\n')
          : 'No custom commands yet.';
        await ctx.respond({ embeds: [ui.info('Custom commands', body)] });
      },
    },
    preview: {
      ...OWNER,
      description: 'Preview how a custom command renders (only you see it)',
      options: [nameOption()],
      run: async (ctx) => {
        const def = requireDefinition(ctx, ctx.interaction.options.getString('name', true));
        const rendered = render(def, { server: ctx.guild ? ctx.guild.name : 'this server', member: ctx.user.username, members: ctx.guild ? ctx.guild.memberCount : 0 });
        await ctx.respond({ content: 'Preview:', embeds: [toEmbed({ ...rendered, kind: def.kind })], allowedMentions: NO_MENTIONS });
      },
    },
    delete: {
      ...OWNER,
      description: 'Delete a custom command (requires confirm=true)',
      options: [nameOption(), { type: 'boolean', name: 'confirm', description: 'Set to true to delete permanently', required: true }],
      run: async (ctx) => {
        const name = ctx.interaction.options.getString('name', true).toLowerCase();
        if (!ctx.interaction.options.getBoolean('confirm', true)) throw new UserError('Set confirm to true to delete this command.', { code: 'CONFIRM' });
        if (!ctx.repos.customCommands.remove(name)) throw new UserError('No custom command with that name exists.', { code: 'NOT_FOUND' });
        ctx.services.audit({ actorId: ctx.user.id, action: 'customcommand.deleted', details: { name } });
        await ctx.respond({ embeds: [ui.success('Custom command deleted', `\`${sanitizeText(name, { maxLength: 32 })}\` was removed.`)] });
      },
    },
    toggle: {
      ...OWNER,
      description: 'Enable or disable a custom command',
      options: [nameOption(), { type: 'boolean', name: 'enabled', description: 'Enabled state', required: true }],
      run: async (ctx) => {
        const name = ctx.interaction.options.getString('name', true).toLowerCase();
        const enabled = ctx.interaction.options.getBoolean('enabled', true);
        if (!ctx.repos.customCommands.setEnabled(name, enabled, ctx.user.id)) throw new UserError('No custom command with that name exists.', { code: 'NOT_FOUND' });
        ctx.services.audit({ actorId: ctx.user.id, action: 'customcommand.toggled', details: { name, enabled } });
        await ctx.respond({ embeds: [ui.success('Custom command updated', `\`${name}\` is now ${enabled ? 'enabled' : 'disabled'}.`)] });
      },
    },
    run: {
      description: 'Run a published custom command',
      guildOnly: true,
      options: [{ type: 'string', name: 'name', description: 'Custom command to run', required: true, maxLength: 32, autocomplete: true }],
      autocomplete: {
        name: ({ value, repos }) => repos.customCommands.list()
          .filter((c) => c.enabled && c.name.includes(String(value || '').toLowerCase()))
          .slice(0, 25)
          .map((c) => ({ name: c.name, value: c.name })),
      },
      cooldownMs: 3000,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const def = ctx.repos.customCommands.get(ctx.interaction.options.getString('name', true).toLowerCase());
        if (!def || !def.enabled) throw new UserError('That custom command is not available.', { code: 'NOT_FOUND' });
        const flag = PERMISSION_FLAG[def.min_permission];
        if (flag) {
          const member = await fetchMember(guild, ctx.user.id);
          if (!memberHas(member, flag)) throw new UserError(`You need ${PERMISSION_LABELS[def.min_permission]} to run this command.`, { code: 'PERMISSION' });
        }
        const rendered = render(def, { server: guild.name, member: ctx.user.username, members: guild.memberCount });
        await ctx.respond({ embeds: [toEmbed({ ...rendered, kind: def.kind })], ephemeral: false, allowedMentions: NO_MENTIONS });
      },
    },
  },
});
