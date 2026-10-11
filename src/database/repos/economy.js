'use strict';

const ECONOMY_DEFAULTS = Object.freeze({
  currency_name: 'coins',
  daily_amount: 250,
  daily_cooldown_seconds: 86400,
  work_min: 20,
  work_max: 80,
  work_cooldown_seconds: 3600,
});

function createEconomyRepo(db, clock) {
  return {
    settings(guildId) {
      return db.prepare('SELECT * FROM economy_settings WHERE guild_id = ?').get(guildId) || { guild_id: guildId, ...ECONOMY_DEFAULTS };
    },
    updateSettings(guildId, fields) {
      const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
      for (const [k] of entries) if (!(k in ECONOMY_DEFAULTS)) throw new Error(`Field not allowed: ${k}`);
      db.prepare('INSERT OR IGNORE INTO economy_settings (guild_id, updated_at) VALUES (?, ?)').run(guildId, clock.iso());
      for (const [k, v] of entries) {
        db.prepare(`UPDATE economy_settings SET ${k} = ?, updated_at = ? WHERE guild_id = ?`).run(v, clock.iso(), guildId);
      }
      return this.settings(guildId);
    },
    account(guildId, userId) {
      return db.prepare('SELECT * FROM economy_accounts WHERE guild_id = ? AND user_id = ?').get(guildId, userId)
        || { guild_id: guildId, user_id: userId, balance: 0, last_daily_at: null, last_work_at: null };
    },
    ensureAccount(guildId, userId) {
      db.prepare('INSERT OR IGNORE INTO economy_accounts (guild_id, user_id, balance) VALUES (?, ?, 0)').run(guildId, userId);
    },
    setBalance(guildId, userId, balance) {
      db.prepare('UPDATE economy_accounts SET balance = ? WHERE guild_id = ? AND user_id = ?').run(balance, guildId, userId);
    },
    setCooldown(guildId, userId, column, value) {
      if (column !== 'last_daily_at' && column !== 'last_work_at') throw new Error('Invalid cooldown column');
      db.prepare(`UPDATE economy_accounts SET ${column} = ? WHERE guild_id = ? AND user_id = ?`).run(value, guildId, userId);
    },
    insertTransaction({ guildId, userId, delta, balanceAfter, reason, counterpartyId = null }) {
      db.prepare(
        'INSERT INTO economy_transactions (guild_id, user_id, delta, balance_after, reason, counterparty_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(guildId, userId, delta, balanceAfter, reason, counterpartyId, clock.iso());
    },
    history(guildId, userId, limit = 10) {
      return db.prepare('SELECT * FROM economy_transactions WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT ?')
        .all(guildId, userId, Math.min(Math.max(limit, 1), 25));
    },
    leaderboard(guildId, limit = 10) {
      return db.prepare('SELECT user_id, balance FROM economy_accounts WHERE guild_id = ? AND balance > 0 ORDER BY balance DESC, user_id ASC LIMIT ?')
        .all(guildId, Math.min(Math.max(limit, 1), 25));
    },
    createItem({ guildId, name, price, stock = null, roleId = null, createdBy }) {
      const r = db.prepare('INSERT OR IGNORE INTO shop_items (guild_id, name, price, stock, role_id, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run(guildId, name, price, stock, roleId, createdBy);
      return r.changes === 1 ? Number(r.lastInsertRowid) : null;
    },
    listItems(guildId) {
      return db.prepare('SELECT * FROM shop_items WHERE guild_id = ? ORDER BY price, name LIMIT 50').all(guildId);
    },
    findItem(guildId, name) {
      return db.prepare('SELECT * FROM shop_items WHERE guild_id = ? AND name = ?').get(guildId, name) || null;
    },
    inventoryQuantity(guildId, userId, itemId) {
      const row = db.prepare('SELECT quantity FROM inventory WHERE guild_id = ? AND user_id = ? AND item_id = ?').get(guildId, userId, itemId);
      return row ? row.quantity : 0;
    },
    addInventory(guildId, userId, itemId, qty) {
      db.prepare(
        'INSERT INTO inventory (guild_id, user_id, item_id, quantity) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity',
      ).run(guildId, userId, itemId, qty);
    },
    decrementStock(itemId) {
      return db.prepare('UPDATE shop_items SET stock = stock - 1 WHERE id = ? AND stock IS NOT NULL AND stock > 0').run(itemId).changes === 1;
    },
  };
}

module.exports = { createEconomyRepo, ECONOMY_DEFAULTS };
