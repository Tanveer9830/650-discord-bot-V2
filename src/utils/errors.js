'use strict';

const crypto = require('node:crypto');

/** An error whose message is safe to show to the Discord user. */
class UserError extends Error {
  constructor(message, { code = 'USER_ERROR' } = {}) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    this.userMessage = message;
  }
}

class ConfigError extends Error {
  constructor(issues) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

function referenceId() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

module.exports = { UserError, ConfigError, referenceId };
