/*
 * One concept from the Formula Vault, as a card.
 *
 * NOT the user's own file — their `src/components/formulavault/ConceptCard.jsx` is not in any extracted archive.
 * Written from the one call site, which passes `data`, `saved` and `onSave`, and from the exact fields their
 * FormulaVault reads off that same object when it saves one:
 *
 *   title, subject, level, summary, formulas: string[], derivation, example, related: string[]
 *
 * Every field is optional, because this card shows whatever a lookup returned and a missing field must drop its
 * section rather than render an empty heading. Nothing here invents content: a card with only a title shows only
 * a title.
 */
import React from 'react';
import { Bookmark, BookmarkCheck, Sigma, ArrowRight, Lightbulb, Link2 } from 'lucide-react';

export default function ConceptCard({ data, saved, onSave }) {
  if (!data) return null;
  const { title, subject, level, summary, formulas, derivation, example, related } = data;
  const some = (list) => Array.isArray(list) && list.length > 0;

  return (
    <article className="glass glass-border rounded-2xl p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold">{title || 'Untitled'}</h2>
          {(subject || level) && (
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {subject && (
                <span className="rounded-full border border-cyan-j/40 bg-cyan-j/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-cyan-j">
                  {subject}
                </span>
              )}
              {level && <span className="text-[11px] text-muted-foreground">{level}</span>}
            </div>
          )}
        </div>
        {onSave && (
          <button
            type="button"
            onClick={onSave}
            disabled={saved}
            aria-label={saved ? 'Already saved' : 'Save this concept'}
            className="shrink-0 rounded-xl border border-border/60 bg-card/50 p-2 text-muted-foreground transition hover:border-border disabled:opacity-60"
          >
            {saved ? <BookmarkCheck className="h-4 w-4 text-cyan-j" /> : <Bookmark className="h-4 w-4" />}
          </button>
        )}
      </header>

      {summary && <p className="mt-3 text-sm text-foreground/85">{summary}</p>}

      {some(formulas) && (
        <section className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            <Sigma className="h-3.5 w-3.5 text-cyan-j" /> Formulas
          </div>
          <div className="space-y-1.5">
            {formulas.map((one, i) => (
              <div key={i} className="rounded-xl border border-border/60 bg-secondary/40 px-3 py-2 font-mono-j text-sm">
                {one}
              </div>
            ))}
          </div>
        </section>
      )}

      {derivation && (
        <section className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            <ArrowRight className="h-3.5 w-3.5 text-cyan-j" /> Where it comes from
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{derivation}</p>
        </section>
      )}

      {example && (
        <section className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            <Lightbulb className="h-3.5 w-3.5 text-cyan-j" /> Worked example
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{example}</p>
        </section>
      )}

      {some(related) && (
        <section className="mt-4">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">
            <Link2 className="h-3.5 w-3.5 text-cyan-j" /> Related
          </div>
          <div className="flex flex-wrap gap-1.5">
            {related.map((one, i) => (
              <span key={i} className="rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground">
                {one}
              </span>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
