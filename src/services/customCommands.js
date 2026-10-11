'use strict';

const { UserError } = require('../utils/errors');
const { sanitizeText } = require('../utils/text');

/**
 * Custom commands are TEMPLATES, never code. A definition is a text or embed message with a small set of
 * placeholders. There is no expression language, no scripting, no HTTP, and no way to reach the bot's
 * internals. Only the global owner can create or delete them.
 */

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;
const PLACEHOLDERS = Object.freeze(['server', 'member', 'members']);
const KINDS = Object.freeze(['text', 'embed']);
const PERMISSION_LABELS = Object.freeze({
  everyone: 'everyone',
  manage_messages: 'Manage Messages',
  manage_guild: 'Manage Server',
});
const MIN_PERMISSIONS = Object.freeze(Object.keys(PERMISSION_LABELS));
const MAX_BODY = 2000;
const MAX_TITLE = 256;

function validateDefinition(input, { builtinNames = [], existingNames = [] } = {}) {
  const name = String(input.name || '').trim().toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw new UserError('Names must be 2 to 32 characters: lowercase letters, digits, - or _, starting with a letter or digit.', { code: 'VALIDATION' });
  }
  const builtin = new Set(builtinNames);
  if (builtin.has(name)) throw new UserError('That name is already used by a built-in command.', { code: 'VALIDATION' });
  const existing = new Set(existingNames);
  if (existing.has(name)) throw new UserError('A custom command with that name already exists.', { code: 'VALIDATION' });

  const kind = String(input.kind || 'text').toLowerCase();
  if (!KINDS.includes(kind)) throw new UserError('Kind must be text or embed.', { code: 'VALIDATION' });

  const body = String(input.body || '');
  if (body.trim().length === 0 || body.length > MAX_BODY) {
    throw new UserError(`The message body must be 1 to ${MAX_BODY} characters.`, { code: 'VALIDATION' });
  }
  if (/@everyone|@here|<@|<#|<@&/i.test(body)) {
    throw new UserError('Custom command bodies cannot contain mentions, pings, or channel links.', { code: 'VALIDATION' });
  }
  for (const match of body.matchAll(/\{([a-z_]+)\}/gi)) {
    if (!PLACEHOLDERS.includes(match[1].toLowerCase())) {
      throw new UserError(`Unknown placeholder {${match[1]}}. Allowed: ${PLACEHOLDERS.map((p) => `{${p}}`).join(' ')}.`, { code: 'VALIDATION' });
    }
  }

  const title = input.title ? String(input.title).trim() : null;
  if (kind === 'embed' && !title) throw new UserError('Embeds need a title.', { code: 'VALIDATION' });
  if (title && title.length > MAX_TITLE) throw new UserError(`Titles can be at most ${MAX_TITLE} characters.`, { code: 'VALIDATION' });

  const minPermission = String(input.minPermission || 'everyone');
  if (!MIN_PERMISSIONS.includes(minPermission)) throw new UserError('Choose everyone, manage_messages, or manage_guild.', { code: 'VALIDATION' });

  const color = input.color ?? null;
  if (color !== null && (!Number.isInteger(color) || color < 0 || color > 0xffffff)) {
    throw new UserError('Colour must be a hex value such as #3B82F6.', { code: 'VALIDATION' });
  }

  return { name, kind, title, body, color, minPermission };
}

/** Substitute placeholders with sanitized values. Unknown placeholders are impossible after validation. */
function render(def, values) {
  const map = {
    server: sanitizeText(values.server, { maxLength: 100 }),
    member: sanitizeText(values.member, { maxLength: 32 }),
    members: String(Number.isFinite(values.members) ? values.members : 0),
  };
  const fill = (text) => String(text).replace(/\{([a-z_]+)\}/gi, (whole, key) => {
    const k = key.toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : whole;
  });
  return {
    kind: def.kind,
    title: def.title ? sanitizeText(fill(def.title), { maxLength: MAX_TITLE }) : null,
    content: sanitizeText(fill(def.body), { maxLength: 4000 }),
    color: def.color ?? null,
  };
}

module.exports = { validateDefinition, render, PERMISSION_LABELS, PLACEHOLDERS, NAME_PATTERN };
