'use strict';

const { redact } = require('./redact');

const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40, silent: 100 });

/**
 * Structured logger. Every record is passed through the redactor before it is written.
 * format: 'json' (production / systemd journal) or 'pretty' (local development).
 */
function createLogger({ level = 'info', format = 'json', stream = process.stdout, errorStream = process.stderr, context = {}, sink = null } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function write(lvl, message, meta) {
    if ((LEVELS[lvl] ?? 0) < threshold) return;
    const record = {
      time: new Date().toISOString(),
      level: lvl,
      msg: redact(String(message)),
      ...redact(context),
      ...(meta === undefined ? {} : { data: redact(meta) }),
    };
    if (sink) sink(record);
    const target = LEVELS[lvl] >= LEVELS.error ? errorStream : stream;
    if (!target) return;
    if (format === 'json') {
      target.write(`${JSON.stringify(record)}\n`);
    } else {
      const extra = meta === undefined ? '' : ` ${JSON.stringify(redact(meta))}`;
      target.write(`${record.time} ${lvl.toUpperCase().padEnd(5)} ${record.msg}${extra}\n`);
    }
  }

  return {
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
    child: (extra) => createLogger({ level, format, stream, errorStream, sink, context: { ...context, ...extra } }),
  };
}

module.exports = { createLogger, LEVELS };
