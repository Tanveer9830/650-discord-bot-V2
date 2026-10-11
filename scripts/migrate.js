#!/usr/bin/env node
'use strict';

const { loadDotEnv, parseConfig } = require('../src/config');
const { openDatabase } = require('../src/database/connection');
const { migrate } = require('../src/database/migrations');

loadDotEnv();
const config = parseConfig(process.env);
const db = openDatabase(config.database.path);
const result = migrate(db);
process.stdout.write(`Database: ${config.database.path}\n`);
process.stdout.write(`Applied now: ${result.applied.length ? result.applied.join(', ') : 'none (already up to date)'}\n`);
process.stdout.write(`Migrations on record: ${result.current.length}\n`);
db.close();
