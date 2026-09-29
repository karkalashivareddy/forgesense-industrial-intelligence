/**
 * Route table.
 *
 * Navigation is grouped by operator intent rather than by feature module.
 * Heavy views (the 3D twin and analytics) are lazily loaded so the shell,
 * authentication and command centre are small and fast to first paint.
 */

import { lazy } from 'react';
import {
  Activity,
  AlertOctagon,
  BarChart3,
  Boxes,
  Cpu,
  Factory,
  FlaskConical,
  Gauge,
  ListTree,
  Radar,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type RouteId =
  | 'command'
  | 'twin'
  | 'fleet'
  | 'telemetry'
  | 'predictions'
  | 'anomalies'
  | 'analytics'
  | 'alerts'
  | 'maintenance'
  | 'events'
  | 'simulation'
  | 'system';

export interface NavItem {
  id: RouteId;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Shown on the mobile bottom bar. */
  primary?: boolean;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operations',
    items: [
      { id: 'command', label: 'Command Center', path: '/command', icon: Gauge, primary: true },
      { id: 'twin', label: 'Factory Twin', path: '/twin', icon: Boxes, primary: true },
      { id: 'fleet', label: 'Fleet', path: '/fleet', icon: Factory, primary: true },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'telemetry', label: 'Telemetry', path: '/telemetry', icon: Activity },
      { id: 'predictions', label: 'Predictions', path: '/predictions', icon: Radar, primary: true },
      { id: 'anomalies', label: 'Anomalies', path: '/anomalies', icon: ListTree },
      { id: 'analytics', label: 'Analytics', path: '/analytics', icon: BarChart3 },
    ],
  },
  {
    label: 'Work',
    items: [
      { id: 'alerts', label: 'Alerts', path: '/alerts', icon: AlertOctagon },
      { id: 'maintenance', label: 'Maintenance', path: '/maintenance', icon: Wrench },
      { id: 'simulation', label: 'Simulation Lab', path: '/simulation', icon: FlaskConical },
      { id: 'events', label: 'Event Stream', path: '/events', icon: ListTree },
    ],
  },
  {
    label: 'Platform',
    items: [{ id: 'system', label: 'System', path: '/system', icon: Cpu }],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export const MOBILE_NAV_ITEMS: NavItem[] = ALL_NAV_ITEMS.filter((item) => item.primary);

export const DEFAULT_ROUTE: RouteId = 'command';

/* Lazy route modules — each becomes its own chunk. */
export const CommandCenterRoute = lazy(() => import('../routes/CommandCenter'));
export const FactoryTwinRoute = lazy(() => import('../routes/FactoryTwin'));
export const FleetRoute = lazy(() => import('../routes/Fleet'));
export const TelemetryRoute = lazy(() => import('../routes/Telemetry'));
export const PredictionsRoute = lazy(() => import('../routes/Predictions'));
export const AnomaliesRoute = lazy(() => import('../routes/Anomalies'));
export const AnalyticsRoute = lazy(() => import('../routes/Analytics'));
export const AlertsRoute = lazy(() => import('../routes/Alerts'));
export const MaintenanceRoute = lazy(() => import('../routes/Maintenance'));
export const EventsRoute = lazy(() => import('../routes/EventStream'));
export const SimulationRoute = lazy(() => import('../routes/SimulationLab'));
export const SystemRoute = lazy(() => import('../routes/SystemHealth'));
