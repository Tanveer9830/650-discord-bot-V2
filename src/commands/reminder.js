'use strict';

const { defineModule } = require('./framework');
const { parseDuration, discordTimestamp, MAX_SECONDS } = require('../utils/time');
const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');

const MAX_PENDING_PER_USER = 25;

module.exports = defineModule({
  name: 'reminder',
  description: 'Personal reminders delivered by the bot',
  category: 'utility',
  dmPermission: true,
  actions: {
    set: {
      description: 'Remind you after a duration (here or by DM)',
      guildOnly: false,
      options: [
        { type: 'string', name: 'in', description: 'When, e.g. 15m, 2h, 3d', required: true, maxLength: 32 },
        { type: 'string', name: 'message', description: 'What to remind you about', required: true, minLength: 1, maxLength: 500 },
        { type: 'boolean', name: 'dm', description: 'Send by DM instead of this channel', required: false },
      ],
      run: async (ctx) => {
        const seconds = parseDuration(ctx.interaction.options.getString('in', true));
        if (!seconds || seconds > MAX_SECONDS) throw new UserError('Use a duration such as 15m, 2h, or 3d (up to 365d).', { code: 'DURATION' });
        const message = sanitizeText(ctx.interaction.options.getString('message', true), { maxLength: 500 });
        const wantDm = ctx.interaction.options.getBoolean('dm') === true;
        const useChannel = !wantDm && ctx.guild && ctx.interaction.channelId;
        if (ctx.repos.reminders.listForUser(ctx.user.id, MAX_PENDING_PER_USER + 1).length >= MAX_PENDING_PER_USER) {
          throw new UserError(`You can have at most ${MAX_PENDING_PER_USER} pending reminders.`, { code: 'LIMIT' });
        }
        const dueAt = Math.floor(Date.now() / 1000) + seconds;
        const id = ctx.repos.reminders.insert({
          guildId: useChannel ? ctx.guild.id : null,
          channelId: useChannel ? ctx.interaction.channelId : null,
          userId: ctx.user.id,
          message,
          dueAt,
        });
        await ctx.respond({ embeds: [ui.success('Reminder set', `#${id} will fire ${discordTimestamp(dueAt, 'R')} ${useChannel ? 'in this channel' : 'by DM'}.`)] });
      },
    },
    list: {
      description: 'List your pending reminders',
      guildOnly: false,
      run: async (ctx) => {
        const rows = ctx.repos.reminders.listForUser(ctx.user.id, 25);
        const body = rows.length
          ? rows.map((r) => `**#${r.id}** ${discordTimestamp(r.due_at, 'R')} — ${sanitizeText(r.message, { maxLength: 80 })}`).join('\n')
          : 'You have no pending reminders.';
        await ctx.respond({ embeds: [ui.info('Your reminders', body)] });
      },
    },
    cancel: {
      description: 'Cancel one of your pending reminders',
      guildOnly: false,
      options: [{ type: 'integer', name: 'id', description: 'Reminder ID from /reminder list', required: true, min: 1 }],
      run: async (ctx) => {
        const id = ctx.interaction.options.getInteger('id', true);
        if (!ctx.repos.reminders.cancel(ctx.user.id, id)) throw new UserError('No pending reminder with that ID belongs to you.', { code: 'NOT_FOUND' });
        await ctx.respond({ embeds: [ui.success('Reminder cancelled', `#${id} will not be sent.`)] });
      },
    },
  },
});
