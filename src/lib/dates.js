// Small date helpers. Kept dependency-free on purpose.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function today() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function parse(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

// Whole days between two dates. Positive when `to` is after `from`.
export function daysBetween(from, to = today()) {
  const a = parse(from);
  const b = to instanceof Date ? to : parse(to);
  if (!a || !b) return null;
  return Math.round((b - a) / MS_PER_DAY);
}

export function daysSince(value) {
  const n = daysBetween(value, today());
  return n == null ? null : n;
}

export function daysUntil(value) {
  const n = daysBetween(today(), value);
  return n == null ? null : n;
}

export function formatDate(value) {
  const d = parse(value);
  if (!d) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isoDate(d = today()) {
  const date = d instanceof Date ? d : parse(d) || today();
  return date.toISOString().slice(0, 10);
}
