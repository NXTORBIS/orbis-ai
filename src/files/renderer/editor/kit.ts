/**
 * The contract between the window and the editor bundle (`dist/renderer/editor.js`,
 * built from editor/cm.ts). CodeMirror and its language packages live only in
 * that bundle, which is loaded the first time an editor opens, so starting the
 * app does not parse them. The window keeps editor states as opaque handles.
 */

declare const kitStateBrand: unique symbol;
declare const kitTextBrand: unique symbol;
/** An editor state (document, selection, undo history, settings). Immutable; kept per pane. */
export interface KitState { readonly [kitStateBrand]: true }
/** A document snapshot, for telling whether the text differs from what was saved. */
export interface KitText { readonly [kitTextBrand]: true }

export interface KitStateOptions {
  doc: string;
  language: string;
  readOnly: boolean;
  wrap: boolean;
  useTabs: boolean;
  tabSize: number;
  /** Accessible name of the text area (e.g. "Editing notes.md"). */
  label: string;
  /** Where the cursor starts (clamped to the document); the start when omitted. */
  cursor?: number;
}

export interface KitUpdate { docChanged: boolean; selectionSet: boolean; focusChanged: boolean; viewportChanged: boolean }

export interface KitCursor { line: number; col: number; selections: number; selectedChars: number; lines: number; head: number }

export interface KitView {
  readonly state: KitState;
  readonly scrollDOM: HTMLElement;
  readonly contentDOM: HTMLElement;
  focus(): void;
  destroy(): void;
  setLanguage(id: string): void;
  setWrap(on: boolean): void;
  setIndent(useTabs: boolean, size: number): void;
  setReadOnly(readOnly: boolean): void;
  setLabel(label: string): void;
  openSearch(): void;
  gotoLine(): void;
  undo(): boolean;
  redo(): boolean;
  /** Replace the whole state (after reloading from disk); the undo history starts again. */
  setState(state: KitState): void;
  /** Line number at the top of the visible area (for approximate preview scroll sync). */
  topLine(): number;
}

export interface EditorKit {
  languages: Array<{ id: string; label: string }>;
  createState(o: KitStateOptions): KitState;
  mount(parent: HTMLElement, state: KitState, onUpdate: (u: KitUpdate, view: KitView) => void): KitView;
  docOf(state: KitState): KitText;
  textOf(state: KitState): string;
  sameText(a: KitText, b: KitText): boolean;
  cursor(state: KitState): KitCursor;
  canUndo(state: KitState): boolean;
  canRedo(state: KitState): boolean;
  /** The same settings applied to a state that is not shown (another tab). */
  reconfigure(state: KitState, o: Partial<Pick<KitStateOptions, 'language' | 'readOnly' | 'wrap' | 'useTabs' | 'tabSize' | 'label'>>): KitState;
}

declare global {
  interface Window {
    orbisEditorKit?: EditorKit;
  }
}
