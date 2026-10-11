'use strict';

const ALLOWED_GUILD_FIELDS = Object.freeze([
  'log_channel_id',
  'welcome_channel_id',
  'welcome_message',
  'goodbye_channel_id',
  'goodbye_message',
  'verify_role_id',
  'ticket_category_id',
  'ticket_support_role_id',
]);

function createGuildRepo(db, clock) {
  return {
    get(guildId) {
      return db.prepare('SELECT * FROM guild_settings WHERE guild_id = ?').get(guildId) || null;
    },
    /** Upsert one or more whitelisted columns. Unknown fields are rejected, never interpolated. */
    update(guildId, fields) {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      for (const [key] of entries) {
        if (!ALLOWED_GUILD_FIELDS.includes(key)) throw new Error(`Field not allowed: ${key}`);
      }
      db.prepare(
        'INSERT OR IGNORE INTO guild_settings (guild_id, updated_at) VALUES (?, ?)',
      ).run(guildId, clock.iso());
      for (const [key, value] of entries) {
        db.prepare(`UPDATE guild_settings SET ${key} = ?, updated_at = ? WHERE guild_id = ?`).run(value, clock.iso(), guildId);
      }
      return this.get(guildId);
    },
    fields: ALLOWED_GUILD_FIELDS,
  };
}

function createOwnerRepo(db, clock) {
  return {
    list() {
      return db.prepare('SELECT user_id, added_by, added_at FROM bot_owners ORDER BY added_at').all();
    },
    has(userId) {
      return Boolean(db.prepare('SELECT 1 FROM bot_owners WHERE user_id = ?').get(userId));
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM bot_owners').get().n;
    },
    add(userId, addedBy) {
      db.prepare('INSERT INTO bot_owners (user_id, added_by, added_at) VALUES (?, ?, ?)').run(userId, addedBy, clock.iso());
    },
    remove(userId) {
      return db.prepare('DELETE FROM bot_owners WHERE user_id = ?').run(userId).changes;
    },
  };
}

function createAuditRepo(db, clock) {
  return {
    insert({ guildId = null, actorId = null, action, targetId = null, details = null }) {
      const serialised = details === null ? null : JSON.stringify(details).slice(0, 4000);
      db.prepare(
        'INSERT INTO audit_log (guild_id, actor_id, action, target_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(guildId, actorId, action, targetId, serialised, clock.iso());
    },
    recent({ guildId = null, limit = 10 } = {}) {
      const n = Math.min(Math.max(Number(limit) || 10, 1), 50);
      if (guildId === null) {
        return db.prepare('SELECT * FROM audit_log WHERE guild_id IS NULL ORDER BY id DESC LIMIT ?').all(n);
      }
      return db.prepare('SELECT * FROM audit_log WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, n);
    },
  };
}

function createConfirmationRepo(db) {
  return {
    create({ id, action, actorId, guildId = null, payload, expiresAt }) {
      db.prepare(
        'INSERT INTO pending_confirmations (id, action, actor_id, guild_id, payload, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, action, actorId, guildId, JSON.stringify(payload), expiresAt);
    },
    get(id) {
      const row = db.prepare('SELECT * FROM pending_confirmations WHERE id = ?').get(id);
      return row ? { ...row, payload: JSON.parse(row.payload) } : null;
    },
    consume(id) {
      return db.prepare('DELETE FROM pending_confirmations WHERE id = ?').run(id).changes === 1;
    },
    purgeExpired(nowSeconds) {
      return db.prepare('DELETE FROM pending_confirmations WHERE expires_at < ?').run(nowSeconds).changes;
    },
  };
}

function createBackupRepo(db) {
  return {
    insert({ guildId, label, createdBy, payload }) {
      const result = db.prepare(
        'INSERT INTO backups (guild_id, label, created_by, payload) VALUES (?, ?, ?, ?)',
      ).run(guildId, label, createdBy, JSON.stringify(payload));
      return Number(result.lastInsertRowid);
    },
    list(guildId, limit = 10) {
      return db.prepare('SELECT id, label, created_by, created_at, length(payload) AS size_bytes FROM backups WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
        .all(guildId, Math.min(Math.max(limit, 1), 25));
    },
    get(guildId, id) {
      const row = db.prepare('SELECT * FROM backups WHERE guild_id = ? AND id = ?').get(guildId, id);
      return row ? { ...row, payload: JSON.parse(row.payload) } : null;
    },
  };
}

module.exports = { createGuildRepo, createOwnerRepo, createAuditRepo, createConfirmationRepo, createBackupRepo };
