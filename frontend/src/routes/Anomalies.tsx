/**
 * Anomaly Center.
 *
 * The condition signals currently outside normal operating bounds, ranked by
 * how far the model's anomaly score has risen. An anomaly is a model judgement
 * about a sensor pattern, not a confirmed fault.
 */

import { useMemo, useState } from 'react';
import { Radar, Search } from 'lucide-react';
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Metric,
  Panel,
  SectionHeader,
  StatusBadge,
  type Column,
} from '../design-system';
import { useMachines } from '../api/queries';
import { useUiStore } from '../store/ui';
import { anomalyBand, anomalyTone, deriveOperationalState } from '../domain/machineState';
import { DATA_BASIS } from '../domain/basis';
import { formatAge, formatProbability, titleCase } from '../domain/format';
import { useNow } from '../hooks/useNow';
import { toErrorMessage } from '../api/client';
import type { Machine } from '../api/types';

const BANDS = ['ALL', 'ANOMALY', 'ELEVATED', 'LOW'] as const;
type Band = (typeof BANDS)[number];

export default function Anomalies() {
  const machinesQuery = useMachines();
  const openInspector = useUiStore((state) => state.openInspector);
  const now = useNow(3000);
  const [band, setBand] = useState<Band>('ALL');
  const [query, setQuery] = useState('');

  const machines = machinesQuery.data ?? [];

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return machines
      .filter((machine) => {
        const currentBand = anomalyBand(machine.anomalyScore);
        if (band !== 'ALL' && currentBand !== band) return false;
        if (!needle) return true;
        return `${machine.machineId} ${machine.name}`.toLowerCase().includes(needle);
      })
      .sort((a, b) => b.anomalyScore - a.anomalyScore);
  }, [machines, band, query]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const machine of machines) {
      const key = anomalyBand(machine.anomalyScore);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [machines]);

  const columns: Column<Machine>[] = useMemo(
    () => [
      {
        key: 'machine',
        header: 'Asset',
        width: '18%',
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
        key: 'anomaly',
        header: 'Anomaly score',
        align: 'end',
        cell: (machine) => (
          <span className="num" style={{ fontWeight: 600, color: anomalyTone(machine.anomalyScore) === 'crit' ? 'var(--crit-text)' : 'var(--warn-text)' }}>
            {formatProbability(machine.anomalyScore)}
          </span>
        ),
      },
      {
        key: 'band',
        header: 'Band',
        width: '130px',
        cell: (machine) => {
          const currentBand = anomalyBand(machine.anomalyScore);
          return (
            <StatusBadge
              tone={anomalyTone(machine.anomalyScore)}
              icon={<Radar size={11} aria-hidden />}
              label={titleCase(currentBand)}
            />
          );
        },
      },
      {
        key: 'label',
        header: 'Model label',
        width: '130px',
        hideBelow: 'sm',
        cell: (machine) => (
          <Badge tone={machine.anomalyLabel === 'ANOMALY' ? 'crit' : machine.anomalyLabel === 'WATCH' ? 'warn' : 'idle'}>
            {machine.anomalyLabel}
          </Badge>
        ),
      },
      {
        key: 'risk',
        header: 'Failure risk',
        align: 'end',
        hideBelow: 'md',
        cell: (machine) => <span className="num">{formatProbability(machine.failureRisk)}</span>,
      },
      {
        key: 'state',
        header: 'Asset state',
        width: '140px',
        hideBelow: 'md',
        cell: (machine) => {
          const derived = deriveOperationalState(machine, now);
          return (
            <StatusBadge
              tone={derived.descriptor.tone}
              icon={<span className="twin__dot" data-tone={derived.descriptor.tone} aria-hidden />}
              label={derived.descriptor.label}
            />
          );
        },
      },
      {
        key: 'fresh',
        header: 'Reading age',
        align: 'end',
        hideBelow: 'sm',
        cell: (machine) => {
          const derived = deriveOperationalState(machine, now);
          return <span className="tiny muted num">{formatAge(derived.ageSec)}</span>;
        },
      },
    ],
    [now],
  );

  if (machinesQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="Anomalies" description="Condition signals outside the modelled operating envelope" />
        <LoadingState label="Scoring the fleet…" rows={5} />
      </div>
    );
  }

  if (machinesQuery.isError) {
    return (
      <div className="workspace">
        <SectionHeader title="Anomalies" description="Condition signals outside the modelled operating envelope" />
        <ErrorState
          title="Anomaly scoring unavailable"
          description={toErrorMessage(machinesQuery.error)}
          onRetry={() => void machinesQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="workspace">
      <SectionHeader
        title="Anomalies"
        description="Condition signals the model considers outside the normal operating envelope"
        actions={
          <div style={{ position: 'relative' }}>
            <Search
              size={13}
              aria-hidden
              style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-faint)' }}
            />
            <input
              className="field__input"
              style={{ paddingLeft: 28, width: 200 }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search assets…"
              aria-label="Search assets"
            />
          </div>
        }
      />

      <div className="grid grid--metrics">
        <Metric label="Assets scored" value={machines.length} basis={DATA_BASIS.DERIVED} size="sm" />
        <Metric
          label="Anomaly band"
          value={counts.get('ANOMALY') ?? 0}
          tone={(counts.get('ANOMALY') ?? 0) > 0 ? 'crit' : 'ok'}
          basis={DATA_BASIS.PREDICTED}
          size="sm"
          hint="score ≥ 0.70"
        />
        <Metric
          label="Elevated"
          value={counts.get('ELEVATED') ?? 0}
          tone={(counts.get('ELEVATED') ?? 0) > 0 ? 'warn' : 'ok'}
          basis={DATA_BASIS.PREDICTED}
          size="sm"
          hint="score 0.45 – 0.70"
        />
        <Metric label="Within bounds" value={counts.get('LOW') ?? 0} tone="ok" size="sm" hint="score < 0.45" />
      </div>

      <div className="row">
        {BANDS.map((entry) => (
          <button
            key={entry}
            type="button"
            className="lifecycle-chip"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)' }}
            aria-pressed={band === entry}
            onClick={() => setBand(entry)}
          >
            <span className="lifecycle-chip__count" style={{ fontSize: 'var(--text-md)' }}>
              {entry === 'ALL' ? machines.length : (counts.get(entry) ?? 0)}
            </span>
            <span className="lifecycle-chip__label">{titleCase(entry)}</span>
          </button>
        ))}
      </div>

      <Panel title="Anomaly ranking" subtitle="Sorted by model anomaly score" flush>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(machine) => machine.machineId}
          onRowClick={(machine) => openInspector(machine.machineId, 'prediction')}
          caption="Anomaly scoring across the fleet"
          stickyHeader
          maxHeight={560}
          emptyMessage={
            <EmptyState
              icon={<Radar size={20} />}
              title="No assets in this band"
              description="No asset currently scores inside the selected anomaly band."
            />
          }
        />
      </Panel>

      <p className="note">
        An anomaly score comes from an isolation forest trained on the synthetic profile catalog. A high score means
        the current sensor pattern is unusual <em>for this modelled distribution</em> — it does not confirm a physical
        fault, and it carries no false-positive rate guarantee.
      </p>
    </div>
  );
}
