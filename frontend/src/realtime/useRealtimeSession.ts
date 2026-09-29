/**
 * React binding for the STOMP transport.
 *
 * Owns exactly one WebSocket for the lifetime of an authenticated session.
 * Guarantees:
 *  - no duplicate connections (the client is a module singleton per token)
 *  - no work while the tab is hidden or the document is not visible
 *  - the socket is torn down on sign-out and unmount
 */

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { config } from '../config/env';
import { StompRealtimeClient, type TransportStatus } from './stomp';
import { useRealtimeStore, useTelemetryStore } from './store';
import { getAccessToken } from '../api/client';
import { normaliseTelemetry } from '../api/adapters';

let activeClient: StompRealtimeClient | null = null;
let activeToken: string | null = null;

/** Tear down the shared transport. Safe to call repeatedly. */
export function teardownRealtime(): void {
  activeClient?.disconnect();
  activeClient = null;
  activeToken = null;
  useRealtimeStore.getState().reset();
  useTelemetryStore.getState().clear();
}

export function useRealtimeSession(enabled: boolean): void {
  const queryClient = useQueryClient();
  const applyStatus = useRealtimeStore((state) => state.applyStatus);
  const applyEvents = useRealtimeStore((state) => state.applyEvents);
  const pushReading = useTelemetryStore((state) => state.pushReading);
  const requestReconcile = useRealtimeStore((state) => state.requestReconcile);
  const ref = useRef({ applyStatus, applyEvents, pushReading, requestReconcile });
  ref.current = { applyStatus, applyEvents, pushReading, requestReconcile };
  const lastReconcile = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      teardownRealtime();
      return;
    }

    const token = getAccessToken();
    if (!token) return;

    // Reuse the existing socket when the session has not changed.
    if (activeClient && activeToken === token) return;
    teardownRealtime();
    activeToken = token;

    const client = new StompRealtimeClient(
      config.wsUrl,
      () => getAccessToken(),
      {
        onStatus: (status: TransportStatus) => ref.current.applyStatus(status),

        onEvents: (batch) => {
          const now = Date.now();
          const telemetry = useTelemetryStore.getState();

          for (const { topic, event } of batch) {
            if (topic !== 'telemetry.updated') continue;
            const machineId = (event.payload.machineId ?? event.assetId) as string | undefined;
            if (!machineId) continue;
            const reading = normaliseTelemetry(event.payload as Record<string, unknown>);
            const { machineId: _m, machineType: _t, ...values } = reading;
            void _m;
            void _t;
            const numeric: Record<string, number> = {};
            for (const [key, value] of Object.entries(values)) {
              if (typeof value === 'number') numeric[key] = value;
            }
            // Only assets the operator is actually watching build history, so
            // an idle console does not accumulate 18 unbounded series.
            if (telemetry.watched[machineId]) {
              ref.current.pushReading(machineId, reading.timestamp, numeric, reading.sequence, now);
            }
          }

          ref.current.applyEvents(batch, now);
        },

        onDiagnostic: (code, detail) => {
          if (code === 'sequence-regression') {
            // A dropped or replayed envelope: ask for an authoritative snapshot
            // rather than letting client state drift.
            ref.current.requestReconcile(detail ?? 'sequence-regression', Date.now());
          }
          if (import.meta.env.DEV) {
            console.debug(`[realtime] ${code}${detail ? ` — ${detail}` : ''}`);
          }
        },
      },
      { maxDedupe: config.limits.dedupe },
    );

    activeClient = client;
    client.connect();

    // Backstop reconciliation: when the transport reports a gap, invalidate the
    // snapshot queries so the REST authority re-seats the client.
    const unsubscribe = useRealtimeStore.subscribe((state) => {
      if (state.reconcileRequestedAt && state.reconcileRequestedAt !== lastReconcile.current) {
        lastReconcile.current = state.reconcileRequestedAt;
        void queryClient.invalidateQueries({ queryKey: ['machines'] });
        void queryClient.invalidateQueries({ queryKey: ['alerts'] });
        void queryClient.invalidateQueries({ queryKey: ['maintenance'] });
        useRealtimeStore.getState().noteReconciled(Date.now());
      }
    });

    // Pause entirely while the tab is hidden: no socket churn, no timers.
    const onVisibility = () => {
      if (document.hidden) {
        client.disconnect();
        useRealtimeStore.getState().applyStatus({
          ...useRealtimeStore.getState().transport,
          state: 'stale',
          detail: 'paused — browser tab hidden',
        });
      } else if (activeClient === client) {
        client.connect();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibility);
      if (activeClient === client) teardownRealtime();
    };
  }, [enabled, queryClient]);
}
