'use strict';

const crypto = require('node:crypto');
const { PermissionFlagsBits } = require('discord.js');
const { parseConfig } = require('../src/config');
const { createApp } = require('../src/app');
const { createLogger } = require('../src/utils/logger');

const OWNER = '1131248987173814336';

/** Deterministic clock whose time can be advanced by tests. */
function fakeClock(startMs = Date.parse('2026-10-10T12:00:00Z')) {
  let now = startMs;
  return {
    now: () => now,
    seconds: () => Math.floor(now / 1000),
    iso: () => new Date(now).toISOString(),
    advance(ms) { now += ms; },
    set(ms) { now = ms; },
  };
}

function silentLogger() {
  return createLogger({ level: 'silent' });
}

function testConfig(overrides = {}) {
  const base = parseConfig({
    NODE_ENV: 'test',
    OWNER_IDS: OWNER,
    DATABASE_PATH: ':memory:',
    COMMAND_COOLDOWN_MS: '0',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  return base;
}

/** Build the full application graph against an in-memory database. */
function makeApp({ clock = fakeClock(), config = testConfig(), logger = silentLogger() } = {}) {
  const app = createApp({ config, logger, clock, dbPath: ':memory:' });
  return { app, clock, config, logger, repos: app.repos, services: app.services, dispatcher: app.dispatcher };
}

/** Minimal discord.js-like PermissionsBitField stand-in. */
function perms(list = []) {
  // Accept permission NAMES (as in discord.js) and convert them to the real bit values the bot checks.
  const set = new Set(list.map((p) => String(typeof p === 'string' && p in PermissionFlagsBits ? PermissionFlagsBits[p] : p)));
  return { has: (flag) => set.has(String(flag)) || set.has('8'), toArray: () => [...set] };
}

function fakeRole({ id, name = 'role', position = 1, managed = false, guild }) {
  return { id, name, position, managed, guild, toString: () => `<@&${id}>`, delete: async () => null, edit: async () => null, setPosition: async () => null };
}

function fakeMember({ id, roles = [], permissions = [], highestPosition = 1, moderatable = true, username = 'member' }) {
  const roleCache = new Map(roles.map((r) => [r.id, r]));
  return {
    id,
    user: { id, username, tag: `${username}#0001` },
    roles: {
      cache: roleCache,
      highest: { position: highestPosition },
      add: async (role) => roleCache.set(role.id, role),
      remove: async (role) => roleCache.delete(role.id),
    },
    permissions: perms(permissions),
    moderatable,
    kick: async () => ({ kicked: id }),
    timeout: async (ms, reason) => ({ id, ms, reason }),
    isCommunicationDisabled: () => false,
  };
}

/** Fake guild: members, roles, bans, and a bot member. Enough for handler-level tests. */
function fakeGuild({ id = '123456789012345678', ownerId = '999999999999999999', members = [], botPermissions = ['8'], botPosition = 100 } = {}) {
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const bot = fakeMember({ id: '555555555555555555', permissions: botPermissions, highestPosition: botPosition, username: 'bot' });
  const guild = {
    id,
    name: 'Test Server',
    ownerId,
    memberCount: members.length + 1,
    members: {
      cache: memberMap,
      me: bot,
      fetch: async (userId) => {
        if (memberMap.has(userId)) return memberMap.get(userId);
        throw new Error('Unknown Member');
      },
      fetchMe: async () => bot,
    },
    roles: {
      everyone: { id, name: '@everyone', position: 0, managed: false, guild: null },
      cache: new Map(),
      fetch: async () => null,
    },
    channels: { cache: new Map(), create: async () => null },
    bans: { create: async () => null, remove: async () => null },
    bot,
  };
  guild.roles.everyone.guild = guild;
  return guild;
}

let interactionCounter = 0;

/** Fake interaction covering the surface our handlers use. Records every response. */
function fakeInteraction({ commandName, group = null, sub = null, options = {}, user, guild = null, channelId = '222222222222222222', customId = null, channel = null }) {
  interactionCounter += 1;
  const responses = [];
  const optionValue = (name) => (name in options ? options[name] : null);
  const interaction = {
    id: `${Date.now()}${interactionCounter}`,
    commandName,
    customId,
    guild,
    guildId: guild ? guild.id : null,
    channelId,
    channel: channel || { id: channelId, isTextBased: () => true, isDMBased: () => false, send: async (p) => ({ id: 'msg', ...p }), messages: { fetch: async () => new Map(), }, bulkDelete: async () => ({ size: 0 }) },
    user,
    member: null,
    deferred: false,
    replied: false,
    responses,
    isChatInputCommand: () => Boolean(commandName) && !customId,
    isAutocomplete: () => false,
    isButton: () => Boolean(customId),
    isModalSubmit: () => false,
    options: {
      getSubcommandGroup: () => group,
      getSubcommand: () => sub,
      getString: (n) => optionValue(n),
      getInteger: (n) => optionValue(n),
      getNumber: (n) => optionValue(n),
      getBoolean: (n) => optionValue(n),
      getUser: (n) => optionValue(n),
      getRole: (n) => optionValue(n),
      getChannel: (n) => optionValue(n),
      getFocused: () => ({ name: 'name', value: '' }),
    },
    reply: async (payload) => {
      interaction.replied = true;
      responses.push({ kind: 'reply', payload });
      return payload;
    },
    deferReply: async (payload) => {
      interaction.deferred = true;
      responses.push({ kind: 'defer', payload });
    },
    editReply: async (payload) => {
      responses.push({ kind: 'edit', payload });
      return payload;
    },
    update: async (payload) => {
      responses.push({ kind: 'update', payload });
      return payload;
    },
  };
  return interaction;
}

function lastResponse(interaction) {
  return interaction.responses[interaction.responses.length - 1];
}

function nid() {
  return crypto.randomBytes(8).readBigUInt64BE().toString().padStart(18, '1').slice(0, 18);
}

module.exports = {
  OWNER,
  fakeClock,
  silentLogger,
  testConfig,
  makeApp,
  fakeGuild,
  fakeMember,
  fakeRole,
  fakeInteraction,
  lastResponse,
  perms,
  nid,
};
