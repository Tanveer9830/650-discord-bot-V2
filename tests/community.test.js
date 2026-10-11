'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, fakeClock, fakeGuild } = require('./helpers');
const { pickWinners } = require('../src/services/giveaways');
const { createScheduler } = require('../src/services/scheduler');
const { silentLogger } = require('./helpers');

const G = '123456789012345678';

test('pickWinners draws unique winners and never more than the entrants', () => {
  const seq = [0, 0, 0, 0];
  const pick = (max) => (seq.length ? seq.shift() % max : 0);
  const winners = pickWinners(['a', 'b', 'c', 'a'], 2, pick);
  assert.equal(new Set(winners).size, winners.length);
  assert.equal(winners.length, 2);
  assert.equal(pickWinners(['x'], 5, () => 0).length, 1);
  assert.deepEqual(pickWinners([], 3, () => 0), []);
});

test('giveaway entries are unique per user and the scheduler ends due giveaways', async () => {
  const clock = fakeClock();
  const { repos, app } = makeApp({ clock });
  const id = repos.giveaways.insert({ guildId: G, channelId: '222222222222222222', hostId: '100000000000000001', prize: 'Nitro', winnerCount: 1, endsAt: clock.seconds() + 60 });
  repos.giveaways.addEntry(id, '100000000000000002');
  repos.giveaways.addEntry(id, '100000000000000002');
  assert.equal(repos.giveaways.entries(id).length, 1);
  const scheduler = createScheduler({ repos, clock, logger: silentLogger(), client: () => null, intervalMs: 1000 });
  assert.equal((await scheduler.tick()).giveawaysEnded, 0, 'not due yet');
  clock.advance(61_000);
  const result = await scheduler.tick();
  assert.equal(result.giveawaysEnded, 1);
  const g = repos.giveaways.get(id);
  assert.equal(g.status, 'ended');
  assert.deepEqual(JSON.parse(g.winners), ['100000000000000002']);
  app.close();
});

test('reminders are delivered once with mentions disabled, then marked sent', async () => {
  const clock = fakeClock();
  const { repos, app } = makeApp({ clock });
  const sent = [];
  const channel = { send: async (payload) => { sent.push(payload); return { id: 'm' }; } };
  const discord = { channels: { fetch: async () => channel } };
  repos.reminders.insert({ guildId: G, channelId: '222222222222222222', userId: '100000000000000001', message: 'stretch', dueAt: clock.seconds() + 5 });
  const scheduler = createScheduler({ repos, clock, logger: silentLogger(), client: () => discord, intervalMs: 1000 });
  clock.advance(6000);
  assert.equal((await scheduler.tick()).remindersSent, 1);
  assert.equal((await scheduler.tick()).remindersSent, 0, 'not delivered twice');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
  assert.match(sent[0].content, /stretch/);
  app.close();
});

test('a failed reminder delivery is recorded as failed, not retried forever', async () => {
  const clock = fakeClock();
  const { repos, app } = makeApp({ clock });
  repos.reminders.insert({ guildId: G, channelId: '222222222222222222', userId: '100000000000000001', message: 'x', dueAt: clock.seconds() });
  const discord = { channels: { fetch: async () => { throw new Error('Missing Access'); } } };
  const scheduler = createScheduler({ repos, clock, logger: silentLogger(), client: () => discord, intervalMs: 1000 });
  await scheduler.tick();
  const rows = repos.db.prepare('SELECT status FROM reminders').all();
  assert.equal(rows[0].status, 'failed');
  app.close();
});

test('poll and ticket records behave: tickets are one-per-opener and close cleanly', () => {
  const { repos, app } = makeApp();
  const t = repos.tickets.insert({ guildId: G, channelId: '300000000000000001', openerId: '100000000000000001' });
  assert.ok(t);
  assert.equal(repos.tickets.countOpen(G), 1);
  assert.equal(repos.tickets.openForUser(G, '100000000000000001').channel_id, '300000000000000001');
  repos.tickets.close('300000000000000001', '100000000000000001');
  assert.equal(repos.tickets.countOpen(G), 0);
  app.close();
});

test('fakeGuild helper exposes the bot member used by hierarchy checks', () => {
  const guild = fakeGuild();
  assert.equal(typeof guild.members.me.roles.highest.position, 'number');
});
