import React, { useCallback, useEffect, useRef, useState } from 'react';
import { call } from '../api';
import type { WaveformResult } from '../../main/tools/audioWaveform';

interface Props {
  path: string;
  audioEl: HTMLAudioElement | null;
}

export function AudioWaveform({ path, audioEl }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveform, setWaveform] = useState<WaveformResult | null>(null);
  const [error, setError] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);
  const [loopStart, setLoopStart] = useState<number | null>(null);
  const [loopEnd, setLoopEnd] = useState<number | null>(null);
  const [dragging, setDragging] = useState<'seek' | 'loopStart' | 'loopEnd' | null>(null);
  const animRef = useRef(0);

  useEffect(() => {
    setWaveform(null);
    setError(false);
    setLoopStart(null);
    setLoopEnd(null);
    void call<WaveformResult>('audio:waveform', { path }).then(setWaveform, () => setError(true));
  }, [path]);

  useEffect(() => {
    if (!audioEl) return;
    const onMeta = () => setDuration(audioEl.duration);
    audioEl.addEventListener('loadedmetadata', onMeta);
    if (audioEl.duration) setDuration(audioEl.duration);
    return () => audioEl.removeEventListener('loadedmetadata', onMeta);
  }, [audioEl]);

  // Animation loop for playback cursor
  useEffect(() => {
    if (!audioEl) return;
    let running = true;
    const tick = () => {
      if (!running) return;
      setCurrentTime(audioEl.currentTime);

      // Loop playback
      if (loopStart !== null && loopEnd !== null && !audioEl.paused) {
        if (audioEl.currentTime >= loopEnd) {
          audioEl.currentTime = loopStart;
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [audioEl, loopStart, loopEnd]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const peaks = waveform.peaks;
    const totalDur = duration || waveform.duration;

    ctx.clearRect(0, 0, w, h);

    const barWidth = Math.max(1, (w / peaks.length) - 1);
    const gap = w / peaks.length;
    const playFraction = totalDur > 0 ? currentTime / totalDur : 0;

    // Get CSS variables for colors
    const style = getComputedStyle(canvas);
    const accent = style.getPropertyValue('--accent').trim() || '#6366f1';
    const dimmed = style.getPropertyValue('--text-secondary').trim() || '#94a3b8';

    // Draw loop region
    if (loopStart !== null && loopEnd !== null && totalDur > 0) {
      const x1 = (loopStart / totalDur) * w;
      const x2 = (loopEnd / totalDur) * w;
      ctx.fillStyle = accent + '18';
      ctx.fillRect(x1, 0, x2 - x1, h);
    }

    // Draw bars
    for (let i = 0; i < peaks.length; i++) {
      const x = i * gap;
      const barH = Math.max(1, peaks[i]! * (h * 0.85));
      const y = (h - barH) / 2;

      const fraction = i / peaks.length;
      ctx.fillStyle = fraction <= playFraction ? accent : dimmed;
      ctx.fillRect(x, y, barWidth, barH);
    }

    // Draw playback cursor
    if (totalDur > 0) {
      const cursorX = playFraction * w;
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, h);
      ctx.stroke();
    }

    // Draw hover line
    if (hoveredTime !== null && totalDur > 0) {
      const hoverX = (hoveredTime / totalDur) * w;
      ctx.strokeStyle = dimmed;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hoverX, 0);
      ctx.lineTo(hoverX, h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [waveform, currentTime, duration, hoveredTime, loopStart, loopEnd]);

  useEffect(() => { draw(); }, [draw]);

  // Resize observer
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  const getTimeFromEvent = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const totalDur = duration || waveform?.duration || 1;
    return (x / rect.width) * totalDur;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!audioEl) return;
    if (e.shiftKey) {
      // Start loop selection
      const t = getTimeFromEvent(e);
      setLoopStart(t);
      setLoopEnd(null);
      setDragging('loopEnd');
    } else {
      // Seek
      const t = getTimeFromEvent(e);
      audioEl.currentTime = t;
      setDragging('seek');
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const t = getTimeFromEvent(e);
    setHoveredTime(t);

    if (dragging === 'seek' && audioEl) {
      audioEl.currentTime = t;
    } else if (dragging === 'loopEnd' && loopStart !== null) {
      if (t > loopStart) setLoopEnd(t);
      else {
        setLoopEnd(loopStart);
        setLoopStart(t);
      }
    }
  };

  const handleMouseUp = () => {
    setDragging(null);
  };

  const handleMouseLeave = () => {
    setHoveredTime(null);
    setDragging(null);
  };

  const clearLoop = () => {
    setLoopStart(null);
    setLoopEnd(null);
  };

  const formatTime = (t: number) => {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  if (error) return null;
  if (!waveform) return <div className="waveform-loading">Loading waveform…</div>;

  const totalDur = duration || waveform.duration;

  return (
    <div className="audio-waveform" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      />
      <div className="waveform-info">
        <span className="waveform-time tabular">{formatTime(currentTime)} / {formatTime(totalDur)}</span>
        {hoveredTime !== null && <span className="waveform-hover-time tabular">{formatTime(hoveredTime)}</span>}
        {loopStart !== null && loopEnd !== null && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearLoop}>
            Clear loop ({formatTime(loopStart)}–{formatTime(loopEnd)})
          </button>
        )}
        <span className="waveform-hint muted">Shift+drag to select loop</span>
      </div>
    </div>
  );
}
