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
  due_date    TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT ''
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

CREATE TABLE IF NOT EXISTS file_assets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  original_name TEXT NOT NULL,
  stored_name   TEXT NOT NULL UNIQUE,
  mime_type     TEXT NOT NULL DEFAULT '',
  size_bytes    INTEGER NOT NULL DEFAULT 0,
  comment       TEXT NOT NULL DEFAULT '',
  uploaded_by   TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_tasks_phase ON tasks(phase);
CREATE INDEX IF NOT EXISTS idx_tasks_done ON tasks(done);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_ts ON activity_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_file_assets_updated ON file_assets(updated_at DESC);
`;

const MIGRATION_VERSION = 3;

function columnExists(db, table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function applyMigration(db, version) {
  if (version === 2) {
    if (!columnExists(db, 'tasks', 'notes')) {
      db.exec(`ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
    }
    db.prepare(`UPDATE tasks SET phase = ? WHERE phase = ?`).run('Stall & Venue', 'Booth & Venue');
  }
  if (version === 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_assets (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
        original_name TEXT NOT NULL,
        stored_name   TEXT NOT NULL UNIQUE,
        mime_type     TEXT NOT NULL DEFAULT '',
        size_bytes    INTEGER NOT NULL DEFAULT 0,
        comment       TEXT NOT NULL DEFAULT '',
        uploaded_by   TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_file_assets_updated ON file_assets(updated_at DESC);
    `);
  }
}

function runMigrations(db) {
  db.exec(SCHEMA_SQL);

  // Always ensure tasks.notes exists (safe if column already added)
  if (!columnExists(db, 'tasks', 'notes')) {
    db.exec(`ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT ''`);
  }

  for (let v = 1; v <= MIGRATION_VERSION; v += 1) {
    const applied = db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(v);
    if (applied) continue;
    applyMigration(db, v);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(v);
  }
}

module.exports = { runMigrations, MIGRATION_VERSION };
