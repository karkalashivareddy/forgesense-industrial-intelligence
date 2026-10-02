/**
 * Predictions Center â€” the ML intelligence workspace.
 *
 * Everything on this page is model output. The page is explicit about that:
 * the model version and inference mode are always visible, attribution is
 * labelled as baseline perturbation (never SHAP), and remaining-useful-life
 * is expressed in simulator steps with its limitations stated.
 */

import { useMemo, useState } from 'react';
import { Brain, Info, ShieldAlert } from 'lucide-react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { Chart } from '../components/Chart';
import { CHART, token } from '../styles/color';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  HealthIndicator,
  LoadingState,
  Metric,
  Panel,
  RiskIndicator,
  SectionHeader,
  StatusBadge,
  type Column,
} from '../design-system';
import { useMachineExplanation, useMachinePredictions, useMachines, useRiskRanking, useSystemStatus } from '../api/queries';
import { useUiStore } from '../store/ui';
import { anomalyTone, deriveOperationalState, riskTone } from '../domain/machineState';
import { DATA_BASIS } from '../domain/basis';
import { formatAge, formatContribution, formatProbability, formatRulSteps, formatScore, formatTime } from '../domain/format';
import { useNow } from '../hooks/useNow';
import { toErrorMessage } from '../api/client';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

/** Maintenance threshold, mirrored from the metric tile so the chart and the
 *  KPI cannot disagree about what counts as "above threshold". */
const MAINTENANCE_THRESHOLD = 0.7;

/** Chart payloads are rounded to keep the option object small and diffable. */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export default function Predictions() {
  const machinesQuery = useMachines();
  const rankingQuery = useRiskRanking();
  const statusQuery = useSystemStatus();
  const openInspector = useUiStore((state) => state.openInspector);
  const now = useNow(3000);

  const [focusMachineId, setFocusMachineId] = useState<string | null>(null);

  const mlAvailable = statusQuery.data?.mlServiceAvailable ?? false;
  const heuristicCount = useMemo(
    () => (machinesQuery.data ?? []).filter((machine) => machine.modelMode !== 'MODEL').length,
    [machinesQuery.data],
  );

  const machines = useMemo(() => {
    const byId = new Map((machinesQuery.data ?? []).map((machine) => [machine.machineId, machine]));
    return (rankingQuery.data ?? [])
      .slice()
      .sort((a, b) => b.failureRisk - a.failureRisk || b.anomalyScore - a.anomalyScore)
      .map((row) => ({ row, machine: byId.get(row.machineId) }))
      .filter((entry) => entry.machine);
  }, [rankingQuery.data, machinesQuery.data]);

  const focus = focusMachineId
    ? machines.find((entry) => entry.row.machineId === focusMachineId)
    : machines[0];

  /*
   * Prediction history for the focused asset.
   *
   * This is the recorded model output the backend already stores, read back
   * from GET /api/v1/machines/{id}/predictions. It is not interpolated,
   * smoothed or forward-filled: gaps are gaps. The endpoint returns newest
   * first, so it is reversed for a left-to-right time axis.
   */
  const historyQuery = useMachinePredictions(focus?.row.machineId ?? null);
  const history = useMemo(
    () => (historyQuery.data ?? []).slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    [historyQuery.data],
  );

  const historyOption = useMemo<echarts.EChartsCoreOption>(() => {
    const times = history.map((point) => formatTime(point.timestamp));
    return {
      animation: false,
      grid: { left: 44, right: 16, top: 28, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        backgroundColor: CHART.panel(),
        borderColor: CHART.border(),
        textStyle: { color: CHART.text(), fontSize: 11 },
      },
      legend: {
        top: 0,
        right: 0,
        textStyle: { color: CHART.muted(), fontSize: 10 },
        itemWidth: 10,
        itemHeight: 2,
      },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: CHART.grid() } },
        axisLabel: { color: CHART.muted(), fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        splitLine: { lineStyle: { color: CHART.grid(), type: 'dashed' } },
        axisLabel: { color: CHART.muted(), fontSize: 10, formatter: (value: number) => value.toFixed(1) },
      },
      series: [
        {
          name: 'Failure risk',
          type: 'line',
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 2, color: CHART.predicted() },
          itemStyle: { color: CHART.predicted() },
          data: history.map((point) => round3(point.failureRisk)),
        },
        {
          name: 'Anomaly score',
          type: 'line',
          showSymbol: false,
          connectNulls: false,
          lineStyle: { width: 1.5, color: CHART.observed() },
          itemStyle: { color: CHART.observed() },
          data: history.map((point) => round3(point.anomalyScore)),
        },
        {
          name: 'Maintenance threshold',
          type: 'line',
          showSymbol: false,
          silent: true,
          lineStyle: { width: 1, type: 'dashed', color: CHART.warningThreshold() },
          data: times.map(() => MAINTENANCE_THRESHOLD),
        },
      ],
    };
  }, [history]);

  const columns: Column<typeof machines[number]>[] = useMemo(
    () => [
      {
        key: 'machine',
        header: 'Asset',
        width: '15%',
        cell: ({ row }) => (
          <div style={{ minWidth: 0 }}>
            <div className="mono" style={{ fontWeight: 600 }}>
              {row.machineId}
            </div>
            <div className="tiny muted truncate">{row.name}</div>
          </div>
        ),
      },
      {
        key: 'state',
        header: 'State',
        cell: ({ row, machine }) => {
          const derived = machine ? deriveOperationalState(machine, now) : null;
          return (
            <StatusBadge
              tone={derived?.descriptor.tone ?? 'idle'}
              icon={<span className="twin__dot" data-tone={derived?.descriptor.tone ?? 'idle'} aria-hidden />}
              label={derived?.descriptor.label ?? row.status}
            />
          );
        },
      },
      {
        key: 'risk',
        header: 'Failure risk',
        align: 'end',
        sortable: true,
        cell: ({ row }) => (
          <span className="num" style={{ color: 'var(--color-intelligence-text)', fontWeight: 600 }}>
            {formatProbability(row.failureRisk)}
          </span>
        ),
      },
      {
        key: 'anomaly',
        header: 'Anomaly score',
        align: 'end',
        hideBelow: 'sm',
        cell: ({ row }) => (
          <span
            className="num"
            style={{ color: anomalyTone(row.anomalyScore) === 'crit' ? 'var(--color-critical-text)' : 'var(--color-text-secondary)' }}
            title="Bounded model score, not a probability. 1.0 is the most extreme reading seen in training."
          >
            {formatScore(row.anomalyScore)}
          </span>
        ),
      },
      {
        key: 'health',
        header: 'Health',
        align: 'end',
        hideBelow: 'md',
        cell: ({ row }) => <span className="num">{row.healthScore.toFixed(1)}</span>,
      },
      {
        key: 'rul',
        header: 'Est. remaining',
        align: 'end',
        hideBelow: 'md',
        /*
         * `rulEstimate` is absent until the ML service has produced an
         * assessment. Defaulting it to 0 here rendered "0 steps", which reads
         * as "this machine has nothing left" rather than "nothing is known".
         * An absent estimate is an em dash.
         */
        cell: ({ row }) => {
          const machine = machinesQuery.data?.find((m) => m.machineId === row.machineId);
          return (
            <span className="num" title="Simulator degradation steps remaining — not a time unit">
              {formatRulSteps(machine?.rulEstimate)}
            </span>
          );
        },
      },
      {
        key: 'mode',
        header: 'Inference',
        hideBelow: 'lg',
        cell: ({ machine }) => (
          <Badge tone={machine?.modelMode === 'MODEL' ? 'info' : 'warn'}>
            {machine?.modelMode === 'MODEL' ? 'ML model' : 'Heuristic'}
          </Badge>
        ),
      },
      {
        key: 'fresh',
        header: 'Reading age',
        align: 'end',
        hideBelow: 'sm',
        cell: ({ machine }) => {
          if (!machine) return 'â€”';
          const derived = deriveOperationalState(machine, now);
          return <span className="tiny muted num">{formatAge(derived.ageSec)}</span>;
        },
      },
    ],
    [now, machinesQuery.data],
  );

  if (machinesQuery.isLoading || rankingQuery.isLoading) {
    return (
      <div className="workspace">
        <SectionHeader title="Predictions" description="Model-estimated risk, anomaly and attribution across the fleet" />
        <LoadingState label="Loading predictionsâ€¦" rows={6} />
      </div>
    );
  }

  if (machinesQuery.isError || rankingQuery.isError) {
    return (
      <div className="workspace">
        <SectionHeader title="Predictions" description="Model-estimated risk, anomaly and attribution across the fleet" />
        <ErrorState
          title="Predictions unavailable"
          description={toErrorMessage(machinesQuery.error ?? rankingQuery.error)}
          onRetry={() => {
            void machinesQuery.refetch();
            void rankingQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div className="workspace">
      <SectionHeader
        title="Predictions"
        description="Model-estimated failure risk, anomaly scoring and attribution across the fleet"
      />

      {/* Model provenance banner â€” always visible, never buried. */}
      <div className="banner" style={{ ...(mlAvailable ? bannerStyle('info') : bannerStyle('warn')) }}>
        <Brain size={13} aria-hidden style={{ flexShrink: 0 }} />
        <span>
          {mlAvailable ? (
            <>
              Served by the ML service. Failure-risk model{' '}
              <span className="mono">{statusQuery.data?.mlModelVersion ?? 'unknown'}</span>, anomaly model{' '}
              <span className="mono">{statusQuery.data?.anomalyModelVersion ?? 'unknown'}</span>.{' '}
              {heuristicCount > 0
                ? `${heuristicCount} asset${heuristicCount === 1 ? ' is' : 's are'} currently on the heuristic fallback.`
                : 'Every asset is currently served by the trained models.'}
            </>
          ) : (
            <>
              <strong>The ML service is unreachable.</strong> The backend is falling back to heuristic estimates, which
              are materially less reliable. Treat every value on this page as indicative only until the service
              recovers.
            </>
          )}
        </span>
      </div>

      <div className="grid grid--metrics">
        <Metric
          label="Assets modelled"
          value={machines.length}
          basis={DATA_BASIS.DERIVED}
          size="sm"
        />
        <Metric
          label="Peak failure risk"
          value={formatProbability(machines[0]?.row.failureRisk ?? null)}
          tone={riskTone(machines[0]?.row.failureRisk)}
          basis={DATA_BASIS.PREDICTED}
          size="sm"
        />
        <Metric
          label="Above maintenance threshold"
          value={machines.filter((entry) => entry.row.failureRisk >= 0.7).length}
          hint="risk â‰¥ 0.70"
          basis={DATA_BASIS.DERIVED}
          size="sm"
        />
        <Metric
          label="On heuristic fallback"
          value={heuristicCount}
          tone={heuristicCount > 0 ? 'warn' : 'ok'}
          basis={DATA_BASIS.DERIVED}
          size="sm"
        />
        <Metric
          label="Model version"
          value={<span style={{ fontSize: 'var(--text-sm)' }}>{statusQuery.data?.mlModelVersion ?? 'â€”'}</span>}
          size="sm"
        />
      </div>

      <div className="prediction-layout">
        <Panel title="Fleet risk ranking" subtitle="Sorted by model-estimated failure probability" flush>
          <DataTable
            columns={columns}
            rows={machines}
            rowKey={(entry) => entry.row.machineId}
            selectedKey={focus?.row.machineId ?? null}
            onRowClick={(entry) => {
              setFocusMachineId(entry.row.machineId);
              openInspector(entry.row.machineId, 'prediction');
            }}
            caption="Fleet risk ranking with model inference mode"
            stickyHeader
            maxHeight={520}
            emptyMessage={
              <EmptyState
                icon={<Brain size={20} />}
                title="No predictions available"
                description="The backend returned no machine-level predictions. This happens when the fleet snapshot is empty."
              />
            }
          />
        </Panel>

        <div className="stack">
          {focus ? (
            <>
              <Panel
                title={`${focus.row.machineId} · prediction history`}
                subtitle={`${history.length} recorded model outputs`}
                flush
              >
                {historyQuery.isPending ? (
                  <LoadingState label="Loading prediction history…" rows={3} />
                ) : historyQuery.isError ? (
                  <ErrorState
                    title="Prediction history unavailable"
                    description={toErrorMessage(historyQuery.error)}
                    onRetry={() => void historyQuery.refetch()}
                  />
                ) : history.length === 0 ? (
                  <EmptyState
                    icon={<Brain size={20} />}
                    title="No prediction history yet"
                    description="The backend has not recorded a prediction for this asset. History appears once the inference pipeline has run for it."
                  />
                ) : (
                  <div style={{ padding: 'var(--space-3) var(--space-4) var(--space-4)' }}>
                    <Chart
                      option={historyOption}
                      height={190}
                      ariaLabel={`Recorded failure risk and anomaly score over time for ${focus.row.machineId}, against the maintenance threshold`}
                    />
                    <p style={{ margin: '10px 0 0', color: token('--color-text-muted'), fontSize: 'var(--text-xs)' }}>
                      Recorded model output, newest {history.length} predictions. Failure risk and anomaly score are model
                      estimates on a 0–1 scale, not observed measurements, and are not guarantees. RUL is expressed in
                      simulator steps, never hours.
                    </p>
                  </div>
                )}
              </Panel>
              <Panel
                title={`${focus.row.machineId} Â· prediction`}
                subtitle={focus.row.name}
                actions={
                  <Button size="sm" variant="ghost" onClick={() => openInspector(focus.row.machineId, 'prediction')}>
                    Full detail
                  </Button>
                }
              >
                <div className="stack">
                  <RiskIndicator risk={focus.row.failureRisk} />
                  <div className="grid grid--2">
                    <Metric
                      label="Anomaly score"
                      value={formatScore(focus.row.anomalyScore)}
                      tone={anomalyTone(focus.row.anomalyScore)}
                      basis={DATA_BASIS.PREDICTED}
                      size="sm"
                    />
                    <HealthIndicator score={focus.row.healthScore} label="Health" />
                  </div>
                  <div className="kv">
                    <span className="kv__k">Predicted at</span>
                    <span className="kv__v">{formatTime(focus.machine?.lastTelemetryAt ?? null)}</span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">Inference mode</span>
                    <span className="kv__v">
                      <Badge tone={focus.machine?.modelMode === 'MODEL' ? 'info' : 'warn'}>
                        {focus.machine?.modelMode === 'MODEL' ? 'ML model' : 'Heuristic fallback'}
                      </Badge>
                    </span>
                  </div>
                </div>
              </Panel>

              <Panel title="Attribution" subtitle="Local baseline-perturbation over the selected asset">
                <p className="note" style={{ marginBottom: 'var(--space-3)' }}>
                  Each sensor is replaced with its training-set average in turn; the change in model output is
                  attributed to that sensor. This is a first-order local method and is <strong>not</strong> SHAP â€” no
                  SHAP library or axiom is involved. Select a driver to open its telemetry.
                </p>
                {focus.machine ? (
                  <DriverPanel
                    machineId={focus.row.machineId}
                    onOpenTelemetry={() => openInspector(focus.row.machineId, 'telemetry')}
                  />
                ) : (
                  <EmptyState title="Machine detail unavailable" description="Select a row to see its attribution." />
                )}
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState
                icon={<Brain size={20} />}
                title="Select an asset"
                description="Choose a row in the risk ranking to inspect its prediction and attribution."
              />
            </Panel>
          )}
        </div>
      </div>

      <div className="banner banner--warn">
        <ShieldAlert size={13} aria-hidden style={{ flexShrink: 0 }} />
        <span>
          <strong>What these numbers are not.</strong> Failure risk is a model probability, not a measured
          likelihood of a real failure, and carries no confidence interval. â€œEstimated remainingâ€ is a count of
          simulator degradation steps derived from the synthetic feed â€” it is not hours, days, or a calibrated
          remaining-useful-life. The models were trained on generated data from this same simulator.
        </span>
      </div>
    </div>
  );
}

function DriverPanel({ machineId, onOpenTelemetry }: { machineId: string; onOpenTelemetry(): void }) {
  // One request for the focused asset only â€” the fleet ranking endpoint does
  // not carry attribution, and fanning out to every asset would be wasteful.
  const explanation = useMachineExplanation(machineId);

  if (explanation.isLoading) {
    return <LoadingState label="Loading attributionâ€¦" rows={2} />;
  }

  if (explanation.isError) {
    return (
      <ErrorState
        title="Attribution unavailable"
        description={toErrorMessage(explanation.error, 'The ML service did not return an explanation for this asset.')}
        onRetry={() => void explanation.refetch()}
      />
    );
  }

  const factors = explanation.data?.factors ?? [];
  if (factors.length === 0) {
    return (
      <EmptyState
        title="No attribution available"
        description="The ML service has not produced an explanation for this asset in the current run."
      />
    );
  }

  const maxAbs = Math.max(...factors.map((factor) => Math.abs(factor.contribution)), 0.0001);

  return (
    <div className="driver-list">
      {factors.map((factor) => {
        const tone = factor.label === 'ELEVATED' ? 'crit' : factor.label === 'REDUCED' ? 'ok' : 'idle';
        const colour = tone === 'crit' ? 'var(--color-critical)' : tone === 'ok' ? 'var(--color-success)' : 'var(--color-unavailable)';
        return (
          <button
            key={factor.feature}
            type="button"
            className="driver"
            data-tone={tone}
            onClick={onOpenTelemetry}
            title={`Open ${machineId} telemetry â€” ${factor.feature} is the selected attribution driver`}
          >
            <span className="driver__head">
              <span className="row" style={{ gap: 'var(--space-2)' }}>
                <StatusBadge
                  tone={tone}
                  icon={<span className="twin__dot" data-tone={tone} aria-hidden />}
                  label={factor.label}
                />
                <span className="driver__name">{factor.feature}</span>
              </span>
              <span className="driver__value">{formatContribution(factor.contribution)}</span>
            </span>
            <span className="meter__track">
              <span
                className="meter__fill"
                style={{ width: `${(Math.abs(factor.contribution) / maxAbs) * 100}%`, background: colour, display: 'block' }}
              />
            </span>
            <span className="driver__caption">
              {factor.direction === 'up'
                ? 'Increasing this sensor raises the model output'
                : factor.direction === 'down'
                  ? 'Increasing this sensor lowers the model output'
                  : 'No directional effect at this operating point'}
            </span>
          </button>
        );
      })}
      <p className="note">
        <Info size={11} aria-hidden style={{ verticalAlign: -1 }} /> Values are signed changes in model output
        probability, not percentages. Predicted {formatTime(explanation.data?.timestamp ?? null)}.
      </p>
    </div>
  );
}

function bannerStyle(tone: 'info' | 'warn'): React.CSSProperties {
  return tone === 'info'
    ? {
        background: 'var(--color-info-bg)',
        borderColor: 'color-mix(in srgb, var(--color-info) 35%, transparent)',
        color: 'var(--color-info-text)',
      }
    : {
        background: 'var(--color-warning-bg)',
        borderColor: 'color-mix(in srgb, var(--color-warning) 38%, transparent)',
        color: 'var(--color-warning-text)',
      };
}
