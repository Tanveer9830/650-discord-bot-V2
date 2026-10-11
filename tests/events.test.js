'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { makeApp, fakeGuild, fakeMember, OWNER } = require('./helpers');
const { registerEvents } = require('../src/events');

const G = '123456789012345678';
const AUTHOR = '100000000000000021';

function setup() {
  const { app, repos, services, logger } = makeApp();
  const client = new EventEmitter();
  registerEvents(client, { logger, dispatcher: app.dispatcher, services, repos, config: app.config || {} });
  const guild = fakeGuild({ id: G, members: [] });
  guild.members.me.permissions = { has: () => true, toArray: () => [] };
  const author = fakeMember({ id: AUTHOR, permissions: [], highestPosition: 1, username: 'chatter' });
  guild.members.cache.set(AUTHOR, author);
  const deleted = [];
  const sent = [];
  const message = (content, overrides = {}) => {
    const m = {
      id: `m${deleted.length + sent.length + Math.random()}`,
      guild,
      system: false,
      content,
      author: { id: AUTHOR, bot: false, username: 'chatter' },
      member: author,
      deletable: true,
      delete: async () => { deleted.push(content); },
      channel: { id: '222222222222222222', send: async (p) => { sent.push(p); return { id: 'x' }; } },
      ...overrides,
    };
    return m;
  };
  const emit = async (m) => {
    client.emit('messageCreate', m);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { app, repos, services, guild, author, deleted, sent, message, emit };
}

test('automod deletes a message that contains a blocked word and never pings the author', async () => {
  const env = setup();
  env.repos.automod.update(G, { enabled: 1, word_filter: 1 });
  env.repos.automod.addWord(G, 'forbiddenword', OWNER);
  await env.emit(env.message('this has a forbiddenword in it'));
  assert.deepEqual(env.deleted, ['this has a forbiddenword in it']);
  for (const p of env.sent) assert.deepEqual(p.allowedMentions, { parse: [] });
  env.app.close();
});

test('a whitelisted security exemption is not actioned by automod', async () => {
  const env = setup();
  env.repos.automod.update(G, { enabled: 1, word_filter: 1 });
  env.repos.automod.addWord(G, 'forbiddenword', OWNER);
  env.repos.whitelist.add({ guildId: G, kind: 'security_exemption', targetType: 'user', targetId: AUTHOR, addedBy: OWNER });
  await env.emit(env.message('forbiddenword again'));
  assert.deepEqual(env.deleted, [], 'exempt members are not filtered');
  env.app.close();
});

test('bot-authored messages are ignored unless the bot is a trusted integration', async () => {
  const env = setup();
  env.repos.automod.update(G, { enabled: 1, word_filter: 1 });
  env.repos.automod.addWord(G, 'forbiddenword', OWNER);
  await env.emit(env.message('forbiddenword', { author: { id: AUTHOR, bot: true, username: 'bot' } }));
  assert.deepEqual(env.deleted, []);
  env.app.close();
});

test('leveling awards XP for ordinary messages once enabled', async () => {
  const env = setup();
  env.repos.levels.updateSettings(G, { enabled: 1 });
  await env.emit(env.message('hello there everyone'));
  const row = env.repos.levels.user(G, AUTHOR);
  assert.ok(row && row.xp >= 15, `expected XP to be awarded, got ${row && row.xp}`);
  env.app.close();
});

test('messages in direct messages are ignored entirely', async () => {
  const env = setup();
  env.repos.levels.updateSettings(G, { enabled: 1 });
  await env.emit(env.message('hello', { guild: null }));
  assert.equal(env.repos.levels.user(G, AUTHOR).xp, 0, 'no XP is granted outside a server');
  env.app.close();
});
