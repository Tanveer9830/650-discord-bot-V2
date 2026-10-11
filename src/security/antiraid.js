'use strict';

/**
 * Join-burst detector. Records member joins per guild in a sliding window and reports
 * a raid once the threshold is exceeded. Alerts are rate-limited to one per window.
 */
function createJoinMonitor() {
  const joins = new Map();
  const lastAlert = new Map();
  return {
    record({ guildId, nowMs, threshold, windowMs }) {
      const list = (joins.get(guildId) || []).filter((t) => nowMs - t < windowMs);
      list.push(nowMs);
      joins.set(guildId, list);
      const count = list.length;
      const alerted = lastAlert.has(guildId);
      if (count >= threshold && (!alerted || nowMs - lastAlert.get(guildId) >= windowMs)) {
        lastAlert.set(guildId, nowMs);
        return { raid: true, count };
      }
      return { raid: false, count };
    },
  };
}

module.exports = { createJoinMonitor };
