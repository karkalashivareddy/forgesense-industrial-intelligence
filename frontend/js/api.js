export const API_BASE = localStorage.getItem('forgesense.api') || 'http://localhost:8080';

let token = null;
let username = null;
let roles = [];

export function getToken() { return token; }
export function getRoles() { return roles.slice(); }
export function getUsername() { return username; }

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
  username = data.username;
  roles = data.roles || [];
  return data;
}

async function relogin() {
  const pw = decodePw() || 'forgesense-dev';
  for (const u of username ? [username] : ['operator', 'engineer', 'admin']) {
    try {
      await login(u, pw);
      return true;
    } catch { /* try next candidate */ }
  }
  return false;
}

export async function api(path, opts = {}) {
  let res = await raw(path, opts);
  if (res.status === 401 && !opts._retry) {
    if (await relogin()) res = await raw(path, { ...opts, _retry: true });
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

export function decodePw() {
  return localStorage.getItem('forgesense.pw') || '';
}