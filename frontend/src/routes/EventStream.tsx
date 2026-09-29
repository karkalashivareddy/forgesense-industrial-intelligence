/**
 * Event stream â€” the unified operational timeline.
 *
 * Every event the backend records, filterable by type and asset. This is the
 * "what changed" surface for an incident review.
 */

import { useMemo, useState } from 'react';
import { ListTree, Search } from 'lucide-react';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  SectionHeader,
  Timeline,
  type TimelineEntry,
} from '../design-system';
import { useEventFrequency, useEvents, useMachines } from '../api/queries';
import { useUiStore } from '../store/ui';
import { EVENT_TYPES } from '../api/types';
import { DATA_BASIS } from '../domain/basis';
import { formatDateTime, formatInteger } from '../domain/format';
import { toErrorMessage } from '../api/client';

const FILTERS = [
  { id: 'ALL', label: 'All events' },
  { id: 'ALERT', label: 'Alerts' },
  { id: 'MACHINE', label: 'State changes' },
  { id: 'PREDICTION', label: 'Predictions' },
  { id: 'MAINTENANCE', label: 'Maintenance' },
  { id: 'SIMULATION', label: 'Simulation' },
  { id: 'TELEMETRY', label: 'Telemetry' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

const GROUPS: Record<FilterId, string[]> = {
  ALL: [],
  ALERT: ['ALERT_CREATED', 'ALERT_ACKNOWLEDGED', 'ALERT_INVESTIGATING', 'ALERT_RESOLVED'],
  MACHINE: ['MACHINE_STATE_CHANGED', 'MACHINE_OFFLINE', 'MACHINE_RECOVERED', 'ANOMALY_DETECTED'],
  PREDICTION: ['PREDICTION_UPDATED', 'FAILURE_RISK_CHANGED'],
  MAINTENANCE: ['MAINTENANCE_CREATED', 'MAINTENANCE_STARTED', 'MAINTENANCE_COMPLETED'],
  SIMULATION: ['SIMULATION_STARTED', 'SIMULATION_COMPLETED'],
  TELEMETRY: ['TELEMETRY_RECEIVED', 'TELEMETRY_NORMALIZED'],
};

function eventTone(type: string): 'crit' | 'warn' | 'info' | 'ok' | 'maint' | 'neutral' {
  if (type.startsWith('ALERT')) return 'warn';
  if (type === 'MACHINE_OFFLINE') return 'crit';
  if (type === 'MACHINE_RECOVERED') return 'ok';
  if (type.startsWith('MAINTENANCE')) return 'maint';
  if (type.startsWith('SIMULATION')) return 'maint';
  if (type.startsWith('PREDICTION') || type === 'ANOMALY_DETECTED') return 'info';
  return 'neutral';
}

export default function EventStream() {
  const eventsQuery = useEvents();
  const frequencyQuery = useEventFrequency();
  const machinesQuery = useMachines();
  const openInspector = useUiStore((state) => state.openInspector);

  const [filter, setFilter] = useState<FilterId>('ALL');
  const [machineId, setMachineId] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  const entries = eventsQuery.data?.items ?? [];
  const needle = query.trim().toLowerCase();
  const allowed = GROUPS[filter];

  const filtered = useMemo(
    () =>
      entries.filter((entry) => {
        if (allowed.length > 0 && !allowed.includes(String(entry.eventType))) return false;
        if (machineId !== 'ALL' && entry.machineId !== machineId) return false;
        if (!needle) return true;
        return `${entry.eventType} ${entry.detail} ${entry.machineId ?? ''} ${entry.source}`
          .toLowerCase()
          .includes(needle);
      }),
    [entries, filter, machineId, needle],
  );

  const timeline: TimelineEntry[] = filtered.map((entry) => ({
    id: String(entry.id),
    timestamp: formatDateTime(entry.eventTime),
    title: (
      <span className="row" style={{ gap: 'var(--space-2)' }}>
        <Badge tone={eventTone(String(entry.eventType))}>{String(entry.eventType).replace(/_/g, ' ')}</Badge>
        {entry.detail}
      </span>
    ),
    description: (
      <span className="row" style={{ gap: 'var(--space-2)' }}>
        <span>source: {entry.source}</span>
        {entry.machineId && (
          <button
            type="button"
            className="mono link-button tiny"
            onClick={() => openInspector(entry.machineId as string, 'events')}
          >
            {entry.machineId}
          </button>
        )}
      </span>
    ),
    tone: eventTone(String(entry.eventType)),
  }));

  if (eventsQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="Event Stream" description="Unified operational timeline" />
        <LoadingState label="Loading the timelineâ€¦" rows={6} />
      </div>
    );
  }

  if (eventsQuery.isError) {
    return (
      <div className="workspace">
        <SectionHeader title="Event Stream" description="Unified operational timeline" />
        <ErrorState
          title="Event stream unavailable"
          description={toErrorMessage(eventsQuery.error)}
          onRetry={() => void eventsQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="workspace">
      <SectionHeader
        title="Event Stream"
        description="Unified operational timeline as recorded by the backend"
        actions={
          <div style={{ position: 'relative' }}>
            <Search
              size={13}
              aria-hidden
              style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-disabled)' }}
            />
            <input
              className="field__input"
              style={{ paddingLeft: 28, width: 210 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search eventsâ€¦"
              aria-label="Search events"
            />
          </div>
        }
      />

      <div className="grid grid--metrics">
        <Metric label="Events in register" value={formatInteger(eventsQuery.data?.count ?? 0)} size="sm" basis={DATA_BASIS.OBSERVED} />
        <Metric label="Showing" value={formatInteger(filtered.length)} size="sm" hint="after filters" />
        <Metric
          label="Telemetry events"
          value={formatInteger(frequencyQuery.data?.telemetry)}
          size="sm"
          hint="since the register was created"
        />
        <Metric
          label="Alerts recorded"
          value={formatInteger(frequencyQuery.data?.alerts)}
          size="sm"
        />
        <Metric
          label="Event types"
          value={EVENT_TYPES.length}
          size="sm"
          hint="canonical backend vocabulary"
        />
      </div>

      <div className="row">
        {FILTERS.map((entry) => (
          <Button
            key={entry.id}
            size="sm"
            variant={filter === entry.id ? 'primary' : 'ghost'}
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
        <select
          className="field__select"
          style={{ width: 'auto', minWidth: 150 }}
          value={machineId}
          onChange={(event) => setMachineId(event.target.value)}
          aria-label="Filter by asset"
        >
          <option value="ALL">All assets</option>
          {(machinesQuery.data ?? []).map((machine) => (
            <option key={machine.machineId} value={machine.machineId}>
              {machine.machineId} Â· {machine.name}
            </option>
          ))}
        </select>
      </div>

      <Panel
        title="Timeline"
        subtitle={
          filtered.length === entries.length
            ? `${entries.length} most recent events`
            : `${filtered.length} of ${entries.length} events match`
        }
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<ListTree size={20} />}
            title="No events match these filters"
            description="Nothing has been recorded matching the current selection. This is a quiet period, not a failure."
            action={
              <Button
                size="sm"
                onClick={() => {
                  setFilter('ALL');
                  setMachineId('ALL');
                  setQuery('');
                }}
              >
                Reset filters
              </Button>
            }
          />
        ) : (
          <Timeline entries={timeline} />
        )}
      </Panel>

      <p className="note">
        The backend returns the most recent {entries.length} events. Counts in the tiles above come from the analytics
        event-frequency endpoint, which counts the whole register and therefore exceeds the window shown here. Event
        types are the backend's canonical vocabulary ({EVENT_TYPES.length} types), not a frontend invention.
      </p>
    </div>
  );
}
