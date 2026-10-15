import React, { useEffect, useRef } from 'react';
import { useStore } from '../state/store';
import * as T from '../state/terminal';
import type { TermTab } from '../state/terminal';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/components';

/**
 * TerminalPanel: a dockable panel at the bottom of the window that hosts
 * one or more terminal tabs. Toggle with Ctrl+`. Delegates all state and
 * PTY management to state/terminal.ts (and main/terminal/).
 *
 * This component renders the tab bar, action buttons and the terminal
 * surface container. Each tab's xterm.js canvas is managed outside React
 * (by the terminal kit) and attached to the container div when shown.
 */

export function TerminalPanel() {
  const { open, tabs, active, height } = useStore(T.terminal, (s) => ({
    open: s.open,
    tabs: s.tabs,
    active: s.active,
    height: s.height,
  }));
  const containerRef = useRef<HTMLDivElement>(null);

  // Attach the active terminal's surfaces to our container div.
  useEffect(() => {
    if (!open || !containerRef.current) return;
    T.attachSurfaces(containerRef.current);
  }, [open, active]);

  // Fit the terminal when the panel height changes.
  useEffect(() => {
    if (open) T.fitActive();
  }, [open, height]);

  if (!open) return null;

  const activeTab: TermTab | undefined = tabs.find((t: TermTab) => t.key === active);

  return (
    <div
      className="terminal-panel"
      style={{ height, borderTop: '1px solid var(--glass-border)' }}
    >
      <div className="terminal-panel-header">
        <div className="terminal-tabs">
          {tabs.map((tab: TermTab) => (
            <button
              key={tab.key}
              type="button"
              className={`terminal-tab ${tab.key === active ? 'active' : ''} ${tab.status === 'exited' || tab.status === 'failed' ? 'exited' : ''}`}
              onClick={() => T.activateTab(tab.key)}
              title={tab.cwd}
            >
              <Icon name="terminal" size={13} />
              <span className="terminal-tab-label">
                {T.tabTitle(tab)}
              </span>
              <button
                type="button"
                className="terminal-tab-close"
                onClick={(e) => { e.stopPropagation(); void T.closeTab(tab.key); }}
                title="Close terminal"
              >
                <Icon name="close" size={10} />
              </button>
            </button>
          ))}
          <IconButton
            icon="plus"
            label="New terminal"
            className="terminal-new-btn"
            onClick={() => void T.newTerminal()}
          />
        </div>
        <div className="terminal-actions">
          {activeTab && activeTab.status === 'running' && (
            <IconButton
              icon="terminalCd"
              label="Go to pane folder"
              onClick={() => void T.cdToPaneFolder()}
            />
          )}
          <IconButton
            icon="search"
            label="Find in terminal"
            onClick={() => T.openFind()}
          />
          <IconButton
            icon="eraser"
            label="Clear terminal"
            onClick={() => T.clearTerminal()}
          />
          <IconButton
            icon="close"
            label="Hide terminal"
            onClick={() => T.hideDock()}
          />
        </div>
      </div>

      {/* The terminal surface is managed by xterm.js outside React */}
      <div
        ref={containerRef}
        className="terminal-surface"
        style={{ flex: 1, minHeight: 0 }}
      />

      {tabs.length === 0 && (
        <div className="terminal-empty">
          <span className="muted">Press <kbd>Ctrl+`</kbd> or click <strong>+</strong> to start a terminal</span>
        </div>
      )}
    </div>
  );
}
