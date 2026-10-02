/**
 * Selection + workspace UI state.
 *
 * The selected machine is application-wide: choosing M-105 in the twin must
 * also scope Fleet, Telemetry, Predictions, Alerts and Maintenance. Keeping it
 * in one small store makes that contract explicit and makes selection survive
 * route changes.
 */

import { create } from 'zustand';

export type InspectorTab = 'overview' | 'telemetry' | 'prediction' | 'alerts' | 'maintenance' | 'events';

export type TwinMode = 'status' | 'risk' | 'dependencies';

export type ToastTone = 'info' | 'ok' | 'warn' | 'crit';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
  /** ms; null keeps the toast until dismissed. */
  ttlMs: number | null;
}

interface UiState {
  selectedMachineId: string | null;
  inspectorOpen: boolean;
  inspectorTab: InspectorTab;
  /** True when the inspector is a modal bottom sheet (mobile). */
  inspectorReturnFocus: HTMLElement | null;
  /**
   * Sensor an attribution driver pointed the operator at. Set when a
   * prediction factor is activated, cleared once the telemetry view has
   * scrolled to it. Null means "no specific instrument".
   */
  focusSensor: string | null;

  navCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;

  twinMode: TwinMode;
  twinZoneFilter: string | null;
  /** Machine highlighted because a prediction driver points at it. */
  twinFocusRequest: number;

  toasts: Toast[];

  select(machineId: string | null, tab?: InspectorTab): void;
  openInspector(machineId: string, tab?: InspectorTab, returnFocus?: HTMLElement | null): void;
  closeInspector(): void;
  setInspectorTab(tab: InspectorTab): void;
  setFocusSensor(sensor: string | null): void;

  setNavCollapsed(collapsed: boolean): void;
  toggleNavCollapsed(): void;
  setMobileNavOpen(open: boolean): void;
  setCommandPaletteOpen(open: boolean): void;

  setTwinMode(mode: TwinMode): void;
  setTwinZoneFilter(zone: string | null): void;
  requestTwinFocus(): void;

  pushToast(tone: ToastTone, message: string, ttlMs?: number | null): void;
  dismissToast(id: number): void;
}

let toastSeq = 0;

export const useUiStore = create<UiState>((set) => ({
  selectedMachineId: null,
  inspectorOpen: false,
  inspectorTab: 'overview',
  inspectorReturnFocus: null,
  focusSensor: null,

  navCollapsed: false,
  mobileNavOpen: false,
  commandPaletteOpen: false,

  twinMode: 'status',
  twinZoneFilter: null,
  twinFocusRequest: 0,

  toasts: [],

  select: (machineId, tab) =>
    set(() =>
      machineId === null
        ? { selectedMachineId: null }
        : {
            selectedMachineId: machineId,
            ...(tab ? { inspectorTab: tab } : {}),
          },
    ),

  openInspector: (machineId, tab = 'overview', returnFocus = null) =>
    set((state) => ({
      selectedMachineId: machineId,
      inspectorOpen: true,
      inspectorTab: tab,
      inspectorReturnFocus: returnFocus ?? state.inspectorReturnFocus,
    })),

  closeInspector: () => set({ inspectorOpen: false, inspectorReturnFocus: null, focusSensor: null }),

  setInspectorTab: (tab) => set({ inspectorTab: tab }),
  setFocusSensor: (sensor) => set({ focusSensor: sensor }),

  setNavCollapsed: (navCollapsed) => set({ navCollapsed }),
  toggleNavCollapsed: () => set((state) => ({ navCollapsed: !state.navCollapsed })),

  setMobileNavOpen: (mobileNavOpen) => set({ mobileNavOpen }),
  setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),

  setTwinMode: (twinMode) => set({ twinMode }),
  setTwinZoneFilter: (twinZoneFilter) => set({ twinZoneFilter }),
  requestTwinFocus: () => set((state) => ({ twinFocusRequest: state.twinFocusRequest + 1 })),

  pushToast: (tone, message, ttlMs = 6000) => {
    const id = ++toastSeq;
    set((state) => ({ toasts: [...state.toasts.slice(-4), { id, tone, message, ttlMs }] }));
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Imperative helpers for use outside React components. */
export const uiActions = {
  toast: (tone: ToastTone, message: string, ttlMs?: number | null) =>
    useUiStore.getState().pushToast(tone, message, ttlMs),
  select: (machineId: string | null, tab?: InspectorTab) =>
    useUiStore.getState().select(machineId, tab),
  openInspector: (machineId: string, tab?: InspectorTab, element?: HTMLElement | null) =>
    useUiStore.getState().openInspector(machineId, tab, element),
  closeInspector: () => useUiStore.getState().closeInspector(),
  setFocusSensor: (sensor: string | null) => useUiStore.getState().setFocusSensor(sensor),
};