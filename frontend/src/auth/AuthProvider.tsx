/**
 * Authentication.
 *
 * Security posture (see `session.ts` for the full trade-off):
 *  - the password is never stored, never logged, never persisted
 *  - the JWT lives in `sessionStorage` (tab-scoped, cleared on tab close),
 *    never in `localStorage` and never in a cookie readable by JavaScript
 *  - an expired token is discarded before the shell mounts
 *  - role checks here control what the UI *offers*; the backend remains the
 *    authority and re-checks every call
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { http, setAccessToken, setUnauthorizedHandler, toErrorMessage } from '../api/client';
import type { AuthToken } from '../api/types';
import { teardownRealtime } from '../realtime/useRealtimeSession';
import { clearSession, loadSession, saveSession } from './session';

export interface AuthIdentity {
  username: string;
  /** Raw `ROLE_*` strings exactly as issued by the backend. */
  roles: string[];
  token: string;
  expiresAt: number;
}

interface AuthContextValue {
  identity: AuthIdentity | null;
  isAuthenticated: boolean;
  signIn(username: string, password: string): Promise<void>;
  signOut(): void;
  hasRole(role: 'OPERATOR' | 'ENGINEER' | 'ADMIN'): boolean;
  /** Highest role held, for display only. */
  primaryRole: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<AuthIdentity | null>(null);
  const queryClient = useQueryClient();

  // Restore a tab-scoped session, discarding it if the JWT has already expired.
  useEffect(() => {
    const restored = loadSession();
    if (!restored) return;
    setAccessToken(restored.token);
    setIdentity({
      username: restored.username,
      roles: restored.roles,
      token: restored.token,
      expiresAt: restored.expiresAt,
    });
  }, []);

  // A 401 from any request drops the session and re-opens the sign-in gate.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearSession();
      setAccessToken(null);
      setIdentity(null);
      teardownRealtime();
      queryClient.clear();
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  const signIn = useCallback(async (username: string, password: string) => {
    const response = await http.post<AuthToken>('/api/v1/auth/login', { username, password }, { anonymous: true });
    const token = response?.accessToken;
    if (!token) throw new Error('The backend did not return a session token.');

    const resolvedUsername = response.username ?? username;
    const roles = Array.isArray(response.roles) ? response.roles : [];
    const session = saveSession(token, resolvedUsername, roles, response.expiresIn ?? 3_600);

    setAccessToken(token);
    setIdentity({ username: resolvedUsername, roles, token, expiresAt: session.expiresAt });
  }, []);

  const signOut = useCallback(() => {
    clearSession();
    setAccessToken(null);
    setIdentity(null);
    teardownRealtime();
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({
      identity,
      isAuthenticated: identity !== null,
      signIn,
      signOut,
      hasRole: (role) => Boolean(identity?.roles.includes(`ROLE_${role}`)),
      primaryRole:
        identity?.roles.find((r) => r === 'ROLE_ADMIN') ??
        identity?.roles.find((r) => r === 'ROLE_ENGINEER') ??
        identity?.roles[0] ??
        null,
    }),
    [identity, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>.');
  return context;
}

export { toErrorMessage };
