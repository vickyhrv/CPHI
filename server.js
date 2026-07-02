const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const store = require('./store');
const { DB_PATH, UPLOAD_DIR } = require('./db/database');
const {
  validateUpload,
  newStoredName,
  storedFilePath,
  deleteStoredFile,
  MAX_FILE_BYTES,
} = require('./lib/files');
const {
  findUser,
  createSession,
  getSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  authGate,
  requireAdmin,
} = require('./auth');
const users = require('./lib/users');
const { validatePasswordPolicy } = require('./lib/password');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Seed default data ────────────────────────────────────────────────────────

store.seedIfEmpty('budget_items', [
  ['Booth', 'Stand space rental'],
  ['Booth', 'Booth build / refurbishment'],
  ['Booth', 'Venue services (power, internet, water)'],
  ['Booth', 'Furniture & AV rental'],
  ['Hospitality', 'Booth catering & drinks'],
  ['Marketing', 'Giveaways'],
  ['Marketing', 'Printed collateral / brochures'],
  ['Logistics', 'Shipping & customs'],
  ['Travel', 'Flights'],
  ['Travel', 'Hotel'],
  ['Travel', 'Local transport'],
  ['Travel', 'Staff meals / per diem'],
  ['Other', 'Contingency (10-15%)'],
].map(([category, item]) => ({
  category, item,
  last_year: 0, this_year_est: 0, actual: 0,
  notes: '', vendor: '', poc_name: '', poc_email: '', poc_phone: '', merchandise_notes: ''
})));

store.seedIfEmpty('tasks', [
  ['Stall & Venue', 'Confirm stand location and re-book space', '2026-07-15'],
  ['Stall & Venue', 'Schedule booth build / refurbishment', '2026-07-31'],
  ['Stall & Venue', 'Order venue services (power, internet, water)', '2026-08-15'],
  ['Stall & Venue', 'Sort furniture, AV, signage refresh', '2026-08-31'],
  ['Hospitality', 'Confirm approved catering vendor for drinks', '2026-08-01'],
  ['Hospitality', 'Book bar setup, glassware, stock', '2026-09-01'],
  ['Marketing', 'Decide and order giveaways', '2026-08-01'],
  ['Marketing', 'Update brochures and collateral', '2026-09-01'],
  ['Logistics', 'Book flights and hotel for team', '2026-07-15'],
  ['Logistics', 'Arrange freight/shipping for booth materials', '2026-09-01'],
  ['Logistics', 'Sort local transport', '2026-09-15'],
  ['Team', 'Confirm attendees and booth shift schedule', '2026-09-01'],
  ['Team', 'Brief staff on messaging and lead-capture process', '2026-09-20'],
  ['Commercial Prep', 'Pre-book meetings via CPHI matchmaking tool', '2026-09-15'],
  ['Commercial Prep', 'Invite key clients to booth', '2026-09-01'],
  ['Post-Event', 'Follow up on leads', '2026-10-15'],
  ['Post-Event', 'Reconcile budget actuals', '2026-10-20'],
  ['Post-Event', 'Write recap for stakeholders', '2026-10-22'],
].map(([phase, task, due_date]) => ({ phase, task, done: false, owner: '', due_date, notes: '' })));

store.seedIfEmpty('leads', []);
store.seedIfEmpty('activity_log', []);
store.seedIfEmpty('travelers', [
  { name: 'Add traveler name', passport: '', passport_expiry: '',
    visa_applied: false, visa_received: false, flight_booked: false,
    hotel_booked: false, insurance: false, forex: false,
    visa_apply_due: '', flight_due: '', hotel_due: '',
    notes: '' }
]);
store.seedIfEmpty('settings', [
  { id: 1, budget_cap: 0, currency: 'USD', created_at: new Date().toISOString() }
]);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// ─── Auth API (register before gate + static) ─────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = findUser(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = createSession(user);
  res.setHeader('Set-Cookie', sessionCookie(token, req));
  res.json({
    ok: true,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    isAdmin: user.role === 'admin',
  });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req);
  res.setHeader('Set-Cookie', clearSessionCookie(req));
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    username: session.username,
    displayName: session.displayName,
    role: session.role,
    isAdmin: session.role === 'admin',
  });
});

app.post('/api/auth/change-password', (req, res) => {
  try {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Unauthorized' });
    const { currentPassword, newPassword } = req.body || {};
    const policyErr = validatePasswordPolicy(newPassword);
    if (policyErr) return res.status(400).json({ error: policyErr });
    users.changeOwnPassword(session.username, currentPassword, newPassword);
    logActivity('Changed own password', session.username, session.displayName);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Could not change password' });
  }
});

app.use(authGate);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    database: 'sqlite',
    path: DB_PATH,
    counts: {
      budget: store.count('budget_items'),
      tasks: store.count('tasks'),
      leads: store.count('leads'),
      travelers: store.count('travelers'),
      files: store.count('file_assets'),
    },
  });
});

// ─── Activity log helper ──────────────────────────────────────────────────────
function logActivity(action, detail, who) {
  store.insert('activity_log', { action, detail, who: who || 'Unknown', ts: new Date().toISOString() });
}

function parseIdParam(id) {
  const num = Number(id);
  return Number.isInteger(num) && num >= 1 ? num : null;
}

function toCsv(rows, headers) {
  return [headers.join(',')].concat(
    rows.map((r) => headers.map((h) => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
  ).join('\n');
}

function sendCsv(res, filename, rows, headers) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('\uFEFF' + toCsv(rows, headers));
}

function whoFromReq(req) {
  return req.body?.who || req.query?.who || '';
}

function whoFromSession(req) {
  return req.user?.displayName || whoFromReq(req) || 'Unknown';
}

function getMergedPhases() {
  const ordered = [];
  const seen = new Set();
  for (const p of store.all('task_phases')) {
    const name = String(p.name || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    ordered.push(name);
  }
  for (const t of store.all('tasks')) {
    const name = String(t.phase || '').trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    ordered.push(name);
  }
  return ordered;
}

const fileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const err = validateUpload(file);
      if (err) return cb(new Error(err));
      cb(null, newStoredName(file.mimetype, file.originalname));
    },
  }),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (_req, file, cb) => {
    const err = validateUpload(file);
    if (err) return cb(new Error(err));
    cb(null, true);
  },
});

// ─── Settings API ─────────────────────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const rows = store.all('settings');
  res.json(rows[0] || { budget_cap: 0, currency: 'USD' });
});
app.put('/api/settings', (req, res) => {
  const rows = store.all('settings');
  const existing = rows[0];
  const { budget_cap, currency } = req.body;
  if (existing) {
    res.json(store.update('settings', existing.id, { budget_cap, currency }));
  } else {
    res.json(store.insert('settings', { budget_cap, currency }));
  }
});

// ─── Budget API ───────────────────────────────────────────────────────────────
app.get('/api/budget', (req, res) => res.json(store.all('budget_items')));

app.post('/api/budget', (req, res) => {
  const { category = 'Other', item = 'New item', last_year = 0, this_year_est = 0,
    actual = 0, notes = '', vendor = '', poc_name = '', poc_email = '', poc_phone = '',
    merchandise_notes = '', who = '' } = req.body;
  const row = store.insert('budget_items', { category, item, last_year, this_year_est,
    actual, notes, vendor, poc_name, poc_email, poc_phone, merchandise_notes });
  logActivity('Added budget item', `"${item}" (${category})`, who);
  res.json(row);
});

app.put('/api/budget/:id', (req, res) => {
  const { category, item, last_year, this_year_est, actual, notes,
    vendor, poc_name, poc_email, poc_phone, merchandise_notes } = req.body;
  const updated = store.update('budget_items', req.params.id, { category, item,
    last_year, this_year_est, actual, notes,
    vendor: vendor || '', poc_name: poc_name || '', poc_email: poc_email || '',
    poc_phone: poc_phone || '', merchandise_notes: merchandise_notes || '' });
  if (!updated) return res.status(404).json({ error: 'Budget item not found' });
  res.json(updated);
});

app.delete('/api/budget/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: 'Invalid budget item id' });
  }
  const row = store.get('budget_items', id);
  if (!row) {
    return res.status(404).json({ error: 'Budget item not found' });
  }
  store.remove('budget_items', id);
  logActivity('Deleted budget item', `"${row.item}"`, whoFromReq(req));
  res.json({ ok: true, deletedId: id });
});

app.get('/api/budget/export.csv', (req, res) => {
  const rows = store.all('budget_items');
  const headers = [
    'id', 'category', 'item', 'last_year', 'this_year_est', 'actual', 'notes',
    'vendor', 'poc_name', 'poc_email', 'poc_phone', 'merchandise_notes', 'created_at',
  ];
  sendCsv(res, 'cphi-budget.csv', rows, headers);
});

// ─── Tasks API ────────────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => res.json(store.all('tasks')));

function sendTasksCsv(res) {
  const rows = store.all('tasks');
  const headers = ['id', 'phase', 'task', 'done', 'owner', 'due_date', 'notes', 'created_at'];
  const exportRows = rows.map((t) => ({ ...t, done: t.done ? 'yes' : 'no' }));
  sendCsv(res, 'cphi-tasks.csv', exportRows, headers);
}

// Export routes before /:id — Express 5 + static must not swallow these paths
app.get('/api/tasks/export.csv', (req, res) => sendTasksCsv(res));
app.get('/api/tasks/export', (req, res) => sendTasksCsv(res));

app.post('/api/tasks', (req, res) => {
  const { phase = 'Other', task, owner = '', due_date = '', notes = '', who = '' } = req.body;
  if (!task) return res.status(400).json({ error: 'Task is required' });
  const row = store.insert('tasks', { phase, task, owner, due_date, notes, done: false });
  logActivity('Added task', `"${task}" in ${phase}`, who);
  res.json(row);
});

app.put('/api/tasks/:id', (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid task id' });
    const old = store.get('tasks', id);
    if (!old) return res.status(404).json({ error: 'Task not found' });

    const { phase, task, done, owner, due_date, notes, who } = req.body || {};
    const updated = store.update('tasks', id, {
      phase: phase ?? old.phase,
      task: task ?? old.task,
      done: done !== undefined ? !!done : !!old.done,
      owner: owner ?? old.owner ?? '',
      due_date: due_date ?? old.due_date ?? '',
      notes: notes !== undefined ? String(notes) : (old.notes ?? ''),
    });
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    if (!old.done && updated.done) {
      logActivity('Completed task', `"${updated.task}"`, who || '');
    }
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/tasks/:id', err);
    res.status(500).json({ error: 'Failed to save task — try again' });
  }
});

app.delete('/api/tasks/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid task id' });
  const row = store.get('tasks', id);
  if (!row) return res.status(404).json({ error: 'Task not found' });
  store.remove('tasks', id);
  logActivity('Deleted task', `"${row.task}"`, whoFromReq(req));
  res.json({ ok: true, deletedId: id });
});

// ─── Leads API ────────────────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  const leads = store.all('leads').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(leads);
});

app.post('/api/leads', (req, res) => {
  const { name, company = '', role = '', email = '', phone = '', country = '',
    interest = '', priority = 'Medium', notes = '', captured_by = '', follow_up_date = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const row = store.insert('leads', { name, company, role, email, phone, country,
    interest, priority, notes, captured_by, follow_up_date });
  logActivity('Captured lead', `${name} from ${company || 'unknown company'}`, captured_by);
  res.json(row);
});

app.delete('/api/leads/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid lead id' });
  const row = store.get('leads', id);
  if (!row) return res.status(404).json({ error: 'Lead not found' });
  store.remove('leads', id);
  logActivity('Deleted lead', row.name, whoFromReq(req));
  res.json({ ok: true, deletedId: id });
});

app.get('/api/leads/export.csv', (req, res) => {
  const leads = store.all('leads').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const headers = ['id', 'name', 'company', 'role', 'email', 'phone', 'country', 'interest',
    'priority', 'notes', 'captured_by', 'follow_up_date', 'created_at'];
  sendCsv(res, 'cphi-leads.csv', leads, headers);
});

// ─── Travelers / Visa API ─────────────────────────────────────────────────────
app.get('/api/travelers', (req, res) => res.json(store.all('travelers')));

app.post('/api/travelers', (req, res) => {
  const { name, passport = '', passport_expiry = '', notes = '', who = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const row = store.insert('travelers', {
    name, passport, passport_expiry,
    visa_applied: false, visa_received: false, flight_booked: false,
    hotel_booked: false, insurance: false, forex: false,
    visa_apply_due: '', flight_due: '', hotel_due: '', notes
  });
  logActivity('Added traveler', name, who);
  res.json(row);
});

app.put('/api/travelers/:id', (req, res) => {
  const { name, passport, passport_expiry, visa_applied, visa_received, flight_booked,
    hotel_booked, insurance, forex, visa_apply_due, flight_due, hotel_due, notes } = req.body;
  const updated = store.update('travelers', req.params.id, {
    name, passport, passport_expiry,
    visa_applied: !!visa_applied, visa_received: !!visa_received,
    flight_booked: !!flight_booked, hotel_booked: !!hotel_booked,
    insurance: !!insurance, forex: !!forex,
    visa_apply_due: visa_apply_due || '', flight_due: flight_due || '',
    hotel_due: hotel_due || '', notes: notes || ''
  });
  if (!updated) return res.status(404).json({ error: 'Traveler not found' });
  res.json(updated);
});

app.delete('/api/travelers/:id', (req, res) => {
  const id = parseIdParam(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid traveler id' });
  const row = store.get('travelers', id);
  if (!row) return res.status(404).json({ error: 'Traveler not found' });
  store.remove('travelers', id);
  logActivity('Removed traveler', row.name, whoFromReq(req));
  res.json({ ok: true, deletedId: id });
});

app.get('/api/travelers/export.csv', (req, res) => {
  const rows = store.all('travelers');
  const headers = [
    'id', 'name', 'passport', 'passport_expiry',
    'visa_applied', 'visa_received', 'flight_booked', 'hotel_booked',
    'insurance', 'forex', 'visa_apply_due', 'flight_due', 'hotel_due',
    'notes', 'created_at',
  ];
  const exportRows = rows.map((t) => ({
    ...t,
    visa_applied: t.visa_applied ? 'yes' : 'no',
    visa_received: t.visa_received ? 'yes' : 'no',
    flight_booked: t.flight_booked ? 'yes' : 'no',
    hotel_booked: t.hotel_booked ? 'yes' : 'no',
    insurance: t.insurance ? 'yes' : 'no',
    forex: t.forex ? 'yes' : 'no',
  }));
  sendCsv(res, 'cphi-travelers.csv', exportRows, headers);
});

// ─── Activity log API ─────────────────────────────────────────────────────────
app.get('/api/activity', (req, res) => {
  const logs = store.all('activity_log')
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 200);
  res.json(logs);
});

app.get('/api/activity/export.csv', (req, res) => {
  const logs = store.all('activity_log').sort((a, b) => new Date(b.ts) - new Date(a.ts));
  sendCsv(res, 'cphi-activity.csv', logs, ['id', 'action', 'detail', 'who', 'ts']);
});

// ─── Files API ────────────────────────────────────────────────────────────────
function filterFiles(rows, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((r) =>
    (r.original_name || '').toLowerCase().includes(needle)
    || (r.comment || '').toLowerCase().includes(needle)
  );
}

function sendFilesCsv(res) {
  const rows = store.all('file_assets');
  const headers = [
    'id', 'original_name', 'mime_type', 'size_bytes', 'comment',
    'uploaded_by', 'created_at', 'updated_at',
  ];
  sendCsv(res, 'cphi-files.csv', rows, headers);
}

app.get('/api/files', (req, res) => {
  try {
    const rows = filterFiles(store.all('file_assets'), req.query.q);
    res.json(rows);
  } catch (err) {
    console.error('GET /api/files', err);
    res.status(500).json({ error: 'Failed to load files' });
  }
});

app.get('/api/files/export.csv', (req, res) => sendFilesCsv(res));
app.get('/api/files/export', (req, res) => sendFilesCsv(res));

app.post('/api/files', (req, res) => {
  fileUpload.single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'File too large (max 8 MB)'
        : (err.message || 'Upload failed');
      return res.status(400).json({ error: msg });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }

    const comment = String(req.body?.comment || '').trim();
    const who = whoFromSession(req);

    try {
      const row = store.insert('file_assets', {
        original_name: req.file.originalname,
        stored_name: req.file.filename,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        comment,
        uploaded_by: who,
      });
      logActivity('Uploaded file', `"${req.file.originalname}"`, who);
      res.json(row);
    } catch (dbErr) {
      deleteStoredFile(req.file.filename);
      console.error('POST /api/files', dbErr);
      res.status(500).json({ error: 'Failed to save file metadata' });
    }
  });
});

app.get('/api/files/:id/content', (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid file id' });
    const row = store.get('file_assets', id);
    if (!row) return res.status(404).json({ error: 'File not found' });

    const fp = storedFilePath(row.stored_name);
    if (!fs.existsSync(fp)) {
      return res.status(404).json({ error: 'File missing on disk' });
    }

    res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${row.original_name.replace(/"/g, '')}"`);
    const stream = fs.createReadStream(fp);
    stream.on('error', (streamErr) => {
      console.error('GET /api/files/:id/content stream', streamErr);
      if (!res.headersSent) res.status(500).json({ error: 'Failed to read file' });
    });
    stream.pipe(res);
  } catch (err) {
    console.error('GET /api/files/:id/content', err);
    res.status(500).json({ error: 'Failed to load file' });
  }
});

app.put('/api/files/:id', (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid file id' });
    const old = store.get('file_assets', id);
    if (!old) return res.status(404).json({ error: 'File not found' });

    const { comment } = req.body || {};
    const updated = store.update('file_assets', id, {
      comment: comment !== undefined ? String(comment) : old.comment,
    });
    if (!updated) return res.status(404).json({ error: 'File not found' });
    res.json(updated);
  } catch (err) {
    console.error('PUT /api/files/:id', err);
    res.status(500).json({ error: 'Failed to update file' });
  }
});

app.delete('/api/files/:id', (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid file id' });
    const row = store.get('file_assets', id);
    if (!row) return res.status(404).json({ error: 'File not found' });

    deleteStoredFile(row.stored_name);
    store.remove('file_assets', id);
    logActivity('Deleted file', `"${row.original_name}"`, whoFromSession(req));
    res.json({ ok: true, deletedId: id });
  } catch (err) {
    console.error('DELETE /api/files/:id', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// ─── Task phases API ──────────────────────────────────────────────────────────
app.get('/api/task-phases', (req, res) => {
  res.json(getMergedPhases());
});

app.post('/api/task-phases', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Phase name is required' });
    const existing = store.all('task_phases').find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) return res.json({ name: existing.name, id: existing.id });
    const phases = store.all('task_phases');
    const maxSort = phases.reduce((m, p) => Math.max(m, p.sort_order || 0), 0);
    const row = store.insert('task_phases', { name, sort_order: maxSort + 1 });
    logActivity('Added task phase', `"${name}"`, whoFromSession(req));
    res.json(row);
  } catch (err) {
    console.error('POST /api/task-phases', err);
    res.status(500).json({ error: err.message || 'Failed to add phase' });
  }
});

// ─── Admin users API ──────────────────────────────────────────────────────────
app.get('/api/admin/users', requireAdmin, (req, res) => {
  try {
    res.json(users.listUsers());
  } catch (err) {
    console.error('GET /api/admin/users', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  try {
    const { username, displayName, password, role = 'user' } = req.body || {};
    const policyErr = validatePasswordPolicy(password);
    if (policyErr) return res.status(400).json({ error: policyErr });
    const row = users.createUser({ username, displayName, password, role });
    logActivity('Created user', `${row.username} (${row.role})`, whoFromSession(req));
    res.json(row);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create user' });
  }
});

app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id' });
    const { displayName, role, enabled } = req.body || {};
    const updated = users.updateUser(id, { displayName, role, enabled });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    if (enabled === false) {
      logActivity('Disabled user', updated.username, whoFromSession(req));
    } else if (enabled === true) {
      logActivity('Enabled user', updated.username, whoFromSession(req));
    } else {
      logActivity('Updated user', updated.username, whoFromSession(req));
    }
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update user' });
  }
});

app.put('/api/admin/users/:id/password', requireAdmin, (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id' });
    const { password } = req.body || {};
    const policyErr = validatePasswordPolicy(password);
    if (policyErr) return res.status(400).json({ error: policyErr });
    const target = users.getById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    users.setPassword(id, password);
    logActivity('Reset user password', target.username, whoFromSession(req));
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to reset password' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  try {
    const id = parseIdParam(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid user id' });
    if (req.user.userId === id) {
      return res.status(400).json({ error: 'You cannot delete your own account' });
    }
    const target = users.getById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    users.deleteUser(id);
    logActivity('Deleted user', target.username, whoFromSession(req));
    res.json({ ok: true, deletedId: id });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete user' });
  }
});

// Static files after all API routes (avoids 404 on /api/*/export.csv)
app.use(express.static(path.join(__dirname, 'public')));

// ─── Error handling ───────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`CPHI app running on port ${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
  console.log(`Upload directory: ${UPLOAD_DIR}`);
});
