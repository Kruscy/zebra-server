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
`);

// Régi 'admin' átnevezése zkpzebra-ra (migráció)
db.prepare("UPDATE users SET username = 'zkpzebra' WHERE username = 'admin'").run();

// zkpzebra létrehozása ha még nem létezik
if (!db.prepare('SELECT id FROM users WHERE username = ?').get('zkpzebra')) {
  db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('zkpzebra', bcrypt.hashSync('admin123', 10));
  console.log('Alapértelmezett felhasználó létrehozva: zkpzebra / admin123');
}

app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  );
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'zebra-titkos-kulcs-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, secure: 'auto', sameSite: 'lax' }
}));
app.use(express.static(path.join(__dirname, 'public')));

// SSE kliensek listája
const sseClients = new Set();

function notifyClients() {
  sseClients.forEach(res => {
    try { res.write('data: update\n\n'); } catch (_) {}
  });
}

const requireLogin = (req, res, next) => {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Nincs bejelentkezve' });
};

const STATUSES = ['Nyomtatva', 'Feldolgozás alatt', 'Elpakolható', 'Elpakolva', 'Kiadva'];

// --- Auth ---
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Hibás felhasználónév vagy jelszó' });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (req.session.userId) {
    res.json({ loggedIn: true, username: req.session.username });
  } else {
    res.json({ loggedIn: false });
  }
});

// Jelszóváltás (bejelentkezett)
app.post('/api/change-password', requireLogin, (req, res) => {
  const { current, newPass } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!bcrypt.compareSync(current, user.password)) {
    return res.status(400).json({ error: 'Hibás jelenlegi jelszó' });
  }
  const hash = bcrypt.hashSync(newPass, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// --- Health check (auth nélkül) ---
app.get('/api/health', (req, res) => {
  try {
    const { c } = db.prepare('SELECT COUNT(*) as c FROM invoices').get();
    res.json({ ok: true, invoices: c, version: '1.0' });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// --- SSE endpoint ---
app.get('/api/events', requireLogin, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write('data: connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// --- Számlák ---

// APK: új számla rögzítése
app.post('/api/invoices', (req, res) => {
  const { invoice_number } = req.body;
  if (!invoice_number || !invoice_number.trim()) {
    return res.status(400).json({ error: 'Hiányzó számlaszám' });
  }
  const num = invoice_number.trim();
  try {
    db.prepare('INSERT INTO invoices (invoice_number) VALUES (?)').run(num);
    notifyClients();
    res.json({ ok: true, status: 'Nyomtatva' });
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      const existing = db.prepare('SELECT status FROM invoices WHERE invoice_number = ?').get(num);
      return res.status(409).json({ error: 'Már létezik', status: existing.status });
    }
    res.status(500).json({ error: e.message });
  }
});

// Összes számla listázása (bejelentkezett)
app.get('/api/invoices', requireLogin, (req, res) => {
  const rows = db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all();
  res.json(rows);
});

// APK: státusz lekérdezése (nem kell bejelentkezés)
app.get('/api/invoices/:invoice_number/status', (req, res) => {
  const inv = db.prepare('SELECT invoice_number, status FROM invoices WHERE invoice_number = ?')
    .get(req.params.invoice_number);
  if (!inv) return res.status(404).json({ error: 'Nem található' });
  res.json(inv);
});

// Web: státusz módosítása (bejelentkezett)
app.put('/api/invoices/:id/status', requireLogin, (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Érvénytelen státusz' });
  }
  const result = db.prepare(
    "UPDATE invoices SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?"
  ).run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Nem található' });
  notifyClients();
  res.json({ ok: true });
});

// Web: számla törlése (bejelentkezett)
app.delete('/api/invoices/:id', requireLogin, (req, res) => {
  db.prepare('DELETE FROM invoices WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Zebra szerver fut: http://0.0.0.0:${PORT}`);
  console.log(`Belépés: admin / admin123`);
});
