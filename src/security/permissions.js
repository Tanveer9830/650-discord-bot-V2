'use strict';

const { PermissionFlagsBits, PermissionsBitField } = require('discord.js');
const { UserError } = require('../utils/errors');

function memberHas(member, flag) {
  if (!member || !member.permissions) return false;
  return member.permissions.has(flag);
}

function missingPermissions(member, flags) {
  if (!member || !member.permissions) return [...flags];
  return flags.filter((flag) => !member.permissions.has(flag));
}

function flagNames(flags) {
  return flags.map((f) => {
    const entry = Object.entries(PermissionFlagsBits).find(([, v]) => v === f);
    return entry ? entry[0] : String(f);
  });
}

/**
 * Role-hierarchy decision for acting on another member (kick, ban, timeout, role changes).
 * Accepts plain objects with { id, roles.highest.position } so the logic is testable without Discord.
 */
function canActOnMember({ actor, target, bot, guildOwnerId }) {
  if (!actor || !target || !bot) return { ok: false, reason: 'Missing member information.' };
  if (target.id === actor.id) return { ok: false, reason: 'You cannot use moderation actions on yourself.' };
  if (target.id === bot.id) return { ok: false, reason: 'I cannot take moderation actions on myself.' };
  if (target.id === guildOwnerId) return { ok: false, reason: 'The server owner cannot be moderated by the bot.' };
  const targetPos = target.roles.highest.position;
  if (actor.id !== guildOwnerId && actor.roles.highest.position <= targetPos) {
    return { ok: false, reason: 'That member has an equal or higher role than you.' };
  }
  if (bot.roles.highest.position <= targetPos) {
    return { ok: false, reason: 'My highest role is not above that member\u2019s highest role.' };
  }
  return { ok: true };
}

/** Role-management decision: the bot and actor must both outrank the role; managed roles are off limits. */
function canManageRole({ actor, role, bot, guildOwnerId }) {
  if (!role) return { ok: false, reason: 'That role does not exist.' };
  if (role.managed) return { ok: false, reason: 'Managed (integration) roles cannot be changed.' };
  if (role.id === role.guild?.id) return { ok: false, reason: 'The @everyone role cannot be changed here.' };
  if (bot.roles.highest.position <= role.position) return { ok: false, reason: 'My highest role must be above that role.' };
  if (actor.id !== guildOwnerId && actor.roles.highest.position <= role.position) {
    return { ok: false, reason: 'You must have a higher role than the role you are changing.' };
  }
  return { ok: true };
}

function assertOk(result) {
  if (!result.ok) throw new UserError(result.reason, { code: 'HIERARCHY' });
  return true;
}

module.exports = { memberHas, missingPermissions, flagNames, canActOnMember, canManageRole, assertOk, PermissionsBitField };
