import {
  Activity,
  AudioWaveform,
  Axis3d,
  BarChart3,
  Binary,
  Braces,
  CircleDot,
  Clock,
  Columns3,
  Equal,
  FileInput,
  FileText,
  FlaskConical,
  FolderTree,
  GitCompare,
  Grid3x3,
  Hash,
  Library,
  LineChart,
  ListChecks,
  MessageSquare,
  Move,
  Orbit,
  Play,
  RotateCw,
  Ruler,
  ShieldCheck,
  Sigma,
  SlidersHorizontal,
  Table2,
  Target,
  TrendingUp,
  Triangle,
  Waves,
  Workflow,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'

/**
 * Icon names from a manifest turned into components.
 *
 * The registry names icons as text because it is pure and shared — a manifest cannot import React, and the same
 * manifests have to be readable by the main process, by tests, and eventually by the browser's own UI. So the mapping
 * lives here, on the one side that renders.
 *
 * `appIcon` never throws and never renders nothing: an unknown name falls back to a flask, so a Phase 2 app that ships
 * with an icon this build does not have appears with the wrong picture rather than with a hole.
 */
const ICONS: Readonly<Record<string, LucideIcon>> = Object.freeze({
  activity: Activity,
  'audio-waveform': AudioWaveform,
  'axis-3d': Axis3d,
  'bar-chart-3': BarChart3,
  binary: Binary,
  braces: Braces,
  'circle-dot': CircleDot,
  clock: Clock,
  'columns-3': Columns3,
  equal: Equal,
  'file-input': FileInput,
  'file-text': FileText,
  'folder-tree': FolderTree,
  'git-compare': GitCompare,
  'grid-3x3': Grid3x3,
  hash: Hash,
  library: Library,
  'line-chart': LineChart,
  'list-checks': ListChecks,
  'message-square': MessageSquare,
  move: Move,
  orbit: Orbit,
  play: Play,
  'rotate-cw': RotateCw,
  ruler: Ruler,
  'shield-check': ShieldCheck,
  sigma: Sigma,
  'sliders-horizontal': SlidersHorizontal,
  'table-2': Table2,
  target: Target,
  'trending-up': TrendingUp,
  triangle: Triangle,
  waves: Waves,
  workflow: Workflow,
  wrench: Wrench,
  zap: Zap
})

/**
 * Read with `hasOwnProperty` rather than by indexing.
 *
 * An icon name comes out of a manifest, which is somebody else's text: a name of `constructor` would otherwise resolve
 * to a function and be rendered as a component.
 */
export const appIcon = (name: string): LucideIcon =>
  Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : FlaskConical
