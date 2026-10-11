'use strict';

const { randomInt } = require('node:crypto');
const { pickWinners } = require('./giveaways');
const { giveawayEmbed } = require('./giveawayView');
const { NO_MENTIONS } = require('../utils/text');

/**
 * Background work that must survive restarts because it is driven by database state:
 *   - giveaways whose end time has passed (pick winners, refresh the message)
 *   - reminders that are due (post in their channel, mark sent or failed)
 *   - expired pending confirmations (purged)
 * Runs on a fixed interval. A re-entrancy guard prevents overlapping ticks.
 */
function createScheduler({ repos, clock, logger, client, intervalMs = 15000 }) {
  let timer = null;
  let running = false;

  async function refreshGiveawayMessage(g, winners) {
    const discord = client();
    if (!g.message_id || !discord) return;
    try {
      const channel = await discord.channels.fetch(g.channel_id);
      const message = await channel.messages.fetch(g.message_id);
      await message.edit({ embeds: [giveawayEmbed(g, repos.giveaways.entries(g.id).length, winners)], components: [] });
    } catch (error) {
      logger.warn('Could not refresh giveaway message', { giveawayId: g.id, reason: error.message });
    }
  }

  async function endDueGiveaways() {
    let ended = 0;
    for (const g of repos.giveaways.dueBefore(clock.seconds())) {
      const entries = repos.giveaways.entries(g.id);
      const winners = pickWinners(entries, g.winner_count, (max) => randomInt(max));
      repos.giveaways.finish(g.id, winners);
      await refreshGiveawayMessage(g, winners);
      ended += 1;
    }
    return ended;
  }

  async function sendDueReminders() {
    const discord = client();
    let sent = 0;
    for (const r of repos.reminders.dueBefore(clock.seconds())) {
      try {
        if (!discord) throw new Error('Discord client is not connected');
        const channel = await discord.channels.fetch(r.channel_id);
        await channel.send({ content: `⏰ **Reminder:** ${r.message}`, allowedMentions: NO_MENTIONS });
        repos.reminders.setStatus(r.id, 'sent');
        sent += 1;
      } catch (error) {
        repos.reminders.setStatus(r.id, 'failed');
        logger.warn('Reminder could not be delivered', { reminderId: r.id, reason: error.message });
      }
    }
    return sent;
  }

  /** One pass over all duties. Returns counts (used by tests and by the doctor). */
  async function tick() {
    if (running) return { skipped: true };
    running = true;
    try {
      const giveawaysEnded = await endDueGiveaways();
      const remindersSent = await sendDueReminders();
      repos.confirmations.purgeExpired(clock.seconds());
      return { skipped: false, giveawaysEnded, remindersSent };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      timer = setInterval(() => {
        tick().catch((error) => logger.error('Scheduler tick failed', { reason: error.message }));
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createScheduler };
