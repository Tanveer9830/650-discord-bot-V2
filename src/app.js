'use strict';

const { openDatabase } = require('./database/connection');
const { migrate } = require('./database/migrations');
const { createRepos, defaultClock } = require('./database/repos');
const { createServices } = require('./services');
const { createComponentRouter } = require('./components');
const { createDispatcher } = require('./commands/dispatcher');
const { buildRegistry } = require('./commands');
const { createScheduler } = require('./services/scheduler');

/**
 * Composition root: builds the database, repositories, services, command registry, and dispatcher.
 * It never connects to Discord, so it can be exercised in tests and in `--check` mode.
 */
function createApp({ config, logger, clock = defaultClock(), dbPath = config.database.path }) {
  const db = openDatabase(dbPath);
  const migration = migrate(db);
  const repos = createRepos(db, clock);
  const services = createServices({ db, repos, config, logger, clock });
  const registry = buildRegistry();
  services.builtinNames = registry.topLevelNames;
  const components = createComponentRouter({ repos, services });
  let client = null;
  const dispatcher = createDispatcher({
    registry,
    components,
    services,
    repos,
    config,
    logger,
    deduper: services.deduper,
    cooldowns: services.cooldowns,
    getClient: () => client,
  });
  const scheduler = createScheduler({
    repos,
    clock,
    logger,
    client: () => client,
    intervalMs: config.schedulerIntervalMs,
  });
  return {
    db,
    migration,
    repos,
    services,
    registry,
    components,
    dispatcher,
    scheduler,
    setClient(c) {
      client = c;
    },
    close() {
      scheduler.stop();
      db.close();
    },
  };
}

module.exports = { createApp };
