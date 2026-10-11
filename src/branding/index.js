'use strict';

/**
 * Official branding for the bot. Every surface (installer, startup, diagnostics,
 * /about, README generator, dashboard) should take its strings from here so the
 * creator attribution stays consistent and spelled correctly.
 */

const BRAND = Object.freeze({
  creatorName: 'Tanveer',
  discordUsername: 'tanveer5637',
  signature: 'MADE BY TANVEER',
  attribution: 'Made by Tanveer | Discord: tanveer5637',
  aboutLines: Object.freeze(['Made by Tanveer', 'Discord: tanveer5637']),
  product: 'TANVEER DISCORD BOT',
});

// ANSI Shadow style block lettering. Every glyph is stored as equal-height rows;
// the renderer pads each glyph to its widest row so the lettering stays aligned.
const GLYPHS = Object.freeze({
  T: ['████████╗', '╚══██╔══╝', '   ██║   ', '   ██║   ', '   ██║   ', '   ╚═╝   '],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
  V: ['██╗   ██╗', '██║   ██║', '██║   ██║', '╚██╗ ██╔╝', ' ╚████╔╝ ', '  ╚═══╝  '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
});

const BANNER_WORD = 'TANVEER';
const INNER_PADDING = 2;

// Minimum terminal width needed to render the full banner without wrapping.
const FULL_BANNER_MIN_WIDTH = 66;
const COMPACT_MIN_WIDTH = 40;

const ANSI = Object.freeze({
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  // 256-colour "electric blue" and "purple" degrade gracefully on 8-colour terminals.
  electricBlue: '\x1b[38;5;33m',
  purple: '\x1b[38;5;135m',
  white: '\x1b[97m',
  green: '\x1b[92m',
  red: '\x1b[91m',
  yellow: '\x1b[93m',
});

/** Decide colour and width from a stream-like object and env (both injectable for tests). */
function detectTerminal({ env = process.env, stream = process.stdout } = {}) {
  const forced = env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0';
  const disabled = env.NO_COLOR !== undefined || env.TERM === 'dumb' || env.TANVEER_PLAIN === '1';
  const isTty = Boolean(stream && stream.isTTY);
  const color = !disabled && (forced || isTty);
  const width = Number.isInteger(stream && stream.columns) && stream.columns > 0 ? stream.columns : 80;
  return { color, width };
}

function paint(text, style, color) {
  if (!color || !style) return text;
  return `${style}${text}${ANSI.reset}`;
}

/** Build the lettering rows (no box). Returns an array of plain strings. */
function buildLetteringRows(word = BANNER_WORD) {
  const glyphs = [...word].map((ch) => {
    const rows = GLYPHS[ch];
    if (!rows) throw new Error(`No glyph defined for "${ch}"`);
    return rows;
  });
  const height = glyphs[0].length;
  const rows = [];
  for (let r = 0; r < height; r += 1) {
    const parts = glyphs.map((g) => g[r]);
    const widths = glyphs.map((g) => Math.max(...g.map((line) => [...line].length)));
    rows.push(parts.map((part, i) => part.padEnd(widths[i], ' ')).join(' '));
  }
  return rows;
}

function displayWidth(text) {
  // All characters used by the banner are single-column (block elements and box drawing).
  return [...text].length;
}

function boxLine(content, innerWidth, style, color, edge = '║') {
  const pad = innerWidth - displayWidth(content);
  const left = Math.floor(pad / 2);
  const right = pad - left;
  const body = `${' '.repeat(left)}${content}${' '.repeat(right)}`;
  return `${paint(edge, style, color)}${paint(body, style, color)}${paint(edge, style, color)}`;
}

/**
 * Full banner: used by install.sh and bot startup only.
 * Falls back to the compact banner when the terminal is too narrow.
 */
function renderFullBanner({ color = false, width = 80, version = '' } = {}) {
  if (width < FULL_BANNER_MIN_WIDTH) {
    return renderCompactBanner({ color, width, version });
  }
  const letters = buildLetteringRows();
  const lettersWidth = Math.max(...letters.map(displayWidth));
  const inner = lettersWidth + INNER_PADDING * 2;
  const horizontal = '═'.repeat(inner);
  const lines = [];
  const top = (s) => paint(s, ANSI.cyan, color);
  const blank = () => boxLine('', inner, ANSI.cyan, color);

  lines.push(top(`╔${horizontal}╗`));
  lines.push(blank());
  for (const row of letters) {
    lines.push(boxLine(row, inner, ANSI.electricBlue, color));
  }
  lines.push(blank());
  lines.push(boxLine(BRAND.signature.split('').join(' '), inner, ANSI.white, color));
  lines.push(blank());
  lines.push(boxLine(`Discord: ${BRAND.discordUsername}`, inner, ANSI.purple, color));
  lines.push(blank());
  lines.push(boxLine('[ DISCORD BOT ] [ SECURE ] [ AUTOMATED ]', inner, ANSI.cyan, color));
  if (version) {
    lines.push(boxLine(`v${version}`, inner, ANSI.white, color));
  }
  lines.push(blank());
  lines.push(top(`╚${horizontal}╝`));
  return lines.join('\n');
}

/** Compact banner: status and diagnostic output. */
function renderCompactBanner({ color = false, width = 80, version = '' } = {}) {
  if (width < COMPACT_MIN_WIDTH) {
    return renderSignature({ color });
  }
  const title = version ? `${BRAND.product} v${version}` : BRAND.product;
  const inner = Math.max(displayWidth(title), displayWidth(BRAND.attribution)) + 4;
  const horizontal = '─'.repeat(inner);
  return [
    paint(`┌${horizontal}┐`, ANSI.cyan, color),
    boxLine(title, inner, ANSI.electricBlue, color, '│'),
    boxLine(BRAND.attribution, inner, ANSI.purple, color, '│'),
    paint(`└${horizontal}┘`, ANSI.cyan, color),
  ].join('\n');
}

/** Minimal signature: one line. Always plain-text safe. */
function renderSignature({ color = false } = {}) {
  return paint(BRAND.attribution, ANSI.purple, color);
}

/** Success message for a genuinely completed operation (never call this speculatively). */
function renderSuccess(message, { color = false } = {}) {
  return `${paint('✔', ANSI.green, color)} ${message}`;
}

module.exports = {
  BRAND,
  GLYPHS,
  ANSI,
  FULL_BANNER_MIN_WIDTH,
  COMPACT_MIN_WIDTH,
  detectTerminal,
  buildLetteringRows,
  renderFullBanner,
  renderCompactBanner,
  renderSignature,
  renderSuccess,
  displayWidth,
};
