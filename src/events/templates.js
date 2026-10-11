'use strict';

const { sanitizeText } = require('../utils/text');

/** Fill {server}, {members}, {member} placeholders with sanitised plain text (never mentions). */
function renderTemplate(template, values) {
  const safe = {
    server: sanitizeText(values.server ?? '', { maxLength: 100 }),
    members: String(Number.isInteger(values.members) ? values.members : 0),
    member: sanitizeText(values.member ?? '', { maxLength: 64 }),
  };
  return sanitizeText(String(template).replace(/\{(server|members|member)\}/g, (_m, key) => safe[key]), { maxLength: 1900 });
}

module.exports = { renderTemplate };
