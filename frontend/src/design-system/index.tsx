/**
 * ForgeSense design-system primitives.
 *
 * Every visual element in the control room is composed from this file. There
 * are no one-off colours, radii or spacing values in feature code: components
 * take a semantic `tone` and the primitives map it to tokens.
 */

import {
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XOctagon } from 'lucide-react';
import type { StateTone } from '../domain/machineState';
import { describeBasis, type DataBasis } from '../domain/basis';
import { useFocusTrapRef } from '../hooks/useFocusTrap';

/* ================================================================== *
 * Tone mapping
 *
 * Tones are the semantic colours of the token system. `intelligence` is
 * violet and reserved for model output; `synthetic` is the quiet warm amber
 * used for provenance disclosure.
 * ================================================================== */

export type Tone = StateTone | 'neutral' | 'intelligence' | 'synthetic';

/**
 * Tone resolution.
 *
 * `Tone` describes a *machine or system state*, so it never includes violet:
 * violet is reserved for model output and is applied explicitly via the
 * `intelligence` tone or the BasisChip. That separation is what stops a
 * predicted value from being read as an observed condition.
 */
const TONE_TEXT: Record<Tone, string> = {
  ok: 'var(--state-ok-text)',
  warn: 'var(--state-warning-text)',
  crit: 'var(--state-critical-text)',
  maint: 'var(--state-maint-text)',
  idle: 'var(--state-idle-text)',
  info: 'var(--state-info-text)',
  neutral: 'var(--color-text-secondary)',
  intelligence: 'var(--color-intelligence-text)',
  synthetic: 'var(--color-synthetic-text)',
};

const TONE_BORDER: Record<Tone, string> = {
  ok: 'var(--state-ok)',
  warn: 'var(--state-warning)',
  crit: 'var(--state-critical)',
  maint: 'var(--state-maint)',
  idle: 'var(--state-idle)',
  info: 'var(--state-info)',
  neutral: 'var(--color-border-default)',
  intelligence: 'var(--color-intelligence)',
  synthetic: 'var(--color-synthetic)',
};

const TONE_WASH: Record<Tone, string> = {
  ok: 'var(--state-ok-bg)',
  warn: 'var(--state-warning-bg)',
  crit: 'var(--state-critical-bg)',
  maint: 'var(--state-maint-bg)',
  idle: 'var(--state-idle-bg)',
  info: 'var(--state-info-bg)',
  neutral: 'var(--color-bg-panel-elevated)',
  intelligence: 'var(--color-intelligence-bg)',
  synthetic: 'var(--color-synthetic-bg)',
};

/* ================================================================== *
 * Button / IconButton
 * ================================================================== */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  tone?: Tone;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', tone, loading = false, icon, children, className = '', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`btn btn--${variant} btn--${size} ${className}`}
      data-tone={tone}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={size === 'sm' ? 13 : 15} className="btn__spinner" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  icon?: ReactNode;
  size?: ButtonSize;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, size = 'md', active = false, className = '', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={`iconbtn iconbtn--${size} ${className}`}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      data-active={active || undefined}
      {...rest}
    >
      {icon}
    </button>
  );
});

/* ================================================================== *
 * Badge / StatusBadge
 * ================================================================== */

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  size?: 'sm' | 'md';
}

export function Badge({ tone = 'neutral', size = 'sm', className = '', children, ...rest }: BadgeProps) {
  return (
    <span
      className={`badge badge--${size} ${className}`}
      data-tone={tone}
      style={{ color: TONE_TEXT[tone], background: TONE_WASH[tone], borderColor: TONE_BORDER[tone] }}
      {...rest}
    >
      {children}
    </span>
  );
}

export interface StatusBadgeProps {
  tone: Tone;
  /** Icon carries the meaning so colour is never the only signal. */
  icon?: ReactNode;
  label: string;
  title?: string;
  size?: 'sm' | 'md';
}

export function StatusBadge({ tone, icon, label, title, size = 'sm' }: StatusBadgeProps) {
  return (
    <span
      className={`statusbadge statusbadge--${size}`}
      data-tone={tone}
      style={{ color: TONE_TEXT[tone], background: TONE_WASH[tone], borderColor: TONE_BORDER[tone] }}
      title={title ?? label}
    >
      {icon && <span className="statusbadge__icon" aria-hidden>{icon}</span>}
      <span className="statusbadge__label">{label}</span>
    </span>
  );
}

/* ================================================================== *
 * Data basis chip
 * ================================================================== */

export interface BasisChipProps {
  basis: DataBasis;
  compact?: boolean;
}

/**
 * Provenance badge.
 *
 * The compact form is an initialism, NOT a truncation: "Mod" cut out of
 * "Model predicted" is meaningless, so each basis declares its own short form.
 */
const BASIS_SHORT: Record<DataBasis, string> = {
  OBSERVED: 'OBS',
  DERIVED: 'DER',
  PREDICTED: 'ML',
  SYNTHETIC: 'SYN',
  SIMULATED: 'SIM',
  UNAVAILABLE: 'N/A',
};

export function BasisChip({ basis, compact = false }: BasisChipProps) {
  const descriptor = describeBasis(basis);
  return (
    <span
      className="basis-chip"
      data-basis={basis}
      style={{
        color: `var(--color-${basis.toLowerCase()}-text)`,
        borderColor: `var(--color-${basis.toLowerCase()}-border)`,
        background: `var(--color-${basis.toLowerCase()}-bg)`,
      }}
      title={`${descriptor.label} â€” ${descriptor.meaning}`}
    >
      <span aria-hidden className="basis-chip__dot" style={{ background: `var(--color-${basis.toLowerCase()})` }} />
      {compact ? BASIS_SHORT[basis] : descriptor.label}
    </span>
  );
}

/* ================================================================== *
 * Panel
 * ================================================================== */

export interface PanelProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Removes internal padding for tables/graphs that manage their own. */
  flush?: boolean;
  tone?: Tone;
}

export function Panel({ title, subtitle, actions, flush = false, tone, className = '', children, ...rest }: PanelProps) {
  return (
    <section
      className={`panel ${className}`}
      data-tone={tone}
      style={tone ? { borderColor: TONE_BORDER[tone] } : undefined}
      {...rest}
    >
      {(title || actions) && (
        <header className="panel__head">
          <div className="panel__heading">
            {title && <h2 className="panel__title">{title}</h2>}
            {subtitle && <p className="panel__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="panel__actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'panel__body panel__body--flush' : 'panel__body'}>{children}</div>
    </section>
  );
}

export function SectionHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="section-header">
      <div>
        <h1 className="section-header__title">{title}</h1>
        {description && <p className="section-header__description">{description}</p>}
      </div>
      {actions && <div className="section-header__actions">{actions}</div>}
    </header>
  );
}

/* ================================================================== *
 * Metric â€” KPI tile
 *
 * Design rule: the semantic colour identifies the meaning of the number
 * without colouring the whole card. The value is the focus; a thin top
 * accent bar and the provenance chip carry the semantics.
 * ================================================================== */

export interface MetricProps {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  basis?: DataBasis;
  /** Semantic accent. Prefer `intelligence` for model output. */
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
}

export function Metric({ label, value, unit, hint, basis, tone = 'neutral', size = 'md', icon }: MetricProps) {
  return (
    <div className={`metric metric--${size}`} data-tone={tone}>
      <span className="metric__accent" aria-hidden />
      <div className="metric__label">
        {icon && <span className="metric__icon" aria-hidden>{icon}</span>}
        <span>{label}</span>
      </div>
      <div className="metric__value" style={tone !== 'neutral' ? { color: TONE_TEXT[tone] } : undefined}>
        {value}
        {unit && <span className="metric__unit">{unit}</span>}
      </div>
      {(hint || basis) && (
      <div className="metric__foot">
        {hint && <span className="metric__hint">{hint}</span>}
        {basis && <BasisChip basis={basis} />}
      </div>
      )}
    </div>
  );
}

/* ================================================================== *
 * Health + Risk indicators
 * ================================================================== */

export function HealthIndicator({ score, label = 'Health' }: { score: number | null | undefined; label?: string }) {
  const value = typeof score === 'number' && Number.isFinite(score) ? score : null;
  const tone: Tone = value === null ? 'idle' : value < 60 ? 'crit' : value < 80 ? 'warn' : 'ok';
  return (
    <div className="meter" data-tone={tone}>
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value num" style={{ color: TONE_TEXT[tone] }}>
          {value === null ? 'â€”' : value.toFixed(1)}
        </span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-valuenow={value ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="meter__fill"
          style={{ width: `${value === null ? 0 : Math.max(0, Math.min(100, value))}%`, background: TONE_BORDER[tone] }}
        />
      </div>
    </div>
  );
}

export function RiskIndicator({ risk, label = 'Failure risk' }: { risk: number | null | undefined; label?: string }) {
  const value = typeof risk === 'number' && Number.isFinite(risk) ? risk : null;
  const pctValue = value === null ? 0 : Math.max(0, Math.min(100, value * 100));
  const tone: Tone = value === null ? 'idle' : value >= 0.8 ? 'crit' : value >= 0.5 ? 'warn' : value >= 0.3 ? 'warn' : 'ok';
  return (
    <div className="meter" data-tone={tone}>
      <div className="meter__head">
        <span className="meter__label">{label}</span>
        <span className="meter__value num" style={{ color: TONE_TEXT[tone] }}>
          {value === null ? 'â€”' : `${pctValue < 0.01 && pctValue > 0 ? '<0.01' : pctValue.toFixed(pctValue < 1 ? 3 : 1)}%`}
        </span>
      </div>
      <div
        className="meter__track"
        role="meter"
        aria-valuenow={value === null ? undefined : Math.round(pctValue)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="meter__fill" style={{ width: `${pctValue}%`, background: TONE_BORDER[tone] }} />
      </div>
    </div>
  );
}

/* ================================================================== *
 * Tabs â€” correct ARIA tab semantics
 * ================================================================== */

export interface TabDefinition {
  id: string;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

export interface TabsProps {
  tabs: TabDefinition[];
  active: string;
  onChange(id: string): void;
  label: string;
  className?: string;
}

export function Tabs({ tabs, active, onChange, label, className = '' }: TabsProps) {
  const refs = useRef(new Map<string, HTMLButtonElement>());

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((tab) => tab.id === active);
    if (index < 0) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = tabs[nextIndex];
    if (!next) return;
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };

  return (
    <div className={`tabs ${className}`} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              if (node) refs.current.set(tab.id, node);
              else refs.current.delete(tab.id);
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className="tabs__tab"
            onClick={() => onChange(tab.id)}
          >
            {tab.icon && <span aria-hidden className="tabs__icon">{tab.icon}</span>}
            <span>{tab.label}</span>
            {tab.badge}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, active, children, className = '' }: { id: string; active: boolean; children: ReactNode; className?: string }) {
  if (!active) return null;
  return (
    <div role="tabpanel" id={`tabpanel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0} className={`tabpanel ${className}`}>
      {children}
    </div>
  );
}

/* ================================================================== *
 * Drawer â€” focus trap, focus restoration, dialog semantics
 * ================================================================== */

function useFocusTrap(active: boolean, onClose: () => void) {
  return useFocusTrapRef(active, onClose);
}

export interface DrawerProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  subtitle?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  /** Renders as a bottom sheet below the tablet breakpoint. */
  labelId?: string;
}

export function Drawer({ open, onClose, title, subtitle, headerExtra, children, footer, width = 420 }: DrawerProps) {
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();

  if (!open) return null;

  return createPortal(
    <div className="drawer-root">
      <div className="drawer__scrim" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ ['--drawer-w' as string]: `${width}px` }}
      >
        <header className="drawer__head">
          <div className="drawer__heading">
            <h2 id={titleId} className="drawer__title">
              {title}
            </h2>
            {subtitle && <p className="drawer__subtitle">{subtitle}</p>}
          </div>
          <div className="drawer__head-actions">
            {headerExtra}
            <IconButton label="Close inspector" icon={<X size={16} />} onClick={onClose} size="sm" />
          </div>
        </header>
        <div className="drawer__body">{children}</div>
        {footer && <footer className="drawer__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ================================================================== *
 * Modal
 * ================================================================== */

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, children, footer, width = 560 }: ModalProps) {
  const ref = useFocusTrap(open, onClose);
  const titleId = useId();
  if (!open) return null;

  return createPortal(
    <div className="modal-root">
      <div className="modal__scrim" onClick={onClose} aria-hidden />
      <div ref={ref} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ width }}>
        <header className="modal__head">
          <h2 id={titleId} className="modal__title">
            {title}
          </h2>
          <IconButton label="Close dialog" icon={<X size={16} />} onClick={onClose} size="sm" />
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ================================================================== *
 * States: loading / empty / error / stale
 * ================================================================== */

export function Skeleton({ width = '100%', height = 14, radius = 3 }: { width?: string; height?: number; radius?: number }) {
  return <div className="skeleton" style={{ width, height, borderRadius: radius }} aria-hidden />;
}

export function LoadingState({ label = 'Loadingâ€¦', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <div className="state__icon" aria-hidden>
        <Loader2 size={18} className="spin" />
      </div>
      <p className="state__title">{label}</p>
      <div className="state__skeleton">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} height={index === 0 ? 22 : 13} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state state--empty">
      {icon && <div className="state__icon" aria-hidden>{icon}</div>}
      <p className="state__title">{title}</p>
      {description && <p className="state__description">{description}</p>}
      {action && <div className="state__action">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this data',
  description,
  onRetry,
  retrying = false,
}: {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div className="state state--error" role="alert">
      <div className="state__icon" aria-hidden style={{ color: 'var(--color-critical-text)' }}>
        <XOctagon size={18} />
      </div>
      <p className="state__title">{title}</p>
      {description && <p className="state__description">{description}</p>}
      {onRetry && (
        <div className="state__action">
          <Button size="sm" onClick={onRetry} loading={retrying}>
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}

export function StaleBanner({ ageLabel, onRefresh }: { ageLabel: string; onRefresh?: () => void }) {
  return (
    <div className="stale-banner" role="status">
      <AlertTriangle size={14} aria-hidden />
      <span>Showing the last known data from {ageLabel}.</span>
      {onRefresh && (
        <button type="button" className="stale-banner__action" onClick={onRefresh}>
          Refresh now
        </button>
      )}
    </div>
  );
}

/* ================================================================== *
 * DataTable
 * ================================================================== */

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Returning null renders the empty marker. */
  cell(row: T, index: number): ReactNode;
  align?: 'start' | 'end' | 'center';
  width?: string;
  /** Hidden below the given breakpoint to keep narrow viewports readable. */
  hideBelow?: 'sm' | 'md' | 'lg';
  sortable?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey(row: T, index: number): string;
  onRowClick?(row: T): void;
  selectedKey?: string | null;
  caption: string;
  emptyMessage?: ReactNode;
  sort?: { key: string; direction: 'asc' | 'desc' } | null;
  onSortChange?(key: string): void;
  /** Sticky header for long tables. */
  stickyHeader?: boolean;
  maxHeight?: number;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  selectedKey = null,
  caption,
  emptyMessage = 'No rows to display.',
  sort = null,
  onSortChange,
  stickyHeader = false,
  maxHeight,
}: DataTableProps<T>) {
  const interactive = Boolean(onRowClick);
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
      <table className="dtable">
        <caption className="sr-only">{caption}</caption>
        <thead className={stickyHeader ? 'dtable__head--sticky' : undefined}>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={{ width: column.width, textAlign: column.align ?? 'start' }}
                data-hide-below={column.hideBelow}
                aria-sort={
                  sort?.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined
                }
              >
                {column.sortable && onSortChange ? (
                  <button
                    type="button"
                    className="dtable__sort"
                    onClick={() => onSortChange(column.key)}
                    style={{ justifyContent: column.align === 'end' ? 'flex-end' : 'flex-start' }}
                  >
                    {column.header}
                    <span aria-hidden className="dtable__sort-icon">
                      {sort?.key === column.key ? (sort.direction === 'asc' ? 'â–²' : 'â–¼') : 'â†•'}
                    </span>
                  </button>
                ) : (
                  column.header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="dtable__empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row, index);
              const selected = key === selectedKey;
              return (
                <tr
                  key={key}
                  className={selected ? 'is-selected' : undefined}
                  data-interactive={interactive || undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onClick={interactive ? () => onRowClick?.(row) : undefined}
                  onKeyDown={
                    interactive
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onRowClick?.(row);
                          }
                        }
                      : undefined
                  }
                  aria-selected={selected || undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      style={{ textAlign: column.align ?? 'start' }}
                      data-hide-below={column.hideBelow}
                    >
                      {column.cell(row, index)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================== *
 * Timeline
 * ================================================================== */

export interface TimelineEntry {
  id: string;
  timestamp: string;
  title: ReactNode;
  description?: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}

export function Timeline({ entries, emptyLabel = 'No activity recorded.' }: { entries: TimelineEntry[]; emptyLabel?: string }) {
  if (entries.length === 0) {
    return <EmptyState icon={<Info size={18} />} title={emptyLabel} />;
  }
  return (
    <ol className="timeline">
      {entries.map((entry) => (
        <li key={entry.id} className="timeline__item" data-tone={entry.tone ?? 'neutral'}>
          <span className="timeline__marker" aria-hidden>
            {entry.icon ?? <span className="timeline__dot" style={{ background: TONE_BORDER[entry.tone ?? 'neutral'] }} />}
          </span>
          <div className="timeline__body">
            <div className="timeline__head">
              <span className="timeline__title">{entry.title}</span>
              <time className="timeline__time num">{entry.timestamp}</time>
            </div>
            {entry.description && <p className="timeline__description">{entry.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/* ================================================================== *
 * Toast
 * ================================================================== */

const TOAST_ICON: Record<string, ReactNode> = {
  ok: <CheckCircle2 size={15} />,
  warn: <AlertTriangle size={15} />,
  crit: <XOctagon size={15} />,
  info: <Info size={15} />,
};

export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: { id: number; tone: 'info' | 'ok' | 'warn' | 'crit'; message: string; ttlMs: number | null }[];
  onDismiss(id: number): void;
}) {
  return (
    <div className="toasts" role="region" aria-label="Notifications">
      <div aria-live="polite" aria-atomic="false" className="toasts__inner">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
        ))}
      </div>
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: { id: number; tone: 'info' | 'ok' | 'warn' | 'crit'; message: string; ttlMs: number | null };
  onDismiss(id: number): void;
}) {
  useEffect(() => {
    if (toast.ttlMs === null) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.ttlMs);
    return () => clearTimeout(timer);
  }, [toast.id, toast.ttlMs, onDismiss]);

  return (
    <div className="toast" data-tone={toast.tone} role={toast.tone === 'crit' ? 'alert' : 'status'}>
      <span className="toast__icon" aria-hidden style={{ color: TONE_TEXT[toast.tone] }}>
        {TOAST_ICON[toast.tone]}
      </span>
      <span className="toast__message">{toast.message}</span>
      <button type="button" className="toast__close" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
        <X size={13} />
      </button>
    </div>
  );
}

/* ================================================================== *
 * Sparkline â€” cheap inline SVG, no chart library
 * ================================================================== */

export function Sparkline({
  values,
  width = 96,
  height = 24,
  tone = 'info',
  label,
  showLast = true,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  label: string;
  showLast?: boolean;
}) {
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const step = width / (values.length - 1);
    return values
      .map((value, index) => {
        const x = index * step;
        const y = height - ((value - min) / range) * (height - 2) - 1;
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [values, width, height]);

  const last = values.length > 0 ? (values[values.length - 1] ?? null) : null;

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}${last !== null ? `. Latest ${last}` : '. No data'}`}
      preserveAspectRatio="none"
    >
      {path && (
        <>
          <path d={path} fill="none" stroke={TONE_BORDER[tone]} strokeWidth={1.5} strokeLinejoin="round" />
          {showLast && last !== null && (
            <circle
              cx={width - 1}
              cy={height - ((last - Math.min(...values)) / (Math.max(...values) - Math.min(...values) || 1)) * (height - 2) - 1}
              r={1.8}
              fill={TONE_BORDER[tone]}
            />
          )}
        </>
      )}
      {!path && <text x={width / 2} y={height / 2 + 3} textAnchor="middle" fontSize="9" fill="var(--color-text-disabled)">no data</text>}
    </svg>
  );
}

export { TONE_BORDER, TONE_TEXT, TONE_WASH };
