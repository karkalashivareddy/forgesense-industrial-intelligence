/**
 * Machine inspector.
 *
 * The contextual right rail. It is the surface an operator uses to answer
 * "what is happening to this asset, why, and what should I do about it".
 *
 * Design rules enforced here:
 *  - every number states its data basis
 *  - RUL is always "steps", never hours
 *  - attribution is labelled baseline perturbation, never SHAP
 *  - actions are only offered when the signed-in role is allowed, and the
 *    backend re-checks regardless
 */

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertOctagon,
  ArrowRight,
  Brain,
  CheckCircle2,
  Cog,
  Info,
  ListTree,
  Radio,
  Search,
  Wrench,
} from 'lucide-react';
import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  ErrorState,
  HealthIndicator,
  LoadingState,
  Metric,
  RiskIndicator,
  Sparkline,
  StatusBadge,
  TabPanel,
  Tabs,
  Timeline,
} from '../../design-system';
import { useUiStore, type InspectorTab } from '../../store/ui';
import { useAuth } from '../../auth/AuthProvider';
import {
  canActOnAlert,
  useAcknowledgeAlert,
  useAlerts,
  useCancelMaintenance,
  useCompleteMaintenance,
  useInvestigateAlert,
  useMachine,
  useMachineEvents,
  useMachineExplanation,
  useMachineImpact,
  useMachinePredictions,
  useMachineTelemetry,
  useMaintenance,
  useResolveAlert,
  useScheduleMaintenance,
  useStartMaintenance,
} from '../../api/queries';
import { useLiveReading, useTelemetryStore } from '../../realtime/store';
import { deriveOperationalState, anomalyTone } from '../../domain/machineState';
import { SENSOR_UNITS, type Factor, type SensorKey, type TelemetryReading } from '../../api/types';

import { DATA_BASIS } from '../../domain/basis';
import {
  EM_DASH,
  formatAge,
  formatContribution,
  formatDateTime,
  formatDuration,
  formatInteger,
  formatNumber,
  formatProbability,
  formatRulSteps,
  formatTime,
  titleCase,
} from '../../domain/format';
import { useNow } from '../../hooks/useNow';
import { toErrorMessage } from '../../api/client';

const TABS = [
  { id: 'overview', label: 'Overview', icon: <Info size={13} /> },
  { id: 'telemetry', label: 'Telemetry', icon: <Activity size={13} /> },
  { id: 'prediction', label: 'Prediction', icon: <Brain size={13} /> },
  { id: 'alerts', label: 'Alerts', icon: <AlertOctagon size={13} /> },
  { id: 'maintenance', label: 'Maintenance', icon: <Wrench size={13} /> },
  { id: 'events', label: 'Events', icon: <ListTree size={13} /> },
];

export function MachineInspector() {
  const open = useUiStore((state) => state.inspectorOpen);
  const machineId = useUiStore((state) => state.selectedMachineId);
  const tab = useUiStore((state) => state.inspectorTab);
  const setTab = useUiStore((state) => state.setInspectorTab);
  const close = useUiStore((state) => state.closeInspector);

  // Only accumulate a telemetry ring while the inspector is actually open.
  const watch = useTelemetryStore((state) => state.watch);
  const unwatch = useTelemetryStore((state) => state.unwatch);
  useEffect(() => {
    if (!open || !machineId) return;
    watch(machineId);
    return () => unwatch(machineId);
  }, [open, machineId, watch, unwatch]);

  const machine = useMachine(machineId);
  const now = useNow(2000);

  const derived = useMemo(
    () => deriveOperationalState(machine.data ?? null, now),
    [machine.data, now],
  );

  const subtitle = machine.data
    ? `${machine.data.typeLabel} Â· ${titleCase(machine.data.zone)} Â· ${machine.data.line}`
    : 'Asset detail';

  return (
    <Drawer
      open={open}
      onClose={close}
      title={
        machine.data ? (
          <>
            <span className="mono">{machine.data.machineId}</span>
            <span>{machine.data.name}</span>
          </>
        ) : (
          'Machine inspector'
        )
      }
      subtitle={subtitle}
      headerExtra={
        machine.data && (
          <StatusBadge
            tone={derived.descriptor.tone}
            icon={<span className="twin__dot" data-tone={derived.descriptor.tone} aria-hidden />}
            label={derived.descriptor.label}
            title={derived.descriptor.guidance}
          />
        )
      }
    >
      {!machineId ? (
        <EmptyState
          icon={<Cog size={20} />}
          title="No asset selected"
          description="Choose a machine from the Factory Twin, the Fleet table, an alert, or the command palette (Ctrl+K) to inspect it."
        />
      ) : machine.isLoading ? (
        <LoadingState label="Loading assetâ€¦" />
      ) : machine.isError ? (
        <ErrorState
          title="Could not load this asset"
          description={toErrorMessage(machine.error, 'The backend did not return asset data.')}
          onRetry={() => void machine.refetch()}
        />
      ) : !machine.data ? (
        <EmptyState title="Asset not found" description="This machine is no longer present in the fleet." />
      ) : (
        <>
          <div style={{ padding: '0 var(--space-4)' }}>
            <Tabs
              tabs={TABS}
              active={tab}
              onChange={(id) => setTab(id as InspectorTab)}
              label="Machine sections"
            />
          </div>
          <TabPanel id={tab} active>
            <InspectorBody machineId={machineId} tab={tab} onTab={setTab} />
          </TabPanel>
        </>
      )}
    </Drawer>
  );
}

function InspectorBody({
  machineId,
  tab,
  onTab,
}: {
  machineId: string;
  tab: string;
  onTab(tab: InspectorTab): void;
}) {
  switch (tab) {
    case 'telemetry':
      return <TelemetryTab machineId={machineId} />;
    case 'prediction':
      return <PredictionTab machineId={machineId} />;
    case 'alerts':
      return <AlertsTab machineId={machineId} onGoToMaintenance={() => onTab('maintenance')} />;
    case 'maintenance':
      return <MaintenanceTab machineId={machineId} onGoToAlerts={() => onTab('alerts')} />;
    case 'events':
      return <EventsTab machineId={machineId} />;
    default:
      return <OverviewTab machineId={machineId} onTab={onTab} />;
  }
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

function OverviewTab({ machineId, onTab }: { machineId: string; onTab(tab: InspectorTab): void }) {
  const machine = useMachine(machineId);
  const explanation = useMachineExplanation(machineId);
  const alerts = useAlerts();
  const maintenance = useMaintenance();
  const now = useNow(2000);

  const data = machine.data;
  const derived = deriveOperationalState(data ?? null, now);
  const live = useLiveReading(machineId);

  const machineAlerts = (alerts.data?.items ?? []).filter((a) => a.machineId === machineId);
  const openAlerts = machineAlerts.filter((a) => a.status !== 'RESOLVED');
  const workOrders = (maintenance.data ?? []).filter((m) => m.machineId === machineId);

  if (!data) return <LoadingState label="Loading assetâ€¦" rows={3} />;

  return (
    <div className="stack" style={{ padding: 'var(--space-4)' }}>
      <div className="banner banner--info">
        <Info size={13} aria-hidden style={{ flexShrink: 0 }} />
        <span>{derived.descriptor.guidance}</span>
      </div>

      <div className="grid grid--2">
        <HealthIndicator score={data.healthScore} />
        <RiskIndicator risk={data.failureRisk} />
      </div>

      <div className="grid grid--2">
        <Metric
          label="Anomaly score"
          value={formatProbability(data.anomalyScore)}
          tone={anomalyTone(data.anomalyScore)}
          basis={DATA_BASIS.PREDICTED}
          hint={titleCase(data.anomalyLabel)}
          size="sm"
        />
        <Metric
          label="Est. remaining"
          value={formatRulSteps(data.rulEstimate)}
          basis={DATA_BASIS.SYNTHETIC}
          hint="simulator steps"
          size="sm"
        />
      </div>

      <div>
        <h3 className="panel__title" style={{ marginBottom: 'var(--space-2)' }}>Asset record</h3>
        <div className="kv">
          <span className="kv__k">Criticality</span>
          <span className="kv__v">{titleCase(data.criticality)}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Backend state</span>
          <span className="kv__v mono">{derived.backendState}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Connectivity</span>
          <span className="kv__v">{titleCase(data.connectivity)}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Operating hours</span>
          <span className="kv__v num">{formatInteger(data.operatingHours)} h</span>
        </div>
        <div className="kv">
          <span className="kv__k">Throughput</span>
          <span className="kv__v num">{formatNumber(data.throughputPerHour, 0)} units/h</span>
        </div>
        <div className="kv">
          <span className="kv__k">Maintenance state</span>
          <span className="kv__v">{titleCase(data.maintenanceStatus)}</span>
        </div>
        <div className="kv">
          <span className="kv__k">Last telemetry</span>
          <span className="kv__v">
            {formatTime(data.lastTelemetryAt)}{' '}
            <span className="muted small">({formatAge(derived.ageSec)})</span>
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">Prediction mode</span>
          <span className="kv__v">
            <Badge tone={data.modelMode === 'MODEL' ? 'info' : 'warn'}>
              {data.modelMode === 'MODEL' ? 'ML model' : 'Heuristic fallback'}
            </Badge>
          </span>
        </div>
        <div className="kv">
          <span className="kv__k">Model version</span>
          <span className="kv__v mono small">{data.modelVersion}</span>
        </div>
      </div>

      <div>
        <div className="row row--between" style={{ marginBottom: 'var(--space-2)' }}>
          <h3 className="panel__title">Open alerts</h3>
          {openAlerts.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onTab('alerts')}>
              View all <ArrowRight size={12} />
            </Button>
          )}
        </div>
        {openAlerts.length === 0 ? (
          <p className="empty-inline">No active alerts for this asset.</p>
        ) : (
          <ul className="stack" style={{ gap: 'var(--space-1)' }}>
            {openAlerts.slice(0, 4).map((alert) => (
              <li key={alert.id} className="priority-row" data-tone={alert.severity === 'CRITICAL' ? 'crit' : 'warn'}>
                <span className="priority-row__body">
                  <span className="priority-row__head">
                    <Badge tone={alert.severity === 'CRITICAL' ? 'crit' : alert.severity === 'WARNING' ? 'warn' : 'info'}>
                      {alert.severity}
                    </Badge>
                    <span className="tiny muted">{titleCase(alert.status)}</span>
                  </span>
                  <span className="priority-row__text">{alert.headline}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="row row--between" style={{ marginBottom: 'var(--space-2)' }}>
          <h3 className="panel__title">Maintenance</h3>
          {workOrders.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onTab('maintenance')}>
              View all <ArrowRight size={12} />
            </Button>
          )}
        </div>
        {workOrders.length === 0 ? (
          <p className="empty-inline">No work orders recorded for this asset.</p>
        ) : (
          <ul className="stack" style={{ gap: 'var(--space-1)' }}>
            {workOrders.slice(0, 3).map((order) => (
              <li key={order.id} className="priority-row" data-tone={order.priority === 'URGENT' ? 'crit' : 'warn'}>
                <span className="priority-row__body">
                  <span className="priority-row__head">
                    <Badge tone={order.priority === 'URGENT' ? 'crit' : 'warn'}>{order.priority}</Badge>
                    <span className="tiny muted">{titleCase(order.status)}</span>
                  </span>
                  <span className="priority-row__text">{order.title}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <div className="row row--between" style={{ marginBottom: 'var(--space-2)' }}>
          <h3 className="panel__title">Top attribution drivers</h3>
          <Button size="sm" variant="ghost" onClick={() => onTab('prediction')}>
            Full prediction <ArrowRight size={12} />
          </Button>
        </div>
        {explanation.isLoading ? (
          <LoadingState label="Loading attributionâ€¦" rows={2} />
        ) : !explanation.data || explanation.data.factors.length === 0 ? (
          <p className="empty-inline">No attribution available for the latest prediction.</p>
        ) : (
          <DriverList factors={explanation.data.factors} />
        )}
      </div>

      {live && (
        <p className="note">
          <Radio size={11} aria-hidden style={{ verticalAlign: -1 }} /> Live delta received{' '}
          {formatAge((Date.now() - live.receivedAt) / 1000)} ago.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Telemetry
 * ------------------------------------------------------------------ */

function TelemetryTab({ machineId }: { machineId: string }) {
  const telemetry = useMachineTelemetry(machineId, 120);
  const machine = useMachine(machineId);
  const live = useLiveReading(machineId);
  const now = useNow(2000);

  const rows = telemetry.data?.rows ?? [];

  // Sensors the backend actually reports for this machine type.
  const available = useMemo(() => {
    const declared = new Set(machine.data?.sensors ?? []);
    const seen = new Set<string>();
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === 'number' && key in SENSOR_UNITS) seen.add(key);
      }
    }
    const keys = new Set<string>([...declared, ...seen]);
    if (live) for (const key of Object.keys(live.values)) keys.add(key);
    return Array.from(keys).filter((key) => key in SENSOR_UNITS) as SensorKey[];
  }, [machine.data?.sensors, rows, live]);

  if (telemetry.isLoading) return <LoadingState label="Loading telemetryâ€¦" />;
  if (telemetry.isError) {
    return (
      <ErrorState
        title="Telemetry unavailable"
        description={toErrorMessage(telemetry.error, 'The backend did not return telemetry history.')}
        onRetry={() => void telemetry.refetch()}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title={`No telemetry on record for ${machineId}`}
        description="The simulator has not produced a reading for this asset in the queried window. Check the System page for feed health."
      />
    );
  }

  const derived = deriveOperationalState(machine.data ?? null, now);
  const latest = rows[rows.length - 1];

  return (
    <div className="stack" style={{ padding: 'var(--space-4)' }}>
      {derived.isStale && (
        <div className="banner banner--warn">
          <Info size={13} aria-hidden style={{ flexShrink: 0 }} />
          <span>Showing the last known telemetry from {formatAge(derived.ageSec)}.</span>
        </div>
      )}

      <div className="row row--between">
        <span className="note">
          {rows.length} readings Â· latest {formatTime(latest?.timestamp)}
        </span>
        <Badge tone="info">SYNTHETIC</Badge>
      </div>

      <div className="grid grid--2">
        {available.map((key) => {
          const meta = SENSOR_UNITS[key];
          const value = live?.values[key] ?? findLatest(rows, key);
          return (
            <div className="metric metric--sm" key={key}>
              <div className="metric__label">{meta.label}</div>
              <div className="metric__value">
                {typeof value === 'number' ? formatNumber(value, key === 'rpm' || key === 'frequency' ? 0 : 1) : EM_DASH}
                <span className="metric__unit">{meta.unit}</span>
              </div>
              <TrendFor sensor={key} machineId={machineId} />
            </div>
          );
        })}
      </div>

      <p className="note">
        Values come from the synthetic simulator, not from physical sensors. No normal range is asserted because the
        profile is a modelled baseline rather than a measured specification.
      </p>
    </div>
  );
}

/**
 * Latest numeric value for a sensor.
 *
 * The lookup is by a runtime sensor key, so it needs one narrow cast: the row
 * is a TelemetryReading, whose sensor fields are individually optional.
 */
function findLatest(rows: TelemetryReading[], key: string): number | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    const value = (row as unknown as Record<string, unknown>)[key];
    if (typeof value === 'number') return value;
  }
  return null;
}

/** Sparkline drawn from the REST history window. */
function TrendFor({ sensor, machineId }: { sensor: string; machineId: string }) {
  const telemetry = useMachineTelemetry(machineId, 60);
  const values = useMemo(() => {
    const rows = telemetry.data?.rows ?? [];
    return rows
      .map((row) => (row as unknown as Record<string, unknown>)[sensor])
      .filter((value): value is number => typeof value === 'number');
  }, [telemetry.data, sensor]);


  if (values.length < 2) return null;
  return <Sparkline values={values} label={`${sensor} trend`} tone="info" />;
}

/* ------------------------------------------------------------------ *
 * Prediction
 * ------------------------------------------------------------------ */

function PredictionTab({ machineId }: { machineId: string }) {
  const explanation = useMachineExplanation(machineId);
  const predictions = useMachinePredictions(machineId);
  const impact = useMachineImpact(machineId);
  const now = useNow(2000);

  const latest = predictions.data?.[0];
  const derived = deriveOperationalState(
    latest
      ? {
          status: latest.anomalyScore >= 0.7 || latest.failureRisk >= 0.8 ? 'CRITICAL' : 'NORMAL',
          connectivity: 'ONLINE',
          lastTelemetryAt: latest.timestamp,
        }
      : null,
    now,
  );

  if (explanation.isLoading) return <LoadingState label="Loading predictionâ€¦" />;
  if (explanation.isError) {
    return (
      <ErrorState
        title="Prediction unavailable"
        description={toErrorMessage(
          explanation.error,
          'The ML service may be offline. The backend falls back to heuristic estimates and labels them HEURISTIC.',
        )}
        onRetry={() => void explanation.refetch()}
      />
    );
  }

  const data = explanation.data;
  const isHeuristic = data?.mode !== 'MODEL';
  const latestImpact = impact.data?.latest;

  return (
    <div className="stack" style={{ padding: 'var(--space-4)' }}>
      <div className="banner banner--sim">
        <Brain size={13} aria-hidden style={{ flexShrink: 0 }} />
        <span>
          Model-based estimate over synthetic telemetry. Failure risk is a probability from the model, not a
          measurement, and it is not a guarantee of failure.
        </span>
      </div>

      {isHeuristic && (
        <div className="banner banner--warn">
          <Info size={13} aria-hidden style={{ flexShrink: 0 }} />
          <span>
            The ML service is unavailable, so this prediction came from the backend heuristic fallback. Confidence is
            reduced and the value should be treated as indicative only.
          </span>
        </div>
      )}

      {data ? (
        <>
          <div className="grid grid--2">
            <RiskIndicator risk={data.failureRisk} label="Failure risk" />
            <Metric
              label="Anomaly score"
              value={formatProbability(data.anomalyScore)}
              tone={anomalyTone(data.anomalyScore)}
              basis={DATA_BASIS.PREDICTED}
              size="sm"
            />
          </div>

          <div>
            <div className="kv">
              <span className="kv__k">Predicted at</span>
              <span className="kv__v">{formatDateTime(data.timestamp)}</span>
            </div>
            <div className="kv">
              <span className="kv__k">Inference mode</span>
              <span className="kv__v">
                <Badge tone={isHeuristic ? 'warn' : 'info'}>{isHeuristic ? 'HEURISTIC FALLBACK' : 'ML MODEL'}</Badge>
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">Asset state at prediction</span>
              <span className="kv__v mono">{derived.backendState}</span>
            </div>
          </div>

          <div>
            <h3 className="panel__title" style={{ marginBottom: 'var(--space-2)' }}>Top drivers</h3>
            {data.factors.length === 0 ? (
              <p className="empty-inline">No attribution factors were returned for this prediction.</p>
            ) : (
              <DriverList factors={data.factors} />
            )}
          </div>

          <p className="note">
            Attribution uses local baseline perturbation: each sensor is replaced with its training-set average in turn
            and the change in model output is attributed to that sensor. It is a first-order local method and does not
            capture feature interactions.
          </p>
        </>
      ) : (
        <EmptyState
          title="No prediction on record"
          description="The ML service has not produced an assessment for this asset yet. Predictions are generated when telemetry arrives."
        />
      )}

      {latestImpact ? (
        <div>
          <h3 className="panel__title" style={{ marginBottom: 'var(--space-2)' }}>Modelled production impact</h3>
          <div className="kv">
            <span className="kv__k">Estimated downtime</span>
            <span className="kv__v num">{formatDuration(latestImpact.estimatedDowntimeMinutes)}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Machines affected</span>
            <span className="kv__v num">{formatInteger(latestImpact.affectedMachineCount)}</span>
          </div>
          <div className="kv">
            <span className="kv__k">Production loss</span>
            <span className="kv__v num">{formatNumber(latestImpact.productionLossUnits, 0)} units</span>
          </div>
          <p className="note note--warn" style={{ marginTop: 'var(--space-2)' }}>
            {latestImpact.dataLabel}. {latestImpact.assumptionsJson}
          </p>
        </div>
      ) : (
        <EmptyState
          title="No impact analysis recorded"
          description="Run an impact analysis from the Simulation Lab, or wait for a critical alert to trigger one automatically."
        />
      )}
    </div>
  );
}

function DriverList({ factors }: { factors: Factor[] }) {
  const maxAbs = Math.max(...factors.map((factor) => Math.abs(factor.contribution)), 0.0001);
  return (
    <ul className="stack" style={{ gap: 'var(--space-2)' }}>
      {factors.map((factor) => {
        const width = (Math.abs(factor.contribution) / maxAbs) * 100;
        const elevated = factor.label === 'ELEVATED';
        const reduced = factor.label === 'REDUCED';
        const tone = elevated ? 'crit' : reduced ? 'ok' : 'idle';
        const colour = elevated ? 'var(--color-critical)' : reduced ? 'var(--color-success)' : 'var(--color-unavailable)';
        return (
          <li key={factor.feature}>
            <div className="row row--between" style={{ gap: 'var(--space-2)' }}>
              <span className="row" style={{ gap: 'var(--space-2)' }}>
                <StatusBadge
                  tone={tone}
                  icon={<span className="twin__dot" data-tone={tone} aria-hidden />}
                  label={factor.label}
                />
                <span className="small">{factor.feature}</span>
              </span>
              <span className="mono small" title="Signed change in model output probability">
                {formatContribution(factor.contribution)}
              </span>
            </div>
            <div className="meter__track" style={{ marginTop: 4 }}>
              <div className="meter__fill" style={{ width: `${width}%`, background: colour }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Alerts
 * ------------------------------------------------------------------ */

function AlertsTab({ machineId, onGoToMaintenance }: { machineId: string; onGoToMaintenance(): void }) {
  const alerts = useAlerts();
  const { identity } = useAuth();
  const acknowledge = useAcknowledgeAlert();
  const investigate = useInvestigateAlert();
  const resolve = useResolveAlert();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = (alerts.data?.items ?? []).filter((alert) => alert.machineId === machineId);
  const role = identity?.roles[0];

  if (alerts.isLoading) return <LoadingState label="Loading alertsâ€¦" />;
  if (alerts.isError) {
    return (
      <ErrorState
        title="Could not load alerts"
        description={toErrorMessage(alerts.error)}
        onRetry={() => void alerts.refetch()}
      />
    );
  }
  if (rows.length === 0) {
    return <EmptyState title="No alerts for this asset" description="This machine has not raised any alert conditions." />;
  }

  const act = async (id: string, action: 'acknowledge' | 'investigate' | 'resolve') => {
    setBusyId(id);
    try {
      if (action === 'acknowledge') await acknowledge.mutateAsync(id);
      else if (action === 'investigate') await investigate.mutateAsync(id);
      else await resolve.mutateAsync(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="stack" style={{ padding: 'var(--space-4)' }}>
      {rows.map((alert) => (
        <div key={alert.id} className="panel" style={{ background: 'var(--color-bg-inset)' }}>
          <div style={{ padding: 'var(--space-3)' }}>
            <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
              <Badge tone={alert.severity === 'CRITICAL' ? 'crit' : alert.severity === 'WARNING' ? 'warn' : 'info'}>
                {alert.severity}
              </Badge>
              <Badge tone="idle">{titleCase(alert.status)}</Badge>
              <span className="tiny muted mono">{alert.type}</span>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>{alert.headline}</p>
            <p className="note">{alert.description}</p>
            {alert.recommendedAction && (
              <p className="note" style={{ marginTop: 'var(--space-1)' }}>
                <strong>Recommended:</strong> {alert.recommendedAction}
              </p>
            )}
            <div className="row" style={{ marginTop: 'var(--space-2)', gap: 'var(--space-3)' }}>
              <span className="tiny muted">Opened {formatDateTime(alert.openedAt)}</span>
              <span className="tiny muted">Â·</span>
              <span className="tiny muted">
                Risk at creation {formatProbability(alert.riskAtCreation ?? null)}
              </span>
            </div>

            <div className="row" style={{ marginTop: 'var(--space-3)' }}>
              {alert.status === 'NEW' && (
                <Button
                  size="sm"
                  disabled={!canActOnAlert(role, 'acknowledge') || busyId === alert.id}
                  loading={busyId === alert.id && acknowledge.isPending}
                  onClick={() => void act(alert.id, 'acknowledge')}
                >
                  <CheckCircle2 size={12} /> Acknowledge
                </Button>
              )}
              {(alert.status === 'NEW' || alert.status === 'ACKNOWLEDGED') && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!canActOnAlert(role, 'investigate') || busyId === alert.id}
                  onClick={() => void act(alert.id, 'investigate')}
                >
                  <Search size={12} /> Investigate
                </Button>
              )}
              {alert.status !== 'RESOLVED' && (
                <Button
                  size="sm"
                  disabled={!canActOnAlert(role, 'resolve') || busyId === alert.id}
                  onClick={() => void act(alert.id, 'resolve')}
                >
                  Resolve
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onGoToMaintenance}>
                Maintenance <ArrowRight size={12} />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Maintenance
 * ------------------------------------------------------------------ */

function MaintenanceTab({ machineId, onGoToAlerts }: { machineId: string; onGoToAlerts(): void }) {
  const maintenance = useMaintenance();
  const { identity } = useAuth();
  const schedule = useScheduleMaintenance();
  const start = useStartMaintenance();
  const complete = useCompleteMaintenance();
  const cancel = useCancelMaintenance();
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = (maintenance.data ?? []).filter((order) => order.machineId === machineId);
  const canEdit = identity?.roles.some((role) => role === 'ROLE_ENGINEER' || role === 'ROLE_ADMIN') ?? false;

  if (maintenance.isLoading) return <LoadingState label="Loading work ordersâ€¦" />;
  if (maintenance.isError) {
    return (
      <ErrorState
        title="Could not load maintenance"
        description={toErrorMessage(maintenance.error)}
        onRetry={() => void maintenance.refetch()}
      />
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No work orders for this asset"
        description="A recommendation is created automatically when the model's failure risk crosses the maintenance threshold."
      />
    );
  }

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

  return (
    <div className="stack" style={{ padding: 'var(--space-4)' }}>
      {rows.map((order) => (
        <div key={order.id} className="panel" style={{ background: 'var(--color-bg-inset)' }}>
          <div style={{ padding: 'var(--space-3)' }}>
            <div className="row" style={{ marginBottom: 'var(--space-2)' }}>
              <Badge
                tone={
                  order.priority === 'URGENT' ? 'crit' : order.priority === 'HIGH' ? 'warn' : 'info'
                }
              >
                {order.priority}
              </Badge>
              <Badge tone={order.status === 'ACTIVE' ? 'maint' : 'idle'}>{titleCase(order.status)}</Badge>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>{order.title}</p>
            <p className="note">{order.description}</p>
            {order.recommendedAction && (
              <p className="note" style={{ marginTop: 'var(--space-1)' }}>
                <strong>Action:</strong> {order.recommendedAction}
              </p>
            )}
            <div className="kv" style={{ marginTop: 'var(--space-2)' }}>
              <span className="kv__k">Estimated duration</span>
              <span className="kv__v num">
                {order.estimatedDurationMinutes ? formatDuration(order.estimatedDurationMinutes) : EM_DASH}
              </span>
            </div>
            <div className="kv">
              <span className="kv__k">Risk at creation</span>
              <span className="kv__v num">{formatProbability(order.riskAtCreation ?? null)}</span>
            </div>
            <div className="kv">
              <span className="kv__k">Created</span>
              <span className="kv__v">{formatDateTime(order.createdAt)}</span>
            </div>

            <div className="row" style={{ marginTop: 'var(--space-3)' }}>
              {order.status === 'RECOMMENDED' && (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!canEdit || busyId === order.id}
                  onClick={() => void run(order.id, 'schedule')}
                >
                  <Wrench size={12} /> Schedule
                </Button>
              )}
              {order.status === 'SCHEDULED' && (
                <Button size="sm" disabled={!canEdit || busyId === order.id} onClick={() => void run(order.id, 'start')}>
                  Start work
                </Button>
              )}
              {order.status === 'ACTIVE' && (
                <Button size="sm" disabled={!canEdit || busyId === order.id} onClick={() => void run(order.id, 'complete')}>
                  <CheckCircle2 size={12} /> Complete
                </Button>
              )}
              {order.status !== 'COMPLETED' && order.status !== 'CANCELLED' && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={!canEdit || busyId === order.id}
                  onClick={() => void run(order.id, 'cancel')}
                >
                  Cancel
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={onGoToAlerts}>
                Related alerts <ArrowRight size={12} />
              </Button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

function EventsTab({ machineId }: { machineId: string }) {
  const events = useMachineEvents(machineId);
  const now = useNow(5000);

  if (events.isLoading) return <LoadingState label="Loading asset historyâ€¦" />;
  if (events.isError) {
    return (
      <ErrorState
        title="Could not load asset history"
        description={toErrorMessage(events.error)}
        onRetry={() => void events.refetch()}
      />
    );
  }

  const items = events.data?.items ?? [];
  if (items.length === 0) {
    return <EmptyState title="No recorded history" description="No operational events are stored for this asset." />;
  }

  return (
    <div style={{ padding: 'var(--space-4)' }}>
      <Timeline
        entries={items.map((entry) => ({
          id: String(entry.id),
          timestamp: formatDateTime(entry.eventTime),
          title: entry.detail,
          tone: entry.eventType.startsWith('ALERT') ? 'warn' : 'neutral',
        }))}
      />
      <p className="note" style={{ marginTop: 'var(--space-3)' }}>
        Showing {items.length} of {formatInteger(events.data?.count ?? items.length)} events. Oldest shown entry is{' '}
        {formatAge(now - Date.parse(items[items.length - 1]?.eventTime ?? new Date().toISOString()) / 1000)}.
      </p>
    </div>
  );
}
