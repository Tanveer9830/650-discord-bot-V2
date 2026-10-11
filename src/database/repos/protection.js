'use strict';

const { transaction } = require('../connection');
const { DEFAULT_LIMITS, DEFAULT_SETTINGS, CAPABILITIES, RESPONSE_MODES } = require('../../security/antinuke');

const SETTING_COLUMNS = Object.freeze(['enabled', 'response_mode', 'window_seconds', ...Object.keys(DEFAULT_LIMITS)]);
/** Protected (owner-only) columns. Administrators may change only the thresholds and window. */
const PROTECTED_COLUMNS = Object.freeze(['enabled', 'response_mode']);

/**
 * Repository for anti-nuke settings, the protected whitelist and the append-only protected audit.
 * Authorisation is NOT decided here: services/protectedAuth.js decides who may call these methods.
 */
function createProtectionRepo(db, clock) {
  function insertAudit({ guildId, action, actorId, targetId = null, capability = null, details = null }) {
    db.prepare(
      'INSERT INTO protected_audit (guild_id, action, actor_id, target_id, capability, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(guildId ?? null, action, actorId, targetId, capability, details ? JSON.stringify(details).slice(0, 2000) : null, clock.iso());
  }

  return {
    columns: SETTING_COLUMNS,
    protectedColumns: PROTECTED_COLUMNS,

    getSettings(guildId) {
      const row = db.prepare('SELECT * FROM antinuke_settings WHERE guild_id = ?').get(guildId);
      if (row) return row;
      return {
        guild_id: guildId,
        enabled: DEFAULT_SETTINGS.enabled ? 1 : 0,
        response_mode: DEFAULT_SETTINGS.responseMode,
        window_seconds: DEFAULT_SETTINGS.windowSeconds,
        ...DEFAULT_LIMITS,
        updated_by: null,
      };
    },

    /** Apply validated column changes in one transaction and write an audit row with old and new values. */
    updateSettings({ guildId, changes, actorId }) {
      for (const key of Object.keys(changes)) {
        if (!SETTING_COLUMNS.includes(key)) throw new Error(`Setting not allowed: ${key}`);
      }
      if (changes.response_mode !== undefined && !RESPONSE_MODES.includes(changes.response_mode)) {
        throw new Error('Invalid response mode.');
      }
      return transaction(db, () => {
        const before = this.getSettings(guildId);
        db.prepare('INSERT OR IGNORE INTO antinuke_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, clock.iso());
        for (const [key, value] of Object.entries(changes)) {
          db.prepare(`UPDATE antinuke_settings SET ${key} = ?, updated_by = ?, updated_at = ? WHERE guild_id = ?`)
            .run(value, actorId, clock.iso(), guildId);
        }
        const after = this.getSettings(guildId);
        const diff = {};
        for (const key of Object.keys(changes)) diff[key] = { from: before[key], to: after[key] };
        insertAudit({ guildId, action: 'antinuke.settings.updated', actorId, details: diff });
        return after;
      });
    },

    /** Grant a capability. Returns the new row id, or null when an active grant already exists. */
    grant({ guildId, userId, capability, authorizedBy, expiresAt = null, reason = null }) {
      if (!CAPABILITIES.includes(capability)) throw new Error('Unknown capability.');
      return transaction(db, () => {
        const existing = db.prepare(
          'SELECT id FROM protected_whitelist WHERE guild_id = ? AND user_id = ? AND capability = ? AND revoked_at IS NULL',
        ).get(guildId, userId, capability);
        if (existing) return null;
        const now = clock.iso();
        const result = db.prepare(
          'INSERT INTO protected_whitelist (guild_id, user_id, capability, authorized_by, reason, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(guildId, userId, capability, authorizedBy, reason, now, now, expiresAt);
        insertAudit({
          guildId, action: 'whitelist.grant', actorId: authorizedBy, targetId: userId, capability,
          details: { expiresAt, reason },
        });
        return Number(result.lastInsertRowid);
      });
    },

    /** Revoke the active grant. Returns true if a grant was revoked. */
    revoke({ guildId, userId, capability, actorId, nowSec }) {
      return transaction(db, () => {
        const result = db.prepare(
          'UPDATE protected_whitelist SET revoked_at = ?, revoked_by = ?, updated_at = ? WHERE guild_id = ? AND user_id = ? AND capability = ? AND revoked_at IS NULL',
        ).run(nowSec, actorId, clock.iso(), guildId, userId, capability);
        if (result.changes !== 1) return false;
        insertAudit({ guildId, action: 'whitelist.revoke', actorId, targetId: userId, capability });
        return true;
      });
    },

    /** Capabilities currently granted to a user in one server (expired and revoked rows excluded). */
    activeCapabilities({ guildId, userId, nowSec }) {
      return db.prepare(
        `SELECT capability FROM protected_whitelist
         WHERE guild_id = ? AND user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`,
      ).all(guildId, userId, nowSec).map((r) => r.capability);
    },

    listActive({ guildId, nowSec }) {
      return db.prepare(
        `SELECT * FROM protected_whitelist
         WHERE guild_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)
         ORDER BY user_id, capability`,
      ).all(guildId, nowSec);
    },

    /** Grant history for a server, including revoked and expired rows. */
    grantHistory({ guildId, limit = 50 }) {
      return db.prepare('SELECT * FROM protected_whitelist WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
    },

    audit(entry) {
      insertAudit(entry);
    },

    recentAudit({ guildId, limit = 20 }) {
      return db.prepare('SELECT * FROM protected_audit WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit);
    },
  };
}

module.exports = { createProtectionRepo };
