'use strict';

/**
 * Neutralise Discord mention syntax and control characters in user-controlled text,
 * so the bot never pings @everyone/@here, roles, or users through its own output.
 */
function sanitizeText(input, { maxLength = 1000 } = {}) {
  let text = String(input ?? '');
  // Remove most control characters except newline and tab.
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  text = text.replace(/@(everyone|here)/gi, '@\u200b$1');
  text = text.replace(/<@[&!]?(\d+)>/g, '<@\u200b$1>');
  text = text.replace(/<#(\d+)>/g, '<#\u200b$1>');
  // Break every backtick in a run of three or more so no code fence can form (a single ZWSP is not enough).
  text = text.replace(/`{3,}/g, (m) => m.split('').join('\u200b'));
  if (text.length > maxLength) text = `${text.slice(0, Math.max(0, maxLength - 1))}…`;
  return text;
}

/** Strict allow-list for Discord display names used inside templates. */
function truncate(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

/** Allowed-mentions object: never ping anyone from bot output. */
const NO_MENTIONS = Object.freeze({ parse: [] });

module.exports = { sanitizeText, truncate, NO_MENTIONS };
