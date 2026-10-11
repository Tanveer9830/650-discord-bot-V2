'use strict';

/** Record a security incident without ever letting logging failures break event handling. */
function logIncident(repos, { guildId, kind, severity, details }) {
  try {
    return repos.incidents.insert({ guildId, kind, severity, details });
  } catch {
    return null;
  }
}

module.exports = { logIncident };
