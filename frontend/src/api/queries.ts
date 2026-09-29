/**
 * Server-state hooks.
 *
 * Every backend resource is a separate query so that one failing subsystem
 * cannot blank the whole console: TanStack Query isolates errors per query
 * key, and each consumer decides how to render ITS OWN error without
 * discarding healthy data from the rest of the application.
 *
 * A resource is never a broad `Promise.all` fan-out.
 */

import { useQuery, useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { http } from '../api/client';
import {
  normaliseAlertList,
  normaliseExplanation,
  normaliseMachine,
  normaliseMachineDetail,
  normaliseMaintenance,
  normalisePrediction,
  normaliseRiskRanking,
  normaliseTelemetryRange,
  normaliseZones,
} from '../api/adapters';
import type {
  ActuatorHealth,
  AlertListResponse,
  AlertStats,
  AnalyticsOverview,
  DependencyEdge,
  EventFrequency,
  EventListResponse,
  Explanation,
  Factory,
  FleetHealth,
  ImpactResponse,
  Machine,
  MachineDetail,
  MaintenanceRecord,
  MaintenanceStats,
  Prediction,
  RiskRankingRow,
  SimulationControl,
  SimulationRun,
  SimulatorConfig,
  SystemStatus,
  TelemetryRangeResponse,
  TelemetryStatus,
  Zone,
} from '../api/types';
import { config } from '../config/env';

/* ------------------------------------------------------------------ *
 * Reference / topology (rarely changes)
 * ------------------------------------------------------------------ */

export function useZones(): UseQueryResult<Zone[]> {
  return useQuery({
    queryKey: ['zones'],
    queryFn: async ({ signal }) => normaliseZones(await http.get<unknown>('/api/v1/zones', { signal })),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

export function useFactories(): UseQueryResult<Factory[]> {
  return useQuery({
    queryKey: ['factories'],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>[]>('/api/v1/factories', { signal });
      return raw.map((f) => ({
        id: String(f.id ?? ''),
        code: String(f.code ?? ''),
        name: String(f.name ?? ''),
        location: f.location ? String(f.location) : undefined,
      }));
    },
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

export function useDependencyEdges(): UseQueryResult<DependencyEdge[]> {
  return useQuery({
    queryKey: ['dependencies'],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>[]>('/api/v1/machines/dependencies/edge', { signal });
      return raw.map((e) => ({
        id: String(e.id ?? ''),
        upstream: String(e.upstream ?? ''),
        downstream: String(e.downstream ?? ''),
        relation: String(e.relation ?? 'SERVICE') as DependencyEdge['relation'],
        propagationFactor: Number(e.propagationFactor ?? 0),
        delayMinutes: Number(e.delayMinutes ?? 0),
      }));
    },
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  });
}

/* ------------------------------------------------------------------ *
 * Core fleet snapshot — the reconciliation authority
 * ------------------------------------------------------------------ */

export function useMachines(): UseQueryResult<Machine[]> {
  return useQuery({
    queryKey: ['machines'],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>[]>('/api/v1/machines', { signal });
      return raw.map(normaliseMachine).filter((m) => m.machineId);
    },
    refetchInterval: config.snapshotRefetchMs,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 1_000,
    retry: 1,
  });
}

export function useMachine(machineId: string | null): UseQueryResult<MachineDetail> {
  return useQuery({
    queryKey: ['machine', machineId],
    queryFn: async ({ signal }) =>
      normaliseMachineDetail(await http.get<Record<string, unknown>>(`/api/v1/machines/${machineId}`, { signal })),
    enabled: Boolean(machineId),
    staleTime: 5_000,
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

export function useMachineTelemetry(machineId: string | null, limit = 120): UseQueryResult<TelemetryRangeResponse> {
  return useQuery({
    queryKey: ['telemetry', machineId, limit],
    queryFn: async ({ signal }) =>
      normaliseTelemetryRange(
        await http.get<unknown>(`/api/v1/machines/${machineId}/telemetry?limit=${limit}`, { signal }),
      ),
    enabled: Boolean(machineId),
    staleTime: 2_000,
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

export function useMachinePredictions(machineId: string | null): UseQueryResult<Prediction[]> {
  return useQuery({
    queryKey: ['predictions', machineId],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>[]>(`/api/v1/machines/${machineId}/predictions`, { signal });
      return raw.map(normalisePrediction);
    },
    enabled: Boolean(machineId),
    staleTime: 2_000,
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

export function useMachineExplanation(machineId: string | null): UseQueryResult<Explanation> {
  return useQuery({
    queryKey: ['explanation', machineId],
    queryFn: async ({ signal }) =>
      normaliseExplanation(await http.get<Record<string, unknown>>(`/api/v1/machines/${machineId}/explanation`, { signal })),
    enabled: Boolean(machineId),
    staleTime: 2_000,
    refetchInterval: config.snapshotRefetchMs * 3,
    retry: 1,
  });
}

export function useMachineEvents(machineId: string | null): UseQueryResult<EventListResponse> {
  return useQuery({
    queryKey: ['machine-events', machineId],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>>(`/api/v1/machines/${machineId}/events`, { signal });
      const items = Array.isArray(raw.items) ? (raw.items as Record<string, unknown>[]) : [];
      return {
        count: Number(raw.count ?? items.length),
        items: items as unknown as EventListResponse['items'],
      };
    },
    enabled: Boolean(machineId),
    staleTime: 3_000,
    refetchInterval: config.snapshotRefetchMs * 3,
    retry: 1,
  });
}

export function useMachineImpact(machineId: string | null): UseQueryResult<ImpactResponse> {
  return useQuery({
    queryKey: ['impact', machineId],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>>(`/api/v1/impact/${machineId}`, { signal });
      const history = Array.isArray(raw.history) ? (raw.history as Record<string, unknown>[]) : [];
      return {
        latest: (raw.latest as ImpactResponse['latest']) ?? null,
        history: history as unknown as ImpactResponse['history'],
      };
    },
    enabled: Boolean(machineId),
    staleTime: 10_000,
    retry: 1,
  });
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

export function useAlerts(status?: string): UseQueryResult<AlertListResponse> {
  const query = status && status !== 'ALL' ? `?status=${status}&limit=100` : '?limit=100';
  return useQuery({
    queryKey: ['alerts', status ?? 'ALL'],
    queryFn: async ({ signal }) => normaliseAlertList(await http.get<unknown>(`/api/v1/alerts${query}`, { signal })),
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

function useAlertAction(path: (id: string) => string, invalidates: string[][]) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => http.post<Record<string, unknown>>(path(id)),
    onSuccess: () => {
      for (const key of invalidates) void client.invalidateQueries({ queryKey: key });
    },
  });
}

export const useAcknowledgeAlert = () =>
  useAlertAction((id) => `/api/v1/alerts/${id}/acknowledge`, [['alerts'], ['analytics', 'alerts'], ['events']]);

export const useInvestigateAlert = () =>
  useAlertAction((id) => `/api/v1/alerts/${id}/investigate`, [['alerts'], ['analytics', 'alerts'], ['events']]);

export const useResolveAlert = () =>
  useAlertAction((id) => `/api/v1/alerts/${id}/resolve`, [['alerts'], ['analytics', 'alerts'], ['events']]);

/* ------------------------------------------------------------------ *
 * Maintenance
 * ------------------------------------------------------------------ */

export function useMaintenance(): UseQueryResult<MaintenanceRecord[]> {
  return useQuery({
    queryKey: ['maintenance'],
    queryFn: async ({ signal }) =>
      normaliseMaintenance(await http.get<Record<string, unknown>>('/api/v1/maintenance?limit=100', { signal })),
    refetchInterval: config.snapshotRefetchMs * 4,
    retry: 1,
  });
}

function useMaintenanceAction(path: (id: string) => string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => http.post<Record<string, unknown>>(path(id)),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['maintenance'] });
      void client.invalidateQueries({ queryKey: ['analytics', 'maintenance'] });
      void client.invalidateQueries({ queryKey: ['machines'] });
    },
  });
}

export const useScheduleMaintenance = () => useMaintenanceAction((id) => `/api/v1/maintenance/${id}/schedule`);
export const useStartMaintenance = () => useMaintenanceAction((id) => `/api/v1/maintenance/${id}/start`);
export const useCompleteMaintenance = () => useMaintenanceAction((id) => `/api/v1/maintenance/${id}/complete`);
export const useCancelMaintenance = () => useMaintenanceAction((id) => `/api/v1/maintenance/${id}/cancel`);

/* ------------------------------------------------------------------ *
 * Analytics (slower cadence)
 * ------------------------------------------------------------------ */

export function useAnalyticsOverview(): UseQueryResult<AnalyticsOverview> {
  return useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: async ({ signal }) => http.get<AnalyticsOverview>('/api/v1/analytics/overview', { signal }),
    refetchInterval: config.analyticsRefetchMs,
    retry: 1,
  });
}

export function useRiskRanking(): UseQueryResult<RiskRankingRow[]> {
  return useQuery({
    queryKey: ['analytics', 'risk-ranking'],
    queryFn: async ({ signal }) =>
      normaliseRiskRanking(await http.get<Record<string, unknown>[]>('/api/v1/analytics/risk-ranking', { signal })),
    refetchInterval: config.analyticsRefetchMs,
    retry: 1,
  });
}

export function useAlertStats(): UseQueryResult<AlertStats> {
  return useQuery({
    queryKey: ['analytics', 'alerts'],
    queryFn: async ({ signal }) => http.get<AlertStats>('/api/v1/analytics/alerts', { signal }),
    refetchInterval: config.analyticsRefetchMs,
    retry: 1,
  });
}

export function useFleetHealth(): UseQueryResult<FleetHealth> {
  return useQuery({
    queryKey: ['analytics', 'health-trends'],
    queryFn: async ({ signal }) => http.get<FleetHealth>('/api/v1/analytics/health-trends', { signal }),
    refetchInterval: config.analyticsRefetchMs,
    retry: 1,
  });
}

export function useMaintenanceStats(): UseQueryResult<MaintenanceStats> {
  return useQuery({
    queryKey: ['analytics', 'maintenance'],
    queryFn: async ({ signal }) => http.get<MaintenanceStats>('/api/v1/analytics/maintenance', { signal }),
    refetchInterval: config.analyticsRefetchMs,
    retry: 1,
  });
}

export function useEventFrequency(): UseQueryResult<EventFrequency> {
  return useQuery({
    queryKey: ['analytics', 'events'],
    queryFn: async ({ signal }) => http.get<EventFrequency>('/api/v1/analytics/events', { signal }),
    refetchInterval: config.analyticsRefetchMs,
    retry: 1,
  });
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export function useEvents(machineId?: string | null): UseQueryResult<EventListResponse> {
  const query = machineId ? `?machineId=${machineId}&limit=50` : '?limit=50';
  return useQuery({
    queryKey: ['events', machineId ?? 'all'],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>>(`/api/v1/events${query}`, { signal });
      const items = Array.isArray(raw.items) ? (raw.items as EventListResponse['items']) : [];
      return { count: Number(raw.count ?? items.length), items };
    },
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

/* ------------------------------------------------------------------ *
 * Simulation
 * ------------------------------------------------------------------ */

export function useSimulationRuns(): UseQueryResult<SimulationRun[]> {
  return useQuery({
    queryKey: ['simulation', 'runs'],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>[]>('/api/v1/simulation/scenarios', { signal });
      return raw.map((r) => ({
        id: String(r.id ?? ''),
        name: String(r.name ?? 'Scenario run'),
        machineId: String(r.machineId ?? ''),
        machineName: String(r.machineName ?? ''),
        scenarioType: String(r.scenarioType ?? 'NONE') as SimulationRun['scenarioType'],
        severity: Number(r.severity ?? 0),
        status: String(r.status ?? 'UNKNOWN'),
        affectedMachineCount: Number(r.affectedMachineCount ?? 0),
        affectedMachineIds: Array.isArray(r.affectedMachineIds) ? (r.affectedMachineIds as string[]) : undefined,
        expectedDowntimeMinutes: Number(r.expectedDowntimeMinutes ?? 0),
        productionLossUnits: Number(r.productionLossUnits ?? 0),
        throughputLossUnits:
          typeof r.throughputLossUnits === 'number' ? r.throughputLossUnits : undefined,
        failureHorizonMinutes:
          typeof r.failureHorizonMinutes === 'number' ? r.failureHorizonMinutes : undefined,
        result: (r.result as Record<string, unknown>) ?? undefined,
        createdAt: String(r.createdAt ?? ''),
      }));
    },
    refetchInterval: config.snapshotRefetchMs * 4,
    retry: 1,
  });
}

export function useSimulationControls(): UseQueryResult<SimulationControl[]> {
  return useQuery({
    queryKey: ['simulation', 'controls'],
    queryFn: async ({ signal }) => {
      const raw = await http.get<Record<string, unknown>[]>('/api/v1/simulation/control', { signal });
      return raw.map((c) => ({
        machineId: String(c.machineId ?? ''),
        scenario: String(c.scenario ?? 'NONE') as SimulationControl['scenario'],
        severity: Number(c.severity ?? 0),
        active: Boolean(c.active),
        paused: Boolean(c.paused),
        startedAt: (c.startedAt as string) ?? null,
      }));
    },
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

export function useSimulatorConfig(): UseQueryResult<SimulatorConfig> {
  return useQuery({
    queryKey: ['simulation', 'config'],
    queryFn: async ({ signal }) => http.get<SimulatorConfig>('/api/v1/simulator/config', { signal }),
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

/**
 * Simulation/control mutation.
 *
 * `override` lets a caller supply the request body at call time (the live
 * control injection needs `{machineId, scenario, severity}`), while actions
 * with a fixed body (the what-if run) pass it here. Either may be omitted for
 * the no-argument endpoints.
 */
function useSimulationAction(path: string, body?: Record<string, unknown>) {
  const client = useQueryClient();
  return useMutation<Record<string, unknown>, unknown, Record<string, unknown> | undefined>({
    mutationFn: async (override) => http.post<Record<string, unknown>>(path, override ?? body ?? {}),
    onSuccess: () => {
      for (const key of [
        ['simulation'],
        ['machines'],
        ['alerts'],
        ['maintenance'],
        ['impact'],
        ['analytics', 'overview'],
        ['analytics', 'risk-ranking'],
        ['analytics', 'events'],
        ['events'],
      ]) {
        void client.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export const useRunScenario = (body: Record<string, unknown>) => useSimulationAction('/api/v1/simulation/run', body);
export const usePauseSimulator = () => useSimulationAction('/api/v1/simulation/pause');
export const useResumeSimulator = () => useSimulationAction('/api/v1/simulation/resume');
export const useResetSimulator = () => useSimulationAction('/api/v1/simulation/reset');
export const useClearMachineControl = (machineId: string) =>
  useSimulationAction(`/api/v1/simulation/control/${machineId}/clear`);

/**
 * Inject a fault into the SYNTHETIC telemetry feed.
 *
 * This is distinct from `/simulation/run`, which is a what-if analysis: the
 * what-if computes modelled impact and changes nothing, while this changes
 * what the simulator emits next, which propagates through the ML service and
 * the decision engine into machine state, alerts and maintenance
 * recommendations. The UI presents the two as separate actions for exactly
 * that reason.
 */
export const useApplyScenarioControl = () =>
  useSimulationAction('/api/v1/simulation/control');

/* ------------------------------------------------------------------ *
 * System
 * ------------------------------------------------------------------ */

export function useSystemStatus(): UseQueryResult<SystemStatus> {
  return useQuery({
    queryKey: ['system', 'status'],
    queryFn: async ({ signal }) => http.get<SystemStatus>('/api/v1/system/status', { signal }),
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

export function useTelemetryStatus(): UseQueryResult<TelemetryStatus> {
  return useQuery({
    queryKey: ['system', 'telemetry-status'],
    queryFn: async ({ signal }) => http.get<TelemetryStatus>('/api/v1/telemetry/status', { signal }),
    refetchInterval: config.snapshotRefetchMs * 2,
    retry: 1,
  });
}

export function useActuatorHealth(): UseQueryResult<ActuatorHealth> {
  return useQuery({
    queryKey: ['system', 'actuator-health'],
    queryFn: async ({ signal }) => http.get<ActuatorHealth>('/actuator/health', { signal }),
    refetchInterval: config.snapshotRefetchMs * 3,
    retry: 0,
  });
}

/** A live alert the current role is permitted to act on. */
export function canActOnAlert(role: string | null | undefined, action: 'acknowledge' | 'investigate' | 'resolve'): boolean {
  if (!role) return false;
  if (action === 'acknowledge') return ['ROLE_OPERATOR', 'ROLE_ENGINEER', 'ROLE_ADMIN'].includes(role);
  return ['ROLE_ENGINEER', 'ROLE_ADMIN'].includes(role);
}
