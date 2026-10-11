'use strict';

const { isSnowflake } = require('../utils/ids');
const { UserError } = require('../utils/errors');

/**
 * Global owner authority.
 *
 * - Seeded owners come from validated configuration (OWNER_IDS, default 1131248987173814336).
 * - Additional owners are stored in bot_owners and can only be added/removed through owner commands
 *   that require a confirmation step (see security/confirmations.js).
 * - Authority is decided ONLY by the numeric Discord user ID supplied by Discord's interaction payload.
 *   Usernames, display names, server roles, and Administrator permission never grant global ownership.
 * - Seeded owners cannot be removed through commands; removing one requires editing configuration.
 * - The last remaining owner can never be removed.
 */
function createOwnerService({ configOwnerIds, repos, audit }) {
  const seeded = new Set(configOwnerIds);

  function isGlobalOwner(userId) {
    if (!isSnowflake(userId)) return false;
    return seeded.has(userId) || repos.owners.has(userId);
  }

  function listOwners() {
    const rows = [...seeded].map((userId) => ({ userId, source: 'config', addedBy: null, addedAt: null }));
    for (const row of repos.owners.list()) {
      if (!seeded.has(row.user_id)) {
        rows.push({ userId: row.user_id, source: 'database', addedBy: row.added_by, addedAt: row.added_at });
      }
    }
    return rows;
  }

  function addOwner({ actorId, targetId }) {
    if (!isGlobalOwner(actorId)) throw new UserError('Only global owners can change global ownership.', { code: 'NOT_OWNER' });
    if (!isSnowflake(targetId)) throw new UserError('That is not a valid Discord user ID.', { code: 'INVALID_ID' });
    if (isGlobalOwner(targetId)) throw new UserError('That user is already a global owner.', { code: 'ALREADY_OWNER' });
    const count = listOwners().length;
    if (count >= 10) throw new UserError('The owner limit (10) has been reached.', { code: 'LIMIT' });
    repos.owners.add(targetId, actorId);
    audit({ actorId, action: 'owner.added', targetId, details: { source: 'owner_command' } });
    return { added: true };
  }

  function removeOwner({ actorId, targetId }) {
    if (!isGlobalOwner(actorId)) throw new UserError('Only global owners can change global ownership.', { code: 'NOT_OWNER' });
    if (!isSnowflake(targetId)) throw new UserError('That is not a valid Discord user ID.', { code: 'INVALID_ID' });
    if (seeded.has(targetId)) {
      throw new UserError('This owner is defined in configuration and cannot be removed by a command.', { code: 'SEEDED' });
    }
    if (!repos.owners.has(targetId)) throw new UserError('That user is not a database-managed global owner.', { code: 'NOT_FOUND' });
    const remaining = listOwners().filter((o) => o.userId !== targetId);
    if (remaining.length < 1) {
      throw new UserError('Refusing to remove the last global owner.', { code: 'LAST_OWNER' });
    }
    repos.owners.remove(targetId);
    audit({ actorId, action: 'owner.removed', targetId, details: { source: 'owner_command' } });
    return { removed: true };
  }

  return { isGlobalOwner, listOwners, addOwner, removeOwner, seededCount: seeded.size };
}

module.exports = { createOwnerService };
