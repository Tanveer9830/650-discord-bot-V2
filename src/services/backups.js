'use strict';

const { z } = require('zod');
const { UserError } = require('../utils/errors');

/**
 * Backups capture BOT CONFIGURATION for one server: guild settings, automod settings and words,
 * anti-raid settings, whitelist entries, and the domain blocklist.
 * They never include user balances, transaction history, warnings, or moderation cases.
 */

const MAX_PAYLOAD_BYTES = 256 * 1024;

const snapshotSchema = z.object({
  version: z.literal(1),
  guildId: z.string().regex(/^\d{17,20}$/),
  createdAt: z.string().max(40),
  settings: z.record(z.string(), z.union([z.string().max(2000), z.number().int(), z.null()])),
  automod: z.object({
    enabled: z.union([z.literal(0), z.literal(1)]),
    word_filter: z.union([z.literal(0), z.literal(1)]),
    block_links: z.union([z.literal(0), z.literal(1)]),
    block_invites: z.union([z.literal(0), z.literal(1)]),
    anti_spam: z.union([z.literal(0), z.literal(1)]),
    spam_max_messages: z.number().int().min(2).max(50),
    spam_window_seconds: z.number().int().min(2).max(120),
    timeout_seconds: z.number().int().min(10).max(2419200),
  }),
  automodWords: z.array(z.string().min(1).max(64)).max(500),
  antiraid: z.object({
    enabled: z.union([z.literal(0), z.literal(1)]),
    join_threshold: z.number().int().min(3).max(200),
    window_seconds: z.number().int().min(5).max(600),
    kick_new_joins: z.union([z.literal(0), z.literal(1)]),
  }),
  whitelist: z.array(z.object({
    kind: z.enum(['security_exemption', 'trusted_integration']),
    targetType: z.enum(['user', 'role']),
    targetId: z.string().regex(/^\d{17,20}$/),
  })).max(500),
  blocklist: z.array(z.string().min(4).max(253)).max(1000),
});

function buildSnapshot(repos, guildId, { now = new Date() } = {}) {
  const guild = repos.guild.get(guildId) || {};
  const settings = {};
  for (const field of repos.guild.fields) {
    if (field in guild) settings[field] = guild[field] ?? null;
  }
  const automodRow = repos.automod.get(guildId) || {};
  const automod = {
    enabled: automodRow.enabled ?? 0,
    word_filter: automodRow.word_filter ?? 1,
    block_links: automodRow.block_links ?? 0,
    block_invites: automodRow.block_invites ?? 0,
    anti_spam: automodRow.anti_spam ?? 0,
    spam_max_messages: automodRow.spam_max_messages ?? 5,
    spam_window_seconds: automodRow.spam_window_seconds ?? 8,
    timeout_seconds: automodRow.timeout_seconds ?? 300,
  };
  const ar = repos.antiraid.get(guildId) || {};
  const antiraid = {
    enabled: ar.enabled ?? 0,
    join_threshold: ar.join_threshold ?? 10,
    window_seconds: ar.window_seconds ?? 30,
    kick_new_joins: ar.kick_new_joins ?? 0,
  };
  const snapshot = {
    version: 1,
    guildId,
    createdAt: now.toISOString(),
    settings,
    automod,
    automodWords: repos.automod.words(guildId),
    antiraid,
    whitelist: repos.whitelist.list(guildId).map((r) => ({ kind: r.kind, targetType: r.target_type, targetId: r.target_id })),
    blocklist: repos.blocklist.list(guildId),
  };
  const size = Buffer.byteLength(JSON.stringify(snapshot), 'utf8');
  if (size > MAX_PAYLOAD_BYTES) {
    throw new UserError('This server\u2019s configuration is too large to back up. Remove unused words or blocklist entries first.', { code: 'TOO_LARGE' });
  }
  return snapshot;
}

/** Validate an untrusted snapshot before any write happens. */
function parseSnapshot(payload) {
  const result = snapshotSchema.safeParse(payload);
  if (!result.success) throw new UserError('This backup is damaged or from an incompatible version. Nothing was changed.', { code: 'INVALID_BACKUP' });
  return result.data;
}

/**
 * Apply a stored snapshot inside one transaction. Any failure rolls everything back.
 * The snapshot must belong to the same guild it is restored into.
 */
function restoreSnapshot(repos, guildId, payload, { actorId }) {
  const snap = parseSnapshot(payload);
  if (snap.guildId !== guildId) throw new UserError('This backup belongs to a different server and cannot be restored here.', { code: 'WRONG_GUILD' });
  const db = repos.db;
  db.exec('BEGIN IMMEDIATE');
  try {
    const settings = {};
    for (const field of repos.guild.fields) {
      if (field in snap.settings) settings[field] = snap.settings[field];
    }
    if (Object.keys(settings).length) repos.guild.update(guildId, settings);
    repos.automod.update(guildId, snap.automod);
    for (const word of repos.automod.words(guildId)) repos.automod.removeWord(guildId, word);
    for (const word of snap.automodWords) repos.automod.addWord(guildId, word, actorId);
    repos.antiraid.update(guildId, snap.antiraid);
    for (const entry of repos.whitelist.list(guildId)) {
      repos.whitelist.remove({ guildId, kind: entry.kind, targetType: entry.target_type, targetId: entry.target_id });
    }
    for (const entry of snap.whitelist) {
      repos.whitelist.add({ guildId, kind: entry.kind, targetType: entry.targetType, targetId: entry.targetId, addedBy: actorId });
    }
    for (const domain of repos.blocklist.list(guildId)) repos.blocklist.remove(guildId, domain);
    for (const domain of snap.blocklist) repos.blocklist.add(guildId, domain, actorId);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { restored: true, automodWords: snap.automodWords.length, whitelist: snap.whitelist.length, blocklist: snap.blocklist.length };
}

module.exports = { buildSnapshot, restoreSnapshot, parseSnapshot, MAX_PAYLOAD_BYTES };
