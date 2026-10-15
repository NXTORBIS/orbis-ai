import type { ColorTokenId } from './tokens';
import type { DeepPartial, Layout, LayerValues } from './schema';

/**
 * Built-in presets. They are read-only: editing one creates a user copy
 * (`basedOn` keeps the link), so a built-in can always be restored.
 * Every preset changes real settings; the test suite checks that each one
 * passes the contrast safeguards without adjustment.
 */
export interface BuiltInPreset extends Pick<LayerValues, 'appearance' | 'layout' | 'view' | 'accessibility'> {
  id: string;
  name: string;
  description: string;
  builtIn: true;
}

type Colors = Partial<Record<ColorTokenId, string>>;

const obsidian: Colors = {
  bgApp: '#060608', bgSidebar: '#09090c', bgSurface: '#0c0c10', bgSurface2: '#111116', bgRaised: '#16161c', bgToolbar: '#0c0c10', bgPanel: '#111116', bgDialog: '#16161c', bgInput: '#08080b', bgTooltip: '#1f1f27',
  border: '#1b1b22', borderStrong: '#2a2a34', text: '#e6e4ee', text2: '#aaa7ba', text3: '#8f8ca4',
  accent: '#a493f5', accentHover: '#b8aaf8', accentSoft: '#a493f524', accentLine: '#a493f573', accent2: '#8fd0c8', focus: '#bdb1ff',
  selected: '#a493f526', selectedFocus: '#a493f53d', drop: '#a493f524', textOnAccent: '#0b0820', progress: '#a493f5', info: '#a493f5',
  scrollbar: '#2a2a34', scrollbarHover: '#8f8ca4',
};

const nebula: Colors = {
  bgApp: '#07050d', bgSidebar: '#0c0914', bgSurface: '#100c19', bgSurface2: '#15101f', bgRaised: '#1b1528', bgToolbar: '#100c19', bgPanel: '#15101f', bgDialog: '#1b1528', bgInput: '#0a0712', bgTooltip: '#251d36',
  border: '#1f1830', borderStrong: '#30264a', text: '#ece6f7', text2: '#b6aacd', text3: '#9284ad',
  accent: '#c58cff', accentHover: '#d4a8ff', accentSoft: '#c58cff24', accentLine: '#c58cff73', accent2: '#ff8fcf', focus: '#dcb6ff',
  selected: '#c58cff29', selectedFocus: '#c58cff40', drop: '#c58cff24', textOnAccent: '#14062a', progress: '#c58cff', info: '#c58cff',
  scrollbar: '#30264a', scrollbarHover: '#9284ad',
};

const midnight: Colors = {
  bgApp: '#070b14', bgSidebar: '#0a1020', bgSurface: '#0d1426', bgSurface2: '#111a30', bgRaised: '#152039', bgToolbar: '#0d1426', bgPanel: '#111a30', bgDialog: '#152039', bgInput: '#090e1b', bgTooltip: '#1c2a49',
  border: '#18223a', borderStrong: '#25324f', text: '#e2e8f5', text2: '#a8b5ce', text3: '#8796b3',
  accent: '#79a4ff', accentHover: '#93b6ff', accentSoft: '#79a4ff24', accentLine: '#79a4ff73', focus: '#a4c2ff',
  selected: '#79a4ff29', selectedFocus: '#79a4ff40', drop: '#79a4ff24', textOnAccent: '#050b1c', progress: '#79a4ff', info: '#79a4ff',
  scrollbar: '#25324f', scrollbarHover: '#8796b3',
};

const graphite: Colors = {
  bgApp: '#101010', bgSidebar: '#141414', bgSurface: '#181818', bgSurface2: '#1d1d1d', bgRaised: '#232323', bgToolbar: '#181818', bgPanel: '#1d1d1d', bgDialog: '#232323', bgInput: '#121212', bgTooltip: '#2c2c2c',
  border: '#262626', borderStrong: '#363636', text: '#ececec', text2: '#b4b4b4', text3: '#9a9a9a',
  accent: '#a6bacd', accentHover: '#bccbda', accentSoft: '#a6bacd24', accentLine: '#a6bacd73', focus: '#c6d5e3',
  selected: '#a6bacd26', selectedFocus: '#a6bacd3a', drop: '#a6bacd24', textOnAccent: '#0f1418', progress: '#a6bacd', info: '#a6bacd',
  scrollbar: '#363636', scrollbarHover: '#9a9a9a',
};

const arctic: Colors = {
  bgApp: '#e4edf5', bgSidebar: '#eaf1f7', bgSurface: '#f8fbfd', bgSurface2: '#eff4f9', bgRaised: '#ffffff', bgToolbar: '#f8fbfd', bgPanel: '#eff4f9', bgDialog: '#ffffff', bgInput: '#ffffff',
  border: '#d3e0eb', borderStrong: '#bccddd', text: '#0e1720', text2: '#3f5163', text3: '#4a5e71',
  accent: '#0f6fa8', accentHover: '#0b5a89', accentSoft: '#0f6fa81a', accentLine: '#0f6fa866', focus: '#0f6fa8',
  selected: '#0f6fa81c', selectedFocus: '#0f6fa830', drop: '#0f6fa81a', progress: '#0f6fa8', info: '#0f6fa8',
};

/** Token values applied by the high-contrast accessibility setting (not a separate theme engine). */
export const HIGH_CONTRAST: { dark: Colors; light: Colors } = {
  dark: {
    bgApp: '#000000', bgSidebar: '#000000', bgSurface: '#000000', bgSurface2: '#0a0a0a', bgRaised: '#0f0f0f', bgToolbar: '#000000', bgPanel: '#0a0a0a', bgDialog: '#0f0f0f', bgInput: '#000000', bgTooltip: '#1a1a1a',
    border: '#9a9a9a', borderStrong: '#ffffff', text: '#ffffff', text2: '#f2f2f2', text3: '#d9d9d9', textDisabled: '#8c8c8c',
    accent: '#ffd400', accentHover: '#ffe24d', accentSoft: '#ffd40033', accentLine: '#ffd400', focus: '#ffd400', textOnAccent: '#000000',
    selected: '#ffd40038', selectedFocus: '#ffd40052', hover: '#ffffff1f', active: '#ffffff2e',
    success: '#4dff9a', warning: '#ffd400', error: '#ff7a7a', info: '#7ac8ff', destructive: '#c20000', destructiveHover: '#9e0000', textOnDestructive: '#ffffff',
    progress: '#ffd400', scrollbar: '#9a9a9a', scrollbarHover: '#ffffff',
  },
  light: {
    bgApp: '#ffffff', bgSidebar: '#ffffff', bgSurface: '#ffffff', bgSurface2: '#f7f7f7', bgRaised: '#ffffff', bgToolbar: '#ffffff', bgPanel: '#f7f7f7', bgDialog: '#ffffff', bgInput: '#ffffff',
    border: '#5c5c5c', borderStrong: '#000000', text: '#000000', text2: '#111111', text3: '#2b2b2b', textDisabled: '#6b6b6b',
    accent: '#0040a8', accentHover: '#00307f', accentSoft: '#0040a826', accentLine: '#0040a8', focus: '#0040a8', textOnAccent: '#ffffff',
    selected: '#0040a82e', selectedFocus: '#0040a840', hover: '#0000001a', active: '#00000029',
    success: '#00662e', warning: '#7a4d00', error: '#b00000', info: '#0040a8', destructive: '#b00000', destructiveHover: '#8a0000', textOnDestructive: '#ffffff',
    progress: '#0040a8', scrollbar: '#5c5c5c', scrollbarHover: '#000000',
  },
};

export const BUILT_IN_PRESETS: BuiltInPreset[] = [
  { id: 'orbis-native', name: 'Orbis Native', description: 'The standard Orbis Files look: layered glass panels over soft aurora light, with a glacier-blue accent glow.', builtIn: true },
  { id: 'orbis-classic', name: 'Orbis Classic', description: 'The original flat look: opaque near-black surfaces, square-ish corners, no glow or ambient light.', builtIn: true, appearance: { material: 'solid', glow: 0, ambient: 'none', radius: 6, panelSpacing: 0 } },
  { id: 'nebula', name: 'Nebula', description: 'Violet and magenta light behind deep glass, with a stronger glow.', builtIn: true, appearance: { mode: 'dark', colors: { dark: nebula }, ambient: 'nebula', glow: 0.85, ambientIntensity: 0.85, glassOpacity: 0.86, radius: 12 } },
  { id: 'obsidian', name: 'Obsidian', description: 'Deeper blacks with a soft violet accent and slightly rounder corners.', builtIn: true, appearance: { mode: 'dark', colors: { dark: obsidian }, radius: 8, shadowIntensity: 1.2 } },
  { id: 'midnight', name: 'Midnight', description: 'Navy surfaces with a bright blue accent.', builtIn: true, appearance: { mode: 'dark', colors: { dark: midnight } } },
  { id: 'graphite', name: 'Graphite', description: 'Neutral greys with a muted steel accent; low colour, low distraction.', builtIn: true, appearance: { mode: 'dark', colors: { dark: graphite }, radius: 4, shadowIntensity: 0.6 } },
  { id: 'arctic', name: 'Arctic', description: 'A cool, bright light theme.', builtIn: true, appearance: { mode: 'light', colors: { light: arctic }, radius: 8 } },
  { id: 'minimal', name: 'Minimal', description: 'Fewer lines and shadows, no glow, no status bar and no details panel by default.', builtIn: true, appearance: { borderIntensity: 0.45, shadowIntensity: 0, surfaceSeparation: 0.4, radius: 4, glow: 0, ambientIntensity: 0.35 }, layout: { details: { visible: false }, statusBar: { visible: false } } },
  { id: 'high-contrast', name: 'High Contrast', description: 'Maximum contrast, strong focus rings, underlined links and opaque surfaces.', builtIn: true, accessibility: { highContrast: 'on', focusRing: 'strong', underlineLinks: true }, appearance: { borderIntensity: 1.6, shadowIntensity: 0, material: 'solid', glow: 0, ambient: 'none' } },
  { id: 'compact', name: 'Compact', description: 'More rows on screen: smaller rows, toolbars and tabs.', builtIn: true, appearance: { density: 'compact', rowHeight: 22, toolbarHeight: 34, tabHeight: 30, fontScale: 0.95, iconSize: 72, thumbnailSize: 160 } },
  { id: 'spacious', name: 'Spacious', description: 'Larger rows, text and targets.', builtIn: true, appearance: { density: 'spacious', rowHeight: 38, toolbarHeight: 48, tabHeight: 38, fontScale: 1.08, lineHeight: 1.55, iconSize: 120, thumbnailSize: 260 } },
  { id: 'dual-pane', name: 'Dual Pane', description: 'Two independent file panes side by side, for moving and comparing.', builtIn: true, layout: { panes: { arrangement: 'dual', ratios: [0.5] }, details: { visible: false } } },
  { id: 'thumbnail-browser', name: 'Thumbnail Browser', description: 'Large thumbnails with a preview beside them; good for photos and videos.', builtIn: true, appearance: { thumbnailSize: 280 }, view: { view: 'thumbnails' }, layout: { details: { visible: true, position: 'right', showProperties: false, width: 380 } } },
  {
    id: 'metadata-focus', name: 'Metadata Focus', description: 'Details view with media and attribute columns and a wide details panel.', builtIn: true,
    view: {
      view: 'details',
      columns: [
        { id: 'name', width: 300, visible: true, pinned: true }, { id: 'modified', width: 160, visible: true, pinned: false }, { id: 'size', width: 90, visible: true, pinned: false },
        { id: 'type', width: 120, visible: true, pinned: false }, { id: 'dimensions', width: 110, visible: true, pinned: false }, { id: 'duration', width: 90, visible: true, pinned: false },
        { id: 'taken', width: 160, visible: true, pinned: false }, { id: 'attributes', width: 110, visible: true, pinned: false }, { id: 'owner', width: 110, visible: true, pinned: false },
      ],
    },
    layout: { details: { visible: true, position: 'right', width: 420, showPreview: true, showProperties: true } },
  },
];

export const BUILT_IN_BY_ID: Record<string, BuiltInPreset> = Object.fromEntries(BUILT_IN_PRESETS.map((p) => [p.id, p]));

/** Starting points offered when creating a workspace. They are ordinary overrides, not separate applications. */
export const WORKSPACE_TEMPLATES: Array<{ id: string; name: string; description: string; overrides: LayerValues }> = [
  { id: 'everyday', name: 'Everyday', description: 'The standard layout.', overrides: {} },
  { id: 'study', name: 'Study', description: 'Documents with a wide preview.', overrides: { view: { view: 'details', sort: { key: 'modified', dir: 'desc', foldersFirst: true } }, layout: { details: { visible: true, width: 440, showPreview: true } } } },
  { id: 'research', name: 'Research', description: 'Two panes and a preview for collecting sources.', overrides: { layout: { panes: { arrangement: 'dual', ratios: [0.5] }, details: { visible: true } } } },
  { id: 'development', name: 'Development', description: 'Tree view and compact rows.', overrides: { view: { view: 'tree' }, appearance: { density: 'compact' } } },
  { id: 'projects', name: 'Projects', description: 'Details grouped by type.', overrides: { view: { view: 'details', groupBy: 'type' } } },
  { id: 'media', name: 'Media Collection', description: 'Gallery view with large thumbnails.', overrides: { view: { view: 'gallery' }, appearance: { thumbnailSize: 300 }, layout: { details: { visible: false } } } },
  { id: 'archives', name: 'Archive Management', description: 'Details sorted by size, two panes.', overrides: { view: { view: 'details', sort: { key: 'size', dir: 'desc', foldersFirst: true } }, layout: { panes: { arrangement: 'dual', ratios: [0.5] } } } },
  { id: 'minimal', name: 'Minimal', description: 'Just the file list.', overrides: { layout: { sidebar: { visible: false }, details: { visible: false }, statusBar: { visible: false } } } },
];

/**
 * Layout presets offered by the layout editor. Each is applied on top of the
 * current effective layout (so unrelated choices such as widths are kept).
 */
export const LAYOUT_PRESETS: Array<{ id: string; name: string; description: string; layout: DeepPartial<Layout> }> = [
  { id: 'single', name: 'Single pane', description: 'One file pane.', layout: { panes: { arrangement: 'single', ratios: [] } } },
  { id: 'dual', name: 'Two panes side by side', description: 'Two independent panes for moving and comparing.', layout: { panes: { arrangement: 'dual', ratios: [0.5] } } },
  { id: 'dual-stacked', name: 'Two panes stacked', description: 'One pane above the other.', layout: { panes: { arrangement: 'dual-stacked', ratios: [0.5] } } },
  { id: 'triple', name: 'Three panes', description: 'Three panes side by side; needs a wide window.', layout: { panes: { arrangement: 'triple', ratios: [0.333, 0.667] }, details: { visible: false } } },
  { id: 'quad', name: 'Four panes', description: 'A 2 × 2 grid; needs a large window.', layout: { panes: { arrangement: 'quad', ratios: [0.5, 0.5] }, details: { visible: false } } },
  { id: 'preview', name: 'Main pane with preview', description: 'One pane with the preview panel on the right.', layout: { panes: { arrangement: 'single', ratios: [] }, details: { visible: true, position: 'right', showPreview: true } } },
  { id: 'bottom-details', name: 'Main pane with bottom details', description: 'Details and preview under the file list.', layout: { panes: { arrangement: 'single', ratios: [] }, details: { visible: true, position: 'bottom', showPreview: true, showProperties: true } } },
  { id: 'compact', name: 'Compact', description: 'Narrow sidebar, no details panel, no status bar.', layout: { sidebar: { visible: true, width: 190 }, details: { visible: false }, statusBar: { visible: false }, panes: { arrangement: 'single', ratios: [] } } },
  { id: 'widescreen', name: 'Wide-screen', description: 'Sidebar, two panes and a details panel.', layout: { sidebar: { visible: true }, details: { visible: true, position: 'right' }, panes: { arrangement: 'dual', ratios: [0.5] } } },
];
