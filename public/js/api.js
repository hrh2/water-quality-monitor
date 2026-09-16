// API client for the admin console.
//
// Auth note (pragmatic, academic-scope choice, not enterprise-grade): the
// JWT is kept in localStorage rather than an httpOnly cookie. That means a
// successful XSS on this page could steal the token. A production system
// would issue the token as an httpOnly, Secure, SameSite cookie set by the
// server instead. For this project's scope (single admin account, no
// third-party scripts) the tradeoff is accepted for simplicity - there is
// no server-side session/cookie machinery in the API to plug into.

const TOKEN_KEY = 'wqm_admin_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore storage failures (private mode, quota, etc.) */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/** Thrown for any non-2xx response so callers can branch on status. */
export class ApiError extends Error {
  constructor(status, message) {
    super(message || `Request failed with status ${status}`);
    this.status = status;
  }
}

/** Thrown specifically for network-level failures (offline, DNS, CORS). */
export class NetworkError extends Error {}

let unauthorizedHandler = null;
/** Registered once by app.js: called whenever any request comes back 401,
 * so the app can drop back to the login screen in one place. */
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new NetworkError('Could not reach the server. Check your connection and try again.');
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (res.status === 401) {
    clearToken();
    if (unauthorizedHandler) unauthorizedHandler();
    throw new ApiError(401, (data && data.error) || 'Your session has expired. Please sign in again.');
  }

  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`);
  }

  return data;
}

function toQuery(params) {
  if (!params) return '';
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length === 0) return '';
  const search = new URLSearchParams(entries);
  return `?${search.toString()}`;
}

export const Api = {
  login(email, password) {
    return request('/api/auth/login', { method: 'POST', body: { email, password }, auth: false });
  },
  me() {
    return request('/api/auth/me');
  },
  changePassword(current_password, new_password) {
    return request('/api/auth/change-password', { method: 'POST', body: { current_password, new_password } });
  },
  getDevices() {
    return request('/api/devices');
  },
  registerDevice(payload) {
    return request('/api/devices', { method: 'POST', body: payload });
  },
  getDevice(deviceId) {
    return request(`/api/devices/${encodeURIComponent(deviceId)}`);
  },
  getReadings(params) {
    return request(`/api/readings${toQuery(params)}`);
  },
  predict(payload) {
    return request('/api/predict', { method: 'POST', body: payload });
  },
  getPredictions(params) {
    return request(`/api/predictions${toQuery(params)}`);
  },
  getAlerts(params) {
    return request(`/api/alerts${toQuery(params)}`);
  },
  patchAlert(id, action) {
    return request('/api/alerts', { method: 'PATCH', body: { id, action } });
  },
  getHealth() {
    return request('/api/system/health');
  },
};
