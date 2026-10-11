'use strict';

const { createGuildRepo, createOwnerRepo, createAuditRepo, createConfirmationRepo, createBackupRepo } = require('./guild');
const {
  createModCaseRepo,
  createWarningRepo,
  createAutomodRepo,
  createWhitelistRepo,
  createBlocklistRepo,
  createIncidentRepo,
  createAntiRaidRepo,
} = require('./moderation');
const { createEconomyRepo } = require('./economy');
const { createProtectionRepo } = require('./protection');
const {
  createLevelRepo,
  createCustomCommandRepo,
  createReminderRepo,
  createTicketRepo,
  createGiveawayRepo,
  createPollRepo,
} = require('./community');

/** Build every repository around one database handle and an injectable clock. */
function createRepos(db, clock = defaultClock()) {
  return {
    guild: createGuildRepo(db, clock),
    owners: createOwnerRepo(db, clock),
    audit: createAuditRepo(db, clock),
    confirmations: createConfirmationRepo(db),
    backups: createBackupRepo(db),
    modCases: createModCaseRepo(db, clock),
    warnings: createWarningRepo(db, clock),
    automod: createAutomodRepo(db, clock),
    whitelist: createWhitelistRepo(db, clock),
    blocklist: createBlocklistRepo(db, clock),
    incidents: createIncidentRepo(db, clock),
    antiraid: createAntiRaidRepo(db, clock),
    protection: createProtectionRepo(db, clock),
    economy: createEconomyRepo(db, clock),
    levels: createLevelRepo(db, clock),
    customCommands: createCustomCommandRepo(db, clock),
    reminders: createReminderRepo(db, clock),
    tickets: createTicketRepo(db, clock),
    giveaways: createGiveawayRepo(db, clock),
    polls: createPollRepo(db, clock),
    db,
  };
}

function defaultClock() {
  return {
    now: () => Date.now(),
    seconds: () => Math.floor(Date.now() / 1000),
    iso: () => new Date().toISOString(),
  };
}

module.exports = { createRepos, defaultClock };
