import React from 'react';
import { cn } from '../lib/utils.js';

export default function Section({ title, icon: Icon, children, className, right, accent = '#06b6d4' }) {
  return (
    <section className={cn('rounded-2xl border border-border/60 bg-card/50 backdrop-blur p-4 sm:p-5', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-border/50" style={{ background: `${accent}1a`, color: accent }}>
              <Icon className="h-4 w-4" strokeWidth={1.5} />
            </div>
          )}
          <h3 className="font-display text-sm font-semibold tracking-wide uppercase text-muted-foreground">{title}</h3>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}