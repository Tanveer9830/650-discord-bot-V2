'use strict';

const { PermissionFlagsBits } = require('discord.js');

/** Permissions the bot needs across the whole command set; checked by /diagnostics permissions. */
const REQUIRED_BOT_PERMISSIONS = Object.freeze([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
]);

module.exports = { REQUIRED_BOT_PERMISSIONS };
