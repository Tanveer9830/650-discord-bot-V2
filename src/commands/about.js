'use strict';

const { defineModule } = require('./framework');
const { BRAND, renderSignature } = require('../branding');
const ui = require('../utils/ui');

function formatUptime(seconds) {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

module.exports = defineModule({
  name: 'about',
  description: 'Show information about this bot and its creator',
  category: 'branding',
  dmPermission: true,
  standalone: {
    description: 'Show information about this bot and its creator',
    category: 'branding',
    guildOnly: false,
    cooldownMs: 3000,
    run: async (ctx) => {
      const embed = ui.info(BRAND.product, `${BRAND.aboutLines.join('\n')}\n\n${renderSignature()}`, ui.COLORS.brand)
        .addFields(
          { name: 'Creator', value: BRAND.creatorName, inline: true },
          { name: 'Discord', value: BRAND.discordUsername, inline: true },
          { name: 'Uptime', value: formatUptime(process.uptime()), inline: true },
        );
      await ctx.respond({ embeds: [embed], ephemeral: false });
    },
  },
});
