/**
 * React binding for the Three.js twin.
 *
 * The scene class owns the render loop; this component owns its lifecycle.
 * The scene is created once and disposed on unmount, so navigating away from
 * the twin stops GPU work entirely.
 */

import { useEffect, useRef } from 'react';
import { TwinScene } from './TwinScene';
import { usePrefersReducedMotion } from '../hooks/useNow';
import { useUiStore } from '../store/ui';
import { useDependencyEdges, useMachines, useZones } from '../api/queries';

export function TwinCanvas({ onSceneReady }: { onSceneReady?(scene: TwinScene | null): void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TwinScene | null>(null);

  const readyRef = useRef(onSceneReady);
  readyRef.current = onSceneReady;

  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  reducedMotionRef.current = reducedMotion;

  const selectedMachineId = useUiStore((state) => state.selectedMachineId);
  const twinMode = useUiStore((state) => state.twinMode);
  const twinZoneFilter = useUiStore((state) => state.twinZoneFilter);
  const openInspector = useUiStore((state) => state.openInspector);

  const machines = useMachines();
  const zones = useZones();
  const edges = useDependencyEdges();

  // Stable callbacks: reading them through a ref keeps the effect's dependency
  // list empty, so the scene is never torn down and rebuilt.
  const handlersRef = useRef({ openInspector });
  handlersRef.current = { openInspector };

  /* ---- lifecycle: create once, dispose on unmount ---- */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new TwinScene({
      containers: host,
      reducedMotion: reducedMotionRef.current,
      callbacks: {
        onSelect: (machineId) => handlersRef.current.openInspector(machineId, 'overview'),
        onHover: () => {
          /* hover is visual only; deliberately does not re-render React */
        },
      },
    });
    sceneRef.current = scene;
    readyRef.current?.(scene);

    const onVisibility = () => scene.resize();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      scene.dispose();
      sceneRef.current = null;
      readyRef.current?.(null);
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reducedMotion);
  }, [reducedMotion]);

  /* ---- fleet reconciliation ---- */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !machines.data) return;
    scene.syncMachines(machines.data, zones.data ?? []);
  }, [machines.data, zones.data]);

  useEffect(() => {
    if (edges.data) sceneRef.current?.setDependencyEdges(edges.data);
  }, [edges.data]);

  useEffect(() => {
    sceneRef.current?.setSelected(selectedMachineId ? [selectedMachineId] : []);
  }, [selectedMachineId]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setMode(twinMode);
    if (machines.data) scene.refreshEmphasis(machines.data);
  }, [twinMode, machines.data]);

  useEffect(() => {
    sceneRef.current?.setZoneFilter(twinZoneFilter);
  }, [twinZoneFilter]);

  return <div className="twin__canvas" ref={hostRef} />;
}

/**
 * Imperative camera controls.
 *
 * Exposes a small ref-based handle the toolbar can use without re-creating the
 * scene: fit, top-down, focus asset, focus zone.
 */
export interface TwinCameraHandle {
  fit(): void;
  top(): void;
  focusMachine(machineId: string): void;
  focusZone(zone: string): void;
}

export function createTwinCameraHandle(scene: TwinScene): TwinCameraHandle {
  return {
    fit: () => scene.fit(),
    top: () => scene.topView(),
    focusMachine: (machineId) => scene.focusMachine(machineId),
    focusZone: (zone) => scene.focusZone(zone),
  };
}

/** Attach the imperative handle to the scene for toolbar use. */
export function useTwinHandle(ref: { current: TwinCameraHandle | null }, scene: TwinScene | null): void {
  useEffect(() => {
    ref.current = scene ? createTwinCameraHandle(scene) : null;
    return () => {
      ref.current = null;
    };
  }, [ref, scene]);
}
