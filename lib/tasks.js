'use strict';

const TASK_STATUSES = ['initiated', 'pending', 'done'];

const TASK_STATUS_LABELS = {
  initiated: 'Initiated',
  pending: 'Pending',
  done: 'Done',
};

function normalizeStatus(value, fallback = 'pending') {
  const v = String(value || '').toLowerCase();
  return TASK_STATUSES.includes(v) ? v : fallback;
}

function isTaskDone(status) {
  return normalizeStatus(status) === 'done';
}

function statusFromRow(row) {
  if (row?.status) return normalizeStatus(row.status);
  return row?.done ? 'done' : 'pending';
}

module.exports = {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  normalizeStatus,
  isTaskDone,
  statusFromRow,
};
