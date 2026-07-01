'use strict';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS budget_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  category          TEXT NOT NULL DEFAULT 'Other',
  item              TEXT NOT NULL,
  last_year         REAL NOT NULL DEFAULT 0,
  this_year_est     REAL NOT NULL DEFAULT 0,
  actual            REAL NOT NULL DEFAULT 0,
  notes             TEXT NOT NULL DEFAULT '',
  vendor            TEXT NOT NULL DEFAULT '',
  poc_name          TEXT NOT NULL DEFAULT '',
  poc_email         TEXT NOT NULL DEFAULT '',
  poc_phone         TEXT NOT NULL DEFAULT '',
  merchandise_notes TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  phase       TEXT NOT NULL DEFAULT 'Other',
  task        TEXT NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0,
  owner       TEXT NOT NULL DEFAULT '',
  due_date    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  name            TEXT NOT NULL,
  company         TEXT NOT NULL DEFAULT '',
  role            TEXT NOT NULL DEFAULT '',
  email           TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  country         TEXT NOT NULL DEFAULT '',
  interest        TEXT NOT NULL DEFAULT '',
  priority        TEXT NOT NULL DEFAULT 'Medium',
  notes           TEXT NOT NULL DEFAULT '',
  captured_by     TEXT NOT NULL DEFAULT '',
  follow_up_date  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS activity_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  action  TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT '',
  who     TEXT NOT NULL DEFAULT 'Unknown',
  ts      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS travelers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  name             TEXT NOT NULL,
  passport         TEXT NOT NULL DEFAULT '',
  passport_expiry  TEXT NOT NULL DEFAULT '',
  visa_applied     INTEGER NOT NULL DEFAULT 0,
  visa_received    INTEGER NOT NULL DEFAULT 0,
  flight_booked    INTEGER NOT NULL DEFAULT 0,
  hotel_booked     INTEGER NOT NULL DEFAULT 0,
  insurance        INTEGER NOT NULL DEFAULT 0,
  forex            INTEGER NOT NULL DEFAULT 0,
  visa_apply_due   TEXT NOT NULL DEFAULT '',
  flight_due       TEXT NOT NULL DEFAULT '',
  hotel_due        TEXT NOT NULL DEFAULT '',
  notes            TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  budget_cap  REAL NOT NULL DEFAULT 0,
  currency    TEXT NOT NULL DEFAULT 'USD',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
`;

const MIGRATION_VERSION = 1;

function runMigrations(db) {
  db.exec(SCHEMA_SQL);

  const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(MIGRATION_VERSION);
  if (!applied) {
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(MIGRATION_VERSION);
  }
}

module.exports = { runMigrations, MIGRATION_VERSION };
