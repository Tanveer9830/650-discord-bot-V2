'use strict';

/**
 * Pick unique winners uniformly at random using a cryptographically secure source.
 * Pure given the injected randomInt(max) function, so it is testable and deterministic under a seeded RNG.
 */
function pickWinners(entries, count, randomInt) {
  const pool = [...new Set(entries)];
  const winners = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i += 1) {
    const idx = randomInt(pool.length - i);
    winners.push(pool[idx]);
    pool[idx] = pool[pool.length - 1 - i];
  }
  return winners;
}

module.exports = { pickWinners };
