'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/**
 * Open the SQLite database with safe defaults:
 * foreign keys enforced, WAL journaling, a busy timeout, and restrictive file permissions.
 */
function openDatabase(filePath) {
  const target = filePath === ':memory:' ? ':memory:' : path.resolve(filePath);
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o750 });
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (target !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // The file may not exist yet on some platforms; migrations create it immediately after.
    }
  }
  return db;
}

/**
 * Run a function inside BEGIN IMMEDIATE / COMMIT, rolling back on any error.
 * node:sqlite is synchronous, so the callback must not await.
 */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Rollback can fail if the transaction was already closed by SQLite; the original error matters more.
    }
    throw error;
  }
}

module.exports = { openDatabase, transaction };
