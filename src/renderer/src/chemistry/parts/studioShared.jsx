/*
 * The frame and the controls every chemistry studio is built from.
 *
 * NOT the user's own file. Their `src/components/chemistry/studioShared.jsx` is not in any extracted archive, so
 * this is written from the call sites across their fifteen studios, which all use exactly five things:
 *
 *   <StudioShell title subtitle tabs={[...]} explain={EXPLAIN}>  one child per tab, in order
 *   <Slider label value set min max step unit />
 *   <Stat label value />
 *   <Select label value set options={[{value, label}]} />
 *   <ValidationBadge status="passed"|"warning"|"failed" note="..." />
 *
 * Nothing more is offered, so a studio cannot come to depend on something their own file did not have.
 */
import React, { useState } from 'react';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, BookOpen } from 'lucide-react';
import ConceptExplainer from './ConceptExplainer.jsx';

/**
 * One studio: a heading, a row of tabs, and the panel for the tab that is showing.
 *
 * Only the showing tab's child is rendered. Every studio computes its numbers inside its tab components, and
 * rendering all four would run four simulations to show one.
 */
export function StudioShell({ title, subtitle, tabs = [], explain, children, showing: asked, onShow }) {
  const [at, setAt] = useState(0);
  const [showing, setShowing] = useState(false);
  const panels = React.Children.toArray(children);
  /*
   * The tab can be driven from outside, for a studio that moves you to a tab itself -- the Research Workspace
   * goes to the results when a run finishes. When `showing` is not given it keeps its own, which is what every
   * other studio wants.
   */
  const driven = typeof asked === 'number';
  const here = Math.min(driven ? asked : at, Math.max(0, panels.length - 1));
  const pick = (i) => {
    if (driven) onShow?.(i);
    else setAt(i);
  };

  return (
    <div className="jx-wrap">
      <div className="jx">
        <div className="mb-4">
          <h2 className="font-display text-2xl font-bold">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>

        {tabs.length > 1 && (
          <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
            {tabs.map((name, i) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={i === here}
                onClick={() => pick(i)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  i === here ? 'border-cyan-j/60 bg-cyan-j/10 text-cyan-j' : 'border-border/60 bg-card/50 text-muted-foreground hover:border-border'
                }`}
              >
                {name}
              </button>
            ))}
          </div>
        )}

        <div role="tabpanel">{panels[here] ?? null}</div>

        {explain && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowing((was) => !was)}
              aria-expanded={showing}
              className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-card/40 px-3 py-2 text-xs text-muted-foreground transition hover:border-border"
            >
              <BookOpen className="h-3.5 w-3.5 text-cyan-j" />
              {showing ? 'Hide explanation' : 'What does this mean?'}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showing ? 'rotate-180' : ''}`} />
            </button>
            {showing && (
              <div className="mt-3">
                <ConceptExplainer spec={explain} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One adjustable number.
 *
 * The value is shown beside the name, because the studios read their own sliders rather than echoing them
 * somewhere else, and a slider whose value you cannot see is a slider you cannot set deliberately.
 */
export function Slider({ label, value, set, min = 0, max = 1, step = 0.01, unit }) {
  const show = Number.isFinite(Number(value)) ? Number(value) : min;
  return (
    <label className="block">
      <span className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span className="font-mono-j">{label}</span>
        <span className="font-mono-j text-foreground/90">
          {show}
          {unit ? ` ${unit}` : ''}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={show}
        aria-label={label}
        onChange={(event) => set(Number(event.target.value))}
        className="mt-1 w-full accent-cyan-j"
      />
    </label>
  );
}

/** One number the studio worked out. Read-only on purpose: a stat is an answer, not a control. */
export function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80">{label}</div>
      <div className="font-mono-j text-sm text-foreground">{value}</div>
    </div>
  );
}

/** One choice from a list. `set` takes the chosen value, which the studios then read as text or as a number. */
export function Select({ label, value, set, options = [] }) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">
        <span className="font-mono-j">{label}</span>
      </span>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => set(event.target.value)}
        className="mt-1 w-full rounded-xl border border-border/60 bg-card/60 px-2.5 py-1.5 text-sm text-foreground"
      >
        {options.map((one) => (
          <option key={String(one.value)} value={one.value}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * What the studio makes of its own numbers.
 *
 * Three states, because that is all the studios ever pass: it checks out, it is outside the range where the
 * model holds, or it cannot be right. The note is the studio's own words and is shown as given.
 */
export function ValidationBadge({ status = 'passed', note }) {
  const LOOK = {
    passed: { Icon: CheckCircle2, tint: 'text-emerald-400', edge: 'border-emerald-400/40 bg-emerald-400/5', word: 'Checks out' },
    warning: { Icon: AlertTriangle, tint: 'text-amber-400', edge: 'border-amber-400/40 bg-amber-400/5', word: 'Outside the usual range' },
    failed: { Icon: XCircle, tint: 'text-rose-400', edge: 'border-rose-400/40 bg-rose-400/5', word: 'Cannot be right' }
  };
  const { Icon, tint, edge, word } = LOOK[status] ?? LOOK.passed;
  return (
    <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2 ${edge}`} role="status">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tint}`} />
      <div className="min-w-0">
        <div className={`text-[11px] font-medium ${tint}`}>{word}</div>
        {note && <div className="text-[11px] text-muted-foreground">{note}</div>}
      </div>
    </div>
  );
}

export default StudioShell;
