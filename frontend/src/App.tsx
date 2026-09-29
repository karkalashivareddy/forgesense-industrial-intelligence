/**
 * Application root.
 *
 * Composition order matters:
 *   QueryClientProvider   — server state, one cache, per-query error isolation
 *   AuthProvider          — session, 401 handling
 *   RealtimeSession       — the single WebSocket, started only when signed in
 *   Router                — route table
 */

import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { SignInGate } from './auth/SignInGate';
import { AppShell } from './app/AppShell';
import { useRealtimeSession } from './realtime/useRealtimeSession';
import { LoadingState } from './design-system';
import { SessionExpiredError, NetworkError } from './api/client';
import {
  AlertsRoute,
  AnalyticsRoute,
  AnomaliesRoute,
  CommandCenterRoute,
  DEFAULT_ROUTE,
  EventsRoute,
  FactoryTwinRoute,
  FleetRoute,
  MaintenanceRoute,
  PredictionsRoute,
  SimulationRoute,
  SystemRoute,
  TelemetryRoute,
} from './app/routes';

import './styles/global.css';
import './styles/components.css';
import './styles/workspaces.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Realtime drives freshness; the REST snapshot is the reconciliation path.
      staleTime: 1_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // A dead backend or an expired session must not be retried blindly.
        if (error instanceof SessionExpiredError) return false;
        if (error instanceof NetworkError) return failureCount < 1;
        return failureCount < 2;
      },
    },
    mutations: { retry: false },
  },
});

function AuthenticatedApp() {
  const { isAuthenticated } = useAuth();

  // The realtime transport exists only for an authenticated session.
  useRealtimeSession(isAuthenticated);

  // Session expiry is handled where it actually happens: any 401 from the
  // backend raises SessionExpiredError, and AuthProvider's unauthorized
  // handler clears the session and re-opens the sign-in gate. There is no
  // token to poll, because the token is intentionally never persisted.

  if (!isAuthenticated) return <SignInGate />;

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingState label="Loading ForgeSense…" rows={4} />}>
        <Routes>
          <Route element={<AppShell />}>
            {/*
              The command centre is the index route rather than a redirect from
              "/". A redirect would fire a second navigation on first load,
              which correctly re-focuses <main> and would push the skip link
              out of the first tab stop for no benefit.
            */}
            <Route path="/" element={<CommandCenterRoute />} />
            <Route path="/command" element={<CommandCenterRoute />} />
            <Route path="/twin" element={<FactoryTwinRoute />} />
            <Route path="/fleet" element={<FleetRoute />} />
            <Route path="/telemetry" element={<TelemetryRoute />} />
            <Route path="/predictions" element={<PredictionsRoute />} />
            <Route path="/anomalies" element={<AnomaliesRoute />} />
            <Route path="/analytics" element={<AnalyticsRoute />} />
            <Route path="/alerts" element={<AlertsRoute />} />
            <Route path="/maintenance" element={<MaintenanceRoute />} />
            <Route path="/events" element={<EventsRoute />} />
            <Route path="/simulation" element={<SimulationRoute />} />
            <Route path="/system" element={<SystemRoute />} />
            <Route path="*" element={<Navigate to={`/${DEFAULT_ROUTE}`} replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthenticatedApp />
      </AuthProvider>
    </QueryClientProvider>
  );
}
