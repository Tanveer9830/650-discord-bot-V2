'use strict';

const { PermissionFlagsBits } = require('discord.js');
const { defineModule } = require('./framework');
const { UserError } = require('../utils/errors');
const { discordTimestamp } = require('../utils/time');
const { sanitizeText } = require('../utils/text');
const ui = require('../utils/ui');
const { requireGuild, fetchMember, botMember } = require('./helpers');
const { assertOk, canManageRole } = require('../security/permissions');

const manage = [PermissionFlagsBits.ManageGuild];

function money(settings, amount) {
  return `${Number(amount).toLocaleString('en-US')} ${sanitizeText(settings.currency_name, { maxLength: 24 })}`;
}

function cooldownReply(retryAt) {
  return new UserError(`You are on cooldown. Try again ${discordTimestamp(retryAt, 'R')}.`, { code: 'COOLDOWN' });
}

module.exports = defineModule({
  name: 'economy',
  description: 'Virtual currency (in-game only, no real-money value)',
  category: 'economy',
  dmPermission: false,
  actions: {
    balance: {
      description: 'Check a balance (yours by default)',
      options: [{ type: 'user', name: 'user', description: 'Whose balance to check', required: false }],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user') || ctx.user;
        const settings = ctx.repos.economy.settings(guild.id);
        const balance = ctx.services.economy.balanceOf(guild.id, user.id);
        await ctx.respond({ embeds: [ui.info('Balance', `${sanitizeText(user.username, { maxLength: 64 })}: **${money(settings, balance)}**`)] });
      },
    },
    daily: {
      description: 'Claim your daily reward',
      options: [],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const result = ctx.services.economy.daily(guild.id, ctx.user.id);
        if (!result.ok) throw cooldownReply(result.retryAt);
        await ctx.respond({ embeds: [ui.success('Daily reward claimed', `+${money({ currency_name: result.currency }, result.amount)}. Balance: ${money({ currency_name: result.currency }, result.balance)}`)] });
      },
    },
    work: {
      description: 'Work for a random reward (cooldown applies)',
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const result = ctx.services.economy.work(guild.id, ctx.user.id);
        if (!result.ok) throw cooldownReply(result.retryAt);
        await ctx.respond({ embeds: [ui.success('Shift complete', `You earned ${money({ currency_name: result.currency }, result.amount)}. Balance: ${money({ currency_name: result.currency }, result.balance)}`)] });
      },
    },
    pay: {
      description: 'Send some of your balance to another member',
      options: [
        { type: 'user', name: 'user', description: 'Recipient', required: true },
        { type: 'integer', name: 'amount', description: 'Amount to send', required: true, min: 1, max: 1000000000 },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const user = ctx.interaction.options.getUser('user', true);
        if (user.bot) throw new UserError('Bots cannot receive payments.', { code: 'BOT_TARGET' });
        const amount = ctx.interaction.options.getInteger('amount', true);
        const result = ctx.services.economy.pay({ guildId: guild.id, fromId: ctx.user.id, toId: user.id, amount });
        const settings = ctx.repos.economy.settings(guild.id);
        await ctx.respond({ embeds: [ui.success('Payment sent', `Sent ${money(settings, amount)}. Your balance: ${money(settings, result.senderBalance)}.`)] });
      },
    },
    leaderboard: {
      description: 'Top balances in this server',
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const settings = ctx.repos.economy.settings(guild.id);
        const rows = ctx.repos.economy.leaderboard(guild.id, 10);
        const body = rows.length ? rows.map((r, i) => `**${i + 1}.** <@${r.user_id}> — ${money(settings, r.balance)}`).join('\n') : 'No balances yet.';
        await ctx.respond({ embeds: [ui.info('Economy leaderboard', body)], ephemeral: false, allowedMentions: { parse: [] } });
      },
    },
    history: {
      description: 'Your 10 most recent transactions',
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const settings = ctx.repos.economy.settings(guild.id);
        const rows = ctx.repos.economy.history(guild.id, ctx.user.id, 10);
        const body = rows.length ? rows.map((r) => `${r.delta > 0 ? '+' : ''}${r.delta} — ${sanitizeText(r.reason, { maxLength: 40 })} (bal ${r.balance_after})`).join('\n') : 'No transactions yet.';
        await ctx.respond({ embeds: [ui.info(`History (${settings.currency_name})`, body)] });
      },
    },
    setup: {
      description: 'Configure currency name, daily reward, and work range',
      permissions: manage,
      options: [
        { type: 'string', name: 'currency_name', description: 'Currency name (1-24 characters)', required: false, minLength: 1, maxLength: 24 },
        { type: 'integer', name: 'daily_amount', description: 'Daily reward amount', required: false, min: 1, max: 1000000 },
        { type: 'integer', name: 'work_min', description: 'Minimum work reward', required: false, min: 1, max: 100000 },
        { type: 'integer', name: 'work_max', description: 'Maximum work reward', required: false, min: 1, max: 100000 },
      ],
      run: async (ctx) => {
        const guild = requireGuild(ctx);
        const fields = {};
        const o = ctx.interaction.options;
        if (o.getString('currency_name')) fields.currency_name = sanitizeText(o.getString('currency_name'), { maxLength: 24 }).trim();
        if (o.getInteger('daily_amount') !== null) fields.daily_amount = o.getInteger('daily_amount');
        if (o.getInteger('work_min') !== null) fields.work_min = o.getInteger('work_min');
        if (o.getInteger('work_max') !== null) fields.work_max = o.getInteger('work_max');
        const current = ctx.repos.economy.settings(guild.id);
        const min = fields.work_min ?? current.work_min;
        const max = fields.work_max ?? current.work_max;
        if (min > max) throw new UserError('work_min cannot be greater than work_max.', { code: 'RANGE' });
        const saved = ctx.repos.economy.updateSettings(guild.id, fields);
        ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'economy.configured', details: fields });
        await ctx.respond({ embeds: [ui.success('Economy configured', `Currency: ${saved.currency_name}\nDaily: ${saved.daily_amount}\nWork: ${saved.work_min}–${saved.work_max}`)] });
      },
    },
  },
  groups: {
    shop: {
      description: 'Server shop: items you can buy with currency',
      actions: {
        add: {
          description: 'Add an item to the shop',
          permissions: manage,
          botPermissions: [PermissionFlagsBits.ManageRoles],
          options: [
            { type: 'string', name: 'name', description: 'Item name (1-40 characters)', required: true, minLength: 1, maxLength: 40 },
            { type: 'integer', name: 'price', description: 'Price in currency', required: true, min: 1, max: 1000000000 },
            { type: 'integer', name: 'stock', description: 'Limited stock (omit for unlimited)', required: false, min: 0, max: 100000 },
            { type: 'role', name: 'role', description: 'Role granted on purchase (optional)', required: false },
          ],
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const o = ctx.interaction.options;
            const role = o.getRole('role');
            if (role) {
              const bot = await botMember(guild);
              const actor = ctx.member || (await fetchMember(guild, ctx.user.id));
              assertOk(canManageRole({ actor, role, bot, guildOwnerId: guild.ownerId }));
            }
            const id = ctx.services.economy.createItem({
              guildId: guild.id,
              name: o.getString('name', true).trim(),
              price: o.getInteger('price', true),
              stock: o.getInteger('stock'),
              roleId: role ? role.id : null,
              createdBy: ctx.user.id,
            });
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'economy.shop.added', details: { itemId: id } });
            await ctx.respond({ embeds: [ui.success('Item added', `Item #${id} is now in the shop.`)] });
          },
        },
        list: {
          description: 'List items in the shop',
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const settings = ctx.repos.economy.settings(guild.id);
            const items = ctx.repos.economy.listItems(guild.id);
            const body = items.length
              ? items.map((i) => `**${sanitizeText(i.name, { maxLength: 40 })}** — ${money(settings, i.price)}${i.stock === null ? '' : ` · stock ${i.stock}`}${i.role_id ? ' · grants role' : ''}`).join('\n')
              : 'The shop is empty.';
            await ctx.respond({ embeds: [ui.info('Shop', body)] });
          },
        },
        buy: {
          description: 'Buy an item from the shop',
          options: [{ type: 'string', name: 'item', description: 'Item name', required: true, maxLength: 40, autocomplete: true }],
          autocomplete: {
            item: ({ value, repos, interaction }) => {
              if (!interaction.guildId) return [];
              const needle = String(value || '').toLowerCase();
              return repos.economy.listItems(interaction.guildId)
                .filter((i) => i.name.toLowerCase().includes(needle))
                .slice(0, 25)
                .map((i) => ({ name: sanitizeText(i.name, { maxLength: 100 }), value: i.name }));
            },
          },
          run: async (ctx) => {
            const guild = requireGuild(ctx);
            const name = ctx.interaction.options.getString('item', true).trim();
            // Check that the bot can grant the item's role BEFORE any currency moves.
            const listed = ctx.repos.economy.findItem(guild.id, name);
            if (listed && listed.role_id) {
              const role = guild.roles.cache.get(listed.role_id);
              const bot = await botMember(guild);
              if (!role || bot.roles.highest.position <= role.position) {
                throw new UserError('This item grants a role I cannot assign right now. Ask an admin to fix the role order.', { code: 'ROLE_HIERARCHY' });
              }
            }
            const { item, balance } = ctx.services.economy.buyItem({ guildId: guild.id, userId: ctx.user.id, itemName: name });
            if (item.role_id) {
              const member = await fetchMember(guild, ctx.user.id);
              const role = guild.roles.cache.get(item.role_id);
              if (member && role) await member.roles.add(role, 'Shop purchase');
            }
            ctx.services.audit({ guildId: guild.id, actorId: ctx.user.id, action: 'economy.shop.bought', details: { itemId: item.id } });
            await ctx.respond({ embeds: [ui.success('Purchased', `You bought **${sanitizeText(item.name, { maxLength: 40 })}**. Balance: ${money(ctx.repos.economy.settings(guild.id), balance)}`)] });
          },
        },
      },
    },
  },
});
