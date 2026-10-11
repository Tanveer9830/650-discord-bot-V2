'use strict';

const crypto = require('node:crypto');

/**
 * Ordered, append-only migrations. Never edit a migration that has shipped:
 * add a new one instead. The runner stores a checksum for each applied migration
 * and refuses to start if an applied migration has been altered or is unknown.
 */
const MIGRATIONS = Object.freeze([
  Object.freeze({ id: '001_initial_schema', sql: require('./001_initial_schema') }),
  Object.freeze({ id: '002_protected_security', sql: require('./002_protected_security') }),
]);

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
}

/**
 * Apply pending migrations. Returns { applied: [ids], current: [ids] }.
 * Throws if the database contains migrations this code does not know about,
 * or if an applied migration's content differs from the code (tamper / drift guard).
 */
function migrate(db, migrations = MIGRATIONS) {
  ensureMigrationTable(db);
  const applied = new Map(
    db.prepare('SELECT id, checksum FROM schema_migrations ORDER BY id').all().map((r) => [r.id, r.checksum]),
  );
  const known = new Set(migrations.map((m) => m.id));
  for (const id of applied.keys()) {
    if (!known.has(id)) {
      throw new Error(`Database has migration "${id}" that this version does not know. Refusing to start.`);
    }
  }
  const ran = [];
  for (const migration of migrations) {
    const sum = checksum(migration.sql);
    if (applied.has(migration.id)) {
      if (applied.get(migration.id) !== sum) {
        throw new Error(`Migration "${migration.id}" has changed since it was applied. Refusing to continue.`);
      }
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, checksum) VALUES (?, ?)').run(migration.id, sum);
      db.exec('COMMIT');
      ran.push(migration.id);
    } catch (error) {
      db.exec('ROLLBACK');
      throw new Error(`Migration "${migration.id}" failed and was rolled back: ${error.message}`);
    }
  }
  return { applied: ran, current: [...applied.keys(), ...ran] };
}

module.exports = { migrate, MIGRATIONS, checksum };
