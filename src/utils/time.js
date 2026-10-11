'use strict';

const UNIT_SECONDS = Object.freeze({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 });
const MAX_SECONDS = 365 * 86400;

/**
 * Parse durations such as "90s", "15m", "2h", "1d", "1h30m".
 * Returns integer seconds, or null when invalid or outside [1s, 365d].
 */
function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const text = input.trim().toLowerCase();
  if (!text || text.length > 32) return null;
  const re = /(\d+)\s*([smhdw])/g;
  let total = 0;
  let consumed = '';
  let match;
  while ((match = re.exec(text)) !== null) {
    total += Number(match[1]) * UNIT_SECONDS[match[2]];
    consumed += match[0];
  }
  if (!consumed || consumed.replace(/\s+/g, '') !== text.replace(/\s+/g, '')) return null;
  if (!Number.isSafeInteger(total) || total < 1 || total > MAX_SECONDS) return null;
  return total;
}

/** Discord relative/absolute timestamp markup for a unix-seconds value. */
function discordTimestamp(unixSeconds, style = 'R') {
  return `<t:${Math.floor(unixSeconds)}:${style}>`;
}

function formatSeconds(total) {
  const s = Math.max(0, Math.floor(total));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (sec || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(' ');
}

module.exports = { parseDuration, discordTimestamp, formatSeconds, MAX_SECONDS };
