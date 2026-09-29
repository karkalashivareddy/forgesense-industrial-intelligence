/**
 * Truthful connection state.
 *
 * This is the single component that decides what "LIVE" means in ForgeSense.
 *
 * Rules it enforces:
 *  - a configured transport is never a healthy transport
 *  - a synthetic simulator feed is never labelled as industrial LIVE telemetry
 *  - a silent socket becomes STALE, not LIVE
 *  - REST fallback is always named as fallback
 */

import { useEffect, useMemo, useState } from 'react';
import { Radio, RefreshCw, WifiOff, AlertTriangle } from 'lucide-react';
import { useRealtimeStore, deriveConnectionQuality } from '../realtime/store';
import { useMachines, useSystemStatus, useTelemetryStatus } from '../api/queries';
import { useNow } from '../hooks/useNow';
import { StatusBadge } from '../design-system';
import { resolveBasis } from '../domain/basis';

const ICONS = {
  LIVE: Radio,
  SYNTHETIC: Radio,
  SIMULATED: Radio,
  SYNCING: RefreshCw,
  STALE: AlertTriangle,
  DEGRADED: AlertTriangle,
  OFFLINE: WifiOff,
} as const;

export function useConnectionQuality() {
  const transport = useRealtimeStore((state) => state.transport);
  const machinesQuery = useMachines();
  const statusQuery = useSystemStatus();
  const now = useNow(1000);

  const dataBasis = resolveBasis(statusQuery.data?.dataBasis);
  const demoMode = statusQuery.data?.demoMode ?? false;

  const restAgeSec = useMemo(() => {
    const newest = machinesQuery.data?.reduce<string | null>((acc, machine) => {
      if (!machine.lastTelemetryAt) return acc;
      if (!acc) return machine.lastTelemetryAt;
      return machine.lastTelemetryAt > acc ? machine.lastTelemetryAt : acc;
    }, null);
    if (!newest) return null;
    const t = Date.parse(newest);
    return Number.isNaN(t) ? null : Math.max(0, (now - t) / 1000);
  }, [machinesQuery.data, now]);

  return useMemo(
    () =>
      deriveConnectionQuality(transport, {
        dataBasis,
        demoMode,
        restOk: !machinesQuery.isError,
        restAgeSec,
        now,
      }),
    [transport, dataBasis, demoMode, machinesQuery.isError, restAgeSec, now],
  );
}

export function ConnectionIndicator({ compact = false }: { compact?: boolean }) {
  const quality = useConnectionQuality();
  const telemetryStatus = useTelemetryStatus();
  const Icon = ICONS[quality.label];
  const spin = quality.label === 'SYNCING';

  const title = [
    quality.detail,
    telemetryStatus.data
      ? `Input transport: ${telemetryStatus.data.transport} from ${telemetryStatus.data.source}`
      : null,
    'ForgeSense renders synthetic simulator telemetry. It does not control physical machines.',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <StatusBadge
      tone={quality.tone}
      icon={<Icon size={12} className={spin ? 'spin' : undefined} />}
      label={quality.label}
      title={title}
      size={compact ? 'sm' : 'md'}
    />
  );
}

/** Standalone hook for panels that need the live label (twin, telemetry). */
export function useConnectionLabel(): { label: string; detail: string } {
  const quality = useConnectionQuality();
  return useMemo(() => ({ label: quality.label, detail: quality.detail }), [quality]);
}

/** Simple ticking clock for the header. Pauses when the tab is hidden. */
export function useClock(): string {
  const now = useNow(1000);
  return useMemo(
    () =>
      new Date(now).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [now],
  );
}

/** Mount-once flag for components that should only animate once mounted. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
