'use strict';

/** Parse "#RRGGBB" / "RRGGBB" into an integer, or null for empty input. Throws on invalid input. */
function parseHexColor(input) {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(input).trim());
  if (!m) {
    const { UserError } = require('./errors');
    throw new UserError('Colour must be a 6-digit hex value such as #3B82F6.', { code: 'COLOR' });
  }
  return parseInt(m[1], 16);
}

module.exports = { parseHexColor };
