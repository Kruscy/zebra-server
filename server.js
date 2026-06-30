const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const APK_DIR = '/opt/zebrapp';

function getLatestApk() {
  try {
    const files = fs.readdirSync(APK_DIR)
      .filter(f => /^ZebraPrint-v[\d.]+\.apk$/.test(f));
    if (!files.length) return null;
    files.sort((a, b) => {
      const am = a.match(/v(\d+)\.(\d+)/); const bm = b.match(/v(\d+)\.(\d+)/);
      const [aMaj, aMin] = am ? [+am[1], +am[2]] : [0, 0];
      const [bMaj, bMin] = bm ? [+bm[1], +bm[2]] : [0, 0];
      return (bMaj - aMaj) || (bMin - aMin);
    });
    const filename = files[0];
    const version = (filename.match(/v([\d.]+)\.apk/) || [])[1] || '';
    return { filename, version };
  } catch { return null; }
}

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
  CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    work_start TEXT NOT NULL DEFAULT '07:00',
    work_end TEXT NOT NULL DEFAULT '15:00',
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS time_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_number TEXT NOT NULL,
    worker_name TEXT NOT NULL,
    supplier TEXT NOT NULL DEFAULT '',
    item_count INTEGER NOT NULL DEFAULT 1,
    date TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    active_seconds INTEGER NOT NULL,
    total_seconds INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
`);

// Migrációk
try { db.exec("ALTER TABLE invoices ADD COLUMN supplier TEXT NOT NULL DEFAULT ''"); } catch(_) {}
try { db.exec("ALTER TABLE time_records ADD COLUMN packing_seconds INTEGER NOT NULL DEFAULT 0"); } catch(_) {}
try { db.exec("ALTER TABLE time_records ADD COLUMN problems_seconds INTEGER NOT NULL DEFAULT 0"); } catch(_) {}

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

app.get('/stats', (req, res) => res.sendFile(path.join(__dirname, 'public', 'stats.html')));

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
    const apk = getLatestApk();
    res.json({ ok: true, invoices: c, version: apk ? apk.version : '?' });
  } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
});

// --- APK frissítés ---
app.get('/api/apk-info', (req, res) => {
  const apk = getLatestApk();
  if (!apk) return res.status(404).json({ error: 'Nincs APK' });
  res.json({ version: apk.version, filename: apk.filename, url: `/apk/${apk.filename}` });
});

app.get('/apk/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^ZebraPrint-v[\d.]+\.apk$/.test(filename))
    return res.status(400).json({ error: 'Érvénytelen fájlnév' });
  const filePath = path.join(APK_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Nem található' });
  res.download(filePath, filename);
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

// --- Munkások ---
app.get('/api/workers', (req, res) => {
  res.json(db.prepare('SELECT * FROM workers ORDER BY name').all());
});

app.post('/api/workers', (req, res) => {
  const name = (req.body.name || '').trim();
  const work_start = (req.body.work_start || '07:00').trim();
  const work_end = (req.body.work_end || '15:00').trim();
  if (!name) return res.status(400).json({ error: 'Hiányzó név' });
  try {
    db.prepare('INSERT OR IGNORE INTO workers (name,work_start,work_end) VALUES (?,?,?)').run(name, work_start, work_end);
    const w = db.prepare('SELECT * FROM workers WHERE name=?').get(name);
    res.json({ ok: true, worker: w });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/workers/:id', (req, res) => {
  const { work_start, work_end } = req.body;
  if (!work_start || !work_end) return res.status(400).json({ error: 'Hiányzó munkaidő' });
  db.prepare('UPDATE workers SET work_start=?,work_end=? WHERE id=?').run(work_start, work_end, req.params.id);
  res.json({ ok: true });
});

// --- Időmérés rekordok ---
app.post('/api/time-records', (req, res) => {
  const { invoice_number, worker_name, supplier, item_count, date, started_at, ended_at,
          active_seconds, total_seconds, packing_seconds, problems_seconds } = req.body;
  if (!invoice_number || !worker_name || !date || !started_at || !ended_at)
    return res.status(400).json({ error: 'Hiányzó mezők' });
  try {
    db.prepare(`INSERT INTO time_records
      (invoice_number,worker_name,supplier,item_count,date,started_at,ended_at,
       active_seconds,total_seconds,packing_seconds,problems_seconds)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      invoice_number.trim(), worker_name.trim(), (supplier||'').trim(),
      Math.max(1, parseInt(item_count)||1), date, started_at, ended_at,
      Math.max(0, parseInt(active_seconds)||0), Math.max(0, parseInt(total_seconds)||0),
      Math.max(0, parseInt(packing_seconds)||0), Math.max(0, parseInt(problems_seconds)||0)
    );
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// --- Statisztika ---
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

app.get('/api/stats', requireLogin, (req, res) => {
  const { period = 'day', ref, from, to, worker = '', supplier = '', weekends = '1' } = req.query;
  const showWeekends = weekends !== '0';
  const refDate = ref ? new Date(ref + 'T00:00:00') : new Date();

  let startDate, endDate;
  if (period === 'custom' && from && to) {
    startDate = from; endDate = to;
  } else if (period === 'week') {
    const d = new Date(refDate);
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    startDate = fmtDate(d);
    d.setDate(d.getDate() + 6);
    endDate = fmtDate(d);
  } else if (period === 'month') {
    startDate = `${refDate.getFullYear()}-${String(refDate.getMonth()+1).padStart(2,'0')}-01`;
    endDate = fmtDate(new Date(refDate.getFullYear(), refDate.getMonth()+1, 0));
  } else if (period === 'year') {
    startDate = `${refDate.getFullYear()}-01-01`;
    endDate = `${refDate.getFullYear()}-12-31`;
  } else {
    startDate = endDate = fmtDate(refDate);
  }

  let where = 'WHERE date BETWEEN ? AND ?';
  const params = [startDate, endDate];
  if (worker) { where += ' AND worker_name = ?'; params.push(worker); }
  if (supplier) { where += ' AND supplier = ?'; params.push(supplier); }

  const records = db.prepare(`SELECT * FROM time_records ${where} ORDER BY date,started_at`).all(...params);

  const aggMap = (key) => {
    const m = {};
    records.forEach(r => {
      const k = r[key] || '(nincs)';
      if (!m[k]) m[k] = { invoices:0, items:0, active_seconds:0, packing_seconds:0, problems_seconds:0 };
      m[k].invoices++; m[k].items += r.item_count;
      m[k].active_seconds += r.active_seconds;
      m[k].packing_seconds += (r.packing_seconds||0);
      m[k].problems_seconds += (r.problems_seconds||0);
    });
    return Object.entries(m).map(([k, v]) => ({ [key]: k, ...v,
      avg_per_item: v.items > 0 ? Math.round(v.active_seconds/v.items) : 0 }));
  };

  const byDayMap = {};
  records.forEach(r => {
    if (!byDayMap[r.date]) byDayMap[r.date] = { invoices:0, items:0, active_seconds:0, packing_seconds:0, problems_seconds:0 };
    byDayMap[r.date].invoices++; byDayMap[r.date].items += r.item_count;
    byDayMap[r.date].active_seconds += r.active_seconds;
    byDayMap[r.date].packing_seconds += (r.packing_seconds||0);
    byDayMap[r.date].problems_seconds += (r.problems_seconds||0);
  });

  const byDay = [];
  const cur = new Date(startDate + 'T00:00:00');
  const endD = new Date(endDate + 'T00:00:00');
  while (cur <= endD) {
    const d = fmtDate(cur);
    const dow = cur.getDay();
    const isWeekend = dow === 0 || dow === 6;
    if (showWeekends || !isWeekend) {
      const data = byDayMap[d] || { invoices:0, items:0, active_seconds:0, packing_seconds:0, problems_seconds:0 };
      byDay.push({ date:d, is_weekend:isWeekend, ...data,
        avg_per_item: data.items > 0 ? Math.round(data.active_seconds/data.items) : 0 });
    }
    cur.setDate(cur.getDate()+1);
  }

  const totalItems    = records.reduce((s,r)=>s+r.item_count,0);
  const totalActive   = records.reduce((s,r)=>s+r.active_seconds,0);
  const totalPacking  = records.reduce((s,r)=>s+(r.packing_seconds||0),0);
  const totalProblems = records.reduce((s,r)=>s+(r.problems_seconds||0),0);

  const workers = db.prepare('SELECT name FROM workers ORDER BY name').all().map(w=>w.name);
  const suppliers = db.prepare("SELECT DISTINCT supplier FROM time_records WHERE supplier!='' ORDER BY supplier").all().map(s=>s.supplier);

  res.json({
    period, startDate, endDate,
    summary: {
      invoices: records.length, items: totalItems,
      active_seconds: totalActive, avg_per_item: totalItems>0 ? Math.round(totalActive/totalItems) : 0,
      packing_seconds: totalPacking, problems_seconds: totalProblems
    },
    by_day: byDay,
    by_worker: aggMap('worker_name').map(r=>({ worker:r.worker_name, ...r })),
    by_supplier: aggMap('supplier'),
    records: records.map(r => ({
      date: r.date, started_at: r.started_at, invoice_number: r.invoice_number,
      supplier: r.supplier, worker_name: r.worker_name, item_count: r.item_count,
      active_seconds: r.active_seconds, packing_seconds: r.packing_seconds||0,
      problems_seconds: r.problems_seconds||0,
      avg_per_item: r.item_count > 0 ? Math.round(r.active_seconds / r.item_count) : 0
    })),
    workers, suppliers
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Zebra szerver fut: http://0.0.0.0:${PORT}`);
});
