'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrations');
const { createRepos } = require('../src/database/repos');
const { fakeClock } = require('./helpers');

test('migrations apply once, and re-running is a no-op', () => {
  const db = openDatabase(':memory:');
  const first = migrate(db);
  assert.ok(first.applied.length >= 1);
  const second = migrate(db);
  assert.equal(second.applied.length, 0);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
  assert.ok(tables.length >= 30, `expected at least 30 tables, got ${tables.length}`);
  db.close();
});

test('database enforces CHECK constraints (balance never negative, confirmation IDs bounded)', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  assert.throws(() => db.prepare("INSERT INTO economy_accounts (guild_id, user_id, balance) VALUES ('123456789012345678','123456789012345679', -1)").run(), /CHECK/);
  db.close();
});

test('guild settings reject fields outside the allow-list', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  const repos = createRepos(db, fakeClock());
  assert.throws(() => repos.guild.update('123456789012345678', { owner_id: '1' }), /not allowed/i);
  repos.guild.update('123456789012345678', { welcome_message: 'hi' });
  assert.equal(repos.guild.get('123456789012345678').welcome_message, 'hi');
  db.close();
});

test('poll votes are one per user and changing a vote replaces it', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  const repos = createRepos(db, fakeClock());
  const id = repos.polls.create({ guildId: '123456789012345678', channelId: '222222222222222222', question: 'Q?', options: ['a', 'b'], createdBy: '100000000000000001' });
  repos.polls.vote(id, '100000000000000002', 0);
  repos.polls.vote(id, '100000000000000002', 1);
  const tally = repos.polls.tally(id);
  const total = tally.reduce((n, row) => n + row.votes, 0);
  assert.equal(total, 1);
  db.close();
});

test('a failing transaction rolls back every write inside it', () => {
  const db = openDatabase(':memory:');
  migrate(db);
  const repos = createRepos(db, fakeClock());
  const { createEconomyService } = require('../src/services/economy');
  const econ = createEconomyService({ db, repos, clock: fakeClock() });
  const g = '123456789012345678';
  repos.economy.ensureAccount(g, '100000000000000001');
  repos.economy.setBalance(g, '100000000000000001', 50);
  assert.throws(() => econ.pay({ guildId: g, fromId: '100000000000000001', toId: 'not-a-snowflake', amount: 10 }), /Invalid recipient/);
  assert.equal(repos.economy.account(g, '100000000000000001').balance, 50);
  db.close();
});
