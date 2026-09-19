import { Api, getToken, clearToken, onUnauthorized } from './api.js';
import { initAuthScreens } from './auth-screens.js';
import { setCurrentUser } from './current-user.js';
import { render as renderDashboard } from './sections/dashboard.js';
import { render as renderSensors } from './sections/sensors.js';
import { render as renderWaterQuality } from './sections/waterquality.js';
import { render as renderAlerts } from './sections/alerts.js';
import { render as renderDevices } from './sections/devices.js';
import { render as renderMl } from './sections/ml.js';
import { render as renderReports } from './sections/reports.js';
import { render as renderUsers } from './sections/users.js';
import { render as renderSystem } from './sections/system.js';

const SECTIONS = {
  dashboard: renderDashboard,
  sensors: renderSensors,
  waterquality: renderWaterQuality,
  alerts: renderAlerts,
  devices: renderDevices,
  ml: renderMl,
  reports: renderReports,
  users: renderUsers,
  system: renderSystem,
};

// Tabs whose backing API endpoints are admin-only (see docs/backend/api-contract.md) -
// hidden entirely for a role='user' account rather than shown-then-403'd.
// 'dashboard' is deliberately NOT in this set - it's visible to every role,
// but api/dashboard.js returns a completely different (self-scoped)
// payload for a non-admin caller, never another user's data.
const ADMIN_ONLY_TABS = new Set(['sensors', 'waterquality', 'alerts', 'devices', 'users', 'system']);
const DEFAULT_TAB_BY_ROLE = { admin: 'dashboard', user: 'dashboard' };

const appShell = document.getElementById('appShell');
const userEmailEl = document.getElementById('userEmail');
const logoutBtn = document.getElementById('logoutBtn');
const themeToggle = document.getElementById('themeToggle');
const liveDot = document.getElementById('liveDot');
const liveText = document.getElementById('liveText');

let socket = null;
let activeTab = 'dashboard';

function applyStoredTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem('wqm_admin_theme');
  } catch {
    /* ignore */
  }
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    themeToggle.textContent = '☀ Light';
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    themeToggle.textContent = '☽ Dark';
  }
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  themeToggle.textContent = next === 'light' ? '☀ Light' : '☽ Dark';
  try {
    localStorage.setItem('wqm_admin_theme', next);
  } catch {
    /* ignore */
  }
});

function setLive(isLive) {
  liveDot.classList.toggle('live', isLive);
  liveText.textContent = isLive ? 'live' : 'disconnected';
}

function connectWs() {
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
  }
  const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/ws';
  socket = new WebSocket(wsUrl);
  socket.onopen = () => {
    setLive(true);
    socket.send(JSON.stringify({ type: 'subscribe' }));
  };
  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      window.dispatchEvent(new CustomEvent('wqm:live-reading', { detail: msg }));
    } catch {
      /* ignore malformed message */
    }
  };
  socket.onclose = () => {
    setLive(false);
    if (getToken()) setTimeout(connectWs, 5000);
  };
  socket.onerror = () => {
    try { socket.close(); } catch { /* ignore */ }
  };
}

function disconnectWs() {
  if (socket) {
    try { socket.close(); } catch { /* ignore */ }
    socket = null;
  }
  setLive(false);
}

function activateTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.nav-list button[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tab}`);
  });
  const panelHeading = document.getElementById('currentSectionTitle');
  const activeBtn = document.querySelector(`.nav-list button[data-tab="${tab}"]`);
  if (panelHeading && activeBtn) panelHeading.textContent = activeBtn.textContent.trim();

  const container = document.getElementById(`tab-${tab}`);
  const loader = SECTIONS[tab];
  if (container && loader) {
    loader(container).catch((err) => {
      console.error(`Failed to render tab ${tab}:`, err);
    });
  }
}

function wireNav() {
  document.querySelectorAll('.nav-list button[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.getAttribute('data-tab')));
  });
}

function applyRoleVisibility(role) {
  document.querySelectorAll('.nav-list li[data-role="admin"]').forEach((li) => {
    li.classList.toggle('hidden', role !== 'admin');
  });
  document.querySelector('.sidebar .brand .sub').textContent =
    role === 'admin' ? 'Admin Console' : 'Console';

  if (ADMIN_ONLY_TABS.has(activeTab) && role !== 'admin') {
    activeTab = DEFAULT_TAB_BY_ROLE[role] || 'ml';
  }
}

async function bootDashboard(me) {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('changePasswordScreen').classList.add('hidden');
  document.getElementById('registerScreen').classList.add('hidden');
  appShell.classList.remove('hidden');

  setCurrentUser(me);
  userEmailEl.textContent = me?.email || '';
  applyRoleVisibility(me?.role);

  connectWs();
  activateTab(activeTab);
}

// Entry point when a token is already present (page load/refresh). Unlike a
// fresh login submission (which already has must_change_password from the
// login response), a stored token carries no such flag - it must be looked
// up fresh via /api/auth/me every time, otherwise refreshing the page would
// silently bypass a still-pending forced password change (the account's
// must_change_password stays true on the server until the change actually
// succeeds; only checking it at login time let a refresh skip straight to
// the dashboard without ever changing the password).
async function bootFromExistingToken() {
  try {
    const me = await Api.me();
    if (me.must_change_password) {
      authScreens.showChangePassword();
    } else {
      bootDashboard(me);
    }
  } catch {
    // Api.me() already clears the token and calls onUnauthorized on a 401,
    // which routes back to the login screen; nothing else to do here.
  }
}

function backToLogin() {
  disconnectWs();
  appShell.classList.add('hidden');
  authScreens.showLogin();
}

const authScreens = initAuthScreens({ onReady: bootFromExistingToken });

onUnauthorized(() => {
  backToLogin();
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  backToLogin();
});

wireNav();
applyStoredTheme();

// If a token is already present (page refresh), try to go straight to the
// dashboard; Api.me() will 401 -> onUnauthorized -> login screen if it's
// expired or invalid.
if (getToken()) {
  bootFromExistingToken();
} else {
  authScreens.showLogin();
}
