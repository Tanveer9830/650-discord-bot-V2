'use strict';

const { validateModules, flattenModule } = require('./framework');
const { buildRegistrationPayload, describeActions } = require('./builder');

const MODULES = [
  require('./about'),
  require('./utility'),
  require('./owner'),
  require('./diagnostics'),
  require('./config'),
  require('./moderation'),
  require('./warn'),
  require('./automod'),
  require('./security'),
  require('./antiraid'),
  require('./roles'),
  require('./channels'),
  require('./buttonroles'),
  require('./verification'),
  require('./ticket'),
  require('./giveaway'),
  require('./poll'),
  require('./reminder'),
  require('./economy'),
  require('./level'),
  require('./customcommand'),
  require('./backup'),
  require('./embed'),
];

/**
 * Build the in-memory registry. Throws if any definition breaks Discord's rules,
 * so a bad command can never reach the Discord API.
 */
function buildRegistry(modules = MODULES) {
  const problems = validateModules(modules);
  if (problems.length) {
    const err = new Error(`Command registry is invalid:\n- ${problems.join('\n- ')}`);
    err.problems = problems;
    throw err;
  }
  const actions = new Map();
  for (const mod of modules) {
    for (const entry of flattenModule(mod)) actions.set(entry.key, entry.action);
  }
  return {
    modules,
    actions,
    topLevelNames: new Set(modules.map((m) => m.name)),
    payload: () => buildRegistrationPayload(modules),
    describe: () => describeActions(modules),
  };
}

module.exports = { MODULES, buildRegistry };
