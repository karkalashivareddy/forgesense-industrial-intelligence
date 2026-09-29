/**
 * Session storage.
 *
 * Explicit trade-off, documented so a reviewer can judge it:
 *
 *  - The PASSWORD is never stored, anywhere, in any form.
 *  - The JWT access token is held in `sessionStorage`, not `localStorage`.
 *    `sessionStorage` is scoped to the browser tab and is discarded when the
 *    tab closes, so a shared workstation does not leak a live session to the
 *    next operator.
 *  - An operations console is used for hours at a time and operators do
 *    refresh. A memory-only token forces a re-login on every refresh, which is
 *    operationally unacceptable for a control room.
 *  - The trade-off accepted: an XSS payload could read the token from
 *    `sessionStorage`. This is why the app renders everything through React
 *    (no `innerHTML` anywhere in `src/`), has no third-party scripts, loads no
 *    external origins, and sets a strict Content-Security-Policy in nginx.
 *
 * Expired tokens are discarded on load so a stale session never reaches the API.
 */

const TOKEN_KEY = 'forgesense.session';
const USERNAME_KEY = 'forgesense.username';

export interface StoredSession {
  token: string;
  username: string;
  roles: string[];
  /** Epoch milliseconds at which the token stops being valid. */
  expiresAt: number;
}

function readRaw(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed || typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Decode a JWT expiry without verifying the signature. The client never trusts
 * this for authorisation — the backend is authoritative. It is used only to
 * avoid mounting an application shell with a token that is already dead.
 */
function expiryFromJwt(token: string, fallbackSeconds: number): number {
  try {
    const payload = token.split('.')[1];
    if (!payload) return Date.now() + fallbackSeconds * 1000;
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    if (typeof decoded.exp === 'number') return decoded.exp * 1000;
  } catch {
    /* fall through to the server-provided lifetime */
  }
  return Date.now() + fallbackSeconds * 1000;
}

export function saveSession(token: string, username: string, roles: string[], lifetimeSeconds = 3_600): StoredSession {
  const session: StoredSession = {
    token,
    username,
    roles,
    expiresAt: expiryFromJwt(token, lifetimeSeconds),
  };
  try {
    window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
    window.sessionStorage.setItem(USERNAME_KEY, username);
  } catch {
    /* storage disabled (private mode): the session stays in memory only */
  }
  return session;
}

export function loadSession(): StoredSession | null {
  const session = readRaw();
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    clearSession();
    return null;
  }
  return session;
}

export function clearSession(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USERNAME_KEY);
  } catch {
    /* nothing to clear */
  }
}

export function hasStoredSession(): boolean {
  return readRaw() !== null;
}
