const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const db = new Database(path.join(__dirname, 'zebra.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT UNIQUE NOT NULL,
    status TEXT NOT NULL DEFAULT 'Nyomtatva',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    image TEXT NOT NULL DEFAULT '',
    display_mode TEXT NOT NULL DEFAULT 'text'
  );
`);

// Migrációk
try { db.exec("ALTER TABLE invoices ADD COLUMN supplier TEXT NOT NULL DEFAULT ''"); } catch(_) {}

// Régi 'admin' átnevezése zkpzebra-ra
db.prepare("UPDATE users SET username = 'zkpzebra' WHERE username = 'admin'").run();

if (!db.prepare('SELECT id FROM users WHERE username = ?').get('zkpzebra')) {
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('zkpzebra', bcrypt.hashSync('admin123', 10));
  console.log('Alapértelmezett felhasználó létrehozva: zkpzebra / admin123');
}

app.set('trust proxy', 1);

// Bejelentkezési kísérlet-korlátozás (max 10 / 15 perc / IP)
const _loginAttempts = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  let e = _loginAttempts.get(ip);
  if (!e || now > e.resetAt) e = { count: 0, resetAt: now + 15 * 60 * 1000 };
  e.count++;
  _loginAttempts.set(ip, e);
  if (e.count > 10) return res.status(429).json({ error: 'Túl sok bejelentkezési kísérlet. Várj 15 percet.' });
  next();
}
// Sikeres login után számlálót nulláz
function resetLoginAttempts(ip) { _loginAttempts.delete(ip); }

// Session secret figyelmeztetés
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET env változó nincs beállítva! Állítsd be: export SESSION_SECRET=<véletlen hosszú szöveg>');
}

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"
  );
  next();
});

app.use(express.json({ limit: '3mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, secure: 'auto', sameSite: 'lax' }
}));
app.use(express.static(path.join(__dirname, 'public')));

const sseClients = new Set();
function notifyClients() {
  sseClients.forEach(r => { try { r.write('data: update\n\n'); } catch(_) {} });
}

const requireLogin = (req, res, next) => {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Nincs bejelentkezve' });
};

const STATUSES = ['Nyomtatva', 'Feldolgozás alatt', 'Elpakolható', 'Elpakolva', 'Kiadva'];
const DISPLAY_MODES = ['text', 'both', 'image'];

// --- Auth ---
app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó' });
  resetLoginAttempts(req.ip);
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Session hiba' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ ok: true, username: user.username });
  });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  if (req.session.userId) res.json({ loggedIn: true, username: req.session.username });
  else res.json({ loggedIn: false });
});

app.post('/api/change-password', requireLogin, (req, res) => {
  const { current, newPass } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current, user.password))
    return res.status(400).json({ error: 'Hibás jelenlegi jelszó' });
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(bcrypt.hashSync(newPass, 10), user.id);
  res.json({ ok: true });
});

// --- Health ---
app.get('/api/health', (req, res) => {
  try {
    const { c } = db.prepare('SELECT COUNT(*) as c FROM invoices').get();
    res.json({ ok: true, invoices: c, version: '1.0' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- SSE ---
app.get('/api/events', requireLogin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// --- Szállítók ---
app.get('/api/suppliers', (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers ORDER BY name').all());
});

// APK is hívhatja (csak nevet küld)
app.post('/api/suppliers', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Hiányzó név' });
  try {
    db.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(name);
    const s = db.prepare('SELECT id FROM suppliers WHERE name=?').get(name);
    notifyClients();
    res.json({ ok: true, id: s.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/suppliers/:id', requireLogin, (req, res) => {
  const { name, image, display_mode } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Hiányzó név' });
  if (image && Buffer.byteLength(image, 'utf8') > 400 * 1024)
    return res.status(400).json({ error: 'A kép mérete maximum 300 KB lehet' });
  const dm = DISPLAY_MODES.includes(display_mode) ? display_mode : 'text';
  try {
    db.prepare('UPDATE suppliers SET name=?,image=?,display_mode=? WHERE id=?')
      .run(name.trim(), image || '', dm, req.params.id);
    notifyClients();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/suppliers/:id', requireLogin, (req, res) => {
  db.prepare('DELETE FROM suppliers WHERE id=?').run(req.params.id);
  notifyClients();
  res.json({ ok: true });
});

// --- Számlák ---
app.post('/api/invoices', (req, res) => {
  const { invoice_number, supplier } = req.body;
  if (!invoice_number || !invoice_number.trim())
    return res.status(400).json({ error: 'Hiányzó számlaszám' });
  const num = invoice_number.trim();
  const sup = (supplier || '').trim();
  try {
    db.prepare('INSERT INTO invoices (invoice_number, supplier) VALUES (?, ?)').run(num, sup);
    notifyClients();
    res.json({ ok: true, status: 'Nyomtatva' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) {
      const existing = db.prepare('SELECT status FROM invoices WHERE invoice_number = ?').get(num);
      return res.status(409).json({ error: 'Már létezik', status: existing.status });
    }
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/invoices', requireLogin, (req, res) => {
  res.json(db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all());
});

app.get('/api/invoices/:invoice_number/status', (req, res) => {
  const inv = db.prepare('SELECT invoice_number, status FROM invoices WHERE invoice_number = ?')
    .get(req.params.invoice_number);
  if (!inv) return res.status(404).json({ error: 'Nem található' });
  res.json(inv);
});

app.put('/api/invoices/:id/status', requireLogin, (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Érvénytelen státusz' });
  const result = db.prepare(
    "UPDATE invoices SET status=?, updated_at=datetime('now','localtime') WHERE id=?"
  ).run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Nem található' });
  notifyClients();
  res.json({ ok: true });
});

app.delete('/api/invoices/:id', requireLogin, (req, res) => {
  db.prepare('DELETE FROM invoices WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Zebra szerver fut: http://0.0.0.0:${PORT}`);
});
