/**
 * System Health â€” platform observability.
 *
 * The question this page answers is not "is it green" but "what is broken,
 * what still works, and which data can I still trust right now". Every tile
 * reports an observed value or explicitly says UNKNOWN. Nothing is inferred
 * beyond what the backend actually reported.
 */

import { useMemo } from 'react';
import {
  Activity,
  AlertTriangle,
  Boxes,
  Brain,
  CheckCircle2,
  Database,
  FlaskConical,
  HardDrive,
  Server,
  XCircle,
} from 'lucide-react';
import {
  Badge,
  BasisChip,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  SectionHeader,
  StatusBadge,
} from '../design-system';
import { useActuatorHealth, useMachines, useSystemStatus, useTelemetryStatus } from '../api/queries';
import { useRealtimeStore } from '../realtime/store';
import { resolveBasis, DATA_BASIS, type DataBasis } from '../domain/basis';
import { ageSeconds } from '../domain/machineState';
import { formatAge, formatInteger, formatTime } from '../domain/format';
import { useNow } from '../hooks/useNow';
import { toErrorMessage } from '../api/client';

type ServiceState = 'available' | 'degraded' | 'unavailable' | 'unknown';

const STATE_TONE: Record<ServiceState, 'ok' | 'warn' | 'crit' | 'idle'> = {
  available: 'ok',
  degraded: 'warn',
  unavailable: 'crit',
  unknown: 'idle',
};

const STATE_ICON: Record<ServiceState, React.ReactNode> = {
  available: <CheckCircle2 size={13} aria-hidden />,
  degraded: <AlertTriangle size={13} aria-hidden />,
  unavailable: <XCircle size={13} aria-hidden />,
  unknown: <AlertTriangle size={13} aria-hidden />,
};

export default function SystemHealth() {
  const statusQuery = useSystemStatus();
  const telemetryQuery = useTelemetryStatus();
  const healthQuery = useActuatorHealth();
  const machinesQuery = useMachines();
  const transport = useRealtimeStore((state) => state.transport);
  const now = useNow(2000);

  const basis = resolveBasis(statusQuery.data?.dataBasis);

  const oldestReadingAge = useMemo(() => {
    let oldest: number | null = null;
    for (const machine of machinesQuery.data ?? []) {
      const age = ageSeconds(machine.lastTelemetryAt, now);
      if (age === null) continue;
      if (oldest === null || age > oldest) oldest = age;
    }
    return oldest;
  }, [machinesQuery.data, now]);

  if (statusQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="System" description="Platform health, data provenance and transport integrity" />
        <LoadingState label="Probing platform healthâ€¦" rows={4} />
      </div>
    );
  }

  const status = statusQuery.data;
  const telemetry = telemetryQuery.data;
  const components = healthQuery.data?.components ?? {};

  const services: {
    name: string;
    state: ServiceState;
    detail: string;
    icon: React.ReactNode;
    basis: DataBasis;
  }[] = [
    {
      name: 'Backend API',
      state: statusQuery.isError ? 'unavailable' : 'available',
      detail: statusQuery.isError ? toErrorMessage(statusQuery.error) : `Spring Boot Â· ${status?.application ?? 'ForgeSense'}`,
      icon: <Server size={14} aria-hidden />,
      basis: DATA_BASIS.OBSERVED,
    },
    {
      name: 'ML service',
      state: status?.mlServiceAvailable ? 'available' : 'unavailable',
      detail: status?.mlServiceAvailable
        ? `${status.mlModelVersion ?? 'unknown'} Â· ${status.anomalyModelVersion ?? 'unknown'}`
        : 'Unreachable â€” the backend is using heuristic fallbacks',
      icon: <Brain size={14} aria-hidden />,
      basis: DATA_BASIS.OBSERVED,
    },
    {
      name: 'Database',
      state: status?.database ? 'available' : 'unknown',
      detail: status?.database ?? 'Not reported by the backend',
      icon: <Database size={14} aria-hidden />,
      basis: DATA_BASIS.OBSERVED,
    },
    {
      name: 'Telemetry ingress',
      state: telemetry?.inputTransport ? 'available' : 'unknown',
      detail: telemetry ? `${telemetry.inputTransport} Â· ${telemetry.source}` : 'Not reported',
      icon: <Activity size={14} aria-hidden />,
      basis: DATA_BASIS.OBSERVED,
    },
    {
      name: 'Browser realtime link',
      state:
        transport.state === 'open'
          ? 'available'
          : transport.state === 'reconnecting' || transport.state === 'connecting'
            ? 'degraded'
            : transport.state === 'stale'
              ? 'degraded'
              : 'unavailable',
      detail:
        transport.state === 'open'
          ? `STOMP over WebSocket Â· ${formatInteger(transport.eventsApplied)} deltas applied`
          : (transport.detail ?? 'Not connected'),
      icon: <HardDrive size={14} aria-hidden />,
      basis: DATA_BASIS.OBSERVED,
    },
    {
      name: 'Telemetry simulator',
      state: telemetry?.telemetryPerMinute ? 'available' : 'unknown',
      detail: telemetry
        ? `${formatInteger(telemetry.telemetryPerMinute)} readings/min Â· ${status?.simulationPaused ? 'PAUSED' : 'running'}`
        : 'Not reported',
      icon: <FlaskConical size={14} aria-hidden />,
      basis: DATA_BASIS.SYNTHETIC,
    },
    {
      name: 'Asset snapshot',
      state: machinesQuery.isError ? 'unavailable' : machinesQuery.isFetching ? 'degraded' : 'available',
      detail: machinesQuery.isError
        ? toErrorMessage(machinesQuery.error)
        : `${machinesQuery.data?.length ?? 0} assets Â· oldest reading ${formatAge(oldestReadingAge)}`,
      icon: <Boxes size={14} aria-hidden />,
      basis: basis,
    },
  ];

  const unavailable = services.filter((service) => service.state === 'unavailable');
  const degraded = services.filter((service) => service.state === 'degraded');

  return (
    <div className="workspace">
      <SectionHeader
        title="System"
        description="Platform health, data provenance and transport integrity"
        actions={
          <Button
            size="sm"
            onClick={() => {
              void statusQuery.refetch();
              void telemetryQuery.refetch();
              void healthQuery.refetch();
              void machinesQuery.refetch();
            }}
            loading={statusQuery.isFetching}
          >
            Re-probe now
          </Button>
        }
      />

      {/* Trust summary first: what is broken, what still works. */}
      {unavailable.length > 0 || degraded.length > 0 ? (
        <div className="banner banner--warn" role="status">
          <AlertTriangle size={14} aria-hidden style={{ flexShrink: 0 }} />
          <span>
            {unavailable.length > 0 && (
              <>
                <strong>Unavailable:</strong> {unavailable.map((service) => service.name).join(', ')}.{' '}
              </>
            )}
            {degraded.length > 0 && (
              <>
                <strong>Degraded:</strong> {degraded.map((service) => service.name).join(', ')}.{' '}
              </>
            )}
            Data shown on the workspaces that still have a live source remains trustworthy; any panel fed by an
            unavailable service is displaying an error state rather than a stale success.
          </span>
        </div>
      ) : (
        <div className="banner banner--info" role="status">
          <CheckCircle2 size={14} aria-hidden style={{ flexShrink: 0 }} />
          <span>Every probed service responded. REST snapshots and the realtime link are both live.</span>
        </div>
      )}

      <div className="grid grid--metrics">
        <Metric
          label="Data basis"
          value={<span style={{ fontSize: 'var(--text-md)' }}>{basis}</span>}
          basis={basis}
          size="sm"
          hint={basis === 'SYNTHETIC' ? 'simulator-generated telemetry' : 'from a system of record'}
        />
        <Metric
          label="Input transport"
          value={<span style={{ fontSize: 'var(--text-md)' }}>{status?.inputTransport ?? 'â€”'}</span>}
          size="sm"
        />
        <Metric
label="Realtime link"
          value={
            <span style={{ fontSize: 'var(--text-md)' }}>
              {status?.streaming ? 'Established' : 'No clients connected'}
            </span>
          }
          size="sm"
          hint="derived from the live session count, not a constant"
        />
        <Metric
          label="Realtime deltas"
          value={formatInteger(transport.eventsApplied)}
          size="sm"
          hint={`${formatInteger(transport.duplicatesDropped)} duplicates dropped`}
        />
        <Metric
          label="WebSocket clients"
          value={formatInteger(status?.webSocketConnections)}
          size="sm"
        />
      </div>

      <Panel title="Service health" subtitle="Probed from the browser's own view of the platform">
        <div className="service-grid">
          {services.map((service) => (
            <div className="service-card" key={service.name} data-tone={STATE_TONE[service.state]}>
              <div className="service-card__head">
                <span style={{ color: 'var(--color-text-muted)' }}>{service.icon}</span>
                <span className="service-card__name">{service.name}</span>
                <StatusBadge
                  tone={STATE_TONE[service.state]}
                  icon={STATE_ICON[service.state]}
                  label={service.state}
                />
              </div>
              <p className="tiny muted" style={{ lineHeight: 1.45 }}>
                {service.detail}
              </p>
              <BasisChip basis={service.basis} />
            </div>
          ))}
        </div>
      </Panel>

      <div className="cc__row">
        <Panel
          title="Transport diagnostics"
          subtitle="What the realtime pipeline has actually observed"
        >
          <div className="kv">
            <span className="kv__k">Connection state</span>
            <span className="kv__v mono">{transport.state}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Detail</span>
            <span className="kv__v">{transport.detail ?? 'â€”'}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Reconnect attempt</span>
            <span className="kv__v num">{transport.attempt}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Last delta received</span>
            <span className="kv__v num">
              {transport.lastEventAt ? formatAge((now - transport.lastEventAt) / 1000) : 'none yet'}
            </span>
          </div>
          <div className="kv">
            <span className="kv__k">Last connected</span>
            <span className="kv__v">{transport.lastConnectAt ? formatTime(new Date(transport.lastConnectAt).toISOString()) : 'â€”'}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Deltas applied</span>
            <span className="kv__v num">{formatInteger(transport.eventsApplied)}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Duplicates suppressed</span>
            <span className="kv__v num">{formatInteger(transport.duplicatesDropped)}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Malformed frames rejected</span>
            <span className="kv__v num">{formatInteger(transport.invalidDropped)}</span>
          </div>
          <p className="note" style={{ marginTop: 'var(--space-3)' }}>
            A configured transport is not a healthy transport. The state above is what this browser session has
            actually observed, not what the deployment was configured with.
          </p>
        </Panel>

        <Panel title="Spring Actuator" subtitle="Backend-reported component health">
          {healthQuery.isLoading ? (
            <LoadingState label="Reading actuator healthâ€¦" rows={3} />
          ) : healthQuery.isError ? (
            <ErrorState
              title="Actuator health unavailable"
              description={toErrorMessage(healthQuery.error, 'The actuator endpoint is not reachable through the gateway.')}
              onRetry={() => void healthQuery.refetch()}
            />
          ) : Object.keys(components).length === 0 ? (
            <EmptyState
              title="No component detail"
              description="Actuator responded without per-component health. Overall status is reported above."
            />
          ) : (
            <div>
              <div className="kv">
                <span className="kv__k">Overall</span>
                <span className="kv__v">
                  <Badge tone={healthQuery.data?.status === 'UP' ? 'ok' : 'crit'}>
                    {healthQuery.data?.status ?? 'UNKNOWN'}
                  </Badge>
                </span>
              </div>
              {Object.entries(components).map(([name, component]) => (
                <div className="kv" key={name}>
                  <span className="kv__k">{name}</span>
                  <span className="kv__v">
                    <Badge tone={component.status === 'UP' ? 'ok' : 'crit'}>{component.status}</Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Data provenance" subtitle="What the numbers in this console actually are">
        <div className="stack">
          <div className="kv">
            <span className="kv__k">Backend-declared data basis</span>
            <span className="kv__v">{(status?.dataBasis ?? []).join(', ') || 'â€”'}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Demo mode</span>
            <span className="kv__v">{status?.demoMode ? 'ON â€” synthetic plant' : 'OFF'}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Telemetry source</span>
            <span className="kv__v mono">{telemetry?.source ?? 'â€”'}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Telemetry basis</span>
            <span className="kv__v">{telemetry?.dataBasis ?? 'â€”'}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Assets defined in the backend</span>
            <span className="kv__v num">{formatInteger(status?.definedMachines)}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Analytics basis</span>
            <span className="kv__v">OBSERVED counts, ESTIMATED throughput and impact figures</span>
          </div>
          <div className="kv">
            <span className="kv__k">Remaining-useful-life unit</span>
            <span className="kv__v">simulator degradation steps â€” never hours or days</span>
          </div>
        </div>
      </Panel>
    </div>
  );
}
