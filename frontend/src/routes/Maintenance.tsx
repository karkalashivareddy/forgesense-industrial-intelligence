/**
 * Maintenance workspace.
 *
 * The backend's work-order lifecycle is authoritative and deliberately
 * smaller than a full CMMS: RECOMMENDED → SCHEDULED → ACTIVE → COMPLETED,
 * plus CANCELLED. This UI renders exactly that contract. It does not
 * fabricate an INVESTIGATING or VALIDATING stage that the server cannot store.
 */

import { useMemo, useState } from 'react';
import { CheckCircle2, LayoutGrid, List, Wrench } from 'lucide-react';
import {
  Badge,
  Button,
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
import {
  useCancelMaintenance,
  useCompleteMaintenance,
  useMaintenance,
  useScheduleMaintenance,
  useStartMaintenance,
} from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { useUiStore } from '../store/ui';
import { formatDateTime, formatDuration, formatProbability, titleCase } from '../domain/format';
import { toErrorMessage } from '../api/client';
import type { MaintenanceRecord, MaintenanceStatus } from '../api/types';

/* Backend contract — see maintenance/domain/MaintenanceStatus.java */
const LIFECYCLE: MaintenanceStatus[] = ['RECOMMENDED', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

const STATUS_TONE: Record<string, 'maint' | 'info' | 'ok' | 'idle' | 'crit' | 'warn'> = {
  RECOMMENDED: 'warn',
  SCHEDULED: 'info',
  ACTIVE: 'maint',
  COMPLETED: 'ok',
  CANCELLED: 'idle',
};

const PRIORITY_TONE: Record<string, 'crit' | 'warn' | 'info' | 'idle'> = {
  URGENT: 'crit',
  HIGH: 'warn',
  MEDIUM: 'info',
  LOW: 'idle',
};

/** The only transitions the backend exposes. */
const NEXT_ACTIONS: Record<MaintenanceStatus, { label: string; action: 'schedule' | 'start' | 'complete' | 'cancel' }[]> = {
  RECOMMENDED: [{ label: 'Schedule', action: 'schedule' }],
  SCHEDULED: [
    { label: 'Start work', action: 'start' },
    { label: 'Cancel', action: 'cancel' },
  ],
  ACTIVE: [
    { label: 'Complete', action: 'complete' },
    { label: 'Cancel', action: 'cancel' },
  ],
  COMPLETED: [],
  CANCELLED: [],
};

export default function Maintenance() {
  const maintenanceQuery = useMaintenance();
  const { identity } = useAuth();
  const openInspector = useUiStore((state) => state.openInspector);

  const [view, setView] = useState<'board' | 'table'>('board');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  const schedule = useScheduleMaintenance();
  const start = useStartMaintenance();
  const complete = useCompleteMaintenance();
  const cancel = useCancelMaintenance();

  const canEdit = identity?.roles.some((role) => role === 'ROLE_ENGINEER' || role === 'ROLE_ADMIN') ?? false;

  const orders = maintenanceQuery.data ?? [];
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const order of orders) map.set(order.status, (map.get(order.status) ?? 0) + 1);
    return map;
  }, [orders]);

  const filtered = useMemo(
    () => (statusFilter === 'ALL' ? orders : orders.filter((order) => order.status === statusFilter)),
    [orders, statusFilter],
  );

  const grouped = useMemo(() => {
    const groups = new Map<MaintenanceStatus, MaintenanceRecord[]>();
    for (const status of LIFECYCLE) groups.set(status, []);
    for (const order of filtered) {
      const list = groups.get(order.status as MaintenanceStatus);
      if (list) list.push(order);
      else groups.get('RECOMMENDED')?.push(order);
    }
    return groups;
  }, [filtered]);

  const totalEffort = filtered.reduce((sum, order) => sum + (order.estimatedDurationMinutes ?? 0), 0);

  const run = async (id: string, action: 'schedule' | 'start' | 'complete' | 'cancel') => {
    setBusyId(id);
    try {
      if (action === 'schedule') await schedule.mutateAsync(id);
      else if (action === 'start') await start.mutateAsync(id);
      else if (action === 'complete') await complete.mutateAsync(id);
      else await cancel.mutateAsync(id);
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<MaintenanceRecord>[] = useMemo(
    () => [
      {
        key: 'priority',
        header: 'Priority',
        width: '110px',
        cell: (order) => <Badge tone={PRIORITY_TONE[order.priority] ?? 'info'}>{order.priority}</Badge>,
      },
      {
        key: 'machine',
        header: 'Asset',
        width: '130px',
        cell: (order) => (
          <button
            type="button"
            className="mono link-button"
            onClick={(event) => {
              event.stopPropagation();
              openInspector(order.machineId, 'maintenance');
            }}
          >
            {order.machineId}
          </button>
        ),
      },
      {
        key: 'title',
        header: 'Work order',
        cell: (order) => (
          <div style={{ minWidth: 0 }}>
            <div className="small">{order.title}</div>
            <div className="tiny muted truncate" title={order.recommendedAction ?? order.description}>
              {order.recommendedAction ?? order.description}
            </div>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Status',
        width: '150px',
        cell: (order) => (
          <StatusBadge
            tone={STATUS_TONE[order.status] ?? 'idle'}
            icon={<Wrench size={11} aria-hidden />}
            label={titleCase(order.status)}
          />
        ),
      },
      {
        key: 'risk',
        header: 'Risk at creation',
        align: 'end',
        hideBelow: 'md',
        cell: (order) => <span className="num">{formatProbability(order.riskAtCreation ?? null)}</span>,
      },
      {
        key: 'effort',
        header: 'Est. effort',
        align: 'end',
        hideBelow: 'sm',
        cell: (order) => <span className="num">{formatDuration(order.estimatedDurationMinutes ?? null)}</span>,
      },
      {
        key: 'created',
        header: 'Created',
        align: 'end',
        hideBelow: 'sm',
        cell: (order) => <span className="tiny muted">{formatDateTime(order.createdAt)}</span>,
      },
      {
        key: 'actions',
        header: 'Action',
        align: 'end',
        width: '190px',
        cell: (order) => (
          <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }} onClick={(event) => event.stopPropagation()}>
            {NEXT_ACTIONS[order.status as MaintenanceStatus]?.map((entry) => (
              <Button
                key={entry.action}
                size="sm"
                variant={entry.action === 'schedule' ? 'primary' : 'ghost'}
                disabled={!canEdit || busyId === order.id}
                loading={busyId === order.id}
                onClick={() => void run(order.id, entry.action)}
                title={canEdit ? entry.label : 'Requires ENGINEER or ADMIN'}
              >
                {entry.label}
              </Button>
            ))}
          </div>
        ),
      },
    ],
    [canEdit, busyId, openInspector],
  );

  if (maintenanceQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="Maintenance" description="Recommended inspections and work orders" />
        <LoadingState label="Loading work orders…" rows={5} />
      </div>
    );
  }

  if (maintenanceQuery.isError) {
    return (
      <div className="workspace">
        <SectionHeader title="Maintenance" description="Recommended inspections and work orders" />
        <ErrorState
          title="Maintenance data unavailable"
          description={toErrorMessage(maintenanceQuery.error)}
          onRetry={() => void maintenanceQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="workspace">
      <SectionHeader
        title="Maintenance"
        description="Work orders the model has recommended, and the actions the backend supports"
        actions={
          <div className="row" style={{ gap: 4 }}>
            <Button
              size="sm"
              variant={view === 'board' ? 'primary' : 'ghost'}
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
            >
              <LayoutGrid size={13} aria-hidden /> Board
            </Button>
            <Button
              size="sm"
              variant={view === 'table' ? 'primary' : 'ghost'}
              aria-pressed={view === 'table'}
              onClick={() => setView('table')}
            >
              <List size={13} aria-hidden /> Table
            </Button>
          </div>
        }
      />

      <div className="grid grid--metrics">
        {LIFECYCLE.map((status) => (
          <Metric
            key={status}
            label={titleCase(status)}
            value={counts.get(status) ?? 0}
            size="sm"
            tone={
              status === 'ACTIVE' ? 'maint' : status === 'RECOMMENDED' ? 'warn' : status === 'COMPLETED' ? 'ok' : 'neutral'
            }
          />
        ))}
        <Metric label="Est. effort in view" value={formatDuration(totalEffort)} size="sm" hint="model estimate" />
      </div>

      <div className="row">
        <Button
          size="sm"
          variant={statusFilter === 'ALL' ? 'primary' : 'ghost'}
          aria-pressed={statusFilter === 'ALL'}
          onClick={() => setStatusFilter('ALL')}
        >
          All statuses
        </Button>
        {LIFECYCLE.map((status) => (
          <Button
            key={status}
            size="sm"
            variant={statusFilter === status ? 'primary' : 'ghost'}
            aria-pressed={statusFilter === status}
            onClick={() => setStatusFilter(statusFilter === status ? 'ALL' : status)}
          >
            {titleCase(status)}
          </Button>
        ))}
      </div>

      {orders.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<Wrench size={20} />}
            title="No work orders"
            description="A recommendation is created automatically when the model's failure risk crosses the backend's maintenance threshold. Nothing has crossed it yet."
          />
        </Panel>
      ) : view === 'table' ? (
        <Panel title="Work order register" subtitle={`${filtered.length} work orders`} flush>
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(order) => order.id}
            onRowClick={(order) => openInspector(order.machineId, 'maintenance')}
            caption="Maintenance work order register"
            stickyHeader
            maxHeight={600}
          />
        </Panel>
      ) : (
        <div className="board">
          {LIFECYCLE.map((status) => {
            const items = grouped.get(status) ?? [];
            return (
              <section className="board__column" key={status} aria-label={`${titleCase(status)} work orders`}>
                <header className="board__head">
                  <StatusBadge
                    tone={STATUS_TONE[status] ?? 'idle'}
                    icon={<span className="twin__dot" data-tone={STATUS_TONE[status] ?? 'idle'} aria-hidden />}
                    label={titleCase(status)}
                  />
                  <span className="tiny muted">{items.length}</span>
                </header>
                <div className="board__body">
                  {items.length === 0 ? (
                    <p className="empty-inline">No work orders</p>
                  ) : (
                    items.map((order) => (
                      <article className="work-card" key={order.id}>
                        <div className="row" style={{ gap: 4 }}>
                          <Badge tone={PRIORITY_TONE[order.priority] ?? 'info'}>{order.priority}</Badge>
                          <button
                            type="button"
                            className="mono link-button tiny"
                            onClick={() => openInspector(order.machineId, 'maintenance')}
                          >
                            {order.machineId}
                          </button>
                        </div>
                        <h3 className="work-card__title">{order.title}</h3>
                        {order.recommendedAction && <p className="work-card__text">{order.recommendedAction}</p>}
                        <div className="work-card__meta">
                          <span title="Estimated duration">{formatDuration(order.estimatedDurationMinutes ?? null)}</span>
                          <span title="Failure risk when the work order was raised">
                            {formatProbability(order.riskAtCreation ?? null)}
                          </span>
                          <span title="Created">{formatDateTime(order.createdAt)}</span>
                        </div>
                        <div className="row" style={{ gap: 4, marginTop: 'var(--space-2)' }}>
                          {NEXT_ACTIONS[status]?.map((entry) => (
                            <Button
                              key={entry.action}
                              size="sm"
                              variant={entry.action === 'schedule' ? 'primary' : 'ghost'}
                              disabled={!canEdit || busyId === order.id}
                              onClick={() => void run(order.id, entry.action)}
                            >
                              {entry.action === 'complete' && <CheckCircle2 size={12} aria-hidden />}
                              {entry.label}
                            </Button>
                          ))}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="note">
        Durations are model estimates, not measured labour. The lifecycle shown here is exactly the backend contract:
        a work order is recommended, scheduled, started, completed, or cancelled. No stage is shown that the server
        cannot store.
      </p>
    </div>
  );
}
