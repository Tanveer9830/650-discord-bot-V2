'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, fakeClock } = require('./helpers');
const { levelFromXp, xpForLevel, XP_COOLDOWN_SECONDS } = require('../src/services/leveling');
const { assertAmount, MAX_AMOUNT } = require('../src/services/economy');
const { evaluate } = require('../src/services/calc');

const G = '123456789012345678';
const A = '100000000000000001';
const B = '100000000000000002';

test('pay moves coins and writes a balanced pair of ledger rows', () => {
  const { services, repos } = makeApp();
  repos.economy.ensureAccount(G, A);
  repos.economy.setBalance(G, A, 100);
  services.economy.pay({ guildId: G, fromId: A, toId: B, amount: 30 });
  assert.equal(repos.economy.account(G, A).balance, 70);
  assert.equal(repos.economy.account(G, B).balance, 30);
  const aHist = repos.economy.history(G, A);
  const bHist = repos.economy.history(G, B);
  assert.equal(aHist.reduce((n, r) => n + r.delta, 0), -30);
  assert.equal(bHist.reduce((n, r) => n + r.delta, 0), 30);
});

test('pay refuses overdrafts, self-payment, and non-positive or huge amounts', () => {
  const { services, repos } = makeApp();
  repos.economy.ensureAccount(G, A);
  repos.economy.setBalance(G, A, 10);
  assert.throws(() => services.economy.pay({ guildId: G, fromId: A, toId: B, amount: 11 }), /Insufficient/);
  assert.throws(() => services.economy.pay({ guildId: G, fromId: A, toId: A, amount: 1 }), /yourself/);
  assert.throws(() => assertAmount(0), /between 1/);
  assert.throws(() => assertAmount(MAX_AMOUNT + 1), /between 1/);
  assert.equal(repos.economy.account(G, A).balance, 10, 'failed payments leave balances untouched');
});

test('daily reward respects its cooldown and records a ledger entry', () => {
  const clock = fakeClock();
  const { services, repos } = makeApp({ clock });
  const first = services.economy.daily(G, A);
  assert.ok(first.amount > 0);
  const early = services.economy.daily(G, A);
  assert.equal(early.ok, false, 'second claim inside the cooldown is refused');
  assert.ok(early.retryAt > 0);
  clock.advance(86_400_000 + 1000);
  assert.equal(services.economy.daily(G, A).ok, true);
  assert.equal(repos.economy.history(G, A).length, 2);
});

test('leveling thresholds are cumulative and monotonic', () => {
  assert.equal(xpForLevel(1), 100);
  assert.equal(xpForLevel(2), 300);
  assert.equal(levelFromXp(0), 0);
  assert.equal(levelFromXp(xpForLevel(5)), 5);
  assert.equal(levelFromXp(xpForLevel(5) - 1), 4);
  for (let l = 1; l < 50; l += 1) assert.ok(xpForLevel(l + 1) > xpForLevel(l));
});

test('message XP is only granted when leveling is enabled and respects the cooldown', () => {
  const clock = fakeClock();
  const { services, repos } = makeApp({ clock });
  assert.equal(services.leveling.awardMessage(G, A), null, 'disabled by default');
  repos.levels.updateSettings(G, { enabled: 1 });
  const first = services.leveling.awardMessage(G, A);
  assert.ok(first && first.gained >= 15 && first.gained <= 25);
  assert.equal(services.leveling.awardMessage(G, A), null, 'inside the cooldown no XP is granted');
  clock.advance((XP_COOLDOWN_SECONDS + 1) * 1000);
  assert.ok(services.leveling.awardMessage(G, A));
});

test('calc evaluates arithmetic safely and rejects everything else', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('2 ^ 10'), 1024);
  assert.throws(() => evaluate('process.exit(1)'));
  assert.throws(() => evaluate('require("fs")'));
  assert.throws(() => evaluate('1/0'));
  assert.throws(() => evaluate('x'.repeat(200)));
});
