/**
 * The contract between the window and the terminal bundle (`dist/renderer/terminal.js`
 * and `terminal.css`, built from terminal/xt.ts). xterm.js and its addons live only in
 * that bundle, which is loaded the first time a terminal opens.
 */

/** Colours for the terminal, resolved from the app's design tokens (hex, #rrggbb or #rrggbbaa). */
export interface TermTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionInactiveBackground: string;
  scrollbarSliderBackground: string;
  scrollbarSliderHoverBackground: string;
  scrollbarSliderActiveBackground: string;
  black: string; red: string; green: string; yellow: string; blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string; brightYellow: string; brightBlue: string; brightMagenta: string; brightCyan: string; brightWhite: string;
  /** Search highlights (#rrggbb only). */
  matchBackground: string;
  matchBorder: string;
  activeMatchBackground: string;
  activeMatchBorder: string;
}

export interface TermLook {
  fontFamily: string;
  fontSize: number;
  scrollback: number;
  theme: TermTheme;
}

export interface TermCreateOptions extends TermLook {
  /** A link (web links in the output, or OSC 8 hyperlinks) was activated. */
  onLink: (uri: string) => void;
  macOptionIsMeta: boolean;
}

export interface TermSearchOptions { caseSensitive: boolean; regex: boolean; wholeWord: boolean }

export interface TermHandle {
  /** Opens the terminal into an element that is attached to the document (once). */
  open(parent: HTMLElement): void;
  readonly opened: boolean;
  write(data: string, done: () => void): void;
  onData(cb: (data: string) => void): void;
  onTitle(cb: (title: string) => void): void;
  onBell(cb: () => void): void;
  /** Fit to the parent element; returns the new size, or undefined when it cannot be measured (hidden). */
  fit(): { cols: number; rows: number } | undefined;
  readonly cols: number;
  readonly rows: number;
  focus(): void;
  hasFocus(): boolean;
  hasSelection(): boolean;
  getSelection(): string;
  selectAll(): void;
  clearSelection(): void;
  /** Paste text the way a terminal does (bracketed when the program asked for it). */
  paste(text: string): void;
  /** Whether the program in the terminal enabled bracketed paste mode. */
  readonly bracketedPaste: boolean;
  /** Clear the screen and scrollback (the prompt line stays). */
  clear(): void;
  findNext(q: string, o: TermSearchOptions): boolean;
  findPrevious(q: string, o: TermSearchOptions): boolean;
  clearSearch(): void;
  onSearchResults(cb: (r: { index: number; count: number }) => void): void;
  setLook(look: Partial<TermLook>): void;
  /** Return false to let the window handle a key instead of the terminal. */
  setKeyHandler(fn: (e: KeyboardEvent) => boolean): void;
  /** Visible screen and scrollback as text (last `lines` lines), for tests and diagnostics. */
  text(lines?: number): string;
  dispose(): void;
}

export interface TerminalKit {
  create(o: TermCreateOptions): TermHandle;
}

declare global {
  interface Window {
    orbisTerminalKit?: TerminalKit;
  }
}
