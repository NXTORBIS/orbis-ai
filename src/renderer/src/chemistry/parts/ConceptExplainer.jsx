/*
 * The "what does this mean?" panel for a chemistry studio.
 *
 * NOT the user's own file. Their `src/components/chemistry/ConceptExplainer.jsx` is not in any extracted archive.
 * This is written from the one shape every studio passes it, which is fixed and identical across all fifteen:
 *
 *   { name, nameMeaning, whatItIs, chemistry, math: [{eq, label}],
 *     variables: [{sym, desc, unit}], assumptions: [], limitations: [], applications: [] }
 *
 * Every field is optional here, because a studio that leaves one out should drop that section rather than render
 * an empty heading. Nothing is generated: the words shown are the studio's own.
 */
import React from 'react';
import { Info, BookOpen, Sigma, AlertTriangle, Layers, Beaker } from 'lucide-react';

function Section({ icon: Icon, title, children, open = false }) {
  return (
    <details open={open} className="group rounded-lg border border-border/60 bg-card/40 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-cyan-j" />
        <span>{title}</span>
      </summary>
      <div className="mt-2 space-y-2 text-sm text-muted-foreground">{children}</div>
    </details>
  );
}

function Bullets({ items }) {
  return (
    <ul className="space-y-1">
      {items.map((one, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-cyan-j">•</span>
          <span>{one}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ConceptExplainer({ spec }) {
  if (!spec) return null;
  const { name, nameMeaning, whatItIs, chemistry, math, variables, assumptions, limitations, applications } = spec;
  const some = (list) => Array.isArray(list) && list.length > 0;

  return (
    <div className="space-y-2">
      {(name || nameMeaning) && (
        <Section icon={Info} title={name ? `${name} — what the name means` : 'What the name means'} open>
          {nameMeaning && <p>{nameMeaning}</p>}
          {whatItIs && <p>{whatItIs}</p>}
        </Section>
      )}

      {chemistry && (
        <Section icon={Beaker} title="The chemistry" open>
          <p>{chemistry}</p>
        </Section>
      )}

      {some(math) && (
        <Section icon={Sigma} title="The equations">
          <div className="space-y-2">
            {math.map((one, i) => (
              <div key={i} className="rounded-lg border border-border/60 bg-secondary/40 px-3 py-2">
                <div className="font-mono-j text-sm italic text-foreground">{one.eq}</div>
                {one.label && <div className="mt-0.5 text-[11px] text-muted-foreground">{one.label}</div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {some(variables) && (
        <Section icon={Layers} title="What each symbol is">
          <div className="space-y-1">
            {variables.map((one, i) => (
              <div key={i} className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono-j text-foreground">{one.sym}</span>
                <span>{one.desc}</span>
                {one.unit && <span className="font-mono-j text-[11px] text-muted-foreground/80">({one.unit})</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {some(assumptions) && (
        <Section icon={Info} title="What it assumes">
          <Bullets items={assumptions} />
        </Section>
      )}

      {/* Amber, because these are the edges of the model rather than mistakes in it. */}
      {some(limitations) && (
        <Section icon={AlertTriangle} title="Where it stops holding">
          <Bullets items={limitations} />
        </Section>
      )}

      {some(applications) && (
        <Section icon={BookOpen} title="Where it is used">
          <Bullets items={applications} />
        </Section>
      )}
    </div>
  );
}
