/**
 * Editor bundle entry (built to dist/renderer/editor.js and loaded on first
 * use): CodeMirror 6 with the app's look. Colours come only from the design
 * tokens (CSS variables), so the editor follows dark/light, presets, accent
 * changes and high contrast like the rest of the window.
 */
import { Compartment, EditorSelection, EditorState, type Extension, type Text } from '@codemirror/state';
import {
  crosshairCursor, drawSelection, dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import { gotoLine, highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, indentUnit, StreamLanguage, syntaxHighlighting, type LanguageSupport } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { yaml } from '@codemirror/lang-yaml';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { rust } from '@codemirror/lang-rust';
import { go } from '@codemirror/lang-go';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { EDITOR_LANGUAGES } from '../../shared/editorLanguages';
import type { EditorKit, KitState, KitStateOptions, KitText, KitUpdate, KitView } from './kit';

/** Language support is built the first time a language is used, then reused. */
const LANGUAGE_FACTORIES: Record<string, () => LanguageSupport | Extension> = {
  plain: () => [],
  markdown: () => markdown(),
  javascript: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true, jsx: true }),
  json: () => json(),
  css: () => css(),
  html: () => html(),
  xml: () => xml(),
  python: () => python(),
  yaml: () => yaml(),
  shell: () => StreamLanguage.define(shell),
  sql: () => sql(),
  rust: () => rust(),
  go: () => go(),
  java: () => java(),
  cpp: () => cpp(),
  toml: () => StreamLanguage.define(toml),
  ini: () => StreamLanguage.define(properties),
  dockerfile: () => StreamLanguage.define(dockerFile),
  diff: () => StreamLanguage.define(diff),
};
const loaded = new Map<string, LanguageSupport | Extension>();
function languageExtension(id: string): LanguageSupport | Extension {
  let ext = loaded.get(id);
  if (!ext) {
    ext = (LANGUAGE_FACTORIES[id] ?? LANGUAGE_FACTORIES.plain!)();
    loaded.set(id, ext);
  }
  return ext;
}

const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'var(--bg-surface)', height: '100%', fontSize: 'var(--fs-md)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--accent)', padding: 'var(--sp-3) 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--bg-selected-focus)' },
  '.cm-selectionBackground': { backgroundColor: 'var(--bg-selected)' },
  '.cm-activeLine': { backgroundColor: 'var(--bg-hover)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-surface-2)', color: 'var(--text-3)', borderRight: '1px solid var(--border)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 var(--sp-3) 0 var(--sp-4)', fontVariantNumeric: 'tabular-nums' },
  '.cm-foldGutter .cm-gutterElement': { color: 'var(--text-3)', padding: '0 2px' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-active)', border: '1px solid var(--border)', color: 'var(--text-2)' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--accent-soft)', outline: '1px solid var(--accent-line)' },
  '&.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'var(--error-soft)', outline: '1px solid var(--error)' },
  '.cm-searchMatch': { backgroundColor: 'var(--warning-soft)', outline: '1px solid var(--warning)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)', outline: '2px solid var(--accent)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--accent-soft)' },
  '.cm-specialChar': { color: 'var(--error)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-raised)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)' },
  '.cm-panels': { backgroundColor: 'var(--bg-surface-2)', color: 'var(--text)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-panel': { fontFamily: 'var(--font-ui)', fontSize: 'var(--fs-sm)' },
  '.cm-panel.cm-search': { padding: 'var(--sp-3) var(--sp-8) var(--sp-3) var(--sp-4)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--sp-2) var(--sp-3)' },
  '.cm-panel.cm-search br': { flexBasis: '100%', height: 0, content: '""' },
  '.cm-panel input[type=checkbox]': { accentColor: 'var(--accent)', margin: '0 var(--sp-2) 0 0' },
  '.cm-panel label': { display: 'inline-flex', alignItems: 'center', color: 'var(--text-2)', fontSize: 'var(--fs-sm)', whiteSpace: 'nowrap' },
  '.cm-textfield': { backgroundColor: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', padding: '3px var(--sp-3)', fontSize: 'var(--fs-sm)', minWidth: '0', maxWidth: '100%' },
  '.cm-textfield:focus': { outline: '2px solid var(--border-focus)', outlineOffset: '0' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg-raised)', color: 'var(--text)', border: '1px solid var(--border-strong)', borderRadius: 'var(--radius-sm)', padding: '3px var(--sp-4)', fontSize: 'var(--fs-sm)', margin: 0 },
  '.cm-button:hover': { backgroundColor: 'var(--bg-hover)' },
  '.cm-button:focus-visible': { outline: '2px solid var(--border-focus)' },
  '.cm-panel button[name=close]': { color: 'var(--text-2)', fontSize: '18px', right: 'var(--sp-3)', top: 'var(--sp-2)', padding: '0 var(--sp-2)', borderRadius: 'var(--radius-sm)' },
  '.cm-panel button[name=close]:hover': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
  '.cm-panel.cm-goto-line': { padding: 'var(--sp-3) var(--sp-4)', display: 'flex', flexWrap: 'wrap', gap: 'var(--sp-3)', alignItems: 'center' },
});

/** Syntax colours: only tokens that are checked for readable contrast on the editor's surface. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--accent)', fontWeight: '600' },
  { tag: [t.string, t.special(t.string), t.regexp, t.character, t.attributeValue], color: 'var(--accent-2)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.constant(t.name), t.standard(t.name)], color: 'var(--warning)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--text-3)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.angleBracket], color: 'var(--accent)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName], color: 'var(--text)', fontWeight: '600' },
  { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--text-2)' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta, t.annotation], color: 'var(--text-3)' },
  { tag: [t.invalid, t.deleted], color: 'var(--error)' },
  { tag: t.inserted, color: 'var(--accent-2)' },
  { tag: t.changed, color: 'var(--warning)' },
  { tag: [t.heading, t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--text)', fontWeight: '700' },
  { tag: [t.heading1, t.heading2], color: 'var(--text)', fontWeight: '700', fontSize: '1.08em' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--accent)', textDecoration: 'underline' },
  { tag: [t.monospace, t.quote], color: 'var(--text-2)' },
  { tag: [t.contentSeparator, t.list], color: 'var(--accent)' },
  { tag: [t.escape, t.special(t.variableName)], color: 'var(--warning)' },
]);

const language = new Compartment();
const wrapping = new Compartment();
const indent = new Compartment();
const readOnly = new Compartment();
const label = new Compartment();

const indentExt = (useTabs: boolean, size: number): Extension => [EditorState.tabSize.of(size), indentUnit.of(useTabs ? '\t' : ' '.repeat(size))];
const readOnlyExt = (ro: boolean): Extension => [EditorState.readOnly.of(ro)];
const labelExt = (text: string): Extension => EditorView.contentAttributes.of({ 'aria-label': text, 'aria-multiline': 'true' });

/** Labels of CodeMirror's own panels, in the app's sentence case. */
const PHRASES = {
  next: 'Next', previous: 'Previous', all: 'Select all', 'match case': 'Match case', regexp: 'Regular expression', 'by word': 'Whole word',
  replace: 'Replace', 'replace all': 'Replace all', close: 'Close', go: 'Go', 'current match': 'Current match', 'on line': 'on line',
  'Folded lines': 'Folded lines', 'Unfolded lines': 'Unfolded lines', 'Fold line': 'Fold line', 'Unfold line': 'Unfold line',
};

function baseExtensions(o: KitStateOptions): Extension[] {
  return [
    EditorState.phrases.of(PHRASES),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter({ markerDOM: (open) => {
      const el = document.createElement('span');
      el.textContent = open ? '⌄' : '›';
      el.setAttribute('aria-hidden', 'true');
      return el;
    } }),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(highlight),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    keymap.of([
      // Ctrl+G is "Go to line" here (as in most editors); the search panel keeps F3 / Shift+F3 and Enter for next/previous.
      { key: 'Mod-g', run: gotoLine, preventDefault: true },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    theme,
    language.of(languageExtension(o.language)),
    wrapping.of(o.wrap ? EditorView.lineWrapping : []),
    indent.of(indentExt(o.useTabs, o.tabSize)),
    readOnly.of(readOnlyExt(o.readOnly)),
    label.of(labelExt(o.label)),
  ];
}

const asState = (s: KitState) => s as unknown as EditorState;
const asKit = (s: EditorState) => s as unknown as KitState;

function effectsFor(o: Partial<KitStateOptions>, current?: { useTabs: boolean; tabSize: number }) {
  const effects = [];
  if (o.language !== undefined) effects.push(language.reconfigure(languageExtension(o.language)));
  if (o.wrap !== undefined) effects.push(wrapping.reconfigure(o.wrap ? EditorView.lineWrapping : []));
  if (o.useTabs !== undefined || o.tabSize !== undefined) effects.push(indent.reconfigure(indentExt(o.useTabs ?? current?.useTabs ?? false, o.tabSize ?? current?.tabSize ?? 4)));
  if (o.readOnly !== undefined) effects.push(readOnly.reconfigure(readOnlyExt(o.readOnly)));
  if (o.label !== undefined) effects.push(label.reconfigure(labelExt(o.label)));
  return effects;
}

const currentIndent = (s: EditorState) => ({ useTabs: s.facet(indentUnit) === '\t', tabSize: s.tabSize });

function wrapView(view: EditorView): KitView {
  const apply = (o: Partial<KitStateOptions>) => view.dispatch({ effects: effectsFor(o, currentIndent(view.state)) });
  return {
    get state() {
      return asKit(view.state);
    },
    scrollDOM: view.scrollDOM,
    contentDOM: view.contentDOM,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
    setLanguage: (id) => apply({ language: id }),
    setWrap: (on) => apply({ wrap: on }),
    setIndent: (useTabs, size) => apply({ useTabs, tabSize: size }),
    setReadOnly: (ro) => apply({ readOnly: ro }),
    setLabel: (text) => apply({ label: text }),
    openSearch: () => {
      openSearchPanel(view);
    },
    gotoLine: () => {
      gotoLine(view);
    },
    undo: () => undo(view),
    redo: () => redo(view),
    setState: (s) => view.setState(asState(s)),
    topLine: () => {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
      return view.state.doc.lineAt(block.from).number;
    },
  };
}

const kit: EditorKit = {
  languages: EDITOR_LANGUAGES.map((l) => ({ id: l.id, label: l.label })),
  createState: (o) => asKit(EditorState.create({ doc: o.doc, extensions: baseExtensions(o), selection: o.cursor ? EditorSelection.cursor(Math.min(o.cursor, o.doc.length)) : undefined })),
  mount(parent, state, onUpdate) {
    const ref: { wrapped?: KitView } = {};
    const view = new EditorView({
      state: asState(state),
      parent,
      dispatchTransactions: (trs, v) => {
        v.update(trs);
        const u: KitUpdate = { docChanged: trs.some((tr) => tr.docChanged), selectionSet: trs.some((tr) => !!tr.selection), focusChanged: false, viewportChanged: false };
        if (ref.wrapped) onUpdate(u, ref.wrapped);
      },
    });
    ref.wrapped = wrapView(view);
    return ref.wrapped;
  },
  docOf: (s) => asState(s).doc as unknown as KitText,
  textOf: (s) => asState(s).doc.toString(),
  sameText: (a, b) => (a as unknown as Text).eq(b as unknown as Text),
  cursor: (s) => {
    const st = asState(s);
    const main = st.selection.main;
    const line = st.doc.lineAt(main.head);
    let selectedChars = 0;
    for (const r of st.selection.ranges) selectedChars += r.to - r.from;
    // Column counts a tab as the tab width, as editors show it.
    let col = 1;
    for (const ch of line.text.slice(0, main.head - line.from)) col = ch === '\t' ? col + st.tabSize - ((col - 1) % st.tabSize) : col + 1;
    return { line: line.number, col, selections: st.selection.ranges.length, selectedChars, lines: st.doc.lines, head: main.head };
  },
  canUndo: (s) => undoDepth(asState(s)) > 0,
  canRedo: (s) => redoDepth(asState(s)) > 0,
  reconfigure: (s, o) => {
    const st = asState(s);
    return asKit(st.update({ effects: effectsFor(o, currentIndent(st)) }).state);
  },
};

window.orbisEditorKit = kit;
