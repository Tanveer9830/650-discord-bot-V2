'use strict';

const { transaction } = require('../database/connection');

const XP_COOLDOWN_SECONDS = 60;
const XP_MIN = 15;
const XP_MAX = 25;

/**
 * Cumulative XP needed to reach level L is 50 * L * (L + 1).
 * levelFromXp returns the largest L with that threshold <= xp.
 */
function levelFromXp(xp) {
  let level = Math.max(0, Math.floor((-1 + Math.sqrt(1 + (4 * xp) / 50)) / 2));
  while (50 * (level + 1) * (level + 2) <= xp) level += 1;
  while (level > 0 && 50 * level * (level + 1) > xp) level -= 1;
  return level;
}

function xpForLevel(level) {
  return 50 * level * (level + 1);
}

/**
 * Award message XP once per cooldown window. Returns null when no XP was awarded
 * (disabled, cooling down), otherwise { gained, xp, oldLevel, newLevel, leveledUp }.
 */
function createLevelingService({ db, repos, clock, random = (min, max) => min + Math.floor(Math.random() * (max - min + 1)) }) {
  return {
    awardMessage(guildId, userId) {
      return transaction(db, () => {
        const settings = repos.levels.settings(guildId);
        if (!settings.enabled) return null;
        const user = repos.levels.user(guildId, userId);
        const now = clock.seconds();
        if (user.last_xp_at && now - user.last_xp_at < XP_COOLDOWN_SECONDS) return null;
        const gained = random(XP_MIN, XP_MAX);
        const xp = user.xp + gained;
        const newLevel = levelFromXp(xp);
        repos.levels.saveUser(guildId, userId, { xp, level: newLevel, lastXpAt: now });
        return { gained, xp, oldLevel: user.level, newLevel, leveledUp: newLevel > user.level, announceChannelId: settings.announce_channel_id };
      });
    },
    levelFromXp,
    xpForLevel,
  };
}

module.exports = { createLevelingService, levelFromXp, xpForLevel, XP_COOLDOWN_SECONDS };
