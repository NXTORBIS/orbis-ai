import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  addPaths, clear, closePlayer, currentItem, cycleRepeat, moveItem, next, player, playId, previous, removeItems, savePlaylistDialog, seek, setRate, setVolume, toggleMute, togglePlay, toggleQueue,
  toggleShuffle,
} from '../state/player';
import { formatClock, itemTitle, PLAYBACK_RATES, type QueueItem } from '../../shared/player';
import { IconButton, SEP, useMenu, type MenuItem } from '../ui/components';
import { Icon } from '../ui/Icon';
import { shortcutFor } from '../commands';
import { isDraggingPaths, readDragPaths } from './dnd';
import { activePane, navigate } from '../state/workspace';

/**
 * The music player bar, docked under the panes (and under the terminal panel
 * when that is open: both are rows of the same column, so they stack and
 * never overlap). Compact by default; the queue opens above the controls.
 * Narrow windows keep play/pause, previous/next, the seek bar and More; the
 * rest moves into More (container queries in app.css).
 */
/**
 * The bar's height as `--player-h` on the document while it is shown, so the toasts and the Operations
 * panel (fixed at the window's bottom right) sit above it instead of covering its controls.
 */
let barObserver: ResizeObserver | undefined;
function trackBarHeight(el: HTMLElement | null): void {
  barObserver?.disconnect();
  barObserver = undefined;
  const root = document.documentElement;
  if (!el) {
    root.style.removeProperty('--player-h');
    return;
  }
  const set = () => root.style.setProperty('--player-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
  set();
  barObserver = new ResizeObserver(set);
  barObserver.observe(el);
}

export function PlayerBar() {
  const p = useStore(player, (s) => ({ loaded: s.loaded, state: s.state, playing: s.playing, time: s.time, duration: s.duration, queueOpen: s.queueOpen, hidden: s.hidden, cover: s.cover, announce: s.announce }));
  const menu = useMenu();
  const [over, setOver] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  if (!p.loaded || !p.state.items.length || p.hidden) return null;
  const it = currentItem(p.state);
  const s = p.state;
  const dur = p.duration || it?.durationSec || 0;
  const shown = scrub ?? p.time;
  const sub = it ? [it.artist, it.album].filter(Boolean).join(' · ') : '';
  const repeatLabel = s.repeat === 'off' ? 'Repeat: off' : s.repeat === 'all' ? 'Repeat: all' : 'Repeat: one';
  const rateLabel = `${s.rate}×`;

  const rateItems = (): MenuItem[] => PLAYBACK_RATES.map((r) => ({ label: r === 1 ? 'Normal (1×)' : `${r}×`, checked: s.rate === r, run: () => setRate(r) }));
  const moreItems = (): MenuItem[] => [
    { label: 'Shuffle', icon: 'shuffle', checked: s.shuffle, run: () => toggleShuffle() },
    { label: 'Repeat', icon: s.repeat === 'one' ? 'repeatOne' : 'loop', submenu: (['off', 'all', 'one'] as const).map((r) => ({ label: r === 'off' ? 'Off' : r === 'all' ? 'All' : 'One (this item)', checked: s.repeat === r, run: () => {
      while (player.get().state.repeat !== r) cycleRepeat();
    } })) },
    { label: `Playback speed (${rateLabel})`, icon: 'speed', submenu: rateItems() },
    { label: s.muted ? 'Unmute' : 'Mute', icon: s.muted ? 'volumeOff' : 'volume', run: () => toggleMute() },
    SEP,
    { label: p.queueOpen ? 'Hide queue' : 'Show queue', icon: 'queue', shortcut: shortcutFor('player.queue'), run: () => toggleQueue() },
    { label: 'Save queue as playlist…', icon: 'save', run: () => savePlaylistDialog() },
    { label: 'Show current file in its folder', icon: 'folderOpen', disabled: !it, run: () => {
      if (!it) return;
      // A file path opens its folder with the file selected.
      void navigate(activePane().id, { kind: 'fs', path: it.path });
    } },
    SEP,
    { label: 'Clear queue', icon: 'eraser', run: () => void clear() },
    { label: 'Close player', icon: 'close', run: () => closePlayer() },
  ];

  return (
    <section
      ref={trackBarHeight}
      className={`player-bar ${over ? 'is-drop' : ''} ${p.queueOpen ? 'has-queue' : ''}`}
      aria-label="Music player"
      onDragOver={(e) => {
        if (!isDraggingPaths(e) || e.dataTransfer.types.includes(QUEUE_DRAG)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(e) => {
        setOver(false);
        if (e.dataTransfer.types.includes(QUEUE_DRAG)) return;
        const paths = readDragPaths(e);
        if (!paths.length) return;
        e.preventDefault();
        void addPaths(paths, 'queue');
      }}
    >
      {menu.node}
      {p.queueOpen && <QueueList items={s.items} currentId={s.currentId} playing={p.playing} />}
      <div className="pb-row">
        <div className="pb-now" title={it ? `${itemTitle(it)}${sub ? ` — ${sub}` : ''}\n${it.path}` : undefined}>
          <div className="pb-cover" aria-hidden="true">
            {p.cover ? <img src={p.cover} alt="" /> : <Icon name="music" size={18} />}
          </div>
          <div className="pb-meta">
            <div className="pb-title">{it ? itemTitle(it) : 'Nothing playing'}</div>
            <div className="pb-sub">{it?.missing ? 'Missing file' : it?.error ? 'Cannot be played' : sub || (it ? it.path.split(/[\\/]/).slice(-2, -1)[0] ?? '' : '')}</div>
          </div>
        </div>
        <div className="pb-transport" role="group" aria-label="Playback">
          <IconButton icon="skipBack" label="Previous" shortcut={shortcutFor('player.previous')} onClick={() => void previous()} />
          <button type="button" className="pb-play" aria-label={p.playing ? 'Pause' : 'Play'} data-tip={`${p.playing ? 'Pause' : 'Play'}${shortcutFor('player.toggle') ? ` (${shortcutFor('player.toggle')})` : ''}`} onClick={() => togglePlay()}>
            <Icon name={p.playing ? 'pause' : 'play'} size={17} />
          </button>
          <IconButton icon="skipForward" label="Next" shortcut={shortcutFor('player.next')} onClick={() => void next()} />
        </div>
        <div className="pb-seek">
          <span className="pb-time tabular" aria-hidden="true">{formatClock(shown)}</span>
          <input
            type="range"
            className="pb-range"
            aria-label="Seek"
            min={0}
            max={Math.max(0.1, dur)}
            step={0.1}
            value={Math.min(shown, Math.max(0.1, dur))}
            disabled={!it || !dur}
            aria-valuetext={`${formatClock(shown)} of ${formatClock(dur)}`}
            style={{ '--pb-fill': `${dur ? Math.min(100, (shown / dur) * 100) : 0}%` } as React.CSSProperties}
            onChange={(e) => setScrub(Number(e.target.value))}
            onPointerUp={(e) => {
              seek(Number((e.target as HTMLInputElement).value));
              setScrub(null);
            }}
            onKeyUp={(e) => {
              if (scrub !== null) {
                seek(scrub);
                setScrub(null);
              }
              void e;
            }}
            onBlur={() => {
              if (scrub !== null) {
                seek(scrub);
                setScrub(null);
              }
            }}
          />
          <span className="pb-time tabular" aria-hidden="true">{formatClock(dur || undefined)}</span>
        </div>
        <div className="pb-extras">
          <IconButton icon="shuffle" label="Shuffle" active={s.shuffle} onClick={() => toggleShuffle()} />
          <IconButton icon={s.repeat === 'one' ? 'repeatOne' : 'loop'} label={repeatLabel} active={s.repeat !== 'off'} onClick={() => cycleRepeat()} />
          <div className="pb-volume">
            <IconButton icon={s.muted || s.volume === 0 ? 'volumeOff' : 'volume'} label={s.muted ? 'Unmute' : 'Mute'} active={s.muted} onClick={() => toggleMute()} />
            <input type="range" className="pb-range pb-vol" aria-label="Volume" min={0} max={100} step={1} value={Math.round((s.muted ? 0 : s.volume) * 100)} aria-valuetext={s.muted ? 'Muted' : `${Math.round(s.volume * 100)} %`} style={{ '--pb-fill': `${s.muted ? 0 : s.volume * 100}%` } as React.CSSProperties} onChange={(e) => setVolume(Number(e.target.value) / 100)} />
          </div>
          <button type="button" className="btn btn-ghost btn-sm pb-rate tabular" aria-label={`Playback speed ${rateLabel}`} aria-haspopup="menu" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            menu.open(rateItems(), r.left, r.top - 4);
          }}>{rateLabel}</button>
        </div>
        <div className="pb-end">
          <IconButton icon="queue" label={`${p.queueOpen ? 'Hide' : 'Show'} queue (${s.items.length} item${s.items.length === 1 ? '' : 's'})`} shortcut={shortcutFor('player.queue')} active={p.queueOpen} aria-expanded={p.queueOpen} aria-controls="player-queue" onClick={() => toggleQueue()} />
          <IconButton icon="more" label="More player actions" aria-haspopup="menu" onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            menu.open(moreItems(), r.right, r.top - 4, 'right');
          }} />
          <IconButton icon="close" className="pb-close" label="Close player (the queue is kept)" onClick={() => closePlayer()} />
        </div>
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{p.announce}</div>
    </section>
  );
}

const QUEUE_DRAG = 'application/x-orbis-queue-item';

/** The queue: a list of buttons (Enter plays), Alt+↑/↓ moves, Delete removes; rows can be dragged. */
function QueueList({ items, currentId, playing }: { items: QueueItem[]; currentId?: string; playing: boolean }) {
  const [focusId, setFocusId] = useState<string | undefined>(currentId ?? items[0]?.id);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const menu = useMenu();
  const total = items.reduce((t, i) => t + (i.durationSec ?? 0), 0);
  const missing = items.filter((i) => i.missing).length;
  const failed = items.filter((i) => !i.missing && i.error).length;
  const tabId = items.some((i) => i.id === focusId) ? focusId : currentId ?? items[0]?.id;
  // Keep the current item in view when the queue opens.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.pq-row.is-current');
    el?.scrollIntoView({ block: 'nearest' });
  }, []);
  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusId(id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-qid="${id}"] .pq-main`)?.focus());
  };
  const rowMenu = (it: QueueItem, i: number): MenuItem[] => [
    { label: 'Play', icon: 'play', disabled: !!it.missing, reason: 'The file is missing.', run: () => void playId(it.id) },
    { label: 'Move up', icon: 'chevronUp', shortcut: 'Alt+↑', disabled: i === 0, run: () => moveItem(it.id, i - 1) },
    { label: 'Move down', icon: 'chevronDown', shortcut: 'Alt+↓', disabled: i === items.length - 1, run: () => moveItem(it.id, i + 1) },
    { label: 'Remove from queue', icon: 'close', shortcut: 'Delete', run: () => removeItems([it.id]) },
  ];
  return (
    <div className="pq" id="player-queue">
      {menu.node}
      <div className="pq-head">
        <h2 className="pq-title">Queue</h2>
        <span className="pq-count tabular">{items.length.toLocaleString()} item{items.length === 1 ? '' : 's'}{total ? ` · ${formatClock(total)}` : ''}{missing ? ` · ${missing} missing` : ''}{failed ? ` · ${failed} cannot play` : ''}</span>
        <span className="spacer" />
        <span className="pq-hint">Alt+↑/↓ moves · Delete removes</span>
        <IconButton icon="save" label="Save queue as playlist…" onClick={() => savePlaylistDialog()} />
        <IconButton icon="eraser" label="Clear queue" onClick={() => void clear()} />
      </div>
      <ul className="pq-list" ref={listRef} aria-label="Queue">
        {items.map((it, i) => {
          const cur = it.id === currentId;
          const bad = it.missing ? 'Missing' : it.error ? 'Cannot play' : undefined;
          return (
            <li
              key={it.id}
              data-qid={it.id}
              className={`pq-row ${cur ? 'is-current' : ''} ${bad ? 'is-bad' : ''} ${drop?.id === it.id ? (drop.after ? 'drop-after' : 'drop-before') : ''}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(QUEUE_DRAG, it.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(QUEUE_DRAG)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDrop({ id: it.id, after: e.clientY > r.top + r.height / 2 });
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDrop((d) => (d?.id === it.id ? null : d));
              }}
              onDrop={(e) => {
                const id = e.dataTransfer.getData(QUEUE_DRAG);
                setDrop(null);
                if (!id) return;
                e.preventDefault();
                e.stopPropagation();
                const from = items.findIndex((x) => x.id === id);
                let to = i + (drop?.after ? 1 : 0);
                if (from < to) to--;
                if (from !== to) moveItem(id, to);
              }}
              onDragEnd={() => setDrop(null)}
              onContextMenu={(e) => {
                e.preventDefault();
                menu.open(rowMenu(it, i), e.clientX, e.clientY);
              }}
            >
              <span className="pq-grip" aria-hidden="true"><Icon name="grip" size={13} /></span>
              <button
                type="button"
                className="pq-main"
                tabIndex={it.id === tabId ? 0 : -1}
                aria-current={cur ? 'true' : undefined}
                aria-keyshortcuts="Enter Delete Alt+ArrowUp Alt+ArrowDown"
                aria-label={`${itemTitle(it)}${it.artist ? `, ${it.artist}` : ''}${it.durationSec ? `, ${formatClock(it.durationSec)}` : ''}${cur ? (playing ? ', playing' : ', current') : ''}${bad ? `, ${bad.toLowerCase()}${it.error ? `: ${it.error}` : ''}` : ''}`}
                title={it.error ?? (it.missing ? `Missing: ${it.path}` : it.path)}
                onFocus={() => setFocusId(it.id)}
                onClick={() => void playId(it.id)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    const to = e.key === 'ArrowUp' ? i - 1 : i + 1;
                    if (to >= 0 && to < items.length) {
                      moveItem(it.id, to);
                      focusRow(it.id);
                    }
                    return;
                  }
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'Home' || e.key === 'End') {
                    e.preventDefault();
                    const to = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i + (e.key === 'ArrowUp' ? -1 : 1);
                    focusRow(items[Math.max(0, Math.min(items.length - 1, to))]?.id);
                    return;
                  }
                  if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    e.stopPropagation();
                    const nextFocus = items[i + 1]?.id ?? items[i - 1]?.id;
                    removeItems([it.id]);
                    focusRow(nextFocus);
                  }
                }}
              >
                <span className="pq-index tabular" aria-hidden="true">{cur ? <Icon name={playing ? 'nowPlaying' : 'play'} size={13} /> : i + 1}</span>
                <span className="pq-text">
                  <span className="pq-name">{itemTitle(it)}</span>
                  {it.artist && <span className="pq-artist">{it.artist}</span>}
                </span>
                {bad && <span className={`pill pq-badge ${it.missing ? 'pill-warning' : 'pill-error'}`} aria-hidden="true">{bad}</span>}
                <span className="pq-dur tabular" aria-hidden="true">{formatClock(it.durationSec)}</span>
              </button>
              <button type="button" className="pq-remove" tabIndex={-1} aria-label={`Remove ${itemTitle(it)} from the queue`} title="Remove from queue" onClick={() => removeItems([it.id])}>
                <Icon name="close" size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
