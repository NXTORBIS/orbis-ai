import { useState, useEffect, useCallback, useRef } from 'react';
import { Icon } from '../../ui/Icon';

interface ChangeEvent {
  path: string;
  root: string;
  kind: string;
  timestamp: number;
}

export function ChangeObservatoryView() {
  const [watching, setWatching] = useState(false);
  const [roots, setRoots] = useState<string[]>([]);
  const [events, setEvents] = useState<ChangeEvent[]>([]);
  const [filter, setFilter] = useState('');
  const [paused, setPaused] = useState(false);
  const eventsRef = useRef(events);
  eventsRef.current = events;

  const invoke = useCallback(async (channel: string, data: any = {}) => {
    return (window as any).orbis.invoke(channel, data);
  }, []);

  useEffect(() => {
    const handler = (evt: ChangeEvent) => {
      if (paused) return;
      setEvents(prev => {
        const next = [...prev, evt];
        if (next.length > 5000) next.splice(0, next.length - 5000);
        return next;
      });
    };
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = (window as any).orbis.on('universe:observatory:event', handler);
    } catch {}
    return () => {
      try { unsubscribe?.(); } catch {}
    };
  }, [paused]);

  useEffect(() => {
    invoke('universe:observatory:status').then((s: any) => {
      if (s?.running) setWatching(true);
    }).catch(() => {});
  }, []);

  const addRoot = async () => {
    try {
      const result = await invoke('fs:pickDirectory', {});
      if (result && !roots.includes(result)) {
        setRoots(prev => [...prev, result]);
      }
    } catch {}
  };

  const startWatching = async () => {
    if (!roots.length) return;
    try {
      await invoke('universe:observatory:start', { roots });
      setWatching(true);
    } catch {}
  };

  const stopWatching = async () => {
    try {
      await invoke('universe:observatory:stop', {});
      setWatching(false);
    } catch {}
  };

  const filtered = filter
    ? events.filter(e => e.path.toLowerCase().includes(filter.toLowerCase()))
    : events;

  const kindCounts = events.reduce((acc, e) => {
    acc[e.kind] = (acc[e.kind] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="tool-view change-observatory">
      <header className="view-header">
        <h1><Icon name="activity" /> Change Observatory</h1>
        <div className="view-actions">
          {watching ? (
            <button className="btn btn-danger" onClick={stopWatching}><Icon name="stop" /> Stop</button>
          ) : (
            <button className="btn btn-primary" onClick={startWatching} disabled={!roots.length}>
              <Icon name="play" /> Start Watching
            </button>
          )}
          <button className="btn" onClick={() => setPaused(!paused)}>
            <Icon name={paused ? 'play' : 'pause'} /> {paused ? 'Resume' : 'Pause'}
          </button>
          <button className="btn" onClick={() => setEvents([])}>
            <Icon name="trash" /> Clear
          </button>
        </div>
      </header>

      {!watching && (
        <div className="observatory-setup">
          <h3>Watch Folders</h3>
          <div className="observatory-roots">
            {roots.map((r, i) => (
              <div key={i} className="observatory-root">
                <Icon name="folder" />
                <span>{r}</span>
                <button className="btn btn-sm" onClick={() => setRoots(prev => prev.filter((_, j) => j !== i))}>
                  <Icon name="x" />
                </button>
              </div>
            ))}
            <button className="btn" onClick={addRoot}><Icon name="plus" /> Add Folder</button>
          </div>
        </div>
      )}

      {watching && (
        <>
          <div className="observatory-stats">
            <span className="observatory-live"><span className="live-dot" /> Live</span>
            <span>Events: {events.length}</span>
            {Object.entries(kindCounts).map(([k, v]) => (
              <span key={k} className={`observatory-kind observatory-kind-${k}`}>{k}: {v}</span>
            ))}
          </div>

          <div className="observatory-filter">
            <input
              type="text"
              placeholder="Filter by path..."
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>

          <div className="observatory-events scroll-y">
            {filtered.slice(-200).reverse().map((e, i) => (
              <div key={i} className={`observatory-event observatory-event-${e.kind}`}>
                <span className="event-time">{new Date(e.timestamp).toLocaleTimeString()}</span>
                <span className={`event-kind event-kind-${e.kind}`}>{e.kind}</span>
                <span className="event-path" title={e.path}>{e.path}</span>
              </div>
            ))}
            {!filtered.length && <div className="observatory-empty">No events yet. Waiting for filesystem changes...</div>}
          </div>
        </>
      )}
    </div>
  );
}
