/**
 * Command Center.
 *
 * The landing surface. It answers, in priority order:
 *   1. Is the factory operating, needing attention, degraded, or offline?
 *   2. Which assets should I look at first?
 *   3. What just changed?
 *
 * Layout is deliberately asymmetric: the operational picture gets the largest
 * area, priority incidents sit to the right, and the live event stream runs
 * along the bottom. This is not a grid of equal KPI cards.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertOctagon, ArrowRight, Radio, Wrench } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  HealthIndicator,
  LoadingState,
  Metric,
  Panel,
  RiskIndicator,
  SectionHeader,
  StatusBadge,
} from '../design-system';
import {
  useAlertStats,
  useAlerts,
  useAnalyticsOverview,
  useEvents,
  useMaintenance,
  useMachines,
  useRiskRanking,
  useSystemStatus,
} from '../api/queries';
import { useUiStore } from '../store/ui';
import {
  ageSeconds,
  deriveOperationalState,
  factoryVerdict,
  riskTone,
  summariseFleet,
} from '../domain/machineState';
import { DATA_BASIS, resolveBasis } from '../domain/basis';
import {
  formatAge,
  formatDuration,
  formatInteger,
  formatNumber,
  formatProbability,
  formatTime,
} from '../domain/format';
import { useNow } from '../hooks/useNow';
import { toErrorMessage } from '../api/client';
import type { Machine } from '../api/types';

export default function CommandCenter() {
  const navigate = useNavigate();
  const now = useNow(2000);
  const openInspector = useUiStore((state) => state.openInspector);

  const machinesQuery = useMachines();
  const analyticsQuery = useAnalyticsOverview();
  const statusQuery = useSystemStatus();

  const machines = machinesQuery.data ?? [];
  const summary = useMemo(() => summariseFleet(machines, now), [machines, now]);
  const verdict = useMemo(() => factoryVerdict(summary), [summary]);
  const basis = resolveBasis(statusQuery.data?.dataBasis);

  const attention = useMemo(
    () =>
      machines
        .map((machine) => ({ machine, derived: deriveOperationalState(machine, now) }))
        .filter((entry) => ['CRITICAL', 'WARNING', 'DEGRADED', 'OFFLINE', 'STALE'].includes(entry.derived.state))
        .sort((a, b) => severity(b.derived.state) - severity(a.derived.state) || b.machine.failureRisk - a.machine.failureRisk),
    [machines, now],
  );

  if (machinesQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="Command Center" description="Factory Alpha · live operational picture" />
        <LoadingState label="Loading the fleet snapshot…" rows={5} />
      </div>
    );
  }

  if (machinesQuery.isError) {
    return (
      <div className="workspace">
        <SectionHeader title="Command Center" description="Factory Alpha · live operational picture" />
        <ErrorState
          title="Cannot reach the ForgeSense backend"
          description={toErrorMessage(
            machinesQuery.error,
            'The REST snapshot failed. The console will keep retrying; no data below can be trusted until it recovers.',
          )}
          onRetry={() => void machinesQuery.refetch()}
          retrying={machinesQuery.isFetching}
        />
      </div>
    );
  }

  return (
    <div className="workspace">
      <SectionHeader
        title="Command Center"
        description="Factory Alpha · operational state derived from the live asset snapshot"
        actions={
          <>
            <Button size="sm" onClick={() => navigate('/twin')}>
              Open Factory Twin <ArrowRight size={12} />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/fleet')}>
              Fleet view
            </Button>
          </>
        }
      />

      {basis === 'SYNTHETIC' && (
        <div className="banner banner--info">
          <Activity size={13} aria-hidden style={{ flexShrink: 0 }} />
          <span>
            All values on this console come from a synthetic simulator. They demonstrate the platform's behaviour and
            describe no real machine.
          </span>
        </div>
      )}

      {/* ---- Factory verdict: the single most important fact ---- */}
      <div className="verdict" data-tone={verdict.tone}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div className="verdict__label">{verdict.verdict}</div>
          <div className="verdict__detail">{verdict.detail}</div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 'var(--space-4)' }}>
          <HealthIndicator score={summary.averageHealth} label="Fleet health" />
          <RiskIndicator risk={maxRisk(machines)} label="Peak failure risk" />
        </div>
      </div>

      {/* ---- Fleet counters ---- */}
      <div className="grid grid--metrics">
        <Metric label="Assets" value={formatInteger(summary.total)} hint={`${summary.online} reporting`} size="sm" />
        <Metric
          label="Normal"
          value={formatInteger(summary.normal)}
          tone="ok"
          basis={DATA_BASIS.OBSERVED}
          size="sm"
        />
        <Metric
          label="Needs attention"
          value={formatInteger(summary.attention)}
          tone={summary.attention > 0 ? 'warn' : 'ok'}
          basis={DATA_BASIS.DERIVED}
          hint="degraded + warning + critical"
          size="sm"
        />
        <Metric
          label="Critical"
          value={formatInteger(summary.critical)}
          tone={summary.critical > 0 ? 'crit' : 'ok'}
          basis={DATA_BASIS.OBSERVED}
          size="sm"
        />
        <Metric
          label="Stale / offline"
          value={formatInteger(summary.stale + summary.offline)}
          tone={summary.stale + summary.offline > 0 ? 'warn' : 'ok'}
          hint="no recent telemetry"
          size="sm"
        />
        <Metric
          label="Throughput"
          value={formatInteger(analyticsQuery.data?.telemetryThroughputPerMinute)}
          unit="/min"
          basis={DATA_BASIS.OBSERVED}
          size="sm"
        />
      </div>

      <div className="cc">
        {/* ---- LEFT: asset health board ---- */}
        <div className="stack cc__left">
          <Panel
            title="Asset board"
            subtitle="Every asset, coloured by operational state. Select one to inspect it."
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/fleet')}>
                Open Fleet <ArrowRight size={12} />
              </Button>
            }
          >
            <AssetStrip
              machines={machines}
              now={now}
              onSelect={(machineId) => {
                openInspector(machineId, 'overview');
              }}
            />
          </Panel>

          <Panel title="Highest predicted risk" subtitle="Sorted by the model's failure-risk estimate" flush>
            <RiskList now={now} onSelect={openInspector} />
          </Panel>
        </div>

        {/* ---- CENTRE: live event stream ---- */}
        <div className="stack">
          <Panel
            title="Live activity"
            subtitle="Operational events as the backend records them"
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/events')}>
                Event stream <ArrowRight size={12} />
              </Button>
            }
            flush
          >
            <EventStream />
          </Panel>
        </div>

        {/* ---- RIGHT: priority incidents ---- */}
        <div className="stack">
          <Panel
            title="Priority incidents"
            subtitle="Assets that need a decision now"
            tone={attention.length > 0 ? 'warn' : undefined}
            flush
          >
            <PriorityList now={now} onSelect={openInspector} />
          </Panel>

          <Panel
            title="Alert posture"
            subtitle="Observed alert counts by lifecycle state"
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/alerts')}>
                Alerts <ArrowRight size={12} />
              </Button>
            }
          >
            <AlertPosture />
          </Panel>

          <Panel
            title="Maintenance backlog"
            subtitle="Work orders the model has recommended"
            actions={
              <Button size="sm" variant="ghost" onClick={() => navigate('/maintenance')}>
                Work orders <ArrowRight size={12} />
              </Button>
            }
          >
            <MaintenancePosture />
          </Panel>
        </div>
      </div>
    </div>
  );
}

function severity(state: string): number {
  switch (state) {
    case 'CRITICAL':
      return 5;
    case 'OFFLINE':
      return 4;
    case 'WARNING':
      return 3;
    case 'DEGRADED':
      return 2;
    case 'STALE':
      return 1;
    default:
      return 0;
  }
}

function maxRisk(machines: Machine[]): number | null {
  if (machines.length === 0) return null;
  return machines.reduce((max, machine) => Math.max(max, machine.failureRisk ?? 0), 0);
}

/* ------------------------------------------------------------------ *
 * Asset board
 * ------------------------------------------------------------------ */

function AssetStrip({
  machines,
  now,
  onSelect,
}: {
  machines: Machine[];
  now: number;
  onSelect(machineId: string): void;
}) {
  if (machines.length === 0) {
    return <EmptyState title="No assets in the fleet" description="The backend reported an empty machine list." />;
  }
  return (
    <div className="asset-strip">
      {machines.map((machine) => {
        const derived = deriveOperationalState(machine, now);
        return (
          <button
            key={machine.machineId}
            type="button"
            className="asset-strip__cell"
            data-tone={derived.descriptor.tone}
            onClick={() => onSelect(machine.machineId)}
            title={`${machine.machineId} · ${machine.name} — ${derived.descriptor.label}. ${derived.descriptor.guidance}`}
          >
            <span className="asset-strip__id">{machine.machineId}</span>
            <span className="asset-strip__state">{derived.descriptor.label}</span>
            <span className="asset-strip__health">{formatNumber(machine.healthScore, 0)}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Risk list
 * ------------------------------------------------------------------ */

type InspectorOpener = (machineId: string, tab?: 'overview' | 'prediction' | 'alerts') => void;

function RiskList({ now, onSelect }: { now: number; onSelect: InspectorOpener }) {
  const ranking = useRiskRanking();
  const machines = useMachines();

  const rows = useMemo(() => {
    const byId = new Map((machines.data ?? []).map((machine) => [machine.machineId, machine]));
    return (ranking.data ?? [])
      .slice()
      .sort((a, b) => b.failureRisk - a.failureRisk || b.anomalyScore - a.anomalyScore)
      .slice(0, 8)
      .map((row) => ({ row, machine: byId.get(row.machineId) }));
  }, [ranking.data, machines.data]);

  if (ranking.isLoading) return <LoadingState label="Loading risk ranking…" rows={3} />;
  if (ranking.isError) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <ErrorState
          title="Risk ranking unavailable"
          description={toErrorMessage(ranking.error)}
          onRetry={() => void ranking.refetch()}
        />
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState title="No risk data" description="The backend returned an empty risk ranking." />;
  }

  return (
    <ul>
      {rows.map(({ row, machine }) => {
        const derived = machine ? deriveOperationalState(machine, now) : null;
        return (
          <li key={row.machineId}>
            <button
              type="button"
              className="priority-row"
              data-tone={riskTone(row.failureRisk)}
              onClick={() => onSelect(row.machineId, 'prediction')}
            >
              <span className="priority-row__body">
                <span className="priority-row__head">
                  <span className="priority-row__id">{row.machineId}</span>
                  <StatusBadge
                    tone={derived?.descriptor.tone ?? 'idle'}
                    icon={<span className="twin__dot" data-tone={derived?.descriptor.tone ?? 'idle'} aria-hidden />}
                    label={derived?.descriptor.label ?? row.status}
                  />
                </span>
                <span className="priority-row__text">{row.name}</span>
              </span>
              <span style={{ textAlign: 'right', flexShrink: 0 }}>
                <span
                  className="mono"
                  style={{ color: 'var(--ml-text)', fontWeight: 600, display: 'block' }}
                  title="Model-estimated failure probability"
                >
                  {formatProbability(row.failureRisk)}
                </span>
                <span className="tiny muted">anomaly {formatProbability(row.anomalyScore)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Priority incidents
 * ------------------------------------------------------------------ */

function PriorityList({ now, onSelect }: { now: number; onSelect: InspectorOpener }) {
  const alerts = useAlerts();

  const incidents = useMemo(() => {
    const active = (alerts.data?.items ?? []).filter((alert) => alert.status !== 'RESOLVED');
    const byMachine = new Map<string, typeof active>();
    for (const alert of active) {
      const list = byMachine.get(alert.machineId) ?? [];
      list.push(alert);
      byMachine.set(alert.machineId, list);
    }
    return Array.from(byMachine.entries())
      .map(([machineId, items]) => ({
        machineId,
        items,
        worst: items.some((a) => a.severity === 'CRITICAL') ? 'crit' : 'warn',
        oldest: items.reduce((min, a) => (a.openedAt < min ? a.openedAt : min), items[0]?.openedAt ?? ''),
      }))
      .sort((a, b) => (a.worst === b.worst ? b.items.length - a.items.length : a.worst === 'crit' ? -1 : 1))
      .slice(0, 8);
  }, [alerts.data]);

  if (alerts.isLoading) return <LoadingState label="Loading incidents…" rows={3} />;
  if (alerts.isError) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <ErrorState
          title="Alerts unavailable"
          description={toErrorMessage(alerts.error)}
          onRetry={() => void alerts.refetch()}
        />
      </div>
    );
  }
  if (incidents.length === 0) {
    return (
      <EmptyState
        icon={<AlertOctagon size={20} />}
        title="No active alerts"
        description="Every asset is inside its modelled limits. This will change as telemetry arrives."
      />
    );
  }

  return (
    <ul>
      {incidents.map((incident) => {
        const head = incident.items[0];
        return (
          <li key={incident.machineId}>
            <button
              type="button"
              className="priority-row"
              data-tone={incident.worst}
              onClick={() => onSelect(incident.machineId, 'alerts')}
            >
              <span className="priority-row__body">
                <span className="priority-row__head">
                  <span className="priority-row__id">{incident.machineId}</span>
                  <Badge tone={incident.worst === 'crit' ? 'crit' : 'warn'}>
                    {incident.items.length} open
                  </Badge>
                </span>
                <span className="priority-row__text">{head?.headline ?? 'Alert'}</span>
              </span>
              <span className="tiny muted" style={{ flexShrink: 0 }}>
                {formatAge(ageSeconds(incident.oldest, now))}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Alert + maintenance posture
 * ------------------------------------------------------------------ */

function AlertPosture() {
  const stats = useAlertStats();
  const alerts = useAlerts();
  const now = useNow(30_000);

  if (stats.isLoading) return <LoadingState label="Loading alert counts…" rows={2} />;
  if (stats.isError) {
    return (
      <ErrorState
        title="Alert statistics unavailable"
        description={toErrorMessage(stats.error)}
        onRetry={() => void stats.refetch()}
      />
    );
  }

  const items = alerts.data?.items ?? [];
  const acknowledged = items.filter((a) => a.status === 'ACKNOWLEDGED').length;
  const investigating = items.filter((a) => a.status === 'INVESTIGATING').length;
  const resolved = items.filter((a) => a.status === 'RESOLVED').length;
  const critical = items.filter((a) => a.severity === 'CRITICAL' && a.status !== 'RESOLVED').length;

  return (
    <div>
      <div className="grid grid--2">
        <Metric label="Open" value={formatInteger(stats.data?.open ?? 0)} basis={DATA_BASIS.OBSERVED} size="sm" />
        <Metric
          label="Critical open"
          value={formatInteger(critical)}
          tone={critical > 0 ? 'crit' : 'ok'}
          basis={DATA_BASIS.OBSERVED}
          size="sm"
        />
        <Metric label="Acknowledged" value={formatInteger(acknowledged)} size="sm" />
        <Metric label="Investigating" value={formatInteger(investigating)} size="sm" />
        <Metric label="Resolved (retained)" value={formatInteger(resolved)} size="sm" />
        <Metric
          label="Resolved in 24h"
          value={formatInteger(stats.data?.resolvedToday ?? 0)}
          hint={`as of ${formatTime(new Date(now).toISOString())}`}
          size="sm"
        />
      </div>
    </div>
  );
}

function MaintenancePosture() {
  const stats = useAlertStats();
  const maintenance = useMaintenance();

  const recommended = (maintenance.data ?? []).filter((m) => m.status === 'RECOMMENDED');
  const scheduled = (maintenance.data ?? []).filter((m) => m.status === 'SCHEDULED');
  const active = (maintenance.data ?? []).filter((m) => m.status === 'ACTIVE');
  const urgent = recommended.filter((m) => m.priority === 'URGENT');
  const downtime = recommended.reduce((sum, m) => sum + (m.estimatedDurationMinutes ?? 0), 0);

  if (maintenance.isLoading) return <LoadingState label="Loading work orders…" rows={2} />;
  if (maintenance.isError) {
    return (
      <ErrorState
        title="Maintenance unavailable"
        description={toErrorMessage(maintenance.error)}
        onRetry={() => void maintenance.refetch()}
      />
    );
  }

  if ((maintenance.data ?? []).length === 0) {
    return (
      <EmptyState
        icon={<Wrench size={18} />}
        title="No work orders"
        description="Nothing has crossed the maintenance recommendation threshold yet."
      />
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-2)' }}>
      <div className="grid grid--2">
        <Metric label="Recommended" value={formatInteger(recommended.length)} basis={DATA_BASIS.OBSERVED} size="sm" />
        <Metric
          label="Urgent"
          value={formatInteger(urgent.length)}
          tone={urgent.length > 0 ? 'crit' : 'ok'}
          size="sm"
        />
        <Metric label="Scheduled" value={formatInteger(scheduled.length)} size="sm" />
        <Metric label="In progress" value={formatInteger(active.length)} tone={active.length ? 'maint' : 'neutral'} size="sm" />
      </div>
      <div className="kv">
        <span className="kv__k">Estimated effort in backlog</span>
        <span className="kv__v num">{formatDuration(downtime)}</span>
      </div>
      <p className="note">
        {stats.data ? 'Counts are observed from the work-order register. Durations are model estimates.' : ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Event stream
 * ------------------------------------------------------------------ */

function EventStream() {
  const events = useEvents();

  if (events.isLoading) return <LoadingState label="Loading activity…" rows={4} />;
  if (events.isError) {
    return (
      <div style={{ padding: 'var(--space-4)' }}>
        <ErrorState
          title="Activity unavailable"
          description={toErrorMessage(events.error)}
          onRetry={() => void events.refetch()}
        />
      </div>
    );
  }

  const items = events.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState title="No activity recorded" description="Waiting for the simulator to produce telemetry." />;
  }

  return (
    <div style={{ maxHeight: 320, overflowY: 'auto', padding: 'var(--space-1) 0' }}>
      {items.slice(0, 40).map((entry) => (
        <div className="stream-row" key={entry.id}>
          <span className="stream-row__time">{formatTime(entry.eventTime)}</span>
          <span className="stream-row__text">
            <Radio size={10} aria-hidden style={{ verticalAlign: -1, marginRight: 4 }} />
            {entry.detail}
          </span>
          <span className="stream-row__id">{entry.machineId ?? '—'}</span>
        </div>
      ))}
        </div>
      );
}

