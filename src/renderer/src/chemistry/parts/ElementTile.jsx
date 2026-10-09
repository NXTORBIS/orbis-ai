/*
 * One square of the periodic table.
 *
 * NOT the user's own file — theirs is not in any extracted archive. Written from the one call site, which passes
 * `el`, `dimmed`, `onClick` and a `style` carrying the grid position, and from the element record their own
 * elementsData.js builds (`atomic_number`, `symbol`, `name`, `atomic_mass`, `category`).
 *
 * The colour comes from their own category list, so the table's colours are the ones they chose.
 */
import React from 'react';
import { getCategory } from '../lib/chemistryCategories.js';

export default function ElementTile({ el, dimmed, onClick, style }) {
  const cat = getCategory(el.category);
  return (
    <button
      type="button"
      style={{ ...style, borderColor: dimmed ? undefined : `${cat.color}66` }}
      onClick={() => onClick?.(el)}
      /*
       * The name as well as the symbol, because "He" read on its own is a guess. A dimmed tile stays readable
       * rather than disappearing: it is still part of the table, it just does not match what was searched for.
       */
      aria-label={`${el.name}, element ${el.atomic_number}, ${cat.label}`}
      title={`${el.name} — ${cat.label}`}
      className={`group relative flex aspect-square min-w-0 flex-col items-center justify-center rounded-[5px] border bg-card/50 p-0.5 transition ${
        dimmed ? 'border-border/40 opacity-30' : 'hover:z-10 hover:scale-110 hover:bg-card'
      }`}
    >
      <span className="absolute left-[3px] top-[1px] font-mono-j text-[7px] leading-none text-muted-foreground/70">
        {el.atomic_number}
      </span>
      <span className="font-display text-[11px] font-bold leading-none" style={{ color: dimmed ? undefined : cat.color }}>
        {el.symbol}
      </span>
      <span className="mt-[2px] w-full truncate px-[2px] text-center text-[5.5px] leading-none text-muted-foreground">
        {el.name}
      </span>
    </button>
  );
}
