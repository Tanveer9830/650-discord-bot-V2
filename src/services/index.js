'use strict';

const { createOwnerService } = require('../security/owners');
const { createConfirmationService } = require('../security/confirmations');
const { createCooldowns } = require('../security/cooldowns');
const { createDeduper } = require('../security/dedupe');
const { createJoinMonitor } = require('../security/antiraid');
const { createSpamTracker } = require('../security/automod');
const { createEconomyService } = require('./economy');
const { createLevelingService } = require('./leveling');

/**
 * Assemble the service layer. Every service receives explicit dependencies, so tests can
 * build the same graph with an in-memory database and a fake clock.
 */
function createServices({ db, repos, config, logger, clock }) {
  const audit = (entry) => {
    try {
      repos.audit.insert(entry);
    } catch (error) {
      // Auditing must never crash a command, but a failure is still reported.
      logger.error('Audit write failed', { reason: error.message });
    }
  };
  const owners = createOwnerService({ configOwnerIds: config.ownerIds, repos, audit });
  return {
    audit,
    owners,
    confirmations: createConfirmationService({ repos, clock: () => clock.seconds(), ttlSeconds: 120 }),
    cooldowns: createCooldowns(() => clock.now()),
    deduper: createDeduper({ ttlMs: 60000, clock: () => clock.now() }),
    joinMonitor: createJoinMonitor(),
    spamTracker: createSpamTracker(),
    economy: createEconomyService({ db, repos, clock }),
    leveling: createLevelingService({ db, repos, clock }),
  };
}

module.exports = { createServices };
