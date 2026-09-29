/**
 * Alert Center.
 *
 * An industrial alarm experience, not a notification list. The lifecycle is
 * the backend's own contract â€” NEW â†’ ACKNOWLEDGED â†’ INVESTIGATING â†’ RESOLVED
 * â€” and the UI only offers transitions the signed-in role is allowed to make.
 * The backend re-authorises every call regardless.
 */

import { useMemo, useState } from 'react';
import { AlertOctagon, CheckCircle2, Filter, Search } from 'lucide-react';
import {
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
import {
  canActOnAlert,
  useAcknowledgeAlert,
  useAlerts,
  useInvestigateAlert,
  useResolveAlert,
} from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { useUiStore } from '../store/ui';
import { formatAge, formatDateTime, formatProbability, titleCase } from '../domain/format';
import { useNow } from '../hooks/useNow';
import { toErrorMessage } from '../api/client';
import type { Alert, AlertStatus } from '../api/types';

/* The canonical backend alert lifecycle. No other values are ever sent. */
const LIFECYCLE: AlertStatus[] = ['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'];

const SEVERITY_TONE: Record<string, 'crit' | 'warn' | 'info'> = {
  CRITICAL: 'crit',
  WARNING: 'warn',
  INFO: 'info',
};

const STATUS_TONE: Record<string, 'crit' | 'warn' | 'info' | 'ok'> = {
  NEW: 'crit',
  ACKNOWLEDGED: 'warn',
  INVESTIGATING: 'info',
  RESOLVED: 'ok',
};

export default function Alerts() {
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const now = useNow(10_000);

  const alertsQuery = useAlerts(statusFilter === 'ALL' ? undefined : statusFilter);
  const { identity } = useAuth();
  const openInspector = useUiStore((state) => state.openInspector);
  const pushToast = useUiStore((state) => state.pushToast);

  const acknowledge = useAcknowledgeAlert();
  const investigate = useInvestigateAlert();
  const resolve = useResolveAlert();
  const [busyId, setBusyId] = useState<string | null>(null);

  const role = identity?.roles.find((r) => r === 'ROLE_ADMIN') ?? identity?.roles[0];

  const rows = useMemo(() => {
    const items = alertsQuery.data?.items ?? [];
    const needle = query.trim().toLowerCase();
    return items.filter((alert) => {
      if (severityFilter !== 'ALL' && alert.severity !== severityFilter) return false;
      if (!needle) return true;
      return `${alert.machineId} ${alert.headline} ${alert.type} ${alert.description}`
        .toLowerCase()
        .includes(needle);
    });
  }, [alertsQuery.data, severityFilter, query]);

  const counts = useMemo(() => {
    const items = alertsQuery.data?.items ?? [];
    const byStatus = new Map<string, number>();
    const bySeverity = new Map<string, number>();
    for (const alert of items) {
      byStatus.set(alert.status, (byStatus.get(alert.status) ?? 0) + 1);
      bySeverity.set(alert.severity, (bySeverity.get(alert.severity) ?? 0) + 1);
    }
    return { byStatus, bySeverity, total: items.length };
  }, [alertsQuery.data]);

  const act = async (alert: Alert, action: 'acknowledge' | 'investigate' | 'resolve') => {
    setBusyId(alert.id);
    try {
      if (action === 'acknowledge') await acknowledge.mutateAsync(alert.id);
      else if (action === 'investigate') await investigate.mutateAsync(alert.id);
      else await resolve.mutateAsync(alert.id);
    } catch (error) {
      // A refusal is an operational event, not a stack trace: the backend is
      // the authority and the operator needs to know why nothing happened.
      pushToast('crit', toErrorMessage(error, 'The backend refused that transition.'));
    } finally {
      setBusyId(null);
    }
  };

  const columns: Column<Alert>[] = useMemo(
    () => [
      {
        key: 'severity',
        header: 'Severity',
        width: '110px',
        cell: (alert) => (
          <StatusBadge
            tone={SEVERITY_TONE[alert.severity] ?? 'info'}
            icon={<AlertOctagon size={11} aria-hidden />}
            label={alert.severity}
          />
        ),
      },
      {
        key: 'machine',
        header: 'Asset',
        width: '130px',
        cell: (alert) => (
          <button
            type="button"
            className="mono link-button"
            onClick={(event) => {
              event.stopPropagation();
              openInspector(alert.machineId, 'alerts');
            }}
          >
            {alert.machineId}
          </button>
        ),
      },
      {
        key: 'headline',
        header: 'Condition',
        // A hard width cap is what keeps the severity, status and action
        // columns on screen. Without it the description text expands the
        // table past the viewport and the actions become unreachable.
        width: '32%',
        cell: (alert) => (
          <div className="alert-condition">
            <div className="small alert-condition__headline">{alert.headline}</div>
            <div className="tiny muted alert-condition__detail" title={alert.description}>
              {alert.description}
            </div>
          </div>
        ),
      },
      {
        key: 'type',
        header: 'Type',
        hideBelow: 'lg',
        cell: (alert) => <span className="tiny mono">{alert.type}</span>,
      },
      {
        key: 'risk',
        header: 'Risk at creation',
        align: 'end',
        hideBelow: 'md',
        cell: (alert) => <span className="num">{formatProbability(alert.riskAtCreation ?? null)}</span>,
      },
      {
        key: 'opened',
        header: 'First seen',
        align: 'end',
        hideBelow: 'sm',
        cell: (alert) => (
          <span className="tiny muted" title={formatDateTime(alert.openedAt)}>
            {formatDateTime(alert.openedAt)}
          </span>
        ),
      },
      {
        key: 'duration',
        header: 'Duration',
        align: 'end',
        hideBelow: 'sm',
        cell: (alert) => {
          const ms = now - Date.parse(alert.openedAt);
          return <span className="tiny num">{Number.isNaN(ms) ? 'â€”' : formatAge(ms / 1000)}</span>;
        },
      },
      {
        key: 'status',
        header: 'Lifecycle',
        width: '140px',
        cell: (alert) => (
          <span className="lifecycle-chip" data-lifecycle={alert.status}>
            {titleCase(alert.status)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Action',
        align: 'end',
        width: '230px',
        cell: (alert) => (
          <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }} onClick={(event) => event.stopPropagation()}>
            {alert.status === 'NEW' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canActOnAlert(role, 'acknowledge') || busyId === alert.id}
                loading={busyId === alert.id && acknowledge.isPending}
                onClick={() => void act(alert, 'acknowledge')}
                title={canActOnAlert(role, 'acknowledge') ? 'Acknowledge this alert' : 'Requires OPERATOR, ENGINEER or ADMIN'}
              >
                <CheckCircle2 size={12} aria-hidden /> Ack
              </Button>
            )}
            {(alert.status === 'NEW' || alert.status === 'ACKNOWLEDGED') && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canActOnAlert(role, 'investigate') || busyId === alert.id}
                onClick={() => void act(alert, 'investigate')}
                title={canActOnAlert(role, 'investigate') ? 'Start investigating' : 'Requires ENGINEER or ADMIN'}
              >
                Investigate
              </Button>
            )}
            {alert.status !== 'RESOLVED' && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!canActOnAlert(role, 'resolve') || busyId === alert.id}
                onClick={() => void act(alert, 'resolve')}
                title={canActOnAlert(role, 'resolve') ? 'Resolve this alert' : 'Requires ENGINEER or ADMIN'}
              >
                Resolve
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => openInspector(alert.machineId, 'prediction')}
              title="Open the prediction behind this alert"
            >
              Why?
            </Button>
          </div>
        ),
      },
    ],
    [now, role, busyId, acknowledge.isPending, openInspector],
  );

  return (
    <div className="workspace">
      <SectionHeader
        title="Alert Center"
        description="Lifecycle, ownership and action for every active and resolved alert"
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
              placeholder="Search alertsâ€¦"
              aria-label="Search alerts"
            />
          </div>
        }
      />

      {/* Lifecycle strip â€” the canonical backend states. */}
      <div className="grid grid--metrics">
        <button
          type="button"
          className="lifecycle-chip"
          aria-pressed={statusFilter === 'ALL'}
          onClick={() => setStatusFilter('ALL')}
        >
          <span className="lifecycle-chip__count">{counts.total}</span>
          <span className="lifecycle-chip__label">All alerts</span>
        </button>
        {LIFECYCLE.map((status) => (
          <button
            key={status}
            type="button"
            className="lifecycle-chip"
            data-tone={STATUS_TONE[status]}
            aria-pressed={statusFilter === status}
            onClick={() => setStatusFilter(statusFilter === status ? 'ALL' : status)}
          >
            <span className="lifecycle-chip__count">{counts.byStatus.get(status) ?? 0}</span>
            <span className="lifecycle-chip__label">{titleCase(status)}</span>
          </button>
        ))}
      </div>

      <div className="row">
        <span className="tiny muted row" style={{ gap: 4 }}>
          <Filter size={12} aria-hidden />
          Severity
        </span>
        {['ALL', 'CRITICAL', 'WARNING', 'INFO'].map((severity) => (
          <Button
            key={severity}
            size="sm"
            variant={severityFilter === severity ? 'primary' : 'ghost'}
            aria-pressed={severityFilter === severity}
            onClick={() => setSeverityFilter(severity)}
          >
            {titleCase(severity)}
            {severity !== 'ALL' && <span className="tiny muted">{counts.bySeverity.get(severity) ?? 0}</span>}
          </Button>
        ))}
      </div>

      {alertsQuery.isLoading ? (
        <LoadingState label="Loading alertsâ€¦" rows={6} />
      ) : alertsQuery.isError ? (
        <ErrorState
          title="Alerts unavailable"
          description={toErrorMessage(alertsQuery.error)}
          onRetry={() => void alertsQuery.refetch()}
          retrying={alertsQuery.isFetching}
        />
      ) : (
        <Panel
          title="Alert register"
          subtitle={`${rows.length} alert${rows.length === 1 ? '' : 's'}${
            statusFilter !== 'ALL' ? ` Â· filtered to ${titleCase(statusFilter)}` : ''
          }`}
          flush
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(alert) => alert.id}
            onRowClick={(alert) => openInspector(alert.machineId, 'alerts')}
            caption="Alert register with lifecycle status and permitted actions"
            stickyHeader
            maxHeight={600}
            emptyMessage={
              <EmptyState
                icon={<AlertOctagon size={20} />}
                title="No active alerts"
                description="No alert matches the current filters. That is a good outcome, not an error."
              />
            }
          />
        </Panel>
      )}

      <p className="note">
        Action buttons are hidden or disabled when the signed-in role is not permitted. The backend authorises every
        transition independently of this interface.
        {identity?.roles.length ? ` Signed in with ${identity.roles.map((r) => r.replace('ROLE_', '')).join(', ')}.` : ''}
      </p>
    </div>
  );
}
