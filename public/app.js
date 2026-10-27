/**
 * EcoTrack Waste Management System - Frontend SPA Application
 * Modern, accessible, responsive client logic with real application data
 */

// Utility DOM Selectors
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// HTML Escaping to prevent XSS
const esc = text => String(text ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

// Application State
let token = localStorage.getItem('cl_token');
let me = JSON.parse(localStorage.getItem('cl_user') || 'null');
let tab = 'dashboard';
let map = null;
let cyc = null;
let adminData = [];
let adminFilter = 'All';
let trackSearch = '';
let recentReportsCache = [];
let myReportsCache = [];

// Hotspot Analytics State
let hotspotFilters = {
  timeRange: 'all',
  priority: 'all',
  status: 'unresolved',
  category: 'all'
};
let hotspotData = null;
let hotspotMarkers = [];

// Report Wizard State
let wiz = {
  step: 1,
  area: '',
  chip: 'Overflowing bin',
  desc: '',
  photo: null,
  pos: null
};

// Waste Sorting Game State
let g = null;

// Initialize Theme
document.documentElement.dataset.theme = localStorage.getItem('cl_theme') || 
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

// API Client
async function api(endpoint, method = 'GET', body) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;

  const res = await fetch('/api' + endpoint, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Server error occurred');
  return data;
}

// Toast Notification
const toast = message => {
  const t = $('#toast');
  if (!t) return;
  t.textContent = message;
  t.style.display = 'block';
  clearTimeout(t.timer);
  t.timer = setTimeout(() => { t.style.display = 'none'; }, 3200);
};

// Date Formatter
const fmt = dateStr => {
  if (!dateStr) return '';
  try {
    const cleanStr = dateStr.includes(' ') ? dateStr.replace(' ', 'T') + 'Z' : dateStr;
    const d = new Date(cleanStr);
    return isNaN(d) ? dateStr : d.toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
};

// Confetti Celebration
const confetti = () => {
  const colors = ['#16A34A', '#22C55E', '#F59E0B', '#3B82F6', '#10B981'];
  for (let i = 0; i < 40; i++) {
    const particle = document.createElement('i');
    particle.className = 'cf';
    particle.style.cssText = `
      left: 50%; top: 40%;
      background: ${colors[i % colors.length]};
      --x: ${(Math.random() - 0.5) * 600}px;
      --y: ${Math.random() * 450 - 100}px;
    `;
    document.body.appendChild(particle);
    setTimeout(() => particle.remove(), 1200);
  }
};

// Animated Number Counter
const countUp = (element, target) => {
  if (!element) return;
  const num = parseInt(target, 10) || 0;
  if (num === 0) { element.textContent = '0'; return; }
  let current = 0;
  const step = Math.max(1, Math.ceil(num / 25));
  const interval = setInterval(() => {
    current = Math.min(num, current + step);
    element.textContent = current;
    if (current >= num) clearInterval(interval);
  }, 30);
};

// Auth Management
const setAuth = data => {
  token = data.token;
  me = data.user;
  localStorage.setItem('cl_token', token);
  localStorage.setItem('cl_user', JSON.stringify(me));
  closeAuthModal();
  toast(`Welcome, ${me.name}!`);
  render();
};

const logout = () => {
  localStorage.removeItem('cl_token');
  localStorage.removeItem('cl_user');
  token = null;
  me = null;
  toast('You have signed out');
  tab = 'dashboard';
  render();
};

// Modal Control
let authModalMode = 'login';
function openAuthModal(mode = 'login') {
  authModalMode = mode;
  const modal = $('#auth-modal');
  if (!modal) return;
  
  $('#auth-error').style.display = 'none';
  $('#modal-contact').value = '';
  $('#modal-pass').value = '';
  
  if (mode === 'register') {
    $('#modal-title').textContent = 'Join EcoTrack';
    $('#modal-desc').textContent = 'Create an account to report issues, track complaints and earn eco points.';
    $('#group-name').style.display = 'block';
    $('#modal-submit-btn').textContent = 'Create Account';
    $('#tab-login-btn').classList.remove('active');
    $('#tab-register-btn').classList.add('active');
  } else {
    $('#modal-title').textContent = 'Welcome Back';
    $('#modal-desc').textContent = 'Sign in to access your civic complaints and pickup requests.';
    $('#group-name').style.display = 'none';
    $('#modal-submit-btn').textContent = 'Sign In';
    $('#tab-login-btn').classList.add('active');
    $('#tab-register-btn').classList.remove('active');
  }
  
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#modal-contact').focus(), 100);
}

function closeAuthModal() {
  const modal = $('#auth-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

// Circular Process Loop Constants
const LOOP = [
  ['📣', 'Report Issue', 'Citizens photograph or describe civic waste in Hindi or English with one-tap GPS.'],
  ['🧠', 'AI Triage', 'Multimodal AI inspects the complaint photo & text, tags urgency and safety tips.'],
  ['🚛', 'Rapid Resolution', 'Municipal teams receive priority dispatching, routing and hotspot maps.'],
  ['🌱', 'Education Loop', 'Gamified segregation coaching and eco badges motivate cleaner communities.']
];

const loopSVG = () => `
<svg class="circular-loop-svg" viewBox="0 0 220 220" role="img" aria-label="Circular waste management cycle">
  <circle class="loop-ring" cx="110" cy="110" r="76"/>
  ${LOOP.map((step, i) => {
    const angle = (i * 90 - 90) * Math.PI / 180;
    const cx = 110 + 76 * Math.cos(angle);
    const cy = 110 + 76 * Math.sin(angle);
    return `
      <g class="loop-node ${i === 0 ? 'active' : ''}" data-loop="${i}" tabindex="0" role="button" aria-label="${step[1]}">
        <circle cx="${cx}" cy="${cy}" r="22"/>
        <text x="${cx}" y="${cy}">${step[0]}</text>
      </g>
    `;
  }).join('')}
</svg>
`;

function setLoop(i) {
  $$('.loop-node').forEach(n => n.classList.toggle('active', +n.dataset.loop === i));
  const title = $('#loop-title');
  const desc = $('#loop-desc');
  if (title) title.textContent = LOOP[i][1];
  if (desc) desc.textContent = LOOP[i][2];
}

// Waste Sorting Game Data
const BINS = [
  { key: 'wet', name: 'Wet / Organic', color: '#16A34A', desc: 'Compostable food waste' },
  { key: 'dry', name: 'Dry / Recyclable', color: '#2563EB', desc: 'Paper, plastics, metals' },
  { key: 'haz', name: 'Hazardous', color: '#DC2626', desc: 'Chemicals, batteries, medical' },
  { key: 'e', name: 'E-Waste', color: '#4B5563', desc: 'Electronics & cables' }
];

const GAME_ITEMS = [
  ['🍌', 'Banana Peel', 'wet'],
  ['📰', 'Newspaper / Books', 'dry'],
  ['🔋', 'Used Alkaline Battery', 'haz'],
  ['🥤', 'Plastic Water Bottle', 'dry'],
  ['📱', 'Broken Smartphone', 'e'],
  ['💊', 'Expired Medicine Strip', 'haz'],
  ['🥬', 'Kitchen Vegetable Scraps', 'wet'],
  ['🔌', 'Frayed Phone Charger', 'e'],
  ['📦', 'Cardboard Packaging', 'dry'],
  ['🧪', 'Chemical Insecticide Spray', 'haz']
];

const newGame = () => {
  g = {
    items: [...GAME_ITEMS].sort(() => Math.random() - 0.5),
    idx: 0,
    score: 0,
    streak: 0,
    lock: false
  };
};

function gameHTML() {
  if (g.idx >= g.items.length) {
    const isPro = g.score >= 8;
    return `
      <div class="card" style="text-align:center;padding:36px 20px;">
        <div style="font-size:3rem;font-weight:800;color:var(--accent);">${g.score}/${g.items.length}</div>
        <h3 style="margin:12px 0 6px;">${isPro ? '🎉 Waste Sorting Master!' : '👍 Good Effort!'}</h3>
        <p class="card-subtitle" style="margin-bottom:20px;">
          ${isPro ? 'You scored 8+ and earned maximum eco points for segregation knowledge.' : 'Keep practicing to master municipal source segregation.'}
        </p>
        <button class="btn btn-primary" id="game-restart-btn">Play Again</button>
      </div>
    `;
  }

  const it = g.items[g.idx];
  return `
    <div class="game-container">
      <div class="game-stats-header">
        <span>Item ${g.idx + 1} of ${g.items.length}</span>
        <span>Score: <b>${g.score}</b></span>
        <span>Streak: <b>${g.streak} 🔥</b></span>
      </div>

      <div id="game-draggable" class="draggable-item-card" draggable="true">
        <span>${it[0]}</span>
        <span class="draggable-item-name">${it[1]}</span>
      </div>

      <p class="card-subtitle" style="text-align:center;margin-bottom:14px;">
        Drag the waste item into the correct colored bin, or tap a bin directly.
      </p>

      <div class="bins-grid">
        ${BINS.map(b => `
          <button type="button" class="bin-container" data-bin="${b.key}" style="--bin-color: ${b.color};">
            ${b.name}
          </button>
        `).join('')}
      </div>

      <p id="game-feedback" style="min-height:24px;font-weight:600;font-size:13.5px;color:var(--text);margin-top:14px;text-align:center;"></p>
    </div>
  `;
}

function bindGame() {
  const restartBtn = $('#game-restart-btn');
  if (restartBtn) {
    restartBtn.onclick = () => { newGame(); drawGame(); };
    return;
  }

  const dragItem = $('#game-draggable');
  if (dragItem) {
    dragItem.ondragstart = e => {
      e.dataTransfer.setData('text/plain', g.items[g.idx][2]);
    };
  }

  const selectBin = chosenKey => {
    if (g.lock || g.idx >= g.items.length) return;
    g.lock = true;

    const item = g.items[g.idx];
    const isCorrect = chosenKey === item[2];
    const binBtn = $(`[data-bin="${chosenKey}"]`);
    const feedback = $('#game-feedback');

    if (binBtn) binBtn.classList.add(isCorrect ? 'pop' : 'shake');

    if (isCorrect) {
      g.score++;
      g.streak++;
      if (feedback) feedback.textContent = `✓ Correct! ${item[1]} goes into ${BINS.find(x => x.key === item[2]).name}.`;
    } else {
      g.streak = 0;
      const targetBin = BINS.find(x => x.key === item[2]);
      if (feedback) feedback.textContent = `✕ Incorrect: ${item[1]} belongs in ${targetBin.name}.`;
    }

    setTimeout(() => {
      g.lock = false;
      g.idx++;
      if (g.idx >= g.items.length && g.score >= 8) confetti();
      drawGame();
    }, isCorrect ? 500 : 1200);
  };

  $$('.bin-container').forEach(bin => {
    bin.onclick = () => selectBin(bin.dataset.bin);

    bin.ondragover = e => {
      e.preventDefault();
      bin.classList.add('drag-over');
    };
    bin.ondragleave = () => bin.classList.remove('drag-over');
    bin.ondrop = e => {
      e.preventDefault();
      bin.classList.remove('drag-over');
      selectBin(bin.dataset.bin);
    };
  });
}

const drawGame = () => {
  const container = $('#game-mount');
  if (container) {
    container.innerHTML = gameHTML();
    bindGame();
  }
};

// Wizard HTML Form
const CHIPS = ['Overflowing bin', 'Garbage on road', 'Missed collection', 'Illegal dumping', 'Other'];
const PICKUP_TYPES = [
  '🏠 Household dry waste',
  '🥗 Kitchen or wet waste',
  '🌿 Bulk or garden waste',
  '🔌 E-waste & electronics',
  '🧱 Construction debris'
];

const wizHTML = () => {
  const step = wiz.step;
  const stepper = `
    <div class="wizard-steps">
      <div class="wizard-step-node ${step >= 1 ? (step === 1 ? 'active' : 'completed') : ''}">
        <div class="step-circle">${step > 1 ? '✓' : '1'}</div>
        <span class="step-title">Location</span>
      </div>
      <div class="wizard-step-node ${step >= 2 ? (step === 2 ? 'active' : 'completed') : ''}">
        <div class="step-circle">${step > 2 ? '✓' : '2'}</div>
        <span class="step-title">Details</span>
      </div>
      <div class="wizard-step-node ${step >= 3 ? 'active' : ''}">
        <div class="step-circle">3</div>
        <span class="step-title">Submit</span>
      </div>
    </div>
  `;

  if (step === 1) {
    return `
      ${stepper}
      <h2 style="margin-bottom:6px;">Select Issue Category & Location</h2>
      <p class="card-subtitle" style="margin-bottom:18px;">Pick the waste problem type and identify where it is located.</p>

      <label>Type of Waste Problem</label>
      <div class="chip-grid">
        ${CHIPS.map(c => `
          <button type="button" class="chip ${wiz.chip === c ? 'active' : ''}" data-chip="${c}">${c}</button>
        `).join('')}
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label for="wz-area">Area, Society, Street or Campus Block *</label>
        <input type="text" id="wz-area" placeholder="e.g. Sector 14 Main Road, near Metro Pillar 112" value="${esc(wiz.area)}">
      </div>

      <div style="margin:14px 0 20px;">
        <button type="button" class="btn btn-outline btn-sm" id="wz-gps-btn">
          ${wiz.pos ? '✓ GPS Location Attached' : '📍 Auto-detect GPS Coordinates'}
        </button>
        ${wiz.pos ? `<span style="font-size:12px;color:var(--accent);margin-left:8px;font-weight:600;">(${wiz.pos[0].toFixed(4)}, ${wiz.pos[1].toFixed(4)})</span>` : ''}
      </div>

      <div style="display:flex;justify-content:flex-end;">
        <button type="button" class="btn btn-primary" id="wz-next-btn">Continue to Details →</button>
      </div>
    `;
  }

  if (step === 2) {
    return `
      ${stepper}
      <h2 style="margin-bottom:6px;">Describe the Waste Issue</h2>
      <p class="card-subtitle" style="margin-bottom:18px;">Tell us what you see, how long it has been there, and any health/safety hazards.</p>

      <div class="form-group">
        <label for="wz-desc">Detailed Description *</label>
        <textarea id="wz-desc" rows="4" placeholder="You can type or speak in Hindi or English (e.g., Waste bin is overflowing for 3 days and smelling foul near the school gate).">${esc(wiz.desc)}</textarea>
        
        <div class="mic-buttons">
          <button type="button" class="btn-mic" data-mic="hi-IN">🎤 Speak in Hindi</button>
          <button type="button" class="btn-mic" data-mic="en-IN">🎤 Speak in English</button>
        </div>
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:24px;">
        <button type="button" class="btn btn-outline" id="wz-back-btn">← Back</button>
        <button type="button" class="btn btn-primary" id="wz-next-btn">Continue to Photo →</button>
      </div>
    `;
  }

  // Step 3: Photo & Submit
  return `
    ${stepper}
    <h2 style="margin-bottom:6px;">Add Photo & Register Complaint</h2>
    <p class="card-subtitle" style="margin-bottom:18px;">A photo helps our AI evaluate severity and dispatch the right municipal truck.</p>

    <label class="dropzone" id="wz-dropzone">
      ${wiz.photo 
        ? `<img src="${wiz.photo}" class="dropzone-preview" alt="Complaint photo preview">
           <div style="margin-top:8px;font-size:12.5px;color:var(--text-muted);">Tap or drop another image to replace</div>`
        : `<div class="dropzone-icon">📷</div>
           <div style="font-weight:700;font-size:14.5px;color:var(--text);margin-bottom:4px;">Drag & Drop photo here, or click to browse</div>
           <div class="card-subtitle">AI vision parses image to determine waste category & urgency</div>`
      }
      <input type="file" id="wz-file-input" accept="image/*" hidden>
    </label>

    <div style="background:var(--surface-alt);padding:14px;border-radius:var(--radius-md);margin-bottom:20px;font-size:13.5px;">
      <b>Summary:</b> ${esc(wiz.chip)} at <b>${esc(wiz.area)}</b>
    </div>

    <div style="display:flex;justify-content:space-between;">
      <button type="button" class="btn btn-outline" id="wz-back-btn">← Back</button>
      <button type="button" class="btn btn-accent" id="wz-submit-btn">Submit Complaint (AI Triage)</button>
    </div>

    <div id="wz-output"></div>
  `;
};

// Web Speech Recognition
function mic(lang) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice input is supported in Google Chrome, Edge or Safari');
  const recognition = new SR();
  recognition.lang = lang;
  recognition.onresult = e => {
    const text = e.results[0][0].transcript;
    wiz.desc += (wiz.desc ? ' ' : '') + text;
    const descEl = $('#wz-desc');
    if (descEl) descEl.value = wiz.desc;
    toast(`Transcribed: "${text.slice(0, 30)}..."`);
  };
  recognition.onerror = () => toast('Speech could not be recognized. Please try again.');
  recognition.start();
  toast('Listening... Speak now into microphone');
}

// File Reader Helper
const readFile = file => new Promise(resolve => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.readAsDataURL(file);
});

// Bind Wizard Events
function bindWiz() {
  $$('[data-chip]').forEach(btn => {
    btn.onclick = () => {
      const areaInput = $('#wz-area');
      if (areaInput) wiz.area = areaInput.value;
      wiz.chip = btn.dataset.chip;
      drawWiz();
    };
  });

  $$('[data-mic]').forEach(btn => {
    btn.onclick = () => mic(btn.dataset.mic);
  });

  const gpsBtn = $('#wz-gps-btn');
  if (gpsBtn) {
    gpsBtn.onclick = () => {
      const areaInput = $('#wz-area');
      if (areaInput) wiz.area = areaInput.value;
      
      if (!navigator.geolocation) return toast('Geolocation is not supported by your browser');
      toast('Locating your position...');
      navigator.geolocation.getCurrentPosition(
        pos => {
          wiz.pos = [pos.coords.latitude, pos.coords.longitude];
          toast('GPS coordinates attached successfully');
          drawWiz();
        },
        () => toast('Unable to retrieve location. Please check browser permissions.')
      );
    };
  }

  const nextBtn = $('#wz-next-btn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (wiz.step === 1) {
        wiz.area = ($('#wz-area')?.value || '').trim();
        if (!wiz.area) return toast('Please enter the location / area name');
      } else if (wiz.step === 2) {
        wiz.desc = ($('#wz-desc')?.value || '').trim();
        if (!wiz.desc) return toast('Please provide a brief description of the waste issue');
      }
      wiz.step++;
      drawWiz();
    };
  }

  const backBtn = $('#wz-back-btn');
  if (backBtn) {
    backBtn.onclick = () => {
      if (wiz.step === 2) wiz.desc = $('#wz-desc')?.value || '';
      wiz.step--;
      drawWiz();
    };
  }

  const fileInput = $('#wz-file-input');
  const dropzone = $('#wz-dropzone');
  if (fileInput && dropzone) {
    fileInput.onchange = async () => {
      if (fileInput.files[0]) {
        wiz.photo = await readFile(fileInput.files[0]);
        drawWiz();
      }
    };

    dropzone.ondragover = e => { e.preventDefault(); dropzone.classList.add('dragover'); };
    dropzone.ondragleave = () => dropzone.classList.remove('dragover');
    dropzone.ondrop = async e => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        wiz.photo = await readFile(file);
        drawWiz();
      }
    };
  }

  const submitBtn = $('#wz-submit-btn');
  if (submitBtn) {
    submitBtn.onclick = async () => {
      submitBtn.disabled = true;
      const output = $('#wz-output');
      if (output) output.innerHTML = `<div class="ai-triage-box" style="margin-top:16px;">🤖 AI is evaluating description and photo...</div>`;

      try {
        const fullDesc = (wiz.chip ? `${wiz.chip}: ` : '') + (wiz.desc || 'Reported civic issue');
        const res = await api('/reports', 'POST', {
          area: wiz.area,
          description: fullDesc,
          photo: wiz.photo,
          lat: wiz.pos ? wiz.pos[0] : null,
          lng: wiz.pos ? wiz.pos[1] : null
        });

        confetti();
        try {
          const profile = await api('/me');
          me = profile;
          localStorage.setItem('cl_user', JSON.stringify(me));
          const pill = $('#user-pill');
          if (pill && me) {
            pill.innerHTML = `
              <div class="user-profile-badge">
                <div class="user-avatar-mini">${esc(me.name.charAt(0).toUpperCase())}</div>
                <span>${esc(me.name)}</span>
                <span class="user-points-pill">🏅 ${me.points || 0} pts</span>
                <button type="button" class="btn btn-outline btn-sm" id="logout-btn" style="padding:2px 8px;font-size:11px;margin-left:4px;">Sign Out</button>
              </div>
            `;
            const lo = $('#logout-btn');
            if (lo) lo.onclick = logout;
          }
        } catch (e) {}
        const cardMount = $('#wizard-mount');
        if (cardMount) {
          cardMount.innerHTML = `
            <div style="text-align:center;padding:10px 0 20px;">
              <div style="font-size:3.5rem;">🎉</div>
              <h2 style="margin:8px 0;">Complaint #${res.id} Registered</h2>
              <p class="card-subtitle">Thank you for reporting. Your issue has been added to the municipal queue.</p>
            </div>

            <div class="ai-triage-box">
              <div class="ai-triage-header">
                <span>🤖 AI Triage Result</span>
                <span class="badge badge-${(res.priority || 'medium').toLowerCase()}">${res.priority} Priority</span>
                <span class="badge badge-resolved">+10 Eco Points</span>
              </div>
              <div class="ai-triage-content">
                <div><b>Categorized as:</b> ${esc(res.category)}</div>
                <div style="margin-top:6px;"><b>Safety Guidance:</b> ${esc(res.ai_tip || 'Keep wet and dry waste segregated.')}</div>
              </div>
            </div>

            <div style="display:flex;gap:12px;margin-top:24px;justify-content:center;">
              <button type="button" class="btn btn-primary" id="wz-track-now">Track My Complaints</button>
              <button type="button" class="btn btn-outline" id="wz-report-another">Report Another Issue</button>
            </div>
          `;

          $('#wz-track-now').onclick = () => { tab = 'track'; render(); };
          $('#wz-report-another').onclick = () => {
            wiz = { step: 1, area: '', chip: 'Overflowing bin', desc: '', photo: null, pos: null };
            drawWiz();
          };
        }
      } catch (err) {
        if (output) output.innerHTML = '';
        toast(err.message);
        submitBtn.disabled = false;
      }
    };
  }
}

const drawWiz = () => {
  const mount = $('#wizard-mount');
  if (mount) {
    mount.innerHTML = wizHTML();
    bindWiz();
  }
};

// ==========================================================================
// Views Configuration
// ==========================================================================

const Views = {
  // 1. Dashboard View (Overview, Stats, Recent Reports, Loop & Leaderboard)
  dashboard: () => `
    <!-- Hero Banner -->
    <section class="hero-banner">
      <div class="hero-content">
        <h1 class="hero-title">Clean Cities Begin With Circular Data</h1>
        <p class="hero-text">
          EcoTrack connects citizens with municipal sanitation teams through automated AI triage, geolocated reporting, and scheduled pickups.
        </p>
        <div class="hero-actions">
          <button class="btn btn-accent" data-goto="report">📢 Report Waste Issue</button>
          <button class="btn btn-outline" style="color:#FFF;border-color:rgba(255,255,255,0.4);" data-goto="aware">🎮 Segregation Game</button>
        </div>
      </div>
      <div class="hero-visual">
        ${loopSVG()}
      </div>
    </section>

    <!-- Key Metrics Stats Row -->
    <div class="stats-grid" id="stats-row">
      <div class="stat-card">
        <div class="stat-icon">📋</div>
        <div class="stat-details">
          <div class="stat-num" id="stat-total">0</div>
          <div class="stat-label">Total Complaints Filed</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--success-bg);color:var(--success);">✅</div>
        <div class="stat-details">
          <div class="stat-num" id="stat-resolved">0</div>
          <div class="stat-label">Complaints Resolved</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--warning-bg);color:var(--warning);">⏳</div>
        <div class="stat-details">
          <div class="stat-num" id="stat-pending">0</div>
          <div class="stat-label">Pending / In-Progress</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--info-bg);color:var(--info);">👥</div>
        <div class="stat-details">
          <div class="stat-num" id="stat-citizens">0</div>
          <div class="stat-label">Citizen Champions</div>
        </div>
      </div>
    </div>

    <!-- Quick Action Shortcuts -->
    <div class="quick-actions-grid">
      <div class="action-tile" data-goto="report">
        <div class="action-tile-icon">📢</div>
        <div>
          <div class="action-tile-title">Report Waste</div>
          <div class="action-tile-desc">Upload photos & auto-triage issues</div>
        </div>
      </div>
      <div class="action-tile" data-goto="pickup">
        <div class="action-tile-icon">🚚</div>
        <div>
          <div class="action-tile-title">Request Pickup</div>
          <div class="action-tile-desc">Schedule bulk, e-waste, or organic pickups</div>
        </div>
      </div>
      <div class="action-tile" data-goto="track">
        <div class="action-tile-icon">🔍</div>
        <div>
          <div class="action-tile-title">Track Status</div>
          <div class="action-tile-desc">View real-time resolution timeline</div>
        </div>
      </div>
      <div class="action-tile" data-goto="aware">
        <div class="action-tile-icon">💡</div>
        <div>
          <div class="action-tile-title">Segregation Coach</div>
          <div class="action-tile-desc">AI advice & waste sorting game</div>
        </div>
      </div>
    </div>

    <!-- Two-Column Grid: Recent Activity & Circular Loop Info -->
    <div class="dashboard-columns">
      <!-- Left: Recent Reports -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Recent Waste Reports</h2>
            <div class="card-subtitle">Latest citizen complaints submitted across the city</div>
          </div>
          <button class="btn btn-outline btn-sm" data-goto="report">+ New Report</button>
        </div>
        <div id="recent-reports-feed" class="reports-list">
          <p class="card-subtitle" style="text-align:center;padding:20px;">Loading recent reports...</p>
        </div>
      </div>

      <!-- Right: Circular Loop & Leaderboard -->
      <div>
        <div class="card">
          <h2 class="card-title">The Circular Process</h2>
          <div style="margin-top:12px;">
            <div style="font-weight:700;font-size:15px;color:var(--primary);" id="loop-title">Report Issue</div>
            <p class="card-subtitle" id="loop-desc" style="margin-top:4px;line-height:1.5;">
              Citizens photograph or describe civic waste in Hindi or English with one-tap GPS.
            </p>
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <div>
              <h2 class="card-title">Eco Leaderboard</h2>
              <div class="card-subtitle">Top citizens driving clean communities</div>
            </div>
            <span style="font-size:1.2rem;">🏆</span>
          </div>
          <div id="leaderboard-feed" class="leaderboard-list">
            <p class="card-subtitle" style="text-align:center;padding:12px;">Loading leaderboard...</p>
          </div>
        </div>
      </div>
    </div>
  `,

  // 2. Report Waste View
  report: () => `
    <div class="card wizard-card">
      <div id="wizard-mount"></div>
    </div>
  `,

  // 3. Pickup Requests View
  pickup: () => `
    <div class="dashboard-columns">
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Schedule Waste Pickup</h2>
            <div class="card-subtitle">Book a special municipal doorstep collection for bulky or hazardous waste</div>
          </div>
        </div>

        <label>Waste Category *</label>
        <div class="pickup-types-grid" id="pickup-types-container">
          ${PICKUP_TYPES.map((t, i) => `
            <div class="pickup-type-card ${i === 0 ? 'active' : ''}" data-type="${t.slice(3).trim()}">
              ${t}
            </div>
          `).join('')}
        </div>

        <div class="form-group">
          <label for="pk-date">Preferred Collection Date</label>
          <input type="date" id="pk-date">
        </div>

        <div class="form-group">
          <label for="pk-address">Full Pickup Address *</label>
          <input type="text" id="pk-address" placeholder="e.g. Flat 301, Tower B, Greenwoods Society, Sector 15">
        </div>

        <button type="button" class="btn btn-primary btn-block" id="pk-submit-btn">
          Confirm Pickup Request
        </button>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">My Pickup Requests</h2>
            <div class="card-subtitle">Track your scheduled collection status</div>
          </div>
        </div>
        <div id="pickup-list-feed">
          <p class="card-subtitle" style="text-align:center;padding:20px;">Loading your requests...</p>
        </div>
      </div>
    </div>
  `,

  // 4. Track Complaints View
  track: () => `
    <div class="card">
      <div class="card-header">
        <div>
          <h2 class="card-title">Track Civic Complaints</h2>
          <div class="card-subtitle">Real-time status, crew assignment, and resolution history</div>
        </div>
      </div>

      <div class="track-filter-bar">
        <input type="text" id="track-search-box" class="track-search-input" placeholder="Search by area, category, or description..." value="${esc(trackSearch)}">
      </div>

      <div id="track-complaints-feed">
        <p class="card-subtitle" style="text-align:center;padding:24px;">Loading complaints...</p>
      </div>
    </div>
  `,

  // 5. Awareness & Segregation View
  aware: () => `
    <div class="dashboard-columns">
      <!-- Waste Sorting Game -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Waste Sorting Simulator</h2>
            <div class="card-subtitle">Drag waste items to their designated color bins</div>
          </div>
          <span style="font-size:1.4rem;">♻️</span>
        </div>
        <div id="game-mount"></div>
      </div>

      <!-- AI Segregation Coach -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">AI Segregation Assistant</h2>
            <div class="card-subtitle">Ask how to dispose of or recycle any item safely</div>
          </div>
          <span style="font-size:1.4rem;">🤖</span>
        </div>

        <div class="form-group">
          <label for="coach-q">Item or Material Name</label>
          <input type="text" id="coach-q" placeholder="e.g. used blister packs, pizza carton, LED bulb, milk pouch">
          
          <div class="prompt-chips">
            <span class="prompt-chip" data-ask="Used lithium battery">Used battery</span>
            <span class="prompt-chip" data-ask="Greasy pizza carton">Greasy pizza box</span>
            <span class="prompt-chip" data-ask="Medicine blister pack">Medicine foil</span>
            <span class="prompt-chip" data-ask="Broken beer bottle">Glass bottle</span>
          </div>
        </div>

        <div class="form-group">
          <label for="coach-lang">Response Language</label>
          <select id="coach-lang">
            <option value="English">English</option>
            <option value="Hinglish">Hinglish</option>
            <option value="Hindi">Hindi (हिंदी)</option>
          </select>
        </div>

        <button type="button" class="btn btn-primary" id="coach-ask-btn">Ask AI Coach</button>

        <div id="coach-answer-box" style="margin-top:16px;"></div>
      </div>
    </div>
  `,

  // 6. Admin Portal
  admin: () => {
    if (!me || me.role !== 'admin') {
      return `
        <div class="card" style="max-width:540px;margin:40px auto;text-align:center;padding:36px 20px;">
          <div style="font-size:3rem;margin-bottom:12px;">🛡️</div>
          <h2>Admin Authentication Required</h2>
          <p class="card-subtitle" style="margin-bottom:20px;">
            The municipal control center is restricted to authorized personnel. Please sign in with an admin account.
          </p>
          <button class="btn btn-primary" id="admin-login-trigger">Sign In as Admin</button>
        </div>
      `;
    }

    return `
      <!-- Admin Stats Grid -->
      <div class="stats-grid" id="admin-stats-grid"></div>

      <!-- Waste Hotspot Analytics Section -->
      <div class="card hotspot-panel">
        <div class="card-header">
          <div>
            <h2 class="card-title">📍 Waste Hotspot Analytics</h2>
            <div class="card-subtitle">Live geographic clusters computed from real database complaint records with deterministic priority ranking</div>
          </div>
        </div>

        <!-- Hotspot Filter Toolbar -->
        <div class="hotspot-filters-bar" id="hotspot-filters-bar">
          <div class="filter-group">
            <span class="filter-label">Time Window</span>
            <select class="filter-select" id="hf-time">
              <option value="all" ${hotspotFilters.timeRange === 'all' ? 'selected' : ''}>All Time</option>
              <option value="7d" ${hotspotFilters.timeRange === '7d' ? 'selected' : ''}>Last 7 Days</option>
              <option value="30d" ${hotspotFilters.timeRange === '30d' ? 'selected' : ''}>Last 30 Days</option>
              <option value="90d" ${hotspotFilters.timeRange === '90d' ? 'selected' : ''}>Last 90 Days</option>
            </select>
          </div>

          <div class="filter-group">
            <span class="filter-label">Urgency Priority</span>
            <select class="filter-select" id="hf-priority">
              <option value="all" ${hotspotFilters.priority === 'all' ? 'selected' : ''}>All Priorities</option>
              <option value="High" ${hotspotFilters.priority === 'High' ? 'selected' : ''}>High Urgency Only</option>
              <option value="Medium" ${hotspotFilters.priority === 'Medium' ? 'selected' : ''}>Medium</option>
              <option value="Low" ${hotspotFilters.priority === 'Low' ? 'selected' : ''}>Low</option>
            </select>
          </div>

          <div class="filter-group">
            <span class="filter-label">Status</span>
            <select class="filter-select" id="hf-status">
              <option value="unresolved" ${hotspotFilters.status === 'unresolved' ? 'selected' : ''}>Unresolved Only</option>
              <option value="all" ${hotspotFilters.status === 'all' ? 'selected' : ''}>All Complaints</option>
              <option value="Pending" ${hotspotFilters.status === 'Pending' ? 'selected' : ''}>Pending Only</option>
              <option value="Assigned" ${hotspotFilters.status === 'Assigned' ? 'selected' : ''}>Assigned (In Progress)</option>
              <option value="Resolved" ${hotspotFilters.status === 'Resolved' ? 'selected' : ''}>Resolved Only</option>
            </select>
          </div>

          <div class="filter-group">
            <span class="filter-label">Category</span>
            <select class="filter-select" id="hf-category">
              <option value="all" ${hotspotFilters.category === 'all' ? 'selected' : ''}>All Categories</option>
              ${CHIPS.map(c => `<option value="${c}" ${hotspotFilters.category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>

          <div style="align-self:flex-end;">
            <button type="button" class="btn btn-outline btn-sm" id="hf-reset-btn">Reset Filters</button>
          </div>
        </div>

        <!-- Hotspot Summary Metric Cards -->
        <div id="hotspot-summary-mount"></div>

        <!-- Hotspot Map & Map Legend -->
        <div style="margin-bottom:24px;">
          <div id="map"></div>
          <div class="map-legend">
            <span style="font-weight:700;color:var(--text);">Hotspot Map Legend:</span>
            <span class="legend-item"><span class="legend-dot" style="background:#DC2626;"></span> Critical (Unresolved High Urgency)</span>
            <span class="legend-item"><span class="legend-dot" style="background:#F59E0B;"></span> Moderate (Unresolved Issues)</span>
            <span class="legend-item"><span class="legend-dot" style="background:#16A34A;"></span> Clear / Resolved</span>
            <span class="legend-item" style="color:var(--text-muted);">(Marker size reflects volume of open issues)</span>
          </div>
        </div>

        <!-- Hotspot Ranked Zones -->
        <div>
          <h3 style="font-size:1.15rem;margin-bottom:4px;">Highest-Priority Waste Zones</h3>
          <p class="card-subtitle" style="margin-bottom:14px;">Ranked in descending order by computed urgency score based on unresolved issues and severity</p>
          <div id="hotspot-ranked-mount"></div>
        </div>
      </div>

      <!-- Area & Category Charts -->
      <div class="dashboard-columns">
        <div class="card">
          <h2 class="card-title">Open Complaints by Ward / Area</h2>
          <div id="admin-area-bars" style="margin-top:14px;"></div>
        </div>
        <div class="card">
          <h2 class="card-title">Issues by Waste Category</h2>
          <div id="admin-category-bars" style="margin-top:14px;"></div>
        </div>
      </div>

      <!-- AI Action Plan -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">AI Weekly Sanitation Action Plan</h2>
            <div class="card-subtitle">Automated recommendations for crew redistribution & hotspot mitigation</div>
          </div>
          <button class="btn btn-primary btn-sm" id="admin-ai-plan-btn">Generate AI Plan</button>
        </div>
        <div id="admin-ai-plan-output">
          <div class="ai-triage-box" style="margin-top:0;">
            Click <b>Generate AI Plan</b> to analyze open complaints and receive strategic deployment guidance.
          </div>
        </div>
      </div>

      <!-- Priority Queue -->
      <div class="card" id="priority-queue-section">
        <div class="card-header">
          <div>
            <h2 class="card-title">Priority Triage Queue</h2>
            <div class="card-subtitle">Review, assign, and mark complaints resolved</div>
          </div>
          <div class="chip-grid" style="margin-bottom:0;" id="admin-filter-chips">
            ${['All', 'Pending', 'Assigned', 'Resolved'].map(f => `
              <button type="button" class="chip ${f === adminFilter ? 'active' : ''}" data-filt="${f}">${f}</button>
            `).join('')}
          </div>
        </div>
        <div id="admin-queue-feed" class="reports-list"></div>
      </div>

      <!-- Pickup Requests Queue -->
      <div class="card">
        <div class="card-header">
          <div>
            <h2 class="card-title">Scheduled Pickup Requests</h2>
            <div class="card-subtitle">Citizen requests for bulk and special item collection</div>
          </div>
        </div>
        <div id="admin-pickups-feed" class="reports-list"></div>
      </div>
    `;
  }
};

function renderTrackFeed(reports) {
  const feed = $('#track-complaints-feed');
  if (!feed) return;

  const filtered = (reports || []).filter(r => {
    if (!trackSearch) return true;
    const q = trackSearch.toLowerCase();
    return (r.area && r.area.toLowerCase().includes(q)) ||
           (r.category && r.category.toLowerCase().includes(q)) ||
           (r.description && r.description.toLowerCase().includes(q)) ||
           String(r.id).includes(q);
  });

  if (filtered.length === 0) {
    feed.innerHTML = `
      <div style="text-align:center;padding:32px 14px;">
        <p class="card-subtitle">${trackSearch ? 'No matching complaints found.' : 'You have not submitted any complaints yet.'}</p>
        <button type="button" class="btn btn-primary btn-sm" style="margin-top:12px;" data-goto="report">Report an Issue Now</button>
      </div>
    `;
    $$('[data-goto]').forEach(btn => {
      btn.onclick = () => { tab = btn.dataset.goto; render(); };
    });
    return;
  }

  const getStageIdx = st => {
    if (st === 'Resolved') return 2;
    if (st === 'Assigned') return 1;
    return 0;
  };

  feed.innerHTML = filtered.map(r => {
    const stage = getStageIdx(r.status);
    const historyList = r.history || [];

    return `
      <div class="track-item-card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;">
          <div>
            <span class="report-item-title" style="font-size:16px;">#${r.id} ${esc(r.category)}</span>
            <span class="badge badge-${(r.priority || 'medium').toLowerCase()}">${r.priority}</span>
            <span class="badge badge-${(r.status || 'pending').toLowerCase()}">${r.status}</span>
            <div class="report-item-area" style="margin-top:4px;">📍 ${esc(r.area)}</div>
          </div>
          <div style="font-size:12.5px;color:var(--text-muted);">
            Filed ${fmt(r.created_at)}
          </div>
        </div>

        <div class="progress-stepper">
          <div class="prog-node ${stage >= 0 ? 'done' : ''}">
            <div class="prog-dot"></div>
            <span class="prog-label">Reported</span>
          </div>
          <div class="prog-node ${stage >= 1 ? 'done' : ''}">
            <div class="prog-dot"></div>
            <span class="prog-label">Crew Assigned</span>
          </div>
          <div class="prog-node ${stage >= 2 ? 'done' : ''}">
            <div class="prog-dot"></div>
            <span class="prog-label">Resolved</span>
          </div>
        </div>

        <div style="margin:12px 0;font-size:14px;color:var(--text);">
          ${esc(r.description)}
        </div>

        ${r.photo ? `
          <div style="margin:10px 0;">
            <img src="/uploads/${r.photo}" class="report-thumb" style="width:110px;height:110px;border-radius:10px;" alt="Attached photo">
          </div>
        ` : ''}

        ${r.ai_tip ? `
          <div class="ai-triage-box" style="margin:12px 0 6px;padding:12px 14px;">
            <b>Safety Guidance:</b> ${esc(r.ai_tip)}
          </div>
        ` : ''}

        ${historyList.length > 0 ? `
          <div style="margin-top:14px;">
            <div style="font-size:12.5px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:6px;">Event Timeline</div>
            <div class="timeline-list">
              ${historyList.map(h => `
                <div class="timeline-event">
                  <div class="timeline-note">${esc(h.note)}</div>
                  <div class="timeline-time">${fmt(h.at)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// ==========================================================================
// View Data Loaders
// ==========================================================================

const Loaders = {
  dashboard: async () => {
    // 1. Initialize Loop Rotation
    setLoop(0);
    let loopIdx = 0;
    clearInterval(cyc);
    cyc = setInterval(() => {
      loopIdx = (loopIdx + 1) % 4;
      setLoop(loopIdx);
    }, 4500);

    $$('.loop-node').forEach(node => {
      node.onclick = () => {
        clearInterval(cyc);
        setLoop(+node.dataset.loop);
      };
      node.onkeydown = e => {
        if (e.key === 'Enter') {
          clearInterval(cyc);
          setLoop(+node.dataset.loop);
        }
      };
    });

    // 2. Fetch Public Stats & Leaderboard & Recent Reports in Parallel
    try {
      const [stats, leaderboard, recent] = await Promise.all([
        api('/public-stats').catch(() => ({ total: 0, resolved: 0, pending: 0, citizens: 0 })),
        api('/leaderboard').catch(() => []),
        api('/reports/recent').catch(() => [])
      ]);

      // Animate Counters
      countUp($('#stat-total'), stats.total);
      countUp($('#stat-resolved'), stats.resolved);
      countUp($('#stat-pending'), stats.pending);
      countUp($('#stat-citizens'), stats.citizens);

      // Render Recent Reports Feed
      recentReportsCache = recent;
      const recentFeed = $('#recent-reports-feed');
      if (recentFeed) {
        if (recent.length === 0) {
          recentFeed.innerHTML = `
            <div style="text-align:center;padding:28px 14px;">
              <p class="card-subtitle">No waste complaints reported yet.</p>
              <button class="btn btn-primary btn-sm" style="margin-top:10px;" data-goto="report">File the First Report</button>
            </div>
          `;
        } else {
          recentFeed.innerHTML = recent.map(r => `
            <div class="report-item">
              ${r.photo ? `<img src="/uploads/${r.photo}" class="report-thumb" alt="Report photo">` : ''}
              <div class="report-item-main">
                <div class="report-item-top">
                  <span class="report-item-title">#${r.id} ${esc(r.category)}</span>
                  <span class="badge badge-${(r.priority || 'medium').toLowerCase()}">${r.priority}</span>
                  <span class="badge badge-${(r.status || 'pending').toLowerCase()}">${r.status}</span>
                </div>
                <div class="report-item-area">📍 ${esc(r.area)}</div>
                <div class="report-item-desc">${esc(r.description)}</div>
                <div class="report-item-meta">
                  <span>Reported ${fmt(r.created_at)}</span>
                  ${r.reporter ? `<span>• by ${esc(r.reporter)}</span>` : ''}
                </div>
              </div>
            </div>
          `).join('');
        }
      }

      // Render Leaderboard
      const lbFeed = $('#leaderboard-feed');
      if (lbFeed) {
        if (leaderboard.length === 0) {
          lbFeed.innerHTML = `<p class="card-subtitle" style="text-align:center;padding:12px;">Be the first citizen to report and earn eco points.</p>`;
        } else {
          const medals = ['🥇', '🥈', '🥉'];
          lbFeed.innerHTML = leaderboard.map((user, i) => `
            <div class="leader-item">
              <div class="leader-rank">
                <span class="rank-badge">${medals[i] || (i + 1) + '.'}</span>
                <span>${esc(user.name)}</span>
              </div>
              <span class="leader-points">${user.points} pts</span>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      console.error('Dashboard loader error:', err);
    }
  },

  report: async () => {
    if (!me) {
      const mount = $('#wizard-mount');
      if (mount) {
        mount.innerHTML = `
          <div style="text-align:center;padding:28px 16px;">
            <div style="font-size:2.8rem;margin-bottom:10px;">🔐</div>
            <h2 style="margin-bottom:8px;">Sign In to File a Report</h2>
            <p class="card-subtitle" style="margin-bottom:20px;">
              Please log in with your contact info so we can update you on resolution progress and award your eco points.
            </p>
            <button class="btn btn-primary" id="wizard-auth-trigger">Sign In / Register</button>
          </div>
        `;
        $('#wizard-auth-trigger').onclick = () => openAuthModal('login');
      }
      return;
    }
    drawWiz();
  },

  pickup: async () => {
    if (!me) {
      const feed = $('#pickup-list-feed');
      if (feed) {
        feed.innerHTML = `
          <div style="text-align:center;padding:24px 14px;">
            <p class="card-subtitle">Sign in to view and track your doorstep pickup requests.</p>
            <button class="btn btn-outline btn-sm" style="margin-top:12px;" onclick="openAuthModal('login')">Sign In</button>
          </div>
        `;
      }
      return;
    }

    try {
      const list = await api('/pickups/mine');
      const feed = $('#pickup-list-feed');
      if (feed) {
        if (list.length === 0) {
          feed.innerHTML = `<p class="card-subtitle" style="text-align:center;padding:20px;">No pickups scheduled yet.</p>`;
        } else {
          feed.innerHTML = list.map(p => `
            <div class="report-item" style="margin-bottom:10px;">
              <div class="report-item-main">
                <div class="report-item-top">
                  <span class="report-item-title">${esc(p.type)}</span>
                  <span class="badge badge-${(p.status || 'scheduled').toLowerCase()}">${p.status}</span>
                </div>
                <div class="report-item-area">📍 ${esc(p.address)}</div>
                <div class="report-item-meta">
                  ${p.pdate ? `<span>Date: <b>${esc(p.pdate)}</b></span> • ` : ''}
                  <span>Requested ${fmt(p.created_at)}</span>
                </div>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      toast(err.message);
    }
  },

  track: async () => {
    if (!me) {
      const feed = $('#track-complaints-feed');
      if (feed) {
        feed.innerHTML = `
          <div style="text-align:center;padding:36px 14px;">
            <div style="font-size:2.8rem;margin-bottom:10px;">🔐</div>
            <h2 style="margin-bottom:8px;">Sign In to Track Your Complaints</h2>
            <p class="card-subtitle" style="margin-bottom:20px;">
              View the real-time progress, crew dispatch notes, and photo records for your reported issues.
            </p>
            <button class="btn btn-primary" onclick="openAuthModal('login')">Sign In to EcoTrack</button>
          </div>
        `;
      }
      return;
    }

    try {
      const reports = await api('/reports/mine');
      myReportsCache = reports;
      renderTrackFeed(myReportsCache);
    } catch (err) {
      toast(err.message);
    }
  },

  aware: async () => {
    newGame();
    drawGame();
  },

  admin: async () => {
    if (!me || me.role !== 'admin') {
      const btn = $('#admin-login-trigger');
      if (btn) btn.onclick = () => openAuthModal('login');
      return;
    }

    try {
      const [stats, reports, pickups] = await Promise.all([
        api('/admin/stats'),
        api('/admin/reports'),
        api('/admin/pickups')
      ]);

      adminData = reports;

      // Stats Row
      const getCount = key => (stats.byStatus.find(x => x.k === key) || { n: 0 }).n;
      const statsGrid = $('#admin-stats-grid');
      if (statsGrid) {
        statsGrid.innerHTML = [
          ['⏳ Pending', getCount('Pending'), 'Awaiting crew assignment'],
          ['🚛 Assigned', getCount('Assigned'), 'Crews in progress'],
          ['✅ Resolved', getCount('Resolved'), 'Closed complaints'],
          ['⏱️ Avg Response', (stats.avgResolveHours || '0') + 'h', 'Average turnaround time']
        ].map(([title, val, desc]) => `
          <div class="stat-card">
            <div class="stat-details">
              <div class="stat-num">${val}</div>
              <div class="stat-label" style="font-weight:700;color:var(--text);">${title}</div>
              <div style="font-size:11.5px;color:var(--text-muted);">${desc}</div>
            </div>
          </div>
        `).join('');
      }

      // Hotspot Analytics Initialization
      await loadHotspots();

      // Bind Hotspot Filters
      const hfTime = $('#hf-time');
      if (hfTime) hfTime.onchange = () => { hotspotFilters.timeRange = hfTime.value; loadHotspots(); };

      const hfPriority = $('#hf-priority');
      if (hfPriority) hfPriority.onchange = () => { hotspotFilters.priority = hfPriority.value; loadHotspots(); };

      const hfStatus = $('#hf-status');
      if (hfStatus) hfStatus.onchange = () => { hotspotFilters.status = hfStatus.value; loadHotspots(); };

      const hfCat = $('#hf-category');
      if (hfCat) hfCat.onchange = () => { hotspotFilters.category = hfCat.value; loadHotspots(); };

      const hfReset = $('#hf-reset-btn');
      if (hfReset) hfReset.onclick = resetHotspotFilters;

      // Area & Category Distribution Bars
      const renderBars = (items, targetId) => {
        const container = $(targetId);
        if (!container) return;
        if (!items || items.length === 0) {
          container.innerHTML = `<p class="card-subtitle">No data recorded.</p>`;
          return;
        }
        const max = Math.max(1, ...items.map(x => x.n));
        container.innerHTML = items.map(item => `
          <div class="distribution-bar-row">
            <div class="distribution-bar-label">
              <span>${esc(item.k)}</span>
              <span><b>${item.n}</b></span>
            </div>
            <div class="distribution-bar-track">
              <div class="distribution-bar-fill" style="width: ${(item.n / max) * 100}%;"></div>
            </div>
          </div>
        `).join('');
      };

      renderBars(stats.byArea, '#admin-area-bars');
      renderBars(stats.byCategory, '#admin-category-bars');

      // Admin Queue
      drawAdminQueue();

      // Admin Pickups Queue
      const pickupsFeed = $('#admin-pickups-feed');
      if (pickupsFeed) {
        if (pickups.length === 0) {
          pickupsFeed.innerHTML = `<p class="card-subtitle" style="padding:16px;">No pickup requests found.</p>`;
        } else {
          pickupsFeed.innerHTML = pickups.map(p => `
            <div class="report-item">
              <div class="report-item-main">
                <div class="report-item-top">
                  <span class="report-item-title">${esc(p.type)}</span>
                  <span class="badge badge-${(p.status || 'scheduled').toLowerCase()}">${p.status}</span>
                </div>
                <div class="report-item-area">📍 ${esc(p.address)} (Citizen: <b>${esc(p.name)}</b>)</div>
                <div class="report-item-meta">
                  ${p.pdate ? `<span>Date: <b>${esc(p.pdate)}</b></span> • ` : ''}
                  <span>Received ${fmt(p.created_at)}</span>
                </div>
              </div>
              ${p.status === 'Scheduled' ? `
                <button type="button" class="btn btn-primary btn-sm" data-pickup-complete="${p.id}">
                  Mark Completed
                </button>
              ` : ''}
            </div>
          `).join('');

          $$('[data-pickup-complete]').forEach(btn => {
            btn.onclick = async () => {
              btn.disabled = true;
              try {
                await api(`/admin/pickups/${btn.dataset.pickupComplete}`, 'PATCH', { status: 'Completed' });
                toast('Pickup marked as completed');
                render();
              } catch (e) {
                toast(e.message);
                btn.disabled = false;
              }
            };
          });
        }
      }

      // Filter Chips
      $$('#admin-filter-chips [data-filt]').forEach(btn => {
        btn.onclick = () => {
          adminFilter = btn.dataset.filt;
          $$('#admin-filter-chips [data-filt]').forEach(b => b.classList.toggle('active', b === btn));
          drawAdminQueue();
        };
      });

      // AI Action Plan
      const planBtn = $('#admin-ai-plan-btn');
      if (planBtn) {
        planBtn.onclick = async () => {
          const out = $('#admin-ai-plan-output');
          if (out) out.innerHTML = `<div class="ai-triage-box">🤖 Synthesizing complaint data and computing route strategies...</div>`;
          try {
            const res = await api('/admin/insight', 'POST');
            if (out) {
              out.innerHTML = `
                <div class="ai-triage-box" style="white-space:pre-wrap;">
                  <b>Weekly Municipal Action Plan:</b>\n\n${esc(res.insight)}
                </div>
              `;
            }
          } catch (e) {
            toast(e.message);
          }
        };
      }
    } catch (err) {
      toast(err.message);
    }
  }
};

// ==========================================================================
// Hotspot Analytics Logic
// ==========================================================================

async function loadHotspots() {
  const summaryMount = $('#hotspot-summary-mount');
  const rankedMount = $('#hotspot-ranked-mount');

  if (summaryMount) {
    summaryMount.innerHTML = `<div class="loading-skeleton-box">⚡ Computing waste clusters and analyzing complaint history...</div>`;
  }
  if (rankedMount) {
    rankedMount.innerHTML = `<div class="loading-skeleton-box">Loading ranked priority zones...</div>`;
  }

  try {
    const query = new URLSearchParams(hotspotFilters).toString();
    const data = await api(`/admin/hotspots?${query}`);
    hotspotData = data;
    renderHotspotSummary(data.summary);
    renderHotspotMap(data.hotspots);
    renderHotspotRanked(data.hotspots);
  } catch (err) {
    if (summaryMount) {
      summaryMount.innerHTML = `
        <div class="error-state-box">
          <b>Failed to load hotspot analytics:</b> ${esc(err.message)}
          <div style="margin-top:10px;"><button type="button" class="btn btn-outline btn-sm" id="hotspot-retry-btn">Retry Analysis</button></div>
        </div>
      `;
      const retryBtn = $('#hotspot-retry-btn');
      if (retryBtn) retryBtn.onclick = () => loadHotspots();
    }
    if (rankedMount) rankedMount.innerHTML = '';
  }
}

function renderHotspotSummary(summary) {
  const mount = $('#hotspot-summary-mount');
  if (!mount) return;

  mount.innerHTML = `
    <div class="hotspot-summary-grid">
      <div class="hotspot-summary-card">
        <span class="hotspot-summary-title">🚨 Critical Hotspots</span>
        <div class="hotspot-summary-value" style="color:var(--danger);">${summary.criticalAreasCount}</div>
        <span class="hotspot-summary-desc">Areas with open High-priority waste</span>
      </div>

      <div class="hotspot-summary-card">
        <span class="hotspot-summary-title">⏳ Unresolved Issues</span>
        <div class="hotspot-summary-value" style="color:var(--warning);">${summary.totalUnresolved}</div>
        <span class="hotspot-summary-desc">Pending or Assigned across areas</span>
      </div>

      <div class="hotspot-summary-card">
        <span class="hotspot-summary-title">📍 Mapped GPS Zones</span>
        <div class="hotspot-summary-value" style="color:var(--success);">${summary.geocodedAreasCount} / ${summary.totalAreas}</div>
        <span class="hotspot-summary-desc">Areas with real coordinates recorded</span>
      </div>

      <div class="hotspot-summary-card">
        <span class="hotspot-summary-title">🏆 Top Urgency Area</span>
        <div class="hotspot-summary-value" style="font-size:1.15rem;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(summary.highestPriorityArea || 'None')}">
          ${esc(summary.highestPriorityArea || 'None')}
        </div>
        <span class="hotspot-summary-desc">Ranked highest by urgency score</span>
      </div>
    </div>
  `;
}

function renderHotspotMap(hotspots) {
  if (map) {
    map.remove();
    map = null;
  }
  const mapEl = $('#map');
  if (!mapEl) return;

  // Filter spots with real GPS coordinates
  const geocoded = hotspots.filter(h => h.hasCoordinates && h.latitude !== null && h.longitude !== null);

  let center = [26.47, 80.33];
  if (geocoded.length > 0) {
    center = [geocoded[0].latitude, geocoded[0].longitude];
  }

  map = L.map('map').setView(center, geocoded.length > 0 ? 12 : 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);

  hotspotMarkers = [];

  geocoded.forEach(spot => {
    let color = '#16A34A'; // Green = clear / resolved
    if (spot.unresolvedReports > 0) {
      color = spot.highPriorityCount > 0 ? '#DC2626' : '#F59E0B';
    }

    const radius = Math.max(9, Math.min(26, 9 + spot.unresolvedReports * 3));

    const marker = L.circleMarker([spot.latitude, spot.longitude], {
      radius,
      fillColor: color,
      color: '#FFFFFF',
      weight: 2,
      opacity: 1,
      fillOpacity: 0.82
    }).addTo(map);

    marker.bindPopup(`
      <div style="font-family:'Plus Jakarta Sans',sans-serif;font-size:13px;min-width:180px;">
        <div style="font-weight:700;font-size:14px;margin-bottom:4px;color:#0F172A;">${esc(spot.area)}</div>
        <div style="margin-bottom:4px;"><b>Unresolved Complaints:</b> ${spot.unresolvedReports} of ${spot.totalReports}</div>
        <div style="margin-bottom:4px;"><b>High Urgency Issues:</b> ${spot.highPriorityCount}</div>
        <div style="margin-bottom:4px;"><b>Top Category:</b> ${esc(spot.topCategory)}</div>
        <div style="margin-bottom:6px;"><b>Urgency Score:</b> ${spot.urgencyScore}</div>
        <div style="font-size:11px;color:#64748B;">Latest: ${fmt(spot.latestReportAt)}</div>
      </div>
    `);

    hotspotMarkers.push({ area: spot.area, marker, lat: spot.latitude, lng: spot.longitude });
  });

  if (geocoded.length > 1) {
    const bounds = L.latLngBounds(geocoded.map(g => [g.latitude, g.longitude]));
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

function renderHotspotRanked(hotspots) {
  const mount = $('#hotspot-ranked-mount');
  if (!mount) return;

  if (hotspots.length === 0) {
    mount.innerHTML = `
      <div class="empty-state-box">
        <div style="font-size:2.4rem;margin-bottom:8px;">✨</div>
        <h4 style="margin-bottom:4px;">No Waste Hotspots Matching Criteria</h4>
        <p class="card-subtitle" style="margin-bottom:14px;">No complaints match the selected time window, priority, category or status filters.</p>
        <button type="button" class="btn btn-outline btn-sm" id="empty-reset-btn">Reset All Filters</button>
      </div>
    `;
    const btn = $('#empty-reset-btn');
    if (btn) btn.onclick = resetHotspotFilters;
    return;
  }

  mount.innerHTML = `
    <div class="hotspot-ranked-list">
      ${hotspots.map((spot, i) => {
        const isCritical = spot.unresolvedReports > 0 && spot.highPriorityCount > 0;
        const urgencyLevel = isCritical ? 'critical' : (spot.unresolvedReports > 0 ? 'moderate' : 'low');

        return `
          <div class="hotspot-card-item">
            <div class="hotspot-card-left">
              <div class="hotspot-rank-badge ${i === 0 && isCritical ? 'top-critical' : ''}">
                #${i + 1}
              </div>

              <div class="hotspot-details-wrap">
                <div class="hotspot-area-heading">
                  <span class="hotspot-area-name">${esc(spot.area)}</span>
                  ${spot.hasCoordinates
                    ? `<span class="coords-indicator has-gps" title="Recorded GPS coordinates">📍 ${spot.latitude}, ${spot.longitude}</span>`
                    : `<span class="coords-indicator no-gps" title="Only street text provided">⚠️ No GPS Coordinates</span>`
                  }
                  <span class="urgency-score-badge ${urgencyLevel}">
                    ${urgencyLevel === 'critical' ? '🚨 Critical' : (urgencyLevel === 'moderate' ? '⚡ Moderate' : '✓ Normal')} (Score: ${spot.urgencyScore})
                  </span>
                </div>

                <div class="hotspot-meta-row">
                  <span><b>${spot.unresolvedReports}</b> open / ${spot.totalReports} total</span>
                  ${spot.highPriorityCount > 0 ? `<span style="color:var(--danger);font-weight:700;">⚠️ ${spot.highPriorityCount} High Urgency</span>` : ''}
                  <span>Type: <b>${esc(spot.topCategory)}</b></span>
                  <span>Latest: ${fmt(spot.latestReportAt)}</span>
                </div>
              </div>
            </div>

            <div style="display:flex;gap:8px;flex-shrink:0;">
              ${spot.hasCoordinates ? `
                <button type="button" class="btn btn-outline btn-sm" data-focus-area="${esc(spot.area)}">
                  📍 Map View
                </button>
              ` : ''}
              <button type="button" class="btn btn-primary btn-sm" data-filter-queue="${esc(spot.area)}">
                View Queue
              </button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  // Attach Focus and Queue filter buttons
  $$('[data-focus-area]').forEach(btn => {
    btn.onclick = () => {
      const areaName = btn.dataset.focusArea;
      const found = hotspotMarkers.find(m => m.area === areaName);
      if (found && map) {
        map.setView([found.lat, found.lng], 15);
        found.marker.openPopup();
        $('#map')?.scrollIntoView({ behavior: 'smooth' });
      }
    };
  });

  $$('[data-filter-queue]').forEach(btn => {
    btn.onclick = () => {
      const areaName = btn.dataset.filterQueue;
      const target = $('#priority-queue-section');
      if (target) {
        target.scrollIntoView({ behavior: 'smooth' });
        const queueContainer = $('#admin-queue-feed');
        if (queueContainer) {
          const areaReports = adminData.filter(r => r.area === areaName);
          toast(`Filtered priority queue to ${areaName} (${areaReports.length} complaints)`);
          queueContainer.innerHTML = areaReports.map(r => `
            <div class="report-item">
              ${r.photo ? `<img src="/uploads/${r.photo}" class="report-thumb" alt="Photo">` : ''}
              <div class="report-item-main">
                <div class="report-item-top">
                  <span class="report-item-title">#${r.id} ${esc(r.category)}</span>
                  <span class="badge badge-${(r.priority || 'medium').toLowerCase()}">${r.priority}</span>
                  <span class="badge badge-${(r.status || 'pending').toLowerCase()}">${r.status}</span>
                </div>
                <div class="report-item-area">📍 ${esc(r.area)} ${r.reporter ? `(Filed by: <b>${esc(r.reporter)}</b>)` : ''}</div>
                <div class="report-item-desc">${esc(r.description)}</div>
                <div class="report-item-meta">
                  <span>${fmt(r.created_at)}</span>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;gap:6px;">
                ${r.status === 'Pending' ? `
                  <button type="button" class="btn btn-primary btn-sm" data-admin-action="${r.id}" data-target-status="Assigned">
                    Assign Crew
                  </button>
                ` : ''}
                ${r.status === 'Assigned' ? `
                  <button type="button" class="btn btn-accent btn-sm" data-admin-action="${r.id}" data-target-status="Resolved">
                    Mark Resolved
                  </button>
                ` : ''}
              </div>
            </div>
          `).join('') || `<p class="card-subtitle">No complaints recorded for ${esc(areaName)}.</p>`;
          
          $$('[data-admin-action]').forEach(b => {
            b.onclick = async () => {
              b.disabled = true;
              try {
                await api(`/admin/reports/${b.dataset.adminAction}`, 'PATCH', {
                  status: b.dataset.targetStatus,
                  note: `Status updated to ${b.dataset.targetStatus} by Admin`
                });
                toast(`Complaint #${b.dataset.adminAction} marked ${b.dataset.targetStatus}`);
                render();
              } catch (e) {
                toast(e.message);
                b.disabled = false;
              }
            };
          });
        }
      }
    };
  });
}

function resetHotspotFilters() {
  hotspotFilters = { timeRange: 'all', priority: 'all', status: 'unresolved', category: 'all' };
  const hfTime = $('#hf-time'); if (hfTime) hfTime.value = 'all';
  const hfPriority = $('#hf-priority'); if (hfPriority) hfPriority.value = 'all';
  const hfStatus = $('#hf-status'); if (hfStatus) hfStatus.value = 'unresolved';
  const hfCat = $('#hf-category'); if (hfCat) hfCat.value = 'all';
  loadHotspots();
}

function drawAdminQueue() {
  const container = $('#admin-queue-feed');
  if (!container) return;

  const filtered = adminData.filter(r => adminFilter === 'All' || r.status === adminFilter);
  if (filtered.length === 0) {
    container.innerHTML = `<p class="card-subtitle" style="padding:16px;">No complaints match the filter "${adminFilter}".</p>`;
    return;
  }

  container.innerHTML = filtered.map(r => `
    <div class="report-item">
      ${r.photo ? `<img src="/uploads/${r.photo}" class="report-thumb" alt="Photo">` : ''}
      <div class="report-item-main">
        <div class="report-item-top">
          <span class="report-item-title">#${r.id} ${esc(r.category)}</span>
          <span class="badge badge-${(r.priority || 'medium').toLowerCase()}">${r.priority}</span>
          <span class="badge badge-${(r.status || 'pending').toLowerCase()}">${r.status}</span>
        </div>
        <div class="report-item-area">📍 ${esc(r.area)} ${r.reporter ? `(Filed by: <b>${esc(r.reporter)}</b>)` : ''}</div>
        <div class="report-item-desc">${esc(r.description)}</div>
        <div class="report-item-meta">
          <span>${fmt(r.created_at)}</span>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${r.status === 'Pending' ? `
          <button type="button" class="btn btn-primary btn-sm" data-admin-action="${r.id}" data-target-status="Assigned">
            Assign Crew
          </button>
        ` : ''}
        ${r.status === 'Assigned' ? `
          <button type="button" class="btn btn-accent btn-sm" data-admin-action="${r.id}" data-target-status="Resolved">
            Mark Resolved
          </button>
        ` : ''}
        ${r.status === 'Resolved' ? `
          <span style="font-size:12px;color:var(--success);font-weight:700;">✓ Completed</span>
        ` : ''}
      </div>
    </div>
  `).join('');

  $$('[data-admin-action]').forEach(btn => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await api(`/admin/reports/${btn.dataset.adminAction}`, 'PATCH', {
          status: btn.dataset.targetStatus,
          note: `Status updated to ${btn.dataset.targetStatus} by Admin`
        });
        toast(`Complaint #${btn.dataset.adminAction} marked ${btn.dataset.targetStatus}`);
        render();
      } catch (e) {
        toast(e.message);
        btn.disabled = false;
      }
    };
  });
}

// ==========================================================================
// Event Binding & Global Listeners
// ==========================================================================

function bindGlobalEvents() {
  // Navigation Routing
  $$('[data-goto]').forEach(btn => {
    btn.onclick = () => {
      tab = btn.dataset.goto;
      render();
    };
  });

  // Pickup Submission
  $$('#pickup-types-container .pickup-type-card').forEach(card => {
    card.onclick = () => {
      $$('#pickup-types-container .pickup-type-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
    };
  });

  const pickupSubmitBtn = $('#pk-submit-btn');
  if (pickupSubmitBtn) {
    pickupSubmitBtn.onclick = async () => {
      if (!me) return openAuthModal('login');
      const activeTypeCard = $('#pickup-types-container .pickup-type-card.active');
      const address = ($('#pk-address')?.value || '').trim();
      const pdate = $('#pk-date')?.value || '';

      if (!address) return toast('Please enter the pickup address');
      const type = activeTypeCard ? activeTypeCard.dataset.type : 'Household dry waste';

      pickupSubmitBtn.disabled = true;
      try {
        await api('/pickups', 'POST', { type, address, pdate });
        confetti();
        try {
          const profile = await api('/me');
          me = profile;
          localStorage.setItem('cl_user', JSON.stringify(me));
          const pill = $('#user-pill');
          if (pill && me) {
            pill.innerHTML = `
              <div class="user-profile-badge">
                <div class="user-avatar-mini">${esc(me.name.charAt(0).toUpperCase())}</div>
                <span>${esc(me.name)}</span>
                <span class="user-points-pill">🏅 ${me.points || 0} pts</span>
                <button type="button" class="btn btn-outline btn-sm" id="logout-btn" style="padding:2px 8px;font-size:11px;margin-left:4px;">Sign Out</button>
              </div>
            `;
            const lo = $('#logout-btn');
            if (lo) lo.onclick = logout;
          }
        } catch (e) {}
        toast('Pickup scheduled successfully');
        render();
      } catch (e) {
        toast(e.message);
        pickupSubmitBtn.disabled = false;
      }
    };
  }

  // Segregation Coach Ask
  const coachBtn = $('#coach-ask-btn');
  if (coachBtn) {
    coachBtn.onclick = async () => {
      const qInput = $('#coach-q');
      const langSelect = $('#coach-lang');
      const answerBox = $('#coach-answer-box');
      const q = (qInput?.value || '').trim();

      if (!q) return toast('Please enter an item name or question');
      if (answerBox) answerBox.innerHTML = `<div class="ai-triage-box">🤖 Checking disposal regulations...</div>`;

      try {
        const res = await api('/awareness/ask', 'POST', { q, lang: langSelect?.value });
        if (answerBox) {
          answerBox.innerHTML = `
            <div class="ai-triage-box" style="white-space:pre-wrap;">
              <b>Segregation Recommendation:</b>\n${esc(res.answer)}
            </div>
          `;
        }
      } catch (e) {
        toast(e.message);
      }
    };
  }

  // Prompt Chips
  $$('.prompt-chip').forEach(chip => {
    chip.onclick = () => {
      const qInput = $('#coach-q');
      if (qInput) {
        qInput.value = chip.dataset.ask;
        const askBtn = $('#coach-ask-btn');
        if (askBtn) askBtn.click();
      }
    };
  });

  // Track Search Box
  const searchBox = $('#track-search-box');
  if (searchBox) {
    searchBox.oninput = () => {
      trackSearch = searchBox.value;
      renderTrackFeed(myReportsCache);
    };
  }
}

// Bind Modal Events
function bindModal() {
  $('#modal-close-btn').onclick = closeAuthModal;
  
  $('#tab-login-btn').onclick = () => openAuthModal('login');
  $('#tab-register-btn').onclick = () => openAuthModal('register');

  const modal = $('#auth-modal');
  if (modal) {
    modal.onclick = e => {
      if (e.target === modal) closeAuthModal();
    };
  }

  const form = $('#auth-form');
  if (form) {
    form.onsubmit = async e => {
      e.preventDefault();
      const errEl = $('#auth-error');
      errEl.style.display = 'none';

      const contact = ($('#modal-contact').value || '').trim();
      const password = $('#modal-pass').value;
      const name = ($('#modal-name')?.value || '').trim();

      if (!contact || !password) {
        errEl.textContent = 'Please fill in both contact and password.';
        errEl.style.display = 'block';
        return;
      }

      const submitBtn = $('#modal-submit-btn');
      submitBtn.disabled = true;

      try {
        if (authModalMode === 'register') {
          if (!name) throw new Error('Please enter your full name.');
          const res = await api('/auth/register', 'POST', { name, contact, password });
          setAuth(res);
        } else {
          const res = await api('/auth/login', 'POST', { contact, password });
          setAuth(res);
        }
      } catch (err) {
        errEl.textContent = err.message;
        errEl.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
      }
    };
  }
}

// ==========================================================================
// Main App Renderer
// ==========================================================================

async function render() {
  clearInterval(cyc);

  // 1. Navigation items
  const NAV_ITEMS = [
    ['dashboard', '📊 Overview'],
    ['report', '📢 Report Waste'],
    ['pickup', '🚚 Pickups'],
    ['track', '🔍 Track Issues'],
    ['aware', '💡 Learn & Game']
  ];

  if (me && me.role === 'admin') {
    NAV_ITEMS.push(['admin', '🛡️ Admin Center']);
  }

  // Render Nav
  const nav = $('#nav');
  if (nav) {
    nav.innerHTML = NAV_ITEMS.map(([id, label]) => `
      <button type="button" class="nav-btn ${tab === id ? 'active' : ''}" data-nav="${id}">
        ${label}
      </button>
    `).join('');

    $$('#nav [data-nav]').forEach(btn => {
      btn.onclick = () => {
        tab = btn.dataset.nav;
        render();
      };
    });
  }

  // Render User Profile Pill
  const userPill = $('#user-pill');
  if (userPill) {
    if (me) {
      userPill.innerHTML = `
        <div class="user-profile-badge">
          <div class="user-avatar-mini">${esc(me.name.charAt(0).toUpperCase())}</div>
          <span>${esc(me.name)}</span>
          <span class="user-points-pill">🏅 ${me.points || 0} pts</span>
          <button type="button" class="btn btn-outline btn-sm" id="logout-btn" style="padding:2px 8px;font-size:11px;margin-left:4px;">Sign Out</button>
        </div>
      `;
      $('#logout-btn').onclick = logout;
    } else {
      userPill.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" id="signin-header-btn">
          Sign In
        </button>
      `;
      $('#signin-header-btn').onclick = () => openAuthModal('login');
    }
  }

  // Render Main Content
  const app = $('#app');
  if (app && Views[tab]) {
    app.innerHTML = Views[tab]();
    bindGlobalEvents();

    try {
      if (Loaders[tab]) await Loaders[tab]();
    } catch (err) {
      if (/log in|unauthorized/i.test(err.message)) logout();
      else toast(err.message);
    }
  }
}

// Logo Click Handler (Returns to Dashboard)
$('#logo').onclick = () => { tab = 'dashboard'; render(); };

// Theme Toggle
$('#th').onclick = () => {
  const current = document.documentElement.dataset.theme;
  const target = current === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = target;
  localStorage.setItem('cl_theme', target);
};

// Initial App Boot
bindModal();
render();
