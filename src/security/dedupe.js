'use strict';

/**
 * Duplicate-interaction protection. Discord can redeliver an interaction (retries, reconnects);
 * a seen interaction ID within the TTL is rejected so side effects happen at most once.
 */
function createDeduper({ ttlMs = 60000, clock = () => Date.now(), maxEntries = 5000 } = {}) {
  const seen = new Map();
  return {
    /** Returns true if this ID was already seen (and should be ignored). */
    check(id) {
      const now = clock();
      for (const [k, t] of seen) {
        if (t <= now) seen.delete(k);
        else break;
      }
      if (seen.has(id)) return true;
      if (seen.size >= maxEntries) {
        const oldest = seen.keys().next().value;
        seen.delete(oldest);
      }
      seen.set(id, now + ttlMs);
      return false;
    },
    size: () => seen.size,
  };
}

module.exports = { createDeduper };
