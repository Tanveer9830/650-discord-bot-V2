'use strict';

const { BRAND } = require('../branding');
const ui = require('../utils/ui');
const { sanitizeText } = require('../utils/text');
const { discordTimestamp } = require('../utils/time');
const { buttonRow } = require('../utils/components');

/** Embed for a giveaway in either its active or ended state. Never pings anyone. */
function giveawayEmbed(g, entries, winners = null) {
  const ended = g.status !== 'active';
  const winnerText = winners && winners.length ? winners.map((w) => `user ${w}`).join(', ') : 'no valid entries';
  const description = [
    `Prize: **${sanitizeText(g.prize, { maxLength: 200 })}**`,
    `Winners: ${g.winner_count}`,
    ended ? `Result: ${winnerText}` : `Ends: ${discordTimestamp(g.ends_at, 'R')}`,
    `Entries: ${entries}`,
    `\n${BRAND.attribution}`,
  ].join('\n');
  return ui.info(`Giveaway #${g.id}${ended ? ' (ended)' : ''}`, description, ended ? ui.COLORS.warn : ui.COLORS.brand);
}

function enterRow(id) {
  return buttonRow([{ customId: `giveaway:enter:${id}`, label: 'Enter giveaway', style: 'Success' }]);
}

module.exports = { giveawayEmbed, enterRow };
