/**
 * Scenario Lab â€” controlled what-if engineering.
 *
 * The hard boundary of this page: scenarios inject faults into the SYNTHETIC
 * simulator feed. They do not touch, command, or model any physical machine.
 * That statement is unmissable and is repeated next to the run controls.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, FlaskConical, Pause, Play, RotateCcw, ShieldAlert, Zap } from 'lucide-react';
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
  useApplyScenarioControl,
  useClearMachineControl,
  useDependencyEdges,
  useMachines,
  usePauseSimulator,
  useResetSimulator,
  useResumeSimulator,
  useRunScenario,
  useSimulationControls,
  useSimulationRuns,
  useSimulatorConfig,
} from '../api/queries';
import { useAuth } from '../auth/AuthProvider';
import { useUiStore } from '../store/ui';
import { SCENARIO_TYPES, type ScenarioType, type SimulationRun } from '../api/types';
import { formatDateTime, formatDuration, formatInteger, formatNumber, formatTime, titleCase } from '../domain/format';
import { toErrorMessage } from '../api/client';

/* The runnable subset of the backend's ScenarioType enum. NONE is not a fault. */
const RUNNABLE: ScenarioType[] = SCENARIO_TYPES.filter((type) => type !== 'NONE' && type !== 'RECOVERY');

const SCENARIO_BLURB: Record<string, string> = {
  DEGRADATION: 'Slow loss of performance across the whole operating envelope.',
  OVERHEATING: 'Thermal runaway â€” temperature climbs until a critical alert fires.',
  BEARING_FAILURE: 'Progressive bearing degradation with rising vibration.',
  VIBRATION_SPIKE: 'Sudden vibration transient, as from a mechanical imbalance.',
  RPM_INSTABILITY: 'Rotational speed becomes unstable against its commanded setpoint.',
  CURRENT_SPIKE: 'Elevated motor current, indicating mechanical binding or load.',
  SENSOR_FAILURE: 'A sensor drops out â€” the model degrades on missing inputs.',
  MACHINE_OFFLINE: 'The asset stops reporting entirely.',
  LOAD_INCREASE: 'Sustained load rise well beyond the operating baseline.',
  MAINTENANCE: 'Models a maintenance delay rather than an outright failure.',
};

export default function SimulationLab() {
  const navigate = useNavigate();
  const { identity } = useAuth();
  const openInspector = useUiStore((state) => state.openInspector);

  const machinesQuery = useMachines();
  const runsQuery = useSimulationRuns();
  const controlsQuery = useSimulationControls();
  const configQuery = useSimulatorConfig();

  const [machineId, setMachineId] = useState('M-101');
  const [scenarioType, setScenarioType] = useState<ScenarioType>('VIBRATION_SPIKE');
  const [severity, setSeverity] = useState(0.6);
  const [horizon, setHorizon] = useState(120);

  const runScenario = useRunScenario({
    machineId,
    scenarioType,
    severity,
    failureHorizonMinutes: horizon,
  });
  const applyControl = useApplyScenarioControl();
  const pause = usePauseSimulator();
  const resume = useResumeSimulator();
  const reset = useResetSimulator();
  const clearControl = useClearMachineControl(machineId);

  const canEdit = identity?.roles.some((role) => role === 'ROLE_ENGINEER' || role === 'ROLE_ADMIN') ?? false;
  const paused = configQuery.data?.paused ?? false;
  const activeControls = (controlsQuery.data ?? []).filter((control) => control.active);
  const runs = runsQuery.data ?? [];

  const machines = machinesQuery.data ?? [];
  const selectedMachine = machines.find((machine) => machine.machineId === machineId);
  const thisMachineActive = activeControls.some((control) => control.machineId === machineId);

  const errorMessage = useMemo(() => {
    const failed = [runScenario, applyControl, pause, resume, reset, clearControl].find((mutation) => mutation.isError);
    return failed?.error ? toErrorMessage(failed.error) : null;
  }, [runScenario, applyControl, pause, resume, reset, clearControl]);

  const columns = useMemo<Column<SimulationRun>[]>(
    () => [
      {
        key: 'id',
        header: 'Run',
        width: '90px',
        cell: (run) => <span className="tiny mono muted">{String(run.id).slice(-8)}</span>,
      },
      {
        key: 'machine',
        header: 'Asset',
        width: '120px',
        cell: (run) => (
          <button
            type="button"
            className="mono link-button"
            onClick={(event) => {
              event.stopPropagation();
              openInspector(run.machineId, 'overview');
            }}
          >
            {run.machineId}
          </button>
        ),
      },
      {
        key: 'scenario',
        header: 'Scenario',
        cell: (run) => (
          <div style={{ minWidth: 0 }}>
            <div className="small">{titleCase(run.scenarioType)}</div>
            <div className="tiny muted truncate">{run.name}</div>
          </div>
        ),
      },
      {
        key: 'severity',
        header: 'Severity',
        align: 'end',
        hideBelow: 'sm',
        cell: (run) => <span className="num">{Math.round(run.severity * 100)}%</span>,
      },
      {
        key: 'affected',
        header: 'Affected',
        align: 'end',
        cell: (run) => <span className="num">{formatInteger(run.affectedMachineCount)}</span>,
      },
      {
        key: 'downtime',
        header: 'Est. downtime',
        align: 'end',
        hideBelow: 'md',
        cell: (run) => <span className="num">{formatDuration(run.expectedDowntimeMinutes)}</span>,
      },
      {
        key: 'loss',
        header: 'Est. loss',
        align: 'end',
        hideBelow: 'md',
        cell: (run) => <span className="num">{formatNumber(run.productionLossUnits, 0)} u</span>,
      },
      {
        key: 'status',
        header: 'Status',
        width: '120px',
        cell: (run) => (
          <StatusBadge
            tone={run.status === 'COMPLETED' ? 'ok' : 'warn'}
            icon={<span className="twin__dot" data-tone={run.status === 'COMPLETED' ? 'ok' : 'warn'} aria-hidden />}
            label={titleCase(run.status)}
          />
        ),
      },
      {
        key: 'created',
        header: 'Run at',
        align: 'end',
        hideBelow: 'sm',
        cell: (run) => <span className="tiny muted">{formatDateTime(run.createdAt)}</span>,
      },
    ],
    [openInspector],
  );

  return (
    <div className="workspace">
      <SectionHeader
        title="Scenario Lab"
        description="Controlled what-if experiments against the synthetic plant and its dependency graph"
        actions={
          <Button size="sm" onClick={() => navigate('/twin')}>
            <Boxes size={13} aria-hidden /> Observe in the Twin
          </Button>
        }
      />

      <div className="banner banner--sim" role="status">
        <ShieldAlert size={14} aria-hidden style={{ flexShrink: 0 }} />
        <span>
          <strong>SIMULATION MODE â€” NO PHYSICAL MACHINE CONTROL.</strong> A scenario injects a fault into the
          synthetic telemetry generator. Nothing here commands, connects to, or represents a real machine, and the
          figures below are modelled estimates under stated assumptions, not measured outcomes.
        </span>
      </div>

      {errorMessage && (
        <div className="banner banner--warn" role="alert">
          <span>{errorMessage}</span>
        </div>
      )}

      <div className="grid grid--metrics">
        <Metric
          label="Active scenarios"
          value={activeControls.length}
          tone={activeControls.length > 0 ? 'maint' : 'neutral'}
          size="sm"
          hint="injected into the feed now"
        />
        <Metric label="Scenario runs" value={formatInteger(runs.length)} size="sm" hint="recorded by the backend" />
        <Metric
          label="Simulator feed"
          value={paused ? 'PAUSED' : 'RUNNING'}
          tone={paused ? 'warn' : 'ok'}
          size="sm"
        />
        <Metric
          label="Your access"
          value={canEdit ? 'ENGINEER' : 'READ ONLY'}
          tone={canEdit ? 'ok' : 'idle'}
          size="sm"
          hint={canEdit ? 'can run and control scenarios' : 'running scenarios requires ENGINEER'}
        />
      </div>

      <div className="scenario-grid">
        <div className="stack">
          <Panel
            title="Run a scenario"
            subtitle="Choose an asset, a fault model and a severity"
            tone="maint"
          >
            <div className="stack">
              <div className="grid grid--2">
                <div className="field">
                  <label className="field__label" htmlFor="sim-machine">
                    Asset
                  </label>
                  <select
                    id="sim-machine"
                    className="field__select"
                    value={machineId}
                    onChange={(event) => setMachineId(event.target.value)}
                  >
                    {machines.map((machine) => (
                      <option key={machine.machineId} value={machine.machineId}>
                        {machine.machineId} Â· {machine.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="field">
                  <label className="field__label" htmlFor="sim-horizon">
                    Failure horizon (minutes)
                  </label>
                  <input
                    id="sim-horizon"
                    className="field__input"
                    type="number"
                    min={15}
                    max={1440}
                    step={15}
                    value={horizon}
                    onChange={(event) => setHorizon(Number(event.target.value) || 120)}
                  />
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="sim-severity">
                  Severity â€” {Math.round(severity * 100)}%
                </label>
                <input
                  id="sim-severity"
                  className="field__input"
                  type="range"
                  min={0.2}
                  max={1}
                  step={0.1}
                  value={severity}
                  onChange={(event) => setSeverity(Number(event.target.value))}
                />
              </div>

              <div>
                <span className="field__label">Fault model</span>
                <div className="grid grid--2" style={{ marginTop: 'var(--space-2)' }}>
                  {RUNNABLE.map((type) => (
                    <button
                      key={type}
                      type="button"
                      className="scenario-card"
                      aria-pressed={scenarioType === type}
                      onClick={() => setScenarioType(type)}
                    >
                      <span className="scenario-card__name">{titleCase(type)}</span>
                      <span className="scenario-card__desc">{SCENARIO_BLURB[type] ?? 'Fault model'}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/*
                Two deliberately separate actions.

                "Run what-if" calls /simulation/run: it computes modelled
                production impact against the dependency graph and changes
                nothing else. Safe, repeatable, no side effects on the fleet.

                "Inject into live feed" calls /simulation/control: it changes
                what the synthetic generator emits next, which propagates
                through the ML service and the decision engine into machine
                state, alerts and work orders. That is the observable one, and
                it is the reason the Scenario Lab is a laboratory rather than
                a calculator.
              */}
              <div className="row">
                <Button
                  variant="primary"
                  disabled={!canEdit}
                  loading={runScenario.isPending}
                  onClick={() => void runScenario.mutateAsync(undefined)}
                  title={canEdit ? 'Compute modelled impact. Does not change the feed.' : 'Requires ENGINEER or ADMIN'}
                >
                  <FlaskConical size={14} aria-hidden /> Run what-if
                </Button>
                <Button
                  disabled={!canEdit || thisMachineActive}
                  loading={applyControl.isPending}
                  onClick={() =>
                    void applyControl.mutateAsync({
                      machineId,
                      scenario: scenarioType,
                      severity,
                    })
                  }
                  title={
                    !canEdit
                      ? 'Requires ENGINEER or ADMIN'
                      : thisMachineActive
                        ? `${machineId} already has an active scenario`
                        : 'Inject this fault into the synthetic feed'
                  }
                >
                  <Zap size={14} aria-hidden /> Inject into live feed
                </Button>
                {thisMachineActive && (
                  <Button
                    disabled={!canEdit}
                    loading={clearControl.isPending}
                    onClick={() => void clearControl.mutateAsync(undefined)}
                  >
                    Clear {machineId}
                  </Button>
                )}
              </div>

              <div className="row">
                <Button
                  disabled={!canEdit || paused}
                  loading={pause.isPending}
                  onClick={() => void pause.mutateAsync(undefined)}
                >
                  <Pause size={13} aria-hidden /> Pause feed
                </Button>
                <Button
                  disabled={!canEdit || !paused}
                  loading={resume.isPending}
                  onClick={() => void resume.mutateAsync(undefined)}
                >
                  <Play size={13} aria-hidden /> Resume feed
                </Button>
                <Button
                  variant="danger"
                  disabled={!canEdit}
                  loading={reset.isPending}
                  onClick={() => void reset.mutateAsync(undefined)}
                >
                  <RotateCcw size={13} aria-hidden /> Reset feed
                </Button>
              </div>

              {thisMachineActive && (
                <div className="banner banner--sim" role="status">
                  <Zap size={13} aria-hidden style={{ flexShrink: 0 }} />
                  <span>
                    A scenario is live on <span className="mono">{machineId}</span>. Watch the Command Center, the
                    Factory Twin and the Alert Center â€” telemetry, prediction, state and alerts all react. Clearing it
                    or resetting the feed restores nominal conditions.
                  </span>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Scenario history" subtitle={`${runs.length} recorded runs`} flush>
            {runsQuery.isLoading ? (
              <LoadingState label="Loading scenario historyâ€¦" rows={4} />
            ) : runsQuery.isError ? (
              <div style={{ padding: 'var(--space-4)' }}>
                <ErrorState
                  title="Scenario history unavailable"
                  description={toErrorMessage(runsQuery.error)}
                  onRetry={() => void runsQuery.refetch()}
                />
              </div>
            ) : runs.length === 0 ? (
              <EmptyState
                icon={<FlaskConical size={20} />}
                title="No scenario runs yet"
                description="Run a scenario above to see the modelled production impact and the resulting fleet response."
              />
            ) : (
              <DataTable
                columns={columns}
                rows={runs}
                rowKey={(run) => run.id}
                onRowClick={(run) => openInspector(run.machineId, 'overview')}
                caption="Recorded scenario runs with modelled impact"
                stickyHeader
                maxHeight={360}
              />
            )}
          </Panel>
        </div>

        <div className="stack">
          <Panel title="Active scenario control" subtitle="Faults currently injected into the feed">
            {activeControls.length === 0 ? (
              <EmptyState
                title="No active scenario"
                description="The simulator is producing normal operating conditions. Run a scenario to inject a fault."
              />
            ) : (
              <ul className="stack" style={{ gap: 'var(--space-2)' }}>
                {activeControls.map((control) => (
                  <li key={control.machineId} className="scenario-card" style={{ borderLeftColor: 'var(--color-maintenance)' }}>
                    <span className="row row--between">
                      <span className="mono" style={{ fontWeight: 600 }}>
                        {control.machineId}
                      </span>
                      <Badge tone="maint">ACTIVE</Badge>
                    </span>
                    <span className="scenario-card__name">{titleCase(control.scenario)}</span>
                    <span className="scenario-card__desc">
                      Severity {Math.round(control.severity * 100)}% Â· started{' '}
                      {control.startedAt ? formatTime(control.startedAt) : 'â€”'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Expected impact of this run" subtitle="Modelled against the dependency graph">
            <ImpactPreview machineId={machineId} scenarioType={scenarioType} severity={severity} />
          </Panel>

          <Panel title="What to watch" subtitle="How a scenario propagates through the platform">
            <div className="timeline-strip" role="img" aria-label="Scenario timeline: degradation, anomaly, risk rise, alert, maintenance, recovery">
              {[
                { label: 'T0', colour: 'var(--color-bg-panel-elevated)' },
                { label: 'Degrade', colour: 'var(--color-warning-bg)' },
                { label: 'Anomaly', colour: 'var(--color-warning-bg)' },
                { label: 'Risk', colour: 'var(--color-critical-bg)' },
                { label: 'Alert', colour: 'var(--color-critical-bg)' },
                { label: 'Maint', colour: 'var(--color-maintenance-bg)' },
                { label: 'Recover', colour: 'var(--color-success-bg)' },
              ].map((stage) => (
                <div
                  key={stage.label}
                  className="timeline-strip__segment"
                  style={{ background: stage.colour, flex: 1 }}
                >
                  {stage.label}
                </div>
              ))}
            </div>
            <p className="note" style={{ marginTop: 'var(--space-3)' }}>
              A scenario raises the injected sensor values, which the ML service scores, which the decision engine
              turns into a machine state, which raises an alert and â€” past the risk threshold â€” a maintenance
              recommendation. Watch the Twin and the Command Center to see each stage land.
            </p>
            {selectedMachine && (
              <p className="note">
                Target asset: <span className="mono">{selectedMachine.machineId}</span> ({selectedMachine.typeLabel},
                {selectedMachine.zone.toLowerCase()}) â€” currently {titleCase(selectedMachine.status)} at{' '}
                {formatNumber(selectedMachine.healthScore, 1)} health.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/**
 * Preview of the dependency fan-out the engine will model. This reads the real
 * dependency edges; it does not predict the impact result, which is only known
 * after the backend runs the scenario.
 */
function ImpactPreview({
  machineId,
  scenarioType,
  severity,
}: {
  machineId: string;
  scenarioType: ScenarioType;
  severity: number;
}) {
  const { data: edges } = useDependencyPreview();
  const downstream = useMemo(() => {
    if (!edges) return [];
    const affected = new Set<string>();
    let frontier = [machineId];
    for (let depth = 0; depth < 3; depth += 1) {
      const next: string[] = [];
      for (const upstream of frontier) {
        for (const edge of edges) {
          if (edge.upstream === upstream && !affected.has(edge.downstream)) {
            affected.add(edge.downstream);
            next.push(edge.downstream);
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) break;
    }
    return Array.from(affected);
  }, [edges, machineId]);

  return (
    <div className="stack">
      <div className="kv">
        <span className="kv__k">Scenario</span>
        <span className="kv__v">{titleCase(scenarioType)}</span>
      </div>
      <div className="kv">
        <span className="kv__k">Severity</span>
        <span className="kv__v num">{Math.round(severity * 100)}%</span>
      </div>
      <div className="kv">
        <span className="kv__k">Direct + transitive dependents</span>
        <span className="kv__v num">{downstream.length}</span>
      </div>
      {downstream.length > 0 && (
        <div className="row" style={{ gap: 4 }}>
          {downstream.map((id) => (
            <span key={id} className="mono tiny" style={{ color: 'var(--color-text-muted)' }}>
              {id}
            </span>
          ))}
        </div>
      )}
      <p className="note note--warn">
        Downtime, throughput loss and production loss are only known after the backend runs the impact engine. They
        are modelled from per-edge propagation factors and per-machine throughput â€” assumptions, not measurements.
      </p>
    </div>
  );
}

function useDependencyPreview() {
  // Reuses the shared dependency query rather than opening a second request.
  return useDependencyEdges();
}
