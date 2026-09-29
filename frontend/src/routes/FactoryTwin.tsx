/**
 * Factory Digital Twin workspace.
 *
 * The twin is a comprehension tool, not decoration: it answers "where in the
 * plant is the problem, and what does it depend on". The toolbar exposes
 * camera, zone and encoding controls; the asset list provides a keyboard-
 * equivalent path to every machine so the 3D view is never the only way in.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Crosshair, FlaskConical, Grid3x3, Info, LayoutGrid, Network, Radar } from 'lucide-react';
import { TwinCanvas } from '../three/useTwinCanvas';
import type { TwinScene } from '../three/TwinScene';
import { Button, EmptyState, IconButton, SectionHeader, StatusBadge } from '../design-system';
import { useConnectionLabel } from '../components/ConnectionIndicator';
import { useDependencyEdges, useMachines, useSimulationControls, useZones } from '../api/queries';
import { useUiStore, type TwinMode } from '../store/ui';
import { deriveOperationalState } from '../domain/machineState';
import { titleCase } from '../domain/format';
import { useNow } from '../hooks/useNow';
import { config } from '../config/env';

const MODES: { id: TwinMode; label: string; icon: typeof Radar; hint: string }[] = [
  { id: 'status', label: 'Status', icon: LayoutGrid, hint: 'Colour each asset by operational state' },
  { id: 'risk', label: 'Risk', icon: Radar, hint: 'Emphasise assets with elevated predicted failure risk' },
  { id: 'dependencies', label: 'Dependencies', icon: Network, hint: 'Show material, power, cooling and service edges' },
];

const LEGEND: { label: string; tone: string }[] = [
  { label: 'Normal', tone: 'ok' },
  { label: 'Degraded', tone: 'warn' },
  { label: 'Warning', tone: 'warn' },
  { label: 'Critical', tone: 'crit' },
  { label: 'Maintenance', tone: 'maint' },
  { label: 'Offline / stale', tone: 'idle' },
];
const RELATION_LEGEND = [
  { label: 'Material', colour: 'var(--color-accent)' },
  { label: 'Power', colour: 'var(--color-info)' },
  { label: 'Cooling', colour: 'var(--color-maintenance)' },
  { label: 'Service', colour: 'var(--color-text-muted)' },
];

export default function FactoryTwin() {
  const machinesQuery = useMachines();
  const zonesQuery = useZones();
  const controlsQuery = useSimulationControls();
  void useDependencyEdges();

  const connection = useConnectionLabel();
  const now = useNow(3000);

  const selectedMachineId = useUiStore((state) => state.selectedMachineId);
  const twinMode = useUiStore((state) => state.twinMode);
  const setTwinMode = useUiStore((state) => state.setTwinMode);
  const twinZoneFilter = useUiStore((state) => state.twinZoneFilter);
  const setTwinZoneFilter = useUiStore((state) => state.setTwinZoneFilter);
  const openInspector = useUiStore((state) => state.openInspector);

  const sceneRef = useRef<TwinScene | null>(null);
  const [assetPanelOpen, setAssetPanelOpen] = useState(false);

  const onSceneReady = useCallback((scene: TwinScene | null) => {
    sceneRef.current = scene;
  }, []);

  // Focus the selected asset whenever selection changes from anywhere in the app.
  useEffect(() => {
    if (selectedMachineId) sceneRef.current?.focusMachine(selectedMachineId);
  }, [selectedMachineId]);

  const machines = machinesQuery.data ?? [];
  const zones = zonesQuery.data ?? [];

  const zoneCounts = useMemo(() => {
    const counts = new Map<string, { total: number; attention: number }>();
    for (const machine of machines) {
      const derived = deriveOperationalState(machine, now);
      const entry = counts.get(machine.zone) ?? { total: 0, attention: 0 };
      entry.total += 1;
      if (['CRITICAL', 'WARNING', 'DEGRADED', 'OFFLINE', 'STALE'].includes(derived.state)) entry.attention += 1;
      counts.set(machine.zone, entry);
    }
    return counts;
  }, [machines, now]);

  const activeSimulations = (controlsQuery.data ?? []).filter((control) => control.active);
  const selected = machines.find((machine) => machine.machineId === selectedMachineId);

  return (
    <div className="workspace" style={{ flex: '1 1 auto', minHeight: 0 }}>
      <SectionHeader
        title="Factory Twin"
        description={`Spatial view of ${config.plantName}. Selection is shared with every other workspace.`}
        actions={
          <StatusBadge
            tone={connection.label === 'SYNTHETIC' ? 'info' : connection.label === 'LIVE' ? 'ok' : 'warn'}
            icon={<Info size={12} aria-hidden />}
            label={connection.label}
            title={connection.detail}
          />
        }
      />

      {activeSimulations.length > 0 && (
        <div className="banner banner--sim" role="status">
          <FlaskConical size={13} aria-hidden style={{ flexShrink: 0 }} />
          <span>
            SIMULATION MODE â€” a what-if scenario is active on{' '}
            {activeSimulations.map((control) => control.machineId).join(', ')}. This changes the synthetic feed only;
            no physical machine is controlled.
          </span>
        </div>
      )}

      <div className="twin">
        <div className="twin__overlay">
          <div className="twin__toolbar">
            <div className="twin__group" role="group" aria-label="Camera controls">
              <IconButton label="Fit factory in view" icon={<Crosshair size={14} />} onClick={() => sceneRef.current?.fit()} />
              <IconButton label="Top-down view" icon={<Grid3x3 size={14} />} onClick={() => sceneRef.current?.topView()} />
            </div>

            <div className="twin__group" role="group" aria-label="Encoding mode">
              {MODES.map((mode) => (
                <Button
                  key={mode.id}
                  size="sm"
                  variant="ghost"
                  onClick={() => setTwinMode(mode.id)}
                  title={mode.hint}
                  aria-pressed={twinMode === mode.id}
                >
                  <mode.icon size={13} aria-hidden />
                  {mode.label}
                </Button>
              ))}
            </div>

            <div className="twin__group" role="group" aria-label="Zone filter">
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={twinZoneFilter === null}
                onClick={() => setTwinZoneFilter(null)}
              >
                All zones
              </Button>
              {zones.map((zone) => {
                const counts = zoneCounts.get(zone.code);
                if (!counts) return null;
                return (
                  <Button
                    key={zone.code}
                    size="sm"
                    variant="ghost"
                    aria-pressed={twinZoneFilter === zone.code}
                    onClick={() => {
                      const next = twinZoneFilter === zone.code ? null : zone.code;
                      setTwinZoneFilter(next);
                      if (next) sceneRef.current?.focusZone(next);
                    }}
                  >
                    {zone.name}
                    <span className="tiny muted">
                      {counts.total}
                      {counts.attention > 0 ? ` Â· ${counts.attention}!` : ''}
                    </span>
                  </Button>
                );
              })}
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAssetPanelOpen((open) => !open)}
              aria-expanded={assetPanelOpen}
            >
              <Boxes size={13} aria-hidden />
              Assets ({machines.length})
            </Button>
          </div>

          {selected && (
            <div className="twin__sim-banner" style={{ top: 'var(--space-12)' }}>
              <span className="mono">{selected.machineId}</span>
              <span>{selected.name}</span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => openInspector(selected.machineId, 'overview')}
              >
                Inspect
              </Button>
            </div>
          )}

          {assetPanelOpen && (
            <div className="twin__asset-list" role="list" aria-label="Factory assets">
              {machines.length === 0 ? (
                <EmptyState title="No assets" description="Waiting for the machine snapshot." />
              ) : (
                machines.map((machine) => {
                  const derived = deriveOperationalState(machine, now);
                  return (
                    <button
                      key={machine.machineId}
                      type="button"
                      role="listitem"
                      className="twin__asset"
                      aria-pressed={selectedMachineId === machine.machineId}
                      onClick={() => openInspector(machine.machineId, 'overview')}
                      onFocus={() => sceneRef.current?.focusMachine(machine.machineId)}
                    >
                      <span className="twin__dot" data-tone={derived.descriptor.tone} aria-hidden />
                      <b>{machine.machineId}</b>
                      <small>{machine.name}</small>
                    </button>
                  );
                })
              )}
            </div>
          )}

          <p className="twin__mode-hint">
            {MODES.find((mode) => mode.id === twinMode)?.hint}
          </p>

          <div className="twin__legend" role="list" aria-label="Machine status legend">
            {LEGEND.map((entry) => (
              <span className="twin__legend-item" key={entry.label} role="listitem">
                <span className="twin__legend-swatch" data-tone={entry.tone} aria-hidden />
                {entry.label}
              </span>
            ))}
            {twinMode === 'dependencies' &&
              RELATION_LEGEND.map((entry) => (
                <span className="twin__legend-item" key={entry.label}>
                  <span className="twin__legend-swatch" style={{ background: entry.colour }} aria-hidden />
                  {entry.label}
                </span>
              ))}
          </div>

          <p className="twin__hint">
            Drag to orbit Â· scroll to zoom Â· click a machine to inspect it. Every machine is also reachable from the
            asset list and the command palette.
          </p>
        </div>

        <TwinCanvas onSceneReady={onSceneReady} />
      </div>

      <p className="note">
        The twin renders a modelled layout of the simulated plant. Machine bodies are representative geometry, not
        surveyed plant models. State shown here is derived from the same live snapshot as every other workspace.
        {zones.length > 0 && ` Zones: ${zones.map((zone) => titleCase(zone.name)).join(', ')}.`}
      </p>
    </div>
  );
}
