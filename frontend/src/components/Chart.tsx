/**
 * Shared ECharts host.
 *
 * Extracted from the Analytics workspace so the Predictions history chart
 * renders through exactly the same lifecycle rather than a second, subtly
 * different copy. Two copies of a chart host is how you end up with one
 * workspace that leaks an instance on route change and another that does not.
 *
 * Lifecycle contract:
 *  - the ECharts instance is created once per mount and disposed on unmount
 *  - option changes go through `setOption(..., { notMerge: false })` so a
 *    telemetry packet does not destroy and rebuild the canvas
 *  - a ResizeObserver keeps the canvas matched to its panel, and is the only
 *    reason the instance is not recreated on every resize
 */
import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';

export interface ChartProps {
  option: echarts.EChartsCoreOption;
  height: number;
  ariaLabel: string;
  /** Prevents a resize observer loop when the panel is hidden. */
  active?: boolean;
}

export function Chart({ option, height, ariaLabel, active = true }: ChartProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!active || !hostRef.current) return;
    const chart = echarts.init(hostRef.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.setOption(option);

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(hostRef.current);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // Recreated only when visibility flips; option updates go through setOption.
  }, [active]);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: false, lazyUpdate: true });
  }, [option]);

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', height }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}