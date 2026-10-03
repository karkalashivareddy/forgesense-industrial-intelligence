/**
 * Analytics.
 *
 * Fleet-level trends with a restrained set of charts. Every chart declares its
 * unit, range and data basis, and every chart has loading, empty and error
 * states — a blank canvas is never shown.
 *
 * Rendering discipline: the ECharts instance is created once per chart and
 * updated with `setOption(..., { notMerge: false })` on a throttled cadence.
 * A telemetry packet does not redraw a chart.
 */

import { useMemo } from 'react';
import { Info } from 'lucide-react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent, type GridComponentOption } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import {
  useAlertStats,
  useAnalyticsOverview,
  useEventFrequency,
  useMaintenanceStats,
  useMachines,
  useRiskRanking,
} from '../api/queries';
import { DATA_BASIS, describeBasis } from '../domain/basis';
import { formatInteger, formatNumber, formatProbability, formatScore } from '../domain/format';
import { summariseFleet } from '../domain/machineState';
import { useNow, usePrefersReducedMotion } from '../hooks/useNow';
import { CHART, token } from '../styles/color';
import { toErrorMessage } from '../api/client';
import { EmptyState, ErrorState, LoadingState, Metric, Panel, SectionHeader, StatusBadge } from '../design-system';
import { Chart } from '../components/Chart';

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  CanvasRenderer,
]);

export default function Analytics() {
  const overviewQuery = useAnalyticsOverview();
  const rankingQuery = useRiskRanking();
  const alertStatsQuery = useAlertStats();
  const maintenanceStatsQuery = useMaintenanceStats();
  const eventFreqQuery = useEventFrequency();
  const machinesQuery = useMachines();
  const now = useNow(5000);
  const reducedMotion = usePrefersReducedMotion();

  const summary = useMemo(() => summariseFleet(machinesQuery.data ?? [], now), [machinesQuery.data, now]);

  // Health distribution — a real histogram of the live fleet, not a trend.
  const healthHistogram = useMemo(() => {
    const buckets = [
      { label: '0–59', min: 0, max: 60, count: 0 },
      { label: '60–79', min: 60, max: 80, count: 0 },
      { label: '80–89', min: 80, max: 90, count: 0 },
      { label: '90–95', min: 90, max: 95, count: 0 },
      { label: '95–100', min: 95, max: 101, count: 0 },
    ];
    for (const machine of machinesQuery.data ?? []) {
      const bucket = buckets.find((entry) => machine.healthScore >= entry.min && machine.healthScore < entry.max);
      if (bucket) bucket.count += 1;
    }
    return buckets;
  }, [machinesQuery.data]);

  const gridOptions: GridComponentOption = {
    left: 8,
    right: 12,
    top: 24,
    bottom: 4,
    containLabel: true,
  };

  const healthOption = useMemo<echarts.EChartsCoreOption>(
    () => ({
      animation: !reducedMotion,
      animationDuration: 250,
      grid: gridOptions,
      tooltip: { trigger: 'axis', confine: true, valueFormatter: (value: unknown) => `${String(value)} assets` },
      xAxis: {
        type: 'category',
        data: healthHistogram.map((entry) => entry.label),
        axisLine: { lineStyle: { color: CHART.border() } },
        axisLabel: { color: CHART.muted(), fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: 'assets',
        nameTextStyle: { color: CHART.muted(), fontSize: 10 },
        splitLine: { lineStyle: { color: CHART.grid() } },
        axisLabel: { color: CHART.muted(), fontSize: 10 },
      },
      series: [
        {
          type: 'bar',
          data: healthHistogram.map((entry) => ({
            value: entry.count,
            itemStyle: {
              color: entry.min < 60 ? token('--color-critical') : entry.min < 80 ? token('--color-warning') : token('--color-success'),
            },
          })),
          barMaxWidth: 34,
          itemStyle: { borderRadius: [2, 2, 0, 0] },
        },
      ],
    }),
    [healthHistogram, reducedMotion],
  );

  const riskOption = useMemo<echarts.EChartsCoreOption>(() => {
    const rows = (rankingQuery.data ?? []).slice().sort((a, b) => b.failureRisk - a.failureRisk).slice(0, 18);
    return {
      animation: !reducedMotion,
      animationDuration: 250,
      grid: { ...gridOptions, left: 8, bottom: 4 },
      tooltip: {
        trigger: 'axis',
        confine: true,
        axisPointer: { type: 'shadow' },
        valueFormatter: (value: unknown) => formatProbability(Number(value)),
      },
      xAxis: {
        type: 'value',
        max: 1,
        axisLabel: {
          color: CHART.muted(),
          fontSize: 10,
          formatter: (value: number) => `${Math.round(value * 100)}%`,
        },
        splitLine: { lineStyle: { color: CHART.grid() } },
      },
      yAxis: {
        type: 'category',
        data: rows.map((row) => row.machineId).reverse(),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: CHART.text(), fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((row) => row.failureRisk).reverse(),
          barMaxWidth: 10,
          itemStyle: { borderRadius: [0, 2, 2, 0], color: CHART.predicted() },
        },
      ],
    };
  }, [rankingQuery.data, reducedMotion]);

  const riskScatterOption = useMemo<echarts.EChartsCoreOption>(() => {
    const rows = rankingQuery.data ?? [];
    const points = rows.map((row) => [row.failureRisk, row.anomalyScore, row.healthScore, row.machineId]);
    const maxRisk = Math.max(0.01, ...rows.map((row) => row.failureRisk));
    const maxAnomaly = Math.max(0.01, ...rows.map((row) => row.anomalyScore));
    return {
      animation: !reducedMotion,
      animationDuration: 250,
      grid: gridOptions,
      tooltip: {
        confine: true,
        formatter: (params: unknown) => {
          const point = (params as { data: [number, number, number, string] }).data;
          return `<strong>${point[3]}</strong><br/>Failure risk ${formatProbability(point[0])}<br/>Anomaly ${formatScore(point[1])}<br/>Health ${formatNumber(point[2], 1)}`;
        },
      },
      xAxis: {
        type: 'value',
        name: 'failure risk',
        max: maxRisk * 1.1,
        nameTextStyle: { color: CHART.muted(), fontSize: 10 },
        axisLabel: { color: CHART.muted(), fontSize: 10, formatter: (v: number) => formatProbability(v) },
        splitLine: { lineStyle: { color: CHART.grid() } },
      },
      yAxis: {
        type: 'value',
        name: 'anomaly',
        max: maxAnomaly * 1.1,
        nameTextStyle: { color: CHART.muted(), fontSize: 10 },
        axisLabel: { color: CHART.muted(), fontSize: 10, formatter: (v: number) => formatProbability(v) },
        splitLine: { lineStyle: { color: CHART.grid() } },
      },
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: 9,
          itemStyle: {
            color: CHART.observed(),
            opacity: 0.85,
            borderColor: CHART.panel(),
            borderWidth: 1,
          },
        },
      ],
    };
  }, [rankingQuery.data, reducedMotion]);

  const loading = overviewQuery.isLoading || rankingQuery.isLoading || machinesQuery.isLoading;
  const failed = overviewQuery.isError || rankingQuery.isError || machinesQuery.isError;

  if (loading) {
    return (
      <div className="workspace">
        <SectionHeader title="Analytics" description="Fleet-level operational trends and distribution" />
        <LoadingState label="Computing analytics…" rows={5} />
      </div>
    );
  }

  if (failed) {
    return (
      <div className="workspace">
        <SectionHeader title="Analytics" description="Fleet-level operational trends and distribution" />
        <ErrorState
          title="Analytics unavailable"
          description={toErrorMessage(overviewQuery.error ?? rankingQuery.error ?? machinesQuery.error)}
          onRetry={() => {
            void overviewQuery.refetch();
            void rankingQuery.refetch();
            void machinesQuery.refetch();
          }}
        />
      </div>
    );
  }

  const overview = overviewQuery.data;
  const alertStats = alertStatsQuery.data;
  const maintenanceStats = maintenanceStatsQuery.data;
  const eventFreq = eventFreqQuery.data;

  return (
    <div className="workspace">
      <SectionHeader title="Analytics" description="Fleet-level operational trends and distribution" />

      <div className="grid grid--metrics">
        <Metric label="Assets online" value={formatInteger(overview?.machinesOnline)} unit={`/ ${overview?.machinesTotal ?? 0}`} basis={DATA_BASIS.OBSERVED} size="sm" />
        <Metric label="Fleet health" value={formatNumber(summary.averageHealth, 1)} unit="/ 100" basis={DATA_BASIS.DERIVED} size="sm" />
        <Metric label="At risk" value={formatInteger(overview?.machinesAtRisk)} hint="failure risk ≥ 0.50" basis={DATA_BASIS.DERIVED} size="sm" />
        <Metric label="Open alerts" value={formatInteger(alertStats?.open)} basis={DATA_BASIS.OBSERVED} size="sm" />
        {/* Ingest rate of telemetry messages, not plant output. */}
        <Metric label="Telemetry rate" value={formatInteger(overview?.telemetryThroughputPerMinute)} unit="msg/min" basis={DATA_BASIS.OBSERVED} hint="messages ingested in the last 60s" size="sm" />
      </div>

      <div className="cc__row">
        <Panel
          title="Health distribution"
          subtitle="Current fleet health scores, bucketed"
          actions={<StatusBadge tone="info" label="Observed" title={describeBasis(DATA_BASIS.OBSERVED).meaning} />}
        >
          <Chart option={healthOption} height={220} ariaLabel="Histogram of fleet health scores by band" />
          <p className="note" style={{ marginTop: 'var(--space-2)' }}>
            Buckets below 80 represent assets the model considers degraded or worse. Scores are computed by the ML
            service from current sensor values.
          </p>
        </Panel>

        <Panel
          title="Risk vs anomaly"
          subtitle="Each point is one asset"
          actions={<StatusBadge tone="maint" label="Model predicted" title={describeBasis(DATA_BASIS.PREDICTED).meaning} />}
        >
          <Chart option={riskScatterOption} height={220} ariaLabel="Scatter plot of failure risk against anomaly score per asset" />
          <p className="note" style={{ marginTop: 'var(--space-2)' }}>
            Assets in the upper-right are both anomalous and at elevated predicted risk — the quadrant that normally
            warrants an investigation.
          </p>
        </Panel>
      </div>

      <Panel
        title="Predicted failure risk by asset"
        subtitle="Model-estimated probability, highest first"
        actions={<StatusBadge tone="maint" label="Model predicted" title={describeBasis(DATA_BASIS.PREDICTED).meaning} />}
      >
        <Chart option={riskOption} height={300} ariaLabel="Bar chart of predicted failure risk by asset" />
      </Panel>

      <div className="grid grid--3">
        <Panel title="Alert volume" subtitle="Counts by lifecycle state">
          {alertStats ? (
            <div className="stack">
              <div className="kv"><span className="kv__k">New</span><span className="kv__v num">{formatInteger(alertStats.new)}</span></div>
              <div className="kv"><span className="kv__k">Investigating</span><span className="kv__v num">{formatInteger(alertStats.investigating)}</span></div>
              <div className="kv"><span className="kv__k">Resolved (24h)</span><span className="kv__v num">{formatInteger(alertStats.resolvedToday)}</span></div>
              <div className="kv"><span className="kv__k">Total open</span><span className="kv__v num">{formatInteger(alertStats.open)}</span></div>
            </div>
          ) : (
            <EmptyState title="Alert statistics unavailable" description="The analytics alert endpoint did not respond." />
          )}
        </Panel>

        <Panel title="Maintenance backlog" subtitle="Work orders by status">
          {maintenanceStats ? (
            <div className="stack">
              <div className="kv"><span className="kv__k">Recommended</span><span className="kv__v num">{formatInteger(maintenanceStats.recommended)}</span></div>
              <div className="kv"><span className="kv__k">Scheduled</span><span className="kv__v num">{formatInteger(maintenanceStats.scheduled)}</span></div>
              <div className="kv"><span className="kv__k">Active</span><span className="kv__v num">{formatInteger(maintenanceStats.active)}</span></div>
              <div className="kv"><span className="kv__k">Completed</span><span className="kv__v num">{formatInteger(maintenanceStats.completed)}</span></div>
            </div>
          ) : (
            <EmptyState title="Maintenance statistics unavailable" description="The analytics maintenance endpoint did not respond." />
          )}
        </Panel>

        <Panel title="Event volume" subtitle="Cumulative counts in the register">
          {eventFreq ? (
            <div className="stack">
              <div className="kv"><span className="kv__k">Telemetry received</span><span className="kv__v num">{formatInteger(eventFreq.telemetry)}</span></div>
              <div className="kv"><span className="kv__k">Alerts created</span><span className="kv__v num">{formatInteger(eventFreq.alerts)}</span></div>
              <div className="kv"><span className="kv__k">Maintenance created</span><span className="kv__v num">{formatInteger(eventFreq.maintenance)}</span></div>
              <div className="kv"><span className="kv__k">Simulations started</span><span className="kv__v num">{formatInteger(eventFreq.simulations)}</span></div>
            </div>
          ) : (
            <EmptyState title="Event statistics unavailable" description="The analytics event endpoint did not respond." />
          )}
        </Panel>
      </div>

      <div className="banner">
        <Info size={13} aria-hidden style={{ flexShrink: 0 }} />
        <span>
          <strong>There is no OEE, throughput or downtime metric on this page, and there is not one hiding elsewhere.</strong>{' '}
          This system observes synthetic machine signals. It has no production counter, no good-part count, no shift
          calendar and no planned-versus-actual downtime, so it cannot compute availability, performance or quality, and
          it does not estimate them. Every figure above is counted from persisted system state. Where a number is
          model output rather than a count, the panel says so.
        </span>
      </div>
    </div>
  );
}
