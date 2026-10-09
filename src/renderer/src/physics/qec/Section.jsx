import React from 'react';

export default function Section({ title, icon: Icon, children, right }) {
  return (
    <section className="rounded-xl border border-border bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="h-4 w-4 text-cyan-j" />}
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}