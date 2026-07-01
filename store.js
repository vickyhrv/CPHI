'use strict';

const { db, withTransaction } = require('./db/database');
const { runMigrations } = require('./db/schema');
const { migrateFromJsonIfNeeded } = require('./db/migrate-json');

runMigrations(db);
migrateFromJsonIfNeeded();

const ALLOWED_TABLES = new Set([
  'budget_items',
  'tasks',
  'leads',
  'activity_log',
  'travelers',
  'settings',
]);

const BOOLEAN_FIELDS = {
  tasks: new Set(['done']),
  travelers: new Set([
    'visa_applied',
    'visa_received',
    'flight_booked',
    'hotel_booked',
    'insurance',
    'forex',
  ]),
};

const TABLE_COLUMNS = {
  budget_items: [
    'category', 'item', 'last_year', 'this_year_est', 'actual', 'notes',
    'vendor', 'poc_name', 'poc_email', 'poc_phone', 'merchandise_notes',
  ],
  tasks: ['phase', 'task', 'done', 'owner', 'due_date', 'notes'],
  leads: [
    'name', 'company', 'role', 'email', 'phone', 'country',
    'interest', 'priority', 'notes', 'captured_by', 'follow_up_date',
  ],
  activity_log: ['action', 'detail', 'who', 'ts'],
  travelers: [
    'name', 'passport', 'passport_expiry',
    'visa_applied', 'visa_received', 'flight_booked', 'hotel_booked',
    'insurance', 'forex', 'visa_apply_due', 'flight_due', 'hotel_due', 'notes',
  ],
  settings: ['budget_cap', 'currency'],
};

function assertTable(table) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error(`Unknown table: ${table}`);
  }
}

function normalizeOut(table, row) {
  if (!row) return null;
  const out = { ...row };
  const bools = BOOLEAN_FIELDS[table];
  if (bools) {
    for (const key of bools) {
      if (key in out) out[key] = !!out[key];
    }
  }
  if (table === 'tasks' && out.notes == null) out.notes = '';
  return out;
}

function normalizeIn(table, data) {
  const out = { ...data };
  const bools = BOOLEAN_FIELDS[table];
  if (bools) {
    for (const key of bools) {
      if (key in out) out[key] = out[key] ? 1 : 0;
    }
  }
  return out;
}

function pickColumns(table, data) {
  const allowed = TABLE_COLUMNS[table];
  const picked = {};
  for (const col of allowed) {
    if (col in data) picked[col] = data[col];
  }
  return picked;
}

const store = {
  all(table) {
    assertTable(table);
    const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
    return rows.map((r) => normalizeOut(table, r));
  },

  get(table, id) {
    assertTable(table);
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id));
    return normalizeOut(table, row);
  },

  insert(table, data) {
    assertTable(table);
    const now = new Date().toISOString();
    const payload = normalizeIn(table, pickColumns(table, data));
    const cols = Object.keys(payload);
    const placeholders = cols.map((c) => `@${c}`).join(', ');
    const colList = cols.join(', ');

    const hasCreatedAt = table !== 'activity_log';
    const sql = hasCreatedAt
      ? `INSERT INTO ${table} (created_at${colList ? `, ${colList}` : ''}) VALUES (@created_at${cols.length ? `, ${placeholders}` : ''})`
      : `INSERT INTO ${table} (${colList}) VALUES (${placeholders})`;

    const params = hasCreatedAt
      ? { created_at: now, ...payload }
      : { ...payload };

    if (table === 'activity_log' && !params.ts) {
      params.ts = now;
    }

    const info = db.prepare(sql).run(params);
    return this.get(table, info.lastInsertRowid);
  },

  update(table, id, data) {
    assertTable(table);
    const existing = this.get(table, id);
    if (!existing) return null;

    const payload = normalizeIn(table, pickColumns(table, data));
    const cols = Object.keys(payload);
    if (cols.length === 0) return existing;

    const setClause = cols.map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE ${table} SET ${setClause} WHERE id = @id`).run({
      id: Number(id),
      ...payload,
    });
    return this.get(table, id);
  },

  remove(table, id) {
    assertTable(table);
    const numId = Number(id);
    if (!Number.isInteger(numId) || numId < 1) {
      throw new Error(`Invalid id for delete: ${id}`);
    }
    const result = db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(numId);
    return result.changes;
  },

  seedIfEmpty(table, rows) {
    assertTable(table);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    if (count > 0) return;

    const self = this;
    withTransaction(() => {
      for (const row of rows) {
        self.insert(table, row);
      }
    });
  },

  count(table) {
    assertTable(table);
    return db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  },
};

module.exports = store;
