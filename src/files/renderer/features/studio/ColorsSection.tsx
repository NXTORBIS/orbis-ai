import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { applyCustom, custom, liveDraft } from '../../state/custom';
import { Button } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { COLOR_TOKENS, TOKEN_CATEGORY_LABEL, type ColorTokenDef, type ColorTokenId, type ThemeMode } from '../../../shared/customization/tokens';
import { checkTokenEdit, findPreset, getAt, resolveCustomization, type LayerName } from '../../../shared/customization/resolve';
import { contrastRatio, parseColor, parseRgba, rgbToHsl, toHex } from '../../../shared/customization/color';
import { SourceBadge } from './controls';
import { studio } from './studioState';

/**
 * Colour editor. Every customizable token, per mode, with a picker, hex, RGB
 * and HSL input, alpha where the token is translucent, a contrast check
 * against the colours it is read on, and resets to the inherited or preset
 * value. A colour that would make text unreadable is refused with an
 * explanation and a readable alternative.
 */
export function ColorsSection() {
  const st = useStore(custom, (s) => ({ config: s.preview ?? s.server.config, host: s.server.hostTokens, system: s.system }));
  const current = useStore(custom, (s) => s.resolved.mode);
  const [mode, setMode] = useState<ThemeMode>(current);
  const [filter, setFilter] = useState('');
  // Effective tokens for the mode being edited (the other mode is resolved on demand).
  const resolved = useMemo(() => resolveCustomization({ ...st.config, appearance: { ...st.config.appearance, mode } }, { systemDark: mode === 'dark', hostTokens: st.host }), [st.config, mode, st.host]);
  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = COLOR_TOKENS.filter((t) => !f || `${t.label} ${t.description} ${t.keywords?.join(' ') ?? ''} ${t.cssVar}`.toLowerCase().includes(f));
    const out = new Map<string, ColorTokenDef[]>();
    for (const t of list) out.set(t.category, [...(out.get(t.category) ?? []), t]);
    return [...out.entries()];
  }, [filter]);
  return (
    <div className="studio-sections">
      <section className="studio-card" id="setting-colorMode">
        <div className="studio-row">
          <div className="studio-row-text">
            <div className="studio-row-label"><span id="label-colorMode">Edit the colours of</span></div>
            <p className="studio-row-desc">Dark and light each have their own colours. {current !== mode ? 'You are editing the mode that is not shown right now.' : 'Changes appear immediately.'}</p>
          </div>
          <div className="studio-row-control">
            <div className="segmented" role="radiogroup" aria-labelledby="label-colorMode">
              {(['dark', 'light'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'dark' ? 'Dark' : 'Light'}</button>)}
            </div>
            <span className="searchbox small-search" id="setting-tokens">
              <Icon name="search" size={13} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter colours" aria-label="Filter colours" />
            </span>
          </div>
        </div>
        <p className="muted small" id="setting-contrast">Status, focus and file-type colours can be changed here but never by a theme supplied from outside Orbis Files. Contrast is checked against WCAG ratios (4.5:1 for text, 3:1 for icons and outlines).</p>
      </section>
      {groups.map(([cat, tokens]) => (
        <section key={cat} className="studio-card">
          <h2>{TOKEN_CATEGORY_LABEL[cat as keyof typeof TOKEN_CATEGORY_LABEL]}</h2>
          <div className="token-list">
            {tokens.map((t) => <TokenRow key={`${mode}-${t.id}`} token={t} mode={mode} value={resolved.tokens[t.id]} tokens={resolved.tokens} source={(resolved.sources[`tokens.${t.id}`] ?? 'default') as LayerName} />)}
          </div>
        </section>
      ))}
      {!groups.length && <p className="muted">No colour matches “{filter}”.</p>}
    </div>
  );
}

function TokenRow({ token, mode, value, tokens, source }: { token: ColorTokenDef; mode: ThemeMode; value: string; tokens: Record<ColorTokenId, string>; source: LayerName }) {
  const [text, setText] = useState(value);
  const [error, setError] = useState<{ reason: string; suggestion?: string } | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setText(value);
    setError(null);
  }, [value]);
  const rgba = parseRgba(value) ?? { r: 0, g: 0, b: 0, a: 1 };
  const hsl = rgbToHsl(rgba);
  const config = useStore(custom, (s) => s.server.config);
  const preset = findPreset(config, config.activePresetId);
  const ws = config.workspaces.find((w) => w.id === config.activeWorkspaceId);
  const has = {
    baseline: getAt(config.appearance.colors, [mode, token.id]) !== undefined,
    workspace: getAt(ws?.overrides.appearance?.colors, [mode, token.id]) !== undefined,
    preset: !!preset && !('builtIn' in preset && preset.builtIn) && getAt(preset.appearance?.colors, [mode, token.id]) !== undefined,
  };

  const attempt = (raw: string, live = false) => {
    const c = parseColor(raw);
    if (!c) {
      setError({ reason: `“${raw.slice(0, 40)}” is not a colour. Use #rrggbb, rgb(r, g, b) or hsl(h, s%, l%).` });
      return;
    }
    const chk = checkTokenEdit(tokens, token.id, c);
    if (!chk.ok) {
      setError({ reason: chk.reason ?? 'That colour cannot be used.', suggestion: chk.suggestion });
      return;
    }
    setError(null);
    const op = { op: 'setColor' as const, target: studio.get().target, mode, token: token.id, value: c };
    if (live) liveDraft(op);
    else void applyCustom(op, { quiet: true });
  };
  const fromParts = (r: number, g: number, b: number, a = rgba.a) => attempt(toHex({ r, g, b, a }), true);
  const fromHsl = (h: number, s: number, l: number) => attempt(`hsl(${h}, ${s}%, ${l}%)`, true);

  const ratio = token.contrast ? Math.min(...token.contrast.against.map((bg) => contrastRatio(value, tokens[bg]))) : undefined;
  const pass = ratio === undefined || ratio >= token.contrast!.min;

  return (
    <div className={`token-row ${error ? 'has-error' : ''}`} id={`token-${token.id}`}>
      <span className="token-swatch" style={{ background: value }} aria-hidden />
      <div className="token-text">
        <div className="token-label">
          <strong id={`tok-${token.id}`}>{token.label}</strong>
          <code className="muted small">{token.cssVar}</code>
          {source !== 'default' && <SourceBadge source={source} />}
        </div>
        <p className="muted small">{token.description}</p>
        {ratio !== undefined && (
          <p className={`small ${pass ? 'success-text' : 'warning-text'}`}>
            <Icon name={pass ? 'success' : 'warning'} size={12} /> Contrast {ratio.toFixed(2)}:1 against {token.contrast!.against.map((x) => COLOR_TOKENS.find((t) => t.id === x)?.label.toLowerCase()).join(', ')} (needs {token.contrast!.min}:1){pass ? '' : ' — adjusted automatically while shown'}
          </p>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error.reason}{' '}
            {error.suggestion && <button type="button" className="link-btn" onClick={() => attempt(error.suggestion!)}>Use {error.suggestion} instead</button>}
          </p>
        )}
        {open && (
          <div className="token-advanced">
            <fieldset>
              <legend>RGB</legend>
              {(['r', 'g', 'b'] as const).map((k) => (
                <label key={k}>{k.toUpperCase()} <input type="number" className="input narrow" min={0} max={255} value={rgba[k]} onChange={(e) => fromParts(k === 'r' ? +e.target.value : rgba.r, k === 'g' ? +e.target.value : rgba.g, k === 'b' ? +e.target.value : rgba.b)} /></label>
              ))}
            </fieldset>
            <fieldset>
              <legend>HSL</legend>
              <label>H <input type="number" className="input narrow" min={0} max={360} value={Math.round(hsl.h)} onChange={(e) => fromHsl(+e.target.value, Math.round(hsl.s), Math.round(hsl.l))} /></label>
              <label>S <input type="number" className="input narrow" min={0} max={100} value={Math.round(hsl.s)} onChange={(e) => fromHsl(Math.round(hsl.h), +e.target.value, Math.round(hsl.l))} /></label>
              <label>L <input type="number" className="input narrow" min={0} max={100} value={Math.round(hsl.l)} onChange={(e) => fromHsl(Math.round(hsl.h), Math.round(hsl.s), +e.target.value)} /></label>
            </fieldset>
            {token.alpha && (
              <label className="slider">Opacity <input type="range" min={0} max={1} step={0.01} value={rgba.a} aria-label={`${token.label} opacity`} onChange={(e) => fromParts(rgba.r, rgba.g, rgba.b, Number(e.target.value))} /><output>{Math.round(rgba.a * 100)}%</output></label>
            )}
          </div>
        )}
      </div>
      <div className="token-controls">
        <input type="color" aria-label={`${token.label} colour picker`} value={value.slice(0, 7)} onChange={(e) => attempt(token.alpha ? toHex({ ...parseRgba(e.target.value)!, a: rgba.a }) : e.target.value, true)} />
        <input className={`input mono hex-input ${error ? 'is-invalid' : ''}`} aria-label={`${token.label} value`} aria-invalid={!!error} value={text} spellCheck={false}
          onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && attempt(text)} onKeyDown={(e) => {
            if (e.key === 'Enter') attempt(text);
            if (e.key === 'Escape') {
              setText(value);
              setError(null);
            }
          }} />
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Less' : 'RGB/HSL'}</Button>
        {(has.workspace || has.baseline || has.preset) && (
          <Button size="sm" variant="ghost" title="Remove the most specific override so the inherited colour shows" onClick={() => void applyCustom({ op: 'resetColor', target: has.workspace ? 'workspace' : has.preset ? 'preset' : 'baseline', mode, token: token.id }, { quiet: true })}>Reset to inherited</Button>
        )}
        {preset && (has.workspace || has.baseline) && (
          <Button size="sm" variant="ghost" title={`Remove your overrides so ${preset.name}’s colour (or the default) shows`} onClick={async () => {
            if (has.workspace) await applyCustom({ op: 'resetColor', target: 'workspace', mode, token: token.id }, { quiet: true });
            if (has.baseline) await applyCustom({ op: 'resetColor', target: 'baseline', mode, token: token.id }, { quiet: true });
          }}>Reset to preset</Button>
        )}
      </div>
    </div>
  );
}
