#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { loadDotEnv, parseConfig, describeConfig } = require('./config');
const { createLogger } = require('./utils/logger');
const { registerSecret } = require('./utils/redact');
const { ConfigError } = require('./utils/errors');
const { detectTerminal, renderFullBanner, BRAND } = require('./branding');

const EXIT_CONFIG = 78; // matches EX_CONFIG; systemd is told not to restart on this code
const pkg = require(path.join(__dirname, '..', 'package.json'));

async function main(argv = process.argv.slice(2)) {
  const checkOnly = argv.includes('--check');
  const term = detectTerminal();
  const banner = renderFullBanner({ color: term.color, width: term.width, version: pkg.version });
  process.stdout.write(`${banner}\n\n`);

  loadDotEnv();
  let config;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error:\n${error.issues.map((i) => `  - ${i}`).join('\n')}\n`);
      process.stderr.write('Fix the values in your environment file (never paste tokens into logs or issues).\n');
      return EXIT_CONFIG;
    }
    throw error;
  }
  if (config.discord.token) registerSecret(config.discord.token);
  const logger = createLogger({ level: config.log.level, format: config.log.format });
  logger.info('Starting bot', { version: pkg.version, config: describeConfig(config) });

  if (checkOnly) {
    const { createApp } = require('./app');
    const { createDiscordClient } = require('./client');
    void createDiscordClient; // loaded to prove the Discord library resolves
    const app = createApp({ config, logger });
    // The summary is written directly (not via the logger) so it is visible even when LOG_LEVEL=silent.
    process.stdout.write('Check passed: configuration, database migrations, and command registry are valid.\n');
    process.stdout.write(`${JSON.stringify({
      migrationsApplied: app.migration.applied,
      commandModules: app.registry.modules.length,
      actions: app.registry.actions.size,
      config: describeConfig(config),
    })}\n`);
    app.close();
    return 0;
  }

  if (!config.discord.token) {
    process.stderr.write('Configuration error:\n  - DISCORD_TOKEN is not set. The bot cannot connect to Discord.\n');
    return EXIT_CONFIG;
  }

  const { createApp } = require('./app');
  const { createDiscordClient } = require('./client');
  const { registerEvents } = require('./events');
  const { Events } = require('discord.js');

  const app = createApp({ config, logger });
  const client = createDiscordClient();
  app.setClient(client);
  registerEvents(client, { logger, dispatcher: app.dispatcher, services: app.services, repos: app.repos, config });

  client.once(Events.ClientReady, (readyClient) => {
    // Only report "online" after Discord has confirmed the login.
    logger.info(`Verified: logged in as ${readyClient.user.tag}`, { guilds: readyClient.guilds.cache.size, brand: BRAND.attribution });
    app.scheduler.start();
    if (config.autoRegisterCommands && config.discord.clientId) {
      // Runs in the background: a registration failure is logged and never stops the bot.
      const { registerCommands } = require('../scripts/register-commands');
      const scope = config.discord.devGuildId ? 'guild' : 'global';
      const stateFile = path.join(path.dirname(path.resolve(config.database.path)), 'command-registration.json');
      registerCommands({ config, scope, guildId: config.discord.devGuildId || null, registry: app.registry, stateFile })
        .then((result) => {
          if (result.status === 'failed') logger.warn('Command registration failed', { reason: result.error, scope });
          else logger.info('Command registration', { status: result.status, scope, count: result.count ?? result.topLevelCount, verified: Boolean(result.verified) });
        })
        .catch((error) => logger.warn('Command registration error', { reason: error.message }));
    }
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });
    app.scheduler.stop();
    try {
      await client.destroy();
    } finally {
      app.db.close();
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', { reason: reason && reason.message }));
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { reason: error.message, stack: error.stack });
    process.exit(1);
  });

  try {
    await client.login(config.discord.token);
  } catch (error) {
    logger.error('Login to Discord failed', { reason: error.message, code: error.code });
    app.close();
    return 1;
  }
  return null; // keep running
}

if (require.main === module) {
  main().then((code) => {
    if (code !== null && code !== undefined) process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`Fatal startup error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
