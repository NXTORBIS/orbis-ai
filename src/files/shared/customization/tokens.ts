/**
 * Orbis Files design tokens — design system version 2 ("Orbis Native", glass).
 *
 * This registry is the single source of truth for every customizable colour.
 * `src/renderer/styles/tokens.css` carries the same default values for the
 * first paint; a unit test keeps the two in sync. Components only read the
 * CSS variables; the customization engine only writes them.
 */

export const DESIGN_SYSTEM_VERSION = '2.0.0';

export type TokenCategory = 'surfaces' | 'text' | 'lines' | 'accent' | 'states' | 'status' | 'filetypes' | 'progress' | 'overlays';

export interface ContrastRule {
  /** Other tokens this one must stay readable against. */
  against: ColorTokenId[];
  min: number;
  /** Why the rule exists, shown when an edit is refused. */
  reason: string;
}

export interface ColorTokenDef {
  id: ColorTokenId;
  cssVar: string;
  label: string;
  category: TokenCategory;
  description: string;
  keywords?: string[];
  /** Translucent tokens (hover, selection…) may carry alpha. */
  alpha?: boolean;
  contrast?: ContrastRule;
  /** For translucent state tokens: text must stay readable on the token composited over these surfaces. */
  legibleText?: { over: ColorTokenId[]; text: ColorTokenId; min: number };
  dark: string;
  light: string;
}

export const COLOR_TOKEN_IDS = [
  'bgApp', 'bgSidebar', 'bgSurface', 'bgSurface2', 'bgRaised', 'bgToolbar', 'bgPanel', 'bgDialog', 'bgTooltip', 'bgInput',
  'text', 'text2', 'text3', 'textDisabled', 'textOnAccent', 'textOnDestructive',
  'border', 'borderStrong', 'focus',
  'accent', 'accentHover', 'accentSoft', 'accentLine', 'accent2',
  'hover', 'active', 'selected', 'selectedFocus', 'drop', 'disabledBg',
  'success', 'warning', 'error', 'info', 'destructive', 'destructiveHover',
  'progress', 'progressTrack', 'scrollbar', 'scrollbarHover', 'scrim', 'textTooltip',
  'hueFolder', 'hueImage', 'hueVideo', 'hueAudio', 'hueDoc', 'hueCode', 'hueArchive', 'hueExe', 'hueOther',
] as const;
export type ColorTokenId = (typeof COLOR_TOKEN_IDS)[number];

const TEXT_SURFACES: ColorTokenId[] = ['bgApp', 'bgSidebar', 'bgSurface', 'bgSurface2', 'bgRaised', 'bgToolbar', 'bgPanel', 'bgDialog'];
const READABLE = (label: string): ContrastRule => ({ against: TEXT_SURFACES, min: 4.5, reason: `${label} must stay readable (4.5:1) on every surface it appears on.` });
const UI = (label: string, against: ColorTokenId[] = ['bgSurface', 'bgRaised']): ContrastRule => ({ against, min: 3, reason: `${label} must be distinguishable (3:1) from the surfaces behind it.` });

export const COLOR_TOKENS: ColorTokenDef[] = [
  // Surfaces
  { id: 'bgApp', cssVar: '--bg-app', label: 'Window background', category: 'surfaces', description: 'Title bar and the space behind panels.', keywords: ['window', 'titlebar'], dark: '#0a0c0f', light: '#e9edf1' },
  { id: 'bgSidebar', cssVar: '--bg-sidebar', label: 'Sidebar', category: 'surfaces', description: 'Navigation sidebar.', keywords: ['navigation'], dark: '#0d1014', light: '#eef1f4' },
  { id: 'bgSurface', cssVar: '--bg-surface', label: 'Primary surface', category: 'surfaces', description: 'File lists and main views.', keywords: ['workspace', 'files'], dark: '#111419', light: '#fafbfc' },
  { id: 'bgSurface2', cssVar: '--bg-surface-2', label: 'Secondary surface', category: 'surfaces', description: 'Secondary panes and cards.', dark: '#151920', light: '#f3f5f8' },
  { id: 'bgRaised', cssVar: '--bg-raised', label: 'Elevated surface', category: 'surfaces', description: 'Menus, popovers and toasts.', keywords: ['menu', 'popover'], dark: '#191e25', light: '#ffffff' },
  { id: 'bgToolbar', cssVar: '--bg-toolbar', label: 'Toolbar', category: 'surfaces', description: 'Pane toolbars and the address bar row.', dark: '#111419', light: '#fafbfc' },
  { id: 'bgPanel', cssVar: '--bg-panel', label: 'Details panel', category: 'surfaces', description: 'Preview and metadata panel.', keywords: ['inspector', 'preview'], dark: '#151920', light: '#f3f5f8' },
  { id: 'bgDialog', cssVar: '--bg-dialog', label: 'Dialogs', category: 'surfaces', description: 'Dialogs and the command palette.', keywords: ['modal'], dark: '#191e25', light: '#ffffff' },
  { id: 'bgTooltip', cssVar: '--bg-tooltip', label: 'Tooltips', category: 'overlays', description: 'Tooltip background.', dark: '#232a33', light: '#1d242c' },
  { id: 'textTooltip', cssVar: '--text-tooltip', label: 'Tooltip text', category: 'overlays', description: 'Text inside tooltips.', contrast: { against: ['bgTooltip'], min: 4.5, reason: 'Tooltip text must be readable (4.5:1).' }, dark: '#f2f5f8', light: '#f2f5f8' },
  { id: 'bgInput', cssVar: '--bg-input', label: 'Input fields', category: 'surfaces', description: 'Text fields and selects.', dark: '#0c0f13', light: '#ffffff' },
  // Text
  { id: 'text', cssVar: '--text', label: 'Primary text', category: 'text', description: 'File names and body text.', contrast: READABLE('Primary text'), dark: '#e3e8ee', light: '#12171d' },
  { id: 'text2', cssVar: '--text-2', label: 'Secondary text', category: 'text', description: 'Labels and secondary information.', contrast: READABLE('Secondary text'), dark: '#a4aeb9', light: '#48535f' },
  { id: 'text3', cssVar: '--text-3', label: 'Muted text', category: 'text', description: 'Hints, captions and metadata.', contrast: READABLE('Muted text'), dark: '#8792a0', light: '#56616d' },
  { id: 'textDisabled', cssVar: '--text-disabled', label: 'Disabled text', category: 'text', description: 'Unavailable controls (exempt from contrast rules, but must differ from surfaces).', contrast: { against: ['bgSurface'], min: 1.5, reason: 'Disabled text must still be visible.' }, dark: '#47505a', light: '#a9b2bb' },
  { id: 'textOnAccent', cssVar: '--text-on-accent', label: 'Text on accent', category: 'text', description: 'Text on primary buttons.', contrast: { against: ['accent'], min: 4.5, reason: 'Text on primary buttons must be readable (4.5:1).' }, dark: '#04111c', light: '#ffffff' },
  { id: 'textOnDestructive', cssVar: '--text-on-destructive', label: 'Text on destructive', category: 'text', description: 'Text on destructive buttons (delete, remove).', contrast: { against: ['destructive'], min: 4.5, reason: 'Destructive confirmations must stay readable (4.5:1).' }, dark: '#ffffff', light: '#ffffff' },
  // Lines
  { id: 'border', cssVar: '--border', label: 'Dividers', category: 'lines', description: 'Subtle borders between regions.', dark: '#1d232b', light: '#dbe1e7' },
  { id: 'borderStrong', cssVar: '--border-strong', label: 'Strong borders', category: 'lines', description: 'Input outlines and separators.', dark: '#2a323c', light: '#c7d0d9' },
  { id: 'focus', cssVar: '--border-focus', label: 'Focus ring', category: 'states', description: 'Keyboard focus indicator.', contrast: UI('The focus ring', ['bgSurface', 'bgRaised', 'bgSidebar']), dark: '#7cc3f5', light: '#1c6cb2' },
  // Accent
  { id: 'accent', cssVar: '--accent', label: 'Primary accent', category: 'accent', description: 'Primary buttons, links, active indicators.', contrast: UI('The accent'), dark: '#5caae8', light: '#1c6cb2' },
  { id: 'accentHover', cssVar: '--accent-hover', label: 'Accent (hover)', category: 'accent', description: 'Accent when hovered.', dark: '#78bcf2', light: '#155a96' },
  { id: 'accentSoft', cssVar: '--accent-soft', label: 'Accent (soft)', category: 'accent', description: 'Soft accent backgrounds.', alpha: true, dark: '#5caae824', light: '#1c6cb21a' },
  { id: 'accentLine', cssVar: '--accent-line', label: 'Accent (lines)', category: 'accent', description: 'Accent borders.', alpha: true, dark: '#5caae873', light: '#1c6cb266' },
  { id: 'accent2', cssVar: '--accent-2', label: 'Secondary accent', category: 'accent', description: 'Secondary highlights (sort ranks, badges).', contrast: { against: ['bgSurface', 'bgSurface2'], min: 4.5, reason: 'Secondary accent text must stay readable on the surfaces it is used on.' }, dark: '#8fd0c8', light: '#16766e' },
  // States
  { id: 'hover', cssVar: '--bg-hover', label: 'Hover', category: 'states', description: 'Rows and buttons under the pointer.', alpha: true, dark: '#a0bedc0f', light: '#1432500d' },
  { id: 'active', cssVar: '--bg-active', label: 'Pressed / active', category: 'states', description: 'Pressed buttons and active items.', alpha: true, dark: '#a0bedc1c', light: '#14325017' },
  { id: 'selected', cssVar: '--bg-selected', label: 'Selection', category: 'states', description: 'Selected rows in an inactive pane.', alpha: true, legibleText: { over: ['bgSurface'], text: 'text', min: 4.5 }, dark: '#5caae826', light: '#1c6cb21c' },
  { id: 'selectedFocus', cssVar: '--bg-selected-focus', label: 'Selection (focused)', category: 'states', description: 'Selected rows in the active pane.', alpha: true, legibleText: { over: ['bgSurface'], text: 'text', min: 4.5 }, dark: '#5caae83d', light: '#1c6cb230' },
  { id: 'drop', cssVar: '--bg-drop', label: 'Drop target', category: 'states', description: 'Folder under a drag.', alpha: true, dark: '#5caae824', light: '#1c6cb21a' },
  { id: 'disabledBg', cssVar: '--bg-disabled', label: 'Disabled background', category: 'states', description: 'Disabled controls.', alpha: true, dark: '#a0bedc0a', light: '#14325008' },
  // Status
  { id: 'success', cssVar: '--success', label: 'Success', category: 'status', description: 'Completed operations.', contrast: { against: ['bgSurface', 'bgRaised'], min: 3, reason: 'Success indicators must be visible (3:1).' }, dark: '#4cc28f', light: '#1d8a5c' },
  { id: 'warning', cssVar: '--warning', label: 'Warning', category: 'status', description: 'Warnings and cautions.', contrast: { against: ['bgSurface', 'bgRaised'], min: 4.5, reason: 'Warnings are read as text and must stay readable (4.5:1).' }, dark: '#e2b450', light: '#875900' },
  { id: 'error', cssVar: '--error', label: 'Error', category: 'status', description: 'Errors and failed operations.', contrast: { against: ['bgSurface', 'bgRaised', 'bgDialog'], min: 4.5, reason: 'Error messages must never become unreadable (4.5:1).' }, dark: '#ef6f6f', light: '#b53434' },
  { id: 'info', cssVar: '--info', label: 'Information', category: 'status', description: 'Informational notices.', contrast: { against: ['bgSurface', 'bgRaised'], min: 3, reason: 'Information indicators must be visible (3:1).' }, dark: '#5caae8', light: '#1c6cb2' },
  { id: 'destructive', cssVar: '--destructive', label: 'Destructive actions', category: 'status', description: 'Delete and other destructive buttons.', contrast: UI('Destructive buttons', ['bgDialog', 'bgSurface']), dark: '#c9393c', light: '#c4383b' },
  { id: 'destructiveHover', cssVar: '--destructive-hover', label: 'Destructive (hover)', category: 'status', description: 'Destructive buttons when hovered.', dark: '#b02f32', light: '#a82e31' },
  // Progress, scrollbars, overlays
  { id: 'progress', cssVar: '--progress', label: 'Progress', category: 'progress', description: 'Progress bars.', contrast: UI('Progress bars', ['bgRaised', 'bgSurface']), dark: '#5caae8', light: '#1c6cb2' },
  { id: 'progressTrack', cssVar: '--progress-track', label: 'Progress track', category: 'progress', description: 'Unfilled part of progress bars.', alpha: true, dark: '#a0bedc1a', light: '#1432501a' },
  { id: 'scrollbar', cssVar: '--scrollbar-thumb', label: 'Scrollbar', category: 'overlays', description: 'Scrollbar thumbs.', dark: '#2a323c', light: '#c7d0d9' },
  { id: 'scrollbarHover', cssVar: '--scrollbar-thumb-hover', label: 'Scrollbar (hover)', category: 'overlays', description: 'Scrollbar thumbs when hovered.', dark: '#8792a0', light: '#56616d' },
  { id: 'scrim', cssVar: '--scrim', label: 'Dialog backdrop', category: 'overlays', description: 'Dims the window behind dialogs.', alpha: true, dark: '#0305089e', light: '#141c2657' },
  // File types (icons only)
  { id: 'hueFolder', cssVar: '--hue-folder', label: 'Folders', category: 'filetypes', description: 'Folder icons.', dark: '#6fb2e6', light: '#2f7fc4' },
  { id: 'hueImage', cssVar: '--hue-image', label: 'Images', category: 'filetypes', description: 'Image file icons.', dark: '#c79bf0', light: '#8a52c4' },
  { id: 'hueVideo', cssVar: '--hue-video', label: 'Video', category: 'filetypes', description: 'Video file icons.', dark: '#f0909f', light: '#c4475b' },
  { id: 'hueAudio', cssVar: '--hue-audio', label: 'Audio', category: 'filetypes', description: 'Audio file icons.', dark: '#e9b46a', light: '#b0741c' },
  { id: 'hueDoc', cssVar: '--hue-doc', label: 'Documents', category: 'filetypes', description: 'Document icons.', dark: '#8fb7f2', light: '#3a6fc4' },
  { id: 'hueCode', cssVar: '--hue-code', label: 'Code', category: 'filetypes', description: 'Code file icons.', dark: '#7fd3b0', light: '#1f8a66' },
  { id: 'hueArchive', cssVar: '--hue-archive', label: 'Archives', category: 'filetypes', description: 'Archive icons.', dark: '#d6b07a', light: '#9a6a2c' },
  { id: 'hueExe', cssVar: '--hue-exe', label: 'Programs', category: 'filetypes', description: 'Executable icons.', dark: '#ef8a6f', light: '#c45634' },
  { id: 'hueOther', cssVar: '--hue-other', label: 'Other files', category: 'filetypes', description: 'Other file icons.', dark: '#8a95a1', light: '#6b7682' },
];

export const TOKEN_BY_ID: Record<ColorTokenId, ColorTokenDef> = Object.fromEntries(COLOR_TOKENS.map((t) => [t.id, t])) as Record<ColorTokenId, ColorTokenDef>;

export const TOKEN_CATEGORY_LABEL: Record<TokenCategory, string> = {
  surfaces: 'Surfaces', text: 'Text', lines: 'Lines', accent: 'Accent', states: 'States', status: 'Status', filetypes: 'File types', progress: 'Progress', overlays: 'Overlays and scrollbars',
};

export type ThemeMode = 'dark' | 'light';
export type TokenValues = Record<ColorTokenId, string>;

export function baseTokens(mode: ThemeMode): TokenValues {
  return Object.fromEntries(COLOR_TOKENS.map((t) => [t.id, t[mode]])) as TokenValues;
}

/**
 * Tokens a future Orbis host may supply through the design-system adapter.
 * Status, focus and file-type colours stay under Orbis Files' control so a
 * host theme cannot weaken safety cues.
 */
export const HOST_OVERRIDABLE_TOKENS: ReadonlySet<ColorTokenId> = new Set([
  'bgApp', 'bgSidebar', 'bgSurface', 'bgSurface2', 'bgRaised', 'bgToolbar', 'bgPanel', 'bgDialog', 'bgTooltip', 'bgInput',
  'text', 'text2', 'text3', 'textDisabled', 'textOnAccent', 'border', 'borderStrong', 'accent', 'accentHover', 'accentSoft', 'accentLine', 'accent2',
  'hover', 'active', 'selected', 'selectedFocus', 'scrollbar', 'scrollbarHover',
]);
