'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

/** Build a single row of buttons. Custom IDs are validated to Discord's 100-character limit. */
function buttonRow(buttons) {
  const row = new ActionRowBuilder();
  row.addComponents(...buttons.map((b) => {
    if (b.customId.length > 100) throw new Error('custom_id exceeds 100 characters');
    return new ButtonBuilder()
      .setCustomId(b.customId)
      .setLabel(b.label.slice(0, 80))
      .setStyle(ButtonStyle[b.style || 'Secondary'])
      .setDisabled(Boolean(b.disabled));
  }));
  return row;
}

module.exports = { buttonRow };
