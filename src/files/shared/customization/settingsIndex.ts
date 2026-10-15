/**
 * Search index of the Customization Studio. Every entry is a real control in
 * the Studio (its element id is `setting-<id>`); `path` names the
 * configuration value it edits, when it edits a single value, so search
 * results can show where the effective value comes from. This search is only
 * for the Studio; it is not an application-wide search.
 */

export const STUDIO_CATEGORIES = [
  { id: 'overview', label: 'Overview', icon: 'overview', description: 'What is in effect and where it comes from.' },
  { id: 'appearance', label: 'Appearance', icon: 'palette', description: 'Mode, shape, depth, motion, effects and backgrounds.' },
  { id: 'colors', label: 'Colours', icon: 'contrast', description: 'Every colour token, with contrast checks.' },
  { id: 'typography', label: 'Typography & density', icon: 'type', description: 'Text size and weight, row and control sizes.' },
  { id: 'layout', label: 'Layout', icon: 'layout', description: 'Panels, positions, sizes and panes, with preview.' },
  { id: 'workspaces', label: 'Workspaces', icon: 'workspace', description: 'Named sets of interface preferences.' },
  { id: 'views', label: 'File views', icon: 'viewDetails', description: 'Default view, sorting, grouping and saved views.' },
  { id: 'columns', label: 'Columns & metadata', icon: 'viewColumns', description: 'Visible, ordered, sized and pinned columns.' },
  { id: 'navigation', label: 'Navigation', icon: 'navigation', description: 'Sidebar sections, tree, start folder, saved locations.' },
  { id: 'toolbars', label: 'Toolbars', icon: 'sliders', description: 'Toolbar items, order, pinning and presentation.' },
  { id: 'menus', label: 'Context menus', icon: 'menu', description: 'Order and presentation of right-click menus.' },
  { id: 'shortcuts', label: 'Keyboard shortcuts', icon: 'keyboard', description: 'Bindings for every Files command.' },
  { id: 'accessibility', label: 'Accessibility', icon: 'accessibility', description: 'Scaling, contrast, motion, focus and targets.' },
  { id: 'presets', label: 'Presets', icon: 'presets', description: 'Built-in and your own presets.' },
  { id: 'portability', label: 'Import & export', icon: 'importFile', description: 'Share and back up customization files.' },
  { id: 'recovery', label: 'Reset & recovery', icon: 'retry', description: 'Undo, backups and resets.' },
] as const;
export type StudioCategory = (typeof STUDIO_CATEGORIES)[number]['id'];

export interface SettingIndexEntry { id: string; category: StudioCategory; label: string; keywords: string; path?: string }

const e = (category: StudioCategory, id: string, label: string, keywords = '', path?: string): SettingIndexEntry => ({ id, category, label, keywords, path });

export const SETTINGS_INDEX: SettingIndexEntry[] = [
  // Appearance
  e('appearance', 'mode', 'Theme mode (dark, light, follow system)', 'dark light system night day colour scheme', 'appearance.mode'),
  e('appearance', 'radius', 'Corner radius', 'rounded corners shape', 'appearance.radius'),
  e('appearance', 'surfaceSeparation', 'Surface separation', 'contrast between panels surfaces depth', 'appearance.surfaceSeparation'),
  e('appearance', 'borderIntensity', 'Border intensity', 'lines dividers outlines', 'appearance.borderIntensity'),
  e('appearance', 'shadowIntensity', 'Shadow intensity', 'depth elevation drop shadow', 'appearance.shadowIntensity'),
  e('appearance', 'motion', 'Animation intensity', 'motion animations transitions', 'appearance.motion'),
  e('appearance', 'durationScale', 'Transition duration', 'speed animation time', 'appearance.durationScale'),
  e('appearance', 'material', 'Material (glass or solid)', 'glass translucent frosted acrylic mica vibrancy opaque flat solid', 'appearance.material'),
  e('appearance', 'glassOpacity', 'Glass opacity', 'translucency see-through frosted', 'appearance.glassOpacity'),
  e('appearance', 'glow', 'Accent glow', 'glow neon light halo shine', 'appearance.glow'),
  e('appearance', 'ambient', 'Ambient light', 'aurora nebula ember gradient backdrop glow light colour', 'appearance.ambient'),
  e('appearance', 'ambientIntensity', 'Ambient light strength', 'aurora brightness intensity', 'appearance.ambientIntensity'),
  e('appearance', 'ambientMotion', 'Drifting light', 'animated aurora movement motion', 'appearance.ambientMotion'),
  e('appearance', 'transparency', 'Panel transparency over a background image', 'translucency see-through background image', 'appearance.transparency'),
  e('appearance', 'blur', 'Background image blur', 'frosted blur background image', 'appearance.blur'),
  e('appearance', 'reducedEffects', 'Reduced effects', 'performance slow hardware battery low power', 'appearance.reducedEffects'),
  e('appearance', 'background', 'Background (solid, gradient, image, texture)', 'wallpaper image picture photo gradient texture dim overlay home', 'appearance.background.kind'),
  e('appearance', 'themeSample', 'Live sample of interface states', 'preview sample buttons selection'),
  // Colours
  e('colors', 'tokens', 'Colour tokens', 'colours colors accent text background selection hover focus error warning success scrollbar tooltip file type'),
  e('colors', 'colorMode', 'Edit dark or light colours', 'palette mode'),
  e('colors', 'contrast', 'Contrast checks', 'readable legibility wcag ratio'),
  // Typography & density
  e('typography', 'density', 'Interface density', 'compact comfortable spacious', 'appearance.density'),
  e('typography', 'rowHeight', 'File row height', 'list rows line height', 'appearance.rowHeight'),
  e('typography', 'iconSize', 'Icon size (icon grid)', 'grid icons', 'appearance.iconSize'),
  e('typography', 'thumbnailSize', 'Thumbnail size', 'large thumbnails images photos', 'appearance.thumbnailSize'),
  e('typography', 'toolbarHeight', 'Toolbar height', 'toolbar size', 'appearance.toolbarHeight'),
  e('typography', 'tabHeight', 'Tab height', 'tabs size', 'appearance.tabHeight'),
  e('typography', 'panelSpacing', 'Panel spacing', 'gap gutter between panels', 'appearance.panelSpacing'),
  e('typography', 'fontScale', 'Text size', 'font size typography scale', 'appearance.fontScale'),
  e('typography', 'fontWeight', 'Font weight', 'bold regular medium', 'appearance.fontWeight'),
  e('typography', 'lineHeight', 'Line spacing', 'line height leading', 'appearance.lineHeight'),
  e('typography', 'fontFamily', 'Typeface', 'font family plex system', 'appearance.fontFamily'),
  // Layout
  e('layout', 'layoutEditor', 'Layout editor', 'panels regions drag move position preview apply'),
  e('layout', 'arrangement', 'Panes (single, two, three, four)', 'split dual pane multi pane quad triple side by side stacked', 'layout.panes.arrangement'),
  e('layout', 'sidebarVisible', 'Show the sidebar', 'navigation panel left', 'layout.sidebar.visible'),
  e('layout', 'sidebarSide', 'Sidebar position', 'left right', 'layout.sidebar.side'),
  e('layout', 'sidebarWidth', 'Sidebar width', 'size resize', 'layout.sidebar.width'),
  e('layout', 'detailsVisible', 'Show the details panel', 'preview properties inspector', 'layout.details.visible'),
  e('layout', 'detailsPosition', 'Details panel position', 'right left bottom', 'layout.details.position'),
  e('layout', 'detailsWidth', 'Preview panel width', 'details width size', 'layout.details.width'),
  e('layout', 'regions', 'Toolbar, address bar, search, tabs, status bar and shelf', 'breadcrumbs path bar tab strip status bar hide show shelf drop stack tray', 'layout.toolbar.visible'),
  e('layout', 'operations', 'Operations area (floating or docked)', 'queue transfers progress dock', 'layout.operations.dock'),
  e('layout', 'layoutPresets', 'Layout presets', 'compact wide-screen preview bottom details'),
  e('layout', 'savedLayouts', 'Saved layouts', 'save duplicate rename delete layout'),
  // Workspaces
  e('workspaces', 'workspaceList', 'Workspaces', 'create rename duplicate reorder delete activate switch study research development media archive minimal'),
  e('workspaces', 'workspaceFilters', 'Saved filters of the workspace', 'filter quick filter'),
  // Views
  e('views', 'defaultView', 'Default view for new tabs', 'details list compact grid thumbnails gallery columns tree view mode', 'view.view'),
  e('views', 'defaultSort', 'Default sorting', 'sort order ascending descending folders first', 'view.sort.key'),
  e('views', 'thenBy', 'Further sort keys', 'multi-column sort secondary tie-break', 'view.thenBy'),
  e('views', 'groupBy', 'Default grouping', 'group by type date size', 'view.groupBy'),
  e('views', 'savedViews', 'Saved views', 'view presets reuse'),
  // Columns
  e('columns', 'columnEditor', 'Columns', 'visible order width pin metadata dimensions duration checksum volume owner permissions', 'view.columns'),
  e('columns', 'columnSets', 'Column sets', 'save columns presets'),
  // Navigation
  e('navigation', 'sections', 'Sidebar sections and order', 'quick access pinned drives library collections tags tools', 'navigation.sections'),
  e('navigation', 'indent', 'Tree indentation', 'indent tree depth', 'navigation.indent'),
  e('navigation', 'folderIcons', 'Folder icons', 'coloured monochrome', 'navigation.folderIcons'),
  e('navigation', 'treeExpand', 'Tree expansion', 'expand collapse remember', 'navigation.treeExpand'),
  e('navigation', 'indicators', 'Indicators', 'drive usage counts tags sizes dates', 'navigation.indicators.driveUsage'),
  e('navigation', 'start', 'Start folder', 'starting directory open at launch home last session', 'navigation.start.kind'),
  e('navigation', 'navDensity', 'Navigation density', 'tree rows sidebar size', 'navigation.density'),
  e('navigation', 'savedLocations', 'Saved locations (pins)', 'pinned favourites bookmarks missing unavailable'),
  // Toolbars
  e('toolbars', 'toolbarEditor', 'Toolbar items', 'buttons add remove reorder pin overflow more'),
  e('toolbars', 'presentation', 'Toolbar presentation', 'icons text labels both', 'toolbar.presentation'),
  // Menus
  e('menus', 'itemMenu', 'Item context menu', 'right-click file folder menu order hide'),
  e('menus', 'backgroundMenu', 'Folder background menu', 'right-click empty space new folder'),
  e('menus', 'menuOptions', 'Menu options', 'unavailable disabled hide icons shortcuts', 'contextMenu.unavailable'),
  // Shortcuts
  e('shortcuts', 'shortcutEditor', 'Keyboard shortcuts', 'keys bindings hotkeys assign record conflicts'),
  e('shortcuts', 'reserved', 'Reserved shortcuts', 'system operating system reserved host'),
  // Accessibility
  e('accessibility', 'interfaceScale', 'Interface size', 'zoom scale bigger smaller', 'accessibility.interfaceScale'),
  e('accessibility', 'highContrast', 'High contrast', 'contrast visibility low vision', 'accessibility.highContrast'),
  e('accessibility', 'reduceMotion', 'Reduce motion', 'animations vestibular', 'accessibility.reduceMotion'),
  e('accessibility', 'reduceTransparency', 'Reduce transparency', 'opaque glass translucency solid surfaces', 'accessibility.reduceTransparency'),
  e('accessibility', 'focusRing', 'Focus indicator', 'keyboard focus outline ring', 'accessibility.focusRing'),
  e('accessibility', 'minTarget', 'Minimum target size', 'click target touch size buttons', 'accessibility.minTarget'),
  e('accessibility', 'underlineLinks', 'Underline links', 'links underline', 'accessibility.underlineLinks'),
  e('accessibility', 'safeguards', 'Safeguards in effect', 'adjusted contrast reachability'),
  // Presets, portability, recovery
  e('presets', 'presetLibrary', 'Preset library', 'theme presets orbis native obsidian midnight graphite arctic minimal high contrast compact spacious dual pane thumbnail metadata'),
  e('presets', 'savePreset', 'Save current as preset', 'new preset save theme'),
  e('portability', 'export', 'Export', 'backup share file json'),
  e('portability', 'import', 'Import', 'load file restore share'),
  e('recovery', 'history', 'Undo and redo', 'history undo redo'),
  e('recovery', 'backups', 'Backups', 'restore previous configuration last known good'),
  e('recovery', 'resets', 'Resets', 'reset defaults restore factory category appearance workspace'),
];

export function searchSettings(query: string, index: SettingIndexEntry[] = SETTINGS_INDEX): SettingIndexEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const cat = (c: StudioCategory) => STUDIO_CATEGORIES.find((x) => x.id === c)!.label.toLowerCase();
  const scored = index.map((x) => {
    const label = x.label.toLowerCase();
    const hay = `${label} ${x.keywords} ${cat(x.category)}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return null;
    const score = words.reduce((a, w) => a + (label.startsWith(w) ? 4 : label.includes(w) ? 2 : cat(x.category).includes(w) ? 1 : 0.5), 0);
    return { x, score };
  }).filter((v): v is { x: SettingIndexEntry; score: number } => !!v);
  return scored.sort((a, b) => b.score - a.score).map((v) => v.x);
}
