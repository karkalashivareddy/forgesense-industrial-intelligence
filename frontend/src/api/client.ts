/**
 * Typed HTTP client for the ForgeSense backend.
 *
 * Responsibilities:
 *  - attach the bearer token to every request after sign-in
 *  - surface a 401 as an explicit `SessionExpiredError` so the shell can
 *    re-open the sign-in gate instead of silently retrying
 *  - never cache auth headers, never log credentials
 *  - abort in-flight requests when a caller unmounts
 */

import { config } from '../config/env';

export class SessionExpiredError extends Error {
  override readonly name = 'SessionExpiredError';
  constructor(message = 'Your session has expired. Sign in again to continue.') {
    super(message);
  }
}

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(message);
  }
}

export class NetworkError extends Error {
  override readonly name = 'NetworkError';
  constructor(path: string, cause: unknown) {
    super(
      `Cannot reach the ForgeSense API (${path}). The backend may be starting or offline.`,
      { cause },
    );
  }
}

let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registered by the auth provider so a 401 anywhere re-opens the gate. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Skip the Authorization header (login). */
  anonymous?: boolean;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, anonymous = false } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (!anonymous && accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    // An aborted request is a caller decision, not a failure worth surfacing.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new NetworkError(path, error);
  }

  if (response.status === 401 && !anonymous) {
    setAccessToken(null);
    onUnauthorized?.();
    throw new SessionExpiredError();
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new ApiError(
      response.status,
      path,
      `Request failed (HTTP ${response.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`,
    );
  }

  if (response.status === 204) return null as T;

  const text = await response.text();
  if (!text) return null as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, path, 'Backend returned a non-JSON response body.');
  }
}

export const http = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'method'>) =>
    request<T>(path, { ...options, method: 'POST', body: body ?? {} }),
};

/** Extract a human-readable message from anything thrown in the data layer. */
export function toErrorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof NetworkError) return error.message;
  if (error instanceof SessionExpiredError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
