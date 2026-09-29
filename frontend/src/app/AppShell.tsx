/**
 * The operations shell.
 *
 * Desktop: top bar / left navigation / workspace / right contextual inspector
 *          / bottom system strip.
 * Mobile:  top bar / workspace / bottom navigation, with the inspector as a
 *          bottom sheet.
 */

import { Suspense, useCallback, useEffect, useRef } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { ALL_NAV_ITEMS, MOBILE_NAV_ITEMS, NAV_GROUPS } from './routes';
import { useAuth } from '../auth/AuthProvider';
import { useUiStore } from '../store/ui';
import {
  useAlertStats,
  useMaintenanceStats,
  useMachines,
  useSystemStatus,
  useTelemetryStatus,
} from '../api/queries';
import { useRealtimeStore } from '../realtime/store';
import { ConnectionIndicator, useClock } from '../components/ConnectionIndicator';
import { MachineInspector } from '../components/inspector/MachineInspector';
import { CommandPalette } from '../components/CommandPalette';
import { IconButton, LoadingState, ToastViewport } from '../design-system';
import { config } from '../config/env';
import { resolveBasis } from '../domain/basis';
import { formatAge, formatInteger } from '../domain/format';
import { summariseFleet, factoryVerdict, ageSeconds } from '../domain/machineState';
import { useNow } from '../hooks/useNow';
import './shell.css';


export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { identity, signOut, primaryRole } = useAuth();

  const navCollapsed = useUiStore((state) => state.navCollapsed);
  const toggleNavCollapsed = useUiStore((state) => state.toggleNavCollapsed);
  const mobileNavOpen = useUiStore((state) => state.mobileNavOpen);
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen);
  const toasts = useUiStore((state) => state.toasts);
  const dismissToast = useUiStore((state) => state.dismissToast);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const closeInspector = useUiStore((state) => state.closeInspector);
  const inspectorOpen = useUiStore((state) => state.inspectorOpen);

  const clock = useClock();
  const mainRef = useRef<HTMLElement>(null);

  // Move focus to the workspace on navigation so keyboard users are not
  // stranded at the top of the document.
  //
  // Deliberately skipped on the FIRST render: stealing focus on initial load
  // would make the skip link unreachable as the first tab stop, which defeats
  // its purpose. There is no navigation to recover from on a cold start.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandPaletteOpen(true);
        return;
      }
      if (typing) return;
      if (event.key === '?') {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    },
    [setCommandPaletteOpen],
  );

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onKeyDown]);

  const currentLabel = ALL_NAV_ITEMS.find((item) => item.path === location.pathname)?.label ?? 'Operations';

  return (
    <div className="app">
      <a className="skip-link" href="#workspace">
        Skip to main content
      </a>

      <TopBar
        clock={clock}
        username={identity?.username ?? ''}
        role={primaryRole}
        onMenu={() => setMobileNavOpen(!mobileNavOpen)}
        onSignOut={signOut}
        onOpenPalette={() => setCommandPaletteOpen(true)}
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => {
          if (inspectorOpen) closeInspector();
          else navigate('/fleet');
        }}
      />

      <div className="app__body">
        <nav
          className="nav"
          data-collapsed={navCollapsed}
          data-open={mobileNavOpen}
          aria-label="Operations sections"
        >
          {NAV_GROUPS.map((group) => (
            <div className="nav__group" key={group.label}>
              <span className="nav__group-label">{navCollapsed ? group.label.slice(0, 3) : group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.path}
                  className="nav__item"
                  onClick={() => setMobileNavOpen(false)}
                  title={navCollapsed ? item.label : undefined}
                >
                  <item.icon size={16} aria-hidden />
                  <span className="nav__label">{item.label}</span>
                  <NavCount routeId={item.id} />
                </NavLink>
              ))}
            </div>
          ))}

          <div className="nav__foot">
            <button
              type="button"
              className="nav__item"
              onClick={toggleNavCollapsed}
              aria-label={navCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            >
              {navCollapsed ? <ChevronRight size={16} aria-hidden /> : <ChevronLeft size={16} aria-hidden />}
              <span className="nav__label">Collapse</span>
            </button>
          </div>
        </nav>

        <button
          type="button"
          className="nav-backdrop"
          data-open={mobileNavOpen}
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />

        <main className="app__main" id="workspace" ref={mainRef} tabIndex={-1} aria-label={currentLabel}>
          <Suspense fallback={<LoadingState label="Loading workspace…" rows={4} />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      <StatusBar />

      <nav className="bottomnav" aria-label="Primary sections">
        {MOBILE_NAV_ITEMS.map((item) => (
          <NavLink key={item.id} to={item.path} className="bottomnav__item">
            <item.icon size={18} aria-hidden />
            <span>{shortLabel(item.label)}</span>
          </NavLink>
        ))}
      </nav>

      <MachineInspector />
      <CommandPalette />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

function shortLabel(label: string): string {
  return label.replace('Command Center', 'Command').replace('Factory Twin', 'Twin');
}

/* ------------------------------------------------------------------ *
 * Top bar
 * ------------------------------------------------------------------ */

function TopBar({
  clock,
  username,
  role,
  onMenu,
  onSignOut,
  onOpenPalette,
  inspectorOpen,
  onToggleInspector,
}: {
  clock: string;
  username: string;
  role: string | null;
  onMenu(): void;
  onSignOut(): void;
  onOpenPalette(): void;
  inspectorOpen: boolean;
  onToggleInspector(): void;
}) {
  return (
    <header className="topbar">
      <IconButton
        label="Open navigation"
        icon={<Menu size={18} />}
        onClick={onMenu}
        className="topbar__menu"
      />

      <div className="topbar__brand">
        <span className="topbar__mark" aria-hidden>
          <Activity size={18} />
        </span>
        <div className="topbar__brand-text">
          <span className="topbar__name">ForgeSense</span>
          <span className="topbar__sub">Industrial Operations</span>
        </div>
      </div>

      <div className="topbar__spacer" />

      <div className="topbar__status">
        {/*
          Operational status and data provenance are deliberately separate
          elements with different visual weight. `DEGRADED` is a fact about the
          plant; `SYNTHETIC FEED` is a disclosure about the data. They must
          never read as one combined status.
        */}
        <FactoryStatus />
        {/* Two separate disclosures, deliberately both shown. The provenance
            chip states what the data *is*; this badge states the transport's
            own health and is the header's canonical connection status. A
            healthy synthetic feed therefore reads SYNTHETIC in both places —
            that redundancy is intentional on a safety disclosure, and the
            badge turns STALE/DEGRADED/OFFLINE as soon as transport is its own
            fact. The label is never softened into LIVE. */}
        <ProvenanceChip />
        <MlIndicator />
        <ConnectionIndicator />

        <div className="topbar__meta">
          <span className="topbar__clock">{clock}</span>
        </div>

        <div className="topbar__user">
          <ShieldCheck size={13} aria-hidden className="topbar__user-icon" />
          <span className="topbar__user-name">{username}</span>
          {role && <span className="topbar__user-role">{role.replace('ROLE_', '')}</span>}
        </div>

        <IconButton label="Search (Ctrl+K)" icon={<Search size={16} />} onClick={onOpenPalette} />
        <IconButton
          label={inspectorOpen ? 'Close machine inspector' : 'Open machine inspector'}
          icon={inspectorOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          onClick={onToggleInspector}
        />
        <IconButton label="Sign out" icon={<LogOut size={16} />} onClick={onSignOut} />
      </div>
    </header>
  );
}

/** Operational state of the plant. The strongest status element in the header. */
function FactoryStatus() {
  const machines = useMachines();
  const now = useNow(5000);
  const summary = summariseFleet(machines.data ?? [], now);
  const verdict = factoryVerdict(summary);

  return (
    <span className="topbar__status-block">
      <span className="topbar__factory-name">{config.plantName}</span>
      <span className="topbar__verdict" data-tone={verdict.tone} title={verdict.detail}>
        <span className="topbar__verdict-dot" aria-hidden />
        <span aria-label={`Operational status: ${verdict.verdict}. ${verdict.detail}`}>{verdict.verdict}</span>
      </span>
    </span>
  );
}

/**
 * Data provenance. A quiet, dashed, warm chip — visually distinct from every
 * operational state, so "synthetic" can never be mistaken for "degraded".
 */
function ProvenanceChip() {
  const status = useSystemStatus();
  const basis = resolveBasis(status.data?.dataBasis);
  if (basis !== 'SYNTHETIC' && basis !== 'SIMULATED') {
    return (
      <span
        className="topbar__provenance"
        style={{ borderStyle: 'solid', borderColor: 'var(--color-accent-border)', background: 'var(--color-accent-bg)', color: 'var(--color-accent-text)' }}
        title="Data provenance: observed from a system of record"
      >
        {basis} feed
      </span>
    );
  }

  return (
    <span
      className="topbar__provenance"
      title={
        'Data provenance: generated by the synthetic telemetry simulator. ' +
        'Describes no real machine. This is a disclosure, not an operational state.'
      }
    >
      Synthetic feed
    </span>
  );
}

/** ML model metadata. Violet, and the quietest element in the header. */
function MlIndicator() {
  const status = useSystemStatus();
  const available = status.data?.mlServiceAvailable ?? false;
  const loading = status.isLoading;
  const version = status.data?.mlModelVersion;

  return (
    <span
      className="topbar__ml"
      data-tone={loading ? 'pending' : available ? 'up' : 'down'}
      title={
        loading
          ? 'Checking the ML service'
          : available
            ? `Model ${version ?? 'unknown'} · predictions served by the ML service`
            : 'ML service unreachable — the backend falls back to heuristic estimates'
      }
    >
      <span>ML</span>
      <span className="topbar__ml-version">{loading ? '…' : available ? (version ?? 'ready') : 'offline'}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Navigation counts
 * ------------------------------------------------------------------ */

function NavCount({ routeId }: { routeId: string }) {
  const alerts = useAlertStats();
  const maintenance = useMaintenanceStats();

  if (routeId === 'alerts') {
    const open = alerts.data?.open;
    if (!open) return null;
    return (
      <span className="nav__count" aria-label={`${open} open alerts`}>
        {open > 99 ? '99+' : open}
      </span>
    );
  }

  if (routeId === 'maintenance') {
    const recommended = maintenance.data?.recommended ?? 0;
    if (!recommended) return null;
    return (
      <span className="nav__count" aria-label={`${recommended} recommended work orders`}>
        {recommended}
      </span>
    );
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Status strip
 * ------------------------------------------------------------------ */

function StatusBar() {
  const transport = useRealtimeStore((state) => state.transport);
  const machines = useMachines();
  const telemetryStatus = useTelemetryStatus();
  const status = useSystemStatus();
  const now = useNow(1000);

  const oldestAge = useOldestTelemetryAge(machines.data, now);
  const basis = resolveBasis(status.data?.dataBasis);

  const transportLabel =
    transport.state === 'open'
      ? 'WebSocket'
      : transport.state === 'reconnecting' || transport.state === 'connecting'
        ? 'reconnecting'
        : 'REST polling';

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        <span className="statusbar__key">Transport</span>
        <span className="statusbar__val">{transportLabel}</span>
      </span>
      <span className="statusbar__item">
        <span className="statusbar__key">Input</span>
        <span className="statusbar__val">{telemetryStatus.data?.transport ?? '—'}</span>
      </span>
      <span className="statusbar__item">
        <span className="statusbar__key">Data basis</span>
        <span className="statusbar__val">{basis}</span>
      </span>
      <span className="statusbar__item">
        <span className="statusbar__key">Oldest reading</span>
        <span className="statusbar__val">{formatAge(oldestAge)}</span>
      </span>
      <span className="statusbar__item">
        <span className="statusbar__key">Assets</span>
        <span className="statusbar__val">
          {machines.data ? formatInteger(machines.data.length) : '—'}
        </span>
      </span>
      <span className="statusbar__item">
        <span className="statusbar__key">Events applied</span>
        <span className="statusbar__val">{formatInteger(transport.eventsApplied)}</span>
      </span>
      {config.showSyntheticAdvisory && (
        <span className="statusbar__note">
          Synthetic simulator telemetry — operational visualisation only, no physical machine control.
        </span>
      )}
    </footer>
  );
}

/**
 * Age of the oldest asset reading, recomputed at 1 Hz.
 *
 * `useShallow` is the wrong tool here: it memoises an *object* for object
 * selectors, not a computed scalar. The reading ages are mapped to a primitive
 * signature so the memo depends on what actually matters.
 */
function useOldestTelemetryAge(
  machines: ReturnType<typeof useMachines>['data'],
  now: number,
): number | null {
  const ages = (machines ?? [])
    .map((machine) => ageSeconds(machine.lastTelemetryAt, now))
    .filter((age): age is number => age !== null);
  const oldest = ages.length > 0 ? Math.max(...ages) : null;
  return oldest;
}
