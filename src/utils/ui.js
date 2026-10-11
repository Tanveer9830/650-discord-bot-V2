'use strict';

const { EmbedBuilder } = require('discord.js');
const { BRAND } = require('../branding');
const { sanitizeText, truncate } = require('./text');

const COLORS = Object.freeze({
  primary: 0x00d4ff, // cyan
  accent: 0x3b82f6, // electric blue
  brand: 0x8b5cf6, // purple
  success: 0x22c55e, // verified green
  warn: 0xf59e0b,
  error: 0xef4444,
});

function base(color) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: BRAND.attribution })
    .setTimestamp();
}

/**
 * Build an embed. Titles are sanitised. Descriptions are passed through with length limits only:
 * callers sanitise any user-controlled text they insert, and every response is sent with
 * allowedMentions: { parse: [] }, so no bot message can ping anyone.
 */
function info(title, description, color = COLORS.primary) {
  const e = base(color).setTitle(truncate(sanitizeText(title, { maxLength: 256 }), 256));
  if (description) e.setDescription(truncate(String(description), 4000));
  return e;
}

function success(title, description) {
  return info(title, description, COLORS.success);
}

function error(description) {
  return info('Action not completed', description, COLORS.error);
}

function warn(title, description) {
  return info(title, description, COLORS.warn);
}

/** Field values are sanitised so user-controlled text can never ping anyone. */
function field(name, value, inline = true) {
  return { name: truncate(sanitizeText(name, { maxLength: 256 }), 256), value: truncate(sanitizeText(value ?? '—', { maxLength: 1024 }), 1024) || '—', inline };
}

module.exports = { COLORS, info, success, error, warn, field, base };
