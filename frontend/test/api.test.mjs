import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };

const { api, login, logout, isAuthenticated, clearSession, onAuthRequired, getUsername, SessionExpiredError } = await import('../js/api.js');

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body == null ? '' : JSON.stringify(body)) };
}

test('login stores token/roles without exposing credentials to callers', async () => {
  let bodySeen = null;
  globalThis.fetch = async (url, opts) => {
    bodySeen = JSON.parse(opts.body);
    return jsonResponse(200, { accessToken: 'tok-1', username: 'operator', roles: ['ROLE_OPERATOR'] });
  };
  await login('operator', 'pw');
  assert.equal(isAuthenticated(), true);
  assert.equal(getUsername(), 'operator');
  assert.deepEqual(bodySeen, { username: 'operator', password: 'pw' });
});

test('401 invalidates the session with a single request — no candidate re-login', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return jsonResponse(401, { message: 'expired' });
  };
  await assert.rejects(() => api('/api/v1/machines'), (err) => err instanceof SessionExpiredError);
  assert.equal(calls, 1, 'must not retry with candidate usernames');
  assert.equal(isAuthenticated(), false, 'token cleared after 401');
});

test('clearSession notifies auth-required only on a real transition', async () => {
  let notified = 0;
  const off = onAuthRequired(() => { notified += 1; });
  globalThis.fetch = async () => jsonResponse(200, { accessToken: 'tok-2', username: 'engineer', roles: ['ROLE_ENGINEER'] });
  await login('engineer', 'pw');
  clearSession();
  assert.equal(notified, 1);
  assert.equal(isAuthenticated(), false);
  clearSession();
  assert.equal(notified, 1, 'no notification when already signed out');
  off();
});

test('logout clears the session and reports the transition', async () => {
  let notified = 0;
  const off = onAuthRequired(() => { notified += 1; });
  globalThis.fetch = async () => jsonResponse(200, { accessToken: 'tok-3', username: 'admin', roles: ['ROLE_ADMIN'] });
  await login('admin', 'pw');
  logout();
  assert.equal(isAuthenticated(), false);
  assert.equal(notified, 1);
  off();
});