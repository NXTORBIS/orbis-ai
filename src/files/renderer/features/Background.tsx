import React, { useEffect, useState } from 'react';
import { call } from '../api';
import { useCustom } from '../state/custom';
import type { Appearance } from '../../shared/customization/schema';

/**
 * Background for the Home view or the whole file area (Customization →
 * Appearance → Background). Only a local image path that the main process has
 * validated is ever shown; remote URLs are not accepted by the schema at all.
 * Each image is checked once per session and then reused, and the layer is a
 * single static element (no per-row effects), so scrolling large folders is
 * unaffected. A missing or unreadable image falls back to a plain surface.
 */

type Check = { ok: true; display: string } | { ok: false; reason: string; missing?: boolean };
const checked = new Map<string, Promise<Check>>();

export function checkBackground(path: string, fresh = false): Promise<Check> {
  if (fresh) checked.delete(path);
  let p = checked.get(path);
  if (!p) {
    p = call<{ ok: boolean; display?: string; path?: string; reason?: string; missing?: boolean }>('custom:checkBackground', { path }).then(
      (r) => (r.ok ? { ok: true as const, display: r.display ?? r.path! } : { ok: false as const, reason: r.reason ?? 'The image cannot be used.', missing: r.missing }),
      () => ({ ok: false as const, reason: 'The image could not be checked.' }),
    );
    checked.set(path, p);
  }
  return p;
}

const mediaUrl = (p: string) => `orbis-media://f/${encodeURIComponent(p)}`;

export function useBackgroundImage(bg: Appearance['background']): Check | null {
  const [state, setState] = useState<Check | null>(null);
  useEffect(() => {
    let live = true;
    setState(null);
    if (bg.kind === 'image' && bg.imagePath) void checkBackground(bg.imagePath).then((c) => live && setState(c));
    return () => {
      live = false;
    };
  }, [bg.kind, bg.imagePath]);
  return state;
}

/** True when a background is configured for this surface. */
export function useHasBackground(where: 'home' | 'workspace'): boolean {
  return useCustom((r) => r.appearance.background.kind !== 'none' && (r.appearance.background.scope === 'workspace' || where === 'home'));
}

export function BackgroundLayer({ where }: { where: 'home' | 'workspace' }) {
  const bg = useCustom((r) => r.appearance.background);
  const image = useBackgroundImage(bg);
  if (bg.kind === 'none' || (bg.scope === 'home' && where === 'workspace') || (bg.scope === 'workspace' && where === 'home')) return null;
  let base: React.CSSProperties = {};
  if (bg.kind === 'solid') base = { background: bg.color };
  else if (bg.kind === 'gradient') base = { background: `linear-gradient(${bg.gradient.angle}deg, ${bg.gradient.from}, ${bg.gradient.to})` };
  else if (bg.kind === 'image' && image?.ok) {
    base = {
      backgroundImage: `url("${mediaUrl(image.display)}")`,
      backgroundSize: bg.fit === 'tile' ? 'auto' : bg.fit === 'center' ? 'auto' : bg.fit,
      backgroundRepeat: bg.fit === 'tile' ? 'repeat' : 'no-repeat',
      backgroundPosition: bg.position,
    };
  }
  return (
    <div className="bg-layer" aria-hidden data-bg-kind={bg.kind} data-bg-state={bg.kind === 'image' ? (image ? (image.ok ? 'ok' : 'unavailable') : 'checking') : 'ok'}>
      <div className="bg-image" style={base} />
      {bg.dim > 0 && <div className="bg-dim" style={{ opacity: bg.dim }} />}
      {bg.overlayOpacity > 0 && <div className="bg-overlay" style={{ opacity: bg.overlayOpacity }} />}
      {bg.texture !== 'none' && <div className={`bg-texture ${bg.texture}`} style={{ opacity: bg.textureOpacity }} />}
    </div>
  );
}
