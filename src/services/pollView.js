'use strict';

const ui = require('../utils/ui');
const { sanitizeText } = require('../utils/text');
const { buttonRow } = require('../utils/components');

function pollEmbed(poll, options, tally) {
  const total = tally.reduce((n, t) => n + t.votes, 0);
  const lines = options.map((o) => {
    const votes = (tally.find((t) => t.option_idx === o.idx) || { votes: 0 }).votes;
    const pct = total ? Math.round((votes / total) * 100) : 0;
    return `**${o.idx + 1}.** ${sanitizeText(o.label, { maxLength: 80 })} — ${votes} vote(s) (${pct}%)`;
  });
  return ui.info(`Poll #${poll.id}${poll.status === 'closed' ? ' (closed)' : ''}`, `${sanitizeText(poll.question, { maxLength: 300 })}\n\n${lines.join('\n')}\n\nTotal votes: ${total}`);
}

function pollRows(poll, options) {
  if (poll.status !== 'open') return [];
  const buttons = options.map((o) => ({ customId: `poll:vote:${poll.id}:${o.idx}`, label: `${o.idx + 1}. ${sanitizeText(o.label, { maxLength: 60 })}`.slice(0, 80), style: 'Primary' }));
  return [buttonRow(buttons)];
}

module.exports = { pollEmbed, pollRows };
