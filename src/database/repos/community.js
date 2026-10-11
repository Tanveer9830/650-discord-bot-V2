'use strict';

function createLevelRepo(db, clock) {
  return {
    settings(guildId) {
      return db.prepare('SELECT * FROM level_settings WHERE guild_id = ?').get(guildId) || { guild_id: guildId, enabled: 0, announce_channel_id: null };
    },
    updateSettings(guildId, { enabled, announceChannelId }) {
      db.prepare('INSERT OR IGNORE INTO level_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, clock.iso());
      if (enabled !== undefined) db.prepare('UPDATE level_settings SET enabled = ?, updated_at = ? WHERE guild_id = ?').run(enabled ? 1 : 0, clock.iso(), guildId);
      if (announceChannelId !== undefined) db.prepare('UPDATE level_settings SET announce_channel_id = ?, updated_at = ? WHERE guild_id = ?').run(announceChannelId, clock.iso(), guildId);
      return this.settings(guildId);
    },
    user(guildId, userId) {
      return db.prepare('SELECT * FROM level_users WHERE guild_id = ? AND user_id = ?').get(guildId, userId)
        || { guild_id: guildId, user_id: userId, xp: 0, level: 0, last_xp_at: null };
    },
    saveUser(guildId, userId, { xp, level, lastXpAt }) {
      db.prepare(
        'INSERT INTO level_users (guild_id, user_id, xp, level, last_xp_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, last_xp_at = excluded.last_xp_at',
      ).run(guildId, userId, xp, level, lastXpAt);
    },
    leaderboard(guildId, limit = 10) {
      return db.prepare('SELECT user_id, xp, level FROM level_users WHERE guild_id = ? AND xp > 0 ORDER BY xp DESC, user_id ASC LIMIT ?')
        .all(guildId, Math.min(Math.max(limit, 1), 25));
    },
    setLevelRole(guildId, level, roleId) {
      db.prepare('INSERT INTO level_roles (guild_id, level, role_id) VALUES (?, ?, ?) ON CONFLICT (guild_id, level) DO UPDATE SET role_id = excluded.role_id')
        .run(guildId, level, roleId);
    },
    removeLevelRole(guildId, level) {
      return db.prepare('DELETE FROM level_roles WHERE guild_id = ? AND level = ?').run(guildId, level).changes === 1;
    },
    levelRolesUpTo(guildId, level) {
      return db.prepare('SELECT level, role_id FROM level_roles WHERE guild_id = ? AND level <= ? ORDER BY level').all(guildId, level);
    },
  };
}

function createCustomCommandRepo(db, clock) {
  return {
    list() {
      return db.prepare('SELECT name, kind, min_permission, enabled, updated_at FROM custom_commands ORDER BY name').all();
    },
    get(name) {
      return db.prepare('SELECT * FROM custom_commands WHERE name = ?').get(name) || null;
    },
    insert(def) {
      db.prepare(
        'INSERT INTO custom_commands (name, kind, title, body, color, min_permission, enabled, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)',
      ).run(def.name, def.kind, def.title, def.body, def.color, def.minPermission, def.actorId, def.actorId, clock.iso(), clock.iso());
    },
    setEnabled(name, enabled, actorId) {
      return db.prepare('UPDATE custom_commands SET enabled = ?, updated_by = ?, updated_at = ? WHERE name = ?')
        .run(enabled ? 1 : 0, actorId, clock.iso(), name).changes === 1;
    },
    remove(name) {
      return db.prepare('DELETE FROM custom_commands WHERE name = ?').run(name).changes === 1;
    },
  };
}

function createReminderRepo(db, clock) {
  return {
    insert({ guildId, channelId, userId, message, dueAt }) {
      const r = db.prepare('INSERT INTO reminders (guild_id, channel_id, user_id, message, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(guildId, channelId, userId, message, dueAt, clock.iso());
      return Number(r.lastInsertRowid);
    },
    listForUser(userId, limit = 10) {
      return db.prepare("SELECT * FROM reminders WHERE user_id = ? AND status = 'pending' ORDER BY due_at LIMIT ?")
        .all(userId, Math.min(Math.max(limit, 1), 25));
    },
    cancel(userId, id) {
      return db.prepare("UPDATE reminders SET status = 'cancelled' WHERE id = ? AND user_id = ? AND status = 'pending'").run(id, userId).changes === 1;
    },
    dueBefore(nowSeconds, limit = 50) {
      return db.prepare("SELECT * FROM reminders WHERE status = 'pending' AND due_at <= ? ORDER BY due_at LIMIT ?").all(nowSeconds, limit);
    },
    setStatus(id, status) {
      db.prepare('UPDATE reminders SET status = ? WHERE id = ?').run(status, id);
    },
  };
}

function createTicketRepo(db, clock) {
  return {
    openForUser(guildId, openerId) {
      return db.prepare("SELECT * FROM tickets WHERE guild_id = ? AND opener_id = ? AND status = 'open'").get(guildId, openerId) || null;
    },
    insert({ guildId, channelId, openerId }) {
      const r = db.prepare('INSERT INTO tickets (guild_id, channel_id, opener_id, created_at) VALUES (?, ?, ?, ?)')
        .run(guildId, channelId, openerId, clock.iso());
      return Number(r.lastInsertRowid);
    },
    byChannel(channelId) {
      return db.prepare('SELECT * FROM tickets WHERE channel_id = ?').get(channelId) || null;
    },
    close(channelId, closedBy) {
      return db.prepare("UPDATE tickets SET status = 'closed', closed_at = ?, closed_by = ? WHERE channel_id = ? AND status = 'open'")
        .run(clock.iso(), closedBy, channelId).changes === 1;
    },
    countOpen(guildId) {
      return db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status = 'open'").get(guildId).n;
    },
  };
}

function createGiveawayRepo(db, clock) {
  return {
    insert({ guildId, channelId, hostId, prize, winnerCount, endsAt }) {
      const r = db.prepare('INSERT INTO giveaways (guild_id, channel_id, host_id, prize, winner_count, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(guildId, channelId, hostId, prize, winnerCount, endsAt, clock.iso());
      return Number(r.lastInsertRowid);
    },
    setMessage(id, messageId) {
      db.prepare('UPDATE giveaways SET message_id = ? WHERE id = ?').run(messageId, id);
    },
    get(id) {
      return db.prepare('SELECT * FROM giveaways WHERE id = ?').get(id) || null;
    },
    list(guildId, limit = 10) {
      return db.prepare('SELECT * FROM giveaways WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, Math.min(Math.max(limit, 1), 25));
    },
    addEntry(id, userId) {
      return db.prepare("INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, created_at) SELECT id, ?, ? FROM giveaways WHERE id = ? AND status = 'active'")
        .run(userId, clock.iso(), id).changes === 1;
    },
    entries(id) {
      return db.prepare('SELECT user_id FROM giveaway_entries WHERE giveaway_id = ? ORDER BY user_id').all(id).map((r) => r.user_id);
    },
    dueBefore(nowSeconds) {
      return db.prepare("SELECT * FROM giveaways WHERE status = 'active' AND ends_at <= ? ORDER BY ends_at LIMIT 20").all(nowSeconds);
    },
    finish(id, winners) {
      return db.prepare("UPDATE giveaways SET status = 'ended', winners = ? WHERE id = ? AND status = 'active'")
        .run(JSON.stringify(winners), id).changes === 1;
    },
    setWinners(id, winners) {
      db.prepare("UPDATE giveaways SET winners = ? WHERE id = ? AND status = 'ended'").run(JSON.stringify(winners), id);
    },
    cancel(guildId, id) {
      return db.prepare("UPDATE giveaways SET status = 'cancelled' WHERE guild_id = ? AND id = ? AND status = 'active'").run(guildId, id).changes === 1;
    },
  };
}

function createPollRepo(db, clock) {
  return {
    create({ guildId, channelId, question, options, createdBy }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = db.prepare('INSERT INTO polls (guild_id, channel_id, question, created_by, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(guildId, channelId, question, createdBy, clock.iso());
        const id = Number(r.lastInsertRowid);
        const ins = db.prepare('INSERT INTO poll_options (poll_id, idx, label) VALUES (?, ?, ?)');
        options.forEach((label, idx) => ins.run(id, idx, label));
        db.exec('COMMIT');
        return id;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    setMessage(id, messageId) {
      db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(messageId, id);
    },
    get(id) {
      return db.prepare('SELECT * FROM polls WHERE id = ?').get(id) || null;
    },
    options(id) {
      return db.prepare('SELECT idx, label FROM poll_options WHERE poll_id = ? ORDER BY idx').all(id);
    },
    /** One vote per user; a vote for a non-existent option is rejected by the foreign key. */
    vote(id, userId, optionIdx) {
      const poll = db.prepare("SELECT status FROM polls WHERE id = ?").get(id);
      if (!poll || poll.status !== 'open') return 'closed';
      const existing = db.prepare('SELECT option_idx FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(id, userId);
      if (existing) return 'already';
      db.prepare('INSERT INTO poll_votes (poll_id, user_id, option_idx, created_at) VALUES (?, ?, ?, ?)').run(id, userId, optionIdx, clock.iso());
      return 'ok';
    },
    tally(id) {
      return db.prepare('SELECT option_idx, COUNT(*) AS votes FROM poll_votes WHERE poll_id = ? GROUP BY option_idx').all(id);
    },
    close(id) {
      return db.prepare("UPDATE polls SET status = 'closed' WHERE id = ? AND status = 'open'").run(id).changes === 1;
    },
  };
}

module.exports = {
  createLevelRepo,
  createCustomCommandRepo,
  createReminderRepo,
  createTicketRepo,
  createGiveawayRepo,
  createPollRepo,
};
