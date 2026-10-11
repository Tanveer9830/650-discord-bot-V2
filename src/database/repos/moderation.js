'use strict';

function createModCaseRepo(db, clock) {
  return {
    insert({ guildId, action, targetId, moderatorId, reason = null, durationSeconds = null }) {
      const r = db.prepare(
        'INSERT INTO mod_cases (guild_id, action, target_id, moderator_id, reason, duration_seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(guildId, action, targetId, moderatorId, reason, durationSeconds, clock.iso());
      return Number(r.lastInsertRowid);
    },
    history(guildId, targetId, limit = 10) {
      return db.prepare('SELECT * FROM mod_cases WHERE guild_id = ? AND target_id = ? ORDER BY id DESC LIMIT ?')
        .all(guildId, targetId, Math.min(Math.max(limit, 1), 25));
    },
  };
}

function createWarningRepo(db, clock) {
  return {
    add({ guildId, userId, moderatorId, reason }) {
      const r = db.prepare(
        'INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)',
      ).run(guildId, userId, moderatorId, reason, clock.iso());
      return Number(r.lastInsertRowid);
    },
    listActive(guildId, userId, limit = 10) {
      return db.prepare('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1 ORDER BY id DESC LIMIT ?')
        .all(guildId, userId, Math.min(Math.max(limit, 1), 25));
    },
    /** Deactivate (soft delete) one warning, scoped to the guild and user. */
    deactivate(guildId, userId, warningId) {
      return db.prepare('UPDATE warnings SET active = 0 WHERE guild_id = ? AND user_id = ? AND id = ? AND active = 1')
        .run(guildId, userId, warningId).changes;
    },
    clear(guildId, userId) {
      return db.prepare('UPDATE warnings SET active = 0 WHERE guild_id = ? AND user_id = ? AND active = 1')
        .run(guildId, userId).changes;
    },
  };
}

const AUTOMOD_DEFAULTS = Object.freeze({
  enabled: 0,
  word_filter: 1,
  block_links: 0,
  block_invites: 0,
  anti_spam: 0,
  spam_max_messages: 5,
  spam_window_seconds: 8,
  timeout_seconds: 300,
});

function createAutomodRepo(db, clock) {
  return {
    get(guildId) {
      const row = db.prepare('SELECT * FROM automod_settings WHERE guild_id = ?').get(guildId);
      return row || { guild_id: guildId, ...AUTOMOD_DEFAULTS };
    },
    update(guildId, fields) {
      const allowed = Object.keys(AUTOMOD_DEFAULTS);
      const entries = Object.entries(fields);
      for (const [k] of entries) {
        if (!allowed.includes(k)) throw new Error(`Field not allowed: ${k}`);
      }
      db.prepare('INSERT OR IGNORE INTO automod_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, clock.iso());
      for (const [k, v] of entries) {
        db.prepare(`UPDATE automod_settings SET ${k} = ?, updated_at = ? WHERE guild_id = ?`).run(v, clock.iso(), guildId);
      }
      return this.get(guildId);
    },
    addWord(guildId, word, addedBy) {
      const r = db.prepare('INSERT OR IGNORE INTO automod_words (guild_id, word, added_by, created_at) VALUES (?, ?, ?, ?)')
        .run(guildId, word, addedBy, clock.iso());
      return r.changes === 1;
    },
    removeWord(guildId, word) {
      return db.prepare('DELETE FROM automod_words WHERE guild_id = ? AND word = ?').run(guildId, word).changes === 1;
    },
    words(guildId) {
      return db.prepare('SELECT word FROM automod_words WHERE guild_id = ? ORDER BY word').all(guildId).map((r) => r.word);
    },
  };
}

function createWhitelistRepo(db, clock) {
  return {
    add({ guildId, kind, targetType, targetId, addedBy }) {
      const r = db.prepare(
        'INSERT OR IGNORE INTO whitelist_entries (guild_id, kind, target_type, target_id, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(guildId, kind, targetType, targetId, addedBy, clock.iso());
      return r.changes === 1;
    },
    remove({ guildId, kind, targetType, targetId }) {
      return db.prepare('DELETE FROM whitelist_entries WHERE guild_id = ? AND kind = ? AND target_type = ? AND target_id = ?')
        .run(guildId, kind, targetType, targetId).changes === 1;
    },
    list(guildId) {
      return db.prepare('SELECT * FROM whitelist_entries WHERE guild_id = ? ORDER BY kind, id').all(guildId);
    },
    /** Returns true if the user or any of the roles is exempt for the given kind. */
    isExempt({ guildId, kind, userId, roleIds = [] }) {
      const rows = db.prepare(
        'SELECT target_type, target_id FROM whitelist_entries WHERE guild_id = ? AND kind = ?',
      ).all(guildId, kind);
      const roles = new Set(roleIds);
      return rows.some((r) => (r.target_type === 'user' && r.target_id === userId) || (r.target_type === 'role' && roles.has(r.target_id)));
    },
  };
}

function createBlocklistRepo(db, clock) {
  return {
    add(guildId, domain, addedBy) {
      return db.prepare('INSERT OR IGNORE INTO domain_blocklist (guild_id, domain, added_by, created_at) VALUES (?, ?, ?, ?)')
        .run(guildId, domain, addedBy, clock.iso()).changes === 1;
    },
    remove(guildId, domain) {
      return db.prepare('DELETE FROM domain_blocklist WHERE guild_id = ? AND domain = ?').run(guildId, domain).changes === 1;
    },
    list(guildId) {
      return db.prepare('SELECT domain FROM domain_blocklist WHERE guild_id = ? ORDER BY domain').all(guildId).map((r) => r.domain);
    },
  };
}

function createIncidentRepo(db, clock) {
  return {
    insert({ guildId, kind, severity, details = null }) {
      const r = db.prepare('INSERT INTO security_incidents (guild_id, kind, severity, details, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(guildId, kind, severity, details === null ? null : String(details).slice(0, 2000), clock.iso());
      return Number(r.lastInsertRowid);
    },
    recent(guildId, limit = 10) {
      return db.prepare('SELECT * FROM security_incidents WHERE guild_id = ? ORDER BY id DESC LIMIT ?')
        .all(guildId, Math.min(Math.max(limit, 1), 25));
    },
  };
}

function createAntiRaidRepo(db, clock) {
  const defaults = { enabled: 0, join_threshold: 10, window_seconds: 30, kick_new_joins: 0 };
  return {
    get(guildId) {
      return db.prepare('SELECT * FROM antiraid_settings WHERE guild_id = ?').get(guildId) || { guild_id: guildId, ...defaults };
    },
    update(guildId, fields) {
      const entries = Object.entries(fields);
      for (const [k] of entries) if (!(k in defaults)) throw new Error(`Field not allowed: ${k}`);
      db.prepare('INSERT OR IGNORE INTO antiraid_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, clock.iso());
      for (const [k, v] of entries) {
        db.prepare(`UPDATE antiraid_settings SET ${k} = ?, updated_at = ? WHERE guild_id = ?`).run(v, clock.iso(), guildId);
      }
      return this.get(guildId);
    },
  };
}

module.exports = {
  createModCaseRepo,
  createWarningRepo,
  createAutomodRepo,
  createWhitelistRepo,
  createBlocklistRepo,
  createIncidentRepo,
  createAntiRaidRepo,
  AUTOMOD_DEFAULTS,
};
