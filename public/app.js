const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let token = localStorage.getItem('cl_token'), me = JSON.parse(localStorage.getItem('cl_user') || 'null'), tab = 'home', map, cyc, adminData = [], filt = 'All';
let wiz = { step: 1, area: '', chip: '', desc: '', photo: null, pos: null }, g = null;
document.documentElement.dataset.theme = localStorage.getItem('cl_theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j;
}
const toast = m => { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t.h); t.h = setTimeout(() => t.style.display = 'none', 3000); };
const setAuth = d => { token = d.token; me = d.user; localStorage.setItem('cl_token', token); localStorage.setItem('cl_user', JSON.stringify(me)); toast('Welcome, ' + me.name); render(); };
const logout = () => { localStorage.removeItem('cl_token'); localStorage.removeItem('cl_user'); token = me = null; tab = 'home'; render(); };
const fmt = d => new Date(d.replace(' ', 'T') + 'Z').toLocaleString();
const confetti = () => { for (let i = 0; i < 36; i++) { const s = document.createElement('i'); s.className = 'cf'; s.style.cssText = `left:50%;top:40%;background:${['#12a594', '#ffc531', '#e5484d', '#2b7de9'][i % 4]};--x:${(Math.random() - .5) * 600}px;--y:${Math.random() * 420 - 100}px`; document.body.append(s); setTimeout(() => s.remove(), 1200); } };
const countUp = (el, n) => { let v = 0; const st = Math.max(1, Math.ceil(n / 30)); const t = setInterval(() => { v = Math.min(n, v + st); el.textContent = v; if (v >= n) clearInterval(t); }, 25); };
const bars = a => { const m = Math.max(1, ...a.map(x => x.n)); return a.map(x => `<div style="margin:8px 0"><span class="mu">${esc(x.k)} (${x.n})</span><div class="bar" style="width:${x.n / m * 100}%"></div></div>`).join('') || '<p class="mu">No data yet.</p>'; };
const gate = () => `<div class="card" style="max-width:560px;margin:auto"><h2>Join the loop</h2><p class="mu">Log in to report, track and earn eco points.</p><label>Name (new users)</label><input id="n"><label>Mobile or email</label><input id="c"><label>Password (6+ characters)</label><input id="p" type="password"><button class="btn" id="li">Log in</button> <button class="btn ghost" id="rg">Create account</button></div>`;

const LOOP = [['📣', 'Report', 'Snap a photo or speak the problem in Hindi or English. Your location attaches in one tap.'], ['🧠', 'AI triage', 'AI reads the photo and text, picks the category and decides how urgent it is.'], ['🚛', 'Resolve', 'Admins get a priority queue and hotspot map, assign crews and close the complaint.'], ['🌱', 'Learn', 'Citizens get segregation coaching and eco points, so the same problem comes back less.']];
const loopSVG = () => `<svg class="loop" viewBox="0 0 320 320"><circle class="ring" cx="160" cy="160" r="112"/><circle class="draw" cx="160" cy="160" r="112" fill="none" stroke="var(--ink)" stroke-width="2" opacity=".25"/>${LOOP.map((l, i) => { const a = (i * 90 - 90) * Math.PI / 180; return `<g class="nd" data-i="${i}" tabindex="0" role="button" aria-label="${l[1]}"><circle cx="${160 + 112 * Math.cos(a)}" cy="${160 + 112 * Math.sin(a)}" r="30"/><text x="${160 + 112 * Math.cos(a)}" y="${160 + 112 * Math.sin(a)}">${l[0]}</text></g>`; }).join('')}<text class="ct" x="160" y="160" id="lc">Report</text></svg>`;
function setLoop(i) { $$('.nd').forEach(n => n.classList.toggle('on', +n.dataset.i === i)); $('#lc').textContent = LOOP[i][1]; $('#ld').textContent = LOOP[i][2]; }
const CHIPS = ['Overflowing bin', 'Garbage on road', 'Missed collection', 'Illegal dumping'], PT = ['🏠 Household dry waste', '🍌 Wet or kitchen waste', '🌿 Bulk or garden waste', '🔌 E-waste', '🧱 Construction debris'];
const BINS = [{ k: 'wet', n: 'Wet', c: '#2faa5f' }, { k: 'dry', n: 'Dry', c: '#2b7de9' }, { k: 'haz', n: 'Hazardous', c: '#e5484d' }, { k: 'e', n: 'E-waste', c: '#6b7280' }];
const ITEMS = [['🍌', 'Banana peel', 'wet'], ['📰', 'Newspaper', 'dry'], ['🔋', 'Used battery', 'haz'], ['🥤', 'Plastic bottle', 'dry'], ['📱', 'Old phone', 'e'], ['💊', 'Expired medicine', 'haz'], ['🥬', 'Veg scraps', 'wet'], ['🔌', 'Broken charger', 'e']];
const newGame = () => g = { items: [...ITEMS].sort(() => Math.random() - .5), idx: 0, score: 0, streak: 0 };
function gameHTML() {
  if (g.idx >= g.items.length) return `<div class="big">${g.score}/${g.items.length}</div><p style="text-align:center">${g.score >= 7 ? 'Segregation pro!' : 'Good start. Ask the assistant about the ones you missed.'}</p><div style="text-align:center"><button class="btn" id="gr">Play again</button></div>`;
  const it = g.items[g.idx]; return `<div class="gh"><span>Item ${g.idx + 1}/${g.items.length}</span><span>Score ${g.score}</span><span>Streak ${g.streak} 🔥</span></div><div id="gi" class="gitem" draggable="true">${it[0]}<b>${it[1]}</b></div><p class="mu" style="text-align:center">Drag it into a bin, or tap a bin.</p><div class="bins">${BINS.map(b => `<button class="bin" data-b="${b.k}" style="--c:${b.c}">${b.n}</button>`).join('')}</div><p class="mu" id="gf" style="text-align:center"></p>`;
}
function bindGame() {
  const gr = $('#gr'); if (gr) gr.onclick = () => { newGame(); drawGame(); };
  const pick = k => { const it = g.items[g.idx], ok = k === it[2], b = $(`[data-b=${k}]`); if (!b || g.lock) return; g.lock = 1; b.classList.add(ok ? 'good' : 'bad');
    if (ok) { g.score++; g.streak++; } else { g.streak = 0; $('#gf').textContent = `Not quite. ${it[1]} goes in ${BINS.find(x => x.k === it[2]).n}.`; }
    setTimeout(() => { g.lock = 0; g.idx++; if (g.idx >= g.items.length && g.score >= 7) confetti(); drawGame(); }, ok ? 500 : 1300); };
  $$('.bin').forEach(b => { b.onclick = () => pick(b.dataset.b); b.ondragover = e => { e.preventDefault(); b.classList.add('ov'); }; b.ondragleave = () => b.classList.remove('ov'); b.ondrop = e => { e.preventDefault(); b.classList.remove('ov'); pick(b.dataset.b); }; });
}
const drawGame = () => { $('#game').innerHTML = gameHTML(); bindGame(); };

const wizHTML = () => { const s = wiz.step, dots = `<div class="dots">${[1, 2, 3].map(i => `<i class="${i <= s ? 'on' : ''}"></i>`).join('')}</div>`;
  if (s === 1) return `${dots}<h2>Where is the problem?</h2><div class="chips">${CHIPS.map(c => `<button class="chip ${wiz.chip === c ? 'on' : ''}" data-chip="${c}">${c}</button>`).join('')}</div><label>Area, society or campus block</label><input id="ar" value="${esc(wiz.area)}"><button class="sm" id="gp" style="margin-top:10px">${wiz.pos ? '✓ Location added' : '📍 Use my location'}</button><div><button class="btn" id="nx">Next</button></div>`;
  if (s === 2) return `${dots}<h2>Tell us what you see</h2><textarea id="ds" rows="5" placeholder="Hindi or English. Mention how long it has been there.">${esc(wiz.desc)}</textarea><div class="chips" style="margin-top:10px"><button class="sm" data-mic="hi-IN">🎤 Speak in Hindi</button><button class="sm" data-mic="en-IN">🎤 Speak in English</button></div><button class="btn ghost" id="bk">Back</button> <button class="btn" id="nx">Next</button>`;
  return `${dots}<h2>Add a photo, then submit</h2><label class="drop" id="dz">${wiz.photo ? `<img src="${wiz.photo}">` : '📷 Drop a photo here or tap to choose<br><span class="mu">AI uses it to judge urgency</span>'}<input id="ph" type="file" accept="image/*" hidden></label><p class="mu">${esc(wiz.chip || 'Issue')} in ${esc(wiz.area)}</p><button class="btn ghost" id="bk">Back</button> <button class="btn sun" id="sb">Submit complaint</button><div id="out"></div>`; };
function mic(lang) { const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return toast('Voice input works in Chrome or Edge'); const r = new SR(); r.lang = lang; r.onresult = e => { wiz.desc += (wiz.desc ? ' ' : '') + e.results[0][0].transcript; $('#ds').value = wiz.desc; }; r.onerror = () => toast('Could not hear you'); r.start(); toast('Listening...'); }
const readFile = f => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
const drawWiz = () => { $('#wz').innerHTML = wizHTML(); bindWiz(); };
function bindWiz() {
  $$('[data-chip]').forEach(b => b.onclick = () => { wiz.area = $('#ar').value; wiz.chip = b.dataset.chip; drawWiz(); });
  $$('[data-mic]').forEach(b => b.onclick = () => mic(b.dataset.mic));
  const gp = $('#gp'); if (gp) gp.onclick = () => navigator.geolocation.getCurrentPosition(p => { wiz.area = $('#ar').value; wiz.pos = [p.coords.latitude, p.coords.longitude]; drawWiz(); }, () => toast('Location is blocked'));
  const nx = $('#nx'); if (nx) nx.onclick = () => { if (wiz.step === 1) { wiz.area = $('#ar').value.trim(); if (!wiz.area) return toast('Enter the area first'); } else { wiz.desc = $('#ds').value.trim(); if (!wiz.desc) return toast('Describe the problem'); } wiz.step++; drawWiz(); };
  const bk = $('#bk'); if (bk) bk.onclick = () => { if (wiz.step === 2) wiz.desc = $('#ds').value; wiz.step--; drawWiz(); };
  const ph = $('#ph'); if (ph) { ph.onchange = async () => { if (ph.files[0]) { wiz.photo = await readFile(ph.files[0]); drawWiz(); } }; const dz = $('#dz'); dz.ondragover = e => { e.preventDefault(); dz.classList.add('ov'); }; dz.ondragleave = () => dz.classList.remove('ov'); dz.ondrop = async e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) { wiz.photo = await readFile(f); drawWiz(); } }; }
  const sb = $('#sb'); if (sb) sb.onclick = async () => { sb.disabled = true; $('#out').innerHTML = '<div class="ai">AI is reading your complaint...</div>';
    try { const r = await api('/reports', 'POST', { area: wiz.area, description: (wiz.chip ? wiz.chip + ': ' : '') + wiz.desc, photo: wiz.photo, lat: wiz.pos?.[0], lng: wiz.pos?.[1] }); confetti();
      $('#wz').innerHTML = `<h2>Complaint #${r.id} registered 🎉</h2><div class="ai"><b>+10 eco points</b>\nCategory: ${esc(r.category)}\nPriority: ${esc(r.priority)}\nTip: ${esc(r.ai_tip)}</div><button class="btn" id="tr">Track it</button> <button class="btn ghost" id="again">Report another</button>`;
      $('#tr').onclick = () => { tab = 'track'; render(); }; $('#again').onclick = () => { wiz = { step: 1, area: '', chip: '', desc: '', photo: null, pos: null }; drawWiz(); }; }
    catch (e) { $('#out').innerHTML = ''; toast(e.message); sb.disabled = false; } };
}
const V = {
  home: () => `<section class="hero"><div><h1>Waste goes out. Data comes back.</h1><p>Report waste in seconds. AI sorts every complaint, admins see where pickups fail, and the city gets cleaner in a loop.</p><button class="btn sun" data-go="report">Report an issue</button> <button class="btn ghost" data-go="aware">Play the sorting game</button></div><div>${loopSVG()}</div></section>
   <div class="card"><p id="ld" style="margin:0;font-size:16px"></p></div><div class="grid" id="ps"></div><div class="card" style="margin-top:18px"><h2>Top eco citizens</h2><div id="lb"></div></div>`,
  report: () => !me ? gate() : `<div class="card" id="wz" style="max-width:640px;margin:auto"></div>`,
  pickup: () => !me ? gate() : `<div class="card"><h2>Request a pickup</h2><div class="chips" id="pt">${PT.map((p, i) => `<button class="chip ${i ? '' : 'on'}" data-t="${p.slice(3)}">${p}</button>`).join('')}</div><div class="row"><div><label>Preferred date</label><input id="pd" type="date"></div><div><label>Address</label><input id="pa"></div></div><button class="btn" id="pb">Request pickup</button></div><div class="card"><h2>My requests</h2><div id="pl"></div></div>`,
  track: () => !me ? gate() : `<div class="card"><h2>My complaints</h2><div id="tl"></div></div>`,
  aware: () => `<div class="card" style="max-width:640px;margin:auto"><h2>Sort it right</h2><div id="game"></div></div><div class="card"><h2>Ask the segregation assistant</h2><div class="row"><div><label>Item or question</label><input id="aq" placeholder="used batteries, pizza box, sanitary pad"></div><div><label>Language</label><select id="al"><option>English</option><option>Hinglish</option><option>Hindi</option></select></div></div><button class="btn" id="ab">Ask</button><div id="ao"></div></div>`,
  admin: () => !me ? gate() : me.role !== 'admin' ? '<div class="card"><h2>Admin only</h2><p>Log in with an admin account.</p></div>' : `<div class="grid" id="st"></div><div class="card" style="margin-top:18px"><h2>Hotspot map</h2><div id="map"></div></div><div class="row"><div class="card"><h2>Open complaints by area</h2><div id="ba"></div></div><div class="card"><h2>Issue types</h2><div id="bc"></div></div></div><div class="card"><h2>AI weekly plan</h2><button class="btn" id="ib" style="margin-top:0">Generate plan</button><div id="io"></div></div><div class="card"><h2>Priority queue</h2><div class="chips" id="fl">${['All', 'Pending', 'Assigned', 'Resolved'].map(f => `<button class="chip ${f === filt ? 'on' : ''}" data-f="${f}">${f}</button>`).join('')}</div><div id="aq2"></div></div><div class="card"><h2>Pickup requests</h2><div id="ap"></div></div>`
};
const drawQueue = () => { $('#aq2').innerHTML = adminData.filter(x => filt === 'All' || x.status === filt).map(x => `<div class="item"><b>#${x.id} ${esc(x.category)}</b> in ${esc(x.area)} <span class="tag ${x.priority}">${x.priority}</span> <span class="tag ${x.status}">${x.status}</span><div class="mu">${esc(x.description)} (by ${esc(x.reporter)})</div>${x.photo ? `<img src="/uploads/${x.photo}" style="max-width:120px;border-radius:10px;margin-top:6px">` : ''}${x.status !== 'Resolved' ? `<div><button class="sm" data-id="${x.id}" data-st="${x.status === 'Pending' ? 'Assigned' : 'Resolved'}">${x.status === 'Pending' ? 'Assign crew' : 'Mark resolved'}</button></div>` : ''}</div>`).join('') || '<p class="mu">Nothing here.</p>';
  $$('[data-id]').forEach(b => b.onclick = async () => { await api('/admin/reports/' + b.dataset.id, 'PATCH', { status: b.dataset.st }); toast('Updated'); render(); }); };
const stage = s => ['Pending', 'Assigned', 'Resolved'].indexOf(s);
const loaders = {
  home: async () => { setLoop(0); let i = 0; clearInterval(cyc); cyc = setInterval(() => setLoop(i = (i + 1) % 4), 4000);
    $$('.nd').forEach(n => { n.onclick = () => { clearInterval(cyc); setLoop(+n.dataset.i); }; n.onkeydown = e => e.key === 'Enter' && n.onclick(); });
    const [s, l] = await Promise.all([api('/public-stats'), api('/leaderboard')]);
    $('#ps').innerHTML = [['total', 'Complaints filed'], ['resolved', 'Resolved'], ['pending', 'Still open'], ['citizens', 'Citizens']].map(([k, t]) => `<div class="stat"><b id="c-${k}">0</b><span>${t}</span></div>`).join(''); Object.keys(s).forEach(k => countUp($('#c-' + k), s[k]));
    $('#lb').innerHTML = l.map((u, i) => `<div class="item">${['🥇', '🥈', '🥉'][i] || i + 1 + '.'} ${esc(u.name)} <b>${u.points}</b> pts</div>`).join('') || '<p class="mu">Be the first to report.</p>'; },
  report: async () => { if (me) drawWiz(); },
  pickup: async () => { if (!me) return; const l = await api('/pickups/mine'); $('#pl').innerHTML = l.map(p => `<div class="item"><b>${esc(p.type)}</b> <span class="tag ${p.status}">${p.status}</span><div class="mu">${esc(p.address)} ${esc(p.pdate || '')}</div></div>`).join('') || '<p class="mu">No requests yet.</p>'; },
  track: async () => { if (!me) return; const l = await api('/reports/mine'), out = []; for (const r of l) { const d = await api('/reports/' + r.id), s = stage(r.status);
    out.push(`<div class="item"><b>#${r.id} ${esc(r.category)}</b> in ${esc(r.area)} <span class="tag ${r.priority}">${r.priority}</span> <span class="tag ${r.status}">${r.status}</span><div class="dots" style="margin-top:10px">${[0, 1, 2].map(k => `<i class="${k <= s ? 'on' : ''}"></i>`).join('')}</div><div class="mu">Reported → Crew assigned → Resolved</div>${r.photo ? `<img src="/uploads/${r.photo}" style="max-width:130px;border-radius:10px;margin-top:8px">` : ''}<div class="tl">${d.history.map(h => `<div>${esc(h.note)}<div class="mu">${fmt(h.at)}</div></div>`).join('')}</div></div>`); }
    $('#tl').innerHTML = out.join('') || '<p class="mu">Nothing reported yet. Your first report earns 10 eco points.</p>'; },
  aware: async () => { newGame(); drawGame(); },
  admin: async () => { if (!me || me.role !== 'admin') return; const [s, r, p] = await Promise.all([api('/admin/stats'), api('/admin/reports'), api('/admin/pickups')]); adminData = r;
    const c = k => (s.byStatus.find(x => x.k === k) || { n: 0 }).n;
    $('#st').innerHTML = [[c('Pending'), 'Pending'], [c('Assigned'), 'In progress'], [c('Resolved'), 'Resolved'], [s.avgResolveHours ?? '-', 'Avg hours to resolve']].map(x => `<div class="stat"><b>${x[0]}</b><span>${x[1]}</span></div>`).join('');
    $('#ba').innerHTML = bars(s.byArea); $('#bc').innerHTML = bars(s.byCategory);
    if (map) map.remove(); map = L.map('map').setView([26.45, 80.33], 11); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
    s.byArea.filter(a => a.lat).forEach(a => L.circleMarker([a.lat, a.lng], { radius: 8 + a.n * 3, color: a.high ? '#e5484d' : '#ffc531' }).addTo(map).bindPopup(`${esc(a.k)}: ${a.n} open`));
    drawQueue(); $$('[data-f]').forEach(b => b.onclick = () => { filt = b.dataset.f; $$('[data-f]').forEach(x => x.classList.toggle('on', x === b)); drawQueue(); });
    $('#ap').innerHTML = p.map(x => `<div class="item"><b>${esc(x.type)}</b> for ${esc(x.name)} <span class="tag ${x.status}">${x.status}</span><div class="mu">${esc(x.address)}</div>${x.status === 'Scheduled' ? `<button class="sm" data-pk="${x.id}">Mark completed</button>` : ''}</div>`).join('') || '<p class="mu">No requests.</p>';
    $$('[data-pk]').forEach(b => b.onclick = async () => { await api('/admin/pickups/' + b.dataset.pk, 'PATCH', { status: 'Completed' }); render(); }); }
};
const act = (id, fn) => { const e = $(id); if (e) e.onclick = async () => { try { await fn() } catch (x) { toast(x.message) } }; };
function bind() {
  $$('[data-go]').forEach(b => b.onclick = () => { tab = b.dataset.go; render(); });
  act('#li', async () => setAuth(await api('/auth/login', 'POST', { contact: $('#c').value, password: $('#p').value })));
  act('#rg', async () => setAuth(await api('/auth/register', 'POST', { name: $('#n').value, contact: $('#c').value, password: $('#p').value })));
  $$('#pt .chip').forEach(c => c.onclick = () => { $$('#pt .chip').forEach(x => x.classList.remove('on')); c.classList.add('on'); });
  act('#pb', async () => { await api('/pickups', 'POST', { type: $('#pt .on').dataset.t, address: $('#pa').value, pdate: $('#pd').value }); toast('Pickup requested'); render(); });
  act('#ab', async () => { $('#ao').innerHTML = '<div class="ai">Thinking...</div>'; $('#ao').innerHTML = `<div class="ai">${esc((await api('/awareness/ask', 'POST', { q: $('#aq').value, lang: $('#al').value })).answer)}</div>`; });
  act('#ib', async () => { $('#io').innerHTML = '<div class="ai">Analysing complaints...</div>'; $('#io').innerHTML = `<div class="ai">${esc((await api('/admin/insight', 'POST')).insight)}</div>`; });
}
async function render() {
  clearInterval(cyc); const t = [['home', 'Home'], ['report', 'Report'], ['pickup', 'Pickup'], ['track', 'My complaints'], ['aware', 'Awareness'], ['admin', 'Admin']];
  $('#nav').innerHTML = t.map(x => `<button class="${tab === x[0] ? 'on' : ''}" data-t="${x[0]}">${x[1]}</button>`).join('');
  $('#nav').onclick = e => { if (e.target.dataset.t) { tab = e.target.dataset.t; render(); } };
  $('#who').innerHTML = me ? `${esc(me.name)} <button class="sm" id="lo">Log out</button>` : ''; if (me) $('#lo').onclick = logout;
  $('#app').innerHTML = V[tab](); bind();
  try { if (loaders[tab]) await loaders[tab](); } catch (e) { if (/log in/i.test(e.message)) logout(); else toast(e.message); }
}
$('#logo').onclick = () => { tab = 'home'; render(); };
$('#th').onclick = () => { const d = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = d; localStorage.setItem('cl_theme', d); };
render();
