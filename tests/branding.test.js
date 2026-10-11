'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  BRAND, GLYPHS, renderFullBanner, renderCompactBanner, renderSignature, renderSuccess,
  detectTerminal, buildLetteringRows, displayWidth, FULL_BANNER_MIN_WIDTH,
} = require('../src/branding');

const ANSI_PATTERN = /\x1b\[[0-9;]*m/;

test('brand strings are exact and never misspell the creator', () => {
  assert.equal(BRAND.creatorName, 'Tanveer');
  assert.equal(BRAND.attribution, 'Made by Tanveer | Discord: tanveer5637');
  assert.equal(BRAND.signature, 'MADE BY TANVEER');
  assert.deepEqual([...BRAND.aboutLines], ['Made by Tanveer', 'Discord: tanveer5637']);
  for (const text of [renderSignature(), renderFullBanner({ width: 100 }), renderCompactBanner({ width: 80 })]) {
    assert.doesNotMatch(text, /tanvir/i);
  }
});

test('every glyph has the same row count and the lettering spells TANVEER', () => {
  const heights = new Set(Object.values(GLYPHS).map((g) => g.length));
  assert.equal(heights.size, 1, 'all glyphs must be the same height');
  const rows = buildLetteringRows('TANVEER');
  assert.equal(rows.length, 6);
  const widths = new Set(rows.map(displayWidth));
  assert.equal(widths.size, 1, 'lettering rows must be aligned to one width');
});

test('full banner has aligned box edges and contains the signature', () => {
  const banner = renderFullBanner({ width: 100, version: '1.2.3' });
  const lines = banner.split('\n');
  const widths = new Set(lines.map(displayWidth));
  assert.equal(widths.size, 1, `all banner lines must have equal width, got ${[...widths]}`);
  assert.ok(banner.includes('M A D E   B Y   T A N V E E R'));
  assert.ok(banner.includes('Discord: tanveer5637'));
  assert.ok(banner.includes('v1.2.3'));
});

test('plain output has no ANSI escape codes; colour output does', () => {
  assert.doesNotMatch(renderFullBanner({ width: 100, color: false }), ANSI_PATTERN);
  assert.doesNotMatch(renderCompactBanner({ color: false }), ANSI_PATTERN);
  assert.match(renderFullBanner({ width: 100, color: true }), ANSI_PATTERN);
  assert.doesNotMatch(renderSuccess('Installed', { color: false }), ANSI_PATTERN);
});

test('narrow terminals fall back to the compact banner, then to the signature', () => {
  const narrow = renderFullBanner({ width: FULL_BANNER_MIN_WIDTH - 1 });
  assert.equal(narrow, renderCompactBanner({ width: FULL_BANNER_MIN_WIDTH - 1 }));
  assert.ok(!narrow.includes('█'));
  const tiny = renderCompactBanner({ width: 20 });
  assert.equal(tiny, renderSignature());
});

test('terminal detection honours NO_COLOR, TERM=dumb, and TTY state', () => {
  const tty = { isTTY: true, columns: 120 };
  assert.deepEqual(detectTerminal({ env: {}, stream: tty }), { color: true, width: 120 });
  assert.equal(detectTerminal({ env: { NO_COLOR: '1' }, stream: tty }).color, false);
  assert.equal(detectTerminal({ env: { TERM: 'dumb' }, stream: tty }).color, false);
  assert.equal(detectTerminal({ env: {}, stream: { isTTY: false } }).color, false);
  assert.equal(detectTerminal({ env: {}, stream: { isTTY: false } }).width, 80);
});

test('committed banner artefacts match the source of truth', () => {
  const root = path.resolve(__dirname, '..', 'branding');
  assert.equal(fs.readFileSync(path.join(root, 'signature.txt'), 'utf8').trim(), renderSignature({ color: false }));
  assert.equal(fs.readFileSync(path.join(root, 'banner-full.txt'), 'utf8').trimEnd(), renderFullBanner({ color: false, width: 80 }));
});
