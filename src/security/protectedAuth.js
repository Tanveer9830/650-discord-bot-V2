'use strict';

const { UserError } = require('../utils/errors');
const { isSnowflake } = require('../utils/ids');

/**
 * Central authorisation for protected security operations.
 *
 *  - Protected writes (whitelist grants/revokes, protected settings, branding, operator access)
 *    require a verified GLOBAL OWNER, identified only by numeric Discord ID.
 *  - Server administrators, roles, nicknames and display names never qualify.
 *  - Fail closed: if the owner lookup or the database throws, the answer is "no".
 */
function createProtectedAuth({ owners, repos, clock }) {
  function isGlobalOwner(actorId) {
    if (!isSnowflake(actorId)) return false;
    try {
      return owners.isGlobalOwner(actorId) === true;
    } catch {
      return false;
    }
  }

  function assertGlobalOwner(actorId) {
    if (!isGlobalOwner(actorId)) {
      throw new UserError('Only the verified global owner can change protected security settings.', { code: 'NOT_OWNER' });
    }
    return true;
  }

  /**
   * Capabilities granted to a user in one server, right now. Returns [] on any error (fail closed:
   * an error means no exemption, which means the rule is applied normally).
   */
  function grantsFor({ guildId, userId }) {
    if (!isSnowflake(guildId) || !isSnowflake(userId)) return [];
    try {
      return repos.protection.activeCapabilities({ guildId, userId, nowSec: clock.seconds() });
    } catch {
      return [];
    }
  }

  return { isGlobalOwner, assertGlobalOwner, grantsFor };
}

module.exports = { createProtectedAuth };
