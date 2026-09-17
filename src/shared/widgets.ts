/**
 * The widget engine's rules: what a widget is, what it is allowed to reach, how instances are placed in zones, and how a
 * widget that keeps failing is put aside so it can never take Orbis down with it. Pure — no browser, no storage.
 */

export type WidgetCategory = 'time' | 'productivity' | 'information' | 'browser' | 'orion' | 'utility'

export type WidgetSize = 'small' | 'medium' | 'large'

/**
 * What a widget may reach. Each one is real: a widget with no permission for something simply never receives it, and
 * the Customize screen shows these before a widget is added.
 */
export type WidgetPermission = 'tasks' | 'notes' | 'clipboard' | 'whiteboard' | 'workspaces' | 'bookmarks' | 'history' | 'downloads' | 'tabs' | 'games' | 'orion' | 'network'

export const PERMISSION_WORDS: Record<WidgetPermission, string> = {
  tasks: 'Read your tasks',
  notes: 'Read your notes',
  clipboard: 'Read your clipboard history',
  whiteboard: 'Read your whiteboards',
  workspaces: 'Read your workspaces',
  bookmarks: 'Read your bookmarks',
  history: 'Read your browsing history',
  downloads: 'Read your downloads',
  tabs: 'Read the tabs you have open',
  games: 'Read your offline game scores',
  orion: 'Ask Orion',
  network: 'Fetch things from the internet'
}

export interface WidgetDefinition {
  id: string
  name: string
  description: string
  category: WidgetCategory
  /** Bumped when a widget's settings change shape; instances are migrated on load. */
  version: number
  sizes: WidgetSize[]
  defaultSize: WidgetSize
  permissions: WidgetPermission[]
  /** Settings the user can change, with what they mean and what they are by default. */
  settings: WidgetSettingSpec[]
  /** How often it refreshes itself, in milliseconds; 0 means only when something it watches changes. */
  refreshMs: number
}

export interface WidgetSettingSpec {
  name: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'choice'
  default: string | number | boolean
  choices?: { value: string; label: string }[]
  min?: number
  max?: number
}

export interface WidgetInstance {
  id: string
  /** Which widget this is an instance of. */
  widget: string
  zone: ZoneName
  /** Position within its zone, low first. */
  order: number
  size: WidgetSize
  settings: Record<string, string | number | boolean>
  /** Folded away until it is clicked. */
  collapsed: boolean
  /** Set aside after repeated failures; the user can bring it back. */
  disabled: boolean
  addedAt: number
}

export const ZONES = ['top', 'left', 'centre', 'right', 'bottom'] as const
export type ZoneName = (typeof ZONES)[number]

export const MAX_WIDGETS = 40

// ---------------------------------------------------------------- the built-in catalogue

const setting = (name: string, label: string, type: WidgetSettingSpec['type'], value: string | number | boolean, extra: Partial<WidgetSettingSpec> = {}): WidgetSettingSpec => ({ name, label, type, default: value, ...extra })

/**
 * Every widget Orbis ships. Each one shows something Orbis really holds — there are no example widgets and no made-up
 * data anywhere in this list.
 */
export const WIDGETS: WidgetDefinition[] = [
  {
    id: 'clock',
    name: 'Clock',
    description: 'The time and date, in your own format.',
    category: 'time',
    version: 1,
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    permissions: [],
    settings: [setting('seconds', 'Show seconds', 'boolean', false), setting('date', 'Show the date', 'boolean', true), setting('hour12', 'Twelve-hour clock', 'boolean', false)],
    refreshMs: 1000
  },
  {
    id: 'countdown',
    name: 'Countdown',
    description: 'How long until something you are waiting for.',
    category: 'time',
    version: 1,
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    permissions: [],
    settings: [setting('title', 'What for', 'text', 'Something to look forward to'), setting('date', 'When (YYYY-MM-DD)', 'text', '')],
    refreshMs: 60_000
  },
  {
    id: 'timer',
    name: 'Focus timer',
    description: 'A timer for a stretch of focused work, with a rest after it.',
    category: 'productivity',
    version: 1,
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    permissions: [],
    settings: [setting('minutes', 'Minutes of focus', 'number', 25, { min: 1, max: 180 }), setting('breakMinutes', 'Minutes of rest', 'number', 5, { min: 1, max: 60 })],
    refreshMs: 1000
  },
  {
    id: 'tasks',
    name: 'Tasks',
    description: 'What is due today, straight from your tasks. Ticking one off here really ticks it off.',
    category: 'productivity',
    version: 1,
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    permissions: ['tasks'],
    settings: [setting('view', 'Which tasks', 'choice', 'today', { choices: [{ value: 'today', label: 'Due today' }, { value: 'overdue', label: 'Overdue' }, { value: 'flagged', label: 'Important' }, { value: 'all', label: 'Everything' }] }), setting('limit', 'How many', 'number', 5, { min: 1, max: 20 })],
    refreshMs: 0
  },
  {
    id: 'notes',
    name: 'Notes',
    description: 'Your most recent notes, and a way to start a new one.',
    category: 'productivity',
    version: 1,
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    permissions: ['notes'],
    settings: [setting('limit', 'How many', 'number', 4, { min: 1, max: 12 })],
    refreshMs: 0
  },
  {
    id: 'bookmarks',
    name: 'Bookmarks',
    description: 'Bookmarks you can open in a click.',
    category: 'browser',
    version: 1,
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    permissions: ['bookmarks'],
    settings: [setting('limit', 'How many', 'number', 6, { min: 1, max: 20 })],
    refreshMs: 0
  },
  {
    id: 'downloads',
    name: 'Downloads',
    description: 'What you have downloaded lately, and anything still coming.',
    category: 'browser',
    version: 1,
    sizes: ['medium'],
    defaultSize: 'medium',
    permissions: ['downloads'],
    settings: [setting('limit', 'How many', 'number', 4, { min: 1, max: 12 })],
    refreshMs: 0
  },
  {
    id: 'tabs',
    name: 'Open tabs',
    description: 'How many tabs and groups are open, and a way back to any of them.',
    category: 'browser',
    version: 1,
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    permissions: ['tabs'],
    settings: [setting('limit', 'How many to list', 'number', 5, { min: 1, max: 20 })],
    refreshMs: 0
  },
  {
    id: 'workspaces',
    name: 'Workspaces',
    description: 'Your saved sets of pages, to switch between them from here.',
    category: 'browser',
    version: 1,
    sizes: ['medium'],
    defaultSize: 'medium',
    permissions: ['workspaces'],
    settings: [],
    refreshMs: 0
  },
  {
    id: 'clipboard',
    name: 'Clipboard',
    description: 'The last things you copied, ready to copy again.',
    category: 'utility',
    version: 1,
    sizes: ['medium'],
    defaultSize: 'medium',
    permissions: ['clipboard'],
    settings: [setting('limit', 'How many', 'number', 4, { min: 1, max: 12 })],
    refreshMs: 0
  },
  {
    id: 'whiteboard',
    name: 'Whiteboards',
    description: 'Your boards, and how much is on each.',
    category: 'productivity',
    version: 1,
    sizes: ['medium'],
    defaultSize: 'medium',
    permissions: ['whiteboard'],
    settings: [setting('limit', 'How many', 'number', 3, { min: 1, max: 10 })],
    refreshMs: 0
  },
  {
    id: 'quote',
    name: 'Quote',
    description: 'A line worth reading, from a small collection kept on this computer.',
    category: 'information',
    version: 1,
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    permissions: [],
    settings: [setting('rotation', 'Change it', 'choice', 'daily', { choices: [{ value: 'daily', label: 'Every day' }, { value: 'launch', label: 'Every time Orbis starts' }, { value: 'manual', label: 'Only when I ask' }] })],
    refreshMs: 0
  },
  {
    id: 'games',
    name: 'Offline games',
    description: 'The game of the day and your best scores from the offline page.',
    category: 'information',
    version: 1,
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    permissions: ['games'],
    settings: [],
    refreshMs: 0
  },
  {
    id: 'calculator',
    name: 'Calculator',
    description: 'Works out what you type, without leaving the page.',
    category: 'utility',
    version: 1,
    sizes: ['small', 'medium'],
    defaultSize: 'small',
    permissions: [],
    settings: [],
    refreshMs: 0
  },
  {
    id: 'greeting',
    name: 'Greeting',
    description: 'Good morning, afternoon or evening, by your own clock, with the date.',
    category: 'time',
    version: 1,
    sizes: ['medium', 'large'],
    defaultSize: 'large',
    permissions: [],
    settings: [setting('name', 'Your name', 'text', ''), setting('date', 'Show the date', 'boolean', true)],
    refreshMs: 60_000
  },
  {
    id: 'worldclock',
    name: 'World clock',
    description: 'The time in other places, with daylight saving worked out for each.',
    category: 'time',
    version: 1,
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'medium',
    permissions: [],
    settings: [
      setting('zones', 'Places (Label=Area/City, separated by commas)', 'text', 'London=Europe/London, New York=America/New_York, Tokyo=Asia/Tokyo'),
      setting('hour12', '12-hour clock', 'boolean', false)
    ],
    refreshMs: 60_000
  },
  {
    id: 'weather',
    name: 'Weather',
    description: 'The weather for a city you choose, from MET Norway. No location permission needed.',
    category: 'information',
    version: 1,
    sizes: ['small', 'medium', 'large'],
    defaultSize: 'medium',
    permissions: ['network'],
    settings: [
      setting('city', 'City', 'text', ''),
      setting('unit', 'Temperature', 'choice', 'c', { choices: [{ value: 'c', label: 'Celsius' }, { value: 'f', label: 'Fahrenheit' }] }),
      setting('hours', 'Show the next few hours', 'boolean', true)
    ],
    refreshMs: 30 * 60_000
  },
  {
    id: 'news',
    name: 'News',
    description: 'Headlines from RSS or Atom feeds you choose. Nothing is chosen for you.',
    category: 'information',
    version: 1,
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    permissions: ['network'],
    settings: [setting('feeds', 'Feed addresses, separated by commas', 'text', ''), setting('limit', 'How many headlines', 'number', 6, { min: 1, max: 20 })],
    refreshMs: 20 * 60_000
  },
  {
    id: 'recent',
    name: 'Recent sites',
    description: 'The sites you visited most recently, one line each.',
    category: 'browser',
    version: 1,
    sizes: ['medium', 'large'],
    defaultSize: 'medium',
    permissions: ['history'],
    settings: [setting('limit', 'How many', 'number', 6, { min: 1, max: 20 })],
    refreshMs: 0
  }
]

export const widgetById = (id: string): WidgetDefinition | null => WIDGETS.find((w) => w.id === id) ?? null

export function searchWidgets(query: string, category?: WidgetCategory | 'all'): WidgetDefinition[] {
  const q = query.trim().toLowerCase()
  return WIDGETS.filter((w) => (!category || category === 'all' || w.category === category) && (!q || `${w.name} ${w.description} ${w.category} ${w.permissions.join(' ')}`.toLowerCase().includes(q)))
}

/** What a widget would be allowed to reach, in words, so it can be shown before it is added. */
export const permissionsOf = (definition: WidgetDefinition): string[] => definition.permissions.map((p) => PERMISSION_WORDS[p])

// ---------------------------------------------------------------- instances

export function newWidgetInstance(widget: string, zone: ZoneName, order: number): WidgetInstance | null {
  const definition = widgetById(widget)
  if (!definition) return null
  return {
    id: crypto.randomUUID(),
    widget,
    zone,
    order,
    size: definition.defaultSize,
    settings: Object.fromEntries(definition.settings.map((s) => [s.name, s.default])),
    collapsed: false,
    disabled: false,
    addedAt: Date.now()
  }
}

const clampSetting = (spec: WidgetSettingSpec, value: unknown): string | number | boolean => {
  if (spec.type === 'boolean') return typeof value === 'boolean' ? value : Boolean(spec.default)
  if (spec.type === 'number') {
    const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(spec.default)
    return Math.min(spec.max ?? Number.MAX_SAFE_INTEGER, Math.max(spec.min ?? Number.MIN_SAFE_INTEGER, n))
  }
  if (spec.type === 'choice') {
    const allowed = (spec.choices ?? []).map((c) => c.value)
    return typeof value === 'string' && allowed.includes(value) ? value : String(spec.default)
  }
  return typeof value === 'string' ? value.slice(0, 300) : String(spec.default)
}

/**
 * A stored widget read back safely: one whose kind Orbis no longer has is dropped, and settings are brought in line with
 * what the widget says it takes, so an older configuration keeps working.
 */
export function normalizeWidget(raw: unknown): WidgetInstance | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Partial<WidgetInstance>
  if (typeof r.id !== 'string' || typeof r.widget !== 'string') return null
  const definition = widgetById(r.widget)
  if (!definition) return null
  const stored = (r.settings ?? {}) as Record<string, unknown>
  return {
    id: r.id,
    widget: r.widget,
    zone: ZONES.includes(r.zone as ZoneName) ? (r.zone as ZoneName) : 'centre',
    order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0,
    size: definition.sizes.includes(r.size as WidgetSize) ? (r.size as WidgetSize) : definition.defaultSize,
    settings: Object.fromEntries(definition.settings.map((s) => [s.name, clampSetting(s, stored[s.name])])),
    collapsed: r.collapsed === true,
    disabled: r.disabled === true,
    addedAt: typeof r.addedAt === 'number' ? r.addedAt : Date.now()
  }
}

export const normalizeWidgets = (raw: unknown): WidgetInstance[] => (Array.isArray(raw) ? raw.map(normalizeWidget).filter((w): w is WidgetInstance => w !== null).slice(0, MAX_WIDGETS) : [])

/** The widgets of one zone, in the order they should appear. */
export const widgetsInZone = (widgets: WidgetInstance[], zone: ZoneName): WidgetInstance[] => widgets.filter((w) => w.zone === zone && !w.disabled).sort((a, b) => a.order - b.order || a.addedAt - b.addedAt)

/** Moves a widget to a zone at a position, and renumbers that zone so the order is always plain. */
export function placeWidget(widgets: WidgetInstance[], id: string, zone: ZoneName, index: number): WidgetInstance[] {
  const moving = widgets.find((w) => w.id === id)
  if (!moving) return widgets
  const others = widgetsInZone(widgets, zone).filter((w) => w.id !== id)
  const ordered = [...others.slice(0, index), { ...moving, zone }, ...others.slice(index)]
  const renumbered = new Map(ordered.map((w, i) => [w.id, i]))
  return widgets.map((w) => (renumbered.has(w.id) ? { ...w, zone, order: renumbered.get(w.id)! } : w))
}

// ---------------------------------------------------------------- when a widget goes wrong

export interface WidgetFailure {
  widgetId: string
  message: string
  at: number
}

export const FAILURES_BEFORE_DISABLING = 3

/**
 * What to do when a widget fails: show it as unavailable with a way to try again, and after a few failures in a row set
 * it aside so it stops costing anything. Its settings are kept, and the user can bring it back.
 */
export function afterFailure(failures: WidgetFailure[], widgetId: string, message: string, at = Date.now()): { failures: WidgetFailure[]; disable: boolean } {
  const recent = [...failures.filter((f) => at - f.at < 300_000), { widgetId, message: message.slice(0, 300), at }]
  const mine = recent.filter((f) => f.widgetId === widgetId)
  return { failures: recent.slice(-50), disable: mine.length >= FAILURES_BEFORE_DISABLING }
}

// ---------------------------------------------------------------- what a widget is showing

export type DataStatus = 'live' | 'cached' | 'offline' | 'updating' | 'unavailable'

export interface WidgetData<T> {
  status: DataStatus
  value: T | null
  /** When it was last read, so "updated 3 hours ago" is honest rather than pretending it is live. */
  at: number
  error?: string
}

export const freshness = (data: WidgetData<unknown>, now = Date.now()): string => {
  if (data.status === 'unavailable') return data.error ?? 'Not available'
  if (!data.at) return ''
  const minutes = Math.round((now - data.at) / 60_000)
  if (data.status === 'updating') return 'Updating…'
  if (minutes < 1) return data.status === 'cached' ? 'Saved a moment ago' : 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`
}
