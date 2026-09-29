/**
 * Fleet view â€” the sortable, filterable asset register.
 *
 * This is the tabular counterpart to the twin, and the primary surface for
 * "show me everything that matches this condition".
 */

import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  SectionHeader,
  StatusBadge,
  type Column,
} from '../design-system';
import { useMachines, useZones } from '../api/queries';
import { useUiStore, type InspectorTab } from '../store/ui';
import { deriveOperationalState, type OperationalState } from '../domain/machineState';
import { formatAge, formatProbability, formatRulSteps, titleCase } from '../domain/format';
import { useNow } from '../hooks/useNow';
import { toErrorMessage } from '../api/client';
import type { Machine } from '../api/types';

type Filter = 'ALL' | 'ATTENTION' | OperationalState;

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'ATTENTION', label: 'Needs attention' },
  { id: 'CRITICAL', label: 'Critical' },
  { id: 'WARNING', label: 'Warning' },
  { id: 'DEGRADED', label: 'Degraded' },
  { id: 'MAINTENANCE', label: 'Maintenance' },
  { id: 'STALE', label: 'Stale' },
  { id: 'OFFLINE', label: 'Offline' },
];

export default function Fleet() {
  const machinesQuery = useMachines();
  const zonesQuery = useZones();
  const now = useNow(3000);

  const selectedMachineId = useUiStore((state) => state.selectedMachineId);
  const openInspector = useUiStore((state) => state.openInspector);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [zone, setZone] = useState<string>('ALL');
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>({
    key: 'risk',
    direction: 'desc',
  });

  const rows = useMemo(() => {
    const machines = machinesQuery.data ?? [];
    const needle = query.trim().toLowerCase();

    const filtered = machines.filter((machine) => {
      const derived = deriveOperationalState(machine, now);
      if (needle && !`${machine.machineId} ${machine.name} ${machine.typeLabel}`.toLowerCase().includes(needle)) {
        return false;
      }
      if (zone !== 'ALL' && machine.zone !== zone) return false;
      if (filter === 'ALL') return true;
      if (filter === 'ATTENTION') {
        return ['CRITICAL', 'WARNING', 'DEGRADED', 'STALE', 'OFFLINE'].includes(derived.state);
      }
      return derived.state === filter;
    });

    const sorted = filtered.slice();
    sorted.sort((a, b) => {
      const key = sort?.key ?? 'risk';
      const direction = sort?.direction === 'asc' ? 1 : -1;
      switch (key) {
        case 'id':
          return direction * a.machineId.localeCompare(b.machineId);
        case 'health':
          return direction * (a.healthScore - b.healthScore);
        case 'anomaly':
          return direction * (a.anomalyScore - b.anomalyScore);
        case 'rul':
          return direction * (a.rulEstimate - b.rulEstimate);
        case 'name':
          return direction * a.name.localeCompare(b.name);
        case 'state':
          return direction * deriveOperationalState(a, now).state.localeCompare(deriveOperationalState(b, now).state);
        default:
          return direction * (a.failureRisk - b.failureRisk);
      }
    });
    return sorted;
  }, [machinesQuery.data, query, filter, zone, sort, now]);

  const columns: Column<Machine>[] = useMemo(
    () => [
      {
        key: 'id',
        header: 'Asset',
        width: '16%',
        sortable: true,
        cell: (machine) => (
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontWeight: 600 }}>
              {machine.machineId}
            </div>
            <div className="tiny muted truncate">{machine.name}</div>
          </div>
        ),
      },
      {
        key: 'state',
        header: 'State',
        sortable: true,
        cell: (machine) => {
          const derived = deriveOperationalState(machine, now);
          return (
            <StatusBadge
              tone={derived.descriptor.tone}
              icon={<span className="twin__dot" data-tone={derived.descriptor.tone} aria-hidden />}
              label={derived.descriptor.label}
              title={derived.descriptor.guidance}
            />
          );
        },
      },
      {
        key: 'health',
        header: 'Health',
        align: 'end',
        sortable: true,
        hideBelow: 'sm',
        cell: (machine) => (
          <span className="num" title="Model-computed health score, 0â€“100">
            {machine.healthScore.toFixed(1)}
          </span>
        ),
      },
      {
        key: 'risk',
        header: 'Failure risk',
        align: 'end',
        sortable: true,
        cell: (machine) => (
          <span className="num" style={{ color: 'var(--color-intelligence-text)' }} title="Model-estimated failure probability">
            {formatProbability(machine.failureRisk)}
          </span>
        ),
      },
      {
        key: 'anomaly',
        header: 'Anomaly',
        align: 'end',
        sortable: true,
        hideBelow: 'md',
        cell: (machine) => (
          <span className="num" title="Isolation-forest anomaly score">
            {formatProbability(machine.anomalyScore)}
          </span>
        ),
      },
      {
        key: 'rul',
        header: 'Est. remaining',
        align: 'end',
        sortable: true,
        hideBelow: 'md',
        cell: (machine) => (
          <span className="num" title="Simulator degradation steps remaining. Not hours or days.">
            {formatRulSteps(machine.rulEstimate)}
          </span>
        ),
      },
      {
        key: 'mode',
        header: 'Mode',
        hideBelow: 'lg',
        cell: (machine) => (
          <Badge tone={machine.modelMode === 'MODEL' ? 'info' : 'warn'}>
            {machine.modelMode === 'MODEL' ? 'ML' : 'Heuristic'}
          </Badge>
        ),
      },
      {
        key: 'zone',
        header: 'Zone',
        hideBelow: 'lg',
        cell: (machine) => <span className="small">{titleCase(machine.zone)}</span>,
      },
      {
        key: 'fresh',
        header: 'Last reading',
        align: 'end',
        hideBelow: 'sm',
        cell: (machine) => {
          const derived = deriveOperationalState(machine, now);
          return (
            <span className="tiny muted num" title={machine.lastTelemetryAt ?? 'never reported'}>
              {formatAge(derived.ageSec)}
            </span>
          );
        },
      },
    ],
    [now],
  );

  if (machinesQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="Fleet" description="Every registered asset and its current condition" />
        <LoadingState label="Loading the fleetâ€¦" rows={6} />
      </div>
    );
  }

  if (machinesQuery.isError) {
    return (
      <div className="workspace">
        <SectionHeader title="Fleet" description="Every registered asset and its current condition" />
        <ErrorState
          title="Fleet snapshot unavailable"
          description={toErrorMessage(machinesQuery.error)}
          onRetry={() => void machinesQuery.refetch()}
          retrying={machinesQuery.isFetching}
        />
      </div>
    );
  }

  return (
    <div className="workspace">
      <SectionHeader
        title="Fleet"
        description={`${machinesQuery.data?.length ?? 0} assets Â· select a row to open the machine inspector`}
        actions={
          <div style={{ position: 'relative' }}>
            <Search
              size={13}
              aria-hidden
              style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-disabled)' }}
            />
            <input
              className="field__input"
              style={{ paddingLeft: 28, width: 220 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search assetsâ€¦"
              aria-label="Search assets by id or name"
            />
          </div>
        }
      />

      <div className="row">
        <span className="tiny muted row" style={{ gap: 4 }}>
          <SlidersHorizontal size={12} aria-hidden />
          Filter
        </span>
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
          className="field__input"
          style={{ width: 'auto', minWidth: 130 }}
          value={zone}
          onChange={(event) => setZone(event.target.value)}
          aria-label="Filter by zone"
        >
          <option value="ALL">All zones</option>
          {(zonesQuery.data ?? []).map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>

      <Panel
        title="Asset register"
        subtitle={
          rows.length === (machinesQuery.data?.length ?? 0)
            ? 'All assets'
            : `${rows.length} of ${machinesQuery.data?.length ?? 0} assets match the current filter`
        }
        flush
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(machine) => machine.machineId}
          selectedKey={selectedMachineId}
          onRowClick={(machine) => openInspector(machine.machineId, 'overview' as InspectorTab)}
          caption="Fleet asset register with health, predicted risk and telemetry freshness"
          sort={sort}
          onSortChange={(key) =>
            setSort((current) =>
              current?.key === key
                ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
                : { key, direction: 'desc' },
            )
          }
          stickyHeader
          maxHeight={560}
          emptyMessage={
            <EmptyState
              title="No assets match these filters"
              description="Try clearing the search term or selecting a different state filter."
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setQuery('');
                    setFilter('ALL');
                    setZone('ALL');
                  }}
                >
                  Reset filters
                </Button>
              }
            />
          }
        />
      </Panel>
    </div>
  );
}
