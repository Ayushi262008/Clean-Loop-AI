require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// SQLite Database Setup (better-sqlite3 with seamless fallback to node:sqlite)
let Database;
try {
  const BS = require('better-sqlite3');
  // Verify native C++ binary is accessible
  const testDb = new BS(':memory:');
  testDb.close();
  Database = BS;
} catch (e) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    Database = function(file) {
      const dbInstance = new DatabaseSync(file);
      if (!dbInstance.transaction) {
        dbInstance.transaction = function(fn) {
          return function(...args) {
            dbInstance.exec('BEGIN TRANSACTION');
            try {
              const res = fn(...args);
              dbInstance.exec('COMMIT');
              return res;
            } catch (err) {
              dbInstance.exec('ROLLBACK');
              throw err;
            }
          };
        };
      }
      return dbInstance;
    };
  } catch (err) {
    console.error('Fatal: SQLite driver unavailable:', err.message);
    process.exit(1);
  }
}

const app = express();
const db = new Database(path.join(__dirname, 'cleanloop.db'));

// ---------------------------------------------------------------------------
// Configuration (single source of truth; fails fast on missing secrets)
// ---------------------------------------------------------------------------
function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error('Fatal: ' + name + ' environment variable is required. Add it to your .env file.'); process.exit(1); }
  return v;
}
const SECRET = requireEnv('JWT_SECRET');
const ADMIN_PASSWORD = requireEnv('ADMIN_PASSWORD');
const ADMIN_CONTACT = (process.env.ADMIN_CONTACT || 'admin@cleanloop.ai').toLowerCase().trim();
const KEY = process.env.ANTHROPIC_API_KEY || null;
const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const REPORT_LIMIT_PER_HOUR = 5;
const DUPLICATE_DISTANCE_DEG = 0.001; // approx 100 m

// Tiny in-memory rate limiter (protects login/register and the paid AI endpoint).
// Skips in-process test requests, which have no req.ip.
const rateHits = new Map();
function limiter(max, windowMs) {
  return (req, res, next) => {
    if (!req.ip) return next();
    const k = req.ip + '|' + req.path;
    const now = Date.now();
    const arr = (rateHits.get(k) || []).filter(t => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    arr.push(now);
    rateHits.set(k, arr);
    next();
  };
}

const PORT = parseInt(process.env.PORT, 10) || 3000;
const CATS = ['Overflowing bin', 'Garbage on road', 'Missed collection', 'Illegal dumping', 'Other'];
const STATUSES = ['Pending', 'Assigned', 'Resolved'];
const PICKUP_STATUSES = ['Scheduled', 'In Transit', 'Completed', 'Cancelled'];

// Middleware configuration
fs.mkdirSync(path.join(__dirname, 'uploads'), { recursive: true });
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ---------------------------------------------------------------------------
// Database Schema & Migrations
// ---------------------------------------------------------------------------
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  contact TEXT UNIQUE NOT NULL COLLATE NOCASE,
  hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'citizen' CHECK(role IN ('citizen', 'admin')),
  points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  area TEXT NOT NULL,
  lat REAL,
  lng REAL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK(priority IN ('High', 'Medium', 'Low')),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Assigned', 'Resolved')),
  photo TEXT,
  ai_tip TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('Pending', 'Assigned', 'Resolved')),
  note TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pickups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  address TEXT NOT NULL,
  pdate TEXT,
  status TEXT NOT NULL DEFAULT 'Scheduled' CHECK(status IN ('Scheduled', 'In Transit', 'Completed', 'Cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
CREATE INDEX IF NOT EXISTS idx_history_report ON history(report_id);
CREATE INDEX IF NOT EXISTS idx_pickups_user ON pickups(user_id);
`);

// ---------------------------------------------------------------------------
// Initial Seeding
// ---------------------------------------------------------------------------
const existingAdmin = db.prepare('SELECT id FROM users WHERE contact = ?').get(ADMIN_CONTACT);
if (!existingAdmin) {
  const adminHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
  db.prepare("INSERT INTO users(name, contact, hash, role) VALUES('EcoTrack Admin', ?, ?, 'admin')")
    .run(ADMIN_CONTACT, adminHash);
}

const countReports = db.prepare('SELECT COUNT(*) n FROM reports').get().n;


// Seed additional realistic demo complaints and pickups if empty
if (countReports === 0) {
  const demoHash = bcrypt.hashSync('demo123', 10);
  // Insert demo users if not already present
  db.prepare("INSERT OR IGNORE INTO users(name, contact, hash, role, points) VALUES('Priya Sharma', 'priya@ecotrack.org', ?, 'citizen', 60)").run(demoHash);
  db.prepare("INSERT OR IGNORE INTO users(name, contact, hash, role, points) VALUES('Rohan Verma', 'rohan@ecotrack.org', ?, 'citizen', 40)").run(demoHash);
  db.prepare("INSERT OR IGNORE INTO users(name, contact, hash, role, points) VALUES('Ananya Gupta', 'ananya@ecotrack.org', ?, 'citizen', 30)").run(demoHash);

  const u1 = db.prepare("SELECT id FROM users WHERE contact = 'priya@ecotrack.org'").get()?.id || 1;
  const u2 = db.prepare("SELECT id FROM users WHERE contact = 'rohan@ecotrack.org'").get()?.id || 1;
  const u3 = db.prepare("SELECT id FROM users WHERE contact = 'ananya@ecotrack.org'").get()?.id || 1;

  // Existing three demo reports (retain original)
  const r1 = db.prepare("INSERT INTO reports(user_id, category, area, lat, lng, description, priority, status, ai_tip) VALUES(?, 'Overflowing bin', 'Central Market, Sector 14', 26.4712, 80.3315, 'Large community bin overflowing on main walkway for 2 days. Bad odor spreading.', 'High', 'Assigned', 'Keep wet food waste in closed bags to prevent animal scavenging.')").run(u1).lastInsertRowid;
  db.prepare("INSERT INTO history(report_id, status, note) VALUES(?, 'Pending', 'Complaint received and triaged as High Priority by AI')").run(r1);
  db.prepare("INSERT INTO history(report_id, status, note) VALUES(?, 'Assigned', 'Dispatched to Ward 14 Sanitation Vehicle #4')").run(r1);

  const r2 = db.prepare("INSERT INTO reports(user_id, category, area, lat, lng, description, priority, status, ai_tip) VALUES(?, 'Garbage on road', 'North Campus Gate 2', 26.4950, 80.3120, 'Plastic bottles and packaging littering the bus stop curb.', 'Medium', 'Pending', 'Segregate plastic bottles in blue bins for recycling.')").run(u2).lastInsertRowid;
  db.prepare("INSERT INTO history(report_id, status, note) VALUES(?, 'Pending', 'Complaint received and triaged by AI')").run(r2);

  const r3 = db.prepare("INSERT INTO reports(user_id, category, area, lat, lng, description, priority, status, ai_tip) VALUES(?, 'Illegal dumping', 'Green Park Riverside Lane', 26.4520, 80.3480, 'Construction rubble dumped overnight along riverside.', 'High', 'Resolved', 'Do not mix construction debris with organic waste.')").run(u1).lastInsertRowid;
  db.prepare("INSERT INTO history(report_id, status, note) VALUES(?, 'Pending', 'Complaint received')").run(r3);
  db.prepare("INSERT INTO history(report_id, status, note) VALUES(?, 'Assigned', 'Excavator team scheduled')").run(r3);
  db.prepare("INSERT INTO history(report_id, status, note) VALUES(?, 'Resolved', 'Site cleared completely and warning signage erected')").run(r3);

  // Additional demo reports (7 more) for a total of 10 complaints
  const extraReports = [
    {user: u2, cat: 'Overflowing bin', area: 'Lakeview Park', lat: 26.4600, lng: 80.3400, desc: 'Bin near lake overflowing with wet waste, attracting flies.', pri: 'High', stat: 'Pending', tip: 'Cover the bin with a lid to reduce odor.'},
    {user: u3, cat: 'Garbage on road', area: 'Main Street', lat: 26.4705, lng: 80.3502, desc: 'Loose garbage bags spilling onto the road after heavy rain.', pri: 'Medium', stat: 'Assigned', tip: 'Secure bags with rope to prevent scattering.'},
    {user: u1, cat: 'Missed collection', area: 'Sector 9', lat: 26.4801, lng: 80.3603, desc: 'Sanitation vehicle missed the scheduled pickup for organic waste.', pri: 'Low', stat: 'Pending', tip: 'Call the local ward office to reschedule.'},
    {user: u2, cat: 'Illegal dumping', area: 'Industrial Zone', lat: 26.4902, lng: 80.3704, desc: 'Unauthorized dumping of chemical drums near the factory entrance.', pri: 'High', stat: 'Assigned', tip: 'Alert hazardous waste team immediately.'},
    {user: u3, cat: 'Overflowing bin', area: 'Community Center', lat: 26.5003, lng: 80.3805, desc: 'Recyclable bin full of paper, no space left.', pri: 'Low', stat: 'Resolved', tip: 'Empty the bin weekly to avoid overflow.'},
    {user: u1, cat: 'Garbage on road', area: 'Riverbank Trail', lat: 26.5104, lng: 80.3906, desc: 'Food waste littered along the trail, attracting rodents.', pri: 'Medium', stat: 'Pending', tip: 'Use portable bins and clean after picnics.'},
    {user: u2, cat: 'Missed collection', area: 'Block A, Greenfield', lat: 26.5205, lng: 80.4007, desc: 'E‑waste bin not emptied for two weeks.', pri: 'High', stat: 'Assigned', tip: 'Schedule a special e‑waste pickup.'}
  ];

  const insertExtra = db.prepare(`
    INSERT INTO reports (user_id, category, area, lat, lng, description, priority, status, ai_tip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertHistory = db.prepare("INSERT INTO history(report_id, status, note) VALUES(?, ?, ?)");

  extraReports.forEach(r => {
    const reportId = insertExtra.run(r.user, r.cat, r.area, r.lat, r.lng, r.desc, r.pri, r.stat, r.tip).lastInsertRowid;
    // Initial history entry based on status
    if (r.stat === 'Pending') {
      insertHistory.run(reportId, 'Pending', 'Complaint received and triaged by AI');
    } else if (r.stat === 'Assigned') {
      insertHistory.run(reportId, 'Pending', 'Complaint received and triaged by AI');
      insertHistory.run(reportId, 'Assigned', 'Dispatched to appropriate crew');
    } else if (r.stat === 'Resolved') {
      insertHistory.run(reportId, 'Pending', 'Complaint received');
      insertHistory.run(reportId, 'Assigned', 'Team assigned');
      insertHistory.run(reportId, 'Resolved', 'Issue resolved by municipal team');
    }
    // Award points for each new complaint
    db.prepare('UPDATE users SET points = points + 10 WHERE id = ?').run(r.user);
  });

  // Backdate demo data across the last ~2 weeks so charts, trends and
  // average-resolution time look realistic instead of "everything happened just now".
  const demoReports = db.prepare('SELECT id, status FROM reports ORDER BY id ASC').all();
  demoReports.forEach((r, i) => {
    const daysAgo = 13 - Math.round((i / Math.max(demoReports.length - 1, 1)) * 12); // 13 .. 1 days ago
    db.prepare("UPDATE reports SET created_at = datetime('now', ?) WHERE id = ?").run('-' + daysAgo + ' day', r.id);
    const hist = db.prepare('SELECT id, status FROM history WHERE report_id = ? ORDER BY id ASC').all(r.id);
    hist.forEach(h => {
      const hoursLater = h.status === 'Pending' ? 0 : h.status === 'Assigned' ? 5 : 30 + (i % 4) * 9;
      db.prepare("UPDATE history SET at = datetime('now', ?, ?) WHERE id = ?").run('-' + daysAgo + ' day', '+' + hoursLater + ' hour', h.id);
    });
  });

  // Seed pickups (retain original two)
  db.prepare("INSERT INTO pickups(user_id, type, address, pdate, status) VALUES(?, '🔌 E-waste & electronics', 'Flat 402, Greenfield Apartments, Sector 14', date('now', '+2 day'), 'Scheduled')").run(u1);
  db.prepare("INSERT INTO pickups(user_id, type, address, pdate, status) VALUES(?, '🌿 Bulk or garden waste', 'House 12, Gulmohar Enclave', date('now', '+1 day'), 'Scheduled')").run(u2);
}

// ---------------------------------------------------------------------------
// Validation Helpers
// ---------------------------------------------------------------------------
function isValidContact(contact) {
  if (typeof contact !== 'string') return false;
  const c = contact.trim();
  // Valid email or 10-15 digit phone
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
  const isPhone = /^\+?[0-9]{10,15}$/.test(c.replace(/[\s-]/g, ''));
  return isEmail || isPhone;
}

function isValidCoords(lat, lng) {
  if (lat === null || lat === undefined || lng === null || lng === undefined) return true;
  const la = parseFloat(lat);
  const ln = parseFloat(lng);
  return !isNaN(la) && !isNaN(ln) && la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

function sanitizeText(str, max = 1000) {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// AI & Fallback Triage Layer
// ---------------------------------------------------------------------------
async function ai(prompt, imageDataUrl, max = 500) {
  if (!KEY) return null;
  try {
    const content = [];
    const m = imageDataUrl && imageDataUrl.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
    if (m) {
      const mediaType = m[1].toLowerCase() === 'jpg' ? 'image/jpeg' : `image/${m[1].toLowerCase()}`;
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: m[2] } });
    }
    content.push({ type: 'text', text: prompt });

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: max,
        messages: [{ role: 'user', content }]
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      console.error('AI HTTP error:', res.status);
      return null;
    }

    const data = await res.json();
    if (data && data.content && Array.isArray(data.content)) {
      return data.content.map(c => c.text || '').join('');
    }
    return null;
  } catch (e) {
    console.error('AI Triage error:', e.message);
    return null;
  }
}

function rules(description) {
  const d = (description || '').toLowerCase();
  let category = 'Other';
  let priority = 'Medium';

  if (/overflow|full|dustbin|bin|kachra peti/.test(d)) category = CATS[0];
  else if (/road|street|lane|curb|sadak|rasta/.test(d)) category = CATS[1];
  else if (/missed|not collect|van|nahi aaya|gadi nahi aayi/.test(d)) category = CATS[2];
  else if (/dump|burn|illegal|debris|malba|jalana/.test(d)) category = CATS[3];

  if (/smell|bad odor|school|hospital|drain|block|burn|smoke|disease|medical|hazard|dead animal|days/.test(d)) {
    priority = 'High';
  } else if (/dry leaf|few papers|small box/.test(d)) {
    priority = 'Low';
  }

  return {
    category,
    priority,
    tip: 'Keep wet and dry waste separate until municipal collection arrives.'
  };
}

async function triage(description, photo) {
  const prompt = `You triage municipal civic waste complaints in India. Use the photo if provided. Return ONLY a single raw JSON object {"category": one of ${JSON.stringify(CATS)}, "priority":"High"|"Medium"|"Low" (High for health risks, schools/hospitals, blocked drains, chemical/e-waste, open burning, or >2 days overflow), "tip": one actionable citizen safety tip}. Complaint: "${sanitizeText(description, 500)}"`;
  
  const rawAI = await ai(prompt, photo, 250);
  if (rawAI) {
    try {
      const match = rawAI.match(/\{[\s\S]*?\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (CATS.includes(parsed.category) && ['High', 'Medium', 'Low'].includes(parsed.priority)) {
          return {
            category: parsed.category,
            priority: parsed.priority,
            tip: sanitizeText(parsed.tip || 'Keep wet and dry waste segregated.', 160)
          };
        }
      }
    } catch (e) {}
  }

  return rules(description);
}

// ---------------------------------------------------------------------------
// Authentication & Authorization Middlewares
// ---------------------------------------------------------------------------
const signToken = u => jwt.sign(
  { id: u.id, role: u.role, name: u.name, contact: u.contact },
  SECRET,
  { expiresIn: '7d' }
);

function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Please log in.' });
    }
    const tokenStr = authHeader.slice(7).trim();
    const decoded = jwt.verify(tokenStr, SECRET);

    // Verify user still exists in database
    const user = db.prepare('SELECT id, name, contact, role, points FROM users WHERE id = ?').get(decoded.id);
    if (!user) {
      return res.status(401).json({ error: 'User account no longer exists. Please re-authenticate.' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired authentication token. Please log in again.' });
  }
}

function admin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Access denied. Administrator privileges required.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Auth Endpoints
// ---------------------------------------------------------------------------
app.post('/api/auth/register', limiter(10, 60 * 1000), (req, res) => {
  try {
    let { name, contact, password } = req.body || {};
    name = sanitizeText(name, 60);
    contact = (contact || '').trim().toLowerCase();

    if (!name || name.length < 2) {
      return res.status(400).json({ error: 'Full name is required (minimum 2 characters).' });
    }
    if (!contact || !isValidContact(contact)) {
      return res.status(400).json({ error: 'Valid email address or 10-digit mobile number is required.' });
    }
    if (!password || typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE contact = ?').get(contact);
    if (existing) {
      return res.status(409).json({ error: 'This contact is already registered. Please sign in instead.' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare("INSERT INTO users(name, contact, hash, role, points) VALUES(?, ?, ?, 'citizen', 0)")
      .run(name, contact, hash);

    const newUser = { id: result.lastInsertRowid, name, contact, role: 'citizen', points: 0 };
    return res.status(201).json({
      token: signToken(newUser),
      user: newUser
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to complete registration: ' + err.message });
  }
});

app.post('/api/auth/login', limiter(10, 60 * 1000), (req, res) => {
  try {
    let { contact, password } = req.body || {};
    contact = (contact || '').trim().toLowerCase();
    password = password || '';

    if (!contact || !password) {
      return res.status(400).json({ error: 'Contact and password are required.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE contact = ?').get(contact);
    if (!user || !bcrypt.compareSync(password, user.hash)) {
      return res.status(401).json({ error: 'Invalid contact details or password.' });
    }

    const safeUser = {
      id: user.id,
      name: user.name,
      contact: user.contact,
      role: user.role,
      points: user.points
    };

    return res.json({
      token: signToken(safeUser),
      user: safeUser
    });
  } catch (err) {
    return res.status(500).json({ error: 'Login service failed: ' + err.message });
  }
});

app.get('/api/me', auth, (req, res) => {
  return res.json({
    id: req.user.id,
    name: req.user.name,
    contact: req.user.contact,
    role: req.user.role,
    points: req.user.points
  });
});

// ---------------------------------------------------------------------------
// Public Information & Leaderboard
// ---------------------------------------------------------------------------
app.get('/api/public-stats', (req, res) => {
  try {
    const total = db.prepare('SELECT COUNT(*) n FROM reports').get().n;
    const resolved = db.prepare("SELECT COUNT(*) n FROM reports WHERE status = 'Resolved'").get().n;
    const pending = db.prepare("SELECT COUNT(*) n FROM reports WHERE status != 'Resolved'").get().n;
    const citizens = db.prepare("SELECT COUNT(*) n FROM users WHERE role = 'citizen'").get().n;
    const totalPoints = db.prepare("SELECT COALESCE(SUM(points), 0) n FROM users WHERE role = 'citizen'").get().n;

    return res.json({ total, resolved, pending, citizens, totalPoints });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to aggregate public statistics.' });
  }
});

app.get('/api/leaderboard', (req, res) => {
  try {
    const rows = db.prepare("SELECT id, name, points FROM users WHERE role = 'citizen' ORDER BY points DESC, id ASC LIMIT 10").all();
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch leaderboard.' });
  }
});

app.post('/api/awareness/ask', limiter(10, 60 * 1000), async (req, res) => {
  try {
    const { q, lang } = req.body || {};
    const query = sanitizeText(q, 200);
    if (!query) {
      return res.status(400).json({ error: 'Please enter a waste item or question.' });
    }

    const language = sanitizeText(lang || 'English', 30);
    const prompt = `You are an Indian municipal waste-segregation coach. Reply in ${language} in at most 4 short bullet lines: 1) exact bin color (Green/Wet, Blue/Dry, Red/Hazardous, Gray/E-waste), 2) how to clean/prepare it, 3) key recycling or sanitary safety advice. Item: "${query}"`;
    
    const answer = await ai(prompt, null, 300);
    return res.json({
      answer: answer || 'Food waste goes to Green (Wet). Plastic, paper & metal go to Blue (Dry). Batteries, chemicals & medicine go to Red (Hazardous). Broken electronics go to Gray/E-waste.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Segregation coach unavailable.' });
  }
});

// ---------------------------------------------------------------------------
// Complaint Management (Citizen)
// ---------------------------------------------------------------------------
app.post('/api/reports', auth, async (req, res) => {
  try {
    let { area, description, photo, lat, lng } = req.body || {};
    area = sanitizeText(area, 100);
    description = sanitizeText(description, 1000);

    if (!area || area.length < 2) {
      return res.status(400).json({ error: 'Area or location name is required (minimum 2 characters).' });
    }
    if (!description || description.length < 5) {
      return res.status(400).json({ error: 'Please describe the waste problem in at least 5 characters.' });
    }
    if (!isValidCoords(lat, lng)) {
      return res.status(400).json({ error: 'Coordinates provided are invalid.' });
    }
    // Rate limiting: max 5 reports per hour per user
    const recentCount = db.prepare('SELECT COUNT(*) n FROM reports WHERE user_id = ? AND created_at >= datetime(\'now\', \'-1 hour\')').get(req.user.id).n;
    if (recentCount >= REPORT_LIMIT_PER_HOUR) {
      return res.status(429).json({ error: 'Rate limit exceeded – you may submit up to 5 complaints per hour.' });
    }
    // Duplicate check: same user, unresolved report within ~100 m in the last 24 h
    const dupLat = parseFloat(lat), dupLng = parseFloat(lng);
    if (Number.isFinite(dupLat) && Number.isFinite(dupLng)) {
      const duplicate = db.prepare(`
        SELECT id FROM reports
        WHERE user_id = ? AND status != 'Resolved'
          AND lat IS NOT NULL AND lng IS NOT NULL
          AND ABS(lat - ?) < ? AND ABS(lng - ?) < ?
          AND created_at >= datetime('now', '-1 day')
        LIMIT 1`
      ).get(req.user.id, dupLat, DUPLICATE_DISTANCE_DEG, dupLng, DUPLICATE_DISTANCE_DEG);
      if (duplicate) {
        return res.status(409).json({ error: 'You already reported an open issue at this spot in the last 24 hours (report #' + duplicate.id + ').', existingReportId: duplicate.id });
      }
    }

    // AI classification & priority triage
    const t = await triage(description, photo);

    // Secure photo persistence
    let filename = null;
    if (photo && typeof photo === 'string') {
      const match = photo.match(/^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/i);
      if (match) {
        const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
        filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const buffer = Buffer.from(match[2], 'base64');
        if (buffer.length <= 8 * 1024 * 1024) { // Max 8MB
          fs.writeFileSync(path.join(__dirname, 'uploads', filename), buffer);
        } else {
          filename = null;
        }
      }
    }

    const latitude = (lat !== null && lat !== undefined && !isNaN(parseFloat(lat))) ? parseFloat(lat) : null;
    const longitude = (lng !== null && lng !== undefined && !isNaN(parseFloat(lng))) ? parseFloat(lng) : null;

    // Database insertion wrapped in transaction
    const insertReport = db.transaction(() => {
      const reportRes = db.prepare(`
        INSERT INTO reports (user_id, category, area, lat, lng, description, priority, status, photo, ai_tip)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?)
      `).run(req.user.id, t.category, area, latitude, longitude, description, t.priority, filename, t.tip);

      const reportId = reportRes.lastInsertRowid;

      db.prepare(`
        INSERT INTO history (report_id, status, note)
        VALUES (?, 'Pending', 'Complaint received and triaged by AI')
      `).run(reportId);

      // Award +10 points to citizen
      db.prepare('UPDATE users SET points = points + 10 WHERE id = ?').run(req.user.id);

      return reportId;
    });

    const newId = insertReport();
    const created = db.prepare('SELECT * FROM reports WHERE id = ?').get(newId);
    created.history = db.prepare('SELECT status, note, at FROM history WHERE report_id = ? ORDER BY id ASC').all(newId);

    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to file waste complaint: ' + err.message });
  }
});

// Community reports feed
app.get('/api/reports/recent', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT r.id, r.category, r.area, r.priority, r.status, r.photo, r.description, r.ai_tip, r.created_at, u.name as reporter 
      FROM reports r 
      LEFT JOIN users u ON u.id = r.user_id 
      ORDER BY r.id DESC 
      LIMIT 6
    `).all();
    return res.json(rows);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch recent reports.' });
  }
});

// User's own complaints with complete audit timeline
app.get('/api/reports/mine', auth, (req, res) => {
  try {
    const reports = db.prepare('SELECT * FROM reports WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    for (const r of reports) {
      r.history = db.prepare('SELECT status, note, at FROM history WHERE report_id = ? ORDER BY id ASC').all(r.id);
    }
    return res.json(reports);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to retrieve your complaints.' });
  }
});

// Specific complaint detail with strict ownership verification
app.get('/api/reports/:id', auth, (req, res) => {
  try {
    const reportId = parseInt(req.params.id, 10);
    if (!reportId || isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid complaint ID parameter.' });
    }

    const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!r) {
      return res.status(404).json({ error: 'Complaint ticket not found.' });
    }

    // Enforce ownership: only the reporter or an administrator can view
    if (r.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden: You do not have permission to view this complaint.' });
    }

    r.history = db.prepare('SELECT status, note, at FROM history WHERE report_id = ? ORDER BY id ASC').all(r.id);
    return res.json(r);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load complaint details.' });
  }
});

// ---------------------------------------------------------------------------
// Doorstep Pickup Management (Citizen)
// ---------------------------------------------------------------------------
app.post('/api/pickups', auth, (req, res) => {
  try {
    let { type, address, pdate } = req.body || {};
    type = sanitizeText(type, 80);
    address = sanitizeText(address, 200);
    pdate = pdate ? sanitizeText(pdate, 20) : null;

    if (!type || type.length < 3) {
      return res.status(400).json({ error: 'Please choose a valid waste pickup category.' });
    }
    if (!address || address.length < 5) {
      return res.status(400).json({ error: 'Pickup street address is required (minimum 5 characters).' });
    }

    const result = db.prepare('INSERT INTO pickups (user_id, type, address, pdate, status) VALUES (?, ?, ?, ?, ?)')
      .run(req.user.id, type, address, pdate, 'Scheduled');

    const created = db.prepare('SELECT * FROM pickups WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json(created);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to schedule pickup: ' + err.message });
  }
});

app.get('/api/pickups/mine', auth, (req, res) => {
  try {
    const list = db.prepare('SELECT * FROM pickups WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch your pickup requests.' });
  }
});

// ---------------------------------------------------------------------------
// Administrative Operations (Admin Only)
// ---------------------------------------------------------------------------

// Waste Hotspot Analytics Endpoint (Grouped by real location data)
app.get('/api/admin/hotspots', auth, admin, (req, res) => {
  try {
    const { timeRange = 'all', priority = 'all', status = 'all', category = 'all' } = req.query || {};

    const validTimeRanges = ['all', '7d', '30d', '90d'];
    const validPriorities = ['all', 'High', 'Medium', 'Low'];
    const validStatuses = ['all', 'unresolved', 'Pending', 'Assigned', 'Resolved'];
    const validCategories = ['all', ...CATS];

    if (!validTimeRanges.includes(timeRange)) {
      return res.status(400).json({ error: `Invalid timeRange filter. Allowed: ${validTimeRanges.join(', ')}` });
    }
    if (!validPriorities.includes(priority)) {
      return res.status(400).json({ error: `Invalid priority filter. Allowed: ${validPriorities.join(', ')}` });
    }
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status filter. Allowed: ${validStatuses.join(', ')}` });
    }
    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: `Invalid category filter. Allowed: ${validCategories.join(', ')}` });
    }

    const whereClauses = [];
    const params = [];

    if (timeRange === '7d') {
      whereClauses.push("created_at >= date('now', '-7 day')");
    } else if (timeRange === '30d') {
      whereClauses.push("created_at >= date('now', '-30 day')");
    } else if (timeRange === '90d') {
      whereClauses.push("created_at >= date('now', '-90 day')");
    }

    if (priority !== 'all') {
      whereClauses.push("priority = ?");
      params.push(priority);
    }

    if (status === 'unresolved') {
      whereClauses.push("status != 'Resolved'");
    } else if (status !== 'all') {
      whereClauses.push("status = ?");
      params.push(status);
    }

    if (category !== 'all') {
      whereClauses.push("category = ?");
      params.push(category);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const hotspotQuery = `
      SELECT 
        area,
        COUNT(*) as totalReports,
        SUM(status != 'Resolved') as unresolvedReports,
        SUM(status = 'Resolved') as resolvedReports,
        SUM(priority = 'High') as highPriorityCount,
        SUM(priority = 'Medium') as mediumPriorityCount,
        SUM(priority = 'Low') as lowPriorityCount,
        SUM(lat IS NOT NULL AND lng IS NOT NULL) as geocodedCount,
        AVG(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN lat ELSE NULL END) as avgLat,
        AVG(CASE WHEN lat IS NOT NULL AND lng IS NOT NULL THEN lng ELSE NULL END) as avgLng,
        MAX(created_at) as latestReportAt,
        (SUM(status != 'Resolved') * 3 + SUM(priority = 'High') * 4 + SUM(priority = 'Medium') * 1) as urgencyScore
      FROM reports
      ${whereSql}
      GROUP BY area
      ORDER BY urgencyScore DESC, unresolvedReports DESC, totalReports DESC
    `;

    const areaRows = db.prepare(hotspotQuery).all(...params);

    const hotspots = areaRows.map(row => {
      // Find the top waste category reported in this area
      const catRow = db.prepare(`
        SELECT category, COUNT(*) as c 
        FROM reports 
        WHERE area = ? ${whereSql ? 'AND ' + whereClauses.join(' AND ') : ''} 
        GROUP BY category 
        ORDER BY c DESC 
        LIMIT 1
      `).get(row.area, ...params);

      const hasCoords = row.geocodedCount > 0 && row.avgLat !== null && row.avgLng !== null;

      return {
        area: row.area,
        totalReports: row.totalReports,
        unresolvedReports: row.unresolvedReports,
        resolvedReports: row.resolvedReports,
        highPriorityCount: row.highPriorityCount,
        mediumPriorityCount: row.mediumPriorityCount,
        lowPriorityCount: row.lowPriorityCount,
        urgencyScore: row.urgencyScore,
        topCategory: catRow ? catRow.category : 'N/A',
        hasCoordinates: Boolean(hasCoords),
        latitude: hasCoords ? parseFloat(row.avgLat.toFixed(5)) : null,
        longitude: hasCoords ? parseFloat(row.avgLng.toFixed(5)) : null,
        latestReportAt: row.latestReportAt
      };
    });

    const summary = {
      totalAreas: hotspots.length,
      totalReports: hotspots.reduce((acc, h) => acc + h.totalReports, 0),
      totalUnresolved: hotspots.reduce((acc, h) => acc + h.unresolvedReports, 0),
      criticalAreasCount: hotspots.filter(h => h.highPriorityCount > 0 && h.unresolvedReports > 0).length,
      geocodedAreasCount: hotspots.filter(h => h.hasCoordinates).length,
      highestPriorityArea: hotspots.length > 0 ? hotspots[0].area : null
    };

    return res.json({
      filters: { timeRange, priority, status, category },
      summary,
      hotspots
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute waste hotspot analytics: ' + err.message });
  }
});

app.get('/api/admin/reports', auth, admin, (req, res) => {
  try {
    const list = db.prepare(`
      SELECT r.*, u.name as reporter, u.contact as reporter_contact 
      FROM reports r 
      JOIN users u ON u.id = r.user_id 
      ORDER BY (r.status = 'Resolved') ASC, (r.priority = 'High') DESC, r.id DESC
    `).all();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch admin complaint queue.' });
  }
});

app.patch('/api/admin/reports/:id', auth, admin, (req, res) => {
  try {
    const reportId = parseInt(req.params.id, 10);
    if (!reportId || isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid complaint ID parameter.' });
    }

    const { status, note } = req.body || {};
    if (!status || !STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${STATUSES.join(', ')}` });
    }

    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    if (!report) {
      return res.status(404).json({ error: 'Complaint ticket not found.' });
    }

    const cleanNote = sanitizeText(note || `Marked ${status} by municipal administrator`, 200);

    // Transactional status update and eco points award
    const updateTx = db.transaction(() => {
      db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, reportId);
      db.prepare('INSERT INTO history (report_id, status, note) VALUES (?, ?, ?)').run(reportId, status, cleanNote);

      // Award +20 points ONLY once when first transitioning to Resolved
      if (status === 'Resolved' && report.status !== 'Resolved') {
        db.prepare('UPDATE users SET points = points + 20 WHERE id = ?').run(report.user_id);
      }
    });

    updateTx();

    const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(reportId);
    updated.history = db.prepare('SELECT status, note, at FROM history WHERE report_id = ? ORDER BY id ASC').all(reportId);

    return res.json({ ok: true, report: updated });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update complaint status: ' + err.message });
  }
});

app.get('/api/admin/pickups', auth, admin, (req, res) => {
  try {
    const list = db.prepare(`
      SELECT p.*, u.name, u.contact 
      FROM pickups p 
      JOIN users u ON u.id = p.user_id 
      ORDER BY (p.status = 'Completed') ASC, p.id DESC
    `).all();
    return res.json(list);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch pickup requests.' });
  }
});

app.patch('/api/admin/pickups/:id', auth, admin, (req, res) => {
  try {
    const pickupId = parseInt(req.params.id, 10);
    if (!pickupId || isNaN(pickupId)) {
      return res.status(400).json({ error: 'Invalid pickup ID parameter.' });
    }

    const { status } = req.body || {};
    const newStatus = status || 'Completed';
    if (!PICKUP_STATUSES.includes(newStatus)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${PICKUP_STATUSES.join(', ')}` });
    }

    const pickup = db.prepare('SELECT * FROM pickups WHERE id = ?').get(pickupId);
    if (!pickup) {
      return res.status(404).json({ error: 'Pickup request not found.' });
    }

    db.prepare('UPDATE pickups SET status = ? WHERE id = ?').run(newStatus, pickupId);
    const updated = db.prepare('SELECT * FROM pickups WHERE id = ?').get(pickupId);

    return res.json({ ok: true, pickup: updated });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update pickup status.' });
  }
});

function getStats() {
  const byStatus = db.prepare('SELECT status as k, COUNT(*) as n FROM reports GROUP BY status').all();
  const byArea = db.prepare(`
    SELECT area as k, COUNT(*) as n, SUM(priority = 'High') as high, AVG(lat) as lat, AVG(lng) as lng 
    FROM reports 
    WHERE status != 'Resolved' 
    GROUP BY area 
    ORDER BY n DESC
  `).all();
  const byCategory = db.prepare('SELECT category as k, COUNT(*) as n FROM reports GROUP BY category ORDER BY n DESC').all();
  const trend = db.prepare(`
    SELECT date(created_at) as k, COUNT(*) as n 
    FROM reports 
    WHERE created_at >= date('now', '-14 day') 
    GROUP BY k 
    ORDER BY k ASC
  `).all();
  
  const avgResolve = db.prepare(`
    SELECT ROUND(AVG((julianday(h.at) - julianday(r.created_at)) * 24), 1) as v 
    FROM reports r 
    JOIN history h ON h.report_id = r.id AND h.status = 'Resolved'
  `).get()?.v || 0;

  return { byStatus, byArea, byCategory, trend, avgResolveHours: avgResolve };
}

app.get('/api/admin/stats', auth, admin, (req, res) => {
  try {
    return res.json(getStats());
  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute administrative statistics.' });
  }
});

app.post('/api/admin/insight', auth, admin, limiter(6, 60 * 1000), async (req, res) => {
  try {
    const s = getStats();
    const prompt = `You are a municipal waste logistics strategist in India. Analyze the following live municipal complaint statistics: ${JSON.stringify(s)}. Provide: 1) Top 2 identified hotspots and root cause, 2) Recommended truck crew redistribution this week, 3) One community prevention initiative, 4) Risk prediction for next week. Output at most 8 concise bullet lines.`;
    
    const insightText = await ai(prompt, null, 500);
    const top = s.byArea[0];
    const fallbackInsight = top
      ? `Top hotspot: ${top.k} (${top.n} open issues). Action: Deploy additional collection vehicle and increase bin capacity.`
      : 'All reported civic areas are within capacity. Maintain current route frequency.';

    return res.json({ insight: insightText || fallbackInsight });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to generate AI action plan.' });
  }
});

// ---------------------------------------------------------------------------
// Error & 404 Handlers
// ---------------------------------------------------------------------------
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `API route '${req.originalUrl}' does not exist.` });
});

// Global error handler
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Upload too large. Please use a smaller photo.' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON in request body.' });
  console.error('Unhandled server error:', err);
  res.status(500).json({ error: 'An unexpected server error occurred.' });
});

// Start server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`EcoTrack Backend running on http://localhost:${PORT} (AI: ${KEY ? 'Claude API' : 'Rule-based fallback'})`);
  });
}

module.exports = { app, db };
