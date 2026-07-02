'use strict';

const { importFromJsonIfEmpty } = require('../lib/users');

function migrateUsersIfNeeded() {
  importFromJsonIfEmpty();
}

module.exports = { migrateUsersIfNeeded };
