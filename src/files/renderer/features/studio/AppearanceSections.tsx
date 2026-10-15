import { useEffect, useState } from 'react';
import { call } from '../../api';
import { useStore } from '../../state/store';
import { custom, useCustom } from '../../state/custom';
import { Button, Pill, ProgressBar } from '../../ui/components';
import { Icon } from '../../ui/Icon';
import { Choice, SelectValue, SettingRow, setValue, Slider, Switch, useValue, type SectionPath } from './controls';
import { checkBackground } from '../Background';
import type { Appearance } from '../../../shared/customization/schema';

const A = (...path: string[]): SectionPath => ({ section: 'appearance', path });
const X = (...path: string[]): SectionPath => ({ section: 'accessibility', path });
const pct = (v: number) => `${Math.round(v * 100)}%`;
const px = (v: number) => `${v}px`;
const times = (v: number) => `${v.toFixed(2)}×`;

/** A sample of real interface components in their states, drawn with the current tokens. */
export function ThemeSample() {
  return (
    <div className="theme-sample" id="setting-themeSample" aria-label="Sample of interface states">
      <div className="theme-sample-bar">
        <span className="icon-btn" aria-hidden><Icon name="back" size={16} /></span>
        <span className="icon-btn is-active" aria-hidden><Icon name="split" size={16} /></span>
        <span className="sample-address">Documents › Projects</span>
        <button type="button" className="btn btn-primary btn-sm" tabIndex={-1}>Primary</button>
        <button type="button" className="btn btn-default btn-sm" tabIndex={-1}>Default</button>
        <button type="button" className="btn btn-danger btn-sm" tabIndex={-1}>Delete</button>
      </div>
      <div className="theme-sample-rows">
        <div className="sample-row">Row</div>
        <div className="sample-row hover">Hovered row</div>
        <div className="sample-row is-selected">Selected row</div>
        <div className="sample-row is-selected focus">Selected row in the focused list</div>
        <div className="sample-row disabled" aria-disabled="true">Disabled text</div>
      </div>
      <div className="theme-sample-status">
        <Pill tone="success">Done</Pill>
        <Pill tone="warning">Needs attention</Pill>
        <Pill tone="error">Failed</Pill>
        <Pill tone="accent">Running</Pill>
        <span className="sample-progress"><ProgressBar value={0.62} label="Sample progress" /></span>
        <span className="sample-tooltip">Tooltip</span>
        <span className="sample-focus" tabIndex={-1}>Focus ring</span>
      </div>
    </div>
  );
}

const AMBIENT_SWATCH: Record<'aurora' | 'nebula' | 'ember', [string, string, string]> = {
  aurora: ['--accent', '--accent-2', '--hue-image'],
  nebula: ['--accent', '--accent-2', '--hue-video'],
  ember: ['--hue-audio', '--hue-exe', '--hue-video'],
};

/** A small live picture of an ambient light choice, drawn with the current colour tokens. */
function AmbientSwatch({ kind }: { kind: 'aurora' | 'nebula' | 'ember' | 'none' }) {
  const vars = kind === 'none' ? ['transparent', 'transparent', 'transparent'] : AMBIENT_SWATCH[kind].map((v) => `color-mix(in srgb, var(${v}) 55%, transparent)`);
  return (
    <span className="ambient-swatch" aria-hidden style={{ ['--sw1' as string]: vars[0], ['--sw2' as string]: vars[1], ['--sw3' as string]: vars[2], ['--sw-glass' as string]: 'var(--glass-sidebar, var(--bg-sidebar))' }}>
      <i /><i /><i /><span />
    </span>
  );
}

/** Material, glow and ambient light (design system 2). */
function GlassEditor() {
  const material = useValue<Appearance['material']>(A('material'));
  const ambient = useValue<Appearance['ambient']>(A('ambient'));
  const effective = useCustom((r) => ({ material: r.material, ambient: r.ambient, motion: r.ambientMotion, reduced: r.reducedMotion }));
  const raised = useCustom((r) => r.adjustments.filter((a) => a.path.startsWith('appearance.glassOpacity')));
  const forced = useCustom((r) => r.adjustments.find((a) => a.path === 'appearance.material'));
  return (
    <section className="studio-card">
      <h2>Glass and light</h2>
      <SettingRow id="material" label="Material" description="Glass: the title bar, sidebar, toolbars, details panel, menus and dialogs are translucent layers over the ambient light; file lists and previews stay on opaque surfaces. Solid: every surface is opaque." path={A('material')}>
        <Choice id="material" path={A('material')} options={[{ value: 'glass', label: 'Glass' }, { value: 'solid', label: 'Solid' }]} />
      </SettingRow>
      {forced && <p className="callout" role="status"><Icon name="shield" size={14} /> {forced.reason} Your choice is kept and returns when the safeguard no longer applies.</p>}
      {material === 'glass' && (
        <SettingRow id="glassOpacity" label="Glass opacity" description={raised.length ? `Raised to ${raised.map((a) => `${Math.round(Number(a.to) * 100)}%`).join(' / ')} where needed so text stays readable over the ambient light.` : 'How much of the ambient light shows through panels. It is raised automatically wherever text would become hard to read.'} path={A('glassOpacity')}>
          <Slider id="glassOpacity" path={A('glassOpacity')} min={0.55} max={1} step={0.01} format={pct} label="Glass opacity" />
        </SettingRow>
      )}
      <SettingRow id="glow" label="Accent glow" description="A soft light around focus, selection, active items, progress and primary buttons. Off with high contrast and reduced effects." path={A('glow')}>
        <Slider id="glow" path={A('glow')} min={0} max={1} step={0.05} format={pct} label="Accent glow" />
      </SettingRow>
      <SettingRow id="ambient" label="Ambient light" description="Soft colour behind the panels, mixed from your accent and file-type colours. Decorative only; never behind text without a contrast check." path={A('ambient')}>
        <span className="ambient-choice"><AmbientSwatch kind={ambient} /><Choice id="ambient" path={A('ambient')} options={[{ value: 'aurora', label: 'Aurora' }, { value: 'nebula', label: 'Nebula' }, { value: 'ember', label: 'Ember' }, { value: 'none', label: 'None' }]} /></span>
      </SettingRow>
      {ambient !== 'none' && (
        <>
          <SettingRow id="ambientIntensity" label="Ambient light strength" path={A('ambientIntensity')}><Slider id="ambientIntensity" path={A('ambientIntensity')} min={0} max={1} step={0.05} format={pct} label="Ambient light strength" /></SettingRow>
          <SettingRow id="ambientMotion" label="Drifting light" description={effective.reduced ? 'The light stays still while reduced motion is on.' : 'The light drifts very slowly, and rests while the window is in the background.'} path={A('ambientMotion')}><Switch id="ambientMotion" path={A('ambientMotion')} /></SettingRow>
        </>
      )}
      {ambient !== 'none' && effective.ambient === 'none' && <p className="muted small">Ambient light is off while high contrast or reduced effects is on.</p>}
    </section>
  );
}

export function AppearanceSection() {
  return (
    <div className="studio-sections">
      <section className="studio-card">
        <h2>Mode</h2>
        <SettingRow id="mode" label="Theme mode" description="“Follow system” uses the dark or light preference your operating system reports, and changes with it." path={A('mode')}>
          <Choice id="mode" path={A('mode')} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'Follow system' }]} />
        </SettingRow>
        <ThemeSample />
      </section>
      <GlassEditor />
      <section className="studio-card">
        <h2>Shape and depth</h2>
        <SettingRow id="radius" label="Corner radius" path={A('radius')}><Slider id="radius" path={A('radius')} min={0} max={14} step={1} format={px} label="Corner radius" /></SettingRow>
        <SettingRow id="surfaceSeparation" label="Surface separation" description="How different panels, toolbars and dialogs are from the file area." path={A('surfaceSeparation')}><Slider id="surfaceSeparation" path={A('surfaceSeparation')} min={0} max={2} step={0.05} format={times} label="Surface separation" /></SettingRow>
        <SettingRow id="borderIntensity" label="Border intensity" path={A('borderIntensity')}><Slider id="borderIntensity" path={A('borderIntensity')} min={0} max={2} step={0.05} format={times} label="Border intensity" /></SettingRow>
        <SettingRow id="shadowIntensity" label="Shadow intensity" path={A('shadowIntensity')}><Slider id="shadowIntensity" path={A('shadowIntensity')} min={0} max={2} step={0.05} format={times} label="Shadow intensity" /></SettingRow>
      </section>
      <section className="studio-card">
        <h2>Motion and effects</h2>
        <SettingRow id="motion" label="Animation intensity" description="“System” follows the operating system’s reduced-motion preference." path={A('motion')}>
          <Choice id="motion" path={A('motion')} options={[{ value: 'system', label: 'System' }, { value: 'none', label: 'None' }, { value: 'reduced', label: 'Reduced' }, { value: 'normal', label: 'Normal' }, { value: 'expressive', label: 'Expressive' }]} />
        </SettingRow>
        <SettingRow id="durationScale" label="Transition duration" path={A('durationScale')}><Slider id="durationScale" path={A('durationScale')} min={0.5} max={2} step={0.05} format={times} label="Transition duration" /></SettingRow>
        <SettingRow id="transparency" label="Panel transparency over a background" description="How much a workspace background (below) shows through the file panes (at most 50%, so text stays readable). Applies only when a background is shown behind the whole file area." path={A('transparency')}><Slider id="transparency" path={A('transparency')} min={0} max={0.5} step={0.05} format={pct} label="Panel transparency over a background" /></SettingRow>
        <SettingRow id="blur" label="Background blur" description="Blurs a workspace background behind the file panes. Applies only when a background is shown behind the whole file area." path={A('blur')}><Slider id="blur" path={A('blur')} min={0} max={24} step={1} format={px} label="Background blur" /></SettingRow>
        <SettingRow id="reducedEffects" label="Reduced effects" description="Turns off blur, translucency, shadows and non-essential animation — for less capable hardware or longer battery life. Never applied per file row." path={A('reducedEffects')}><Switch id="reducedEffects" path={A('reducedEffects')} /></SettingRow>
      </section>
      <BackgroundEditor />
    </div>
  );
}

function BackgroundEditor() {
  const bg = useValue<Appearance['background']>(A('background'));
  const [check, setCheck] = useState<{ ok: boolean; reason?: string } | null>(null);
  useEffect(() => {
    if (bg.kind !== 'image' || !bg.imagePath) {
      setCheck(null);
      return;
    }
    void checkBackground(bg.imagePath).then((c) => setCheck(c.ok ? { ok: true } : { ok: false, reason: c.reason }));
  }, [bg.kind, bg.imagePath]);
  const set = (path: string[], v: unknown, live = false) => setValue(A('background', ...path), v, { live, label: 'Background' });
  return (
    <section className="studio-card">
      <h2>Background</h2>
      <SettingRow id="background" label="Background" description="Shown behind Home, or behind the whole file area. Only images on this computer are used; nothing is downloaded." path={A('background', 'kind')}>
        <Choice id="background" path={A('background', 'kind')} options={[{ value: 'none', label: 'None' }, { value: 'solid', label: 'Colour' }, { value: 'gradient', label: 'Gradient' }, { value: 'image', label: 'Image' }]} />
      </SettingRow>
      {bg.kind !== 'none' && (
        <>
          <SettingRow id="bgScope" label="Show it on" path={A('background', 'scope')}>
            <Choice id="bgScope" path={A('background', 'scope')} options={[{ value: 'home', label: 'Home only' }, { value: 'workspace', label: 'The whole file area' }]} />
          </SettingRow>
          {bg.kind === 'solid' && (
            <SettingRow id="bgColor" label="Colour" path={A('background', 'color')}>
              <input type="color" aria-labelledby="label-bgColor" value={bg.color.slice(0, 7)} onChange={(e) => set(['color'], e.target.value, true)} />
              <span className="mono small">{bg.color}</span>
            </SettingRow>
          )}
          {bg.kind === 'gradient' && (
            <SettingRow id="bgGradient" label="Gradient" path={A('background', 'gradient', 'from')}>
              <input type="color" aria-label="Gradient start colour" value={bg.gradient.from.slice(0, 7)} onChange={(e) => set(['gradient', 'from'], e.target.value, true)} />
              <input type="color" aria-label="Gradient end colour" value={bg.gradient.to.slice(0, 7)} onChange={(e) => set(['gradient', 'to'], e.target.value, true)} />
              <span className="slider"><input type="range" min={0} max={360} step={5} value={bg.gradient.angle} aria-label="Gradient angle" onChange={(e) => set(['gradient', 'angle'], Number(e.target.value), true)} /><output>{bg.gradient.angle}°</output></span>
            </SettingRow>
          )}
          {bg.kind === 'image' && (
            <>
              <SettingRow id="bgImage" label="Image" description={bg.imagePath ? <span className="mono break">{bg.imagePath}</span> : 'No image chosen yet.'} path={A('background', 'imagePath')}>
                <Button size="sm" icon="imagePlus" onClick={async () => {
                  const r = await call<{ path: string; check: { ok: boolean; reason?: string } } | null>('custom:pickBackground');
                  if (!r) return;
                  if (!r.check.ok) {
                    setCheck({ ok: false, reason: r.check.reason });
                    return;
                  }
                  await checkBackground(r.path, true);
                  set(['imagePath'], r.path);
                }}>Choose image…</Button>
                {bg.imagePath && <Button size="sm" variant="ghost" onClick={() => void checkBackground(bg.imagePath, true).then((c) => setCheck(c.ok ? { ok: true } : { ok: false, reason: c.reason }))}>Check again</Button>}
              </SettingRow>
              {check && !check.ok && <div className="callout warning" role="alert"><Icon name="warning" size={14} /><span>{check.reason} The interface shows a plain background meanwhile.</span></div>}
              <SettingRow id="bgFit" label="Scaling" path={A('background', 'fit')}>
                <Choice id="bgFit" path={A('background', 'fit')} options={[{ value: 'cover', label: 'Fill' }, { value: 'contain', label: 'Fit' }, { value: 'center', label: 'Centre' }, { value: 'tile', label: 'Tile' }]} />
              </SettingRow>
              <SettingRow id="bgPosition" label="Position" path={A('background', 'position')}>
                <SelectValue id="bgPosition" path={A('background', 'position')} options={[{ value: 'center', label: 'Centre' }, { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} />
              </SettingRow>
            </>
          )}
          <SettingRow id="bgTexture" label="Texture" path={A('background', 'texture')}>
            <Choice id="bgTexture" path={A('background', 'texture')} options={[{ value: 'none', label: 'None' }, { value: 'grain', label: 'Grain' }, { value: 'grid', label: 'Grid' }, { value: 'dots', label: 'Dots' }]} />
          </SettingRow>
          {bg.texture !== 'none' && <SettingRow id="bgTextureOpacity" label="Texture strength" path={A('background', 'textureOpacity')}><Slider id="bgTextureOpacity" path={A('background', 'textureOpacity')} min={0} max={0.5} step={0.01} format={pct} label="Texture strength" /></SettingRow>}
          <SettingRow id="bgOverlay" label="Overlay" description="A layer of the surface colour over the background, keeping text readable." path={A('background', 'overlayOpacity')}><Slider id="bgOverlay" path={A('background', 'overlayOpacity')} min={0} max={0.9} step={0.05} format={pct} label="Overlay" /></SettingRow>
          <SettingRow id="bgDim" label="Dimming" path={A('background', 'dim')}><Slider id="bgDim" path={A('background', 'dim')} min={0} max={0.9} step={0.05} format={pct} label="Dimming" /></SettingRow>
        </>
      )}
    </section>
  );
}

export function TypographySection() {
  const rowAuto = useValue<number | null>(A('rowHeight')) === null;
  const tbAuto = useValue<number | null>(A('toolbarHeight')) === null;
  return (
    <div className="studio-sections">
      <section className="studio-card">
        <h2>Text</h2>
        <SettingRow id="fontScale" label="Text size" description="Text only. To make text and controls larger together, use Interface size in Accessibility." path={A('fontScale')}><Slider id="fontScale" path={A('fontScale')} min={0.85} max={1.3} step={0.01} format={pct} label="Text size" /></SettingRow>
        <SettingRow id="fontWeight" label="Font weight" path={A('fontWeight')}><Choice id="fontWeight" path={A('fontWeight')} options={[{ value: 'regular', label: 'Regular' }, { value: 'medium', label: 'Medium' }]} /></SettingRow>
        <SettingRow id="lineHeight" label="Line spacing" path={A('lineHeight')}><Slider id="lineHeight" path={A('lineHeight')} min={1.2} max={1.8} step={0.05} format={(v) => v.toFixed(2)} label="Line spacing" /></SettingRow>
        <SettingRow id="fontFamily" label="Typeface" path={A('fontFamily')}><Choice id="fontFamily" path={A('fontFamily')} options={[{ value: 'plex', label: 'IBM Plex Sans (bundled)' }, { value: 'system', label: 'System font' }]} /></SettingRow>
      </section>
      <section className="studio-card">
        <h2>Density and sizes</h2>
        <SettingRow id="density" label="Interface density" path={A('density')}><Choice id="density" path={A('density')} options={[{ value: 'compact', label: 'Compact' }, { value: 'comfortable', label: 'Comfortable' }, { value: 'spacious', label: 'Spacious' }]} /></SettingRow>
        <SettingRow id="rowHeight" label="File row height" description="Rows never get smaller than the minimum target size (Accessibility)." path={A('rowHeight')}>
          <label className="check"><input type="checkbox" checked={rowAuto} onChange={(e) => setValue(A('rowHeight'), e.target.checked ? null : 30)} /> Follow density</label>
          {!rowAuto && <Slider id="rowHeight" path={A('rowHeight')} min={20} max={48} step={1} format={px} label="File row height" />}
        </SettingRow>
        <SettingRow id="iconSize" label="Icon size (icon grid)" path={A('iconSize')}><Slider id="iconSize" path={A('iconSize')} min={48} max={256} step={8} format={px} label="Icon size" /></SettingRow>
        <SettingRow id="thumbnailSize" label="Thumbnail size (large thumbnails)" path={A('thumbnailSize')}><Slider id="thumbnailSize" path={A('thumbnailSize')} min={96} max={512} step={8} format={px} label="Thumbnail size" /></SettingRow>
        <SettingRow id="toolbarHeight" label="Toolbar height" path={A('toolbarHeight')}>
          <label className="check"><input type="checkbox" checked={tbAuto} onChange={(e) => setValue(A('toolbarHeight'), e.target.checked ? null : 40)} /> Follow density</label>
          {!tbAuto && <Slider id="toolbarHeight" path={A('toolbarHeight')} min={32} max={56} step={1} format={px} label="Toolbar height" />}
        </SettingRow>
        <SettingRow id="tabHeight" label="Tab height" path={A('tabHeight')}><Slider id="tabHeight" path={A('tabHeight')} min={28} max={44} step={1} format={px} label="Tab height" /></SettingRow>
        <SettingRow id="panelSpacing" label="Panel spacing" path={A('panelSpacing')}><Slider id="panelSpacing" path={A('panelSpacing')} min={0} max={16} step={1} format={px} label="Panel spacing" /></SettingRow>
      </section>
      <section className="studio-card"><h2>Sample</h2><ThemeSample /></section>
    </div>
  );
}

export function AccessibilitySection() {
  const system = useStore(custom, (s) => s.system);
  const adjustments = useCustom((r) => r.adjustments);
  return (
    <div className="studio-sections">
      <section className="studio-card">
        <h2>Size and contrast</h2>
        <SettingRow id="interfaceScale" label="Interface size" description="Scales text and controls together (also Ctrl + and Ctrl −)." path={X('interfaceScale')}><Slider id="interfaceScale" path={X('interfaceScale')} min={0.8} max={1.6} step={0.05} format={pct} label="Interface size" /></SettingRow>
        <SettingRow id="highContrast" label="High contrast" description={`“System” follows the operating system’s contrast preference${system.highContrast ? ' (it currently asks for more contrast)' : ' (it currently does not ask for more contrast)'}.`} path={X('highContrast')}>
          <Choice id="highContrast" path={X('highContrast')} options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        </SettingRow>
        <SettingRow id="focusRing" label="Focus indicator" path={X('focusRing')}><Choice id="focusRing" path={X('focusRing')} options={[{ value: 'standard', label: 'Standard' }, { value: 'strong', label: 'Strong' }]} /></SettingRow>
        <SettingRow id="minTarget" label="Minimum target size" description="The smallest size of buttons, rows and other things you click." path={X('minTarget')}>
          <Choice id="minTarget" path={X('minTarget')} options={[{ value: 24, label: '24 px' }, { value: 28, label: '28 px' }, { value: 32, label: '32 px' }, { value: 40, label: '40 px' }]} />
        </SettingRow>
        <SettingRow id="underlineLinks" label="Underline links" path={X('underlineLinks')}><Switch id="underlineLinks" path={X('underlineLinks')} /></SettingRow>
        <SettingRow id="reduceMotion" label="Reduce motion" description={`“System” follows the operating system${system.reducedMotion ? ' (it currently asks for reduced motion)' : ''}.`} path={X('reduceMotion')}>
          <Choice id="reduceMotion" path={X('reduceMotion')} options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        </SettingRow>
        <SettingRow id="reduceTransparency" label="Reduce transparency" description={`Opaque surfaces instead of glass. “System” follows the operating system${system.reducedTransparency ? ' (it currently asks for reduced transparency)' : ''}.`} path={X('reduceTransparency')}>
          <Choice id="reduceTransparency" path={X('reduceTransparency')} options={[{ value: 'system', label: 'System' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} />
        </SettingRow>
      </section>
      <section className="studio-card">
        <SettingRow id="safeguards" label="Safeguards in effect" description="These protections cannot be turned off by themes, presets, workspaces or imports: text stays readable, selection stays legible, navigation stays reachable, confirmations for permanent deletion are always shown, and the Command palette and Customization Studio always keep a shortcut." wide>
          <span />
        </SettingRow>
        {adjustments.length ? (
          <ul className="adjustments">
            {adjustments.map((a) => <li key={a.path}><Icon name="shield" size={14} /> {a.reason}</li>)}
          </ul>
        ) : <p className="muted small">Nothing currently needs adjusting.</p>}
      </section>
      <section className="studio-card"><h2>Sample</h2><ThemeSample /></section>
    </div>
  );
}
