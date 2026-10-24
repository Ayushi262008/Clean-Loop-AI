require('dotenv').config();
const express = require('express'), Database = require('better-sqlite3'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), fs = require('fs'), path = require('path');
const app = express(), db = new Database('cleanloop.db');
const SECRET = process.env.JWT_SECRET || 'dev-secret', KEY = process.env.ANTHROPIC_API_KEY, MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const CATS = ['Overflowing bin', 'Garbage on road', 'Missed collection', 'Illegal dumping', 'Other'];
fs.mkdirSync('uploads', { recursive: true });
app.use(express.json({ limit: '8mb' })); app.use(express.static('public')); app.use('/uploads', express.static('uploads'));

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, contact TEXT UNIQUE, hash TEXT, role TEXT DEFAULT 'citizen', points INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY, user_id INT, category TEXT, area TEXT, lat REAL, lng REAL, description TEXT, priority TEXT, status TEXT DEFAULT 'Pending', photo TEXT, ai_tip TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS history(id INTEGER PRIMARY KEY, report_id INT, status TEXT, note TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS pickups(id INTEGER PRIMARY KEY, user_id INT, type TEXT, address TEXT, pdate TEXT, status TEXT DEFAULT 'Scheduled', created_at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const ac = process.env.ADMIN_CONTACT || 'admin@cleanloop.ai';
if (!db.prepare('SELECT 1 FROM users WHERE contact=?').get(ac))
  db.prepare("INSERT INTO users(name,contact,hash,role) VALUES('Admin',?,?,'admin')").run(ac, bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10));

// ---------- AI layer (Claude API with rule-based fallback) ----------
async function ai(prompt, imageDataUrl, max = 500) {
  if (!KEY) return null;
  try {
    const content = [];
    const m = imageDataUrl && imageDataUrl.match(/^data:(image\/\w+);base64,(.+)$/);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    content.push({ type: 'text', text: prompt });
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: max, messages: [{ role: 'user', content }] }) });
    const j = await r.json(); return j.content && j.content.map(c => c.text || '').join('');
  } catch (e) { console.error('AI error', e.message); return null; }
}
function rules(d) {
  d = d.toLowerCase(); let category = 'Other', priority = 'Medium';
  if (/overflow|full|dustbin|bin/.test(d)) category = CATS[0]; else if (/road|street|lane/.test(d)) category = CATS[1];
  else if (/missed|not collect|van|nahi aaya/.test(d)) category = CATS[2]; else if (/dump|burn|illegal|debris/.test(d)) category = CATS[3];
  if (/smell|school|hospital|drain|burn|disease|days|medical/.test(d)) priority = 'High';
  return { category, priority, tip: 'Keep wet and dry waste separate until the crew arrives.' };
}
async function triage(desc, photo) {
  const t = await ai(`You triage municipal waste complaints in India. Use the photo if given. Return ONLY JSON {"category": one of ${JSON.stringify(CATS)}, "priority":"High"|"Medium"|"Low" (High for health risk, schools/hospitals, blocked drains, burning, or multi-day delay), "tip": one short citizen safety tip}. Complaint: ${desc}`, photo, 250);
  try { const o = JSON.parse(t.match(/\{[\s\S]*\}/)[0]); if (CATS.includes(o.category)) return o; } catch (e) {}
  return rules(desc);
}

// ---------- auth ----------
const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => { try { req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET); next(); } catch (e) { res.status(401).json({ error: 'Please log in' }); } };
const admin = (req, res, next) => req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin only' });
app.post('/api/auth/register', (req, res) => {
  const { name, contact, password } = req.body || {};
  if (!name || !contact || !password || password.length < 6) return res.status(400).json({ error: 'Name, contact and a 6+ character password are required' });
  if (db.prepare('SELECT 1 FROM users WHERE contact=?').get(contact)) return res.status(409).json({ error: 'This contact is already registered' });
  const id = db.prepare('INSERT INTO users(name,contact,hash) VALUES(?,?,?)').run(name, contact, bcrypt.hashSync(password, 10)).lastInsertRowid;
  const u = { id, role: 'citizen', name }; res.json({ token: sign(u), user: u });
});
app.post('/api/auth/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE contact=?').get((req.body || {}).contact);
  if (!u || !bcrypt.compareSync((req.body || {}).password || '', u.hash)) return res.status(401).json({ error: 'Wrong contact or password' });
  res.json({ token: sign(u), user: { id: u.id, role: u.role, name: u.name, points: u.points } });
});
app.get('/api/me', auth, (req, res) => res.json(db.prepare('SELECT id,name,role,points FROM users WHERE id=?').get(req.user.id)));

// ---------- citizen: reports, tracking, pickups ----------
app.post('/api/reports', auth, async (req, res) => {
  const { area, lat, lng, description, photo } = req.body || {};
  if (!area || !description) return res.status(400).json({ error: 'Area and description are required' });
  const t = await triage(description, photo); let file = null;
  const m = photo && photo.match(/^data:image\/(\w+);base64,(.+)$/);
  if (m) { file = `${Date.now()}.${m[1]}`; fs.writeFileSync(path.join('uploads', file), Buffer.from(m[2], 'base64')); }
  const id = db.prepare('INSERT INTO reports(user_id,category,area,lat,lng,description,priority,photo,ai_tip) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(req.user.id, t.category, area, lat || null, lng || null, description, t.priority, file, t.tip).lastInsertRowid;
  db.prepare('INSERT INTO history(report_id,status,note) VALUES(?,?,?)').run(id, 'Pending', 'Complaint received and triaged by AI');
  db.prepare('UPDATE users SET points=points+10 WHERE id=?').run(req.user.id);
  res.json(db.prepare('SELECT * FROM reports WHERE id=?').get(id));
});
app.get('/api/reports/mine', auth, (req, res) => res.json(db.prepare('SELECT * FROM reports WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.get('/api/reports/:id', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM reports WHERE id=?').get(req.params.id);
  if (!r || (r.user_id !== req.user.id && req.user.role !== 'admin')) return res.status(404).json({ error: 'Complaint not found' });
  r.history = db.prepare('SELECT status,note,at FROM history WHERE report_id=? ORDER BY id').all(r.id); res.json(r);
});
app.post('/api/pickups', auth, (req, res) => {
  const { type, address, pdate } = req.body || {};
  if (!type || !address) return res.status(400).json({ error: 'Type and address are required' });
  db.prepare('INSERT INTO pickups(user_id,type,address,pdate) VALUES(?,?,?,?)').run(req.user.id, type, address, pdate || null); res.json({ ok: true });
});
app.get('/api/pickups/mine', auth, (req, res) => res.json(db.prepare('SELECT * FROM pickups WHERE user_id=? ORDER BY id DESC').all(req.user.id)));
app.get('/api/leaderboard', (req, res) => res.json(db.prepare("SELECT name,points FROM users WHERE role='citizen' ORDER BY points DESC LIMIT 10").all()));

// ---------- awareness ----------
app.post('/api/awareness/ask', async (req, res) => {
  const { q, lang } = req.body || {}; if (!q) return res.status(400).json({ error: 'Ask about an item' });
  const t = await ai(`You are an Indian municipal waste-segregation coach. Reply in ${lang || 'English'} in at most 4 short lines: which bin (wet/dry/hazardous/e-waste/sanitary), how to prepare it, one recycling or safety tip. Item: "${String(q).slice(0, 200)}"`, null, 300);
  res.json({ answer: t || 'Food waste: wet (green). Paper, plastic, metal: dry (blue). Batteries, medicine: hazardous (red). Electronics: e-waste drop point.' });
});

// ---------- admin ----------
app.get('/api/admin/reports', auth, admin, (req, res) => res.json(db.prepare(`SELECT r.*,u.name reporter FROM reports r JOIN users u ON u.id=r.user_id ORDER BY (status='Resolved'), (priority='High') DESC, id DESC`).all()));
app.patch('/api/admin/reports/:id', auth, admin, (req, res) => {
  const { status, note } = req.body || {}; if (!['Pending', 'Assigned', 'Resolved'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE reports SET status=? WHERE id=?').run(status, req.params.id);
  db.prepare('INSERT INTO history(report_id,status,note) VALUES(?,?,?)').run(req.params.id, status, note || `Marked ${status}`);
  if (status === 'Resolved') db.prepare('UPDATE users SET points=points+20 WHERE id=(SELECT user_id FROM reports WHERE id=?)').run(req.params.id);
  res.json({ ok: true });
});
app.get('/api/admin/pickups', auth, admin, (req, res) => res.json(db.prepare('SELECT p.*,u.name FROM pickups p JOIN users u ON u.id=p.user_id ORDER BY p.id DESC').all()));
app.patch('/api/admin/pickups/:id', auth, admin, (req, res) => { db.prepare('UPDATE pickups SET status=? WHERE id=?').run((req.body || {}).status || 'Completed', req.params.id); res.json({ ok: true }); });
const stats = () => ({
  byStatus: db.prepare('SELECT status k,COUNT(*) n FROM reports GROUP BY status').all(),
  byArea: db.prepare("SELECT area k,COUNT(*) n,SUM(priority='High') high,AVG(lat) lat,AVG(lng) lng FROM reports WHERE status!='Resolved' GROUP BY area ORDER BY n DESC").all(),
  byCategory: db.prepare('SELECT category k,COUNT(*) n FROM reports GROUP BY category ORDER BY n DESC').all(),
  trend: db.prepare("SELECT date(created_at) k,COUNT(*) n FROM reports WHERE created_at>=date('now','-14 day') GROUP BY k ORDER BY k").all(),
  avgResolveHours: db.prepare("SELECT ROUND(AVG((julianday(h.at)-julianday(r.created_at))*24),1) v FROM reports r JOIN history h ON h.report_id=r.id AND h.status='Resolved'").get().v });
app.get('/api/admin/stats', auth, admin, (req, res) => res.json(stats()));
app.post('/api/admin/insight', auth, admin, async (req, res) => {
  const s = stats();
  const t = await ai(`You advise a city waste department. Open complaints by area (with high-priority counts), categories and 14-day trend: ${JSON.stringify(s)}. Give: 1) top 2 hotspots and likely cause, 2) crew/route changes this week, 3) one prevention step, 4) a predicted risk area for next week. Max 8 short lines.`, null, 500);
  const top = s.byArea[0];
  res.json({ insight: t || (top ? `Top hotspot: ${top.k} (${top.n} open). Add an extra pickup round and review bin capacity there.` : 'No open complaints. Keep the current schedule.') });
});
app.get('/api/public-stats', (req, res) => res.json({
  total: db.prepare('SELECT COUNT(*) n FROM reports').get().n,
  resolved: db.prepare("SELECT COUNT(*) n FROM reports WHERE status='Resolved'").get().n,
  pending: db.prepare("SELECT COUNT(*) n FROM reports WHERE status!='Resolved'").get().n,
  citizens: db.prepare("SELECT COUNT(*) n FROM users WHERE role='citizen'").get().n }));
app.listen(process.env.PORT || 3000, () => console.log(`Clean Loop AI running on http://localhost:${process.env.PORT || 3000} (AI: ${KEY ? 'Claude' : 'rule-based fallback'})`));
