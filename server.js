const express = require('express');
const cors = require('cors');
const path = require('path');
const store = require('./store');
const { DB_PATH } = require('./db/database');
const {
  findUser,
  createSession,
  getSession,
  destroySession,
  sessionCookie,
  clearSessionCookie,
  authGate,
} = require('./auth');

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
  ['Booth & Venue', 'Confirm stand location and re-book space', '2026-07-15'],
  ['Booth & Venue', 'Schedule booth build / refurbishment', '2026-07-31'],
  ['Booth & Venue', 'Order venue services (power, internet, water)', '2026-08-15'],
  ['Booth & Venue', 'Sort furniture, AV, signage refresh', '2026-08-31'],
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
].map(([phase, task, due_date]) => ({ phase, task, done: false, owner: '', due_date })));

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
  res.json({ ok: true, username: user.username, displayName: user.displayName });
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
  });
});

app.use(authGate);
app.use(express.static(path.join(__dirname, 'public')));

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
    },
  });
});

// ─── Activity log helper ──────────────────────────────────────────────────────
function logActivity(action, detail, who) {
  store.insert('activity_log', { action, detail, who: who || 'Unknown', ts: new Date().toISOString() });
}

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
  const row = store.get('budget_items', req.params.id);
  store.remove('budget_items', req.params.id);
  logActivity('Deleted budget item', `"${row ? row.item : req.params.id}"`, req.body.who || req.query.who || '');
  res.json({ ok: true });
});

// ─── Tasks API ────────────────────────────────────────────────────────────────
app.get('/api/tasks', (req, res) => res.json(store.all('tasks')));

app.post('/api/tasks', (req, res) => {
  const { phase = 'Other', task, owner = '', due_date = '', who = '' } = req.body;
  if (!task) return res.status(400).json({ error: 'Task is required' });
  const row = store.insert('tasks', { phase, task, owner, due_date, done: false });
  logActivity('Added task', `"${task}" in ${phase}`, who);
  res.json(row);
});

app.put('/api/tasks/:id', (req, res) => {
  const { phase, task, done, owner, due_date, who } = req.body;
  const old = store.get('tasks', req.params.id);
  const updated = store.update('tasks', req.params.id, { phase, task, done: !!done, owner, due_date });
  if (!updated) return res.status(404).json({ error: 'Task not found' });
  if (old && !old.done && done) {
    logActivity('Completed task', `"${task}"`, who || '');
  }
  res.json(updated);
});

app.delete('/api/tasks/:id', (req, res) => {
  const row = store.get('tasks', req.params.id);
  store.remove('tasks', req.params.id);
  logActivity('Deleted task', `"${row ? row.task : req.params.id}"`, req.body.who || req.query.who || '');
  res.json({ ok: true });
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
  const row = store.get('leads', req.params.id);
  store.remove('leads', req.params.id);
  logActivity('Deleted lead', `${row ? row.name : req.params.id}`, req.body.who || req.query.who || '');
  res.json({ ok: true });
});

app.get('/api/leads/export.csv', (req, res) => {
  const leads = store.all('leads').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const headers = ['id','name','company','role','email','phone','country','interest',
    'priority','notes','captured_by','follow_up_date','created_at'];
  const csv = [headers.join(',')].concat(
    leads.map(l => headers.map(h => `"${String(l[h] ?? '').replace(/"/g, '""')}"`).join(','))
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="cphi-leads.csv"');
  res.send(csv);
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
  const row = store.get('travelers', req.params.id);
  store.remove('travelers', req.params.id);
  logActivity('Removed traveler', row ? row.name : req.params.id, req.body.who || req.query.who || '');
  res.json({ ok: true });
});

// ─── Activity log API ─────────────────────────────────────────────────────────
app.get('/api/activity', (req, res) => {
  const logs = store.all('activity_log')
    .sort((a, b) => new Date(b.ts) - new Date(a.ts))
    .slice(0, 200);
  res.json(logs);
});

// ─── Error handling ───────────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`CPHI app running on port ${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});
