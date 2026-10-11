'use strict';

const crypto = require('node:crypto');
const { UserError } = require('../utils/errors');

/**
 * Two-step confirmations for sensitive actions (owner changes, backup restores).
 * A confirmation is single-use, expires, and can only be consumed by the same actor who created it.
 */
function createConfirmationService({ repos, clock = () => Math.floor(Date.now() / 1000), ttlSeconds = 120 }) {
  return {
    create({ action, actorId, guildId = null, payload }) {
      repos.confirmations.purgeExpired(clock());
      const id = crypto.randomBytes(12).toString('base64url');
      repos.confirmations.create({ id, action, actorId, guildId, payload, expiresAt: clock() + ttlSeconds });
      return id;
    },
    /** Validates and consumes a confirmation. Returns the stored payload. */
    consume({ id, action, actorId }) {
      const row = repos.confirmations.get(id);
      if (!row) throw new UserError('This confirmation no longer exists. Please run the command again.', { code: 'CONFIRM_MISSING' });
      if (row.action !== action) throw new UserError('This confirmation belongs to a different action.', { code: 'CONFIRM_MISMATCH' });
      if (row.actor_id !== actorId) throw new UserError('Only the person who started this action can confirm it.', { code: 'CONFIRM_ACTOR' });
      if (row.expires_at < clock()) {
        repos.confirmations.consume(id);
        throw new UserError('This confirmation has expired. Please run the command again.', { code: 'CONFIRM_EXPIRED' });
      }
      if (!repos.confirmations.consume(id)) {
        throw new UserError('This confirmation was already used.', { code: 'CONFIRM_USED' });
      }
      return row.payload;
    },
  };
}

module.exports = { createConfirmationService };
