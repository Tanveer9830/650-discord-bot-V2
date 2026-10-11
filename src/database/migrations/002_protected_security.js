'use strict';

// Protected security policy: anti-nuke settings and the owner-managed, server-scoped whitelist.
// Append-only: this file must never be edited after it ships; add 003 instead.
module.exports = `
CREATE TABLE antinuke_settings (
  guild_id TEXT PRIMARY KEY CHECK (length(guild_id) BETWEEN 17 AND 20),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  response_mode TEXT NOT NULL DEFAULT 'alert' CHECK (response_mode IN ('log', 'alert', 'restrict')),
  window_seconds INTEGER NOT NULL DEFAULT 10 CHECK (window_seconds BETWEEN 5 AND 600),
  channel_delete_limit INTEGER NOT NULL DEFAULT 3 CHECK (channel_delete_limit BETWEEN 2 AND 200),
  channel_create_limit INTEGER NOT NULL DEFAULT 5 CHECK (channel_create_limit BETWEEN 2 AND 200),
  role_delete_limit INTEGER NOT NULL DEFAULT 3 CHECK (role_delete_limit BETWEEN 2 AND 200),
  role_create_limit INTEGER NOT NULL DEFAULT 5 CHECK (role_create_limit BETWEEN 2 AND 200),
  ban_limit INTEGER NOT NULL DEFAULT 5 CHECK (ban_limit BETWEEN 2 AND 200),
  kick_limit INTEGER NOT NULL DEFAULT 5 CHECK (kick_limit BETWEEN 2 AND 200),
  webhook_limit INTEGER NOT NULL DEFAULT 3 CHECK (webhook_limit BETWEEN 2 AND 200),
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Protected whitelist. Only verified global owners can write here (enforced in the service layer).
-- Each row grants ONE capability to ONE user in ONE server, optionally until expires_at (unix seconds).
-- Server administrators never receive anti-nuke privileges from this table.
CREATE TABLE protected_whitelist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL CHECK (length(guild_id) BETWEEN 17 AND 20),
  user_id TEXT NOT NULL CHECK (length(user_id) BETWEEN 17 AND 20),
  capability TEXT NOT NULL CHECK (capability IN ('all','channels','roles','bans','kicks','webhooks','bots','permissions','guild_settings')),
  authorized_by TEXT NOT NULL CHECK (length(authorized_by) BETWEEN 17 AND 20),
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at INTEGER,
  revoked_at INTEGER,
  revoked_by TEXT
);
-- At most one ACTIVE grant per user, server and capability. Revoked rows stay for history.
CREATE UNIQUE INDEX ux_protected_whitelist_active
  ON protected_whitelist (guild_id, user_id, capability) WHERE revoked_at IS NULL;
CREATE INDEX idx_protected_whitelist_guild ON protected_whitelist (guild_id, revoked_at);

-- Append-only audit history for protected changes.
CREATE TABLE protected_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  actor_id TEXT NOT NULL,
  target_id TEXT,
  capability TEXT,
  details TEXT CHECK (details IS NULL OR length(details) <= 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_protected_audit_guild_time ON protected_audit (guild_id, created_at);
CREATE TRIGGER protected_audit_no_update BEFORE UPDATE ON protected_audit
BEGIN SELECT RAISE(ABORT, 'protected_audit is append-only'); END;
CREATE TRIGGER protected_audit_no_delete BEFORE DELETE ON protected_audit
BEGIN SELECT RAISE(ABORT, 'protected_audit is append-only'); END;
`;
