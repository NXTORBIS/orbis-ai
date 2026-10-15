/**
 * The terminal bundle (dist/renderer/terminal.js + terminal.css): xterm.js with the
 * fit, search and web-links addons behind the small TerminalKit interface. Loaded
 * by state/terminal.ts the first time a terminal opens; never imported by app.js.
 */
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { TermCreateOptions, TermHandle, TermLook, TermSearchOptions, TermTheme, TerminalKit } from './kit';

function xtermTheme(t: TermTheme): ITheme {
  const { matchBackground: _a, matchBorder: _b, activeMatchBackground: _c, activeMatchBorder: _d, ...rest } = t;
  return rest;
}

function create(o: TermCreateOptions): TermHandle {
  const term = new Terminal({
    allowProposedApi: true,
    fontFamily: o.fontFamily,
    fontSize: o.fontSize,
    lineHeight: 1.2,
    scrollback: o.scrollback,
    theme: xtermTheme(o.theme),
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorInactiveStyle: 'outline',
    macOptionIsMeta: o.macOptionIsMeta,
    // Text stays readable on every theme surface even when a program picks poor colours.
    minimumContrastRatio: 4.5,
    drawBoldTextInBrightColors: true,
    rightClickSelectsWord: false,
    // Hyperlinks programs print with OSC 8 go through the same confirmation as plain web links.
    linkHandler: { activate: (_e, uri) => o.onLink(uri), allowNonHttpProtocols: false },
  });
  let theme = o.theme;
  const fit = new FitAddon();
  const search = new SearchAddon({ highlightLimit: 2000 });
  term.loadAddon(fit);
  term.loadAddon(search);
  term.loadAddon(new WebLinksAddon((_e, uri) => o.onLink(uri)));
  let opened = false;
  const decorations = () => ({
    matchBackground: theme.matchBackground,
    matchBorder: theme.matchBorder,
    matchOverviewRuler: theme.matchBorder,
    activeMatchBackground: theme.activeMatchBackground,
    activeMatchBorder: theme.activeMatchBorder,
    activeMatchColorOverviewRuler: theme.activeMatchBorder,
  });
  const searchOpts = (s: TermSearchOptions) => ({ caseSensitive: s.caseSensitive, regex: s.regex, wholeWord: s.wholeWord, decorations: decorations() });
  return {
    open(parent) {
      if (opened) return;
      term.open(parent);
      opened = true;
    },
    get opened() {
      return opened;
    },
    write: (data, done) => term.write(data, done),
    onData: (cb) => void term.onData(cb),
    onTitle: (cb) => void term.onTitleChange(cb),
    onBell: (cb) => void term.onBell(cb),
    fit() {
      if (!opened) return undefined;
      const d = fit.proposeDimensions();
      if (!d || !Number.isFinite(d.cols) || !Number.isFinite(d.rows) || d.cols < 2 || d.rows < 1) return undefined;
      if (d.cols !== term.cols || d.rows !== term.rows) term.resize(d.cols, d.rows);
      return { cols: term.cols, rows: term.rows };
    },
    get cols() {
      return term.cols;
    },
    get rows() {
      return term.rows;
    },
    focus: () => term.focus(),
    hasFocus: () => !!term.textarea && document.activeElement === term.textarea,
    hasSelection: () => term.hasSelection(),
    getSelection: () => term.getSelection(),
    selectAll: () => term.selectAll(),
    clearSelection: () => term.clearSelection(),
    paste: (text) => term.paste(text),
    get bracketedPaste() {
      return term.modes.bracketedPasteMode;
    },
    clear: () => term.clear(),
    findNext: (q, s) => search.findNext(q, searchOpts(s)),
    findPrevious: (q, s) => search.findPrevious(q, searchOpts(s)),
    clearSearch: () => search.clearDecorations(),
    onSearchResults: (cb) => void search.onDidChangeResults((r) => cb({ index: r.resultIndex, count: r.resultCount })),
    setLook(look: Partial<TermLook>) {
      if (look.theme) {
        theme = look.theme;
        term.options.theme = xtermTheme(look.theme);
      }
      if (look.fontFamily && look.fontFamily !== term.options.fontFamily) term.options.fontFamily = look.fontFamily;
      if (look.fontSize && look.fontSize !== term.options.fontSize) term.options.fontSize = look.fontSize;
      if (look.scrollback && look.scrollback !== term.options.scrollback) term.options.scrollback = look.scrollback;
    },
    setKeyHandler: (fn) => term.attachCustomKeyEventHandler(fn),
    text(lines = 200) {
      const b = term.buffer.active;
      const out: string[] = [];
      for (let i = Math.max(0, b.length - lines); i < b.length; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
      return out.join('\n').replace(/\n+$/, '');
    },
    dispose: () => term.dispose(),
  };
}

const kit: TerminalKit = { create };
window.orbisTerminalKit = kit;
