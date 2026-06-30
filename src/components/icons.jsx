// Inline SVG icon set. Stroke icons inherit currentColor so they tint with the
// surrounding text. Used by the sidebar nav, topbar, and dashboard cards.

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const PATHS = {
  dashboard: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  teachers: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 5.5a3 3 0 0 1 0 5.6" /><path d="M17.5 19a5.5 5.5 0 0 0-2-4.2" /></>,
  observations: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
  pacing: <><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /><path d="M12 12.5v3l2 1.2" /></>,
  interventions: <><path d="M12 2.5 4 5.5v5c0 5 3.4 8 8 9.8 4.6-1.8 8-4.8 8-9.8v-5L12 2.5Z" /><path d="M9.2 11.8l1.9 1.9 3.7-3.9" /></>,
  report: <><rect x="3.5" y="3" width="17" height="18" rx="2" /><path d="M8 14v3M12 11v6M16 8v9" /></>,
  audit: <><path d="M5 4.5h11l3 3V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" /><path d="M8.5 11h7M8.5 14.5h7M8.5 7.5h4" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.2-3.2" /></>,
  sparkle: <><path d="M12 3l1.8 4.7L18.5 9l-4.7 1.8L12 15l-1.8-4.2L5.5 9l4.7-1.3L12 3Z" /><path d="M18.5 15.5l.8 2 .2.8" /></>,
  bell: <><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 19a2 2 0 0 0 4 0" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></>,
  chart: <><path d="M4 19V5M4 19h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  flame: <><path d="M12 3s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 1-3s.5 1.5 2 1.5C11 9 9 7 12 3Z" /></>,
  arrow: <path d="M9 6l6 6-6 6" />,
};

export function Icon({ name }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg viewBox="0 0 24 24" {...S} aria-hidden="true">
      {path}
    </svg>
  );
}

// Sierra "Rams" emblem. A stylized ram head, dark on the gold brandmark disc.
// This is a placeholder mark (per the design kit notes); swap for the official
// vector ram logo when available.
export function Brandmark() {
  return (
    <svg viewBox="0 0 24 24" aria-label="Sierra Rams" role="img">
      <path
        d="M4.6 6.2c-1.7.2-2.4 2.2-1.5 3.9.7 1.4 2.3 1.7 3.4 1.1"
        fill="none"
        stroke="#2A1E02"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M19.4 6.2c1.7.2 2.4 2.2 1.5 3.9-.7 1.4-2.3 1.7-3.4 1.1"
        fill="none"
        stroke="#2A1E02"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M7 6.4c1.6-1.3 8.4-1.3 10 0 1.1 1 1.3 3.7-.6 5.9C15.2 14 13.7 15 12 15s-3.2-1-4.4-2.7C5.7 10.1 5.9 7.4 7 6.4Z"
        fill="#2A1E02"
      />
      <circle cx="9.6" cy="10.2" r="1" fill="#E8CF7C" />
      <circle cx="14.4" cy="10.2" r="1" fill="#E8CF7C" />
      <path d="M11 13.4h2" stroke="#E8CF7C" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
