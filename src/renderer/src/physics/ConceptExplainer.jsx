// ConceptExplainer — the in-simulator "What does this mean?" panel.
// Renders topic-specific educational content from the explanations database
// (no AI required). Layered depth via collapsible <details> sections so
// beginners and advanced students both get what they need.
import React from 'react';
import { getExplanation } from './lib/topicExplanations.js';
import { BookOpen, ChevronDown, Info, Layers, FlaskConical, AlertTriangle, Sliders, BarChart3, HelpCircle } from 'lucide-react';

// Inline equation renderer (dependency-free, Unicode math).
function Equation({ children, where, label }) {
  return (
    <div className="my-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
      {label && <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>}
      <div className="overflow-x-auto text-sm leading-relaxed text-foreground" style={{ fontFamily: 'var(--font-mono)' }}>
        <span className="italic">{children}</span>
      </div>
      {where && <div className="mt-1 text-[11px] text-muted-foreground">{where}</div>}
    </div>
  );
}

function Section({ icon: Icon, title, children, defaultOpen = false }) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-cyan-j" />
        <span>{title}</span>
        <ChevronDown className="ml-auto size-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}

function BulletList({ items }) {
  return (
    <ul className="space-y-1">
      {items.map((it, i) => <li key={i} className="flex gap-2"><span className="text-cyan-j">•</span><span>{it}</span></li>)}
    </ul>
  );
}

export default function ConceptExplainer({ topic, section }) {
  const ex = getExplanation(topic?.id);
  if (!ex) return null;
  const sName = section?.name || topic?.sectionName || '';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <HelpCircle className="size-5 text-cyan-j" />
        <div>
          <h3 className="font-display text-base font-bold">What does this mean?</h3>
          <p className="text-xs text-muted-foreground">{topic.name}{sName ? ` · ${sName}` : ''}</p>
        </div>
      </div>

      {/* Quick top-level facts */}
      <div className="rounded-lg border border-cyan-j/30 bg-cyan-j/5 p-3 text-sm">
        {ex.what && <p className="mb-1.5"><span className="font-semibold text-foreground">What it is: </span>{ex.what}</p>}
        {ex.name && <p className="mb-1.5"><span className="font-semibold text-foreground">Name meaning: </span>{ex.name}</p>}
        {ex.physical && <p><span className="font-semibold text-foreground">What's happening: </span>{ex.physical}</p>}
      </div>

      {/* Layered depth */}
      <Section icon={Info} title="Quick Explanation" defaultOpen>
        <p>{ex.quick || ex.what || ex.means}</p>
      </Section>

      <Section icon={Layers} title="Physics Behind It">
        <p>{ex.physics || ex.physical || ex.what}</p>
        {ex.observe && <p className="text-foreground"><span className="font-semibold">What to observe: </span>{ex.observe}</p>}
      </Section>

      <Section icon={BookOpen} title="Mathematical Model">
        {ex.math && <p>{ex.math}</p>}
        {ex.equations?.length ? (
          <div>
            {ex.equations.map((e, i) => (
              <Equation key={i} label={e.label} where={e.where}>{e.eq}</Equation>
            ))}
          </div>
        ) : <p className="text-xs">See the simulator's live readouts for the computed quantities.</p>}
        {ex.calculated && (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-foreground">What is being calculated</div>
            <BulletList items={ex.calculated} />
          </div>
        )}
      </Section>

      <Section icon={FlaskConical} title="Real-World Applications">
        <p>{ex.applications || ex.used}</p>
      </Section>

      {ex.advanced && (
        <Section icon={BookOpen} title="Advanced Details">
          <p>{ex.advanced}</p>
        </Section>
      )}

      {/* What you can change + units */}
      {ex.controls && Object.keys(ex.controls).length > 0 && (
        <Section icon={Sliders} title="Controls & Units">
          <div className="space-y-1.5">
            {Object.entries(ex.controls).map(([k, v]) => (
              <div key={k} className="rounded-md border border-border/40 bg-secondary/30 px-2 py-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{k}</span>
                  {v.unit && <span className="font-mono text-[11px] text-cyan-j">{v.unit}</span>}
                </div>
                <div className="text-xs text-muted-foreground">{v.desc}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Visualizations */}
      {ex.viz && Object.keys(ex.viz).length > 0 && (
        <Section icon={BarChart3} title="Understanding the Visualizations">
          <div className="space-y-1.5">
            {Object.entries(ex.viz).map(([k, v]) => (
              <div key={k}><span className="font-medium text-foreground">{k}: </span><span>{v}</span></div>
            ))}
          </div>
        </Section>
      )}

      {/* Assumptions */}
      {ex.assumptions?.length > 0 && (
        <Section icon={Info} title="Model Assumptions">
          <BulletList items={ex.assumptions} />
        </Section>
      )}

      {/* Limitations */}
      {ex.limitations?.length > 0 && (
        <Section icon={AlertTriangle} title="Model Limitations">
          <BulletList items={ex.limitations} />
        </Section>
      )}

      {/* Why does this happen — parameter-relevant reasoning */}
      {ex.why && (
        <Section icon={HelpCircle} title="Why does this happen?" defaultOpen>
          <p>{ex.why}</p>
        </Section>
      )}
    </div>
  );
}