import { useCallback, useEffect, useState } from 'react';
import { call } from '../api';
import { formatBytes, formatMediaDuration } from '../ui/format';
import type { VideoTimelineResult } from '../../shared/videoTimeline';

interface Props {
  filePath: string;
  /** Called when the user clicks a thumbnail to seek the video. */
  onSeek?: (timeSec: number) => void;
}

export function VideoTimeline({ filePath, onSeek }: Props) {
  const [data, setData] = useState<VideoTimelineResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const extract = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await call<VideoTimelineResult>('videoTimeline:extract', { path: filePath, count: 10, thumbHeight: 90 });
      setData(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
    setLoading(false);
  }, [filePath]);

  useEffect(() => { void extract(); }, [extract]);

  if (loading) return <div className="video-timeline"><span className="muted">Extracting timeline...</span></div>;
  if (error) return <div className="video-timeline"><span className="muted">Timeline unavailable: {error}</span></div>;
  if (!data || !data.thumbnails.length) return null;

  return (
    <div className="video-timeline">
      <div className="vt-info muted">
        <span>{formatMediaDuration(data.durationSec)}</span>
        <span>{data.codec.toUpperCase()}</span>
        <span>{data.resolution.width}x{data.resolution.height}</span>
        <span>{data.fps} fps</span>
        <span>{formatBytes(data.fileSize)}</span>
      </div>
      <div className="vt-filmstrip">
        {data.thumbnails.map((t, i) => (
          <button
            key={i}
            type="button"
            className={`vt-thumb${hoveredIdx === i ? ' vt-thumb-hover' : ''}`}
            onClick={() => onSeek?.(t.timeSec)}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
            title={formatMediaDuration(t.timeSec)}
          >
            <img src={`data:image/jpeg;base64,${t.jpegBase64}`} width={t.width} height={t.height} alt={`Frame at ${formatMediaDuration(t.timeSec)}`} draggable={false} />
            <span className="vt-time">{formatMediaDuration(t.timeSec)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
