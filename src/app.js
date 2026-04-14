// ═══════════════════════════════════════════════════════════
//  AuctionAdda — Cricket Auction Platform
//  Persistence: Firebase Firestore
// ═══════════════════════════════════════════════════════════

// ── Firebase init ─────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyAp28g1wT1zboQFe1hIgpOUyn5OD1jFS7w",
  authDomain:        "auctionadda-b71f2.firebaseapp.com",
  projectId:         "auctionadda-b71f2",
  storageBucket:     "auctionadda-b71f2.firebasestorage.app",
  messagingSenderId: "114643723445",
  appId:             "1:114643723445:web:e82c4e565d576dad700afc",
  measurementId:     "G-YT6C571K7D"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Firestore collections
const COL_USERS = 'users';
const COL_TOURS = 'tournaments';
// LocalStorage keys (session + image cache only)
const LS_SESSION = 'auctionadda_session';
const LS_IMAGES  = 'auctionadda_images';

const CH_HEADERS = {
  'api-key':       'cr!CkH3r0s',
  'device-type':   'Chrome: 146.0.0.0',
  'Authorization': '025332d0-2e59-11f1-b84a-f35fc708faba',
  'Udid':          'cc5af7433c5291af5c7b169e7a7c9013'
};

const DEFAULT_CATEGORIES = [
  { id:'icon',      label:'Icon',       icon:'👑', basePrice:2000000, bidStep:100000, color:'#7F77DD' },
  { id:'captain',   label:'Captain',    icon:'🎖️', basePrice:1500000, bidStep:100000, color:'#EF9F27' },
  { id:'superstar', label:'Super Star', icon:'⭐', basePrice:1000000, bidStep:50000,  color:'#E24B4A' },
  { id:'star',      label:'Star',       icon:'🌟', basePrice:500000,  bidStep:50000,  color:'#378ADD' },
  { id:'brave',     label:'Brave',      icon:'🦁', basePrice:200000,  bidStep:25000,  color:'#1D9E75' },
];

// ── State ─────────────────────────────────────────────────
let state = {
  users: [],
  currentUserId: null,
  currentTournamentId: null,
  tournaments: []
};

// ── Image cache (base64 stays in localStorage, not Firestore) ──
function stripLargeData(obj) {
  // Deep clone, then remove any base64 blobs (data: URIs) to stay under Firestore 1MB limit
  const clone = JSON.parse(JSON.stringify(obj));
  if (typeof clone.bannerImage === 'string' && clone.bannerImage.startsWith('data:'))
    clone.bannerImage = null;
  (clone.teams||[]).forEach(tm => {
    if (typeof tm.teamLogo  === 'string' && tm.teamLogo.startsWith('data:'))  tm.teamLogo  = null;
    if (typeof tm.ownerPhoto === 'string' && tm.ownerPhoto.startsWith('data:')) tm.ownerPhoto = null;
  });
  (clone.players||[]).forEach(p => { p.photoLocal = null; });
  return clone;
}
function saveImageCache() {
  try {
    const cache = {};
    state.tournaments.forEach(t => {
      if (t.bannerImage && t.bannerImage.startsWith('data:')) cache[`b_${t.id}`] = t.bannerImage;
      (t.teams||[]).forEach(tm => {
        if (tm.teamLogo   && tm.teamLogo.startsWith('data:'))   cache[`tl_${tm.id}`] = tm.teamLogo;
        if (tm.ownerPhoto && tm.ownerPhoto.startsWith('data:')) cache[`tp_${tm.id}`] = tm.ownerPhoto;
      });
      (t.players||[]).forEach(p => {
        if (p.photoLocal) cache[`pl_${p.id}`] = p.photoLocal;
      });
    });
    localStorage.setItem(LS_IMAGES, JSON.stringify(cache));
  } catch(e) { console.warn('Image cache save failed', e); }
}
function mergeImageCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(LS_IMAGES) || '{}');
    state.tournaments.forEach(t => {
      if (!t.bannerImage && cache[`b_${t.id}`])  t.bannerImage = cache[`b_${t.id}`];
      (t.teams||[]).forEach(tm => {
        if (!tm.teamLogo   && cache[`tl_${tm.id}`]) tm.teamLogo   = cache[`tl_${tm.id}`];
        if (!tm.ownerPhoto && cache[`tp_${tm.id}`]) tm.ownerPhoto = cache[`tp_${tm.id}`];
      });
      (t.players||[]).forEach(p => {
        if (!p.photoLocal && cache[`pl_${p.id}`]) p.photoLocal = cache[`pl_${p.id}`];
      });
    });
  } catch(e) {}
}

// ── Firestore save (fire-and-forget) ──────────────────────
function save() {
  // Session (currentUserId / currentTournamentId) → localStorage
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify({
      currentUserId: state.currentUserId,
      currentTournamentId: state.currentTournamentId
    }));
  } catch(e) {}

  // Base64 images → localStorage cache
  saveImageCache();

  // Users → Firestore
  state.users.forEach(u => {
    db.collection(COL_USERS).doc(u.id).set(u).catch(e => console.error('User save failed', e));
  });

  // Tournaments → Firestore (strip base64 first)
  state.tournaments.forEach(t => {
    db.collection(COL_TOURS).doc(t.id).set(stripLargeData(t))
      .catch(e => console.error('Tournament save failed', e));
  });
}

// Kept for backwards compatibility — state is always fresh via listeners
function load() { /* no-op — Firestore listeners keep state current */ }

// ── Async load on boot ────────────────────────────────────
async function loadFromFirestore() {
  const [usersSnap, toursSnap] = await Promise.all([
    db.collection(COL_USERS).get(),
    db.collection(COL_TOURS).get()
  ]);
  state.users       = usersSnap.docs.map(d => d.data());
  state.tournaments = toursSnap.docs.map(d => d.data());

  // Restore session from localStorage
  try {
    const s = JSON.parse(localStorage.getItem(LS_SESSION) || '{}');
    state.currentUserId       = s.currentUserId       || null;
    state.currentTournamentId = s.currentTournamentId || null;
  } catch(e) {}

  mergeImageCache();
}

// ── Helpers ───────────────────────────────────────────────
const uid      = () => Math.random().toString(36).slice(2, 9);
const fmt      = n  => '₹' + Number(n).toLocaleString('en-IN');
const esc      = s  => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const vv       = id => { const el = document.getElementById(id); return el ? el.value : ''; };
const initials = name => name.split(' ').slice(0,2).map(w=>w[0]||'').join('').toUpperCase() || '?';

const currentUser       = () => state.users.find(u => u.id === state.currentUserId) || null;
const isAdmin           = () => { const u = currentUser(); return u && u.role === 'admin'; };
const currentTournament = () => state.tournaments.find(t => t.id === state.currentTournamentId) || null;
const getTour     = id => state.tournaments.find(t => t.id === id);
const getTeam     = id => { const t = currentTournament(); return t ? (t.teams||[]).find(x=>x.id===id) : null; };
const getPlayer   = id => { const t = currentTournament(); return t ? (t.players||[]).find(x=>x.id===id) : null; };
const getCat      = id => { const t = currentTournament(); return t ? (t.categories||[]).find(c=>c.id===id) : null; };

function getTeamFromTour(tour, id) { return (tour.teams||[]).find(t=>t.id===id); }

function teamBudget(team, tour) {
  const t = tour || currentTournament(); if (!t) return 0;
  let spent = 0;
  Object.values(t.auction.sold||{}).forEach(s => { if (s.teamId === team.id) spent += s.price; });
  return (t.budget || 0) - spent;
}
function teamSquad(teamId, tour) {
  const t = tour || currentTournament(); if (!t) return [];
  return Object.entries(t.auction.sold||{})
    .filter(([,s]) => s.teamId === teamId)
    .map(([pid,s]) => ({ player:(t.players||[]).find(p=>p.id===pid), price:s.price }))
    .filter(x => x.player);
}

function catBadgeHtml(catId, cats) {
  const list = cats || (currentTournament()||{}).categories || [];
  const cat = list.find(c=>c.id===catId);
  if (!cat) return `<span class="cat-badge" style="background:#eee;color:#555">${esc(catId||'')}</span>`;
  return `<span class="cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${esc(cat.label)}</span>`;
}
function playerPhotoHtml(p, size) {
  const src = p.photoLocal || p.photo || '';
  const sz  = size || 48;
  if (src) return `<img src="${src}" alt="${esc(p.name)}" onerror="this.style.display='none'" style="width:${sz}px;height:${sz}px;border-radius:50%;object-fit:cover;display:block;"/>`;
  return `<span style="font-size:${Math.round(sz*.35)}px;font-weight:600;color:var(--muted)">${initials(p.name)}</span>`;
}
function showErr(el, msg) { if(el){ el.textContent=msg; el.style.display='block'; } }
function baseUrl() { return window.location.origin + window.location.pathname; }

// ── Nav state ─────────────────────────────────────────────
let currentPage  = 'login';
let playerFilter = 'all';
let auctionCatId = null;
let statsOpenUsers = new Set();
let statsCache = {};
let pollTimer = null;

// ── Check URL for team token or viewer token ──────────────
function getUrlTeamToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('team') || null;
}
function getUrlViewToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get('view') || null;
}

// ══════════════════════════════════════════════════════════
//  MASTER RENDER
// ══════════════════════════════════════════════════════════
function render() {
  stopAllListeners();
  const root = document.getElementById('root'); if (!root) return;

  // Public viewer link — ?view=TOURNAMENT_ID, no login required
  const viewToken = getUrlViewToken();
  if (viewToken) {
    const viewTour = state.tournaments.find(t => t.id === viewToken);
    root.innerHTML = renderPublicViewer(viewToken);
    if (viewTour) {
      listenToTournament(viewToken, () => {
        const r = document.getElementById('root');
        if (r) r.innerHTML = renderPublicViewer(viewToken);
      });
    }
    return;
  }

  // Team bidding link — ?team=TOKEN, no login required
  const teamToken = getUrlTeamToken();
  if (teamToken) {
    root.innerHTML = renderTeamBidPage(teamToken);
    const teamTour = state.tournaments.find(t => (t.teams||[]).find(tm => (tm.bidToken||'').trim() === teamToken.trim()));
    if (teamTour) {
      listenToTournament(teamTour.id, () => {
        const r = document.getElementById('root');
        if (r) r.innerHTML = renderTeamBidPage(teamToken);
      });
    }
    return;
  }

  const u = currentUser();
  if (!u) {
    if (currentPage === 'signup') { root.innerHTML = renderSignup(); return; }
    root.innerHTML = renderLogin();
    return;
  }

  if (!currentTournament() && currentPage !== 'home' && currentPage !== 'tournaments') currentPage = 'home';
  const adminHtml = renderAdminShell();
  root.innerHTML = adminHtml;

  // Attach live listener for the auction page so team bids are reflected immediately
  if (currentPage === 'auction' && state.currentTournamentId) {
    listenToTournament(state.currentTournamentId, () => {
      const r = document.getElementById('root');
      if (r && currentPage === 'auction') r.innerHTML = renderAdminShell();
    });
  }
}

// ── Real-time Firestore listeners (replace setInterval) ───
let _unsubTour  = null; // single-tournament listener (viewer live / team page)
let _unsubAllTours = null; // all-tournaments listener (viewer landing)

function listenToTournament(tourId, onUpdate) {
  stopAllListeners();
  _unsubTour = db.collection(COL_TOURS).doc(tourId).onSnapshot(snap => {
    if (!snap.exists) return;
    const fresh = snap.data();
    // Update state FIRST, then merge image cache into the updated entry
    const idx = state.tournaments.findIndex(t => t.id === tourId);
    if (idx >= 0) state.tournaments[idx] = fresh;
    else state.tournaments.push(fresh);
    mergeImageCache(); // re-apply local image cache to the now-updated entry
    onUpdate();
  }, err => console.error('Firestore listener error', err));
}

function listenToAllTournaments(onUpdate) {
  stopAllListeners();
  _unsubAllTours = db.collection(COL_TOURS).onSnapshot(snap => {
    state.tournaments = snap.docs.map(d => d.data());
    mergeImageCache();
    onUpdate();
  }, err => console.error('Firestore all-tours listener error', err));
}

function stopAllListeners() {
  if (_unsubTour)     { _unsubTour();     _unsubTour = null;     }
  if (_unsubAllTours) { _unsubAllTours(); _unsubAllTours = null; }
}

// Legacy poll helpers (kept so no call-site breaks; now replaced by Firestore listeners)
function startPoll() {}
function startTeamBidPoll() {}
function clearPoll() { stopAllListeners(); }

// ══════════════════════════════════════════════════════════
//  AUTH — LOGIN (admin only, cricket-themed)
// ══════════════════════════════════════════════════════════
function renderLogin() {
  return `
  <div class="auth-page">
    <div class="auth-left">
      <div class="auth-left-content">
        <div class="auth-cricket-grid">
          ${['🏏','👑','🏆','⭐','🎖️','🦁','🔥','🌟','🏅','💥','🎯','🎳'].map(e=>`<div class="cricket-emoji-tile">${e}</div>`).join('')}
        </div>
        <div class="auth-left-overlay">
          <div class="auth-brand-mark">🏏</div>
          <h2>AuctionAdda</h2>
          <p>Run live cricket auctions with real-time bidding, team management, and instant results.</p>
          <div class="auth-feature-list">
            <div class="auth-feature">⚡ Real-time bidding via shared links</div>
            <div class="auth-feature">📊 CricHeroes player stats & profiles</div>
            <div class="auth-feature">🏆 Auto-generated PDF squad reports</div>
            <div class="auth-feature">👁️ Public viewer links — share with anyone</div>
          </div>
        </div>
      </div>
    </div>
    <div class="auth-right">
      <div class="auth-card">
        <div class="auth-logo">
          <div class="logo-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2L22 9l-9 9-7-7 9-9z"/><path d="M9 15L2 22"/><path d="M17 6L7 16"/></svg></div>
          <h1 style="font-size:22px;font-weight:700">AuctionAdda</h1>
        </div>
        <div class="auth-title">Admin sign in</div>
        <div class="auth-subtitle">Manage your cricket auction tournaments</div>
        <div class="form-row"><label>Phone number</label><input id="l-phone" placeholder="10-digit number" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)" autocomplete="username"/></div>
        <div class="form-row"><label>Password</label><input id="l-pass" type="password" placeholder="Your password" autocomplete="current-password"/></div>
        <div id="l-err" style="color:var(--red);font-size:13px;margin-bottom:12px;display:none"></div>
        <button class="btn btn-primary btn-full btn-lg" onclick="doLogin()">Sign in →</button>
        <div style="text-align:center;font-size:13px;color:var(--muted);margin-top:16px">
          No account? <span class="auth-link" onclick="currentPage='signup';render()">Create one</span>
        </div>
        <div style="margin-top:24px;padding:14px;background:var(--blue-light);border-radius:var(--radius-sm);font-size:12px;color:var(--blue);line-height:1.6">
          👁️ <b>Viewers</b> don't need to log in — share the viewer link from the Setup page with anyone.
        </div>
      </div>
    </div>
  </div>`;
}

window.doLogin = function() {
  const phone = vv('l-phone').trim(), pass = vv('l-pass').trim();
  const err   = document.getElementById('l-err');
  if (!phone || !pass) { showErr(err, 'Please fill in all fields.'); return; }
  const user = state.users.find(u => u.phone === phone && u.password === pass && u.role === 'admin');
  if (!user) { showErr(err, 'Phone number or password is incorrect.'); return; }
  state.currentUserId = user.id;
  currentPage = 'home'; save(); render();
};

// ── Signup (admin only) ───────────────────────────────────
function renderSignup() {
  const cricketEmojis = ['🏏','🏆','🎯','⭐','🦁','👑','🎖️','🌟','🏅','🔥','💥','🎳'];
  return `
  <div class="auth-page">
    <div class="auth-left">
      <div class="auth-left-bg">${cricketEmojis.map(e=>`<div>${e}</div>`).join('')}</div>
      <div class="auth-hero-title">
        <h2>Start running<br/>your auction today</h2>
        <p>Create unlimited tournaments, manage teams, and run live auctions — all in one place.</p>
      </div>
    </div>
    <div class="auth-right">
      <div class="auth-card">
        <div class="auth-logo">
          <div class="logo-mark"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2L22 9l-9 9-7-7 9-9z"/><path d="M9 15L2 22"/><path d="M17 6L7 16"/></svg></div>
          <h1 style="font-size:20px;font-weight:700">AuctionAdda</h1>
        </div>
        <div class="auth-title">Create admin account</div>
        <div class="auth-subtitle">Set up your auction admin account</div>
        <div class="grid-2">
          <div class="form-row"><label>Full name</label><input id="s-name" placeholder="Your name"/></div>
          <div class="form-row"><label>Phone number</label><input id="s-phone" placeholder="10 digits" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)"/></div>
        </div>
        <div class="form-row"><label>Email address</label><input id="s-email" type="email" placeholder="you@example.com"/></div>
        <div class="form-row"><label>Password</label><input id="s-pass" type="password" placeholder="Create a password"/></div>
        <div id="s-err" style="color:var(--red);font-size:13px;margin-bottom:12px;display:none"></div>
        <button class="btn btn-primary btn-full btn-lg" onclick="doSignup()" style="margin-top:4px">Create account →</button>
        <div style="text-align:center;font-size:13px;color:var(--muted);margin-top:16px">
          Already have an account? <span class="auth-link" onclick="currentPage='login';render()">Sign in</span>
        </div>
      </div>
    </div>
  </div>`;
}

window.doSignup = function() {
  const name=vv('s-name').trim(), phone=vv('s-phone').trim(), email=vv('s-email').trim(), pass=vv('s-pass').trim();
  const err = document.getElementById('s-err');
  if (!name||!phone||!email||!pass) { showErr(err,'Please fill in all fields.'); return; }
  if (phone.length<10) { showErr(err,'Enter a valid 10-digit phone number.'); return; }
  if (state.users.find(u=>u.phone===phone)) { showErr(err,'An account with this phone already exists.'); return; }
  const newUser = { id:uid(), name, phone, email, password:pass, role:'admin' };
  state.users.push(newUser); state.currentUserId=newUser.id;
  save(); currentPage='home'; render();
};

// ── Viewer link helpers (called from setup page) ──────────
window.copyViewerLink = id => {
  const link = baseUrl() + '?view=' + id;
  navigator.clipboard.writeText(link).then(()=>alert('Viewer link copied!\n\n'+link)).catch(()=>prompt('Copy this link:',link));
};
window.openViewerLink = id => { window.open(baseUrl()+'?view='+id,'_blank'); };

// ══════════════════════════════════════════════════════════
//  PUBLIC VIEWER (no login — ?view=TOURNAMENT_ID)
// ══════════════════════════════════════════════════════════
let viewerTab = 'live';
window.setViewerTab = t => { viewerTab = t; render(); };

function renderPublicViewer(tourId) {
  const t = state.tournaments.find(x => x.id === tourId);
  if (!t) return `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg)"><div style="text-align:center;padding:40px"><div style="font-size:48px;margin-bottom:12px">⏳</div><div style="font-size:16px;font-weight:500">Loading tournament…</div><div style="font-size:13px;color:var(--muted);margin-top:6px">If this keeps showing, the link may be invalid.</div></div></div>`;
  const a = t.auction || {};
  const isLive = a.active && a.currentPlayerId;
  const soldCount = Object.keys(a.sold||{}).length;
  const hammerSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2L22 9l-9 9-7-7 9-9z"/><path d="M9 15L2 22"/><path d="M17 6L7 16"/></svg>`;

  let tabContent = '';
  if (viewerTab==='live')     tabContent = renderPublicLive(t);
  if (viewerTab==='teams')    tabContent = renderPublicTeams(t);
  if (viewerTab==='players')  tabContent = renderPublicPlayers(t);
  if (viewerTab==='results')  tabContent = renderPublicResults(t);

  return `
  <nav>
    <div class="nav-logo"><div class="logo-icon">${hammerSvg}</div>${esc(t.name)}</div>
    <div class="nav-right">
      <span class="nav-badge nav-badge-viewer">👁️ Viewer</span>
      ${isLive?`<span class="tlc-status tlc-status-live" style="font-size:11px"><span class="dot dot-green"></span>Live</span>`:''}
    </div>
  </nav>
  ${t.bannerImage?`<div class="tournament-header"><img class="banner-img" src="${t.bannerImage}"/><div class="banner-content"><div class="banner-name">${esc(t.name)}</div><div class="banner-sub">🏏 Cricket Auction</div></div></div>`:''}
  <div class="viewer-tab-bar">
    <div class="viewer-tab ${viewerTab==='live'?'active':''}" onclick="setViewerTab('live')">${isLive?'<span class="dot dot-green" style="margin-right:4px"></span>':''}Live</div>
    <div class="viewer-tab ${viewerTab==='teams'?'active':''}" onclick="setViewerTab('teams')">Teams <span class="viewer-tab-badge">${(t.teams||[]).length}</span></div>
    <div class="viewer-tab ${viewerTab==='players'?'active':''}" onclick="setViewerTab('players')">Players <span class="viewer-tab-badge">${(t.players||[]).length}</span></div>
    <div class="viewer-tab ${viewerTab==='results'?'active':''}" onclick="setViewerTab('results')">Results${soldCount?` <span class="viewer-tab-badge">${soldCount}</span>`:''}</div>
  </div>
  <div class="page" style="max-width:720px">${tabContent}</div>`;
}

function renderPublicLive(t) {
  const a = t.auction || {};
  const isLive = a.active && a.currentPlayerId;
  if (!isLive) {
    // Show upcoming queue if available
    const queue = a.queue || [];
    const sold = a.sold || {};
    const unsold = a.unsold || [];
    const pending = (t.players||[]).filter(p => !sold[p.id] && !unsold.includes(p.id));
    return `
    <div style="text-align:center;padding:40px 20px 24px">
      <div style="font-size:52px;margin-bottom:12px">⏳</div>
      <div style="font-size:18px;font-weight:600;margin-bottom:6px">Auction not live yet</div>
      <div style="font-size:13px;color:var(--muted)">This page updates automatically when the auction starts.</div>
    </div>
    ${pending.length?`<div class="card"><div class="card-title">Players yet to be auctioned (${pending.length})</div>
    ${pending.slice(0,20).map(p=>{
      const cat=(t.categories||[]).find(c=>c.id===p.categoryId);
      const src=p.photoLocal||p.photo||'';
      return `<div class="viewer-upcoming-row" onclick="showPlayerModal('${p.id}','${t.id}')" style="cursor:pointer">
        <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:var(--bg);flex-shrink:0;display:flex;align-items:center;justify-content:center">
          ${src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
            `<span style="font-size:12px;font-weight:600;color:var(--muted)">${initials(p.name)}</span>`}
        </div>
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:500">${esc(p.name)}</div>
          <div style="font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;margin-top:2px">
            ${cat?`<span class="cat-badge" style="background:${cat.color}22;color:${cat.color};font-size:10px">${cat.icon} ${esc(cat.label)}</span>`:''}${esc(p.role||'')}
          </div>
        </div>
        <div style="font-size:12px;color:var(--green);font-weight:600">${fmt((cat||{}).basePrice||0)}</div>
      </div>`;
    }).join('')}
    ${pending.length>20?`<div style="text-align:center;font-size:12px;color:var(--muted);padding:10px">+${pending.length-20} more players</div>`:''}
    </div>`:''}`;
  }

  const player = (t.players||[]).find(p=>p.id===a.currentPlayerId);
  if (!player) return `<div class="empty">Loading...</div>`;
  const cat = (t.categories||[]).find(c=>c.id===player.categoryId);
  const lead = a.leadTeamId ? (t.teams||[]).find(tm=>tm.id===a.leadTeamId) : null;
  const qIdx = (a.queue||[]).indexOf(a.currentPlayerId);
  const photoSrc = player.photoLocal||player.photo||'';

  // Fetch stats if needed
  if (player.userId && !statsCache[player.userId]) { statsCache[player.userId]='loading'; fetchPlayerStats(player.userId); }

  return `
  <div class="viewer-player-card" onclick="showPlayerModal('${player.id}','${t.id}')" style="cursor:pointer" title="Tap for full stats">
    <div style="width:100px;height:100px;border-radius:50%;overflow:hidden;margin:0 auto 14px;background:var(--bg);display:flex;align-items:center;justify-content:center;border:3px solid ${cat?cat.color:'var(--green)'}">
      ${photoSrc?`<img src="${photoSrc}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
        `<span style="font-size:34px;font-weight:700;color:var(--muted)">${initials(player.name)}</span>`}
    </div>
    <div class="spotlight-name">${esc(player.name)}</div>
    <div style="margin-bottom:4px">${cat?`<span class="cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${esc(cat.label)}</span>`:''}<span style="font-size:12px;color:var(--muted);margin-left:6px">${esc(player.role||'')}</span></div>
    <div class="current-bid-label" style="margin-top:12px">Current bid</div>
    <div class="viewer-bid" id="viewer-bid-amt">${fmt(a.currentBid)}</div>
    <div class="viewer-lead" id="viewer-lead-txt">${lead?`<span style="color:var(--green);font-weight:600">⬆ ${esc(lead.name)} is leading</span>`:'No bids yet'}</div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Player ${qIdx+1} of ${(a.queue||[]).length}</div>
    <div style="font-size:11px;color:var(--muted);margin-top:4px;opacity:.7">Tap for stats</div>
  </div>
  ${renderStatsSection(player.userId||'')}
  <div class="card" style="margin-top:12px">
    <div class="card-title">Teams</div>
    <div class="viewer-teams">
      ${(t.teams||[]).map(tm=>{
        const sq=teamSquad(tm.id,t),spent=sq.reduce((s,x)=>s+x.price,0),budget=(t.budget||0)-spent;
        const pct=t.budget?Math.max(0,Math.round(budget/t.budget*100)):0;
        const logo=tm.teamLogo||null;
        return `<div class="viewer-team-card">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--green);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center">
              ${logo?`<img src="${logo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
                `<span style="color:#fff;font-size:11px;font-weight:700">${initials(tm.name)}</span>`}
            </div>
            <div><div style="font-size:13px;font-weight:500">${esc(tm.name)}</div><div style="font-size:11px;color:var(--muted)">${sq.length} players</div></div>
          </div>
          <div class="budget-bar-wrap"><div class="budget-bar" style="width:${pct}%;background:var(--green)"></div></div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${fmt(budget)} left</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function renderPublicTeams(t) {
  if (!(t.teams||[]).length) return `<div class="empty" style="padding:60px 20px">No teams added yet.</div>`;
  return (t.teams||[]).map(tm => {
    const sq = teamSquad(tm.id,t), spent=sq.reduce((s,x)=>s+x.price,0), remaining=(t.budget||0)-spent;
    const logo=tm.teamLogo||null;
    return `<div class="card">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        <div style="width:56px;height:56px;border-radius:50%;background:var(--green);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(29,158,117,.25)">
          ${logo?`<img src="${logo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
            `<span style="color:#fff;font-size:18px;font-weight:700">${initials(tm.name)}</span>`}
        </div>
        <div>
          <div style="font-size:16px;font-weight:700">${esc(tm.name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px">👤 ${esc(tm.owner||'—')} &bull; ${sq.length} players &bull; Spent ${fmt(spent)}</div>
        </div>
      </div>
      ${sq.length?`<div style="display:flex;flex-wrap:wrap;gap:8px">${sq.sort((a,b)=>b.price-a.price).map(({player:p,price})=>{
        const src=p.photoLocal||p.photo||'';
        return `<div style="display:flex;align-items:center;gap:6px;background:var(--bg);border-radius:8px;padding:6px 10px;cursor:pointer" onclick="showPlayerModal('${p.id}','${t.id}')">
          <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--card-bg);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px">
            ${src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:initials(p.name)}
          </div>
          <div><div style="font-size:12px;font-weight:500">${esc(p.name)}</div><div style="font-size:11px;color:var(--green);font-weight:600">${fmt(price)}</div></div>
        </div>`;
      }).join('')}</div>`:`<div style="font-size:13px;color:var(--muted)">No players yet</div>`}
    </div>`;
  }).join('');
}

function renderPublicPlayers(t) {
  const sold=t.auction.sold||{};
  if (!(t.players||[]).length) return `<div class="empty" style="padding:60px 20px">No players added yet.</div>`;
  return `<div class="grid-3">${(t.players||[]).map(p=>{
    const cat=(t.categories||[]).find(c=>c.id===p.categoryId);
    const soldInfo=sold[p.id];
    const soldTeam=soldInfo?(t.teams||[]).find(tm=>tm.id===soldInfo.teamId):null;
    const src=p.photoLocal||p.photo||'';
    return `<div class="player-card" onclick="showPlayerModal('${p.id}','${t.id}')" style="cursor:pointer">
      <div style="display:flex;gap:10px;margin-bottom:6px">
        <div class="player-pic">${src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
          `<span style="font-size:18px;font-weight:500">${initials(p.name)}</span>`}</div>
        <div style="flex:1;min-width:0">
          <div class="player-name">${esc(p.name)}</div>
          <div class="player-meta">${esc(p.role||'')}${p.country?' · '+esc(p.country):''}</div>
          ${catBadgeHtml(p.categoryId,t.categories)}
        </div>
      </div>
      <div class="player-footer">
        ${soldTeam?`<span class="badge badge-sold">✓ ${esc(soldTeam.name)} — ${fmt(soldInfo.price)}</span>`:
          `<span style="font-size:11px;color:var(--muted)">Base: ${fmt((cat||{}).basePrice||0)}</span>`}
      </div>
    </div>`;
  }).join('')}</div>`;
}

function renderPublicResults(t) {
  const soldEntries=Object.entries(t.auction.sold||{});
  if (!soldEntries.length) return `<div style="text-align:center;padding:60px 20px"><div style="font-size:48px;margin-bottom:12px">📋</div><div style="font-size:16px;font-weight:500">No results yet</div><div style="font-size:13px;color:var(--muted);margin-top:6px">Results appear as players are sold.</div></div>`;
  const totalSpend=soldEntries.reduce((s,[,x])=>s+x.price,0);
  const allSold=soldEntries.map(([pid,s])=>({player:(t.players||[]).find(p=>p.id===pid),team:(t.teams||[]).find(tm=>tm.id===s.teamId),price:s.price})).filter(x=>x.player&&x.team).sort((a,b)=>b.price-a.price);
  return `
  <div class="viewer-results-hero">
    <div class="vr-stat"><div class="vr-val">${soldEntries.length}</div><div class="vr-lbl">Sold</div></div>
    <div class="vr-stat"><div class="vr-val">${(t.auction.unsold||[]).length}</div><div class="vr-lbl">Unsold</div></div>
    <div class="vr-stat"><div class="vr-val vr-val-sm">${fmt(totalSpend)}</div><div class="vr-lbl">Total Spend</div></div>
  </div>
  <div class="card"><div class="card-title">🏆 Top 10 Most Expensive</div>
    ${allSold.slice(0,10).map(({player:p,team:tm,price},i)=>{
      const cat=(t.categories||[]).find(c=>c.id===p.categoryId);
      const src=p.photoLocal||p.photo||'';
      const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':null;
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:.5px solid var(--border);${i===Math.min(9,allSold.length-1)?'border:none':''}" onclick="showPlayerModal('${p.id}','${t.id}')" class="clickable-row">
        <div style="font-size:${medal?'20px':'13px'};font-weight:700;color:var(--muted);width:28px;text-align:center;flex-shrink:0">${medal||i+1}</div>
        <div style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:var(--bg);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px">
          ${src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:initials(p.name)}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${esc(p.name)}</div>
          <div style="font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;margin-top:1px">
            ${cat?`<span class="cat-badge" style="background:${cat.color}22;color:${cat.color};font-size:10px">${cat.icon} ${esc(cat.label)}</span>`:''}${esc(p.role||'')}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:15px;font-weight:700;color:var(--green)">${fmt(price)}</div>
          <div style="font-size:11px;color:var(--muted)">${esc(tm.name)}</div>
        </div>
      </div>`;
    }).join('')}
  </div>
  ${(t.teams||[]).map(tm=>{
    const sq=teamSquad(tm.id,t); if(!sq.length) return '';
    const spent=sq.reduce((s,x)=>s+x.price,0), logo=tm.teamLogo||null;
    return `<div class="card"><div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <div style="width:40px;height:40px;border-radius:50%;background:var(--green);overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center">
        ${logo?`<img src="${logo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
          `<span style="color:#fff;font-size:13px;font-weight:700">${initials(tm.name)}</span>`}
      </div>
      <div><div style="font-size:14px;font-weight:600">${esc(tm.name)}</div><div style="font-size:11px;color:var(--muted)">${sq.length} players &bull; Spent ${fmt(spent)}</div></div>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">${sq.sort((a,b)=>b.price-a.price).map(({player:p,price})=>{
      const src=p.photoLocal||p.photo||'';
      return `<div style="display:flex;align-items:center;gap:5px;background:var(--bg);border-radius:8px;padding:5px 8px;cursor:pointer" onclick="showPlayerModal('${p.id}','${t.id}')">
        <div style="width:22px;height:22px;border-radius:50%;overflow:hidden;flex-shrink:0;background:var(--card-bg);display:flex;align-items:center;justify-content:center;font-size:8px">
          ${src?`<img src="${src}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:initials(p.name)}
        </div>
        <div><div style="font-size:11px;font-weight:500">${esc(p.name.split(' ')[0])}</div><div style="font-size:10px;color:var(--green);font-weight:600">${fmt(price)}</div></div>
      </div>`;
    }).join('')}</div></div>`;
  }).join('')}`;
}

// ══════════════════════════════════════════════════════════
//  TEAM BIDDING PAGE (accessed via ?team=TOKEN)
// ══════════════════════════════════════════════════════════
function renderTeamBidPage(token) {
  // state is always current via Firestore listener set up in render()
  const cleanToken = (token || '').trim();
  let foundTour = null, foundTeam = null;
  for (const t of state.tournaments) {
    const tm = (t.teams||[]).find(x => (x.bidToken||'').trim() === cleanToken);
    if (tm) { foundTour = t; foundTeam = tm; break; }
  }
  if (!foundTour || !foundTeam) {
    return `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg);padding:24px">
      <div style="text-align:center;max-width:420px">
        <div style="font-size:52px;margin-bottom:16px">🔗</div>
        <div style="font-size:20px;font-weight:600;margin-bottom:8px;color:var(--text)">Team link not found</div>
        <div style="background:var(--card-bg);border-radius:12px;padding:20px;text-align:left;border:.5px solid var(--border);margin-bottom:16px">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px">⚠️ Important: Same-browser required</div>
          <div style="font-size:13px;color:var(--muted);line-height:1.7">
            This app stores data in your browser's local storage.<br/>
            The team link only works when opened in the <b>same browser</b> and <b>same device</b> where the admin created the tournament.
          </div>
        </div>
        <div style="background:var(--card-bg);border-radius:12px;padding:20px;text-align:left;border:.5px solid var(--border);margin-bottom:16px">
          <div style="font-size:13px;font-weight:600;margin-bottom:10px">✅ How to fix</div>
          <div style="font-size:13px;color:var(--muted);line-height:1.8">
            1. Open the <b>admin panel</b> in this same browser<br/>
            2. Go to your tournament → <b>Teams</b> tab<br/>
            3. Click <b>🔗 Copy</b> on the team card<br/>
            4. Open that link in a <b>new tab</b> in this browser
          </div>
        </div>
        <div style="font-size:11px;color:var(--muted);font-family:monospace;background:var(--card-bg);padding:6px 12px;border-radius:6px;border:.5px solid var(--border);word-break:break-all;margin-bottom:16px">
          Token searched: ${esc(cleanToken)}
        </div>
        <button class="btn btn-primary" onclick="window.location.href=window.location.origin+window.location.pathname">Go to home</button>
      </div>
    </div>`;
  }
  const t = foundTour, tm = foundTeam;
  const a = t.auction || {};
  const squad = teamSquad(tm.id, t);
  const budget = teamBudget(tm, t);
  const total = t.budget || 0;
  const pct = total ? Math.max(0, Math.round(budget/total*100)) : 0;
  const isLead = a.leadTeamId === tm.id;
  const isLive = a.active && a.currentPlayerId;
  const player = isLive ? (t.players||[]).find(p=>p.id===a.currentPlayerId) : null;
  const cat = player ? (t.categories||[]).find(c=>c.id===player.categoryId) : null;
  const step = cat ? cat.bidStep : 50000;
  const nextBid = (a.currentBid||0) + step;
  const canBid = isLive && budget >= nextBid && a.leadTeamId !== tm.id;
  const leadTeam = a.leadTeamId ? (t.teams||[]).find(x=>x.id===a.leadTeamId) : null;
  const qIdx = isLive ? (a.queue||[]).indexOf(a.currentPlayerId) : -1;

  const upcoming = isLive ? (a.queue||[]).slice(qIdx+1).slice(0,5).map(pid=>{
  // Prefetch stats for current player
  if (isLive && player && player.userId && !statsCache[player.userId]) {
    statsCache[player.userId] = 'loading';
    fetchPlayerStats(player.userId);
  }
    const pp=(t.players||[]).find(p=>p.id===pid);
    return pp?`<div class="queue-item">
      <div style="display:flex;align-items:center;gap:8px">
        ${(pp.photo||pp.photoLocal)?`<img src="${pp.photoLocal||pp.photo}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'"/>`:
          `<div style="width:24px;height:24px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted)">${initials(pp.name)}</div>`}
        <span>${esc(pp.name)}</span>
      </div>
      <span style="font-size:11px;color:var(--muted)">${fmt((t.categories||[]).find(c=>c.id===pp.categoryId)?.basePrice||0)}</span>
    </div>`:''
  }).join('') : '';

  return `
  <nav style="background:var(--card-bg);border-bottom:.5px solid var(--border);padding:0 16px;display:flex;align-items:center;justify-content:space-between;min-height:52px">
    <div style="display:flex;align-items:center;gap:8px">
      <div class="logo-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2L22 9l-9 9-7-7 9-9z"/><path d="M9 15L2 22"/></svg></div>
      <div>
        <div style="font-size:14px;font-weight:700">${esc(tm.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${esc(t.name)}</div>
      </div>
    </div>
    <span class="nav-badge nav-badge-team">Team Dashboard</span>
  </nav>
  ${t.bannerImage?`<div class="tournament-header" style="height:80px"><img class="banner-img" src="${t.bannerImage}"/><div class="banner-content" style="font-size:14px">${esc(t.name)}</div></div>`:''}
  <div class="team-bid-page">

    <!-- Purse card -->
    <div class="team-purse-card">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
        <div style="width:48px;height:48px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0;border:2px solid rgba(255,255,255,.4)">
          ${tm.teamLogo?`<img src="${tm.teamLogo}" style="width:100%;height:100%;object-fit:cover;"/>`:`<span style="color:#fff">${initials(tm.name)}</span>`}
        </div>
        <div>
          <div style="font-size:16px;font-weight:700;color:#fff">${esc(tm.name)}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.7)">Owner: ${esc(tm.owner||'—')}</div>
        </div>
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,.7);margin-bottom:4px">Remaining purse</div>
      <div class="team-purse-amount">${fmt(budget)}</div>
      <div style="height:6px;background:rgba(255,255,255,.2);border-radius:3px;margin-top:10px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:rgba(255,255,255,.7);border-radius:3px;transition:width .3s"></div>
      </div>
      <div style="font-size:11px;color:rgba(255,255,255,.6);margin-top:4px">${fmt(total-budget)} spent of ${fmt(total)} &bull; ${squad.length} players acquired</div>
    </div>

    <!-- Live auction -->
    ${isLive && player ? `
    <div class="team-bid-spotlight">
      <div style="font-size:11px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">🔴 Live Auction — Player ${qIdx+1} of ${(a.queue||[]).length}</div>
      <div style="width:80px;height:80px;border-radius:50%;overflow:hidden;margin:0 auto 10px;background:var(--bg);display:flex;align-items:center;justify-content:center">
        ${(player.photo||player.photoLocal)?`<img src="${player.photoLocal||player.photo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
          `<span style="font-size:28px;font-weight:600;color:var(--muted)">${initials(player.name)}</span>`}
      </div>
      <div style="font-size:20px;font-weight:600;margin-bottom:4px">${esc(player.name)}</div>
      <div style="margin-bottom:10px">${cat?`<span class="cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${esc(cat.label)}</span>`:''}</div>
      <div class="current-bid-label">Current bid</div>
      <div class="team-bid-amount">${fmt(a.currentBid)}</div>
      <div class="team-bid-leading" style="margin-top:6px">
        ${isLead ? `<span style="color:var(--green);font-weight:600">✓ You are leading!</span>` :
          leadTeam ? `<span style="color:var(--muted)">⬆ ${esc(leadTeam.name)} is leading</span>` :
          `<span style="color:var(--muted)">No bids yet</span>`}
      </div>
      ${player.userId ? renderStatsSection(player.userId) : ''}
      <div class="team-bid-btn-area" style="margin-top:18px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        ${isLead
          ? `<button class="btn btn-primary btn-lg" onclick="teamPlaceBid('${token}','${tm.id}')">Raise by ${fmt(step)}</button>`
          : canBid
          ? `<button class="btn btn-primary btn-lg" onclick="teamPlaceBid('${token}','${tm.id}')">Bid ${fmt(nextBid)}</button>`
          : budget < nextBid
          ? `<div style="font-size:13px;color:var(--muted);padding:12px 0">Insufficient purse to bid</div>`
          : `<div style="font-size:13px;color:var(--green);padding:12px 0">✓ You are already leading</div>`}
      </div>
    </div>` : !isLive ? `
    <div class="card" style="text-align:center;padding:32px">
      <div style="font-size:36px;margin-bottom:8px">⏳</div>
      <div style="font-size:15px;font-weight:500;margin-bottom:4px">Auction not started</div>
      <div style="font-size:13px;color:var(--muted)">This page refreshes every 4 seconds.</div>
    </div>` : ''}

    <!-- Upcoming players -->
    ${isLive && upcoming ? `
    <div class="card">
      <div class="card-title">Up next</div>
      <div class="queue-list">${upcoming}</div>
    </div>` : ''}

    <!-- My squad -->
    <div class="card">
      <div class="card-title">My squad (${squad.length} players)</div>
      ${!squad.length ? `<div style="font-size:13px;color:var(--muted)">No players acquired yet.</div>` : `
      <table class="results-table">
        <thead><tr><th></th><th>Player</th><th>Category</th><th style="text-align:right">Paid</th></tr></thead>
        <tbody>${squad.map(({player:p,price})=>`<tr>
          <td style="width:32px">${(p.photo||p.photoLocal)?`<img src="${p.photoLocal||p.photo}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'"/>`:
            `<div style="width:26px;height:26px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:9px;color:var(--muted)">${initials(p.name)}</div>`}</td>
          <td style="font-weight:500">${esc(p.name)}</td>
          <td>${catBadgeHtml(p.categoryId,t.categories)}</td>
          <td style="text-align:right;color:var(--green);font-weight:500">${fmt(price)}</td>
        </tr>`).join('')}</tbody>
      </table>`}
    </div>

    <div style="text-align:center;font-size:11px;color:var(--muted);padding:16px 0">Auto-refreshes every 4s &bull; AuctionAdda</div>
  </div>`;
}

window.teamPlaceBid = function(token, teamId) {
  // state is current via Firestore listener; just validate and write
  let foundTour = null;
  for (const t of state.tournaments) {
    if ((t.teams||[]).find(x => (x.bidToken||'').trim() === (token||'').trim())) { foundTour = t; break; }
  }
  if (!foundTour) { alert('Tournament not found. Try refreshing.'); return; }
  const a = foundTour.auction;
  if (!a.active || !a.currentPlayerId) { alert('Auction is not live right now.'); return; }
  const player = (foundTour.players||[]).find(p => p.id === a.currentPlayerId);
  const cat    = (foundTour.categories||[]).find(c => c.id === (player||{}).categoryId);
  const step   = cat ? cat.bidStep : 50000;
  const nextBid = a.currentBid + step;
  const tm = (foundTour.teams||[]).find(x => x.id === teamId);
  if (!tm) { alert('Team not found.'); return; }
  if (teamBudget(tm, foundTour) < nextBid) { alert('Insufficient purse to place this bid!'); return; }
  if (a.leadTeamId === teamId) { alert("You're already the highest bidder!"); return; }
  a.currentBid = nextBid;
  a.leadTeamId = teamId;
  save(); // writes to Firestore → Firestore onSnapshot will update all other viewers/team pages automatically
  // Patch local DOM immediately so the bidder sees instant feedback
  patchTeamBidUI(token, foundTour, tm);
};

// ══════════════════════════════════════════════════════════
//  ADMIN SHELL
// ══════════════════════════════════════════════════════════
function renderAdminShell() {
  const u=currentUser(), t=currentTournament(), paid=isAdmin();
  let navTabs='', pageContent='';
  if (currentPage==='home'||currentPage==='tournaments'||!t) {
    pageContent = currentPage==='home' ? renderHomePage() : renderTournamentList();
  } else {
    navTabs=`<div class="nav-tabs">
      <div class="nav-tab ${currentPage==='setup'?'active':''}" onclick="goto('setup')">Setup</div>
      <div class="nav-tab ${currentPage==='teams'?'active':''}" onclick="goto('teams')">Teams</div>
      <div class="nav-tab ${currentPage==='players'?'active':''}" onclick="goto('players')">Players</div>
      <div class="nav-tab ${currentPage==='auction'?'active':''}" onclick="goto('auction')">Auction</div>
      <div class="nav-tab ${currentPage==='results'?'active':''}" onclick="goto('results')">Results</div>
    </div>`;
    if (currentPage==='setup')   pageContent=renderSetup();
    if (currentPage==='teams')   pageContent=renderTeams();
    if (currentPage==='players') pageContent=renderPlayers();
    if (currentPage==='auction') pageContent=renderAuction();
    if (currentPage==='results') pageContent=renderResults();
  }
  const hammerSvg=`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2L22 9l-9 9-7-7 9-9z"/><path d="M9 15L2 22"/><path d="M17 6L7 16"/></svg>`;
  const bannerHtml = t&&t.bannerImage?`<div class="tournament-header"><img class="banner-img" src="${t.bannerImage}"/><div class="banner-content"><div class="banner-name">${esc(t.name||'')}</div><div class="banner-sub">🏏 Cricket Auction</div></div></div>`:'';
  return `
  <nav>
    <div class="nav-logo" onclick="currentPage='home';state.currentTournamentId=null;save();render()">
      <div class="logo-icon">${hammerSvg}</div>AuctionAdda
    </div>
    ${navTabs}
    <div class="nav-right">
      ${t?`<span style="font-size:12px;color:var(--muted);max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.name)}</span>`:''}
      <span class="nav-badge nav-badge-admin">Admin</span>
      <span style="font-size:12px;color:var(--muted)">${esc(u.name)}</span>
      <button class="btn btn-sm" onclick="doLogout()">Sign out</button>
    </div>
  </nav>
  ${bannerHtml}
  <div class="page">${pageContent}</div>`;
}

window.goto = function(page) { currentPage=page; render(); };

// ── Home page ─────────────────────────────────────────────
function renderHomePage() {
  const u=currentUser(), myTours=state.tournaments.filter(t=>t.ownerId===u.id);
  const totalSold=myTours.reduce((s,t)=>s+Object.keys(t.auction.sold||{}).length,0);
  const liveTours=myTours.filter(t=>t.auction&&t.auction.active);
  return `
  <div style="max-width:600px;margin:0 auto">
    <div class="card" style="display:flex;align-items:center;gap:20px;margin-bottom:20px">
      <div style="width:64px;height:64px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700;flex-shrink:0">${initials(u.name)}</div>
      <div style="flex:1">
        <div style="font-size:20px;font-weight:600;margin-bottom:2px">${esc(u.name)}</div>
        <div style="font-size:13px;color:var(--muted)">${esc(u.email||'')}${u.phone?' · +91 '+esc(u.phone):''}</div>
        <div style="margin-top:8px"><span class="nav-badge nav-badge-admin" style="font-size:12px;padding:3px 10px">Admin</span></div>
      </div>
    </div>
    <div class="summary-row">
      <div class="stat-pill"><div class="val">${myTours.length}</div><div class="lbl">Tournaments</div></div>
      <div class="stat-pill"><div class="val">${liveTours.length}</div><div class="lbl">Live now</div></div>
      <div class="stat-pill"><div class="val">${totalSold}</div><div class="lbl">Players sold</div></div>
    </div>
    ${liveTours.length?`<div class="card" style="margin-bottom:16px;border-color:rgba(29,158,117,.3);background:var(--green-light)">
      <div class="card-title" style="color:var(--green-dark)"><span class="dot dot-green"></span> Live auctions</div>
      ${liveTours.map(t=>`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:.5px solid rgba(29,158,117,.2)">
        <div><div style="font-size:13px;font-weight:500">${esc(t.name)}</div><div style="font-size:11px;color:var(--green-dark)">${(t.teams||[]).length} teams</div></div>
        <button class="btn btn-primary btn-sm" onclick="gotoTournament('${t.id}','auction')">Go →</button>
      </div>`).join('')}
    </div>`:''}
    <div class="section-header"><div class="section-title">My tournaments</div><button class="btn btn-primary btn-sm" onclick="openCreateTournament()">+ New</button></div>
    ${!myTours.length?`<div class="empty">No tournaments yet. Create your first one!</div>`:
    myTours.map(t=>{
      const isLive=t.auction&&t.auction.active, sold=Object.keys(t.auction.sold||{}).length;
      return `<div style="display:flex;align-items:center;gap:12px;padding:12px;background:var(--card-bg);border:.5px solid var(--border);border-radius:var(--radius);margin-bottom:10px;cursor:pointer" onclick="gotoTournament('${t.id}','setup')">
        <div style="width:44px;height:44px;border-radius:10px;background:linear-gradient(135deg,#0F6E56,#1D9E75);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2L22 9l-9 9-7-7 9-9z"/><path d="M9 15L2 22"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:1px">${(t.teams||[]).length} teams &bull; ${(t.players||[]).length} players &bull; ${sold} sold</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          ${isLive?`<span class="tlc-status tlc-status-live"><span class="dot dot-green"></span>Live</span>`:`<span class="tlc-status tlc-status-draft">Draft</span>`}
          <span style="color:var(--muted);font-size:16px">›</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}
function gotoTournament(id, page) { state.currentTournamentId=id; currentPage=page||'setup'; save(); statsCache={}; statsOpenUsers.clear(); render(); }
window.gotoTournament = gotoTournament;

// ── Tournament list ───────────────────────────────────────
function renderTournamentList() {
  const u=currentUser(), myTours=state.tournaments.filter(t=>t.ownerId===u.id);
  return `
  <div class="section-header"><div class="section-title">My tournaments</div><button class="btn btn-primary btn-sm" onclick="openCreateTournament()">+ New tournament</button></div>
  ${!myTours.length?`<div class="empty" style="padding:60px 20px">
    <div style="font-size:48px;margin-bottom:12px">🏆</div>
    <div style="font-size:15px;font-weight:500;margin-bottom:16px">No tournaments yet</div>
    <button class="btn btn-primary" onclick="openCreateTournament()">Create tournament</button>
  </div>`:`
  <div class="tournament-list-grid">
    ${myTours.map(t=>{
      const sold=Object.keys(t.auction?t.auction.sold||{}:{}).length, isLive=t.auction&&t.auction.active;
      return `<div class="tournament-list-card">
        <div class="tlc-banner">${t.bannerImage?`<img src="${t.bannerImage}"/>`:''}
          <div class="tlc-banner-text">${esc(t.name||'Tournament')}</div>
        </div>
        <div class="tlc-body">
          <div class="tlc-name">${esc(t.name)}</div>
          <div class="tlc-meta"><span>${(t.teams||[]).length} teams</span><span>${(t.players||[]).length} players</span><span>${sold} sold</span></div>
          <span class="tlc-status ${isLive?'tlc-status-live':'tlc-status-draft'}">${isLive?'<span class="dot dot-green"></span> Live':'Draft'}</span>
          <div class="tlc-actions">
            <button class="btn btn-primary btn-sm" style="flex:1" onclick="gotoTournament('${t.id}','setup')">Open</button>
            <button class="btn btn-sm" onclick="editTournamentMeta('${t.id}')">Edit</button>
            <button class="btn btn-sm btn-danger" onclick="deleteTournament('${t.id}')">✕</button>
          </div>
        </div>
      </div>`;
    }).join('')}
  </div>`}`;
}

window.openCreateTournament = function() {
  showModal('New tournament',`
    <div class="form-row"><label>Tournament name</label><input id="m-tname" placeholder="e.g. Premier Cricket League 2025"/></div>
    <div class="form-row"><label>Budget per team (₹)</label><input type="number" id="m-tbudget" value="5000000" step="500000" min="0"/></div>
    <div class="form-row"><label>Banner image (optional)</label>
      <input type="file" accept="image/*" onchange="previewImg(event,'m-tbanner','m-tbanner-prev')"/>
      <div id="m-tbanner-prev" style="margin-top:6px"></div><input type="hidden" id="m-tbanner"/>
    </div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="createTournament()">Create</button></div>`);
};
window.createTournament = function() {
  const name=vv('m-tname'); if(!name) return;
  const u=currentUser(), newT={ id:uid(), ownerId:u.id, name, budget:+vv('m-tbudget')||5000000, bannerImage:vv('m-tbanner')||null, categories:JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)), teams:[], players:[], auction:{active:false,currentPlayerId:null,currentBid:0,leadTeamId:null,queue:[],sold:{},unsold:[]} };
  state.tournaments.push(newT); state.currentTournamentId=newT.id; currentPage='setup';
  save(); closeModal(); render();
};
window.editTournamentMeta = function(id) {
  const t=getTour(id); if(!t) return;
  showModal('Edit tournament',`
    <div class="form-row"><label>Name</label><input id="m-tname" value="${esc(t.name)}"/></div>
    <div class="form-row"><label>Budget per team (₹)</label><input type="number" id="m-tbudget" value="${t.budget||5000000}" step="500000" min="0"/></div>
    <div class="form-row"><label>Banner</label>
      <input type="file" accept="image/*" onchange="previewImg(event,'m-tbanner','m-tbanner-prev')"/>
      <div id="m-tbanner-prev" style="margin-top:6px">${t.bannerImage?`<img src="${t.bannerImage}" style="height:40px;border-radius:6px;object-fit:cover;max-width:120px;"/>`:''}</div>
      <input type="hidden" id="m-tbanner" value="${t.bannerImage||''}"/>
    </div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="saveTournamentMeta('${id}')">Save</button></div>`);
};
window.saveTournamentMeta = function(id) {
  const t=getTour(id); if(!t) return;
  t.name=vv('m-tname')||t.name; t.budget=+vv('m-tbudget')||t.budget;
  const b=vv('m-tbanner'); if(b) t.bannerImage=b;
  save(); closeModal(); render();
};
window.deleteTournament = function(id) {
  if(!confirm('Delete this tournament?')) return;
  state.tournaments=state.tournaments.filter(t=>t.id!==id);
  if(state.currentTournamentId===id) state.currentTournamentId=null;
  save(); render();
};

// ══════════════════════════════════════════════════════════
//  SETUP
// ══════════════════════════════════════════════════════════
function renderSetup() {
  const t=currentTournament(); if(!t) return '';
  const viewerLink = baseUrl() + '?view=' + t.id;
  return `
  <div class="section-header"><div class="section-title">Tournament setup</div></div>
  <div class="card" style="border-color:rgba(55,138,221,.3);background:var(--blue-light)">
    <div class="card-title" style="color:var(--blue)">👁️ Public viewer link</div>
    <div style="font-size:13px;color:var(--blue);margin-bottom:10px;line-height:1.6">Share this link with anyone — they can watch the live auction, browse teams, players and results without logging in.</div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;font-family:monospace;font-size:12px;background:rgba(55,138,221,.12);border-radius:6px;padding:8px 10px;color:var(--blue);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${viewerLink}</div>
      <button class="btn btn-sm btn-blue" onclick="copyViewerLink('${t.id}')">📋 Copy link</button>
      <button class="btn btn-sm btn-blue" onclick="openViewerLink('${t.id}')">↗ Open</button>
    </div>
  </div>
  <div class="card">
    <div class="card-title">Details</div>
    <div class="grid-2">
      <div class="form-row"><label>Name</label><input value="${esc(t.name)}" oninput="currentTournament().name=this.value;save();render()"/></div>
      <div class="form-row"><label>Budget per team (₹)</label><input type="number" value="${t.budget||5000000}" onchange="currentTournament().budget=+this.value;save()" step="500000" min="0"/></div>
    </div>
    <div class="form-row" style="max-width:360px"><label>Banner image</label>
      <input type="file" accept="image/*" onchange="handleBannerUpload(event)"/>
      ${t.bannerImage?`<div style="margin-top:6px;display:flex;align-items:center;gap:8px"><img src="${t.bannerImage}" style="height:40px;border-radius:6px;object-fit:cover;max-width:120px;"/><button class="btn btn-sm btn-danger" onclick="removeBanner()">Remove</button></div>`:''}
    </div>
  </div>
  <div class="card">
    <div class="card-title" style="display:flex;align-items:center">Player categories<button class="btn btn-sm btn-primary" style="margin-left:auto" onclick="openAddCategory()">+ Create</button></div>
    ${t.categories.map(cat=>`<div class="cat-row">
      <div class="cat-icon-big">${cat.icon}</div>
      <div class="cat-info"><div class="cat-name">${esc(cat.label)}</div><div class="cat-details">Base: ${fmt(cat.basePrice)} &bull; Step: ${fmt(cat.bidStep)}</div></div>
      <div class="cat-actions"><button class="btn btn-sm" onclick="openEditCategory('${cat.id}')">Edit</button><button class="btn btn-sm btn-danger" onclick="deleteCategory('${cat.id}')">✕</button></div>
    </div>`).join('')}
  </div>
  <div class="summary-row">
    <div class="stat-pill"><div class="val">${(t.teams||[]).length}</div><div class="lbl">Teams</div></div>
    <div class="stat-pill"><div class="val">${(t.players||[]).length}</div><div class="lbl">Players</div></div>
    <div class="stat-pill"><div class="val">${Object.keys(t.auction.sold||{}).length}</div><div class="lbl">Sold</div></div>
    <div class="stat-pill"><div class="val">${t.categories.length}</div><div class="lbl">Categories</div></div>
  </div>
  <button class="btn btn-sm btn-danger" onclick="resetTournament()">🗑 Reset auction data</button>`;
}
// ── Image compression + Firebase Storage upload ───────────
// Compresses an image File to ~80KB max using canvas, then uploads to
// Firebase Storage (free tier). Returns a public download URL.
async function compressAndUploadImage(file, storagePath) {
  // 1. Compress via canvas
  const bitmap = await createImageBitmap(file);
  const MAX = 800; // max dimension
  let w = bitmap.width, h = bitmap.height;
  if (w > MAX || h > MAX) {
    const ratio = Math.min(MAX / w, MAX / h);
    w = Math.round(w * ratio);
    h = Math.round(h * ratio);
  }
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.72));

  // 2. Upload to Firebase Storage
  const storage = firebase.storage();
  const ref = storage.ref(storagePath);
  await ref.put(blob, { contentType: 'image/jpeg' });
  const url = await ref.getDownloadURL();
  return url;
}

// Show an inline uploading indicator inside an element
function showUploadProgress(containerId, msg) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<span class="spinner"></span> <span style="font-size:12px;color:var(--muted)">${msg||'Uploading…'}</span>`;
}

window.handleBannerUpload = async function(e) {
  const f = e.target.files[0]; if (!f) return;
  const t = currentTournament(); if (!t) return;
  showUploadProgress('m-tbanner-prev', 'Uploading banner…');
  try {
    const url = await compressAndUploadImage(f, `tournaments/${t.id}/banner.jpg`);
    t.bannerImage = url;
    save(); render();
  } catch(err) {
    console.error('Banner upload failed', err);
    // Fallback to base64 if storage fails (e.g. storage not set up)
    const r = new FileReader();
    r.onload = ev => { t.bannerImage = ev.target.result; save(); render(); };
    r.readAsDataURL(f);
  }
};
window.removeBanner = () => { currentTournament().bannerImage=null; save(); render(); };
window.resetTournament = () => { if(!confirm('Reset all auction data?')) return; const t=currentTournament(); t.auction={active:false,currentPlayerId:null,currentBid:0,leadTeamId:null,queue:[],sold:{},unsold:[]}; save(); render(); };

window.openAddCategory = () => showModal('Create category',`
  <div class="grid-2"><div class="form-row"><label>Name</label><input id="m-cname" placeholder="e.g. Legend"/></div><div class="form-row"><label>Icon</label><input id="m-cicon" placeholder="🏆" maxlength="4" style="font-size:20px"/></div></div>
  <div class="grid-2"><div class="form-row"><label>Base price (₹)</label><input type="number" id="m-cbase" value="100000" step="50000" min="0"/></div><div class="form-row"><label>Bid step (₹)</label><input type="number" id="m-cstep" value="25000" step="5000" min="0"/></div></div>
  <div class="form-row"><label>Color</label><input type="color" id="m-ccolor" value="#7F77DD"/></div>
  <div class="form-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addCategory()">Create</button></div>`);
window.openEditCategory = id => { const cat=getCat(id); if(!cat) return; showModal('Edit category',`
  <div class="grid-2"><div class="form-row"><label>Name</label><input id="m-cname" value="${esc(cat.label)}"/></div><div class="form-row"><label>Icon</label><input id="m-cicon" value="${cat.icon}" maxlength="4" style="font-size:20px"/></div></div>
  <div class="grid-2"><div class="form-row"><label>Base price (₹)</label><input type="number" id="m-cbase" value="${cat.basePrice}" step="50000" min="0"/></div><div class="form-row"><label>Bid step (₹)</label><input type="number" id="m-cstep" value="${cat.bidStep}" step="5000" min="0"/></div></div>
  <div class="form-row"><label>Color</label><input type="color" id="m-ccolor" value="${cat.color||'#1D9E75'}"/></div>
  <div class="form-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="editCategory('${id}')">Save</button></div>`); };
window.addCategory = () => { const label=vv('m-cname'); if(!label) return; const t=currentTournament(); t.categories.push({id:uid(),label,icon:vv('m-cicon')||'🏏',basePrice:+vv('m-cbase'),bidStep:+vv('m-cstep'),color:vv('m-ccolor')}); save();closeModal();render(); };
window.editCategory = id => { const cat=getCat(id); if(!cat) return; cat.label=vv('m-cname');cat.icon=vv('m-cicon')||cat.icon;cat.basePrice=+vv('m-cbase');cat.bidStep=+vv('m-cstep');cat.color=vv('m-ccolor'); save();closeModal();render(); };
window.deleteCategory = id => { const t=currentTournament(),cat=getCat(id); if(!cat) return; const a=(t.players||[]).filter(p=>p.categoryId===id); if(a.length){alert(`Cannot delete — ${a.length} player(s) assigned.`);return;} if(!confirm(`Delete "${cat.label}"?`)) return; t.categories=t.categories.filter(c=>c.id!==id); save();render(); };

// ══════════════════════════════════════════════════════════
//  TEAMS
// ══════════════════════════════════════════════════════════
function renderTeams() {
  const t=currentTournament(); if(!t) return '';
  return `
  <div class="section-header"><div class="section-title">Teams (${(t.teams||[]).length})</div><button class="btn btn-primary btn-sm" onclick="openAddTeam()">+ Add team</button></div>
  <div style="background:var(--blue-light);border:.5px solid rgba(55,138,221,.2);border-radius:var(--radius-sm);padding:10px 14px;font-size:12px;color:var(--blue);margin-bottom:14px;display:flex;align-items:flex-start;gap:8px">
    <span style="flex-shrink:0;margin-top:1px">🔗</span>
    <span>Team bidding links only work when opened in the <b>same browser and device</b> as the admin (data is stored locally). Share the link and open it in a new tab here.</span>
  </div>
  ${!(t.teams||[]).length?`<div class="empty">No teams yet.</div>`:`<div class="grid-4">${t.teams.map(renderTeamCard).join('')}</div>`}`;
}
function renderTeamCard(tm) {
  const budget=teamBudget(tm), total=currentTournament().budget||0, pct=total?Math.max(0,Math.round(budget/total*100)):0;
  const squad=teamSquad(tm.id), logo=tm.teamLogo||null;
  // Build link safely — token is alphanumeric so safe in URL
  const token = tm.bidToken || '';
  const link = baseUrl() + '?team=' + token;
  return `<div class="team-card-compact">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
      <div style="width:52px;height:52px;border-radius:50%;background:var(--green);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;box-shadow:0 2px 8px rgba(29,158,117,.25)">
        ${logo ? `<img src="${logo}" style="width:100%;height:100%;object-fit:cover;"/>` :
          `<span style="color:#fff;font-size:15px;font-weight:700">${initials(tm.name)}</span>`}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(tm.name)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">👤 ${esc(tm.owner||'—')} &bull; ${squad.length} players</div>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      <div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--green);border-radius:3px"></div></div>
      <span style="font-size:12px;color:var(--green);font-weight:600;white-space:nowrap">${fmt(budget)}</span>
    </div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn btn-sm" style="flex:1;font-size:12px" onclick="openEditTeam('${tm.id}')">Edit</button>
      <button class="btn btn-sm btn-blue" style="font-size:12px" onclick="copyTeamLink('${token}')" title="Copy bidding link">🔗 Copy</button>
      <button class="btn btn-sm btn-primary" style="font-size:12px" onclick="openTeamLink('${token}')" title="Open team page">↗ Open</button>
      <button class="btn btn-sm btn-danger" style="font-size:12px;padding:5px 8px" onclick="deleteTeam('${tm.id}')">✕</button>
    </div>
  </div>`;
}
window.copyLink = text => { navigator.clipboard.writeText(text).then(()=>alert('Link copied!')).catch(()=>prompt('Copy this link:',text)); };
window.copyTeamLink = token => {
  const link = baseUrl() + '?team=' + token;
  navigator.clipboard.writeText(link)
    .then(() => alert('Team bidding link copied!\n\n' + link))
    .catch(() => prompt('Copy this link:', link));
};
window.openTeamLink = token => {
  const link = baseUrl() + '?team=' + token;
  window.open(link, '_blank');
};

function teamModalBody(tm) {
  const tId = (currentTournament()||{}).id||'x';
  const logoPath  = tm ? `tournaments/${tId}/teams/${tm.id}/logo.jpg`  : `tournaments/${tId}/teams/new_${uid()}/logo.jpg`;
  const photoPath = tm ? `tournaments/${tId}/teams/${tm.id}/owner.jpg` : `tournaments/${tId}/teams/new_${uid()}/owner.jpg`;
  return `
  <div class="grid-2">
    <div class="form-row"><label>Team name</label><input id="m-tmname" value="${tm?esc(tm.name):''}" placeholder="e.g. Mumbai Knights"/></div>
    <div class="form-row"><label>Owner name</label><input id="m-tmowner" value="${tm?esc(tm.owner||''):''}" placeholder="Owner"/></div>
  </div>
  <div class="grid-2">
    <div class="form-row"><label>Team logo (optional)</label>
      <input type="file" accept="image/*" onchange="previewImg(event,'m-tmlogo','m-tmlogo-prev','${logoPath}')"/>
      <div id="m-tmlogo-prev" style="margin-top:6px">${tm&&tm.teamLogo?`<img src="${tm.teamLogo}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;"/>`:''}</div>
      <input type="hidden" id="m-tmlogo" value="${tm?tm.teamLogo||'':''}"/>
    </div>
    <div class="form-row"><label>Owner photo (optional)</label>
      <input type="file" accept="image/*" onchange="previewImg(event,'m-tmphoto','m-tmphoto-prev','${photoPath}')"/>
      <div id="m-tmphoto-prev" style="margin-top:6px">${tm&&tm.ownerPhoto?`<img src="${tm.ownerPhoto}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;"/>`:''}</div>
      <input type="hidden" id="m-tmphoto" value="${tm?tm.ownerPhoto||'':''}"/>
    </div>
  </div>
  <div class="form-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="${tm?`saveEditTeam('${tm.id}')`:'addTeam()'}">${tm?'Save':'Add team'}</button></div>`;
}
window.openAddTeam  = () => showModal('Add team',  teamModalBody(null));
window.openEditTeam = id => { const tm=getTeam(id); if(tm) showModal('Edit team', teamModalBody(tm)); };

// Generic image upload handler: compresses, uploads to Storage, stores URL in hidden input
window.previewImg = async function(e, hid, pid, storagePath) {
  const f = e.target.files[0]; if (!f) return;
  const previewEl = document.getElementById(pid);
  if (previewEl) previewEl.innerHTML = `<span class="spinner"></span> <span style="font-size:12px;color:var(--muted)">Uploading…</span>`;
  try {
    const path = storagePath || `uploads/${uid()}.jpg`;
    const url = await compressAndUploadImage(f, path);
    const h = document.getElementById(hid); if (h) h.value = url;
    if (previewEl) previewEl.innerHTML = `<img src="${url}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;"/>`;
  } catch(err) {
    console.error('Image upload failed, falling back to base64', err);
    const r = new FileReader();
    r.onload = ev => {
      const h = document.getElementById(hid); if (h) h.value = ev.target.result;
      if (previewEl) previewEl.innerHTML = `<img src="${ev.target.result}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;"/>`;
    };
    r.readAsDataURL(f);
  }
};
window.addTeam = () => { const name=vv('m-tmname');if(!name)return;const t=currentTournament();if(!t)return; t.teams.push({id:uid(),name,owner:vv('m-tmowner'),teamLogo:vv('m-tmlogo')||null,ownerPhoto:vv('m-tmphoto')||null,bidToken:uid()+uid()}); save();closeModal();render(); };
window.saveEditTeam = id => { const tm=getTeam(id);if(!tm)return;tm.name=vv('m-tmname');tm.owner=vv('m-tmowner');if(!tm.bidToken)tm.bidToken=uid()+uid();const l=vv('m-tmlogo');if(l)tm.teamLogo=l;const p=vv('m-tmphoto');if(p)tm.ownerPhoto=p;save();closeModal();render(); };
window.deleteTeam = id => { if(!confirm('Delete this team?'))return;const t=currentTournament();if(!t)return;t.teams=t.teams.filter(tm=>tm.id!==id);save();render(); };

// ══════════════════════════════════════════════════════════
//  PLAYERS
// ══════════════════════════════════════════════════════════
function renderPlayers() {
  const t=currentTournament(); if(!t) return '';
  const cats=[{id:'all',label:'All',icon:''},...t.categories];
  const filtered=playerFilter==='all'?t.players:t.players.filter(p=>p.categoryId===playerFilter);
  return `
  <div class="section-header"><div class="section-title">Players (${t.players.length})</div><button class="btn btn-primary btn-sm" onclick="openAddPlayer()">+ Add player</button></div>
  <div class="chip-row">${cats.map(c=>`<div class="chip ${playerFilter===c.id?'active':''}" onclick="setPlayerFilter('${c.id}')">${c.icon?c.icon+' ':''}${c.label}</div>`).join('')}</div>
  ${!filtered.length?`<div class="empty">No players.</div>`:`<div class="grid-3">${filtered.map(renderPlayerCard).join('')}</div>`}`;
}
window.setPlayerFilter = f => { playerFilter=f; render(); };

function renderPlayerCard(p) {
  const t=currentTournament(), sold=t?(t.auction.sold||{})[p.id]:null, team=sold?getTeam(sold.teamId):null;
  return `<div class="player-card" onclick="showPlayerModal('${p.id}')" style="cursor:pointer">
    <div style="display:flex;gap:10px;margin-bottom:6px">
      <div class="player-pic">${playerPhotoHtml(p,48)}</div>
      <div style="flex:1;min-width:0">
        <div class="player-name">${esc(p.name)}</div>
        <div class="player-meta">${esc(p.role||'')}${p.country?' · '+esc(p.country):''}</div>
        ${p.phone?`<div style="font-size:11px;color:var(--muted)">📱 +91 ${esc(p.phone)}</div>`:''}
        ${catBadgeHtml(p.categoryId)}
      </div>
    </div>
    ${p.bio?`<div style="font-size:12px;color:var(--muted);margin:4px 0;line-height:1.5">${esc(p.bio).slice(0,80)}${p.bio.length>80?'…':''}</div>`:''}
    <div class="player-footer">
      <div>${sold?`<span class="badge badge-sold">Sold ${fmt(sold.price)}</span> <span style="font-size:11px;color:var(--muted)">${team?esc(team.name):''}</span>`:
        t&&(t.auction.unsold||[]).includes(p.id)?`<span class="badge badge-unsold">Unsold</span>`:
        `<span style="font-size:11px;color:var(--muted)">Base: ${fmt((getCat(p.categoryId)||{}).basePrice||0)}</span>`}</div>
      <div style="display:flex;gap:4px"><button class="btn btn-sm" onclick="openEditPlayer('${p.id}')">Edit</button><button class="btn btn-sm btn-danger" onclick="deletePlayer('${p.id}')">✕</button></div>
    </div>
  </div>`;
}

let _addTab='manual', _apiPlayer=null;
window.openAddPlayer = () => { _addTab='manual';_apiPlayer=null;showModal('Add player',addPlayerBody()); };
function addPlayerBody() {
  return `<div class="tab-row" style="margin:-4px -4px 12px">
    <div class="tab ${_addTab==='manual'?'active':''}" onclick="switchAddTab('manual')">Manual entry</div>
    <div class="tab ${_addTab==='api'?'active':''}" onclick="switchAddTab('api')">Search via CricHeroes</div>
    <div class="tab ${_addTab==='bulk'?'active':''}" onclick="switchAddTab('bulk')">Bulk import</div>
  </div>
  <div id="add-player-content">${_addTab==='manual'?manualPlayerFields(null):_addTab==='api'?apiSearchFields():bulkImportFields()}</div>`;
}
window.switchAddTab = tab => { _addTab=tab;_apiPlayer=null;const mb=document.getElementById('modal-body');if(mb)mb.innerHTML=addPlayerBody(); };

function catSelectorHtml(selectedId) {
  const t=currentTournament(); if(!t) return '';
  const defId=selectedId||(t.categories[0]||{}).id||'';
  return `<div class="cat-picker" id="cat-picker">${t.categories.map(cat=>`
    <div class="cat-option ${(selectedId||defId)===cat.id?'selected':''}" onclick="selectCat('${cat.id}')">
      <div class="cat-icon">${cat.icon}</div><div class="cat-label">${esc(cat.label)}</div>
    </div>`).join('')}</div>
  <input type="hidden" id="m-pcatid" value="${defId}"/>`;
}
window.selectCat = id => { document.querySelectorAll('.cat-option').forEach(el=>el.classList.remove('selected')); const el=document.querySelector(`.cat-option[onclick="selectCat('${id}')"]`);if(el)el.classList.add('selected');const h=document.getElementById('m-pcatid');if(h)h.value=id; };

function manualPlayerFields(p) {
  const roles=['Batsman','Bowler','All-rounder','Wicket-keeper'];
  const tId = (currentTournament()||{}).id||'x';
  const photoPath = p ? `tournaments/${tId}/players/${p.id}/photo.jpg` : `tournaments/${tId}/players/new_${uid()}/photo.jpg`;
  return `
  <div class="grid-2">
    <div class="form-row"><label>Full name</label><input id="m-pname" value="${p?esc(p.name):''}" placeholder="Player name"/></div>
    <div class="form-row"><label>Role</label><select id="m-prole">${roles.map(r=>`<option ${p&&p.role===r?'selected':''}>${r}</option>`).join('')}</select></div>
  </div>
  <div class="grid-2">
    <div class="form-row"><label>Country</label><input id="m-pcountry" value="${p?esc(p.country||''):''}" placeholder="India"/></div>
    <div class="form-row"><label>Phone number (for viewer login)</label>
      <input id="m-pphone" value="${p?esc(p.phone||''):''}" placeholder="10-digit number" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)"/>
    </div>
  </div>
  <div class="grid-2">
    <div class="form-row"><label>Player photo</label>
      <input type="file" accept="image/*" onchange="previewImg(event,'m-pphoto','m-pphoto-prev','${photoPath}')"/>
      <div id="m-pphoto-prev" style="margin-top:4px">${p&&p.photoLocal?`<img src="${p.photoLocal}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;"/>`:p&&p.photo?`<img src="${p.photo}" style="width:48px;height:48px;border-radius:50%;object-fit:cover;"/>`:''}</div>
      <input type="hidden" id="m-pphoto" value="${p?p.photoLocal||p.photo||'':''}"/>
    </div>
    <div class="form-row"><label>Bio</label><textarea id="m-pbio" placeholder="Career highlights...">${p?esc(p.bio||''):''}</textarea></div>
  </div>
  <div class="form-row"><label>Category</label>${catSelectorHtml(p?p.categoryId:'')}</div>
  <div class="form-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="${p?`saveEditPlayer('${p.id}')`:'addPlayerManual()'}">${p?'Save':'Add player'}</button></div>`;
}
function apiSearchFields() { return `
  <div class="form-row"><label>Phone number (10 digits)</label>
    <div style="display:flex;gap:8px"><input id="m-api-phone" placeholder="e.g. 9876543210" style="flex:1" oninput="this.value=this.value.replace(/[^0-9]/g,'').slice(0,10)"/><button class="btn btn-primary" onclick="searchPlayerByPhone()">Search</button></div>
  </div>
  <div id="api-result"></div>`; }
window.searchPlayerByPhone = async function() {
  const phone=vv('m-api-phone').trim();
  if(phone.length<10){setApiResult(null,'Enter a valid 10-digit number.');return;}
  const t=currentTournament();if(t){const dup=t.players.find(p=>p.phone===phone);if(dup){setApiResult(null,`"${dup.name}" already added with this number.`);return;}}
  setApiResult('<span class="spinner"></span> Searching...', null);
  try {
    const resp=await fetch(`https://api.cricheroes.in/api/v1/organiser-master/get-player-profile-by-mobile/+91/${phone}`,{headers:CH_HEADERS});
    const data=await resp.json();
    if(!resp.ok||data.status===false||!data.data){setApiResult(null,data.message||'Player not found.');return;}
    const p=data.data, photoUrl=p.profile_photo||p.profile_picture||p.avatar||p.image||'';
    _apiPlayer={...p,_resolvedPhotoUrl:photoUrl,_phone:phone};
    const name=p.name||p.full_name||p.username||'', userId=String(p.user_id||p.id||''), city=p.city||p.location||'';
    setApiResult(`<div class="api-result-box">
      ${photoUrl?`<img src="${photoUrl}" style="width:52px;height:52px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'"/>`:`<div style="width:52px;height:52px;border-radius:50%;background:var(--green-light);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:600;flex-shrink:0">${initials(name)}</div>`}
      <div><div class="api-name">${esc(name)}</div><div class="api-meta">${userId?'ID: '+esc(userId):''}${city?' · '+esc(city):''}</div></div>
    </div>
    <div class="form-row" style="margin-top:12px"><label>Category</label>${catSelectorHtml('')}</div>
    <div class="form-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-primary" onclick="addPlayerFromApi()">Add this player</button></div>`,null);
  } catch(e){setApiResult(null,'Network error: '+e.message);}
};
function bulkImportFields() {
  return `
  <div class="form-row">
    <label>Paste mobile numbers — one per line (or comma/space separated)</label>
    <textarea id="bulk-phones" placeholder="9876543210&#10;9123456789&#10;9000000001" style="min-height:100px;font-family:monospace;font-size:13px"></textarea>
    <div style="font-size:11px;color:var(--muted);margin-top:4px">We'll look up each number in CricHeroes one by one.</div>
  </div>
  <button class="btn btn-primary" onclick="startBulkImport()" style="margin-bottom:12px">🔍 Fetch players</button>
  <div id="bulk-result"></div>`;
}

let _bulkResults = []; // {phone, status, player, selected, categoryId}

window.startBulkImport = async function() {
  const raw = vv('bulk-phones');
  const phones = raw.split(/[\n,;\s]+/).map(p=>p.replace(/[^0-9]/g,'').slice(-10)).filter(p=>p.length===10);
  if (!phones.length) { alert('Enter at least one valid 10-digit phone number.'); return; }

  const t = currentTournament(); if (!t) return;
  const resultBox = document.getElementById('bulk-result');
  if (!resultBox) return;

  _bulkResults = phones.map(ph => ({ phone:ph, status:'pending', player:null, selected:true, categoryId:(t.categories[0]||{}).id }));
  renderBulkResults();

  // Fetch one by one
  for (let i=0; i<_bulkResults.length; i++) {
    const item = _bulkResults[i];
    // Check duplicate in this tournament
    if (t.players.find(p => p.phone && p.phone.replace(/[^0-9]/g,'').slice(-10) === item.phone)) {
      item.status = 'duplicate'; renderBulkResults(); continue;
    }
    item.status = 'loading'; renderBulkResults();
    try {
      const resp = await fetch(`https://api.cricheroes.in/api/v1/organiser-master/get-player-profile-by-mobile/+91/${item.phone}`, { headers: CH_HEADERS });
      const data = await resp.json();
      if (!resp.ok || data.status===false || !data.data) {
        item.status = 'notfound'; renderBulkResults(); continue;
      }
      const p = data.data;
      item.player = { ...p, _resolvedPhotoUrl: p.profile_photo||p.profile_picture||p.avatar||p.image||'' };
      item.status = 'found';
    } catch(e) {
      item.status = 'error';
    }
    renderBulkResults();
    await new Promise(r => setTimeout(r, 300)); // small delay between requests
  }
  // Show category picker after all fetched
  renderBulkResults(true);
};

function renderBulkResults(showFinalActions) {
  const box = document.getElementById('bulk-result'); if (!box) return;
  const found = _bulkResults.filter(x=>x.status==='found');
  const notFound = _bulkResults.filter(x=>x.status==='notfound'||x.status==='error');
  const duplicates = _bulkResults.filter(x=>x.status==='duplicate');
  const pending = _bulkResults.filter(x=>x.status==='pending'||x.status==='loading');

  const t = currentTournament(); if (!t) return;

  box.innerHTML = `
  <div style="margin-bottom:12px">
    ${_bulkResults.map((item,i) => {
      const p = item.player;
      const name = p ? (p.name||p.full_name||p.username||'') : '';
      const photo = p ? p._resolvedPhotoUrl : '';
      const statusIcon = {pending:'⏳',loading:'<span class="spinner"></span>',found:'',notfound:'❌',error:'⚠️',duplicate:'🔄'}[item.status]||'';
      const bgColor = {found:'var(--green-light)',notfound:'#fcebeb',error:'#fcebeb',duplicate:'var(--amber-light)',loading:'var(--bg)',pending:'var(--bg)'}[item.status]||'var(--bg)';
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;margin-bottom:6px;border-radius:8px;background:${bgColor};border:.5px solid var(--border)">
        ${item.status==='found' ? `<input type="checkbox" ${item.selected?'checked':''} onchange="_bulkResults[${i}].selected=this.checked" style="width:16px;height:16px;flex-shrink:0"/>` : `<span style="width:16px;text-align:center;flex-shrink:0">${statusIcon}</span>`}
        ${photo ? `<img src="${photo}" style="width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'"/>` :
          `<div style="width:32px;height:32px;border-radius:50%;background:var(--card-bg);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:var(--muted);flex-shrink:0">${name?initials(name):item.phone.slice(-4)}</div>`}
        <div style="flex:1;min-width:0">
          ${item.status==='found' ? `<div style="font-size:13px;font-weight:500">${esc(name)}</div><div style="font-size:11px;color:var(--muted)">+91 ${item.phone}</div>` :
            item.status==='duplicate' ? `<div style="font-size:13px;font-weight:500;color:#633806">Already added</div><div style="font-size:11px;color:var(--muted)">+91 ${item.phone}</div>` :
            item.status==='notfound' ? `<div style="font-size:13px;font-weight:500;color:var(--red)">Not found</div><div style="font-size:11px;color:var(--muted)">+91 ${item.phone}</div>` :
            item.status==='loading' ? `<div style="font-size:13px;color:var(--muted)">Searching +91 ${item.phone}…</div>` :
            item.status==='error' ? `<div style="font-size:13px;font-weight:500;color:var(--red)">Error</div><div style="font-size:11px;color:var(--muted)">+91 ${item.phone}</div>` :
            `<div style="font-size:13px;color:var(--muted)">+91 ${item.phone}</div>`}
        </div>
        ${item.status==='found'?`<span style="font-size:11px;color:var(--green);font-weight:500">✓ Found</span>`:''}
      </div>`;
    }).join('')}
  </div>

  ${pending.length===0 && found.length>0 ? `
  <div style="background:var(--card-bg);border:.5px solid var(--border);border-radius:10px;padding:14px;margin-bottom:12px">
    <div style="font-size:13px;font-weight:500;margin-bottom:10px">Assign category for all selected players</div>
    <div class="cat-picker" id="bulk-cat-picker">
      ${t.categories.map(cat=>`
        <div class="cat-option ${(t.categories[0]||{}).id===cat.id?'selected':''}" onclick="setBulkCategory('${cat.id}')">
          <div class="cat-icon">${cat.icon}</div><div class="cat-label">${esc(cat.label)}</div>
        </div>`).join('')}
    </div>
    <input type="hidden" id="bulk-cat-id" value="${(t.categories[0]||{}).id||''}"/>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
    <div style="font-size:13px;color:var(--muted)">
      ${found.length} found &bull; ${notFound.length} not found &bull; ${duplicates.length} duplicate${notFound.length?` &bull; <b style="color:var(--red)">${notFound.length} will be skipped</b>`:''}
    </div>
    <button class="btn btn-primary" onclick="confirmBulkImport()">Add ${found.filter(x=>x.selected).length} selected players →</button>
  </div>` : pending.length>0 ? `<div style="font-size:13px;color:var(--muted)">Fetching… ${_bulkResults.filter(x=>x.status==='found'||x.status==='notfound'||x.status==='error'||x.status==='duplicate').length} / ${_bulkResults.length}</div>` : ''}
  `;
}

window.setBulkCategory = function(catId) {
  document.querySelectorAll('#bulk-cat-picker .cat-option').forEach(el=>el.classList.remove('selected'));
  const el=document.querySelector(`#bulk-cat-picker .cat-option[onclick="setBulkCategory('${catId}')"]`);
  if (el) el.classList.add('selected');
  const h=document.getElementById('bulk-cat-id'); if(h) h.value=catId;
  _bulkResults.forEach(item => { if (item.status==='found') item.categoryId=catId; });
};

window.confirmBulkImport = function() {
  const t = currentTournament(); if (!t) return;
  const catId = vv('bulk-cat-id') || (t.categories[0]||{}).id;
  let added = 0;
  _bulkResults.forEach(item => {
    if (item.status!=='found' || !item.selected || !item.player) return;
    const p = item.player;
    const name = p.name||p.full_name||p.username||'Unknown';
    // double-check no duplicate
    if (t.players.find(x=>x.phone===item.phone)) return;
    t.players.push({
      id: uid(), name, role: p.batting_style?'Batsman':p.bowling_style?'Bowler':'All-rounder',
      country: p.country||'India', categoryId: catId,
      bio: p.bio||p.about||'', photo: p._resolvedPhotoUrl||null, photoLocal: null,
      userId: String(p.user_id||p.id||'')||null, phone: item.phone||null
    });
    added++;
  });
  save(); closeModal(); render();
  if (added > 0) alert(`✓ ${added} player${added>1?'s':''} added successfully!`);
};

function setApiResult(html,error){const b=document.getElementById('api-result');if(!b)return;b.innerHTML=error?`<div style="color:var(--red);font-size:13px;margin-top:10px;padding:10px;background:#fcebeb;border-radius:8px">${esc(error)}</div>`:`<div style="margin-top:10px">${html}</div>`;}

window.addPlayerManual = () => {
  const name=vv('m-pname'); if(!name) return;
  const t=currentTournament(); if(!t) return;
  const phone = vv('m-pphone').trim() || null;
  if (phone && t.players.find(p=>p.phone===phone)) { alert('A player with this phone number already exists.'); return; }
  const ph = vv('m-pphoto') || null;
  const photo = ph && ph.startsWith('http') ? ph : null;
  const photoLocal = ph && !ph.startsWith('http') ? ph : null;
  t.players.push({id:uid(),name,role:vv('m-prole'),country:vv('m-pcountry'),categoryId:vv('m-pcatid')||(t.categories[0]||{}).id,bio:vv('m-pbio'),photo,photoLocal,userId:null,phone});
  save();closeModal();render();
};
window.addPlayerFromApi = () => { if(!_apiPlayer)return;const p=_apiPlayer,t=currentTournament();if(!t)return;t.players.push({id:uid(),name:p.name||p.full_name||'Unknown',role:p.batting_style?'Batsman':p.bowling_style?'Bowler':'All-rounder',country:p.country||'India',categoryId:vv('m-pcatid')||(t.categories[0]||{}).id,bio:p.bio||p.about||'',photo:p._resolvedPhotoUrl||null,photoLocal:null,userId:String(p.user_id||p.id||'')||null,phone:p._phone||null});save();closeModal();render();_apiPlayer=null; };
window.openEditPlayer = id => { const p=getPlayer(id);if(!p)return;showModal('Edit player',manualPlayerFields(p)); };
window.saveEditPlayer = id => {
  const p=getPlayer(id); if(!p) return;
  p.name=vv('m-pname'); p.role=vv('m-prole'); p.country=vv('m-pcountry');
  p.bio=vv('m-pbio'); p.categoryId=vv('m-pcatid')||p.categoryId;
  const ph=vv('m-pphoto');
  if(ph) {
    // If it's a Storage URL (https://), save to p.photo so it persists to Firestore
    // If it's base64 (data:), save to p.photoLocal only
    if (ph.startsWith('http')) p.photo = ph;
    else p.photoLocal = ph;
  }
  const phone=vv('m-pphone').trim();
  if (phone) p.phone=phone;
  save();closeModal();render();
};
window.deletePlayer = id => { if(!confirm('Delete this player?'))return;const t=currentTournament();if(!t)return;t.players=t.players.filter(p=>p.id!==id);delete (t.auction.sold||{})[id];t.auction.unsold=(t.auction.unsold||[]).filter(x=>x!==id);t.auction.queue=(t.auction.queue||[]).filter(x=>x!==id);save();render(); };

// ══════════════════════════════════════════════════════════
//  AUCTION
// ══════════════════════════════════════════════════════════
function renderAuction() {
  const t=currentTournament(); if(!t) return '';
  return (t.auction.active&&t.auction.currentPlayerId)?renderLiveAuction(t):renderAuctionSetup(t);
}

function renderAuctionSetup(t) {
  const a=t.auction;
  if (!auctionCatId&&t.categories.length) auctionCatId=t.categories[0].id;
  const pausedHtml = (!a.active&&a.currentPlayerId)?(() => {
    const pp=t.players.find(p=>p.id===a.currentPlayerId), cat=t.categories.find(c=>c.id===(pp||{}).categoryId);
    const rem=(a.queue||[]).length-(a.queue||[]).indexOf(a.currentPlayerId);
    return `<div class="card" style="border:1.5px solid var(--amber);background:var(--amber-light);margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <div style="font-size:22px">⏸</div>
        <div style="flex:1"><div style="font-size:13px;font-weight:500;color:#633806">Auction paused</div>
          <div style="font-size:12px;color:#855a1a;margin-top:2px">${cat?cat.icon+' '+cat.label:''} — next: <b>${pp?esc(pp.name):'Unknown'}</b> &bull; ${rem} left</div>
        </div>
        <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" onclick="resumeAuction()">▶ Resume</button><button class="btn btn-sm btn-danger" onclick="stopAuction()">■ Stop</button></div>
      </div>
    </div>`;
  })():'';

  const soldCount=Object.keys(a.sold||{}).length;
  const soldHtml=soldCount?`<div class="card"><div class="card-title">Sold so far (${soldCount})</div>
    ${t.teams.map(tm=>{const sq=teamSquad(tm.id,t);if(!sq.length)return '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:.5px solid var(--border)">
        <div style="width:26px;height:26px;border-radius:50%;overflow:hidden;background:var(--green-light);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${tm.teamLogo?`<img src="${tm.teamLogo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:initials(tm.name)}</div>
        <div style="flex:1;font-size:13px;font-weight:500">${esc(tm.name)}</div>
        <div style="font-size:11px;color:var(--muted)">${sq.length} players</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;max-width:200px">${sq.map(({player:pp,price})=>`<span style="font-size:10px;background:var(--bg);border-radius:12px;padding:2px 6px;display:inline-flex;align-items:center;gap:3px">
          ${(pp.photo||pp.photoLocal)?`<img src="${pp.photoLocal||pp.photo}" style="width:12px;height:12px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'"/>`:''} ${esc(pp.name.split(' ')[0])}
          <button onclick="revokeSold('${pp.id}')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:9px;padding:0" title="Revoke & return">✕</button>
        </span>`).join('')}</div>
      </div>`;
    }).join('')}
  </div>`:'';

  return `<div class="section-header"><div class="section-title">Auction control</div></div>
  ${pausedHtml}
  <div class="card">
    <div class="card-title">Select category</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${t.categories.map(cat=>{
        const total=t.players.filter(p=>p.categoryId===cat.id).length, done=t.players.filter(p=>p.categoryId===cat.id&&((a.sold||{})[p.id]||(a.unsold||[]).includes(p.id))).length, active=auctionCatId===cat.id;
        return `<div class="team-card" style="cursor:pointer;min-width:120px;border:1.5px solid ${active?cat.color:'var(--border)'};" onclick="auctionCatId='${cat.id}';render()">
          <div style="font-size:22px;margin-bottom:4px">${cat.icon}</div>
          <div style="font-size:13px;font-weight:500">${esc(cat.label)}</div>
          <div style="font-size:11px;color:var(--muted)">${total} &bull; ${done} done</div>
        </div>`;
      }).join('')}
    </div>
    <div class="divider"></div>
    ${auctionCatId?(() => {
      const cat=t.categories.find(c=>c.id===auctionCatId);
      const pending=t.players.filter(p=>p.categoryId===auctionCatId&&!(a.sold||{})[p.id]&&!(a.unsold||[]).includes(p.id));
      return `<div style="margin-bottom:10px;font-size:13px;color:var(--muted)">Pending in <b>${cat?cat.icon+' '+cat.label:auctionCatId}</b>: ${pending.length} players</div>
      <div class="queue-list" style="max-height:200px">${pending.map(p=>`<div class="queue-item">
        <div style="display:flex;align-items:center;gap:8px">
          ${(p.photo||p.photoLocal)?`<img src="${p.photoLocal||p.photo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'"/>`:
            `<div style="width:28px;height:28px;border-radius:50%;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:10px;color:var(--muted);flex-shrink:0">${initials(p.name)}</div>`}
          <b>${esc(p.name)}</b><span style="color:var(--muted);font-size:11px;margin-left:4px">${p.role||''}</span>
        </div>
        <span style="font-size:11px;color:var(--muted)">${fmt(cat?cat.basePrice:0)}</span>
      </div>`).join('')||`<div class="empty" style="padding:12px">All players auctioned.</div>`}</div>
      <div style="margin-top:16px"><button class="btn btn-primary" onclick="startCategoryAuction('${auctionCatId}')">▶ Start ${cat?cat.label:''} auction</button></div>`;
    })():'<div style="font-size:13px;color:var(--muted)">Select a category above.</div>'}
  </div>
  <div class="card"><div class="card-title">Unsold (${(a.unsold||[]).length})</div>
    ${!(a.unsold||[]).length?`<div class="empty" style="padding:12px">None</div>`:`<div class="queue-list">${(a.unsold||[]).map(pid=>{const p=t.players.find(x=>x.id===pid);return p?`<div class="queue-item">
      <div><b>${esc(p.name)}</b>&nbsp;${catBadgeHtml(p.categoryId,t.categories)}</div>
      <button class="btn btn-sm" onclick="requeuePlayer('${pid}')">Re-queue</button>
    </div>`:''}).join('')}</div>`}
  </div>
  ${soldHtml}`;
}

window.startCategoryAuction = catId => { const t=currentTournament();if(!t)return;const q=t.players.filter(p=>p.categoryId===catId&&!(t.auction.sold||{})[p.id]&&!(t.auction.unsold||[]).includes(p.id)).map(p=>p.id);if(!q.length){alert('No players left.');return;}if(t.teams.length<2){alert('Add at least 2 teams first.');return;}const cat=t.categories.find(c=>c.id===catId);t.auction.active=true;t.auction.queue=q;t.auction.currentPlayerId=q[0];t.auction.currentBid=cat?cat.basePrice:0;t.auction.leadTeamId=null;save();render(); };
window.pauseAuction  = () => { const t=currentTournament();if(t){t.auction.active=false;save();render();} };
window.resumeAuction = () => { const t=currentTournament();if(t&&t.auction.currentPlayerId){t.auction.active=true;save();render();} };
window.stopAuction   = () => { if(!confirm('Stop auction?'))return;const t=currentTournament();if(!t)return;t.auction.active=false;t.auction.currentPlayerId=null;t.auction.currentBid=0;t.auction.leadTeamId=null;t.auction.queue=[];save();render(); };
window.revokeSold = pid => { const t=currentTournament();if(!t)return;const p=t.players.find(x=>x.id===pid);if(!p)return;if(!confirm(`Revoke sale of "${p.name}" and return to queue?`))return;delete (t.auction.sold||{})[pid];const q=t.auction.queue||[];if(!q.includes(pid)){if(t.auction.currentPlayerId){const i=q.indexOf(t.auction.currentPlayerId);q.splice(i+1,0,pid);}else q.unshift(pid);t.auction.queue=q;}save();render(); };

function renderLiveAuction(t) {
  const a=t.auction, player=t.players.find(p=>p.id===a.currentPlayerId);
  if (!player) { a.active=false;a.currentPlayerId=null;save();render();return `<div class="empty">Auction error.</div>`; }
  const cat=t.categories.find(c=>c.id===player.categoryId), lead=a.leadTeamId?t.teams.find(tm=>tm.id===a.leadTeamId):null;
  const step=cat?cat.bidStep:50000, qIdx=(a.queue||[]).indexOf(a.currentPlayerId);
  if (player.userId&&!statsCache[player.userId]){statsCache[player.userId]='loading';fetchPlayerStats(player.userId);}
  return `
  <div class="section-header">
    <div class="section-title"><span class="dot dot-green"></span> Live — ${cat?cat.icon+' '+cat.label:'Auction'}</div>
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:13px;color:var(--muted)">${qIdx+1} / ${(a.queue||[]).length}</span>
      <button class="btn btn-sm btn-amber" onclick="pauseAuction()">⏸ Pause</button>
    </div>
  </div>
  <div class="auction-main">
    <div>
      <div class="player-spotlight">
        <div class="spotlight-pic">${playerPhotoHtml(player,90)}</div>
        <div class="spotlight-name">${esc(player.name)}</div>
        <div style="margin-bottom:6px">${cat?`<span class="cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${esc(cat.label)}</span>`:''}<span style="font-size:12px;color:var(--muted);margin-left:6px">${esc(player.role||'')}${player.country?' · '+esc(player.country):''}</span></div>
        ${player.bio?`<div class="spotlight-bio">${esc(player.bio)}</div>`:''}
        ${player.userId?renderStatsSection(player.userId):''}
        <div class="current-bid-label" style="margin-top:14px">Current bid</div>
        <div class="current-bid">${fmt(a.currentBid)}</div>
        <div class="leading-team">${lead?`<span style="color:var(--green);font-weight:500">⬆ ${esc(lead.name)} is leading</span>`:`<span style="color:var(--muted)">No bid yet</span>`}</div>
        <div class="bid-actions">
          <button class="btn btn-primary" onclick="sellPlayer()" ${!lead?'disabled':''}>✓ Sold to ${lead?esc(lead.name):'—'}</button>
          <button class="btn btn-danger" onclick="promptMarkUnsold()">✕ Pass</button>
          ${qIdx+1<(a.queue||[]).length?`<button class="btn" onclick="promptSkip()">Skip →</button>`:''}
        </div>
      </div>
      <div class="card" style="margin-top:12px"><div class="card-title">Up next</div>
        <div class="queue-list">${(a.queue||[]).slice(qIdx+1).map((pid,i)=>{const pp=t.players.find(x=>x.id===pid);return pp?`<div class="queue-item">
          <div style="display:flex;align-items:center;gap:8px">${(pp.photo||pp.photoLocal)?`<img src="${pp.photoLocal||pp.photo}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;flex-shrink:0;" onerror="this.style.display='none'"/>`:''}<span>${i+1}. <b>${esc(pp.name)}</b></span></div>
          <span style="font-size:11px;color:var(--muted)">${fmt((t.categories.find(c=>c.id===pp.categoryId)||{}).basePrice||0)}</span>
        </div>`:''}).join('')||`<div style="padding:8px;font-size:12px;color:var(--muted)">End of queue</div>`}</div>
      </div>
    </div>
    <div class="teams-sidebar">${t.teams.map(tm=>{
      const budget=teamBudget(tm,t),nextBid=a.currentBid+step,canBid=budget>=nextBid,isLead=a.leadTeamId===tm.id,squad=teamSquad(tm.id,t);
      return `<div class="auction-team-card ${isLead?'leading':''}" data-tmid="${tm.id}">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--green-light);color:var(--green);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${tm.teamLogo?`<img src="${tm.teamLogo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:initials(tm.name)}</div>
          <div style="font-size:13px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(tm.name)}</div>
          <span class="lead-dot" style="font-size:10px;color:var(--green);display:${isLead?'inline':'none'}">●</span>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:4px"><span class="team-budget-line">${fmt(budget)}</span> left &bull; <span style="color:var(--green)">${squad.length} bought</span></div>
        <button class="btn btn-primary btn-sm btn-full" onclick="placeBid('${tm.id}')" ${!canBid?'disabled':''}>${isLead?'Raise +'+fmt(step):'Bid '+fmt(nextBid)}</button>
        ${squad.length?`<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:2px">${squad.map(({player:pp,price})=>`<span style="font-size:10px;background:var(--bg);border-radius:12px;padding:2px 5px;display:inline-flex;align-items:center;gap:2px">
          ${(pp.photo||pp.photoLocal)?`<img src="${pp.photoLocal||pp.photo}" style="width:12px;height:12px;border-radius:50%;object-fit:cover;" onerror="this.style.display='none'"/>`:''} ${esc(pp.name.split(' ')[0])}
          <button onclick="revokeSold('${pp.id}')" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:9px;padding:0" title="Revoke">✕</button>
        </span>`).join('')}</div>`:''}
      </div>`;
    }).join('')}</div>
  </div>`;
}

function patchTeamBidUI(token, t, myTeam) {
  const a = t.auction;
  const isLead = a.leadTeamId === myTeam.id;
  const player = (t.players||[]).find(p=>p.id===a.currentPlayerId);
  const cat    = (t.categories||[]).find(c=>c.id===(player||{}).categoryId);
  const step   = cat ? cat.bidStep : 50000;
  const nextBid = a.currentBid + step;
  const budget  = teamBudget(myTeam, t);
  const canBid  = budget >= nextBid && !isLead;
  const leadTeam = a.leadTeamId ? (t.teams||[]).find(x=>x.id===a.leadTeamId) : null;

  // Bid amount
  const bidEl = document.querySelector('.team-bid-amount');
  if (bidEl) { bidEl.textContent=fmt(a.currentBid); bidEl.style.transform='scale(1.1)'; setTimeout(()=>{bidEl.style.transform='scale(1)';},200); }

  // Leading text
  const leadEl = document.querySelector('.team-bid-leading');
  if (leadEl) {
    leadEl.innerHTML = isLead
      ? `<span style="color:var(--green);font-weight:600">✓ You are leading!</span>`
      : leadTeam ? `<span style="color:var(--muted)">⬆ ${esc(leadTeam.name)} is leading</span>`
      : `<span style="color:var(--muted)">No bids yet</span>`;
  }

  // Bid button area
  const btnArea = document.querySelector('.team-bid-btn-area');
  if (btnArea) {
    btnArea.innerHTML = isLead
      ? `<button class="btn btn-primary btn-lg" onclick="teamPlaceBid('${token}','${myTeam.id}')">Raise by ${fmt(step)}</button>`
      : canBid
      ? `<button class="btn btn-primary btn-lg" onclick="teamPlaceBid('${token}','${myTeam.id}')">Bid ${fmt(nextBid)}</button>`
      : budget < nextBid
      ? `<div style="font-size:13px;color:var(--muted);padding:12px 0">Insufficient purse to bid</div>`
      : `<div style="font-size:13px;color:var(--green);padding:12px 0">✓ You are already leading</div>`;
  }

  // Purse amount
  const purseEl = document.querySelector('.team-purse-amount');
  if (purseEl) purseEl.textContent = fmt(budget);
}

function renderStatsSection(userId) {
  const cached=statsCache[userId];
  if (!cached||cached==='loading') return `<div class="stats-loading"><span class="spinner"></span> Loading stats...</div>`;
  if (cached==='error'||cached==='none') return `<div style="font-size:12px;color:var(--muted);margin-top:6px">Stats not available</div>`;
  const stats=cached.statistics||cached, batting=Array.isArray(stats.batting)?stats.batting:[], bowling=Array.isArray(stats.bowling)?stats.bowling:[], fielding=Array.isArray(stats.fielding)?stats.fielding:[];
  if (!batting.length&&!bowling.length&&!fielding.length) return `<div style="font-size:12px;color:var(--muted);margin-top:6px">No stats available</div>`;
  const tabs=[];if(batting.length)tabs.push({key:'bat',label:'🏏 Batting',items:batting});if(bowling.length)tabs.push({key:'bowl',label:'⚡ Bowling',items:bowling});if(fielding.length)tabs.push({key:'fld',label:'🧤 Fielding',items:fielding});
  const fk=tabs[0].key, sid='stats-'+userId.replace(/[^a-z0-9]/gi,''), isOpen=statsOpenUsers.has(userId);
  const tabHeaders=tabs.map(tb=>`<div class="stats-tab ${tb.key===fk?'active':''}" id="${sid}-tab-${tb.key}" onclick="statsShowTab('${sid}','${tb.key}')">${tb.label}</div>`).join('');
  const tabPanels=tabs.map(tb=>`<div id="${sid}-panel-${tb.key}" style="display:${tb.key===fk?'grid':'none'};grid-template-columns:repeat(3,1fr);gap:6px">${tb.items.map(item=>`<div class="stat-box"><div class="sv">${esc(String(item.value??'—'))}</div><div class="sk">${esc(item.title||'')}</div></div>`).join('')}</div>`).join('');
  return `<div class="stats-widget" id="${sid}"><div class="stats-toggle" onclick="statsToggle('${sid}','${userId}')"><span>📊 Career Stats</span><span id="${sid}-arrow" style="font-size:11px;transition:transform .2s;display:inline-block;transform:${isOpen?'rotate(180deg)':'rotate(0deg)'}">▼</span></div><div id="${sid}-body" style="display:${isOpen?'block':'none'}"><div class="stats-tabs">${tabHeaders}</div><div class="stats-body">${tabPanels}</div></div></div>`;
}
window.statsToggle = (sid,userId) => { const body=document.getElementById(sid+'-body'),arrow=document.getElementById(sid+'-arrow');if(!body)return;const willOpen=body.style.display==='none';body.style.display=willOpen?'block':'none';if(arrow)arrow.style.transform=willOpen?'rotate(180deg)':'rotate(0deg)';if(userId){willOpen?statsOpenUsers.add(userId):statsOpenUsers.delete(userId);} };
window.statsShowTab = (sid,key) => { document.querySelectorAll(`[id^="${sid}-panel-"]`).forEach(p=>p.style.display='none');document.querySelectorAll(`[id^="${sid}-tab-"]`).forEach(t=>t.classList.remove('active'));const panel=document.getElementById(`${sid}-panel-${key}`),tab=document.getElementById(`${sid}-tab-${key}`);if(panel)panel.style.display='grid';if(tab)tab.classList.add('active'); };
async function fetchPlayerStats(userId) {
  try {
    const resp = await fetch(`https://api.cricheroes.in/api/v1/player/get-player-statistic/${userId}`, {headers:CH_HEADERS});
    if (!resp.ok) { statsCache[userId]='error'; patchStatsInDOM(userId); return; }
    const data = await resp.json();
    const stats = data.data || data;
    statsCache[userId] = (stats && typeof stats==='object') ? stats : 'none';
  } catch(e) {
    statsCache[userId] = 'error';
  }
  patchStatsInDOM(userId);
}

// Patch stats HTML in-place without a full re-render
function patchStatsInDOM(userId) {
  const sid = 'stats-' + userId.replace(/[^a-z0-9]/gi,'');
  const el = document.getElementById(sid);
  if (el) {
    el.outerHTML = renderStatsSection(userId);
  } else {
    // Widget not in DOM yet — fall back to full re-render only on auction page
    if (currentPage==='auction' && currentTournament() && currentTournament().auction.active) render();
  }
}

window.placeBid = teamId => {
  const t=currentTournament();if(!t)return;
  const player=t.players.find(p=>p.id===t.auction.currentPlayerId);
  const cat=t.categories.find(c=>c.id===(player||{}).categoryId);
  t.auction.currentBid+=(cat?cat.bidStep:50000);
  t.auction.leadTeamId=teamId;
  save();
  const tm = t.teams.find(x=>x.id===teamId);
  showBidFlash(tm?tm.name:'', t.auction.currentBid);
  patchAuctionBidUI(t);
};

// Bid flash animation — slides in from bottom, shows team + amount
function showBidFlash(teamName, amount) {
  const ex = document.getElementById('bid-flash'); if(ex) ex.remove();
  const el = document.createElement('div'); el.id='bid-flash';
  el.innerHTML = `<div class="bid-flash-inner"><span class="bid-flash-team">⬆ ${esc(teamName)}</span><span class="bid-flash-amt">${fmt(amount)}</span></div>`;
  document.body.appendChild(el);
  requestAnimationFrame(()=>{ el.classList.add('bid-flash-show'); });
  setTimeout(()=>{ el.classList.add('bid-flash-hide'); setTimeout(()=>el.remove(),400); },1800);
}

function showSoldStamp(teamName, price, callback) {
  const existing=document.getElementById('sold-stamp-overlay'); if(existing)existing.remove();
  const ov=document.createElement('div'); ov.id='sold-stamp-overlay';
  ov.innerHTML=`
  <div class="sold-stamp-bg">
    <div class="sold-hammer">🔨</div>
    <div class="sold-stamp-box">
      <div class="sold-stamp-text">SOLD!</div>
      <div class="sold-stamp-team">${esc(teamName)}</div>
      <div class="sold-stamp-price">${fmt(price)}</div>
    </div>
  </div>`;
  document.body.appendChild(ov);
  setTimeout(()=>{ov.classList.add('sold-stamp-fade');setTimeout(()=>{ov.remove();if(callback)callback();},400);},2000);
}

// Patch only changing elements on a bid — no full re-render flash
function patchAuctionBidUI(t) {
  const a=t.auction;
  const lead=a.leadTeamId?t.teams.find(tm=>tm.id===a.leadTeamId):null;
  const player=t.players.find(p=>p.id===a.currentPlayerId);
  const cat=t.categories.find(c=>c.id===(player||{}).categoryId);
  const step=cat?cat.bidStep:50000;

  // Bid amount
  const bidEl=document.querySelector('.current-bid');
  if (bidEl) { bidEl.textContent=fmt(a.currentBid); bidEl.style.transform='scale(1.08)'; setTimeout(()=>{bidEl.style.transform='scale(1)';},200); }

  // Leading team text
  const leadEl=document.querySelector('.leading-team');
  if (leadEl) leadEl.innerHTML=lead?`<span style="color:var(--green);font-weight:500">⬆ ${esc(lead.name)} is leading</span>`:`<span style="color:var(--muted)">No bid yet</span>`;

  // Sell button
  const sellBtn=document.querySelector('.bid-actions .btn-primary');
  if (sellBtn) { sellBtn.disabled=!lead; sellBtn.textContent=lead?`✓ Sold to ${lead.name}`:'✓ Sold to —'; }

  // Team sidebar cards
  t.teams.forEach(tm => {
    const budget=teamBudget(tm,t), nextBid=a.currentBid+step, canBid=budget>=nextBid, isLead=a.leadTeamId===tm.id;
    const card=document.querySelector(`.auction-team-card[data-tmid="${tm.id}"]`);
    if (!card) return;
    card.classList.toggle('leading',isLead);
    const btn=card.querySelector('button.btn-primary');
    if (btn) { btn.disabled=!canBid; btn.textContent=isLead?'Raise +'+fmt(step):'Bid '+fmt(nextBid); }
    const dot=card.querySelector('.lead-dot');
    if (dot) dot.style.display=isLead?'inline':'none';
    const budgetEl=card.querySelector('.team-budget-line');
    if (budgetEl) budgetEl.textContent=`${fmt(budget)} left`;
  });
}

window.sellPlayer = () => {
  const t=currentTournament();if(!t)return;const a=t.auction;if(!a.leadTeamId)return;
  const leadTeam=t.teams.find(tm=>tm.id===a.leadTeamId);
  a.sold=a.sold||{};a.sold[a.currentPlayerId]={teamId:a.leadTeamId,price:a.currentBid};
  showSoldStamp(leadTeam?leadTeam.name:'',a.currentBid,()=>advanceQueue(t));
};

// Fix: popup for unsold/skip with option to move category
window.promptMarkUnsold = () => {
  const t=currentTournament();if(!t)return;
  const a=t.auction, player=t.players.find(p=>p.id===a.currentPlayerId);
  if(!player) return;
  const cat=(t.categories||[]).find(c=>c.id===player.categoryId);
  const catOptions=t.categories.filter(c=>c.id!==player.categoryId).map(c=>`<option value="${c.id}">${c.icon} ${esc(c.label)}</option>`).join('');
  const photoSrc=player.photoLocal||player.photo||'';
  showModal('Pass player',`
    <div style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:16px">
      <div style="width:48px;height:48px;border-radius:50%;overflow:hidden;background:var(--card-bg);flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2px solid ${cat?cat.color:'var(--border)'}">
        ${photoSrc?`<img src="${photoSrc}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
          `<span style="font-size:16px;font-weight:600;color:var(--muted)">${initials(player.name)}</span>`}
      </div>
      <div>
        <div style="font-size:15px;font-weight:600">${esc(player.name)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${cat?cat.icon+' '+cat.label:''} &bull; ${esc(player.role||'')}</div>
      </div>
    </div>
    <div style="font-size:13px;font-weight:500;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;font-size:11px">What would you like to do?</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full pass-action-btn" onclick="closeModal();doMarkUnsold()" style="text-align:left;padding:14px 16px;border-radius:var(--radius-sm)">
        <div style="font-size:15px;margin-bottom:1px">🔁 Move to end of queue</div>
        <div style="font-size:12px;color:var(--muted);font-weight:400">Player comes back at the end of this auction round</div>
      </button>
      ${catOptions?`
      <div style="padding:14px 16px;border:.5px solid var(--border);border-radius:var(--radius-sm);background:var(--card-bg)">
        <div style="font-size:14px;font-weight:500;margin-bottom:8px">📂 Move to different category</div>
        <select id="move-cat-select" style="margin-bottom:10px;font-size:13px">${catOptions}</select>
        <button class="btn btn-primary btn-sm" onclick="doMoveCategoryAndPass()" style="width:100%">Move & pass →</button>
      </div>`:''}
      <button class="btn btn-danger btn-full pass-action-btn" onclick="closeModal();doMarkUnsoldFinal()" style="text-align:left;padding:14px 16px;border-radius:var(--radius-sm)">
        <div style="font-size:15px;margin-bottom:1px">🚫 Mark as unsold (final)</div>
        <div style="font-size:12px;opacity:.75;font-weight:400">Permanently remove from auction queue</div>
      </button>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">Cancel</button></div>`);
};
window.promptSkip = () => {
  const t=currentTournament();if(!t)return;
  const player=t.players.find(p=>p.id===t.auction.currentPlayerId);
  if(!player) return;
  const cat=(t.categories||[]).find(c=>c.id===player.categoryId);
  const catOptions=t.categories.filter(c=>c.id!==player.categoryId).map(c=>`<option value="${c.id}">${c.icon} ${esc(c.label)}</option>`).join('');
  const photoSrc=player.photoLocal||player.photo||'';
  showModal('Skip player',`
    <div style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--bg);border-radius:var(--radius-sm);margin-bottom:16px">
      <div style="width:48px;height:48px;border-radius:50%;overflow:hidden;background:var(--card-bg);flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2px solid ${cat?cat.color:'var(--border)'}">
        ${photoSrc?`<img src="${photoSrc}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
          `<span style="font-size:16px;font-weight:600;color:var(--muted)">${initials(player.name)}</span>`}
      </div>
      <div>
        <div style="font-size:15px;font-weight:600">${esc(player.name)}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${cat?cat.icon+' '+cat.label:''} &bull; ${esc(player.role||'')}</div>
      </div>
    </div>
    <div style="font-size:11px;font-weight:500;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">Where should this player go?</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full pass-action-btn" onclick="closeModal();doSkip()" style="text-align:left;padding:14px 16px;border-radius:var(--radius-sm)">
        <div style="font-size:15px;margin-bottom:1px">⏭ Skip — move to next player</div>
        <div style="font-size:12px;color:var(--muted);font-weight:400">This player moves to the end of the queue</div>
      </button>
      ${catOptions?`
      <div style="padding:14px 16px;border:.5px solid var(--border);border-radius:var(--radius-sm);background:var(--card-bg)">
        <div style="font-size:14px;font-weight:500;margin-bottom:8px">📂 Move to different category</div>
        <select id="move-cat-select" style="margin-bottom:10px;font-size:13px">${catOptions}</select>
        <button class="btn btn-primary btn-sm" onclick="doMoveCategoryAndSkip()" style="width:100%">Move & skip →</button>
      </div>`:''}
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:12px"><button class="btn" onclick="closeModal()">Cancel</button></div>`);
};

window.doMarkUnsold      = () => { const t=currentTournament();if(!t)return;const a=t.auction,pid=a.currentPlayerId,q=a.queue||[],idx=q.indexOf(pid);if(idx!==-1)q.splice(idx,1);q.push(pid);a.queue=q;advanceQueue(t); };
window.doMarkUnsoldFinal = () => { const t=currentTournament();if(!t)return;const a=t.auction;if(!a.unsold)a.unsold=[];if(!a.unsold.includes(a.currentPlayerId))a.unsold.push(a.currentPlayerId);advanceQueue(t); };
window.doSkip            = () => { const t=currentTournament();if(t)advanceQueue(t); };
window.doMoveCategoryAndPass = () => { const t=currentTournament();if(!t)return;const catId=vv('move-cat-select');if(!catId)return;const p=t.players.find(x=>x.id===t.auction.currentPlayerId);if(p)p.categoryId=catId;closeModal();doMarkUnsold(); };
window.doMoveCategoryAndSkip = () => { const t=currentTournament();if(!t)return;const catId=vv('move-cat-select');if(!catId)return;const p=t.players.find(x=>x.id===t.auction.currentPlayerId);if(p)p.categoryId=catId;closeModal();doSkip(); };

function advanceQueue(t) {
  const a=t.auction,q=a.queue||[],idx=q.indexOf(a.currentPlayerId),next=idx+1;
  if(next>=q.length){a.active=false;a.currentPlayerId=null;a.leadTeamId=null;a.currentBid=0;save();render();setTimeout(()=>alert('Auction complete!'),100);return;}
  const nextP=t.players.find(p=>p.id===q[next]),nextC=t.categories.find(c=>c.id===(nextP||{}).categoryId);
  a.currentPlayerId=q[next];a.currentBid=nextC?nextC.basePrice:0;a.leadTeamId=null;save();render();
}
window.requeuePlayer = pid => { const t=currentTournament();if(!t)return;t.auction.unsold=(t.auction.unsold||[]).filter(x=>x!==pid);save();render(); };

function showSoldStamp(teamName, price, callback) {
  const existing=document.getElementById('sold-stamp-overlay'); if(existing)existing.remove();
  const ov=document.createElement('div'); ov.id='sold-stamp-overlay';
  ov.innerHTML=`<div class="sold-stamp-bg"><div class="sold-stamp-box"><div class="sold-stamp-text">SOLD!</div><div class="sold-stamp-team">${esc(teamName)}</div><div class="sold-stamp-price">${fmt(price)}</div></div></div>`;
  document.body.appendChild(ov);
  setTimeout(()=>{ov.classList.add('sold-stamp-fade');setTimeout(()=>{ov.remove();if(callback)callback();},400);},1600);
}

// ══════════════════════════════════════════════════════════
//  RESULTS
// ══════════════════════════════════════════════════════════
function renderResults() {
  const t=currentTournament();if(!t)return '';
  const soldEntries=Object.entries(t.auction.sold||{});
  const totalSpend=soldEntries.reduce((s,[,x])=>s+x.price,0);
  const avgPrice = soldEntries.length ? Math.round(totalSpend/soldEntries.length) : 0;

  // Sorted by price
  const allSold = soldEntries
    .map(([pid,s]) => ({ player:t.players.find(p=>p.id===pid), team:(t.teams||[]).find(tm=>tm.id===s.teamId), price:s.price }))
    .filter(x=>x.player&&x.team)
    .sort((a,b)=>b.price-a.price);

  const top10 = allSold.slice(0, 10);

  const leaderboardHtml = top10.length ? `
  <div class="card" style="margin-bottom:24px">
    <div class="card-title">🏆 Top 10 Most Expensive Players</div>
    ${top10.map(({player:p,team:tm,price},i)=>{
      const cat=(t.categories||[]).find(c=>c.id===p.categoryId);
      const photoSrc=p.photoLocal||p.photo||'';
      const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':null;
      return `<div style="display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:.5px solid var(--border);${i===top10.length-1?'border:none':''};cursor:pointer" onclick="showPlayerModal('${p.id}')">
        <div style="font-size:${medal?'22px':'13px'};font-weight:700;color:var(--muted);width:30px;text-align:center;flex-shrink:0">${medal||i+1}</div>
        <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:var(--bg);flex-shrink:0;display:flex;align-items:center;justify-content:center;border:2px solid ${cat?cat.color:'var(--border)'}">
          ${photoSrc?`<img src="${photoSrc}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
            `<span style="font-size:13px;font-weight:600;color:var(--muted)">${initials(p.name)}</span>`}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${esc(p.name)}</div>
          <div style="font-size:11px;color:var(--muted);display:flex;gap:6px;align-items:center;margin-top:2px">
            ${cat?`<span class="cat-badge" style="background:${cat.color}22;color:${cat.color};font-size:10px">${cat.icon} ${esc(cat.label)}</span>`:''}
            ${esc(p.role||'')}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:16px;font-weight:700;color:var(--green)">${fmt(price)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:1px">${esc(tm.name)}</div>
        </div>
      </div>`;
    }).join('')}
  </div>` : '';

  return `
  <div class="results-hero">
    <div class="results-hero-stat">
      <div class="rh-val">${soldEntries.length}</div>
      <div class="rh-lbl">Players Sold</div>
    </div>
    <div class="results-hero-divider"></div>
    <div class="results-hero-stat">
      <div class="rh-val">${(t.auction.unsold||[]).length}</div>
      <div class="rh-lbl">Unsold</div>
    </div>
    <div class="results-hero-divider"></div>
    <div class="results-hero-stat">
      <div class="rh-val rh-val-sm">${fmt(totalSpend)}</div>
      <div class="rh-lbl">Total Spend</div>
    </div>
    <div class="results-hero-divider"></div>
    <div class="results-hero-stat">
      <div class="rh-val rh-val-sm">${fmt(avgPrice)}</div>
      <div class="rh-lbl">Avg. Price</div>
    </div>
    <div style="margin-left:auto;padding-left:16px">
      <button class="btn btn-primary btn-sm" onclick="exportAllPDF()">⬇ All teams PDF</button>
    </div>
  </div>
  ${leaderboardHtml}
  ${!t.teams.length?`<div class="empty">No teams yet.</div>`:t.teams.map(tm=>renderTeamResult(t,tm)).join('')}`;
}
function renderTeamResult(t,tm) {
  const squad=teamSquad(tm.id,t),spent=squad.reduce((s,x)=>s+x.price,0),remaining=(t.budget||0)-spent,logo=tm.teamLogo||tm.ownerPhoto||null;
  const bannerPlayers=squad.map(({player:p,price})=>`<div class="tb-player"><div class="tb-player-pic">${(p.photo||p.photoLocal)?`<img src="${p.photoLocal||p.photo}" onerror="this.style.display='none'"/>`:initials(p.name)}</div><div class="tb-player-name">${esc(p.name.split(' ')[0])}</div><div class="tb-player-price">${fmt(price)}</div></div>`).join('');
  return `
  <div class="team-banner-card" id="banner-${tm.id}">
    ${t.bannerImage?`<img src="${t.bannerImage}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.12;border-radius:12px;"/>`:'' }
    <div class="tb-header"><div class="tb-avatar">${logo?`<img src="${logo}" onerror="this.style.display='none'"/>`:initials(tm.name)}</div>
      <div><div class="tb-name">${esc(tm.name)}</div><div class="tb-owner">Owner: ${esc(tm.owner||'—')}</div><div class="tb-budget">Spent: ${fmt(spent)} &bull; Left: ${fmt(remaining)}</div></div>
      <div style="margin-left:auto"><button class="btn btn-sm" style="background:rgba(255,255,255,.25);color:#fff;border-color:rgba(255,255,255,.4)" onclick="exportTeamPDF('${tm.id}')">⬇ PDF</button></div>
    </div>
    ${squad.length?`<div class="tb-players">${bannerPlayers}</div>`:`<div style="opacity:.7;font-size:13px">No players yet</div>`}
  </div>
  <div class="card" style="margin-top:-8px;margin-bottom:24px">
    ${!squad.length?`<div style="font-size:13px;color:var(--muted)">No players acquired yet.</div>`:`
    <table class="results-table"><thead><tr><th></th><th>Player</th><th>Role</th><th>Category</th><th style="text-align:right">Price</th></tr></thead>
    <tbody>${squad.map(({player:p,price})=>`<tr>
      <td style="width:36px"><div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:var(--bg);display:flex;align-items:center;justify-content:center;font-size:10px">${(p.photo||p.photoLocal)?`<img src="${p.photoLocal||p.photo}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:initials(p.name)}</div></td>
      <td style="font-weight:500">${esc(p.name)}</td><td style="color:var(--muted)">${esc(p.role||'')}</td>
      <td>${catBadgeHtml(p.categoryId,t.categories)}</td>
      <td style="text-align:right;color:var(--green);font-weight:500">${fmt(price)}</td>
    </tr>`).join('')}</tbody></table>`}
  </div>`;
}

// ── PDF ───────────────────────────────────────────────────
function buildPDFPage(doc,t,tm,isFirst) {
  if(!isFirst)doc.addPage();
  const realSquad=Object.entries(t.auction.sold||{}).filter(([,s])=>s.teamId===tm.id).map(([pid,s])=>({player:t.players.find(p=>p.id===pid),price:s.price})).filter(x=>x.player);
  const spent=realSquad.reduce((s,x)=>s+x.price,0);
  const [cr,cg,cb]=[29,158,117];
  doc.setFillColor(cr,cg,cb);doc.rect(0,0,210,40,'F');doc.setTextColor(255,255,255);
  doc.setFontSize(10);doc.setFont(undefined,'normal');doc.text(t.name||'AuctionAdda',14,12);
  doc.setFontSize(22);doc.setFont(undefined,'bold');doc.text(tm.name,14,26);
  doc.setFontSize(10);doc.setFont(undefined,'normal');doc.text(`Owner: ${tm.owner||'—'}`,14,34);
  doc.setTextColor(cr,cg,cb);doc.setFontSize(11);doc.setFont(undefined,'bold');
  doc.text(`Spent: ${fmt(spent)}   Remaining: ${fmt((t.budget||0)-spent)}   Players: ${realSquad.length}`,14,52);
  doc.setTextColor(80,80,80);doc.setFont(undefined,'normal');
  if(!realSquad.length){doc.text('No players acquired yet.',14,70);return;}
  let y=62;doc.setFillColor(cr,cg,cb);doc.rect(14,y,182,8,'F');doc.setTextColor(255,255,255);doc.setFontSize(9);doc.setFont(undefined,'bold');
  doc.text('#',16,y+5.5);doc.text('Player',24,y+5.5);doc.text('Role',90,y+5.5);doc.text('Category',125,y+5.5);doc.text('Price',175,y+5.5,{align:'right'});
  y+=8;doc.setFont(undefined,'normal');
  realSquad.forEach(({player:p,price},i)=>{if(y>270){doc.addPage();y=20;}if(i%2===0){doc.setFillColor(245,245,245);doc.rect(14,y,182,8,'F');}
    doc.setTextColor(40,40,40);doc.setFontSize(9);doc.text(String(i+1),16,y+5.5);doc.text(p.name,24,y+5.5);doc.text(p.role||'',90,y+5.5);
    const cat=t.categories.find(c=>c.id===p.categoryId);doc.text(cat?cat.label:p.categoryId||'',125,y+5.5);
    doc.setTextColor(cr,cg,cb);doc.setFont(undefined,'bold');doc.text(fmt(price),195,y+5.5,{align:'right'});doc.setFont(undefined,'normal');doc.setTextColor(40,40,40);y+=8;
  });
  doc.setFontSize(8);doc.setTextColor(160,160,160);doc.text(`Generated by AuctionAdda — ${new Date().toLocaleDateString('en-IN')}`,105,290,{align:'center'});
}
window.exportTeamPDF = tmId => { const t=currentTournament(),tm=t?(t.teams||[]).find(x=>x.id===tmId):null;if(!tm)return;if(!window.jspdf?.jsPDF){alert('PDF loading…');return;}try{const doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});buildPDFPage(doc,t,tm,true);doc.save(`${tm.name.replace(/\s+/g,'_')}_squad.pdf`);}catch(e){alert('PDF failed: '+e.message);} };
window.exportAllPDF = () => { const t=currentTournament();if(!t||!t.teams.length){alert('No teams.');return;}if(!window.jspdf?.jsPDF){alert('PDF loading…');return;}try{const doc=new window.jspdf.jsPDF({orientation:'portrait',unit:'mm',format:'a4'});t.teams.forEach((tm,i)=>buildPDFPage(doc,t,tm,i===0));doc.save(`${(t.name||'AuctionAdda').replace(/\s+/g,'_')}_all_teams.pdf`);}catch(e){alert('PDF failed: '+e.message);} };

// ══════════════════════════════════════════════════════════
//  MODAL
// ══════════════════════════════════════════════════════════
function showModal(title, bodyHtml) {
  const box=document.getElementById('modal-box');
  box.innerHTML=`<div class="modal-header"><div class="modal-title">${esc(title)}</div><button class="modal-close" onclick="closeModal()">&times;</button></div><div id="modal-body">${bodyHtml}</div>`;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
window.closeModal = () => document.getElementById('modal-overlay').classList.add('hidden');
document.getElementById('modal-overlay').addEventListener('click', e => { if(e.target===document.getElementById('modal-overlay'))e.stopPropagation(); });

// ── Player stats modal (click any player anywhere) ────────
window.showPlayerModal = function(playerId, tourId) {
  const t = tourId ? state.tournaments.find(x=>x.id===tourId) : currentTournament();
  if (!t) return;
  const p = (t.players||[]).find(x=>x.id===playerId); if (!p) return;
  const cat = (t.categories||[]).find(c=>c.id===p.categoryId);
  const soldInfo = (t.auction.sold||{})[p.id];
  const soldTeam = soldInfo ? (t.teams||[]).find(tm=>tm.id===soldInfo.teamId) : null;
  const photoSrc = p.photoLocal||p.photo||'';

  // Kick off stats fetch if needed
  if (p.userId && !statsCache[p.userId]) { statsCache[p.userId]='loading'; fetchPlayerStats(p.userId); }

  const statsSectionHtml = p.userId ? renderStatsSection(p.userId) : `<div style="font-size:12px;color:var(--muted);text-align:center;padding:8px 0">No CricHeroes profile linked</div>`;

  showModal(p.name, `
    <div style="text-align:center;margin-bottom:16px">
      <div style="width:80px;height:80px;border-radius:50%;overflow:hidden;background:var(--bg);margin:0 auto 12px;display:flex;align-items:center;justify-content:center;border:3px solid ${cat?cat.color:'var(--border)'}">
        ${photoSrc?`<img src="${photoSrc}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'"/>`:
          `<span style="font-size:28px;font-weight:700;color:var(--muted)">${initials(p.name)}</span>`}
      </div>
      <div style="font-size:18px;font-weight:700;margin-bottom:4px">${esc(p.name)}</div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:8px">
        ${cat?`<span class="cat-badge" style="background:${cat.color}22;color:${cat.color}">${cat.icon} ${esc(cat.label)}</span>`:''}
        ${p.role?`<span class="cat-badge" style="background:var(--bg);color:var(--muted)">${esc(p.role)}</span>`:''}
        ${p.country?`<span class="cat-badge" style="background:var(--bg);color:var(--muted)">🌍 ${esc(p.country)}</span>`:''}
      </div>
      ${soldTeam?`<div style="display:inline-flex;align-items:center;gap:6px;background:var(--green-light);border-radius:20px;padding:4px 12px;font-size:12px;color:var(--green-dark);font-weight:600">✓ Sold to ${esc(soldTeam.name)} for ${fmt(soldInfo.price)}</div>`:
        cat?`<div style="font-size:12px;color:var(--muted)">Base price: ${fmt(cat.basePrice)}</div>`:''}
    </div>
    ${p.bio?`<div style="font-size:13px;color:var(--muted);background:var(--bg);border-radius:8px;padding:10px 12px;margin-bottom:12px;line-height:1.6">${esc(p.bio)}</div>`:''}
    <div id="player-modal-stats-${p.id}">${statsSectionHtml}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px"><button class="btn" onclick="closeModal()">Close</button></div>`);

  // If stats were loading, patch them in once ready
  if (p.userId && statsCache[p.userId] === 'loading') {
    const origFetch = fetchPlayerStats;
    const pollStats = setInterval(() => {
      if (!statsCache[p.userId] || statsCache[p.userId]==='loading') return;
      clearInterval(pollStats);
      const box = document.getElementById(`player-modal-stats-${p.id}`);
      if (box) box.innerHTML = renderStatsSection(p.userId);
    }, 200);
    setTimeout(()=>clearInterval(pollStats), 15000);
  }
};

// ── Shared ────────────────────────────────────────────────
function showErr(el, msg) { if(el){el.textContent=msg;el.style.display='block';} }
window.doLogout = () => {
  stopAllListeners();
  state.currentUserId = null;
  state.currentTournamentId = null;
  currentPage = 'login';
  statsCache = {};
  statsOpenUsers.clear();
  try { localStorage.removeItem(LS_SESSION); } catch(e) {}
  save(); render();
};

// ══════════════════════════════════════════════════════════
//  BOOT — async, waits for Firestore before first render
// ══════════════════════════════════════════════════════════
async function boot() {
  try {
    await loadFromFirestore();
  } catch(e) {
    console.error('Firestore load failed, falling back to empty state', e);
  }

  // Migrate: ensure all teams have bidTokens
  let needsSave = false;
  state.tournaments.forEach(t => {
    (t.teams||[]).forEach(tm => {
      if (!tm.bidToken) { tm.bidToken = uid() + uid(); needsSave = true; }
    });
  });
  if (needsSave) save();

  // Restore route from session
  if (!getUrlTeamToken() && state.currentUserId) {
    const u = currentUser();
    if (u) currentPage = u.role === 'viewer' ? 'view-live' : 'home';
  }

  // Hide loading splash
  const splash = document.getElementById('app-loading');
  if (splash) splash.style.display = 'none';

  render();
}

boot();
