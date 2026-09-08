'use strict';

const { db, withTransaction } = require('../db/database');

const UNC_NAME = 'Uncategorized';

function normalizeFolderName(name) {
  const n = String(name || '').trim();
  if (!n) return { error: 'Folder name is required' };
  if (n.length > 120) return { error: 'Folder name too long (max 120)' };
  if (/[\\/]/.test(n)) return { error: 'Folder name cannot contain / or \\' };
  return { name: n };
}

function rowToFolder(row) {
  if (!row) return null;
  return {
    ...row,
    is_system: !!row.is_system,
    parent_id: row.parent_id == null ? null : Number(row.parent_id),
  };
}

function getFolder(id) {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId < 1) return null;
  return rowToFolder(db.prepare('SELECT * FROM file_folders WHERE id = ?').get(numId));
}

function ensureUncategorized() {
  let row = db.prepare(
    `SELECT * FROM file_folders WHERE is_system = 1 AND name = ? LIMIT 1`
  ).get(UNC_NAME);
  if (!row) {
    const info = db.prepare(
      `INSERT INTO file_folders (name, parent_id, is_system) VALUES (?, NULL, 1)`
    ).run(UNC_NAME);
    row = db.prepare('SELECT * FROM file_folders WHERE id = ?').get(info.lastInsertRowid);
  }
  if (columnExists('file_assets', 'folder_id')) {
    db.prepare(`UPDATE file_assets SET folder_id = ? WHERE folder_id IS NULL`).run(row.id);
  }
  return rowToFolder(row);
}

function columnExists(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

function getUncategorizedId() {
  return ensureUncategorized().id;
}

function findSiblingByName(parentId, name, excludeId) {
  const parentKey = parentId == null ? null : Number(parentId);
  const rows = parentKey == null
    ? db.prepare(`SELECT * FROM file_folders WHERE parent_id IS NULL AND name = ? COLLATE NOCASE`).all(name)
    : db.prepare(`SELECT * FROM file_folders WHERE parent_id = ? AND name = ? COLLATE NOCASE`).all(parentKey, name);
  return rows.find((r) => !excludeId || Number(r.id) !== Number(excludeId)) || null;
}

function listChildren(parentId) {
  const parentKey = parentId == null || parentId === '' || parentId === 'root'
    ? null
    : Number(parentId);
  const rows = parentKey == null
    ? db.prepare(
      `SELECT * FROM file_folders WHERE parent_id IS NULL ORDER BY is_system DESC, name COLLATE NOCASE ASC`
    ).all()
    : db.prepare(
      `SELECT * FROM file_folders WHERE parent_id = ? ORDER BY name COLLATE NOCASE ASC`
    ).all(parentKey);
  return rows.map(rowToFolder);
}

function listAllFolders() {
  return db.prepare(
    `SELECT * FROM file_folders ORDER BY name COLLATE NOCASE ASC`
  ).all().map(rowToFolder);
}

function getBreadcrumb(folderId) {
  const crumbs = [];
  let current = getFolder(folderId);
  const seen = new Set();
  while (current) {
    if (seen.has(current.id)) break;
    seen.add(current.id);
    crumbs.unshift({ id: current.id, name: current.name, is_system: current.is_system });
    current = current.parent_id != null ? getFolder(current.parent_id) : null;
  }
  return crumbs;
}

function isDescendantOf(folderId, ancestorId) {
  let current = getFolder(folderId);
  const seen = new Set();
  while (current) {
    if (Number(current.id) === Number(ancestorId)) return true;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parent_id != null ? getFolder(current.parent_id) : null;
  }
  return false;
}

function createFolder({ name, parentId }) {
  const norm = normalizeFolderName(name);
  if (norm.error) throw new Error(norm.error);

  let parentKey = null;
  if (parentId != null && parentId !== '' && parentId !== 'root') {
    const parent = getFolder(parentId);
    if (!parent) throw new Error('Parent folder not found');
    parentKey = parent.id;
  }

  if (findSiblingByName(parentKey, norm.name)) {
    throw new Error('A folder with that name already exists here');
  }

  const now = new Date().toISOString();
  const info = db.prepare(
    `INSERT INTO file_folders (created_at, updated_at, name, parent_id, is_system)
     VALUES (?, ?, ?, ?, 0)`
  ).run(now, now, norm.name, parentKey);
  return getFolder(info.lastInsertRowid);
}

function renameFolder(id, name) {
  const folder = getFolder(id);
  if (!folder) throw new Error('Folder not found');
  if (folder.is_system) throw new Error('Cannot rename the Uncategorized folder');

  const norm = normalizeFolderName(name);
  if (norm.error) throw new Error(norm.error);

  if (findSiblingByName(folder.parent_id, norm.name, folder.id)) {
    throw new Error('A folder with that name already exists here');
  }

  const now = new Date().toISOString();
  db.prepare(
    `UPDATE file_folders SET name = ?, updated_at = ? WHERE id = ?`
  ).run(norm.name, now, folder.id);
  return getFolder(folder.id);
}

function collectDescendantIds(rootId) {
  const ids = [];
  const queue = [Number(rootId)];
  while (queue.length) {
    const id = queue.shift();
    const kids = db.prepare(`SELECT id FROM file_folders WHERE parent_id = ?`).all(id);
    for (const k of kids) {
      ids.push(Number(k.id));
      queue.push(Number(k.id));
    }
  }
  return ids;
}

function deleteFolder(id) {
  const folder = getFolder(id);
  if (!folder) throw new Error('Folder not found');
  if (folder.is_system) throw new Error('Cannot delete the Uncategorized folder');

  const uncId = getUncategorizedId();
  const subtree = [folder.id, ...collectDescendantIds(folder.id)];

  withTransaction(() => {
    const placeholders = subtree.map(() => '?').join(', ');
    db.prepare(
      `UPDATE file_assets SET folder_id = ?, updated_at = ? WHERE folder_id IN (${placeholders})`
    ).run(uncId, new Date().toISOString(), ...subtree);

    // Delete deepest children first
    const ordered = [...subtree].reverse();
    for (const fid of ordered) {
      db.prepare(`DELETE FROM file_folders WHERE id = ?`).run(fid);
    }
  });

  return { ok: true, deletedIds: subtree, movedToFolderId: uncId };
}

function folderPathLabel(folderId) {
  return getBreadcrumb(folderId).map((c) => c.name).join(' / ') || UNC_NAME;
}

function listFilesInFolder(folderId, q) {
  const fid = Number(folderId);
  let rows = db.prepare(
    `SELECT * FROM file_assets WHERE folder_id = ? ORDER BY updated_at DESC`
  ).all(fid);
  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    rows = rows.filter((r) =>
      (r.original_name || '').toLowerCase().includes(needle)
      || (r.comment || '').toLowerCase().includes(needle)
    );
  }
  return rows;
}

function searchAllFiles(q) {
  let rows = db.prepare(`SELECT * FROM file_assets ORDER BY updated_at DESC`).all();
  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    rows = rows.filter((r) =>
      (r.original_name || '').toLowerCase().includes(needle)
      || (r.comment || '').toLowerCase().includes(needle)
    );
  }
  return rows.map((r) => ({
    ...r,
    folder_path: folderPathLabel(r.folder_id),
  }));
}

function getFolderContents(folderId, q) {
  const folder = getFolder(folderId);
  if (!folder) throw new Error('Folder not found');
  return {
    folder,
    breadcrumb: getBreadcrumb(folder.id),
    folders: listChildren(folder.id),
    files: listFilesInFolder(folder.id, q),
  };
}

function normalizeFileName(name) {
  const n = String(name || '').trim();
  if (!n) return { error: 'File name is required' };
  if (n.length > 255) return { error: 'File name too long' };
  if (/[\\/]/.test(n)) return { error: 'File name cannot contain / or \\' };
  return { name: n };
}

function assertFolderExists(folderId) {
  const folder = getFolder(folderId);
  if (!folder) throw new Error('Destination folder not found');
  return folder;
}

module.exports = {
  UNC_NAME,
  ensureUncategorized,
  getUncategorizedId,
  getFolder,
  listChildren,
  listAllFolders,
  getBreadcrumb,
  isDescendantOf,
  createFolder,
  renameFolder,
  deleteFolder,
  getFolderContents,
  folderPathLabel,
  searchAllFiles,
  normalizeFileName,
  assertFolderExists,
};
