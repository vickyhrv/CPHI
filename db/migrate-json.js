'use strict';

const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, withTransaction } = require('./database');

const JSON_TABLES = [
  'budget_items',
  'tasks',
  'leads',
  'activity_log',
  'travelers',
  'settings',
];

function readJsonTable(table) {
  const fp = path.join(DATA_DIR, `${table}.json`);
  if (!fs.existsSync(fp)) return null;
  try {
    const rows = JSON.parse(fs.readFileSync(fp, 'utf8'));
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

function tableIsEmpty(table) {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get();
  return row.n === 0;
}

function boolToInt(v) {
  return v ? 1 : 0;
}

function importRows(table, rows) {
  withTransaction(() => {
    let maxId = 0;

    for (const row of rows) {
      maxId = Math.max(maxId, row.id || 0);

      if (table === 'budget_items') {
        db.prepare(`
          INSERT INTO budget_items (
            id, created_at, category, item, last_year, this_year_est, actual, notes,
            vendor, poc_name, poc_email, poc_phone, merchandise_notes
          ) VALUES (
            @id, @created_at, @category, @item, @last_year, @this_year_est, @actual, @notes,
            @vendor, @poc_name, @poc_email, @poc_phone, @merchandise_notes
          )
        `).run({
          id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          category: row.category || 'Other',
          item: row.item || '',
          last_year: Number(row.last_year) || 0,
          this_year_est: Number(row.this_year_est) || 0,
          actual: Number(row.actual) || 0,
          notes: row.notes || '',
          vendor: row.vendor || '',
          poc_name: row.poc_name || '',
          poc_email: row.poc_email || '',
          poc_phone: row.poc_phone || '',
          merchandise_notes: row.merchandise_notes || '',
        });
      } else if (table === 'tasks') {
        db.prepare(`
          INSERT INTO tasks (id, created_at, phase, task, done, owner, due_date)
          VALUES (@id, @created_at, @phase, @task, @done, @owner, @due_date)
        `).run({
          id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          phase: row.phase || 'Other',
          task: row.task || '',
          done: boolToInt(row.done),
          owner: row.owner || '',
          due_date: row.due_date || '',
        });
      } else if (table === 'leads') {
        db.prepare(`
          INSERT INTO leads (
            id, created_at, name, company, role, email, phone, country,
            interest, priority, notes, captured_by, follow_up_date
          ) VALUES (
            @id, @created_at, @name, @company, @role, @email, @phone, @country,
            @interest, @priority, @notes, @captured_by, @follow_up_date
          )
        `).run({
          id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          name: row.name || '',
          company: row.company || '',
          role: row.role || '',
          email: row.email || '',
          phone: row.phone || '',
          country: row.country || '',
          interest: row.interest || '',
          priority: row.priority || 'Medium',
          notes: row.notes || '',
          captured_by: row.captured_by || '',
          follow_up_date: row.follow_up_date || '',
        });
      } else if (table === 'activity_log') {
        db.prepare(`
          INSERT INTO activity_log (id, action, detail, who, ts)
          VALUES (@id, @action, @detail, @who, @ts)
        `).run({
          id: row.id,
          action: row.action || '',
          detail: row.detail || '',
          who: row.who || 'Unknown',
          ts: row.ts || row.created_at || new Date().toISOString(),
        });
      } else if (table === 'travelers') {
        db.prepare(`
          INSERT INTO travelers (
            id, created_at, name, passport, passport_expiry,
            visa_applied, visa_received, flight_booked, hotel_booked,
            insurance, forex, visa_apply_due, flight_due, hotel_due, notes
          ) VALUES (
            @id, @created_at, @name, @passport, @passport_expiry,
            @visa_applied, @visa_received, @flight_booked, @hotel_booked,
            @insurance, @forex, @visa_apply_due, @flight_due, @hotel_due, @notes
          )
        `).run({
          id: row.id,
          created_at: row.created_at || new Date().toISOString(),
          name: row.name || '',
          passport: row.passport || '',
          passport_expiry: row.passport_expiry || '',
          visa_applied: boolToInt(row.visa_applied),
          visa_received: boolToInt(row.visa_received),
          flight_booked: boolToInt(row.flight_booked),
          hotel_booked: boolToInt(row.hotel_booked),
          insurance: boolToInt(row.insurance),
          forex: boolToInt(row.forex),
          visa_apply_due: row.visa_apply_due || '',
          flight_due: row.flight_due || '',
          hotel_due: row.hotel_due || '',
          notes: row.notes || '',
        });
      } else if (table === 'settings') {
        db.prepare(`
          INSERT INTO settings (id, budget_cap, currency, created_at)
          VALUES (@id, @budget_cap, @currency, @created_at)
        `).run({
          id: row.id,
          budget_cap: Number(row.budget_cap) || 0,
          currency: row.currency || 'USD',
          created_at: row.created_at || new Date().toISOString(),
        });
      }
    }

    if (maxId > 0) {
      db.prepare('UPDATE sqlite_sequence SET seq = ? WHERE name = ?').run(maxId, table);
    }
  });
}

function migrateFromJsonIfNeeded() {
  let migrated = false;

  for (const table of JSON_TABLES) {
    if (!tableIsEmpty(table)) continue;

    const rows = readJsonTable(table);
    if (!rows || rows.length === 0) continue;

    importRows(table, rows);
    migrated = true;
    console.log(`Migrated ${rows.length} rows from ${table}.json → SQLite`);
  }

  return migrated;
}

module.exports = { migrateFromJsonIfNeeded };
