'use strict';

const SENSITIVE_KEY = /(token|secret|password|passwd|authorization|cookie|session|api[_-]?key|private[_-]?key|client[_-]?secret|dsn|credential)/i;
const DISCORD_TOKEN_PATTERN = /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}/g;
const BEARER_PATTERN = /(Bot|Bearer)\s+[A-Za-z0-9._~+/-]{10,}=*/gi;
const URL_CREDENTIAL_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;
const REDACTED = '[REDACTED]';

const knownSecrets = new Set();

/** Register a literal secret value (for example DISCORD_TOKEN) so it is always scrubbed. */
function registerSecret(value) {
  if (typeof value === 'string' && value.length >= 8) knownSecrets.add(value);
}

function clearKnownSecrets() {
  knownSecrets.clear();
}

function redactString(input) {
  let out = String(input);
  for (const secret of knownSecrets) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  out = out.replace(DISCORD_TOKEN_PATTERN, REDACTED);
  out = out.replace(BEARER_PATTERN, (_m, scheme) => `${scheme} ${REDACTED}`);
  out = out.replace(URL_CREDENTIAL_PATTERN, (_m, scheme) => `${scheme}${REDACTED}@`);
  return out;
}

/** Deep-redact a value for logs, audit records, and error reports. */
function redact(value, depth = 0) {
  if (depth > 6) return '[Truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack.split('\n').slice(0, 6).join('\n')) : undefined, code: value.code };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  return String(value);
}

module.exports = { redact, redactString, registerSecret, clearKnownSecrets, REDACTED };
