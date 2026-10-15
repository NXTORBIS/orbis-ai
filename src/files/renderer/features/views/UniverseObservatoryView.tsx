// @ts-nocheck -- vendored Orbis Files code, checked by its own stricter-than-Orbis toolchain
import { useState, useCallback, useEffect } from 'react';
import { Icon } from '../../ui/Icon';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

export function UniverseObservatoryView() {
  const [maps, setMaps] = useState<any[]>([]);
  const [portals, setPortals] = useState<any[]>([]);
  const [annotations, setAnnotations] = useState<any[]>([]);

  const invoke = useCallback(async (channel: string, data: any = {}) => {
    return (window as any).orbis.invoke(channel, data);
  }, []);

  useEffect(() => {
    invoke('universe:map:list').then(setMaps).catch(() => {});
    invoke('universe:portal:list').then(setPortals).catch(() => {});
    invoke('universe:annotate:list', {}).then(setAnnotations).catch(() => {});
  }, []);

  return (
    <div className="tool-view universe-observatory">
      <header className="view-header">
        <h1><Icon name="globe" /> Universe Observatory</h1>
      </header>

      <div className="observatory-dashboard">
        <div className="observatory-cards">
          <div className="observatory-card">
            <Icon name="map" />
            <div className="observatory-card-value">{maps.length}</div>
            <div className="observatory-card-label">Saved Maps</div>
          </div>
          <div className="observatory-card">
            <Icon name="bookmark" />
            <div className="observatory-card-value">{portals.length}</div>
            <div className="observatory-card-label">Portals</div>
          </div>
          <div className="observatory-card">
            <Icon name="edit" />
            <div className="observatory-card-value">{annotations.length}</div>
            <div className="observatory-card-label">Annotations</div>
          </div>
        </div>

        <section className="observatory-section">
          <h2><Icon name="map" /> Saved Maps</h2>
          {maps.length === 0 ? (
            <p className="observatory-empty-text">No saved maps yet. Scan a folder in Universe Explorer to create one.</p>
          ) : (
            <div className="observatory-map-list">
              {maps.map(m => (
                <div key={m.id} className="observatory-map-item">
                  <Icon name="map" />
                  <div className="observatory-map-info">
                    <div className="observatory-map-name">{m.name}</div>
                    <div className="observatory-map-root">{m.root}</div>
                    <div className="observatory-map-date">{new Date(m.updated_ms).toLocaleString()}</div>
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={async () => {
                    await invoke('universe:map:delete', { id: m.id });
                    setMaps(prev => prev.filter(x => x.id !== m.id));
                  }}><Icon name="trash" /></button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="observatory-section">
          <h2><Icon name="bookmark" /> Portals</h2>
          {portals.length === 0 ? (
            <p className="observatory-empty-text">No portals. Create portals in Universe Explorer to bookmark locations.</p>
          ) : (
            <div className="observatory-portal-list">
              {portals.map(p => (
                <div key={p.id} className="observatory-portal-item">
                  <Icon name="bookmark" />
                  <span className="portal-name">{p.name}</span>
                  <span className="portal-location">{p.location}</span>
                  <button className="btn btn-sm btn-danger" onClick={async () => {
                    await invoke('universe:portal:delete', { id: p.id });
                    setPortals(prev => prev.filter(x => x.id !== p.id));
                  }}><Icon name="trash" /></button>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="observatory-section">
          <h2><Icon name="edit" /> Recent Annotations</h2>
          {annotations.length === 0 ? (
            <p className="observatory-empty-text">No annotations yet.</p>
          ) : (
            <div className="observatory-annotation-list">
              {annotations.slice(0, 20).map(a => (
                <div key={a.id} className="observatory-annotation-item">
                  <div className="annotation-header">
                    <span className="annotation-file">{a.path.split('/').pop()}</span>
                    {a.color && <span className="annotation-color-dot" style={{ background: a.color }} />}
                  </div>
                  <div className="annotation-note-text">{a.note}</div>
                  <button className="btn btn-sm btn-danger" onClick={async () => {
                    await invoke('universe:annotate:delete', { id: a.id });
                    setAnnotations(prev => prev.filter(x => x.id !== a.id));
                  }}><Icon name="trash" /></button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
