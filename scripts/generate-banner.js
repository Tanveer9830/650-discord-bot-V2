#!/usr/bin/env node
'use strict';

// Writes the branding artefacts used by install.sh and the README from the single source in src/branding.
const fs = require('node:fs');
const path = require('node:path');
const { renderFullBanner, renderCompactBanner, renderSignature } = require('../src/branding');

const OUT = path.resolve(__dirname, '..', 'branding');
fs.mkdirSync(OUT, { recursive: true });
const files = {
  'banner-full.txt': renderFullBanner({ color: false, width: 80 }),
  'banner-compact.txt': renderCompactBanner({ color: false, width: 80 }),
  'signature.txt': renderSignature({ color: false }),
};
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), `${content}\n`);
}
process.stdout.write(`Wrote ${Object.keys(files).join(', ')} to branding/\n`);
