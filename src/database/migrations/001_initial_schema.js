'use strict';

// Initial schema. Constraints are enforced by SQLite so application bugs cannot
// create negative balances, duplicate rewards, or contradictory moderation state.
module.exports = `
CREATE TABLE guild_settings (
  guild_id TEXT PRIMARY KEY CHECK (length(guild_id) BETWEEN 17 AND 20),
  log_channel_id TEXT,
  welcome_channel_id TEXT,
  welcome_message TEXT CHECK (welcome_message IS NULL OR length(welcome_message) <= 1000),
  goodbye_channel_id TEXT,
  goodbye_message TEXT CHECK (goodbye_message IS NULL OR length(goodbye_message) <= 1000),
  verify_role_id TEXT,
  ticket_category_id TEXT,
  ticket_support_role_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE bot_owners (
  user_id TEXT PRIMARY KEY CHECK (length(user_id) BETWEEN 17 AND 20),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  actor_id TEXT,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
  target_id TEXT,
  details TEXT CHECK (details IS NULL OR length(details) <= 4000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_guild_time ON audit_log (guild_id, created_at);

CREATE TABLE mod_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('kick','ban','unban','timeout','untimeout','warn','purge')),
  target_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT CHECK (reason IS NULL OR length(reason) <= 512),
  duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_mod_cases_guild_target ON mod_cases (guild_id, target_id);

CREATE TABLE warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 512),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_warnings_guild_user ON warnings (guild_id, user_id, active);

CREATE TABLE automod_settings (
  guild_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  word_filter INTEGER NOT NULL DEFAULT 1 CHECK (word_filter IN (0, 1)),
  block_links INTEGER NOT NULL DEFAULT 0 CHECK (block_links IN (0, 1)),
  block_invites INTEGER NOT NULL DEFAULT 0 CHECK (block_invites IN (0, 1)),
  anti_spam INTEGER NOT NULL DEFAULT 0 CHECK (anti_spam IN (0, 1)),
  spam_max_messages INTEGER NOT NULL DEFAULT 5 CHECK (spam_max_messages BETWEEN 2 AND 50),
  spam_window_seconds INTEGER NOT NULL DEFAULT 8 CHECK (spam_window_seconds BETWEEN 2 AND 120),
  timeout_seconds INTEGER NOT NULL DEFAULT 300 CHECK (timeout_seconds BETWEEN 10 AND 2419200),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE automod_words (
  guild_id TEXT NOT NULL,
  word TEXT NOT NULL CHECK (length(word) BETWEEN 2 AND 64),
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (guild_id, word)
);

-- Security exemptions and trusted integrations are separate kinds and only affect automod/anti-spam.
-- They never grant command permissions or global ownership.
CREATE TABLE whitelist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('security_exemption','trusted_integration')),
  target_type TEXT NOT NULL CHECK (target_type IN ('user','role')),
  target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 17 AND 20),
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (guild_id, kind, target_type, target_id)
);

CREATE TABLE domain_blocklist (
  guild_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (length(domain) BETWEEN 4 AND 253),
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (guild_id, domain)
);

CREATE TABLE security_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high')),
  details TEXT CHECK (details IS NULL OR length(details) <= 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_incidents_guild_time ON security_incidents (guild_id, created_at);

CREATE TABLE antiraid_settings (
  guild_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  join_threshold INTEGER NOT NULL DEFAULT 10 CHECK (join_threshold BETWEEN 3 AND 200),
  window_seconds INTEGER NOT NULL DEFAULT 30 CHECK (window_seconds BETWEEN 5 AND 600),
  kick_new_joins INTEGER NOT NULL DEFAULT 0 CHECK (kick_new_joins IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_settings (
  guild_id TEXT PRIMARY KEY,
  currency_name TEXT NOT NULL DEFAULT 'coins' CHECK (length(currency_name) BETWEEN 1 AND 24),
  daily_amount INTEGER NOT NULL DEFAULT 250 CHECK (daily_amount BETWEEN 1 AND 1000000),
  daily_cooldown_seconds INTEGER NOT NULL DEFAULT 86400 CHECK (daily_cooldown_seconds BETWEEN 60 AND 2592000),
  work_min INTEGER NOT NULL DEFAULT 20 CHECK (work_min BETWEEN 1 AND 100000),
  work_max INTEGER NOT NULL DEFAULT 80 CHECK (work_max BETWEEN 1 AND 100000 AND work_max >= work_min),
  work_cooldown_seconds INTEGER NOT NULL DEFAULT 3600 CHECK (work_cooldown_seconds BETWEEN 60 AND 2592000),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE economy_accounts (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  last_daily_at INTEGER,
  last_work_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE economy_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  delta INTEGER NOT NULL CHECK (delta <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 64),
  counterparty_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_econ_tx_user ON economy_transactions (guild_id, user_id, id);

CREATE TABLE shop_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 40),
  price INTEGER NOT NULL CHECK (price > 0 AND price <= 1000000000),
  stock INTEGER CHECK (stock IS NULL OR stock >= 0),
  role_id TEXT,
  created_by TEXT NOT NULL,
  UNIQUE (guild_id, name)
);

CREATE TABLE inventory (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  item_id INTEGER NOT NULL REFERENCES shop_items (id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  PRIMARY KEY (guild_id, user_id, item_id)
);

CREATE TABLE level_settings (
  guild_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  announce_channel_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE level_users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  last_xp_at INTEGER,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE level_roles (
  guild_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 500),
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, level)
);

-- Global, owner-managed custom commands. Templates only: no code execution.
CREATE TABLE custom_commands (
  name TEXT PRIMARY KEY CHECK (name GLOB '[a-z]*' AND length(name) BETWEEN 2 AND 32),
  kind TEXT NOT NULL CHECK (kind IN ('text','embed')),
  title TEXT CHECK (title IS NULL OR length(title) <= 256),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  color INTEGER CHECK (color IS NULL OR color BETWEEN 0 AND 16777215),
  min_permission TEXT NOT NULL DEFAULT 'everyone' CHECK (min_permission IN ('everyone','manage_messages','manage_guild')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT,
  channel_id TEXT,
  user_id TEXT NOT NULL,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 500),
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled','failed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reminders_due ON reminders (status, due_at);

CREATE TABLE tickets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL UNIQUE,
  opener_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT,
  closed_by TEXT
);
CREATE UNIQUE INDEX idx_one_open_ticket ON tickets (guild_id, opener_id) WHERE status = 'open';

CREATE TABLE giveaways (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  host_id TEXT NOT NULL,
  prize TEXT NOT NULL CHECK (length(prize) BETWEEN 1 AND 200),
  winner_count INTEGER NOT NULL CHECK (winner_count BETWEEN 1 AND 20),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended','cancelled')),
  ends_at INTEGER NOT NULL,
  winners TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_giveaways_due ON giveaways (status, ends_at);

CREATE TABLE giveaway_entries (
  giveaway_id INTEGER NOT NULL REFERENCES giveaways (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE polls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  question TEXT NOT NULL CHECK (length(question) BETWEEN 1 AND 300),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE poll_options (
  poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL CHECK (idx BETWEEN 0 AND 9),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  PRIMARY KEY (poll_id, idx)
);

CREATE TABLE poll_votes (
  poll_id INTEGER NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  option_idx INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (poll_id, user_id),
  FOREIGN KEY (poll_id, option_idx) REFERENCES poll_options (poll_id, idx) ON DELETE CASCADE
);

CREATE TABLE backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 64),
  created_by TEXT NOT NULL,
  payload TEXT NOT NULL CHECK (length(payload) <= 2000000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_backups_guild ON backups (guild_id, id);

-- Two-step confirmation for sensitive actions. Single-use, short-lived, bound to the actor.
CREATE TABLE pending_confirmations (
  id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 16 AND 64),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 1 AND 60),
  actor_id TEXT NOT NULL,
  guild_id TEXT,
  payload TEXT NOT NULL CHECK (length(payload) <= 4000),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
`;
