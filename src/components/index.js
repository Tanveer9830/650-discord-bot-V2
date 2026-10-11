'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { UserError } = require('../utils/errors');
const ui = require('../utils/ui');
const { fetchMember, botMember } = require('../commands/helpers');
const { restoreSnapshot } = require('../services/backups');
const { isSnowflake } = require('../utils/ids');
const { giveawayEmbed } = require('../services/giveawayView');
const { pollEmbed, pollRows } = require('../services/pollView');
const { memberHas } = require('../security/permissions');


/**
 * Button and modal handlers. Every custom_id is parsed strictly; anything unexpected is rejected.
 * Authorization is re-checked at click time (roles and owner status can change between clicks).
 */
function createComponentRouter({ repos, services }) {
  const handlers = new Map();

  async function assignRole(ctx, guild, member, role) {
    const bot = await botMember(guild);
    if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) throw new UserError('I am missing the Manage Roles permission.', { code: 'BOT_PERMISSION' });
    if (!role || role.managed) throw new UserError('That role is no longer available.', { code: 'ROLE' });
    if (bot.roles.highest.position <= role.position) throw new UserError('My role must be above that role.', { code: 'HIERARCHY' });
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Self-service button role');
      return 'removed';
    }
    await member.roles.add(role, 'Self-service button role');
    return 'added';
  }

  // verify:start — grants the configured verification role.
  handlers.set('verify', {
    run: async (ctx) => {
      const settings = repos.guild.get(ctx.guild.id);
      if (!settings || !settings.verify_role_id) throw new UserError('Verification is not configured for this server.', { code: 'NOT_CONFIGURED' });
      const member = await fetchMember(ctx.guild, ctx.user.id);
      if (!member) throw new UserError('Could not load your membership.', { code: 'NOT_MEMBER' });
      const role = ctx.guild.roles.cache.get(settings.verify_role_id) || (await ctx.guild.roles.fetch(settings.verify_role_id).catch(() => null));
      if (member.roles.cache.has(settings.verify_role_id)) {
        return ctx.respond({ embeds: [ui.info('Already verified', 'You already have access.')] });
      }
      await assignRole(ctx, ctx.guild, member, role);
      services.audit({ guildId: ctx.guild.id, actorId: ctx.user.id, action: 'verification.passed', details: { roleId: settings.verify_role_id } });
      return ctx.respond({ embeds: [ui.success('Verified', 'Welcome! You now have access to the server.')] });
    },
  });

  // brole:<roleId> — toggles a button role.
  handlers.set('brole', {
    run: async (ctx) => {
      const [, roleId] = ctx.interaction.customId.split(':');
      if (!isSnowflake(roleId)) throw new UserError('Invalid role button.', { code: 'INVALID' });
      const member = await fetchMember(ctx.guild, ctx.user.id);
      const role = ctx.guild.roles.cache.get(roleId) || (await ctx.guild.roles.fetch(roleId).catch(() => null));
      const result = await assignRole(ctx, ctx.guild, member, role);
      services.audit({ guildId: ctx.guild.id, actorId: ctx.user.id, action: `buttonroles.${result}`, targetId: roleId });
      return ctx.respond({ embeds: [ui.success('Role updated', `Role ${result === 'added' ? 'added' : 'removed'}.`)] });
    },
  });

  // giveaway:enter:<id>
  handlers.set('giveaway', {
    run: async (ctx) => {
      const [, action, rawId] = ctx.interaction.customId.split(':');
      if (action !== 'enter' || !/^\d{1,9}$/.test(rawId || '')) throw new UserError('Invalid giveaway control.', { code: 'INVALID' });
      const id = Number(rawId);
      const g = repos.giveaways.get(id);
      if (!g || g.guild_id !== ctx.guild.id) throw new UserError('That giveaway no longer exists.', { code: 'NOT_FOUND' });
      if (g.status !== 'active' || g.ends_at <= Math.floor(Date.now() / 1000)) throw new UserError('This giveaway has ended.', { code: 'ENDED' });
      const added = repos.giveaways.addEntry(id, ctx.user.id);
      if (!added) return ctx.respond({ embeds: [ui.info('Already entered', 'You are already entered in this giveaway.')] });
      return ctx.respond({ embeds: [ui.success('Entered', 'Good luck!')] });
    },
  });

  // poll:vote:<pollId>:<optionIdx>
  handlers.set('poll', {
    run: async (ctx) => {
      const [, action, rawPoll, rawIdx] = ctx.interaction.customId.split(':');
      if (action !== 'vote' || !/^\d{1,9}$/.test(rawPoll || '') || !/^\d$/.test(rawIdx || '')) throw new UserError('Invalid poll control.', { code: 'INVALID' });
      const pollId = Number(rawPoll);
      const idx = Number(rawIdx);
      const poll = repos.polls.get(pollId);
      if (!poll || poll.guild_id !== ctx.guild.id) throw new UserError('That poll no longer exists.', { code: 'NOT_FOUND' });
      const options = repos.polls.options(pollId);
      if (!options.some((o) => o.idx === idx)) throw new UserError('That option does not exist.', { code: 'OPTION' });
      const outcome = repos.polls.vote(pollId, ctx.user.id, idx);
      if (outcome === 'closed') throw new UserError('This poll is closed.', { code: 'CLOSED' });
      if (outcome === 'already') throw new UserError('You have already voted in this poll.', { code: 'ALREADY' });
      return ctx.respond({ embeds: [ui.success('Vote recorded', 'Thanks for voting.')] });
    },
  });

  // owner:add|remove|cancel:<confirmationId> — global owner changes (double confirmation, owner-only).
  handlers.set('owner', {
    guildOnly: false,
    run: async (ctx) => {
      const [, action, token] = ctx.interaction.customId.split(':');
      if (!token) throw new UserError('Invalid confirmation.', { code: 'INVALID' });
      if (!ctx.isGlobalOwner) throw new UserError('Only global owners can change global ownership.', { code: 'NOT_OWNER' });
      if (action === 'cancel') {
        const row = repos.confirmations.get(token);
        if (row && row.actor_id === ctx.user.id) repos.confirmations.consume(token);
        return ctx.interaction.update({ embeds: [ui.info('Cancelled', 'No change was made.')], components: [] });
      }
      if (action !== 'add' && action !== 'remove') throw new UserError('Invalid confirmation.', { code: 'INVALID' });
      const payload = services.confirmations.consume({ id: token, action: `owner.${action}`, actorId: ctx.user.id });
      if (action === 'add') services.owners.addOwner({ actorId: ctx.user.id, targetId: payload.targetId });
      else services.owners.removeOwner({ actorId: ctx.user.id, targetId: payload.targetId });
      return ctx.interaction.update({ embeds: [ui.success('Global owners updated', `Change applied for ID \`${payload.targetId}\`.`)], components: [] });
    },
  });

  // backup:confirm|cancel:<confirmationId>
  handlers.set('backup', {
    run: async (ctx) => {
      const [, action, token] = ctx.interaction.customId.split(':');
      if (!token) throw new UserError('Invalid confirmation.', { code: 'INVALID' });
      if (action === 'cancel') {
        const row = repos.confirmations.get(token);
        if (row && row.actor_id === ctx.user.id) repos.confirmations.consume(token);
        return ctx.interaction.update({ embeds: [ui.info('Cancelled', 'No restore was performed.')], components: [] });
      }
      if (action !== 'confirm') throw new UserError('Invalid confirmation.', { code: 'INVALID' });
      const row = repos.confirmations.get(token);
      if (!row || row.guild_id !== ctx.guild.id) throw new UserError('This confirmation no longer exists.', { code: 'CONFIRM_MISSING' });
      const member = await fetchMember(ctx.guild, ctx.user.id);
      if (!member || !memberHas(member, PermissionFlagsBits.Administrator)) throw new UserError('You need Administrator to restore a backup.', { code: 'PERMISSION' });
      const payload = services.confirmations.consume({ id: token, action: 'backup.restore', actorId: ctx.user.id });
      const backup = repos.backups.get(ctx.guild.id, payload.backupId);
      if (!backup) throw new UserError('That backup no longer exists.', { code: 'NOT_FOUND' });
      const counts = restoreSnapshot(repos.db, repos, ctx.guild.id, backup.payload);
      services.audit({ guildId: ctx.guild.id, actorId: ctx.user.id, action: 'backup.restored', details: { backupId: backup.id, counts } });
      return ctx.interaction.update({ embeds: [ui.success('Backup restored', `Backup #${backup.id} applied (${counts.words} words, ${counts.domains} domains, ${counts.whitelist} whitelist entries).`)], components: [] });
    },
  });

  return {
    get: (prefix) => handlers.get(prefix) || null,
    prefixes: () => [...handlers.keys()],
  };
}

module.exports = { createComponentRouter };
