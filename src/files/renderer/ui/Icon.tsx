import {
  Activity, AlertTriangle, Archive, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, ArrowLeftRight, BookOpen, Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck,
  CircleX, Clipboard, ClipboardPaste, Clock, Code2, Columns3, Command, Copy, CopyPlus, Cpu, Database, Download, Eye, EyeOff, File, FileArchive, FileAudio,
  FileCode2, FileImage, FileSpreadsheet, FileText, FileVideo, FilePlus2, Files, Film, Folder, FolderInput, FolderOpen, FolderOutput, FolderPlus, Gauge, GitCompare,
  Grid2x2, HardDrive, History, Home, Image, Info, Layers, LayoutGrid, Link2, List, ListTree, Lock, Moon, Music, MoreHorizontal, PackageOpen, PanelLeft, PanelRight,
  Pause, PenLine, Pin, PinOff, Play, Plug, Plus, Presentation, RefreshCw, RotateCcw, RotateCw, Rows3, Scissors, Search, Settings2, Sparkles, SplitSquareHorizontal,
  Square, Star, Sun, Tag, Terminal, Trash2, Undo2, Usb, Wand2, X, ZoomIn, ZoomOut, Maximize2, Minus, Copy as WinRestore, Globe, Workflow, Bookmark, Network,
  FolderTree, AppWindow, KeyRound, Repeat, Images, FolderKanban, Import, Bell, ArrowUpToLine, ScanSearch, MapPinOff, FileCheck2, TrendingUp, FileDiff, MessageSquareText,
  Palette, Redo2, Save, LayoutTemplate, LayoutDashboard, Keyboard, Accessibility, SlidersHorizontal, Type, Navigation, PanelBottom, Menu, SwatchBook, ArrowDown,
  GripVertical, FileDown, FileUp, ShieldCheck, Contrast, ImagePlus, FolderSync, ChevronUp, Unlink, Brush,
  Server, ServerOff, Fingerprint, Unplug, CloudUpload, ShieldAlert,
  Replace, WrapText, Merge, Split, FileOutput, Regex, CaseSensitive, WholeWord, FileStack, Inbox, ListPlus, SquareTerminal, GitBranch, Share2, LockOpen, Upload, Zap, ZapOff, CalendarClock, Crop, FlipHorizontal2, FlipVertical2, Scaling,
  Eraser, Footprints, FolderSearch, PanelBottomClose, ChevronsDown, LocateFixed,
  DatabaseBackup, ArchiveRestore, CalendarOff, FileClock, FilePen, Hash, Shuffle, Minimize2, FolderClock, GalleryHorizontal, Type as FontType,
  // Text recognition (OCR)
  ScanText, TextSelect, Languages, FileScan, TextSearch,
  type LucideIcon,
} from 'lucide-react';
import { SquareSplitHorizontal, Combine, Flame, FoldVertical, CalendarCog, FileSymlink, ClipboardList, ImageDown, ClipboardType, ClipboardCopy } from 'lucide-react';
// Music player and video tools.
import {
  SkipBack, SkipForward, Volume2, VolumeX, Repeat1, ListMusic, ListEnd, ListStart, AudioLines, Clapperboard, ImagePlay, Camera, LayoutGrid as SheetGrid,
  RotateCwSquare, StepBack, StepForward, ArrowRightToLine, ArrowLeftToLine, CirclePlay, Gauge as SpeedGauge,
} from 'lucide-react';

/**
 * The single icon vocabulary for Orbis Files. Components refer to icons by
 * semantic name only, so stroke weight and sizing stay consistent.
 */
const ICONS: Record<string, LucideIcon> = {
  back: ArrowLeft, forward: ArrowRight, up: ArrowUp, refresh: RefreshCw, home: Home, path: Clipboard, search: Search, tab: Plus, window: ArrowUpRight,
  split: SplitSquareHorizontal, swap: ArrowLeftRight, open: FolderOpen, newFolder: FolderPlus, newFile: FilePlus2, rename: PenLine, bulkRename: Wand2,
  copy: Copy, cut: Scissors, paste: ClipboardPaste, duplicate: CopyPlus, trash: Trash2, deleteForever: CircleX, external: ArrowUpRight, info: Info,
  copyTo: FolderInput, moveTo: FolderOutput, archive: Archive, extract: PackageOpen, link: Link2, compare: GitCompare, history: History, pin: Pin, unpin: PinOff,
  collection: Layers, tag: Tag, viewDetails: Rows3, viewList: List, viewCompact: ListTree, viewGrid: LayoutGrid, viewGallery: Grid2x2, viewColumns: Columns3,
  eye: Eye, eyeOff: EyeOff, panelLeft: PanelLeft, panelRight: PanelRight, theme: Moon, sun: Sun, command: Command, activity: Activity, settings: Settings2,
  storage: Gauge, duplicates: Files, rules: Workflow, download: Download, media: Film, plug: Plug, workspace: Bookmark, sparkle: Sparkles,
  chevronRight: ChevronRight, chevronDown: ChevronDown, close: X, more: MoreHorizontal, check: Check, plus: Plus, minus: Minus, pause: Pause, play: Play,
  stop: Square, retry: RotateCcw, undo: Undo2, rotateLeft: RotateCcw, rotateRight: RotateCw, zoomIn: ZoomIn, zoomOut: ZoomOut, fullscreen: Maximize2,
  warning: AlertTriangle, error: CircleAlert, success: CircleCheck, clock: Clock, drive: HardDrive, usb: Usb, network: Network, database: Database, lock: Lock, star: Star,
  folder: Folder, folderOpen: FolderOpen, file: File, fileText: FileText, fileImage: FileImage, fileVideo: FileVideo, fileAudio: FileAudio, fileCode: FileCode2,
  fileArchive: FileArchive, fileSheet: FileSpreadsheet, fileSlides: Presentation, filePdf: BookOpen, fileExe: Terminal, image: Image, music: Music, code: Code2,
  cpu: Cpu, globe: Globe, winMin: Minus, winMax: Square, winRestore: WinRestore,
  viewTree: FolderTree, openWith: AppWindow, permissions: KeyRound, convert: Repeat, compareImages: Images, project: FolderKanban, import: Import,
  palette: Palette, redo: Redo2, save: Save, layout: LayoutTemplate, overview: LayoutDashboard, keyboard: Keyboard, accessibility: Accessibility, sliders: SlidersHorizontal,
  type: Type, navigation: Navigation, panelBottom: PanelBottom, menu: Menu, presets: SwatchBook, down: ArrowDown, grip: GripVertical, exportFile: FileDown, importFile: FileUp,
  shield: ShieldCheck, contrast: Contrast, imagePlus: ImagePlus, sync: FolderSync, chevronUp: ChevronUp, unlink: Unlink, cleanup: Brush, ChevronUp, Unlink, Brush,
  replace: Replace, textFix: WrapText, merge: Merge, splitDoc: Split, extractPages: FileOutput, regex: Regex, caseSensitive: CaseSensitive, wholeWord: WholeWord, pages: FileStack, shelf: Inbox, shelfAdd: ListPlus, action: SquareTerminal, gitBranch: GitBranch, share: Share2, unlock: LockOpen, upload: Upload, automation: Zap, automationOff: ZapOff, timeline: CalendarClock, crop: Crop, flipH: FlipHorizontal2, flipV: FlipVertical2, imageTools: Scaling,
  backup: DatabaseBackup, restore: ArchiveRestore, schedule: CalendarClock, scheduleOff: CalendarOff, fileVersions: FileClock, edit: FilePen, gotoLine: Hash, shuffle: Shuffle, loop: Repeat, exitFullscreen: Minimize2, organizeDate: FolderClock, slideshow: GalleryHorizontal, fileFont: FontType, server: Server, serverOff: ServerOff, fingerprint: Fingerprint, unplug: Unplug, uploadCloud: CloudUpload, shieldAlert: ShieldAlert,
  terminal: Terminal, terminalCd: LocateFixed, terminalReveal: FolderSearch, follow: Footprints, eraser: Eraser, panelHide: ChevronsDown, panelClose: PanelBottomClose,
  skipBack: SkipBack, skipForward: SkipForward, volume: Volume2, volumeOff: VolumeX, repeatOne: Repeat1, queue: ListMusic, playNext: ListStart, enqueue: ListEnd,
  nowPlaying: AudioLines, videoTools: Clapperboard, gif: ImagePlay, frame: Camera, join: Combine, contactSheet: SheetGrid, rotateVideo: RotateCwSquare,
  frameBack: StepBack, frameForward: StepForward, markIn: ArrowRightToLine, markOut: ArrowLeftToLine, playMedia: CirclePlay, speed: SpeedGauge,
  bell: Bell, prioritize: ArrowUpToLine, similar: ScanSearch, removeLocation: MapPinOff, verify: FileCheck2, trend: TrendingUp, diff: FileDiff, ask: MessageSquareText, alertTriangle: AlertTriangle, arrowLeftRight: ArrowLeftRight, arrowLeft: ArrowLeft, arrowDown: ArrowDown, bookmark: Bookmark, map: Globe, pieChart: Gauge, x: X, panelRightClose: PanelRight, panelRightOpen: PanelRight,
  // Text recognition (OCR)
  ocr: ScanText, ocrBoxes: TextSelect, languages: Languages, ocrExtract: FileScan, imageText: TextSearch,
};

// Power tools and clipboard
Object.assign(ICONS, { splitFile: SquareSplitHorizontal, joinFiles: Combine, shred: Flame, flatten: FoldVertical, setDates: CalendarCog, hardLink: FileSymlink, clipHistory: ClipboardList, pasteImage: ImageDown, pasteText: ClipboardType, copyImage: ClipboardCopy });

export function Icon({ name, size = 16, className, title }: { name: string; size?: number; className?: string; title?: string }) {
  const C = ICONS[name] ?? File;
  return <C size={size} strokeWidth={1.6} className={className} aria-hidden={title ? undefined : true} aria-label={title} focusable={false} />;
}
