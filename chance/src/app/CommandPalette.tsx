/**
 * The command palette: one search box over everything the application can
 * navigate to. Opened with Ctrl+K / Cmd+K from anywhere, or from the search
 * control in the header — a keyboard-only entry point would not be found.
 *
 * It imports no tool screen module. Matching runs over the eager metadata in
 * `./tools` and the examples library (see `./search`), and selecting a result
 * navigates by route, so the 36 code-split screens stay split. The only tool
 * code it reaches is `resolveEntryConfig`, which is a dynamic import.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from './store';
import { TOOLS_BY_ID } from './tools';
import { searchEverything, type SearchAction, type SearchResult } from './search';
import { resolveEntryConfig } from './tools/lazy';
import { Icon } from '../ui/icons';
import { Button } from '../ui/primitives';
import type { ToolId } from '../persistence/schema';

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

export function CommandPalette({ onClose }: { onClose(): void }) {
  const app = useApp();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const results = useMemo(
    () =>
      searchEverything(query, {
        investigations: app.investigations,
        toolName: (id) => TOOLS_BY_ID.get(id)?.name ?? id,
        toolIcon: (id) => TOOLS_BY_ID.get(id)?.icon ?? 'saved',
      }),
    [query, app.investigations],
  );

  // A new query starts at the top result rather than keeping a stale index.
  useEffect(() => {
    setActive(0);
  }, [query]);

  const run = useCallback(
    (action: SearchAction) => {
      switch (action.kind) {
        case 'navigate':
          app.navigate(action.route);
          break;
        case 'open-investigation':
          void app.openInvestigation(action.investigationId);
          break;
        case 'open-entry': {
          // Exactly what the library screens do: resolve the configuration
          // against the tool's own defaults, then open it as a working
          // investigation rather than a read-only description.
          const toolId = action.toolId as ToolId;
          void resolveEntryConfig(toolId, action.configOverride).then((config) => {
            app.startInvestigation(toolId, config, { name: action.name, assumptions: action.assumptions, origin: action.origin });
            if (action.description) app.updateCurrent({ description: action.description });
            app.navigate({ kind: 'tool', toolId });
          });
          break;
        }
      }
      onClose();
    },
    [app, onClose],
  );

  // Focus the input on open, trap Tab inside the panel, and restore focus to
  // wherever it was when the palette closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const node = panelRef.current;
      if (!node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus();
    };
  }, []);

  // Keep the highlighted option in view when arrowing through a long list.
  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`);
    node?.scrollIntoView({ block: 'nearest' });
    // optionId is derived from listId, which is stable for the palette's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, results]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (results.length) setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (results.length) setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Home') {
      if (results.length) {
        e.preventDefault();
        setActive(0);
      }
    } else if (e.key === 'End') {
      if (results.length) {
        e.preventDefault();
        setActive(results.length - 1);
      }
    } else if (e.key === 'Enter') {
      const result = results[active];
      if (result) {
        e.preventDefault();
        run(result.action);
      }
    }
  };

  const status = !query.trim()
    ? 'Type to search tools, saved investigations, examples and templates.'
    : results.length === 0
      ? `Nothing matches “${query.trim()}”.`
      : `${results.length} result${results.length === 1 ? '' : 's'}.`;

  return (
    <div
      className="oc-dialog-backdrop oc-palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="oc-dialog oc-palette" role="dialog" aria-modal="true" aria-label="Search Orbis Chance" ref={panelRef}>
        <div className="oc-palette__search">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="oc-input"
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results.length ? optionId(active) : undefined}
            aria-label="Search tools, methods, investigations and examples"
            placeholder="Search tools, methods, investigations…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          <Button icon="x" variant="ghost" size="sm" title="Close search" onClick={onClose} />
        </div>

        <div className="oc-palette__results">
          <ul className="oc-palette__list" role="listbox" id={listId} aria-label="Search results" ref={listRef}>
            {results.map((result, index) => (
              <PaletteOption
                key={result.id}
                result={result}
                id={optionId(index)}
                selected={index === active}
                onHover={() => setActive(index)}
                onPick={() => run(result.action)}
              />
            ))}
          </ul>
          {query.trim() && results.length === 0 && (
            <p className="oc-palette__empty">
              Nothing matches “{query.trim()}”. Try a method name — “expected shortfall”, “Ljung-Box”, “Kendall tau” — or a question.
            </p>
          )}
          {!query.trim() && (
            <p className="oc-palette__empty">
              Search {TOOLS_BY_ID.size} tools by name, method or question, plus your saved investigations, the worked examples and the templates.
            </p>
          )}
        </div>

        <div className="oc-palette__footer">
          <span aria-live="polite" className="oc-palette__status">
            {status}
          </span>
          <span className="oc-palette__hints" aria-hidden="true">
            <kbd>↑</kbd>
            <kbd>↓</kbd> to move · <kbd>Enter</kbd> to open · <kbd>Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

function PaletteOption({
  result,
  id,
  selected,
  onHover,
  onPick,
}: {
  result: SearchResult;
  id: string;
  selected: boolean;
  onHover(): void;
  onPick(): void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      className="oc-palette__option"
      data-selected={selected || undefined}
      onMouseMove={onHover}
      // The keyboard path goes through the combobox, which owns the selection;
      // the mouse path needs no focus of its own, so this is a plain click.
      onClick={onPick}
    >
      <span className="oc-palette__icon" aria-hidden="true">
        <Icon name={result.icon} size={15} />
      </span>
      <span className="oc-palette__text">
        <span className="oc-palette__title">{result.title}</span>
        <span className="oc-palette__reason">{result.reason}</span>
      </span>
      <span className="oc-palette__kind">
        {result.kindLabel}
        <span className="oc-palette__context">{result.context}</span>
      </span>
    </li>
  );
}

/** Ctrl+K / Cmd+K from anywhere, and the open/close state behind it. */
export function useCommandPalette(): { open: boolean; setOpen(v: boolean): void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return { open, setOpen };
}
