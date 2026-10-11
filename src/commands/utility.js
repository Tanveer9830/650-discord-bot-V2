'use strict';

const { defineModule } = require('./framework');
const { evaluate } = require('../services/calc');
const { parseDuration, discordTimestamp, formatSeconds } = require('../utils/time');
const { fetchMember } = require('./helpers');
const ui = require('../utils/ui');
const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');

const MAX_B64_INPUT = 1500;

module.exports = defineModule({
  name: 'utility',
  description: 'Everyday tools: latency, avatars, server and user info, math, time',
  category: 'utility',
  dmPermission: true,
  actions: {
    ping: {
      description: 'Check the bot\u2019s gateway latency',
      guildOnly: false,
      cooldownMs: 2000,
      run: async (ctx) => {
        const ws = ctx.client ? ctx.client.ws.ping : -1;
        await ctx.respond({ embeds: [ui.info('Pong', `Gateway latency: ${ws >= 0 ? `${ws} ms` : 'unavailable'}`)] });
      },
    },
    avatar: {
      description: 'Show a user\u2019s avatar (no ping)',
      guildOnly: false,
      options: [{ type: 'user', name: 'user', description: 'The user whose avatar to show', required: false }],
      run: async (ctx) => {
        const user = ctx.interaction.options.getUser('user') || ctx.user;
        const url = user.displayAvatarURL({ size: 512 });
        await ctx.respond({ embeds: [ui.info(`Avatar of ${sanitizeText(user.username, { maxLength: 64 })}`, undefined).setImage(url)], ephemeral: false });
      },
    },
    serverinfo: {
      description: 'Show details about this server',
      cooldownMs: 5000,
      run: async (ctx) => {
        const g = ctx.guild;
        if (!g) throw new UserError('Use this command inside a server.', { code: 'GUILD_ONLY' });
        const owner = await g.fetchOwner().catch(() => null);
        const embed = ui.info(sanitizeText(g.name, { maxLength: 100 }), undefined).addFields(
          { name: 'Server ID', value: g.id, inline: true },
          { name: 'Members', value: String(g.memberCount ?? 'unknown'), inline: true },
          { name: 'Channels', value: String(g.channels.cache.size), inline: true },
          { name: 'Roles', value: String(g.roles.cache.size), inline: true },
          { name: 'Owner ID', value: owner ? owner.id : 'unknown', inline: true },
          { name: 'Created', value: discordTimestamp(Math.floor(g.createdTimestamp / 1000), 'D'), inline: true },
        );
        await ctx.respond({ embeds: [embed], ephemeral: false });
      },
    },
    userinfo: {
      description: 'Show details about a user',
      guildOnly: false,
      options: [{ type: 'user', name: 'user', description: 'The user to inspect', required: false }],
      run: async (ctx) => {
        const user = ctx.interaction.options.getUser('user') || ctx.user;
        const member = ctx.guild ? await fetchMember(ctx.guild, user.id) : null;
        const fields = [
          { name: 'User ID', value: user.id, inline: true },
          { name: 'Account created', value: discordTimestamp(Math.floor(user.createdTimestamp / 1000), 'D'), inline: true },
          { name: 'Bot account', value: user.bot ? 'Yes' : 'No', inline: true },
        ];
        if (member && member.joinedTimestamp) {
          fields.push({ name: 'Joined server', value: discordTimestamp(Math.floor(member.joinedTimestamp / 1000), 'D'), inline: true });
          fields.push({ name: 'Highest role', value: sanitizeText(member.roles.highest.name, { maxLength: 100 }), inline: true });
        }
        await ctx.respond({ embeds: [ui.info(`User: ${sanitizeText(user.username, { maxLength: 64 })}`, undefined).addFields(fields)], ephemeral: false });
      },
    },
    calc: {
      description: 'Evaluate a safe arithmetic expression',
      guildOnly: false,
      options: [{ type: 'string', name: 'expression', description: 'For example: (12 + 8) * 3 ^ 2', required: true, maxLength: 120 }],
      run: async (ctx) => {
        const expression = ctx.interaction.options.getString('expression', true);
        const result = evaluate(expression);
        await ctx.respond({ embeds: [ui.info('Calculator', `\`${sanitizeText(expression, { maxLength: 120 }).replace(/`/g, '')}\` = **${result}**`)] });
      },
    },
    timestamp: {
      description: 'Create a Discord timestamp for a time from now',
      guildOnly: false,
      options: [
        { type: 'string', name: 'in', description: 'Offset such as 30m, 2h, 1d', required: true, maxLength: 32 },
        { type: 'string', name: 'style', description: 'Discord timestamp style', required: false, choices: [
          { name: 'Relative (in 2 hours)', value: 'R' },
          { name: 'Short date/time', value: 'f' },
          { name: 'Long date/time', value: 'F' },
        ] },
      ],
      run: async (ctx) => {
        const seconds = parseDuration(ctx.interaction.options.getString('in', true));
        if (!seconds) throw new UserError('Use a duration such as 30m, 2h, or 1d (up to 365d).', { code: 'DURATION' });
        const style = ctx.interaction.options.getString('style') || 'R';
        const at = Math.floor(Date.now() / 1000) + seconds;
        const markup = discordTimestamp(at, style);
        await ctx.respond({ embeds: [ui.info('Timestamp', `In ${formatSeconds(seconds)}: ${markup}\nMarkup: \`${markup}\``)] });
      },
    },
    base64: {
      description: 'Encode or decode Base64 text',
      guildOnly: false,
      options: [
        { type: 'string', name: 'mode', description: 'Encode or decode', required: true, choices: [{ name: 'Encode', value: 'encode' }, { name: 'Decode', value: 'decode' }] },
        { type: 'string', name: 'text', description: 'Text to convert', required: true, maxLength: MAX_B64_INPUT },
      ],
      run: async (ctx) => {
        const mode = ctx.interaction.options.getString('mode', true);
        const text = ctx.interaction.options.getString('text', true);
        let output;
        if (mode === 'encode') {
          output = Buffer.from(text, 'utf8').toString('base64');
        } else {
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text) || text.length % 4 !== 0) {
            throw new UserError('That is not valid Base64.', { code: 'BASE64' });
          }
          output = Buffer.from(text, 'base64').toString('utf8');
        }
        if (output.length > 1800) throw new UserError('The result is too long to display.', { code: 'TOO_LONG' });
        const safeOutput = sanitizeText(output, { maxLength: 1800 }).split('```').join('`\u200b`\u200b`');
        await ctx.respond({ embeds: [ui.info(`Base64 ${mode}`, '```\n' + safeOutput + '\n```')] });
      },
    },
  },
});
