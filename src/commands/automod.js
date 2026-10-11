'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { UserError } = require('../utils/errors');
const { normaliseForWords } = require('../security/automod');
const ui = require('../utils/ui');
const { requireGuild } = require('./helpers');

const MAX_WORDS = 500;
const WORD_PATTERN = /^[\p{L}\p{N}_-]{2,64}$/u;

function formatSettings(s) {
  const onOff = (v) => (v ? 'on' : 'off');
  return [
    `Automod: **${onOff(s.enabled)}**`,
    `Word filter: ${onOff(s.word_filter)}`,
    `Block links: ${onOff(s.block_links)} · Block invites: ${onOff(s.block_invites)}`,
    `Anti-spam: ${onOff(s.anti_spam)} (${s.spam_max_messages} msgs / ${s.spam_window_seconds}s, timeout ${s.timeout_seconds}s)`,
  ].join('\n');
}

const manage = [PermissionFlagsBits.ManageGuild];

module.exports = defineModule({
  name: 'automod',
  description: 'Automatic moderation: word filter, links, invites, anti-spam',
  category: 'security',
  dmPermission: false,
  defaultMemberPermissions: manage,
  actions: {
    status: {
      description: 'Show automod settings',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        await ctx.respond({ embeds: [ui.info('Automod status', formatSettings(ctx.repos.automod.get(guild.id)))] });
      },
    },
    enable: {
      description: 'Turn automod on (word filter stays on)',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        ctx.repos.automod.update(guild.id, { enabled: 1 });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'automod.enabled' });
        await ctx.respond({ embeds: [ui.success('Automod enabled', formatSettings(ctx.repos.automod.get(guild.id)))] });
      },
    },
    disable: {
      description: 'Turn automod off',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        ctx.repos.automod.update(guild.id, { enabled: 0 });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'automod.disabled' });
        await ctx.respond({ embeds: [ui.success('Automod disabled', 'Messages are no longer filtered automatically.')] });
      },
    },
    addword: {
      description: 'Add a word to the blocked list',
      permissions: manage,
      options: [{ type: 'string', name: 'word', description: 'Word to block (2-64 characters)', required: true, minLength: 2, maxLength: 64 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const word = normaliseForWords(ctx.interaction.options.getString('word', true)).trim();
        if (!WORD_PATTERN.test(word)) throw new UserError('Words may contain letters, numbers, "_" and "-" (2-64 characters).', { code: 'WORD' });
        if (ctx.repos.automod.words(guild.id).length >= MAX_WORDS) throw new UserError(`The blocked-word list is full (${MAX_WORDS}).`, { code: 'LIMIT' });
        const added = ctx.repos.automod.addWord(guild.id, word, ctx.user.id);
        if (!added) throw new UserError('That word is already blocked.', { code: 'DUPLICATE' });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'automod.word.added' });
        await ctx.respond({ embeds: [ui.success('Word added', `Blocked words: ${ctx.repos.automod.words(guild.id).length}`)] });
      },
    },
    removeword: {
      description: 'Remove a word from the blocked list',
      permissions: manage,
      options: [{ type: 'string', name: 'word', description: 'Word to unblock', required: true, minLength: 2, maxLength: 64 }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const word = normaliseForWords(ctx.interaction.options.getString('word', true)).trim();
        if (!ctx.repos.automod.removeWord(guild.id, word)) throw new UserError('That word is not on the list.', { code: 'NOT_FOUND' });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'automod.word.removed' });
        await ctx.respond({ embeds: [ui.success('Word removed', 'The word is no longer blocked.')] });
      },
    },
    words: {
      description: 'List blocked words',
      permissions: manage,
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const words = ctx.repos.automod.words(guild.id);
        // Words are shown masked to avoid repeating slurs in chat.
        const masked = words.map((w) => `${w[0]}${'•'.repeat(Math.max(0, w.length - 2))}${w.length > 1 ? w[w.length - 1] : ''}`);
        await ctx.respond({ embeds: [ui.info('Blocked words', masked.length ? `${masked.length} word(s) (masked): ${masked.join(', ')}` : 'None configured.')] });
      },
    },
    links: {
      description: 'Configure link and invite blocking',
      permissions: manage,
      options: [
        { type: 'boolean', name: 'block_links', description: 'Block all links', required: true },
        { type: 'boolean', name: 'block_invites', description: 'Block Discord invite links', required: true },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const blockLinks = ctx.interaction.options.getBoolean('block_links', true) ? 1 : 0;
        const blockInvites = ctx.interaction.options.getBoolean('block_invites', true) ? 1 : 0;
        ctx.repos.automod.update(guild.id, { block_links: blockLinks, block_invites: blockInvites });
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'automod.links.configured', details: { blockLinks, blockInvites } });
        await ctx.respond({ embeds: [ui.success('Link rules updated', formatSettings(ctx.repos.automod.get(guild.id)))] });
      },
    },
    spam: {
      description: 'Configure anti-spam thresholds',
      permissions: manage,
      options: [
        { type: 'boolean', name: 'enabled', description: 'Enable anti-spam', required: true },
        { type: 'integer', name: 'max_messages', description: 'Messages allowed per window (2-50)', required: false, min: 2, max: 50 },
        { type: 'integer', name: 'window_seconds', description: 'Window length in seconds (2-120)', required: false, min: 2, max: 120 },
        { type: 'integer', name: 'timeout_seconds', description: 'Timeout for spammers (10-2419200)', required: false, min: 10, max: 2419200 },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const fields = { anti_spam: ctx.interaction.options.getBoolean('enabled', true) ? 1 : 0 };
        const max = ctx.interaction.options.getInteger('max_messages');
        const win = ctx.interaction.options.getInteger('window_seconds');
        const timeout = ctx.interaction.options.getInteger('timeout_seconds');
        if (max !== null) fields.spam_max_messages = max;
        if (win !== null) fields.spam_window_seconds = win;
        if (timeout !== null) fields.timeout_seconds = timeout;
        ctx.repos.automod.update(guild.id, fields);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'automod.spam.configured' });
        await ctx.respond({ embeds: [ui.success('Anti-spam updated', formatSettings(ctx.repos.automod.get(guild.id)))] });
      },
    },
  },
});
