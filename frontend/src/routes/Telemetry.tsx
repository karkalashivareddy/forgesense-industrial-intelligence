/**
 * Telemetry workspace.
 *
 * Condition monitoring for a single asset across every sensor the backend
 * actually reports. The sensor list is derived from data, not hardcoded, so a
 * machine type that carries different instruments simply shows a different set.
 */

import { useEffect, useMemo, useState } from 'react';
import { Activity, Radio } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  SectionHeader,
  Sparkline,
  StatusBadge,
} from '../design-system';
import { useMachine, useMachineTelemetry, useMachines, useTelemetryStatus } from '../api/queries';
import { useLiveReading, useTelemetryStore } from '../realtime/store';
import { useUiStore } from '../store/ui';
import { deriveOperationalState } from '../domain/machineState';
import { DATA_BASIS, resolveBasis } from '../domain/basis';
import { SENSOR_UNITS, type SensorKey } from '../api/types';
import { EM_DASH, formatAge, formatNumber, formatTime, formatTimeShort } from '../domain/format';
import { useNow } from '../hooks/useNow';
import { toErrorMessage } from '../api/client';

const WINDOWS = [
  { label: '30', limit: 30 },
  { label: '60', limit: 60 },
  { label: '120', limit: 120 },
  { label: '300', limit: 300 },
] as const;

export default function Telemetry() {
  const machinesQuery = useMachines();
  const selectedMachineId = useUiStore((state) => state.selectedMachineId);
  const openInspector = useUiStore((state) => state.openInspector);
  const [machineId, setMachineId] = useState<string>(selectedMachineId ?? 'M-101');
  const [limit, setLimit] = useState(120);

  const telemetryQuery = useMachineTelemetry(machineId, limit);
  const machineQuery = useMachine(machineId);
  const statusQuery = useTelemetryStatus();
  const live = useLiveReading(machineId);
  const watch = useTelemetryStore((state) => state.watch);
  const unwatch = useTelemetryStore((state) => state.unwatch);

  const now = useNow(2000);

  // Retain a bounded live ring only while this workspace is open.
  useEffect(() => {
    watch(machineId);
    return () => unwatch(machineId);
  }, [machineId, watch, unwatch]);

  const rows = telemetryQuery.data?.rows ?? [];

  const sensors = useMemo(() => {
    const keys = new Set<string>();
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'number' && key in SENSOR_UNITS) keys.add(key);
      }
    }
    if (live) for (const key of Object.keys(live.values)) if (key in SENSOR_UNITS) keys.add(key);
    return Array.from(keys).sort() as SensorKey[];
  }, [rows, live]);

  const series = useMemo(() => {
    const map = new Map<string, { t: number; v: number }[]>();
    for (const row of rows) {
      const time = Date.parse(row.timestamp);
      if (Number.isNaN(time)) continue;
      for (const [key, value] of Object.entries(row)) {
        if (typeof value !== 'number' || !(key in SENSOR_UNITS)) continue;
        const list = map.get(key) ?? [];
        list.push({ t: time, v: value });
        map.set(key, list);
      }
    }
    return map;
  }, [rows]);

  const derived = deriveOperationalState(machineQuery.data ?? null, now);
  const basis = resolveBasis(statusQuery.data?.dataBasis);

  if (machinesQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="Telemetry" description="Live condition monitoring per asset" />
        <LoadingState label="Loading the fleetâ€¦" rows={4} />
      </div>
    );
  }

  return (
    <div className="workspace">
      <SectionHeader
        title="Telemetry"
        description="Live sensor values per asset, with trend and freshness"
        actions={
          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <select
              className="field__select"
              style={{ width: 'auto', minWidth: 190 }}
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
              aria-label="Select asset"
            >
              {(machinesQuery.data ?? []).map((machine) => (
                <option key={machine.machineId} value={machine.machineId}>
                  {machine.machineId} Â· {machine.name}
                </option>
              ))}
            </select>
            <div className="row" style={{ gap: 2 }} role="group" aria-label="Time window">
              {WINDOWS.map((window) => (
                <Button
                  key={window.label}
                  size="sm"
                  variant={limit === window.limit ? 'primary' : 'ghost'}
                  aria-pressed={limit === window.limit}
                  onClick={() => setLimit(window.limit)}
                >
                  {window.label}
                </Button>
              ))}
            </div>
            <Button size="sm" onClick={() => openInspector(machineId, 'telemetry')}>
              Open inspector
            </Button>
          </div>
        }
      />

      <div className="grid grid--metrics">
        <Metric
          label="Readings in window"
          value={rows.length}
          size="sm"
          basis={DATA_BASIS.OBSERVED}
        />
        <Metric
          label="Latest reading"
          value={<span style={{ fontSize: 'var(--text-md)' }}>{formatTime(rows[rows.length - 1]?.timestamp ?? null)}</span>}
          size="sm"
        />
        <Metric
          label="Data age"
          value={<span style={{ fontSize: 'var(--text-md)' }}>{formatAge(derived.ageSec)}</span>}
          tone={derived.isStale ? 'warn' : 'ok'}
          size="sm"
        />
        <Metric
          label="Live packets"
          value={live ? formatAge((Date.now() - live.receivedAt) / 1000) : 'â€”'}
          size="sm"
          hint={live ? 'most recent delta' : 'no delta in this session'}
        />
        <Metric
          label="Feed rate"
          value={statusQuery.data?.telemetryPerMinute ?? 'â€”'}
          unit="/min"
          basis={basis}
          size="sm"
        />
      </div>

      {derived.isStale && (
        <div className="stale-banner" role="status">
          <Activity size={14} aria-hidden />
          <span>Showing the last known telemetry for {machineId} from {formatAge(derived.ageSec)}.</span>
        </div>
      )}

      {telemetryQuery.isLoading ? (
        <LoadingState label="Loading telemetry historyâ€¦" rows={4} />
      ) : telemetryQuery.isError ? (
        <ErrorState
          title="Telemetry unavailable"
          description={toErrorMessage(telemetryQuery.error, 'The backend did not return telemetry for this asset.')}
          onRetry={() => void telemetryQuery.refetch()}
          retrying={telemetryQuery.isFetching}
        />
      ) : rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Radio size={20} />}
            title={`No telemetry available for ${machineId}`}
            description="The simulator has not produced a reading for this asset in the selected window. Check System for feed health, or widen the time window."
            action={
              <Button size="sm" onClick={() => setLimit(300)}>
                Widen to 300 readings
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <Panel
            title={`${machineId} Â· sensor readings`}
            subtitle={
              machineQuery.data
                ? `${machineQuery.data.name} Â· ${machineQuery.data.typeLabel} Â· ${sensors.length} instrument${sensors.length === 1 ? '' : 's'}`
                : `${sensors.length} instrument${sensors.length === 1 ? '' : 's'}`
            }
            actions={
              machineQuery.data && (
                <StatusBadge
                  tone={derived.descriptor.tone}
                  icon={<span className="twin__dot" data-tone={derived.descriptor.tone} aria-hidden />}
                  label={derived.descriptor.label}
                />
              )
            }
          >
            <div className="grid grid--3">
              {sensors.map((key) => {
                const meta = SENSOR_UNITS[key];
                const points = series.get(key) ?? [];
                const values = points.map((point) => point.v);
                const latest = values.length > 0 ? (values[values.length - 1] ?? null) : null;
                const first = values.length > 0 ? (values[0] ?? null) : null;
                const delta = latest !== null && first !== null ? latest - first : null;
                const tone = trendTone(latest, values);

                return (
                  <div className="metric metric--sm" key={key}>
                    <div className="metric__label">{meta.label}</div>
                    <div className="metric__value" style={tone !== 'ok' ? { color: 'var(--color-warning-text)' } : undefined}>
                      {latest === null ? EM_DASH : formatNumber(latest, precision(key))}
                      <span className="metric__unit">{meta.unit}</span>
                    </div>
                    <div className="metric__foot">
                      <span className="metric__hint">
                        {delta === null ? 'no trend' : `${delta > 0 ? '+' : ''}${formatNumber(delta, precision(key))} over window`}
                      </span>
                      <Badge tone="info">SYNTHETIC</Badge>
                    </div>
                    {values.length > 1 && (
                      <div style={{ marginTop: 'var(--space-2)' }}>
                        <Sparkline values={values} label={`${meta.label} trend`} tone={tone === 'ok' ? 'info' : 'warn'} width={200} height={30} />
                      </div>
                    )}
                    <p className="tiny muted" style={{ marginTop: 4 }}>
                      first {formatTimeShort(points[0] ? new Date(points[0].t).toISOString() : null)} Â· last{' '}
                      {formatTimeShort(lastPointIso(points))}
                    </p>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Provenance" subtitle="What these values are and are not">
            <p className="note">
              Values are produced by the synthetic telemetry simulator at roughly 5-second intervals and pushed through
              the backend's ingest pipeline. They are not measurements from physical instrumentation. The backend
              reports a data basis of <strong>{basis}</strong> for this feed.
            </p>
            <p className="note">
              No normal operating range is asserted for any sensor. The machine profiles are modelled baselines used
              to generate the feed, not surveyed specifications, so a reading cannot be judged in or out of tolerance
              from this console alone.
            </p>
          </Panel>
        </>
      )}
    </div>
  );
}

function lastPointIso(points: { t: number; v: number }[]): string | null {
  const last = points[points.length - 1];
  return last ? new Date(last.t).toISOString() : null;
}

function precision(key: SensorKey): number {
  return key === 'rpm' || key === 'frequency' ? 0 : 2;
}

function trendTone(latest: number | null, values: number[]): 'ok' | 'warn' {
  if (latest === null || values.length < 4) return 'ok';
  const slice = values.slice(-Math.min(values.length, 20));
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
  const variance = slice.reduce((sum, value) => sum + (value - mean) ** 2, 0) / slice.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 'ok';
  // Only flag a genuine excursion, not ordinary noise.
  return Math.abs(latest - mean) > 3 * std ? 'warn' : 'ok';
}
