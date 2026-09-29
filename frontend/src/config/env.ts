/**
 * Runtime configuration.
 *
 * No hardcoded backend origin inside application code. Everything routes
 * through this module, which is validated once at startup so a misconfigured
 * deployment fails loudly in development instead of silently in the browser.
 */

function readEnv(key: string): string | undefined {
  const value = (import.meta.env as Record<string, string | undefined>)[key];
  return value && value.trim() ? value.trim() : undefined;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

const DEFAULT_API_BASE = 'http://localhost:8080';

const rawApiBase = stripTrailingSlash(readEnv('VITE_API_BASE_URL') ?? DEFAULT_API_BASE);

if (!/^https?:\/\//i.test(rawApiBase)) {
  throw new Error(
    `[ForgeSense] VITE_API_BASE_URL must be an absolute http(s) origin. Received: "${rawApiBase}"`,
  );
}

export const config = {
  /** Spring Boot REST origin, no trailing slash. */
  apiBaseUrl: rawApiBase,

  /**
   * STOMP-over-WebSocket endpoint. Derived from the API origin unless
   * explicitly configured, so a single env var is enough for local dev.
   */
  wsUrl: readEnv('VITE_WS_URL') ?? rawApiBase.replace(/^http/i, 'ws') + '/ws',

  /** REST snapshot cadence. Matches the backend's advertised poll interval. */
  snapshotRefetchMs: 3_000,

  /** How often slow-moving analytics recompute. */
  analyticsRefetchMs: 15_000,

  /**
   * A machine is STALE when no telemetry has arrived for this long while the
   * feed is otherwise healthy. 60s ≈ 12 missed 5s simulator samples.
   */
  staleAfterSec: 60,

  /** A realtime transport with no delta for this long is reported DEGRADED. */
  transportStaleAfterSec: 30,

  /** Bounded in-memory windows. Nothing in the UI grows without a cap. */
  limits: {
    /** Telemetry points retained per machine for live sparklines. */
    telemetryRing: 120,
    /** Live event rows retained in the activity stream. */
    eventStream: 100,
    /** Alert rows retained client-side. */
    alerts: 100,
    /** Remembered realtime event ids for duplicate suppression. */
    dedupe: 2048,
  },

  showSyntheticAdvisory: readEnv('VITE_SHOW_SYNTHETIC_ADVISORY') !== 'false',
} as const;

export type AppConfig = typeof config;
