'use strict';

const fs = require('fs');
const path = require('path');
const { db } = require('../db/database');
const { hashPassword, verifyPassword } = require('./password');

const USERS_FILE = process.env.CPHI_USERS_FILE
  || path.join(__dirname, '..', 'data', 'users.json');

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    enabled: !!row.enabled,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function getByUsername(username) {
  const name = String(username || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(name);
  return row || null;
}

function getById(id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  return row || null;
}

function listUsers() {
  return db.prepare('SELECT * FROM users ORDER BY username').all().map(sanitizeUser);
}

function countAdmins() {
  return db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND enabled = 1`).get().n;
}

function verifyLogin(username, password) {
  const row = getByUsername(username);
  if (!row || !row.enabled) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return sanitizeUser(row);
}

function createUser({ username, displayName, password, role = 'user' }) {
  const name = String(username || '').trim().toLowerCase();
  if (!name) throw new Error('Username is required');
  if (getByUsername(name)) throw new Error('Username already exists');
  const now = new Date().toISOString();
  const info = db.prepare(`
    INSERT INTO users (created_at, updated_at, username, password_hash, display_name, role, enabled)
    VALUES (@created_at, @updated_at, @username, @password_hash, @display_name, @role, 1)
  `).run({
    created_at: now,
    updated_at: now,
    username: name,
    password_hash: hashPassword(password),
    display_name: String(displayName || name).trim(),
    role: role === 'admin' ? 'admin' : 'user',
  });
  return sanitizeUser(getById(info.lastInsertRowid));
}

function updateUser(id, { displayName, role, enabled }) {
  const existing = getById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const nextRole = role !== undefined ? (role === 'admin' ? 'admin' : 'user') : existing.role;
  const nextEnabled = enabled !== undefined ? (enabled ? 1 : 0) : (existing.enabled ? 1 : 0);
  if (existing.role === 'admin' && nextRole !== 'admin' && countAdmins() <= 1) {
    throw new Error('Cannot remove the last admin');
  }
  if (existing.role === 'admin' && !nextEnabled && countAdmins() <= 1) {
    throw new Error('Cannot disable the last admin');
  }
  db.prepare(`
    UPDATE users SET
      display_name = @display_name,
      role = @role,
      enabled = @enabled,
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    id: Number(id),
    display_name: displayName !== undefined ? String(displayName).trim() : existing.display_name,
    role: nextRole,
    enabled: nextEnabled,
    updated_at: now,
  });
  return sanitizeUser(getById(id));
}

function setPassword(id, newPassword) {
  const existing = getById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    now,
    Number(id)
  );
  return sanitizeUser(getById(id));
}

function changeOwnPassword(username, currentPassword, newPassword) {
  const row = getByUsername(username);
  if (!row) throw new Error('User not found');
  if (!verifyPassword(currentPassword, row.password_hash)) {
    throw new Error('Current password is incorrect');
  }
  return setPassword(row.id, newPassword);
}

function deleteUser(id) {
  const existing = getById(id);
  if (!existing) return false;
  if (existing.role === 'admin' && countAdmins() <= 1) {
    throw new Error('Cannot delete the last admin');
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(Number(id));
  return true;
}

function importFromJsonIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (count > 0) {
    ensureBootstrapAdmin();
    return;
  }

  if (!fs.existsSync(USERS_FILE)) {
    createUser({
      username: 'hrvadmin',
      displayName: 'HRV Admin',
      password: 'ChangeMeNow1!',
      role: 'admin',
    });
    console.warn(`WARN: No users file at ${USERS_FILE} — created default hrvadmin (change password immediately)`);
    return;
  }

  const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Invalid users file: ${USERS_FILE}`);
  }

  for (const u of raw) {
    const username = String(u.username || '').trim().toLowerCase();
    if (!username || !u.password) continue;
    const role = u.role === 'admin' || username === 'hrvadmin' ? 'admin' : 'user';
    createUser({
      username,
      displayName: u.displayName || username,
      password: u.password,
      role,
    });
  }
  console.log(`Imported ${raw.length} user(s) from ${USERS_FILE} into SQLite`);
  ensureBootstrapAdmin();
}

/** Guarantee hrvadmin is admin and at least one admin exists. */
function ensureBootstrapAdmin() {
  const hrv = getByUsername('hrvadmin');
  if (hrv && hrv.role !== 'admin') {
    db.prepare(`UPDATE users SET role = 'admin', enabled = 1, updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      hrv.id
    );
    console.warn('WARN: Promoted hrvadmin to admin role');
  }
  if (countAdmins() > 0) return;
  const row = getByUsername('hrvadmin');
  if (row) {
    db.prepare(`UPDATE users SET role = 'admin', enabled = 1, updated_at = ? WHERE id = ?`).run(
      new Date().toISOString(),
      row.id
    );
    console.warn('WARN: No admin users found — promoted hrvadmin to admin');
    return;
  }
  createUser({
    username: 'hrvadmin',
    displayName: 'HRV Admin',
    password: 'ChangeMeNow1!',
    role: 'admin',
  });
  console.warn('WARN: No users in database — created emergency hrvadmin (change password immediately)');
}

module.exports = {
  USERS_FILE,
  listUsers,
  getByUsername,
  getById,
  verifyLogin,
  createUser,
  updateUser,
  setPassword,
  changeOwnPassword,
  deleteUser,
  countAdmins,
  importFromJsonIfEmpty,
  ensureBootstrapAdmin,
  sanitizeUser,
};
