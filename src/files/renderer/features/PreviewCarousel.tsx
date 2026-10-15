import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/components';
import type { CarouselItem, CarouselFit } from '../../shared/carousel';
import { DEFAULT_SLIDESHOW_INTERVAL_MS, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../../shared/carousel';
import { call } from '../api';

interface Props {
  items: CarouselItem[];
  initialIndex?: number;
  onClose?: () => void;
}

export function PreviewCarousel({ items, initialIndex = 0, onClose }: Props) {
  const [index, setIndex] = useState(Math.min(initialIndex, items.length - 1));
  const [fit, setFit] = useState<CarouselFit>('contain');
  const [zoom, setZoom] = useState(1);
  const [slideshowActive, setSlideshowActive] = useState(false);
  const [slideshowInterval, _setSlideshowInterval] = useState(DEFAULT_SLIDESHOW_INTERVAL_MS);
  const timerRef = useRef<ReturnType<typeof setInterval>>();
  const containerRef = useRef<HTMLDivElement>(null);

  const current = items[index];

  const goTo = useCallback((i: number) => {
    const n = items.length;
    setIndex(((i % n) + n) % n);
    setZoom(1);
  }, [items.length]);

  const prev = useCallback(() => goTo(index - 1), [goTo, index]);
  const next = useCallback(() => goTo(index + 1), [goTo, index]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'Escape') { e.preventDefault(); if (slideshowActive) setSlideshowActive(false); else onClose?.(); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM)); }
      else if (e.key === '-') { e.preventDefault(); setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM)); }
      else if (e.key === '0') { e.preventDefault(); setZoom(1); setFit('contain'); }
      else if (e.key === ' ') { e.preventDefault(); setSlideshowActive((a) => !a); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [prev, next, onClose, slideshowActive]);

  // Slideshow timer
  useEffect(() => {
    if (slideshowActive && items.length > 1) {
      timerRef.current = setInterval(() => {
        setIndex((i) => (i + 1) % items.length);
        setZoom(1);
      }, slideshowInterval);
      return () => clearInterval(timerRef.current);
    }
    clearInterval(timerRef.current);
  }, [slideshowActive, slideshowInterval, items.length]);

  // Fullscreen for slideshow
  useEffect(() => {
    if (slideshowActive) {
      void call('win:setFullScreen', { on: true });
    }
    return () => {
      if (slideshowActive) void call('win:setFullScreen', { on: false });
    };
  }, [slideshowActive]);

  const cycleFit = () => {
    const modes: CarouselFit[] = ['contain', 'cover', 'actual'];
    const nextMode = modes[(modes.indexOf(fit) + 1) % modes.length];
    setFit(nextMode ?? 'contain');
    setZoom(1);
  };

  const zoomIn = () => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM));
  const zoomOut = () => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM));

  if (!current) return null;

  const imgStyle: React.CSSProperties = fit === 'actual'
    ? { width: 'auto', height: 'auto', maxWidth: 'none', maxHeight: 'none', transform: `scale(${zoom})`, transformOrigin: 'center center' }
    : fit === 'cover'
    ? { width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})`, transformOrigin: 'center center' }
    : { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transform: `scale(${zoom})`, transformOrigin: 'center center' };

  return (
    <div className="carousel" ref={containerRef}>
      <div className="carousel-toolbar">
        <span className="carousel-counter">{index + 1} / {items.length}</span>
        <span className="carousel-name">{current.name}</span>
        <div className="carousel-controls">
          <IconButton icon="zoomOut" label="Zoom out" onClick={zoomOut} />
          <span className="carousel-zoom-label">{Math.round(zoom * 100)}%</span>
          <IconButton icon="zoomIn" label="Zoom in" onClick={zoomIn} />
          <IconButton icon="expand" label={`Fit: ${fit}`} onClick={cycleFit} />
          <IconButton
            icon={slideshowActive ? 'pause' : 'play'}
            label={slideshowActive ? 'Stop slideshow' : 'Start slideshow'}
            onClick={() => setSlideshowActive((a) => !a)}
          />
          {onClose && <IconButton icon="close" label="Close" onClick={onClose} />}
        </div>
      </div>

      <div className="carousel-stage" onClick={(e) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const x = e.clientX - rect.left;
        if (x < rect.width / 3) prev();
        else if (x > (rect.width * 2) / 3) next();
      }}>
        {items.length > 1 && (
          <button type="button" className="carousel-arrow carousel-arrow-left" onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous">
            <Icon name="chevronLeft" size={28} />
          </button>
        )}
        <div className="carousel-image-wrap">
          <img
            key={current.path}
            src={`orbis-file://${current.path}`}
            alt={current.name}
            style={imgStyle}
            draggable={false}
          />
        </div>
        {items.length > 1 && (
          <button type="button" className="carousel-arrow carousel-arrow-right" onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next">
            <Icon name="chevronRight" size={28} />
          </button>
        )}
      </div>

      {items.length > 1 && (
        <div className="carousel-thumbstrip">
          {items.map((item, i) => (
            <button
              key={item.path}
              type="button"
              className={`carousel-thumb ${i === index ? 'is-active' : ''}`}
              onClick={() => goTo(i)}
              aria-label={item.name}
              title={item.name}
            >
              <img src={`orbis-file://${item.path}`} alt="" draggable={false} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
