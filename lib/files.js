'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('../db/database');

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'text/plain',
]);

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/msword': '.doc',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.ms-excel': '.xls',
  'text/plain': '.txt',
};

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
};

const MAX_FILE_BYTES = 20 * 1024 * 1024;

function safeExt(originalName, mimeType) {
  const ext = path.extname(originalName || '').toLowerCase();
  if (MIME_BY_EXT[ext] === mimeType) return ext;
  return EXT_BY_MIME[mimeType] || '';
}

function validateUpload(file) {
  if (!file) return 'No file provided';
  if (!ALLOWED_MIMES.has(file.mimetype)) {
    return 'Allowed files: JPG, PNG, GIF, WebP, PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, TXT';
  }
  if (!safeExt(file.originalname, file.mimetype)) {
    return 'File extension does not match type';
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'File too large (max 20 MB)';
  }
  return null;
}

function newStoredName(mimeType, originalName) {
  const ext = safeExt(originalName, mimeType);
  return `${crypto.randomUUID()}${ext}`;
}

function storedFilePath(storedName) {
  const base = path.resolve(UPLOAD_DIR);
  const resolved = path.resolve(UPLOAD_DIR, path.basename(storedName));
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Invalid file path');
  }
  return resolved;
}

function deleteStoredFile(storedName) {
  try {
    const fp = storedFilePath(storedName);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (err) {
    console.error('deleteStoredFile', err);
  }
}

function isImageMime(mimeType) {
  return String(mimeType || '').startsWith('image/');
}

module.exports = {
  UPLOAD_DIR,
  ALLOWED_MIMES,
  MAX_FILE_BYTES,
  validateUpload,
  newStoredName,
  storedFilePath,
  deleteStoredFile,
  isImageMime,
};
