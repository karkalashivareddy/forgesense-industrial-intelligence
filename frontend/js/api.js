export const API_BASE = localStorage.getItem('forgesense.api') || 'http://localhost:8080';

export class SessionExpiredError extends Error {
  constructor(message = 'Authenticated session required — please sign in again') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

let token = null;
let username = null;
let roles = [];
const authRequiredListeners = new Set();

export function getToken() { return token; }
export function getRoles() { return roles.slice(); }
export function getUsername() { return username; }
export function isAuthenticated() { return !!token; }

export function onAuthRequired(fn) {
  authRequiredListeners.add(fn);
  return () => authRequiredListeners.delete(fn);
}

function notifyAuthRequired() {
  for (const fn of [...authRequiredListeners]) {
    try { fn(); } catch { /* listener failures are isolated */ }
  }
}

/** Drop the session without touching the backend. Notifies re-authentication. */
export function clearSession() {
  const hadToken = !!token;
  token = null;
  username = null;
  roles = [];
  if (hadToken) notifyAuthRequired();
  return hadToken;
}

/** Explicit sign-out: clears local session state. */
export function logout() {
  clearSession();
}

async function raw(path, opts = {}) {
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(API_BASE + path, { ...opts, headers });
  if (!res.ok && res.status !== 401) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${path}${text ? ' — ' + text.slice(0, 240) : ''}`);
  }
  return res;
}

async function parseBody(res) {
  const t = await res.text().catch(() => '');
  return t ? JSON.parse(t) : null;
}

export async function login(user, pass) {
  const res = await raw('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: user, password: pass }),
  });
  if (!res.ok) throw new Error('Login failed — check credentials');
  const data = await parseBody(res);
  token = data.accessToken;
  username = data.username || user;
  roles = data.roles || [];
  return data;
}

/**
 * Authorized REST call. A 401 invalidates the local session and raises
 * SessionExpiredError. There is deliberately NO silent re-login: the app re-opens
 * the sign-in gate so the operator explicitly confirms identity and role.
 */
export async function api(path, opts = {}) {
  const res = await raw(path, opts);
  if (res.status === 401) {
    clearSession();
    throw new SessionExpiredError();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${path}${text ? ' — ' + text.slice(0, 240) : ''}`);
  }
  return parseBody(res);
}

export function post(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body || {}) });
}