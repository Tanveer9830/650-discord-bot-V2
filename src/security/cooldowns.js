'use strict';

/** In-memory fixed cooldown buckets keyed by "action:user" (or any scope string). */
function createCooldowns(clock = () => Date.now()) {
  const buckets = new Map();
  return {
    /** Returns 0 if allowed (and records the use), otherwise the remaining milliseconds. */
    take(key, ms) {
      if (!ms || ms <= 0) return 0;
      const now = clock();
      const until = buckets.get(key);
      if (until && until > now) return until - now;
      buckets.set(key, now + ms);
      if (buckets.size > 10000) {
        for (const [k, v] of buckets) if (v <= now) buckets.delete(k);
      }
      return 0;
    },
    peek(key) {
      const until = buckets.get(key);
      return until && until > clock() ? until - clock() : 0;
    },
    size: () => buckets.size,
  };
}

module.exports = { createCooldowns };
