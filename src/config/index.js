'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { z } = require('zod');
const { ConfigError } = require('../utils/errors');

/** Initial global owner. Can be replaced via OWNER_IDS; never inferred from server permissions. */
const DEFAULT_OWNER_ID = '1131248987173814336';

const SNOWFLAKE = /^\d{17,20}$/;
// Discord bot tokens: base64url id segment, timestamp segment, HMAC segment.
const DISCORD_TOKEN = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}$/;

const boolFromEnv = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1' || v === 'yes');

const snowflakeOptional = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || SNOWFLAKE.test(v), 'must be a numeric Discord snowflake (17-20 digits)');

const ownerList = z
  .string()
  .optional()
  .transform((raw) => {
    const source = raw && raw.trim() ? raw : DEFAULT_OWNER_ID;
    return [...new Set(source.split(',').map((s) => s.trim()).filter(Boolean))];
  })
  .refine((ids) => ids.length >= 1 && ids.length <= 10, 'must contain between 1 and 10 owner IDs')
  .refine((ids) => ids.every((id) => SNOWFLAKE.test(id)), 'every owner ID must be a numeric Discord snowflake');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  DISCORD_TOKEN: z.string().trim().optional().refine((v) => v === undefined || v === '' || DISCORD_TOKEN.test(v), 'has an invalid format').transform((v) => (v ? v : undefined)),
  DISCORD_CLIENT_ID: snowflakeOptional,
  DISCORD_DEV_GUILD_ID: snowflakeOptional,
  OWNER_IDS: ownerList,
  DATABASE_PATH: z.string().trim().min(1).default('./data/bot.sqlite'),
  BACKUP_DIR: z.string().trim().min(1).default('./data/backups'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  COMMAND_COOLDOWN_MS: z.coerce.number().int().min(0).max(60000).default(1500),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).max(300000).default(15000),
  ALLOW_LOCAL_OVERRIDE: boolFromEnv,
});

/**
 * Parse and validate configuration. Issues describe the variable name only,
 * never the value, so the error can be logged safely.
 */
function parseConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || 'config'} ${issue.message}`);
    throw new ConfigError(issues);
  }
  const data = result.data;
  return Object.freeze({
    env: data.NODE_ENV,
    discord: Object.freeze({
      token: data.DISCORD_TOKEN,
      clientId: data.DISCORD_CLIENT_ID,
      devGuildId: data.DISCORD_DEV_GUILD_ID,
    }),
    ownerIds: Object.freeze([...data.OWNER_IDS]),
    database: Object.freeze({ path: data.DATABASE_PATH }),
    backupDir: data.BACKUP_DIR,
    log: Object.freeze({ level: data.LOG_LEVEL, format: data.LOG_FORMAT }),
    commandCooldownMs: data.COMMAND_COOLDOWN_MS,
    schedulerIntervalMs: data.SCHEDULER_INTERVAL_MS,
  });
}

/** Load a .env file if present (Node's built-in loader, no extra dependency). */
function loadDotEnv(filePath = process.env.ENV_FILE || path.resolve(process.cwd(), '.env')) {
  if (fs.existsSync(filePath) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(filePath);
    return true;
  }
  return false;
}

/** Summary safe for diagnostics: presence and shape only, never values. */
function describeConfig(config) {
  return {
    env: config.env,
    discordCredentialsPresent: Boolean(config.discord.token),
    clientIdConfigured: Boolean(config.discord.clientId),
    devGuildConfigured: Boolean(config.discord.devGuildId),
    ownerCount: config.ownerIds.length,
    usingDefaultOwner: config.ownerIds.length === 1 && config.ownerIds[0] === DEFAULT_OWNER_ID,
    databasePath: path.basename(config.database.path),
    logLevel: config.log.level,
  };
}

module.exports = { parseConfig, loadDotEnv, describeConfig, DEFAULT_OWNER_ID, SNOWFLAKE, DISCORD_TOKEN };
