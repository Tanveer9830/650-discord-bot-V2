'use strict';

const { MessageFlags } = require('discord.js');
const { UserError, referenceId } = require('../utils/errors');
const { NO_MENTIONS } = require('../utils/text');
const ui = require('../utils/ui');
const { memberHas, missingPermissions, flagNames } = require('../security/permissions');
const { fetchMember } = require('./helpers');

/**
 * Single entry point for every slash command, autocomplete request, and component.
 * Enforces, in order: duplicate protection, guild scope, global-owner gate, server permissions,
 * bot permissions, cooldowns; then runs the handler and converts errors into safe replies.
 */
function createDispatcher({ registry, components, services, repos, config, logger, deduper, cooldowns, getClient }) {
  function buildContext(interaction, actionKey) {
    const guild = interaction.guild || null;
    const ctx = {
      interaction,
      client: getClient(),
      config,
      logger: logger.child({ action: actionKey, userId: interaction.user.id, guildId: guild ? guild.id : null }),
      repos,
      services,
      user: interaction.user,
      guild,
      member: null,
      isGlobalOwner: services.owners.isGlobalOwner(interaction.user.id),
      actionKey,
      ephemeralDefault: true,
    };
    ctx.respond = async (payload = {}) => {
      const { ephemeral = ctx.ephemeralDefault, ...rest } = payload;
      const data = { allowedMentions: NO_MENTIONS, ...rest };
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(data);
      }
      return interaction.reply({ ...data, flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    };
    ctx.defer = async (ephemeral = true) => {
      if (interaction.deferred || interaction.replied) return;
      await interaction.deferReply({ flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    };
    return ctx;
  }

  async function enforce(ctx, action, actionKey) {
    if (action.guildOnly && !ctx.guild) {
      throw new UserError('This command can only be used inside a server.', { code: 'GUILD_ONLY' });
    }
    if (action.access === 'owner' && !ctx.isGlobalOwner) {
      services.audit({ actorId: ctx.user.id, action: 'command.denied.owner', details: { action: actionKey } });
      logger.warn('Owner-only command denied', { action: actionKey, userId: ctx.user.id });
      throw new UserError('This command is restricted to the bot\u2019s global owners.', { code: 'NOT_OWNER' });
    }
    if (ctx.guild && (action.permissions.length || action.botPermissions.length || action.guildOnly)) {
      ctx.member = await fetchMember(ctx.guild, ctx.user.id);
    }
    // Global ownership does NOT bypass server permissions: owner powers are bot-wide but still subject to Discord's permissions.
    if (action.permissions.length && (!ctx.member || !action.permissions.every((p) => memberHas(ctx.member, p)))) {
      const missing = flagNames(missingPermissions(ctx.member, action.permissions));
      throw new UserError(`You need these server permissions: ${missing.join(', ') || 'unknown'}.`, { code: 'PERMISSION' });
    }
    if (action.botPermissions.length && ctx.guild) {
      const me = ctx.guild.members.me || (await ctx.guild.members.fetchMe().catch(() => null));
      const missing = me ? flagNames(missingPermissions(me, action.botPermissions)) : ['unknown'];
      if (missing.length) {
        throw new UserError(`I need these server permissions to do that: ${missing.join(', ')}.`, { code: 'BOT_PERMISSION' });
      }
    }
    if (!ctx.isGlobalOwner) {
      const ms = action.cooldownMs ?? config.commandCooldownMs;
      const remaining = cooldowns.take(`${actionKey}:${ctx.user.id}`, ms);
      if (remaining > 0) {
        throw new UserError(`Please wait ${Math.ceil(remaining / 1000)}s before using this again.`, { code: 'COOLDOWN' });
      }
    }
  }

  function resolveKey(interaction) {
    const top = interaction.commandName;
    const group = interaction.options.getSubcommandGroup(false);
    const sub = interaction.options.getSubcommand(false);
    if (group && sub) return `${top}.${group}.${sub}`;
    if (sub) return `${top}.${sub}`;
    return top;
  }

  async function handleChatInput(interaction) {
    const key = resolveKey(interaction);
    const action = registry.actions.get(key);
    const ctx = buildContext(interaction, key);
    if (!action) {
      await ctx.respond({ embeds: [ui.error('This command is not available.')] });
      return;
    }
    try {
      await enforce(ctx, action, key);
      await action.run(ctx);
    } catch (error) {
      await reportError(ctx, error, key);
    }
  }

  async function reportError(ctx, error, key) {
    if (error instanceof UserError) {
      ctx.logger.info('Command rejected', { code: error.code });
      await safeRespond(ctx, { embeds: [ui.error(error.userMessage)] });
      return;
    }
    // A database CHECK failure means a value passed the Discord option limits but broke a stored rule.
    // Tell the user it is out of range; never show SQL text.
    if (error && typeof error.message === 'string' && /CHECK constraint failed/i.test(error.message)) {
      ctx.logger.info('Value rejected by a stored rule', { action: key });
      await safeRespond(ctx, { embeds: [ui.error('One of the values is outside the range this server allows.')] });
      return;
    }
    const ref = referenceId();
    ctx.logger.error('Unhandled command error', { ref, action: key, reason: error && error.message, stack: error && error.stack });
    await safeRespond(ctx, { embeds: [ui.error(`Something went wrong while running this command. Reference: ${ref}`)] });
  }

  async function safeRespond(ctx, payload) {
    try {
      await ctx.respond(payload);
    } catch (error) {
      ctx.logger.warn('Could not send response (interaction may have expired)', { reason: error.code || error.message });
    }
  }

  async function handleAutocomplete(interaction) {
    const key = resolveKey(interaction);
    const action = registry.actions.get(key);
    if (!action || !action.autocomplete) {
      await interaction.respond([]).catch(() => {});
      return;
    }
    const focused = interaction.options.getFocused(true);
    const handler = action.autocomplete[focused.name];
    if (!handler) {
      await interaction.respond([]).catch(() => {});
      return;
    }
    try {
      const choices = await handler({ value: focused.value, services, repos, interaction, config });
      await interaction.respond(choices.slice(0, 25));
    } catch (error) {
      logger.warn('Autocomplete failed', { action: key, reason: error.message });
      await interaction.respond([]).catch(() => {});
    }
  }

  async function handleComponent(interaction) {
    const customId = interaction.customId;
    const prefix = customId.split(':')[0];
    const key = `component.${prefix}`;
    const ctx = buildContext(interaction, key);
    const handler = components.get(prefix);
    if (!handler) {
      await ctx.respond({ embeds: [ui.error('This control is no longer active.')] });
      return;
    }
    try {
      if (handler.guildOnly !== false && !ctx.guild) {
        throw new UserError('This control can only be used inside a server.', { code: 'GUILD_ONLY' });
      }
      await handler.run(ctx);
    } catch (error) {
      await reportError(ctx, error, key);
    }
  }

  return {
    async handle(interaction) {
      if (interaction.isChatInputCommand()) {
        if (deduper.check(interaction.id)) return;
        return handleChatInput(interaction);
      }
      if (interaction.isAutocomplete()) return handleAutocomplete(interaction);
      if (interaction.isButton() || interaction.isModalSubmit() || interaction.isAnySelectMenu?.()) {
        if (deduper.check(interaction.id)) return;
        return handleComponent(interaction);
      }
      return undefined;
    },
    resolveKey,
    buildContext,
  };
}

module.exports = { createDispatcher };
