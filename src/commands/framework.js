'use strict';

/**
 * Declarative command framework.
 *
 * A command MODULE is one top-level slash command. It can contain:
 *   - actions:  flat subcommands           (/module action)
 *   - groups:   subcommand groups, each with actions   (/module group action)
 *   - run:      a single action when the module has no subcommands (/about)
 *
 * Every leaf action is one "functional action" and has its own handler, permissions,
 * validation, cooldown, and category. Metadata is validated before anything is registered.
 */

const CATEGORIES = Object.freeze(['administration', 'moderation', 'security', 'utility', 'community', 'economy', 'owner', 'branding']);
const ACCESS = Object.freeze(['public', 'owner']);
const OPTION_TYPES = Object.freeze(['string', 'integer', 'number', 'boolean', 'user', 'channel', 'role', 'attachment']);

const NAME_PATTERN = /^[\p{Ll}\p{N}_-]{1,32}$/u;
const OPTION_NAME_PATTERN = /^[\p{Ll}\p{N}_-]{1,32}$/u;

const DISCORD_LIMITS = Object.freeze({
  topLevelCommands: 100,
  optionsPerLevel: 25,
  choicesPerOption: 25,
  nameLength: 32,
  descriptionLength: 100,
  // Discord caps combined text per command at 8000; we enforce a stricter 4000 for headroom.
  combinedTextPerCommand: 4000,
});

function defineAction(spec) {
  return Object.freeze({
    description: spec.description,
    options: Object.freeze(spec.options || []),
    permissions: Object.freeze(spec.permissions || []),
    botPermissions: Object.freeze(spec.botPermissions || []),
    guildOnly: spec.guildOnly !== undefined ? spec.guildOnly : true,
    access: spec.access || 'public',
    category: spec.category,
    cooldownMs: spec.cooldownMs ?? null,
    run: spec.run,
    autocomplete: spec.autocomplete || null,
  });
}

/** Normalise a module definition into { name, description, actions: Map, groups, standalone }. */
function defineModule(spec) {
  const actions = spec.actions || {};
  const groups = spec.groups || {};
  const standalone = Boolean(spec.standalone);
  const normalise = (raw) => defineAction({ ...raw, category: raw.category || spec.category });
  const normalisedActions = Object.fromEntries(Object.entries(actions).map(([k, v]) => [k, normalise(v)]));
  const normalisedGroups = Object.fromEntries(Object.entries(groups).map(([gk, g]) => [
    gk,
    { description: g.description, actions: Object.fromEntries(Object.entries(g.actions).map(([k, v]) => [k, normalise(v)])) },
  ]));
  return Object.freeze({
    name: spec.name,
    description: spec.description,
    category: spec.category,
    defaultMemberPermissions: spec.defaultMemberPermissions || [],
    dmPermission: spec.dmPermission !== undefined ? spec.dmPermission : false,
    access: spec.access || 'public',
    actions: Object.freeze(normalisedActions),
    groups: Object.freeze(normalisedGroups),
    standalone,
    // A standalone module is itself one action (for example /about). It cannot also have subcommands.
    standaloneAction: standalone ? normalise(spec.standalone) : null,
  });
}

/** Flatten a module into { key, path, action } leaf entries. */
function flattenModule(mod) {
  const out = [];
  if (mod.standalone) {
    out.push({ key: mod.name, path: [], action: mod.standaloneAction, topLevel: mod.name });
  }
  for (const [name, action] of Object.entries(mod.actions)) {
    out.push({ key: `${mod.name}.${name}`, path: [name], action, topLevel: mod.name });
  }
  for (const [gname, group] of Object.entries(mod.groups)) {
    for (const [name, action] of Object.entries(group.actions)) {
      out.push({ key: `${mod.name}.${gname}.${name}`, path: [gname, name], action, topLevel: mod.name });
    }
  }
  return out;
}

function optionTextLength(opt) {
  return opt.name.length + opt.description.length + (opt.choices || []).reduce((n, c) => n + String(c.name).length + String(c.value).length, 0);
}

/**
 * Validate every module against Discord's structural limits and this project's rules.
 * Returns an array of human-readable problems (empty array = valid).
 */
function validateModules(modules) {
  const problems = [];
  const seenTop = new Set();
  if (modules.length > DISCORD_LIMITS.topLevelCommands) {
    problems.push(`too many top-level commands: ${modules.length} > ${DISCORD_LIMITS.topLevelCommands}`);
  }
  const seenKeys = new Set();

  for (const mod of modules) {
    const where = `module "${mod.name}"`;
    if (!NAME_PATTERN.test(mod.name)) problems.push(`${where}: name must be 1-32 lowercase characters`);
    if (seenTop.has(mod.name)) problems.push(`${where}: duplicate top-level name`);
    seenTop.add(mod.name);
    if (!mod.description || mod.description.length < 1 || mod.description.length > DISCORD_LIMITS.descriptionLength) {
      problems.push(`${where}: description must be 1-100 characters`);
    }
    if (!CATEGORIES.includes(mod.category)) problems.push(`${where}: unknown category "${mod.category}"`);
    if (!ACCESS.includes(mod.access)) problems.push(`${where}: unknown access "${mod.access}"`);
    if (mod.standalone && (Object.keys(mod.actions).length || Object.keys(mod.groups).length)) {
      problems.push(`${where}: a standalone command cannot also have subcommands`);
    }
    if (!mod.standalone && !Object.keys(mod.actions).length && !Object.keys(mod.groups).length) {
      problems.push(`${where}: has no subcommands and no run handler`);
    }

    const topCount = Object.keys(mod.actions).length + Object.keys(mod.groups).length;
    if (topCount > DISCORD_LIMITS.optionsPerLevel) problems.push(`${where}: ${topCount} subcommands/groups exceed the limit of 25`);

    for (const [gname, group] of Object.entries(mod.groups)) {
      if (!NAME_PATTERN.test(gname)) problems.push(`${where}: group "${gname}" has an invalid name`);
      if (!group.description || group.description.length > DISCORD_LIMITS.descriptionLength) problems.push(`${where}: group "${gname}" description must be 1-100 characters`);
      if (Object.keys(group.actions).length === 0) problems.push(`${where}: group "${gname}" has no subcommands`);
      if (Object.keys(group.actions).length > DISCORD_LIMITS.optionsPerLevel) problems.push(`${where}: group "${gname}" exceeds 25 subcommands`);
    }

    const combined = { text: mod.name.length + mod.description.length };
    for (const entry of flattenModule(mod)) {
      const { key, path, action } = entry;
      const label = `action "${key}"`;
      if (seenKeys.has(key)) problems.push(`${label}: duplicate action key`);
      seenKeys.add(key);
      if (path.length && !NAME_PATTERN.test(path[path.length - 1])) problems.push(`${label}: invalid subcommand name`);
      if (!action.description || action.description.length > DISCORD_LIMITS.descriptionLength) problems.push(`${label}: description must be 1-100 characters`);
      if (typeof action.run !== 'function') problems.push(`${label}: missing run handler`);
      if (!ACCESS.includes(action.access)) problems.push(`${label}: unknown access "${action.access}"`);
      if (!CATEGORIES.includes(action.category)) problems.push(`${label}: unknown category "${action.category}"`);
      if (action.options.length > DISCORD_LIMITS.optionsPerLevel) problems.push(`${label}: more than 25 options`);
      let seenOptional = false;
      const seenOptionNames = new Set();
      for (const opt of action.options) {
        if (!OPTION_NAME_PATTERN.test(opt.name)) problems.push(`${label}: option "${opt.name}" has an invalid name`);
        if (seenOptionNames.has(opt.name)) problems.push(`${label}: duplicate option "${opt.name}"`);
        seenOptionNames.add(opt.name);
        if (!OPTION_TYPES.includes(opt.type)) problems.push(`${label}: option "${opt.name}" has unknown type "${opt.type}"`);
        if (!opt.description || opt.description.length > DISCORD_LIMITS.descriptionLength) problems.push(`${label}: option "${opt.name}" description must be 1-100 characters`);
        if (opt.required && seenOptional) problems.push(`${label}: required option "${opt.name}" must come before optional options`);
        if (!opt.required) seenOptional = true;
        if ((opt.choices || []).length > DISCORD_LIMITS.choicesPerOption) problems.push(`${label}: option "${opt.name}" has more than 25 choices`);
        if (opt.choices && opt.autocomplete) problems.push(`${label}: option "${opt.name}" cannot have both choices and autocomplete`);
        if (opt.type === 'string' && opt.choices && opt.choices.some((c) => String(c.value).length > 100)) problems.push(`${label}: choice value too long`);
        combined.text += optionTextLength(opt);
      }
      for (const p of action.permissions) if (typeof p !== 'bigint') problems.push(`${label}: permissions must be PermissionFlagsBits values`);
      for (const p of action.botPermissions) if (typeof p !== 'bigint') problems.push(`${label}: botPermissions must be PermissionFlagsBits values`);
      if (action.access === 'owner' && action.permissions.length) {
        problems.push(`${label}: owner-only actions must not rely on server permissions for authorization`);
      }
      combined.text += key.length + action.description.length;
    }
    if (combined.text > DISCORD_LIMITS.combinedTextPerCommand) {
      problems.push(`${where}: combined text is ${combined.text} characters (limit ${DISCORD_LIMITS.combinedTextPerCommand})`);
    }
  }
  return problems;
}

module.exports = {
  defineAction,
  defineModule,
  flattenModule,
  validateModules,
  CATEGORIES,
  ACCESS,
  OPTION_TYPES,
  DISCORD_LIMITS,
};
