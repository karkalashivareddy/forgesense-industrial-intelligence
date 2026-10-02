/**
 * Formatting helpers.
 *
 * Unit discipline is enforced here. In particular:
 *  - `formatProbability` is for values in [0,1] that ARE probabilities, and
 *    always shows enough significant digits that a small non-zero value is
 *    never rounded to "0%".
 *  - `formatScore` is for bounded [0,1] model SCORES that are not
 *    probabilities - specifically the anomaly score, which IsolationForest's
 *    `decision_function` is rescaled against its own training distribution
 *    (ml-service/app/main.py `_anomaly_score`). A score of 0.9993 means "the
 *    most extreme reading this model has ever seen on training data", not
 *    "a 99.93% chance of a fault". Rendering it with a "%" suffix would invent
 *    a calibration the model does not have, so it is shown as a bare number.
 *  - `formatContribution` renders a signed probability delta. It is NEVER
 *    suffixed with "%" because `Factor.contribution` is a raw delta on model
 *    output, not a percentage.
 *  - `formatRulSteps` is the only RUL formatter. There is no hours/days
 *    formatter anywhere in the app, because the backend contract defines the
 *    RUL unit as simulator "steps" and nothing else.
 */

const EM_DASH = '—';

/** Probability in [0,1] -> "0.06%". Keeps small non-zero values visible. */
export function formatProbability(
  value: number | null | undefined,
  digits = 2,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  const pctValue = value * 100;
  if (pctValue === 0) return '0%';
  if (Math.abs(pctValue) < 0.01) return '<0.01%';
  if (Math.abs(pctValue) < 1) return `${pctValue.toFixed(3)}%`;
  if (Math.abs(pctValue) < 10) return `${pctValue.toFixed(digits)}%`;
  return `${pctValue.toFixed(1)}%`;
}

/**
 * Bounded [0,1] model score that is NOT a probability -> "0.999".
 *
 * Deliberately unsuffixed. Used for the anomaly score, which is a rescaled
 * IsolationForest decision function, and for any future bounded score.
 * A score of 0 must still read as a real observation, so `null` (no
 * assessment) is the only thing that becomes an em dash.
 */
export function formatScore(value: number | null | undefined, digits = 3): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  return value.toFixed(digits);
}

/** Signed probability delta: "+0.0034" / "-0.0069". Unitless by contract. */
export function formatContribution(value: number | null | undefined, digits = 4): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

export function formatNumber(
  value: number | null | undefined,
  digits = 1,
): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatInteger(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  return Math.round(value).toLocaleString('en-US');
}

/** The ONLY remaining-useful-life formatter. Steps, never a time unit. */
export function formatRulSteps(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EM_DASH;
  return `${Math.round(value).toLocaleString('en-US')} steps`;
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatTimeShort(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EM_DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return EM_DASH;
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(
    'en-GB',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

/** Compact relative age: "4s ago", "2m ago", "3h ago", "5d ago". */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EM_DASH;
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Duration in minutes -> "1h 20m". Used for modelled downtime estimates. */
export function formatDuration(minutes: number | null | undefined): string {
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return EM_DASH;
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export function formatMachineType(type: string | undefined): string {
  if (!type) return EM_DASH;
  return type
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function titleCase(value: string | undefined): string {
  if (!value) return EM_DASH;
  return value
    .toLowerCase()
    .split(/[\s_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export { EM_DASH };
