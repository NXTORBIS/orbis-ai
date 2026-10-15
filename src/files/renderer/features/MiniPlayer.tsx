import React from 'react';
import { useStore } from '../state/store';
import { player, currentItem, togglePlay, next, previous, toggleQueue } from '../state/player';
import { itemTitle, formatClock } from '../../shared/player';
import { Icon } from '../ui/Icon';

/**
 * A compact music player strip for the status bar area.
 * Shows cover art, title, time and basic transport controls.
 */
export function MiniPlayer(): React.ReactElement | null {
  const { state, playing, time, duration, hidden, cover } = useStore(player, (s) => ({
    state: s.state,
    playing: s.playing,
    time: s.time,
    duration: s.duration,
    hidden: s.hidden,
    cover: s.cover,
  }));

  if (hidden || !state.items.length) return null;

  const it = currentItem(state);
  if (!it) return null;

  const title = itemTitle(it);
  const artist = it.artist ?? '';
  const label = artist ? `${title} — ${artist}` : title;

  return (
    <div
      className="mini-player"
      onClick={() => toggleQueue(true)}
      role="button"
      tabIndex={0}
      title={`${label} (${formatClock(time)} / ${formatClock(duration)})`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleQueue(true); } }}
    >
      {cover && <img className="mini-player-art" src={cover} alt="" />}
      <span className="mini-player-title">{label}</span>
      <span>{formatClock(time)}</span>
      <div className="mini-player-controls" onClick={(e) => e.stopPropagation()}>
        <button className="mini-player-btn" onClick={() => void previous()} title="Previous" aria-label="Previous track">
          <Icon name="skipBack" size={12} />
        </button>
        <button className="mini-player-btn" onClick={() => void togglePlay()} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
          <Icon name={playing ? 'pause' : 'play'} size={12} />
        </button>
        <button className="mini-player-btn" onClick={() => void next()} title="Next" aria-label="Next track">
          <Icon name="skipForward" size={12} />
        </button>
      </div>
    </div>
  );
}
