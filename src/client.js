'use strict';

const { Client, GatewayIntentBits, Partials } = require('discord.js');

/**
 * Discord client. Intents are the minimum needed:
 *  - Guilds: channels, roles, and guild metadata
 *  - GuildMembers (privileged): welcome/goodbye, role management, member lookups
 *  - GuildMessages + MessageContent (privileged): automod word/link checks, XP
 * Mentions are disabled by default so the bot cannot ping anyone by accident.
 */
function createDiscordClient() {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Channel],
    allowedMentions: { parse: [], repliedUser: false },
    failIfNotExists: false,
  });
}

module.exports = { createDiscordClient };
