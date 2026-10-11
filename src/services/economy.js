'use strict';

const { transaction } = require('../database/connection');
const { UserError } = require('../utils/errors');
const { isSnowflake } = require('../utils/ids');

const MAX_AMOUNT = 1_000_000_000;

function assertAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > MAX_AMOUNT) {
    throw new UserError(`Amount must be a whole number between 1 and ${MAX_AMOUNT.toLocaleString('en-US')}.`, { code: 'AMOUNT' });
  }
}

/**
 * Virtual currency. Every balance change happens inside a BEGIN IMMEDIATE transaction,
 * writes an economy_transactions ledger row, and is protected by a CHECK (balance >= 0)
 * constraint, so no path can produce a negative balance or a half-applied transfer.
 * This is in-game currency only and has no real-money value.
 */
function createEconomyService({ db, repos, clock, random = (min, max) => min + Math.floor(Math.random() * (max - min + 1)) }) {
  const nowSec = () => clock.seconds();

  function balanceOf(guildId, userId) {
    return repos.economy.account(guildId, userId).balance;
  }

  /** Credit or debit inside an existing transaction. Caller must be inside transaction(). */
  function applyDelta(guildId, userId, delta, reason, counterpartyId = null) {
    repos.economy.ensureAccount(guildId, userId);
    const current = repos.economy.account(guildId, userId).balance;
    const next = current + delta;
    if (next < 0) throw new UserError('Insufficient balance.', { code: 'INSUFFICIENT' });
    repos.economy.setBalance(guildId, userId, next);
    repos.economy.insertTransaction({ guildId, userId, delta, balanceAfter: next, reason, counterpartyId });
    return next;
  }

  function claimCooldown(guildId, userId, column, cooldownSeconds) {
    const account = repos.economy.account(guildId, userId);
    const last = account[column];
    const now = nowSec();
    if (last && now - last < cooldownSeconds) {
      return { ok: false, retryAt: last + cooldownSeconds };
    }
    repos.economy.setCooldown(guildId, userId, column, now);
    return { ok: true };
  }

  return {
    balanceOf,

    daily(guildId, userId) {
      return transaction(db, () => {
        const settings = repos.economy.settings(guildId);
        repos.economy.ensureAccount(guildId, userId);
        const gate = claimCooldown(guildId, userId, 'last_daily_at', settings.daily_cooldown_seconds);
        if (!gate.ok) return { ok: false, retryAt: gate.retryAt };
        const balance = applyDelta(guildId, userId, settings.daily_amount, 'daily');
        return { ok: true, amount: settings.daily_amount, balance, currency: settings.currency_name };
      });
    },

    work(guildId, userId) {
      return transaction(db, () => {
        const settings = repos.economy.settings(guildId);
        repos.economy.ensureAccount(guildId, userId);
        const gate = claimCooldown(guildId, userId, 'last_work_at', settings.work_cooldown_seconds);
        if (!gate.ok) return { ok: false, retryAt: gate.retryAt };
        const amount = random(settings.work_min, settings.work_max);
        const balance = applyDelta(guildId, userId, amount, 'work');
        return { ok: true, amount, balance, currency: settings.currency_name };
      });
    },

    pay({ guildId, fromId, toId, amount }) {
      assertAmount(amount);
      if (!isSnowflake(toId)) throw new UserError('Invalid recipient.', { code: 'INVALID_ID' });
      if (fromId === toId) throw new UserError('You cannot pay yourself.', { code: 'SELF_PAY' });
      return transaction(db, () => {
        const senderAfter = applyDelta(guildId, fromId, -amount, 'transfer_out', toId);
        const receiverAfter = applyDelta(guildId, toId, amount, 'transfer_in', fromId);
        return { senderBalance: senderAfter, receiverBalance: receiverAfter };
      });
    },

    buyItem({ guildId, userId, itemName }) {
      return transaction(db, () => {
        const item = repos.economy.findItem(guildId, itemName);
        if (!item) throw new UserError('That item does not exist in this server\u2019s shop.', { code: 'NO_ITEM' });
        if (item.stock !== null && item.stock <= 0) throw new UserError('That item is out of stock.', { code: 'OUT_OF_STOCK' });
        const balance = applyDelta(guildId, userId, -item.price, `shop:${item.name}`.slice(0, 64));
        if (item.stock !== null && !repos.economy.decrementStock(item.id)) {
          throw new UserError('That item just sold out.', { code: 'OUT_OF_STOCK' });
        }
        repos.economy.addInventory(guildId, userId, item.id, 1);
        return { item, balance };
      });
    },

    createItem({ guildId, name, price, stock, roleId, createdBy }) {
      assertAmount(price);
      if (!/^[\p{L}\p{N} _-]{1,40}$/u.test(name)) throw new UserError('Item names may use letters, numbers, spaces, underscores, and hyphens (max 40).', { code: 'NAME' });
      const id = repos.economy.createItem({ guildId, name, price, stock, roleId, createdBy });
      if (id === null) throw new UserError('An item with that name already exists.', { code: 'DUPLICATE' });
      return id;
    },
  };
}

module.exports = { createEconomyService, assertAmount, MAX_AMOUNT };
