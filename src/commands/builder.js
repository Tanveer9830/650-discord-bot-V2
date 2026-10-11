'use strict';

const { SlashCommandBuilder, ChannelType, PermissionsBitField } = require('discord.js');
const { flattenModule } = require('./framework');

function applyOption(builder, opt) {
  const common = (o) => {
    o.setName(opt.name).setDescription(opt.description).setRequired(Boolean(opt.required));
    return o;
  };
  switch (opt.type) {
    case 'string':
      return builder.addStringOption((o) => {
        common(o);
        if (opt.minLength !== undefined) o.setMinLength(opt.minLength);
        if (opt.maxLength !== undefined) o.setMaxLength(opt.maxLength);
        if (opt.choices) o.addChoices(...opt.choices);
        if (opt.autocomplete) o.setAutocomplete(true);
        return o;
      });
    case 'integer':
    case 'number':
      return builder[opt.type === 'integer' ? 'addIntegerOption' : 'addNumberOption']((o) => {
        common(o);
        if (opt.min !== undefined) o.setMinValue(opt.min);
        if (opt.max !== undefined) o.setMaxValue(opt.max);
        if (opt.choices) o.addChoices(...opt.choices);
        return o;
      });
    case 'boolean':
      return builder.addBooleanOption((o) => common(o));
    case 'user':
      return builder.addUserOption((o) => common(o));
    case 'role':
      return builder.addRoleOption((o) => common(o));
    case 'attachment':
      return builder.addAttachmentOption((o) => common(o));
    case 'channel':
      return builder.addChannelOption((o) => {
        common(o);
        if (opt.channelTypes) o.addChannelTypes(...opt.channelTypes.map((t) => ChannelType[t]));
        return o;
      });
    default:
      throw new Error(`Unknown option type ${opt.type}`);
  }
}

function applyOptions(target, options) {
  for (const opt of options) applyOption(target, opt);
  return target;
}

/** Convert a validated module into discord.js SlashCommandBuilder JSON. */
function buildCommandJSON(mod) {
  const builder = new SlashCommandBuilder().setName(mod.name).setDescription(mod.description);
  if (mod.defaultMemberPermissions.length) {
    builder.setDefaultMemberPermissions(PermissionsBitField.resolve(mod.defaultMemberPermissions).toString());
  } else {
    builder.setDefaultMemberPermissions(null);
  }
  builder.setDMPermission(Boolean(mod.dmPermission));
  if (mod.standalone) {
    applyOptions(builder, mod.standaloneAction.options);
  }
  for (const [name, action] of Object.entries(mod.actions)) {
    builder.addSubcommand((sc) => applyOptions(sc.setName(name).setDescription(action.description), action.options));
  }
  for (const [gname, group] of Object.entries(mod.groups)) {
    builder.addSubcommandGroup((g) => {
      g.setName(gname).setDescription(group.description);
      for (const [name, action] of Object.entries(group.actions)) {
        g.addSubcommand((sc) => applyOptions(sc.setName(name).setDescription(action.description), action.options));
      }
      return g;
    });
  }
  return builder.toJSON();
}

/** Full registration payload (array of JSON command objects) for a validated module list. */
function buildRegistrationPayload(modules) {
  return modules.map(buildCommandJSON);
}

/** Action-level metadata used by the inventory and the docs generator. */
function describeActions(modules) {
  return modules.flatMap((mod) => flattenModule(mod).map((e) => ({
    key: e.key,
    topLevel: e.topLevel,
    path: e.path,
    category: e.action.category,
    access: e.action.access,
    guildOnly: e.action.guildOnly,
    description: e.action.description,
    options: e.action.options.map((o) => o.name),
    permissions: e.action.permissions.map((p) => p.toString()),
    hasHandler: typeof e.action.run === 'function',
  })));
}

module.exports = { buildCommandJSON, buildRegistrationPayload, describeActions };
