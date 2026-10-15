import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  activateTab, attachSurfaces, cdToPaneFolder, clearTerminal, closeAllTerminals, closeFind, closeTab, copySelection, dropPaths, findInTerminal, fitActive, focusActive,
  hasSelectionIn, newTerminal, openFind, pasteFromClipboard, restartTerminal, selectAllText, setDockHeight, setFind, showTerminalFolder, tabTitle, terminal, toggleDock, toggleFollow,
  type TermTab,
} from '../state/terminal';
import { activePane, currentLocation, navigate, ws } from '../state/workspace';
import { IconButton, Button, Splitter, useMenu, SEP, type MenuItem } from '../ui/components';
import { Icon } from '../ui/Icon';
import { shortcutFor } from '../commands';
import { isDraggingPaths, readDragPaths } from './dnd';

/**
 * The terminal panel under the panes: tabs (one shell each), actions, find bar,
 * and the terminal surfaces (xterm.js elements owned by state/terminal.ts and
 * attached here). Hidden, not unmounted, while the panel is closed, so terminals
 * keep running and keep their output.
 */
export function TerminalDock() {
  const st = useStore(terminal, (s) => ({ open: s.open, tabs: s.tabs, active: s.active, height: s.height, find: s.find, surfaces: s.surfaces, info: s.info }));
  const paneDir = useStore(ws, () => {
    const l = currentLocation(activePane());
    return l.kind === 'fs' ? l.path : undefined;
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(st.height);
  const [over, setOver] = useState(false);
  const menu = useMenu();
  useEffect(() => setH(st.height), [st.height]);
  const active = st.tabs.find((t) => t.key === st.active);

  // Attach every tab's terminal element; only the active one is shown.
  useLayoutEffect(() => {
    if (bodyRef.current) attachSurfaces(bodyRef.current);
  }, [st.surfaces, st.active, st.tabs.length, st.open]);
  // Fit when the panel is shown, resized, or the active tab changes.
  useEffect(() => {
    if (!st.open || !bodyRef.current) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => fitActive());
    });
    ro.observe(bodyRef.current);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [st.open, st.active]);

  if (!st.tabs.length && !st.open) return null;
  const running = active?.status === 'running';
  const cwdOk = st.info?.cwdSupported !== false;
  const followOk = st.info?.foregroundSupported !== false;
  const maxH = Math.max(160, Math.round(window.innerHeight * 0.7));

  const actionItems = (t: TermTab | undefined): MenuItem[] => [
    { label: 'New terminal', icon: 'plus', shortcut: shortcutFor('terminal.new'), run: () => void newTerminal() },
    SEP,
    { label: 'Go to pane folder', icon: 'terminalCd', disabled: !running || !paneDir, reason: !running ? 'The terminal is not running.' : 'The active pane does not show a folder on this computer.', run: () => void cdToPaneFolder() },
    { label: 'Show terminal folder in pane', icon: 'terminalReveal', disabled: !running || !cwdOk, reason: !cwdOk ? 'Windows does not let Orbis Files read the folder a shell is in.' : 'The terminal is not running.', run: () => void showTerminalFolder() },
    { label: 'Follow pane folder', icon: 'follow', checked: !!t?.follow, disabled: !running || !followOk, reason: !followOk ? 'On Windows Orbis Files cannot tell whether the shell is idle.' : 'The terminal is not running.', run: () => toggleFollow() },
    SEP,
    { label: 'Copy', icon: 'copy', shortcut: window.orbis.platform === 'darwin' ? '⌘C' : 'Ctrl+Shift+C', disabled: !hasSelectionIn(), reason: 'Select text in the terminal first.', run: () => copySelection() },
    { label: 'Paste', icon: 'paste', shortcut: window.orbis.platform === 'darwin' ? '⌘V' : 'Ctrl+Shift+V', disabled: !running, reason: 'The terminal is not running.', run: () => void pasteFromClipboard() },
    { label: 'Select all', run: () => selectAllText() },
    { label: 'Find…', icon: 'search', shortcut: window.orbis.platform === 'darwin' ? '⌘F' : 'Ctrl+Shift+F', run: () => openFind() },
    { label: 'Clear', icon: 'eraser', run: () => clearTerminal() },
    SEP,
    { label: 'Restart', icon: 'retry', disabled: !t || t.status === 'running' || t.status === 'starting', reason: 'The terminal is still running.', run: () => void restartTerminal() },
    { label: 'Close terminal', icon: 'close', run: () => void closeTab() },
    { label: 'Close terminal panel', icon: 'panelClose', run: () => void closeAllTerminals() },
  ];

  return (
    <section className={`term-dock ${over ? 'is-drop' : ''}`} aria-label="Terminal" hidden={!st.open} style={{ height: h }}>
      <Splitter orientation="horizontal" side="right" label="Resize terminal panel" value={Math.round(h)} min={120} max={maxH} onResize={(v, done) => {
        setH(v);
        setDockHeight(v, done);
      }} />
      <div className="term-head">
        <div className="term-tabs" role="tablist" aria-label="Terminals">
          {st.tabs.map((t, i) => (
            <div
              key={t.key}
              role="tab"
              id={`term-tab-${t.key}`}
              aria-selected={t.key === st.active}
              aria-controls="term-body"
              tabIndex={t.key === st.active ? 0 : -1}
              className={`term-tab ${t.key === st.active ? 'is-active' : ''} is-${t.status}`}
              title={t.cwd ? `${tabTitle(t)} — ${t.cwd}` : tabTitle(t)}
              aria-keyshortcuts="Delete"
              onClick={() => activateTab(t.key)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void closeTab(t.key);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Delete') {
                  e.preventDefault();
                  e.stopPropagation();
                  void closeTab(t.key);
                  return;
                }
                const to = e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? st.tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + st.tabs.length) % st.tabs.length] : e.key === 'Home' ? st.tabs[0] : e.key === 'End' ? st.tabs[st.tabs.length - 1] : undefined;
                if (to) {
                  e.preventDefault();
                  terminal.set({ active: to.key });
                  requestAnimationFrame(() => document.getElementById(`term-tab-${to.key}`)?.focus());
                }
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  activateTab(t.key);
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                activateTab(t.key);
                menu.open(actionItems(t), e.clientX, e.clientY);
              }}
            >
              <Icon name="terminal" size={13} />
              <span className="term-tab-title">{tabTitle(t)}</span>
              {t.status === 'exited' && <span className={`term-tab-exit ${t.exitCode ? 'bad' : ''}`}>{t.signal ? `signal ${t.signal}` : `exit ${t.exitCode}`}</span>}
              {t.follow && <span className="term-tab-follow" title="Follows the pane's folder"><Icon name="follow" size={11} /><span className="sr-only">, follows the pane</span></span>}
              {/* Mouse affordance only: keyboard users close with Delete on the tab or the panel's actions. */}
              <span className="term-tab-close" aria-hidden title="Close terminal" onClick={(e) => {
                e.stopPropagation();
                void closeTab(t.key);
              }}>
                <Icon name="close" size={12} />
              </span>
            </div>
          ))}
        </div>
        <IconButton icon="plus" label="New terminal" shortcut={shortcutFor('terminal.new')} onClick={() => void newTerminal()} />
        <span className="spacer" />
        <div className="term-actions">
          <IconButton icon="terminalCd" label="Go to pane folder" disabled={!running || !paneDir} onClick={() => void cdToPaneFolder()} />
          {cwdOk && <IconButton icon="terminalReveal" label="Show terminal folder in pane" disabled={!running} onClick={() => void showTerminalFolder()} />}
          {followOk && <IconButton icon="follow" label="Follow pane folder" active={!!active?.follow} disabled={!running} onClick={() => toggleFollow()} />}
          <IconButton icon="search" label="Find in terminal" shortcut={window.orbis.platform === 'darwin' ? '⌘F' : 'Ctrl+Shift+F'} onClick={() => openFind()} />
          <IconButton icon="eraser" label="Clear terminal" disabled={!active} onClick={() => clearTerminal()} />
        </div>
        <IconButton icon="more" label="More terminal actions" onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          menu.open(actionItems(active), r.right, r.top, 'right');
        }} />
        <IconButton icon="panelHide" label="Hide terminal panel" shortcut={shortcutFor('terminal.toggle')} onClick={() => void toggleDock()} />
        <IconButton icon="panelClose" className="term-close-panel" label="Close terminal panel (ends all terminals)" onClick={() => void closeAllTerminals()} />
      </div>
      {st.find.open && <FindBar />}
      {active?.followNote && active.follow && (
        <div className="term-note" role="status">
          <Icon name="info" size={13} />
          <span>{active.followNote}</span>
          <span className="spacer" />
          <Button size="sm" variant="ghost" disabled={!running || !paneDir} onClick={() => void cdToPaneFolder()}>Go now</Button>
        </div>
      )}
      <div
        id="term-body"
        className="term-body"
        role="tabpanel"
        aria-labelledby={active ? `term-tab-${active.key}` : undefined}
        ref={bodyRef}
        onDragOver={(e) => {
          if (!isDraggingPaths(e) || !running) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={(e) => {
          if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false);
        }}
        onDrop={(e) => {
          setOver(false);
          if (!running) return;
          const paths = readDragPaths(e);
          if (!paths.length) return;
          e.preventDefault();
          e.stopPropagation();
          void dropPaths(paths).then(() => focusActive());
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          menu.open(actionItems(active), e.clientX, e.clientY);
        }}
      >
        {active?.status === 'starting' && <div className="term-overlay muted" role="status">Starting {active.shell}…</div>}
        {active?.status === 'failed' && (
          <div className="term-overlay term-failed" role="alert">
            <Icon name="error" size={18} />
            <div>
              <strong>The terminal could not start.</strong>
              <p>{active.error}</p>
            </div>
            <div className="term-overlay-actions">
              <Button size="sm" icon="retry" onClick={() => void restartTerminal(active.key)}>Try again</Button>
              <Button size="sm" variant="ghost" icon="settings" onClick={() => void navigate(activePane().id, { kind: 'tool', tool: 'settings' }).then(() => setTimeout(() => document.getElementById('settings-terminal')?.scrollIntoView({ block: 'start' }), 200))}>Settings</Button>
              <Button size="sm" variant="ghost" onClick={() => void closeTab(active.key)}>Close</Button>
            </div>
          </div>
        )}
        {active?.status === 'exited' && (
          <div className="term-exit" role="status">
            <span className={`term-exit-icon ${active.exitCode || active.signal ? 'bad' : ''}`}><Icon name={active.exitCode || active.signal ? 'warning' : 'success'} size={14} /></span>
            <span className="term-exit-text">{active.signal ? `The process ended by signal ${active.signal}.` : `The process exited with code ${active.exitCode}.`}</span>
            <span className="spacer" />
            <Button size="sm" icon="retry" onClick={() => void restartTerminal(active.key)}>Restart</Button>
            <Button size="sm" variant="ghost" onClick={() => void closeTab(active.key)}>Close</Button>
          </div>
        )}
      </div>
      {menu.node}
    </section>
  );
}

function FindBar() {
  const f = useStore(terminal, (s) => s.find);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const status = !f.query ? '' : f.result && f.result.count > 0 ? (f.result.index >= 0 ? `${f.result.index + 1} of ${f.result.count}` : `${f.result.count}+ matches`) : f.notFound ? 'No matches' : '';
  const toggle = (k: 'caseSensitive' | 'regex' | 'wholeWord') => {
    setFind({ [k]: !f[k] });
    requestAnimationFrame(() => findInTerminal('next', true));
  };
  return (
    <div className="term-find" role="search" aria-label="Find in terminal">
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        type="text"
        className="input"
        aria-label="Find in terminal output"
        placeholder="Find in output"
        value={f.query}
        onChange={(e) => {
          setFind({ query: e.target.value });
          requestAnimationFrame(() => findInTerminal('next', true));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            findInTerminal(e.shiftKey ? 'prev' : 'next');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeFind();
          }
        }}
      />
      <span className="term-find-status muted tabular" aria-live="polite">{status}</span>
      <IconButton icon="caseSensitive" label="Match case" active={f.caseSensitive} onClick={() => toggle('caseSensitive')} />
      <IconButton icon="wholeWord" label="Whole word" active={f.wholeWord} onClick={() => toggle('wholeWord')} />
      <IconButton icon="regex" label="Regular expression" active={f.regex} onClick={() => toggle('regex')} />
      <IconButton icon="up" label="Previous match" disabled={!f.query} onClick={() => findInTerminal('prev')} />
      <IconButton icon="down" label="Next match" disabled={!f.query} onClick={() => findInTerminal('next')} />
      <IconButton icon="close" label="Close find" onClick={() => closeFind()} />
    </div>
  );
}
