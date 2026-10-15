/** Inline SVG icons. Single stroke weight, 24-unit grid, currentColor. */

export type IconName =
  | 'home'
  | 'lab'
  | 'distribution'
  | 'experiment'
  | 'simulation'
  | 'scenario'
  | 'risk'
  | 'data'
  | 'saved'
  | 'template'
  | 'settings'
  | 'sensitivity'
  | 'markov'
  | 'bayes'
  | 'combinatorics'
  | 'repeat'
  | 'play'
  | 'x'
  | 'check'
  | 'alert'
  | 'info'
  | 'save'
  | 'download'
  | 'upload'
  | 'copy'
  | 'trash'
  | 'edit'
  | 'search'
  | 'chevronRight'
  | 'chevronDown'
  | 'plus'
  | 'minus'
  | 'dice'
  | 'sparkles'
  | 'book'
  | 'menu'
  | 'shuffle'
  | 'reset'
  | 'sun'
  | 'moon'
  | 'lock'
  | 'chart'
  | 'table'
  | 'target'
  | 'decision'
  | 'network'
  | 'reliability'
  | 'queue'
  | 'extremes'
  | 'survival'
  | 'timeseries'
  | 'regression'
  | 'tests'
  | 'fitting'
  | 'mcmc'
  | 'processes'
  | 'information'
  | 'portfolio'
  | 'copula'
  | 'qmc'
  | 'imprecise'
  | 'causal'
  | 'epidemic'
  | 'des'
  | 'elicitation'
  | 'gp'
  | 'sequential'
  | 'filtering'
  | 'transforms'
  | 'stochopt'
  | 'modelchoice'
  | 'hmm';

const PATHS: Record<IconName, { d: string; fill?: boolean }[]> = {
  home: [{ d: 'M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5M9.5 20v-6h5v6' }],
  lab: [{ d: 'M9 3h6M10 3v6.5L5.5 17a2.5 2.5 0 0 0 2.2 3.7h8.6A2.5 2.5 0 0 0 18.5 17L14 9.5V3M7.5 14h9' }],
  distribution: [{ d: 'M3 19h18M4 19c2.5 0 3-12 8-12s5.5 12 8 12' }],
  experiment: [{ d: 'M5 5h14v14H5zM9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01' }],
  simulation: [{ d: 'M3 17c3-8 6 4 9-4s3 6 9-2M3 21h18' }],
  scenario: [{ d: 'M12 3v4M12 3 7 7M12 3l5 4M7 7v4a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7M12 13v8M8 21h8' }],
  risk: [{ d: 'M12 3 2.5 20h19L12 3zM12 9v5M12 17h.01' }],
  data: [{ d: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }],
  saved: [{ d: 'M5 3h11l3 3v15l-7-4-7 4V3z' }],
  template: [{ d: 'M4 4h7v7H4zM13 4h7v4h-7zM13 11h7v9h-7zM4 13h7v7H4z' }],
  settings: [{ d: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0A1.7 1.7 0 0 0 16.9 5.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z' }],
  sensitivity: [{ d: 'M4 6h10M4 12h16M4 18h7M16 4v4M20 10v4M12 16v4' }],
  markov: [{ d: 'M6 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.5 6.5h8M7 8v9M8.5 18.5A9 9 0 0 0 16 10' }],
  bayes: [{ d: 'M5 20V4h5.5a4 4 0 0 1 0 8H5m0 0h6.5a4 4 0 0 1 0 8H5M16 4l4 4M20 4l-4 4' }],
  combinatorics: [{ d: 'M7 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 23a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 23a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM7 7v10M17 7v10M9.5 4.5h5M9.5 19.5h5M9 9l6 6M15 9l-6 6' }],
  repeat: [{ d: 'M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3' }],
  play: [{ d: 'M6 3.5v17l14-8.5-14-8.5z' }],
  x: [{ d: 'M18 6 6 18M6 6l12 12' }],
  check: [{ d: 'M20 6 9 17l-5-5' }],
  alert: [{ d: 'M12 3 2.5 20h19L12 3zM12 9v5M12 17h.01' }],
  info: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01' }],
  save: [{ d: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8' }],
  download: [{ d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3' }],
  upload: [{ d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12' }],
  copy: [{ d: 'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }],
  trash: [{ d: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M5 6l1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6' }],
  edit: [{ d: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z' }],
  search: [{ d: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3' }],
  chevronRight: [{ d: 'M9 18l6-6-6-6' }],
  chevronDown: [{ d: 'M6 9l6 6 6-6' }],
  plus: [{ d: 'M12 5v14M5 12h14' }],
  minus: [{ d: 'M5 12h14' }],
  dice: [{ d: 'M5 5h14v14H5zM9 9h.01M15 15h.01M12 12h.01' }],
  sparkles: [{ d: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z' }],
  book: [{ d: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22V4.5zM4 17.5h16' }],
  menu: [{ d: 'M3 6h18M3 12h18M3 18h18' }],
  shuffle: [{ d: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5' }],
  reset: [{ d: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5' }],
  sun: [{ d: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4' }],
  moon: [{ d: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z' }],
  lock: [{ d: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4' }],
  chart: [{ d: 'M3 3v18h18M7 15v3M12 9v9M17 5v13' }],
  table: [{ d: 'M3 4h18v16H3zM3 9h18M3 14.5h18M9 9v11M15 9v11' }],
  target: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' }],
  decision: [{ d: 'M3 12h4M7 9.5h5l4-4.5M7 14.5h5l4 4.5M3 9.5h4v5H3zM16 3h5v5h-5zM16 16h5v5h-5z' }],
  network: [{ d: 'M6 5.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M18.5 13a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M7 23a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5M7.8 5.2 16.5 9M6.6 18 6.2 8M8.9 18.6 16.8 12.6' }],
  reliability: [{ d: 'M12 3 20 6v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6zM8.7 12l2.4 2.4L15.6 10' }],
  queue: [{ d: 'M3 8v8M6.5 8v8M10 8v8M14 5h7v14h-7zM14 12h7' }],
  extremes: [{ d: 'M3 18h3l2-1 2 .5L13 4l2 13 2-.6 3 1.6' }],
  survival: [{ d: 'M3 4h4v5h4v6h4v5h5M3 21h18' }],
  timeseries: [{ d: 'M3 21V3M3 14l4-5 4 4 4-7 5 6M3 21h18' }],
  regression: [{ d: 'M3 21V3M3 21h18M5 18.5 19.5 6M7 17.5v0M10 14v0M13 12.5v0M16 9v0' }],
  tests: [{ d: 'M9 3h6M10 3v5l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3L14 8V3M7.2 14h9.6' }],
  fitting: [{ d: 'M3 21h18M5 21v-5M9 21v-9M13 21v-12M17 21v-7M3 16c3-9 7-12 10-12s5 4 8 9' }],
  mcmc: [{ d: 'M4.5 15.5a3 3 0 1 1 4-4.4M9.5 10.5a3 3 0 1 1 4-4.4M14.5 11a3 3 0 1 1 4.4 4M10 16.5a3 3 0 1 1 4.4 4M6.5 13 9 11M12 8.5 14.5 10.5M16.5 15 14 17M11.5 19.5 9 18' }],
  processes: [{ d: 'M3 12h3l3-6 3 9 3-5 3 3h3M3 12h3l3 6 3-9' }],
  information: [{ d: 'M4 7h3M4 12h7M4 17h5M14 5v14M18 8v8M21.5 11v2' }],
  portfolio: [{ d: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 12V3M12 12l7.8 4.5M12 12 4.2 16.5' }],
  copula: [{ d: 'M3 19c3 0 4-10 7-10M21 5c-3 0-4 10-7 10M10.5 9.5h3M10.5 9.5 14 15M13.5 15 10 9.5' }],
  qmc: [{ d: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18M6 6.5v0M12 12.5v0M18 6.5v0M6 17.5v0M18 12.5v0M12 4.5v0' }],
  imprecise: [{ d: 'M4 8h3v8H4zM20 8h-3v8h3M7 10h10M7 14h10' }],
  causal: [{ d: 'M6 17.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 17.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 6.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8.5 15.5h7M10.8 6.9 7.2 13M13.2 6.9 16.8 13' }],
  epidemic: [{ d: 'M3 19h18M4 17c2.5 0 3-9 6-9s3.5 9 6 9 2.5-4 4-4' }],
  des: [{ d: 'M3 12h18M6 12V8M11 12V6M16 12V9M20 12v-2M5 16h14' }],
  elicitation: [{ d: 'M5 7h9M5 12h13M5 17h7M19.5 5v14M17.5 12h4' }],
  gp: [{ d: 'M3 14c3-6 6 2 9-2s6 1 9-3M3 17c3-6 6 2 9-2s6 1 9-3M3 11c3-6 6 2 9-2s6 1 9-3' }],
  sequential: [{ d: 'M3 20V4M3 8h6M9 8V5M9 11h6M15 11V8M15 14h6M21 14v-3' }],
  filtering: [{ d: 'M3 16l3-5 2 4 3-7 2 5 3-4 2 3 3-5M3 19h18' }],
  transforms: [{ d: 'M3 12c1.5-5 3 5 4.5 0S10.5 7 12 12M14 19V8M17 19v-7M20 19V5M14 19h6' }],
  stochopt: [{ d: 'M4 20V4M4 20h16M7 17l10-10M7 11l6 6M9 8l8 8M16 6v12' }],
  modelchoice: [{ d: 'M12 4v3M5 9h14M5 9l-2 5h4zM19 9l-2 5h4zM10.5 20h3M12 7v13' }],
  hmm: [{ d: 'M4 7h4M12 7h4M8 7l4 0M16 7l3 0M6 10v3M14 10v3M18 10v3M5 16h3M13 16h3M17 16h3' }],
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const paths = PATHS[name];
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill ? 'currentColor' : 'none'} />
      ))}
    </svg>
  );
}

/** Application mark: an orbital arc crossing a probability curve. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" className="oc-brand-mark">
      <circle cx="16" cy="16" r="13" stroke="var(--accent)" strokeOpacity="0.35" strokeWidth="1.4" />
      <path d="M4 22c4.5 0 5-13 12-13s7.5 13 12 13" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="16" cy="9" r="2.6" fill="var(--accent)" />
      <circle cx="25" cy="7" r="1.4" fill="var(--accent-2)" />
    </svg>
  );
}
