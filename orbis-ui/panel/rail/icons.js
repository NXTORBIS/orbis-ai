// One icon family for the whole Orbis panel and its sidebar rail: 24x24, 1.75 stroke, round caps, drawn with currentColor so
// they follow the theme, hover and forced-colors. Line shapes in the style of the Lucide set (ISC licence), kept small and inline
// so the built-in page needs no font or image request. Icons are decorative: the control that holds one carries the name.

const P = {
  tabs: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M8 5v4"/>',
  tabGroups: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  bookmarks: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  downloads: '<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  readingList: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5M9 8h6"/>',
  savedPages: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6m0 0-2.5-2.5M12 17l2.5-2.5"/>',
  workspaces: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
  profiles: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  extensions: '<path d="M14 4a2 2 0 1 0-4 0v2H6a1 1 0 0 0-1 1v4h2a2 2 0 1 1 0 4H5v4a1 1 0 0 0 1 1h4v-2a2 2 0 1 1 4 0v2h4a1 1 0 0 0 1-1v-4h-2a2 2 0 1 1 0-4h2V7a1 1 0 0 0-1-1h-4z"/>',
  // Search and the person's own entry: added when the rail became the only navigation.
  // Without these two the rail drew an empty circle where an icon belongs.
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  research: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8.5 11h5M11 8.5v5"/>',
  sources: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  galaxy: '<circle cx="12" cy="12" r="2.5"/><path d="M12 3c5 0 9 4 9 9M12 21c-5 0-9-4-9-9M5 5.5c3.5-2.5 8.5-1 11 2.5M19 18.5c-3.5 2.5-8.5 1-11-2.5"/>',
  notes: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M15 3v5h5M8 13h8M8 17h5"/>',
  tasks: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  reminders: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  whiteboard: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  screenshots: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
  media: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  privacy: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  adblock: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  tracking: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="m4 4 16 16"/>',
  controls: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  workflows: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M9 6h4a2 2 0 0 1 2 2v7"/>',
  secrets: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  orion: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/><circle cx="12" cy="12" r="3"/>',
  customize: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.5-1.9-.3-1 .3-2.1 1.4-2.1H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  // Settings, and the sections of them the Command Center leads to directly.
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  languages: '<path d="M3 5h11M9 3v2c0 5-2.5 8-6 9"/><path d="M6 10c0 3 2.5 5.5 7 6.5"/><path d="m13 21 4-10 4 10M14.5 17.5h5"/>',
  accessibility: '<circle cx="12" cy="4.5" r="1.8"/><path d="M4.5 8.5 12 10l7.5-1.5"/><path d="M12 10v5M12 15l-3 6M12 15l3 6"/>',
  system: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  reset: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5V10H9"/>',

  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M19 12H5m0 0 6-6m-6 6 6 6"/>',
  forward: '<path d="M5 12h14m0 0-6-6m6 6-6 6"/>',
  reload: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>',
  pin: '<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 5 6M21 9l-5 6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6A16.5 16.5 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 4.4-1.1M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14 6 4 4"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  up: '<path d="M12 19V5m0 0-6 6m6-6 6 6"/>',
  down: '<path d="M12 5v14m0 0 6-6m-6 6-6-6"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  eyeHide: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><path d="m4 4 16 16"/>',
  arrange: '<path d="M4 6h16M4 12h16M4 18h16"/><path d="M9 3v6M15 9v6M9 15v6" />',
  panelIcons: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  panelLabels: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M13 9h5M13 13h5"/>',
  density: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5v.01"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2.6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  // The widgets on the start page. One picture each, in the same family, so a widget is recognisable before it is read.
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  hourglass: '<path d="M7 3h10M7 21h10"/><path d="M8 3v3.5L12 11l4-4.5V3M8 21v-3.5L12 13l4 4.5V21"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 1.5M9 2h6"/>',
  calculator: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 12h.01M12 12h.01M16 12h.01M8 16h.01M12 16h.01M16 16h4"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M5 5l1.8 1.8M17.2 17.2 19 19M19 5l-1.8 1.8M6.8 17.2 5 19"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.1 11.3A3.5 3.5 0 0 0 7 18z"/>',
  news: '<rect x="3" y="5" width="18" height="15" rx="2"/><path d="M7 9h6M7 13h10M7 17h10M16 9h1"/>',
  chart: '<path d="M3 20h18"/><path d="m4 15 5-5 3.5 3.5L20 6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  note: '<path d="M15 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M15 3v5h5"/>',
  sticky: '<path d="M5 4h14v11l-4 4H5z"/><path d="M19 15h-4v4"/>',
  bell: '<path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 6 1.5 6h-15S6 13 6 9z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  board: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M12 16v4M8 20h8"/>',
  bookmark: '<path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4-6 4V4a1 1 0 0 1 1-1z"/>',
  download: '<path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 19h16"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  game: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3M15.5 12h.01M18 14h.01"/>',
  quote: '<path d="M9 7H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v1a3 3 0 0 1-3 3"/><path d="M19 7h-3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h1v1a3 3 0 0 1-3 3"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18 17l.9 2.1L21 20l-2.1.9L18 23l-.9-2.1L15 20l2.1-.9z"/>'
}

const NS = 'http://www.w3.org/2000/svg'

/** An <svg> for the named icon (an unknown name gives a plain circle, never nothing). */
export function icon(name, size = 16) {
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.75')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.classList.add('ico')
  // The path data above is fixed text in this file, never page or user data.
  // Built with createElementNS, not a parser: the built-in pages require Trusted Types, which forbids parsing markup strings.
  for (const m of (P[name] ?? '<circle cx="12" cy="12" r="8"/>').matchAll(/<(\w+)((?:\s+[\w-]+="[^"]*")*)\s*\/>/g)) {
    const node = document.createElementNS(NS, m[1])
    for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) node.setAttribute(a[1], a[2])
    svg.append(node)
  }
  return svg
}

export const ICON_NAMES = Object.keys(P)
