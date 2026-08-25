/* ============================================================
   YANGA BET — main.js
   ============================================================ */

// ===== ✅ CORRECTED FIREBASE CONFIG from your Firebase Console =====
const firebaseConfig = {
  apiKey: "AIzaSyB15_69jbnl1VBwZf4-VK80QzaW8D02a",
  authDomain: "yanga-bets.firebaseapp.com",
  projectId: "yanga-bets",
  storageBucket: "yanga-bets.firebaseapp.com",
  messagingSenderId: "421888552219",
  appId: "1:421888552219:web:bfc138c49d07dbf5bf77be",
  measurementId: "G-33JN3WXCA"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
// ===== 2. STATE =====
let currentUser = null;
let currentUserData = null;
let selections = [];
let matchesCache = [];
let signalsCache = [];
let allUsers = [];
let allDeposits = [];
let allWithdrawals = [];

// ===== 3. UTILITY FUNCTIONS =====
function $(id) { return document.getElementById(id); }

function showToast(message, type = 'info') {
  const container = $('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.onclick = () => toast.remove();
  container.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}

function formatDate(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatTime(ts) {
  if (!ts) return '-';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function formatCurrency(amount) {
  return '₦' + Number(amount || 0).toLocaleString();
}

function showLoading(text = 'Loading...') {
  $('loadingOverlay').style.display = 'flex';
  $('loadingText').textContent = text;
}

function hideLoading() {
  $('loadingOverlay').style.display = 'none';
}

function showView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  document.querySelectorAll('.page-view').forEach(v => v.style.display = 'none');
  const map = {
    landing: 'viewLanding', login: 'viewLogin', signup: 'viewSignup',
    forgot: 'viewForgotPassword', home: 'viewHome', sports: 'viewSports',
    live: 'viewLive', bets: 'viewBets', signals: 'viewSignals',
    wallet: 'viewWallet', profile: 'viewProfile', admin: 'viewAdmin'
  };
  const el = $(map[viewId]);
  if (el) el.style.display = 'block';
  if (['login','signup','forgot'].includes(viewId)) el.style.display = 'flex';
  if (viewId === 'landing') $('viewLanding').style.display = 'block';
  $('betSlipPanel').classList.remove('visible');
}

function navigateTo(viewId) {
  if (!currentUser && !['landing','login','signup','forgot'].includes(viewId)) {
    showView('landing');
    return;
  }
  showView(viewId);
  // Activate nav items
  document.querySelectorAll('.nav-item, .bottom-nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll(`.nav-item[data-view="${viewId}"], .bottom-nav-item[data-view="${viewId}"]`).forEach(n => n.classList.add('active'));
  // Load data
  const loaders = {
    home: loadHomeData, sports: loadMatches, live: loadLiveMatches,
    bets: loadUserBets, signals: loadSignals, wallet: loadWallet,
    profile: loadProfile, admin: () => { if (currentUserData?.role === 'admin') loadAdminPanel(); else { showToast('Access denied','error'); navigateTo('home'); } }
  };
  if (loaders[viewId]) loaders[viewId]();
  $('betSlipPanel').classList.remove('visible');
}

function toggleMobileMenu() {
  const links = $('navLinks');
  links.style.display = links.style.display === 'flex' ? 'none' : 'flex';
}

// ===== 4. USERNAME TO EMAIL MAPPING =====
function usernameToEmail(username) {
  return username.toLowerCase().trim() + '@yangabet.user';
}

// ===== 5. AUTHENTICATION =====
document.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('yanga_username');
  if (saved && $('loginUsername')) $('loginUsername').value = saved;
  
  auth.onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      await loadUserData(user.uid);
      if (currentUserData) {
        if (['suspended','banned'].includes(currentUserData.status)) {
          showToast('Account suspended. Contact support.', 'error');
          await auth.signOut();
          currentUser = null; currentUserData = null;
          showView('login');
          return;
        }
        $('appMain').style.display = 'block';
        updateUI();
        checkAdminAccess();
        navigateTo('home');
        if ($('menuToggle')) $('navLinks').style.display = 'none';
      }
    } else {
      currentUser = null; currentUserData = null;
      $('appMain').style.display = 'none';
      showView('landing');
    }
  });
});

async function loadUserData(uid) {
  try {
    const doc = await db.collection('users').doc(uid).get();
    if (doc.exists) { currentUserData = doc.data(); return doc.data(); }
    return null;
  } catch (e) { console.error('Load user error:', e); return null; }
}

async function handleSignup(e) {
  e.preventDefault();
  const username = $('signupUsername').value.trim();
  const password = $('signupPassword').value;
  const confirm = $('signupConfirm').value;
  const phone = $('signupPhone').value.trim();

  if (!username || username.length < 3) { showToast('Username must be at least 3 characters', 'error'); return; }
  if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
  if (password !== confirm) { showToast('Passwords do not match', 'error'); return; }
  if (!phone) { showToast('Phone number is required', 'error'); return; }

  showLoading('Creating account...');
  try {
    const existing = await db.collection('users').where('username', '==', username).get();
    if (!existing.empty) { hideLoading(); showToast('Username already taken', 'error'); return; }

    const email = usernameToEmail(username);
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    const uid = cred.user.uid;

    const userData = {
      uid, username, phone, balance: 0, bonusBalance: 0,
      role: 'user', status: 'active',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastLogin: firebase.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(uid).set(userData);
    localStorage.setItem('yanga_username', username);
    currentUser = cred.user;
    currentUserData = userData;
    hideLoading();
    showToast('Account created successfully!', 'success');
    $('appMain').style.display = 'block';
    updateUI(); checkAdminAccess();
    navigateTo('home');
    $('signupForm').reset();
  } catch (err) { hideLoading(); handleFirebaseError(err); }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value;
  const remember = $('rememberUsername').checked;
  if (!username || !password) { showToast('Please enter username and password', 'error'); return; }
  showLoading('Logging in...');
  try {
    const email = usernameToEmail(username);
    const cred = await auth.signInWithEmailAndPassword(email, password);
    const uid = cred.user.uid;
    await db.collection('users').doc(uid).update({ lastLogin: firebase.firestore.FieldValue.serverTimestamp() });
    if (remember) localStorage.setItem('yanga_username', username);
    else localStorage.removeItem('yanga_username');
    await loadUserData(uid);
    if (currentUserData) {
      if (['suspended','banned'].includes(currentUserData.status)) {
        showToast('Account suspended. Contact support.', 'error');
        await auth.signOut(); hideLoading(); return;
      }
      hideLoading();
      showToast('Welcome back!', 'success');
      $('loginForm').reset();
      $('appMain').style.display = 'block';
      updateUI(); checkAdminAccess();
      navigateTo('home');
    }
  } catch (err) { hideLoading(); showToast('Invalid username or password', 'error'); }
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const username = $('forgotUsername').value.trim();
  if (!username) { showToast('Enter your username', 'error'); return; }
  showLoading('Sending reset email...');
  try {
    await auth.sendPasswordResetEmail(usernameToEmail(username));
    hideLoading();
    showToast('Password reset email sent! Check your inbox.', 'success');
    $('forgotForm').reset();
    showView('login');
  } catch (err) { hideLoading(); showToast('If the account exists, a reset email has been sent.', 'info'); showView('login'); }
}

function showForgotPassword() {
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
  $('viewForgotPassword').style.display = 'flex';
}

async function handleLogout() {
  try {
    await auth.signOut();
    currentUser = null; currentUserData = null; selections = [];
    $('appMain').style.display = 'none';
    showView('landing');
    showToast('Logged out successfully', 'info');
  } catch (err) { showToast('Error logging out', 'error'); }
}

function handleFirebaseError(err) {
  const msg = err.code ? err.code.replace('auth/', '').replace(/-/g, ' ') : err.message;
  showToast(msg.charAt(0).toUpperCase() + msg.slice(1), 'error');
}

// ===== 6. UI UPDATES =====
function updateUI() {
  if (!currentUserData) return;
  const name = currentUserData.username || 'User';
  $('displayName').textContent = name;
  $('homeBalance').textContent = formatCurrency(currentUserData.balance);
  $('homeBonus').textContent = formatCurrency(currentUserData.bonusBalance || 0);
  $('walletBalance').textContent = formatCurrency(currentUserData.balance);
  $('walletBonus').textContent = formatCurrency(currentUserData.bonusBalance || 0);
}

function checkAdminAccess() {
  const btn = $('adminNavItem');
  btn.style.display = currentUserData?.role === 'admin' ? 'inline-flex' : 'none';
}

// ===== 7. HOME DATA =====
async function loadHomeData() {
  updateUI();
  loadFeaturedMatches();
  loadHomeSignals();
  loadBetStats();
}

async function loadBetStats() {
  if (!currentUser) return;
  try {
    const q = await db.collection('bets').where('userId', '==', currentUser.uid).get();
    let open = 0, won = 0, lost = 0, total = 0;
    q.forEach(doc => {
      total++;
      const s = doc.data().status;
      if (s === 'pending') open++;
      else if (s === 'won') won++;
      else if (s === 'lost') lost++;
    });
    $('statOpen').textContent = open;
    $('statWon').textContent = won;
    $('statLost').textContent = lost;
    $('statTotal').textContent = total;
  } catch (e) { console.error(e); }
}

async function loadFeaturedMatches() {
  const container = $('featuredMatches');
  try {
    const q = await db.collection('matches').where('status', '==', 'published').orderBy('createdAt', 'desc').limit(4).get();
    if (q.empty) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">⚽</span><p>No featured matches yet</p><p class="small text-muted">Demo: Add matches from admin panel</p></div>`;
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const m = doc.data(); m.id = doc.id;
      container.appendChild(createMatchCard(m, true));
    });
  } catch (e) { container.innerHTML = `<p class="text-muted">Could not load matches</p>`; }
}

async function loadHomeSignals() {
  const container = $('homeSignals');
  try {
    const q = await db.collection('signals').where('published', '==', true).orderBy('createdAt', 'desc').limit(3).get();
    if (q.empty) {
      container.innerHTML = `<div class="empty-state"><p>No signals available yet</p></div>`;
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const s = doc.data(); s.id = doc.id;
      container.appendChild(createSignalCard(s));
    });
  } catch (e) { container.innerHTML = `<p class="text-muted">Could not load signals</p>`; }
}

// ===== 8. MATCHES =====
async function loadMatches(league = 'all') {
  const container = $('sportsMatchList');
  container.innerHTML = '<p class="text-muted">Loading matches...</p>';
  try {
    let q;
    if (league === 'all') {
      q = await db.collection('matches').where('status', '==', 'published').orderBy('createdAt', 'desc').get();
    } else {
      q = await db.collection('matches').where('status', '==', 'published').where('league', '==', league).orderBy('createdAt', 'desc').get();
    }
    if (q.empty) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">⚽</span><p>No matches found</p><p class="small text-muted">Admin can add matches in the admin panel</p></div>`;
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const m = doc.data(); m.id = doc.id;
      container.appendChild(createMatchCard(m, false));
    });
  } catch (e) { container.innerHTML = `<p class="text-muted">Error loading matches</p>`; console.error(e); }
}

async function loadLiveMatches() {
  const container = $('liveMatchList');
  try {
    const q = await db.collection('matches').where('status', '==', 'live').get();
    if (q.empty) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">🔴</span><p>No live matches at the moment</p></div>`;
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const m = doc.data(); m.id = doc.id;
      container.appendChild(createMatchCard(m, false));
    });
  } catch (e) { container.innerHTML = `<p class="text-muted">Error loading live matches</p>`; }
}

function createMatchCard(match, featured = false) {
  const card = document.createElement('div');
  card.className = 'match-card';
  card.dataset.matchId = match.id;
  let badge = match.featured ? '<span class="featured-badge">Featured</span>' : '';
  card.innerHTML = `
    <div class="match-league">${match.league || 'Football'} ${badge}</div>
    <div class="match-teams">
      <span class="match-team match-team-home">${match.homeTeam || 'Home'}</span>
      <span class="match-vs">vs</span>
      <span class="match-team match-team-away">${match.awayTeam || 'Away'}</span>
    </div>
    <div class="match-time">${match.date || 'TBD'} ${match.time || ''}</div>
    <div class="odds-row">
      <button class="odds-btn" data-match='${encodeURIComponent(JSON.stringify(match))}' data-type="home" onclick="selectOdds(this)">
        <span class="odds-label">1</span><span class="odds-value">${match.homeOdds || '1.00'}</span>
      </button>
      <button class="odds-btn" data-match='${encodeURIComponent(JSON.stringify(match))}' data-type="draw" onclick="selectOdds(this)">
        <span class="odds-label">X</span><span class="odds-value">${match.drawOdds || '3.00'}</span>
      </button>
      <button class="odds-btn" data-match='${encodeURIComponent(JSON.stringify(match))}' data-type="away" onclick="selectOdds(this)">
        <span class="odds-label">2</span><span class="odds-value">${match.awayOdds || '4.00'}</span>
      </button>
    </div>
  `;
  return card;
}

// ===== 9. LEAGUE FILTERS =====
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.league-btn');
  if (btn) {
    document.querySelectorAll('.league-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadMatches(btn.dataset.league);
  }
});

// ===== 10. BETTING SLIP =====
function selectOdds(btn) {
  if (!currentUser) { showToast('Please login to place bets', 'warning'); return; }
  let match;
  try { match = JSON.parse(decodeURIComponent(btn.dataset.match)); } catch(e) { return; }
  const type = btn.dataset.type;
  const map = { home: { label: 'Home Win', odds: match.homeOdds },
                draw: { label: 'Draw', odds: match.drawOdds },
                away: { label: 'Away Win', odds: match.awayOdds } };
  const sel = map[type];
  if (!sel) return;
  const idx = selections.findIndex(s => s.matchId === match.id && s.type === type);
  if (idx >= 0) { selections.splice(idx, 1); btn.classList.remove('selected'); }
  else {
    selections.push({
      matchId: match.id, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
      league: match.league, type, label: sel.label, odds: parseFloat(sel.odds)
    });
    btn.classList.add('selected');
  }
  updateSlipUI();
}

function updateSlipUI() {
  const panel = $('betSlipPanel');
  const selectionsDiv = $('slipSelections');
  const footer = $('slipFooter');
  $('slipCount').textContent = selections.length;
  if (selections.length === 0) {
    selectionsDiv.innerHTML = '<p class="text-muted small">Select odds to add here.</p>';
    footer.style.display = 'none';
    panel.classList.remove('visible');
    return;
  }
  panel.classList.add('visible');
  selectionsDiv.innerHTML = '';
  selections.forEach((s, i) => {
    const div = document.createElement('div');
    div.className = 'slip-selection';
    div.innerHTML = `
      <div class="slip-selection-info">
        <strong>${s.homeTeam} vs ${s.awayTeam}</strong>
        <span class="small text-muted">${s.label}</span>
      </div>
      <span class="slip-selection-odds">${s.odds.toFixed(2)}</span>
      <button class="slip-remove" onclick="removeSelection(${i})">✕</button>
    `;
    selectionsDiv.appendChild(div);
  });
  footer.style.display = 'block';
  updateSlip();
}

function removeSelection(index) {
  selections.splice(index, 1);
  updateSlipUI();
}

function clearSlip() {
  selections = [];
  document.querySelectorAll('.odds-btn.selected').forEach(b => b.classList.remove('selected'));
  updateSlipUI();
}

function updateSlip() {
  const stake = parseFloat($('slipStake').value) || 0;
  let totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  totalOdds = Math.round(totalOdds * 100) / 100;
  $('slipTotalOdds').textContent = totalOdds.toFixed(2);
  $('slipPotentialReturn').textContent = formatCurrency(stake * totalOdds);
}

function confirmPlaceBet() {
  if (!currentUser) { showToast('Please login first', 'error'); return; }
  if (selections.length === 0) { showToast('Add selections to your slip', 'error'); return; }
  const stake = parseFloat($('slipStake').value);
  if (!stake || stake < 100) { showToast('Minimum stake is ₦100', 'error'); return; }
  let totalOdds = selections.reduce((acc, s) => acc * s.odds, 1);
  totalOdds = Math.round(totalOdds * 100) / 100;
  const potentialReturn = Math.round(stake * totalOdds);
  if (currentUserData.balance < stake) { showToast('Insufficient balance. Request a deposit.', 'error'); return; }

  const body = $('modalBody');
  body.innerHTML = `
    <h2>Confirm Bet</h2>
    <div style="margin-bottom:1rem;">
      ${selections.map(s => `
        <div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;">
          <span>${s.homeTeam} vs ${s.awayTeam}<br><small class="text-muted">${s.label}</small></span>
          <span style="font-weight:700;color:var(--gold);">${s.odds.toFixed(2)}</span>
        </div>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;"><span>Total Stake</span><span>${formatCurrency(stake)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;font-size:1.1rem;">
      <span>Total Odds</span><span style="color:var(--gold);font-weight:700;">${totalOdds.toFixed(2)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:0.5rem 0;font-size:1.2rem;">
      <span>Potential Return</span><span style="color:var(--green-primary);font-weight:800;">${formatCurrency(potentialReturn)}</span>
    </div>
    <p class="small text-muted mt-1">This is a demo bet. No real money is wagered.</p>
    <div style="display:flex;gap:0.75rem;margin-top:1rem;">
      <button class="btn btn-ghost" style="flex:1;" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" style="flex:1;" onclick="placeBet(${stake}, ${totalOdds}, ${potentialReturn})">Confirm</button>
    </div>`;
  showModal();
}

async function placeBet(stake, totalOdds, potentialReturn) {
  closeModal();
  showLoading('Placing bet...');
  try {
    await db.collection('bets').add({
      userId: currentUser.uid, username: currentUserData.username,
      selections: selections.map(s => ({
        matchId: s.matchId, homeTeam: s.homeTeam, awayTeam: s.awayTeam,
        league: s.league, type: s.type, label: s.label, odds: s.odds
      })),
      stake, totalOdds, potentialReturn, status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const newBalance = currentUserData.balance - stake;
    await db.collection('users').doc(currentUser.uid).update({ balance: newBalance });
    currentUserData.balance = newBalance;
    await db.collection('transactions').add({
      userId: currentUser.uid, type: 'bet', amount: stake, status: 'completed',
      reference: 'bet_' + Date.now(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    selections = [];
    document.querySelectorAll('.odds-btn.selected').forEach(b => b.classList.remove('selected'));
    updateSlipUI();
    updateUI();
    hideLoading();
    showToast('Bet placed successfully!', 'success');
  } catch (e) { hideLoading(); showToast('Error placing bet', 'error'); console.error(e); }
}

// ===== 11. SIGNALS =====
async function loadSignals() {
  const container = $('signalsList');
  container.innerHTML = '<p class="text-muted">Loading signals...</p>';
  try {
    const q = await db.collection('signals').where('published', '==', true).orderBy('createdAt', 'desc').get();
    if (q.empty) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">📡</span><p>No signals available yet</p></div>`;
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const s = doc.data(); s.id = doc.id;
      container.appendChild(createSignalCard(s));
    });
  } catch (e) { container.innerHTML = `<p class="text-muted">Error loading signals</p>`; }
}

function createSignalCard(signal) {
  const card = document.createElement('div');
  card.className = `signal-card${signal.featured ? ' featured' : ''}`;
  const matchDisplay = signal.match || (signal.homeTeam ? signal.homeTeam + ' vs ' + signal.awayTeam : "Today's Match");
  card.innerHTML = `
    <div class="signal-title">${signal.title || 'YANGA DAILY SIGNAL'}</div>
    <div class="signal-match">${matchDisplay}</div>
    <span class="signal-prediction">${signal.prediction || 'Analysis'}</span>
    ${signal.odds ? `<span class="signal-odds" style="margin-left:0.75rem;">Odds: ${signal.odds}</span>` : ''}
    ${signal.description ? `<p class="signal-desc">${signal.description}</p>` : ''}
    <p class="signal-disclaimer">⚠ Analysis only. No prediction is guaranteed.</p>`;
  return card;
}

// ===== 12. BETS =====
async function loadUserBets(filter = 'all') {
  const container = $('betsList');
  if (!currentUser) { container.innerHTML = '<p class="text-muted">Login to see bets</p>'; return; }
  try {
    let q;
    if (filter === 'all') {
      q = await db.collection('bets').where('userId', '==', currentUser.uid).orderBy('createdAt', 'desc').get();
    } else {
      q = await db.collection('bets').where('userId', '==', currentUser.uid).where('status', '==', filter).orderBy('createdAt', 'desc').get();
    }
    if (q.empty) {
      container.innerHTML = `<div class="empty-state"><span class="empty-icon">🎫</span><p>No bets yet</p><p class="small text-muted">Browse sports and place your first bet!</p></div>`;
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const bet = doc.data(); bet.id = doc.id;
      const selHtml = (bet.selections || []).map(s =>
        `<div class="bet-detail">${s.homeTeam} vs ${s.awayTeam} — ${s.label} @ ${s.odds}</div>`
      ).join('');
      const card = document.createElement('div');
      card.className = 'bet-card';
      card.innerHTML = `
        <div class="bet-card-header">
          <span class="small text-muted">${bet.createdAt ? formatDate(bet.createdAt) : ''}</span>
          <span class="bet-status ${bet.status}">${bet.status.toUpperCase()}</span>
        </div>
        ${selHtml}
        <div style="display:flex;justify-content:space-between;margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid var(--border);">
          <span class="bet-detail">Stake: ${formatCurrency(bet.stake)}</span>
          <span class="bet-detail">Odds: ${bet.totalOdds?.toFixed(2)}</span>
        </div>
        <div class="bet-return">Potential: ${formatCurrency(bet.potentialReturn)}</div>`;
      container.appendChild(card);
    });
  } catch (e) { container.innerHTML = `<p class="text-muted">Error loading bets</p>`; }
}

function filterBets(filter) {
  document.querySelectorAll('.bet-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.bet-tab[data-filter="${filter}"]`).classList.add('active');
  loadUserBets(filter);
}

// ===== 13. WALLET =====
async function loadWallet() {
  updateUI();
  if (!currentUser) return;
  try {
    const q = await db.collection('transactions').where('userId', '==', currentUser.uid).orderBy('createdAt', 'desc').limit(50).get();
    const container = $('transactionList');
    if (q.empty) { container.innerHTML = '<div class="empty-state"><p>No transactions yet</p></div>'; return; }
    container.innerHTML = '';
    q.forEach(doc => {
      const tx = doc.data();
      const positive = ['deposit','win','refund','adjustment'].includes(tx.type);
      const div = document.createElement('div');
      div.className = 'tx-card';
      div.innerHTML = `
        <div class="tx-info">
          <div class="tx-type ${tx.type}">${tx.type.charAt(0).toUpperCase() + tx.type.slice(1)}</div>
          <div class="tx-date">${tx.createdAt ? formatDate(tx.createdAt) : ''} ${tx.reference ? '· ' + tx.reference : ''}</div>
        </div>
        <div class="tx-amount ${positive ? 'tx-positive' : 'tx-negative'}">${positive ? '+' : '-'}${formatCurrency(tx.amount)}</div>`;
      container.appendChild(div);
    });
  } catch (e) { console.error(e); }
}

// ===== 14. DEPOSIT MODAL =====
function showDepositModal() {
  const body = $('modalBody');
  body.innerHTML = `
    <h2>💰 Deposit Funds</h2>
    <div style="background:var(--bg-card);border-radius:var(--radius-md);padding:1rem;margin-bottom:1rem;border:1px solid var(--border);">
      <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.5rem;">Bank Transfer Details</p>
      <p style="font-weight:600;">Smartcash</p>
      <p style="font-size:1.2rem;font-weight:800;color:var(--gold);">8028792036</p>
      <p style="color:var(--text-secondary);">Egbebi Daud Kolawole</p>
      <button class="copy-btn" onclick="copyAccountNumber()" id="copyAcctBtn">COPY ACCOUNT NUMBER</button>
    </div>
    <p class="small text-muted mb-1">After payment, fill in the details below. Your deposit will be reviewed manually by an admin.</p>
    <form id="depositForm" onsubmit="submitDeposit(event)">
      <div class="form-group"><label>Amount Paid (₦)</label><input type="number" class="form-input" id="depositAmount" min="100" required placeholder="e.g. 5000" /></div>
      <div class="form-group"><label>Transaction ID</label><input type="text" class="form-input" id="depositTxId" required placeholder="Enter transaction/reference ID" /></div>
      <div class="form-group"><label>Phone Number</label><input type="tel" class="form-input" id="depositPhone" required placeholder="08012345678" /></div>
      <button type="submit" class="btn btn-primary btn-block" id="depositBtn">SUBMIT REQUEST</button>
    </form>
    <p class="small text-muted mt-1">⚠ Your deposit will be reviewed by an admin before funds are credited.</p>`;
  showModal();
}

async function copyAccountNumber() {
  try {
    await navigator.clipboard.writeText('8028792036');
    const btn = $('copyAcctBtn');
    btn.textContent = 'COPIED!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'COPY ACCOUNT NUMBER'; btn.classList.remove('copied'); }, 2000);
  } catch (e) { showToast('Could not copy automatically', 'warning'); }
}

async function submitDeposit(e) {
  e.preventDefault();
  const amount = parseFloat($('depositAmount').value);
  const transactionId = $('depositTxId').value.trim();
  const phone = $('depositPhone').value.trim();
  if (!amount || amount < 100) { showToast('Minimum deposit is ₦100', 'error'); return; }
  if (!transactionId) { showToast('Enter transaction ID', 'error'); return; }
  if (!phone) { showToast('Enter phone number', 'error'); return; }
  showLoading('Submitting deposit request...');
  try {
    const existing = await db.collection('deposits').where('transactionId', '==', transactionId).get();
    if (!existing.empty) { hideLoading(); showToast('This transaction ID has already been submitted', 'error'); return; }
    await db.collection('deposits').add({
      userId: currentUser.uid, username: currentUserData.username,
      amount, transactionId, phone, status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    hideLoading();
    showToast('Deposit request submitted! Awaiting admin approval.', 'success');
    closeModal();
  } catch (e) { hideLoading(); showToast('Error submitting deposit', 'error'); console.error(e); }
}

// ===== 15. WITHDRAW MODAL =====
function showWithdrawModal() {
  if (currentUserData.balance < 10000) {
    showToast(`Minimum withdrawal is ₦10,000. Your balance: ${formatCurrency(currentUserData.balance)}`, 'warning');
    return;
  }
  const body = $('modalBody');
  body.innerHTML = `
    <h2>💸 Withdrawal</h2>
    <p class="small text-muted mb-1">Minimum withdrawal: ₦10,000. Requests are manually reviewed.</p>
    <form id="withdrawForm" onsubmit="submitWithdrawal(event)">
      <div class="form-group"><label>Amount (₦)</label><input type="number" class="form-input" id="withdrawAmount" min="10000" max="${currentUserData.balance}" required placeholder="10000" /></div>
      <div class="form-group"><label>Account Name</label><input type="text" class="form-input" id="withdrawAccountName" required placeholder="Full name on bank account" /></div>
      <div class="form-group"><label>Bank Name</label><input type="text" class="form-input" id="withdrawBank" required placeholder="e.g. GTBank, Access Bank" /></div>
      <div class="form-group"><label>Account Number</label><input type="text" class="form-input" id="withdrawAccountNumber" required placeholder="0123456789" pattern="[0-9]{10}" /></div>
      <div class="form-group"><label>Phone Number</label><input type="tel" class="form-input" id="withdrawPhone" required placeholder="08012345678" /></div>
      <p class="form-help">Withdrawal requests are manually reviewed. Processing time and eligibility may vary.</p>
      <button type="submit" class="btn btn-primary btn-block" id="withdrawBtn">SUBMIT WITHDRAWAL</button>
    </form>`;
  showModal();
}

async function submitWithdrawal(e) {
  e.preventDefault();
  const amount = parseFloat($('withdrawAmount').value);
  const accountName = $('withdrawAccountName').value.trim();
  const bank = $('withdrawBank').value.trim();
  const accountNumber = $('withdrawAccountNumber').value.trim();
  const phone = $('withdrawPhone').value.trim();
  if (!amount || amount < 10000) { showToast('Minimum withdrawal is ₦10,000', 'error'); return; }
  if (amount > currentUserData.balance) { showToast('Insufficient balance', 'error'); return; }
  if (!accountName || !bank || !accountNumber || accountNumber.length !== 10) { showToast('Check account details', 'error'); return; }
  showLoading('Submitting withdrawal request...');
  try {
    await db.collection('withdrawals').add({
      userId: currentUser.uid, username: currentUserData.username,
      amount, accountName, bank, accountNumber, phone, status: 'pending',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const newBalance = currentUserData.balance - amount;
    await db.collection('users').doc(currentUser.uid).update({ balance: newBalance });
    currentUserData.balance = newBalance;
    await db.collection('transactions').add({
      userId: currentUser.uid, type: 'withdrawal', amount, status: 'pending',
      reference: 'wd_' + Date.now(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    hideLoading();
    updateUI();
    showToast('Withdrawal request submitted for review!', 'success');
    closeModal();
  } catch (e) { hideLoading(); showToast('Error submitting withdrawal', 'error'); console.error(e); }
}

// ===== 16. PROFILE =====
function loadProfile() {
  if (!currentUserData) return;
  $('profileUsername').textContent = currentUserData.username || '-';
  $('profilePhone').textContent = currentUserData.phone || '-';
  $('profileJoined').textContent = currentUserData.createdAt ? formatDate(currentUserData.createdAt) : '-';
  $('profileStatus').textContent = currentUserData.status || '-';
}

// ===== 17. MODAL =====
function showModal() {
  $('modalOverlay').style.display = 'block';
  $('modalContent').style.display = 'block';
}

function closeModal() {
  $('modalOverlay').style.display = 'none';
  $('modalContent').style.display = 'none';
}

// ===== 18. ADMIN PANEL =====
let activeAdminTab = 'users';

async function loadAdminPanel() {
  if (currentUserData?.role !== 'admin') return;
  switchAdminTab(activeAdminTab);
}

function switchAdminTab(tab) {
  activeAdminTab = tab;
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  const tabMap = { users: 0, deposits: 1, withdrawals: 2, matches: 3, signals: 4 };
  const tabs = document.querySelectorAll('.admin-tab');
  if (tabs[tabMap[tab]]) tabs[tabMap[tab]].classList.add('active');
  document.querySelectorAll('.admin-panel').forEach(p => p.style.display = 'none');
  const idMap = { users: 'adminUsers', deposits: 'adminDeposits', withdrawals: 'adminWithdrawals', matches: 'adminMatches', signals: 'adminSignals' };
  const panel = $(idMap[tab]);
  if (panel) {
    panel.style.display = 'block';
    if (tab === 'users') loadAdminUsers();
    else if (tab === 'deposits') loadAdminDeposits();
    else if (tab === 'withdrawals') loadAdminWithdrawals();
    else if (tab === 'matches') loadAdminMatches();
    else if (tab === 'signals') loadAdminSignals();
  }
}

// --- Admin: Users ---
async function loadAdminUsers() {
  const container = $('usersList');
  container.innerHTML = '<p class="text-muted">Loading users...</p>';
  try {
    const q = await db.collection('users').orderBy('createdAt', 'desc').get();
    allUsers = [];
    q.forEach(doc => allUsers.push({ id: doc.id, ...doc.data() }));
    renderUsersTable(allUsers);
  } catch (e) { container.innerHTML = '<p class="text-muted">Error loading users</p>'; }
}

function renderUsersTable(users) {
  const container = $('usersList');
  if (users.length === 0) { container.innerHTML = '<div class="empty-state"><p>No users found</p></div>'; return; }
  let html = `<div style="overflow-x:auto;"><table class="admin-table"><thead><tr>
    <th>Username</th><th>Phone</th><th>Balance</th><th>Bonus</th><th>Role</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>`;
  users.forEach(u => {
    html += `<tr>
      <td>${u.username || '-'}</td>
      <td>${u.phone || '-'}</td>
      <td>${formatCurrency(u.balance)}</td>
      <td>${formatCurrency(u.bonusBalance || 0)}</td>
      <td>${u.role || 'user'}</td>
      <td><span style="color:${u.status === 'active' ? 'var(--green-primary)' : 'var(--danger)'}">${u.status || 'active'}</span></td>
      <td class="admin-actions">
        <button class="btn btn-sm btn-outline" onclick="adminAdjustBalance('${u.uid}')">Adjust</button>
        <button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-primary'}" onclick="adminToggleStatus('${u.uid}','${u.status}')">${u.status === 'active' ? 'Suspend' : 'Activate'}</button>
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

function searchUsers() {
  const query = $('adminUserSearch').value.toLowerCase().trim();
  if (!query) { renderUsersTable(allUsers); return; }
  const f = allUsers.filter(u =>
    (u.username && u.username.toLowerCase().includes(query)) ||
    (u.phone && u.phone.includes(query))
  );
  renderUsersTable(f);
}

async function adminAdjustBalance(uid) {
  const user = allUsers.find(u => u.uid === uid);
  $('modalBody').innerHTML = `
    <h2>Adjust Balance</h2>
    <p>User: <strong>${user?.username || uid}</strong></p>
    <p>Current: ${formatCurrency(user?.balance || 0)} | Bonus: ${formatCurrency(user?.bonusBalance || 0)}</p>
    <form id="adjustForm" onsubmit="submitBalanceAdjust(event, '${uid}')">
      <div class="form-group"><label>Amount (±)</label><input type="number" class="form-input" id="adjustAmount" required placeholder="e.g. 5000 or -2000" /></div>
      <div class="form-group"><label>Type</label>
        <select class="form-input" id="adjustType"><option value="balance">Main Balance</option><option value="bonusBalance">Bonus Balance</option></select>
      </div>
      <div class="form-group"><label>Reason</label><input type="text" class="form-input" id="adjustReason" required placeholder="Deposit credit, bonus, etc." /></div>
      <button type="submit" class="btn btn-primary btn-block">APPLY</button>
    </form>`;
  showModal();
}

async function submitBalanceAdjust(e, uid) {
  e.preventDefault();
  const amount = parseFloat($('adjustAmount').value);
  const reason = $('adjustReason').value.trim();
  const type = $('adjustType').value;
  if (!amount || !reason) { showToast('Fill all fields', 'error'); return; }
  showLoading('Applying...');
  try {
    const ref = db.collection('users').doc(uid);
    const doc = await ref.get();
    const cur = doc.data()[type] || 0;
    const newVal = Math.max(0, cur + amount);
    await ref.update({ [type]: newVal });
    await db.collection('transactions').add({
      userId: uid, type: 'adjustment', amount: Math.abs(amount), status: 'completed',
      reference: `adj_${type}_${reason}_${Date.now()}`,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    hideLoading(); closeModal();
    showToast(`${type} adjusted to ${formatCurrency(newVal)}`, 'success');
    loadAdminUsers();
  } catch (e) { hideLoading(); showToast('Error', 'error'); }
}

async function adminToggleStatus(uid, cur) {
  const next = cur === 'active' ? 'suspended' : 'active';
  if (!confirm(`Set user to "${next}"?`)) return;
  try { await db.collection('users').doc(uid).update({ status: next }); showToast(`User ${next}`, 'success'); loadAdminUsers(); }
  catch (e) { showToast('Error', 'error'); }
}

// --- Admin: Deposits ---
async function loadAdminDeposits() {
  const container = $('depositsList');
  container.innerHTML = '<p class="text-muted">Loading deposits...</p>';
  try {
    const q = await db.collection('deposits').orderBy('createdAt', 'desc').get();
    allDeposits = [];
    q.forEach(doc => allDeposits.push({ id: doc.id, ...doc.data() }));
    renderDepositsTable();
  } catch (e) { container.innerHTML = '<p class="text-muted">Error</p>'; }
}

function renderDepositsTable() {
  const container = $('depositsList');
  if (!allDeposits.length) { container.innerHTML = '<div class="empty-state"><p>No deposit requests</p></div>'; return; }
  let html = `<div style="overflow-x:auto;"><table class="admin-table"><thead><tr>
    <th>User</th><th>Amount</th><th>Tx ID</th><th>Phone</th><th>Date</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>`;
  allDeposits.forEach(d => {
    html += `<tr>
      <td>${d.username || d.userId?.slice(0,8)}</td>
      <td>${formatCurrency(d.amount)}</td>
      <td style="font-size:0.75rem;">${d.transactionId || '-'}</td>
      <td>${d.phone || '-'}</td>
      <td style="font-size:0.75rem;">${d.createdAt ? formatDate(d.createdAt) : '-'}</td>
      <td><span style="color:${d.status === 'approved' ? 'var(--green-primary)' : d.status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}">${d.status || 'pending'}</span></td>
      <td class="admin-actions">${d.status === 'pending' ?
        `<button class="btn btn-sm btn-primary" onclick="adminApproveDeposit('${d.id}')">Approve</button>
         <button class="btn btn-sm btn-danger" onclick="adminRejectDeposit('${d.id}')">Reject</button>` :
        '<span class="small text-muted">Done</span>'}
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function adminApproveDeposit(depositId) {
  if (!confirm('Approve deposit? User will be credited.')) return;
  showLoading('Approving...');
  try {
    const snap = await db.collection('deposits').doc(depositId).get();
    const d = snap.data();
    if (d.status !== 'pending') { hideLoading(); showToast('Already processed', 'warning'); return; }
    await db.collection('deposits').doc(depositId).update({
      status: 'approved', reviewedBy: currentUser.uid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const uRef = db.collection('users').doc(d.userId);
    const uDoc = await uRef.get();
    await uRef.update({ balance: (uDoc.data().balance || 0) + d.amount });
    await db.collection('transactions').add({
      userId: d.userId, type: 'deposit', amount: d.amount, status: 'completed',
      reference: 'dep_' + depositId.slice(0,8),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    hideLoading();
    showToast(`Deposit of ${formatCurrency(d.amount)} approved`, 'success');
    loadAdminDeposits();
  } catch (e) { hideLoading(); showToast('Error', 'error'); }
}

async function adminRejectDeposit(depositId) {
  if (!confirm('Reject deposit?')) return;
  try {
    await db.collection('deposits').doc(depositId).update({
      status: 'rejected', reviewedBy: currentUser.uid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Deposit rejected', 'info');
    loadAdminDeposits();
  } catch (e) { showToast('Error', 'error'); }
}

// --- Admin: Withdrawals ---
async function loadAdminWithdrawals() {
  const container = $('withdrawalsList');
  container.innerHTML = '<p class="text-muted">Loading withdrawals...</p>';
  try {
    const q = await db.collection('withdrawals').orderBy('createdAt', 'desc').get();
    allWithdrawals = [];
    q.forEach(doc => allWithdrawals.push({ id: doc.id, ...doc.data() }));
    renderWithdrawalsTable();
  } catch (e) { container.innerHTML = '<p class="text-muted">Error</p>'; }
}

function renderWithdrawalsTable() {
  const container = $('withdrawalsList');
  if (!allWithdrawals.length) { container.innerHTML = '<div class="empty-state"><p>No withdrawal requests</p></div>'; return; }
  let html = `<div style="overflow-x:auto;"><table class="admin-table"><thead><tr>
    <th>User</th><th>Amount</th><th>Bank / Acct</th><th>Phone</th><th>Date</th><th>Status</th><th>Actions</th>
  </tr></thead><tbody>`;
  allWithdrawals.forEach(w => {
    html += `<tr>
      <td>${w.username || w.userId?.slice(0,8)}</td>
      <td>${formatCurrency(w.amount)}</td>
      <td style="font-size:0.75rem;">${w.bank || '-'}<br/>${w.accountName || ''} ${w.accountNumber || ''}</td>
      <td>${w.phone || '-'}</td>
      <td style="font-size:0.75rem;">${w.createdAt ? formatDate(w.createdAt) : '-'}</td>
      <td><span style="color:${w.status === 'paid' ? 'var(--green-primary)' : w.status === 'approved' ? 'var(--gold)' : w.status === 'rejected' ? 'var(--danger)' : 'var(--warning)'}">${w.status || 'pending'}</span></td>
      <td class="admin-actions">
        ${w.status === 'pending' ? `
          <button class="btn btn-sm btn-primary" onclick="adminApproveWithdrawal('${w.id}')">Approve</button>
          <button class="btn btn-sm btn-danger" onclick="adminRejectWithdrawal('${w.id}')">Reject</button>` :
          w.status === 'approved' ? `
          <button class="btn btn-sm btn-primary" onclick="adminMarkPaid('${w.id}')">Mark Paid</button>` :
          '<span class="small text-muted">Done</span>'}
      </td>
    </tr>`;
  });
  html += '</tbody></table></div>';
  container.innerHTML = html;
}

async function adminApproveWithdrawal(wId) {
  if (!confirm('Approve withdrawal? No real transfer occurs.')) return;
  try {
    await db.collection('withdrawals').doc(wId).update({
      status: 'approved', reviewedBy: currentUser.uid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Withdrawal approved', 'success');
    loadAdminWithdrawals();
  } catch (e) { showToast('Error', 'error'); }
}

async function adminRejectWithdrawal(wId) {
  if (!confirm('Reject withdrawal? Funds will be returned to user.')) return;
  try {
    const snap = await db.collection('withdrawals').doc(wId).get();
    const w = snap.data();
    await db.collection('withdrawals').doc(wId).update({
      status: 'rejected', reviewedBy: currentUser.uid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    const uRef = db.collection('users').doc(w.userId);
    const uDoc = await uRef.get();
    await uRef.update({ balance: (uDoc.data().balance || 0) + w.amount });
    showToast('Withdrawal rejected, funds returned', 'info');
    loadAdminWithdrawals();
  } catch (e) { showToast('Error', 'error'); }
}

async function adminMarkPaid(wId) {
  if (!confirm('Mark as PAID? This is manual confirmation only.')) return;
  try {
    await db.collection('withdrawals').doc(wId).update({
      status: 'paid', reviewedBy: currentUser.uid,
      reviewedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('Marked as paid', 'success');
    loadAdminWithdrawals();
  } catch (e) { showToast('Error', 'error'); }
}

// ===== 19. ADMIN MATCH MANAGEMENT =====
async function loadAdminMatches() {
  const container = $('adminMatchesList');
  container.innerHTML = '<p class="text-muted">Loading matches...</p>';
  try {
    const q = await db.collection('matches').orderBy('createdAt', 'desc').get();
    if (q.empty) {
      container.innerHTML = '<div class="empty-state"><p>No matches. Add one!</p></div>';
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const m = doc.data(); m.id = doc.id;
      const card = document.createElement('div');
      card.className = 'match-card';
      card.innerHTML = `
        <div class="match-league">${m.league || 'Football'} <span style="color:${m.status === 'published' ? 'var(--green-primary)' : m.status === 'live' ? 'var(--danger)' : 'var(--text-muted)'};font-size:0.7rem;">(${m.status || 'draft'})</span></div>
        <div class="match-teams">
          <span class="match-team match-team-home">${m.homeTeam || 'Home'}</span>
          <span class="match-vs">vs</span>
          <span class="match-team match-team-away">${m.awayTeam || 'Away'}</span>
        </div>
        <div class="match-time">${m.date || ''} ${m.time || ''} ${m.featured ? '⭐ Featured' : ''}</div>
        <div class="odds-row" style="margin-bottom:0.5rem;">
          <span class="odds-btn" style="cursor:default;"><span class="odds-label">1</span><span class="odds-value">${m.homeOdds || '-'}</span></span>
          <span class="odds-btn" style="cursor:default;"><span class="odds-label">X</span><span class="odds-value">${m.drawOdds || '-'}</span></span>
          <span class="odds-btn" style="cursor:default;"><span class="odds-label">2</span><span class="odds-value">${m.awayOdds || '-'}</span></span>
        </div>
        <div class="admin-actions" style="margin-top:0.5rem;">
          <button class="btn btn-sm btn-outline" onclick="adminEditMatch('${m.id}')">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="adminDeleteMatch('${m.id}')">Delete</button>
        </div>`;
      container.appendChild(card);
    });
  } catch (e) { container.innerHTML = '<p class="text-muted">Error</p>'; }
}

function showAddMatchModal() {
  $('modalBody').innerHTML = `
    <h2>Add Match</h2>
    <form id="addMatchForm" onsubmit="adminSaveMatch(event, null)">
      <div class="form-group"><label>League</label>
        <select class="form-input" id="matchLeague" required>
          <option value="Premier League">Premier League</option>
          <option value="Champions League">Champions League</option>
          <option value="La Liga">La Liga</option>
          <option value="Serie A">Serie A</option>
          <option value="Bundesliga">Bundesliga</option>
          <option value="Ligue 1">Ligue 1</option>
          <option value="Other">Other</option>
        </select>
      </div>
      <div class="form-group"><label>Home Team</label><input type="text" class="form-input" id="matchHome" required /></div>
      <div class="form-group"><label>Away Team</label><input type="text" class="form-input" id="matchAway" required /></div>
      <div class="form-group"><label>Date</label><input type="date" class="form-input" id="matchDate" required /></div>
      <div class="form-group"><label>Time</label><input type="time" class="form-input" id="matchTime" /></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
        <div class="form-group"><label>1 (Home)</label><input type="number" step="0.01" class="form-input" id="matchHomeOdds" value="1.50" required /></div>
        <div class="form-group"><label>X (Draw)</label><input type="number" step="0.01" class="form-input" id="matchDrawOdds" value="3.50" required /></div>
        <div class="form-group"><label>2 (Away)</label><input type="number" step="0.01" class="form-input" id="matchAwayOdds" value="5.00" required /></div>
      </div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="matchFeatured" /> Featured</label>
      </div>
      <div class="form-group"><label>Status</label>
        <select class="form-input" id="matchStatus">
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="live">Live</option>
        </select>
      </div>
      <button type="submit" class="btn btn-primary btn-block">SAVE MATCH</button>
    </form>`;
  showModal();
}

function adminEditMatch(matchId) {
  showLoading('Loading match...');
  db.collection('matches').doc(matchId).get().then(doc => {
    if (!doc.exists) { hideLoading(); showToast('Match not found', 'error'); return; }
    const m = doc.data();
    hideLoading();
    $('modalBody').innerHTML = `
      <h2>Edit Match</h2>
      <form id="addMatchForm" onsubmit="adminSaveMatch(event, '${matchId}')">
        <div class="form-group"><label>League</label>
          <select class="form-input" id="matchLeague" required>
            <option value="Premier League" ${m.league === 'Premier League' ? 'selected' : ''}>Premier League</option>
            <option value="Champions League" ${m.league === 'Champions League' ? 'selected' : ''}>Champions League</option>
            <option value="La Liga" ${m.league === 'La Liga' ? 'selected' : ''}>La Liga</option>
            <option value="Serie A" ${m.league === 'Serie A' ? 'selected' : ''}>Serie A</option>
            <option value="Bundesliga" ${m.league === 'Bundesliga' ? 'selected' : ''}>Bundesliga</option>
            <option value="Ligue 1" ${m.league === 'Ligue 1' ? 'selected' : ''}>Ligue 1</option>
            <option value="Other" ${!['Premier League','Champions League','La Liga','Serie A','Bundesliga','Ligue 1'].includes(m.league) ? 'selected' : ''}>Other</option>
          </select>
        </div>
        <div class="form-group"><label>Home Team</label><input type="text" class="form-input" id="matchHome" value="${m.homeTeam || ''}" required /></div>
        <div class="form-group"><label>Away Team</label><input type="text" class="form-input" id="matchAway" value="${m.awayTeam || ''}" required /></div>
        <div class="form-group"><label>Date</label><input type="date" class="form-input" id="matchDate" value="${m.date || ''}" required /></div>
        <div class="form-group"><label>Time</label><input type="time" class="form-input" id="matchTime" value="${m.time || ''}" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;">
          <div class="form-group"><label>1 (Home)</label><input type="number" step="0.01" class="form-input" id="matchHomeOdds" value="${m.homeOdds || '1.50'}" required /></div>
          <div class="form-group"><label>X (Draw)</label><input type="number" step="0.01" class="form-input" id="matchDrawOdds" value="${m.drawOdds || '3.50'}" required /></div>
          <div class="form-group"><label>2 (Away)</label><input type="number" step="0.01" class="form-input" id="matchAwayOdds" value="${m.awayOdds || '5.00'}" required /></div>
        </div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="matchFeatured" ${m.featured ? 'checked' : ''} /> Featured</label>
        </div>
        <div class="form-group"><label>Status</label>
          <select class="form-input" id="matchStatus">
            <option value="published" ${m.status === 'published' ? 'selected' : ''}>Published</option>
            <option value="draft" ${m.status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="live" ${m.status === 'live' ? 'selected' : ''}>Live</option>
          </select>
        </div>
        <button type="submit" class="btn btn-primary btn-block">UPDATE MATCH</button>
      </form>`;
    showModal();
  }).catch(() => { hideLoading(); showToast('Error loading match', 'error'); });
}

async function adminSaveMatch(e, matchId) {
  e.preventDefault();
  const data = {
    league: $('matchLeague').value,
    homeTeam: $('matchHome').value.trim(),
    awayTeam: $('matchAway').value.trim(),
    date: $('matchDate').value,
    time: $('matchTime').value,
    homeOdds: parseFloat($('matchHomeOdds').value),
    drawOdds: parseFloat($('matchDrawOdds').value),
    awayOdds: parseFloat($('matchAwayOdds').value),
    featured: $('matchFeatured').checked,
    status: $('matchStatus').value
  };
  if (!data.homeTeam || !data.awayTeam) { showToast('Fill team names', 'error'); return; }
  showLoading('Saving...');
  try {
    if (matchId) {
      await db.collection('matches').doc(matchId).update(data);
      showToast('Match updated', 'success');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await db.collection('matches').add(data);
      showToast('Match added', 'success');
    }
    hideLoading(); closeModal();
    loadAdminMatches();
  } catch (e) { hideLoading(); showToast('Error saving match', 'error'); }
}

async function adminDeleteMatch(matchId) {
  if (!confirm('Delete this match permanently?')) return;
  try {
    await db.collection('matches').doc(matchId).delete();
    showToast('Match deleted', 'info');
    loadAdminMatches();
  } catch (e) { showToast('Error deleting match', 'error'); }
}

// ===== 20. ADMIN SIGNAL MANAGEMENT =====
async function loadAdminSignals() {
  const container = $('adminSignalsList');
  container.innerHTML = '<p class="text-muted">Loading signals...</p>';
  try {
    const q = await db.collection('signals').orderBy('createdAt', 'desc').get();
    if (q.empty) {
      container.innerHTML = '<div class="empty-state"><p>No signals. Create one!</p></div>';
      return;
    }
    container.innerHTML = '';
    q.forEach(doc => {
      const s = doc.data(); s.id = doc.id;
      const card = document.createElement('div');
      card.className = 'signal-card';
      card.innerHTML = `
        <div class="signal-title">${s.title || 'Signal'} ${s.published ? '✅' : '🔒'}</div>
        <div class="signal-match">${s.match || (s.homeTeam ? s.homeTeam + ' vs ' + s.awayTeam : 'N/A')}</div>
        <span class="signal-prediction">${s.prediction || 'N/A'}</span>
        ${s.odds ? `<span class="signal-odds" style="margin-left:0.75rem;">Odds: ${s.odds}</span>` : ''}
        ${s.description ? `<p class="signal-desc">${s.description}</p>` : ''}
        <p class="small text-muted">${s.scheduledTime ? 'Scheduled: ' + s.scheduledTime : ''}</p>
        <div class="admin-actions" style="margin-top:0.5rem;">
          <button class="btn btn-sm btn-outline" onclick="adminEditSignal('${s.id}')">Edit</button>
          <button class="btn btn-sm ${s.published ? 'btn-ghost' : 'btn-primary'}" onclick="adminToggleSignal('${s.id}', ${s.published})">${s.published ? 'Unpublish' : 'Publish'}</button>
          <button class="btn btn-sm btn-danger" onclick="adminDeleteSignal('${s.id}')">Delete</button>
        </div>`;
      container.appendChild(card);
    });
  } catch (e) { container.innerHTML = '<p class="text-muted">Error</p>'; }
}

function showAddSignalModal() {
  $('modalBody').innerHTML = `
    <h2>Add Signal</h2>
    <form id="addSignalForm" onsubmit="adminSaveSignal(event, null)">
      <div class="form-group"><label>Title</label><input type="text" class="form-input" id="signalTitle" value="YANGA DAILY SIGNAL" required /></div>
      <div class="form-group"><label>Match (e.g. Team A vs Team B)</label><input type="text" class="form-input" id="signalMatch" required /></div>
      <div class="form-group"><label>Prediction</label>
        <select class="form-input" id="signalPrediction" required>
          <option value="Home Win">Home Win</option>
          <option value="Draw">Draw</option>
          <option value="Away Win">Away Win</option>
          <option value="Over 2.5">Over 2.5</option>
          <option value="Under 2.5">Under 2.5</option>
          <option value="Both Teams to Score">Both Teams to Score</option>
          <option value="Home Win or Draw">Home Win or Draw</option>
          <option value="Away Win or Draw">Away Win or Draw</option>
        </select>
      </div>
      <div class="form-group"><label>Odds</label><input type="number" step="0.01" class="form-input" id="signalOdds" value="1.85" required /></div>
      <div class="form-group"><label>Description</label><textarea class="form-input" id="signalDesc" rows="2" placeholder="Analysis notes..."></textarea></div>
      <div class="form-group"><label>Scheduled Time</label><input type="datetime-local" class="form-input" id="signalTime" /></div>
      <div class="form-group">
        <label class="checkbox-label"><input type="checkbox" id="signalPublished" checked /> Publish immediately</label>
      </div>
      <button type="submit" class="btn btn-primary btn-block">SAVE SIGNAL</button>
    </form>`;
  showModal();
}

function adminEditSignal(signalId) {
  showLoading('Loading signal...');
  db.collection('signals').doc(signalId).get().then(doc => {
    if (!doc.exists) { hideLoading(); showToast('Not found', 'error'); return; }
    const s = doc.data();
    hideLoading();
    $('modalBody').innerHTML = `
      <h2>Edit Signal</h2>
      <form id="addSignalForm" onsubmit="adminSaveSignal(event, '${signalId}')">
        <div class="form-group"><label>Title</label><input type="text" class="form-input" id="signalTitle" value="${s.title || 'YANGA DAILY SIGNAL'}" required /></div>
        <div class="form-group"><label>Match</label><input type="text" class="form-input" id="signalMatch" value="${s.match || ''}" required /></div>
        <div class="form-group"><label>Prediction</label>
          <select class="form-input" id="signalPrediction" required>
            <option value="Home Win" ${s.prediction === 'Home Win' ? 'selected' : ''}>Home Win</option>
            <option value="Draw" ${s.prediction === 'Draw' ? 'selected' : ''}>Draw</option>
            <option value="Away Win" ${s.prediction === 'Away Win' ? 'selected' : ''}>Away Win</option>
            <option value="Over 2.5" ${s.prediction === 'Over 2.5' ? 'selected' : ''}>Over 2.5</option>
            <option value="Under 2.5" ${s.prediction === 'Under 2.5' ? 'selected' : ''}>Under 2.5</option>
            <option value="Both Teams to Score" ${s.prediction === 'Both Teams to Score' ? 'selected' : ''}>Both Teams to Score</option>
            <option value="Home Win or Draw" ${s.prediction === 'Home Win or Draw' ? 'selected' : ''}>Home Win or Draw</option>
            <option value="Away Win or Draw" ${s.prediction === 'Away Win or Draw' ? 'selected' : ''}>Away Win or Draw</option>
          </select>
        </div>
        <div class="form-group"><label>Odds</label><input type="number" step="0.01" class="form-input" id="signalOdds" value="${s.odds || '1.85'}" required /></div>
        <div class="form-group"><label>Description</label><textarea class="form-input" id="signalDesc" rows="2">${s.description || ''}</textarea></div>
        <div class="form-group"><label>Scheduled Time</label><input type="datetime-local" class="form-input" id="signalTime" value="${s.scheduledTime || ''}" /></div>
        <div class="form-group">
          <label class="checkbox-label"><input type="checkbox" id="signalPublished" ${s.published ? 'checked' : ''} /> Published</label>
        </div>
        <button type="submit" class="btn btn-primary btn-block">UPDATE SIGNAL</button>
      </form>`;
    showModal();
  }).catch(() => { hideLoading(); showToast('Error', 'error'); });
}

async function adminSaveSignal(e, signalId) {
  e.preventDefault();
  const data = {
    title: $('signalTitle').value.trim(),
    match: $('signalMatch').value.trim(),
    prediction: $('signalPrediction').value,
    odds: parseFloat($('signalOdds').value),
    description: $('signalDesc').value.trim(),
    scheduledTime: $('signalTime').value || null,
    published: $('signalPublished').checked
  };
  if (!data.match || !data.title) { showToast('Fill match and title', 'error'); return; }
  showLoading('Saving...');
  try {
    if (signalId) {
      await db.collection('signals').doc(signalId).update(data);
      showToast('Signal updated', 'success');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      data.featured = false;
      await db.collection('signals').add(data);
      showToast('Signal created', 'success');
    }
    hideLoading(); closeModal();
    loadAdminSignals();
  } catch (e) { hideLoading(); showToast('Error saving signal', 'error'); }
}

async function adminToggleSignal(signalId, currentlyPublished) {
  try {
    await db.collection('signals').doc(signalId).update({ published: !currentlyPublished });
    showToast(currentlyPublished ? 'Unpublished' : 'Published', 'success');
    loadAdminSignals();
  } catch (e) { showToast('Error', 'error'); }
}

async function adminDeleteSignal(signalId) {
  if (!confirm('Delete this signal?')) return;
  try {
    await db.collection('signals').doc(signalId).delete();
    showToast('Signal deleted', 'info');
    loadAdminSignals();
  } catch (e) { showToast('Error', 'error'); }
}

// ===== 21. RESPONSIVE NAVIGATION OVERRIDES =====
// Handle window resize for desktop bet slip
window.addEventListener('resize', () => {
  if (window.innerWidth >= 768) {
    const panel = $('betSlipPanel');
    if (selections.length > 0) {
      panel.classList.add('visible');
    }
    if ($('navLinks')) $('navLinks').style.display = '';
  } else {
    if ($('navLinks')) $('navLinks').style.display = 'none';
  }
});

// Close mobile menu on navigation
document.addEventListener('click', () => {
  if (window.innerWidth < 768) {
    if ($('navLinks')) $('navLinks').style.display = 'none';
  }
});

console.log('YANGA BET loaded successfully. Firebase connected.');
