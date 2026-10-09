import React from 'react';
import { Link } from '../ui/router.jsx';
import { ChevronLeft, ExternalLink } from 'lucide-react';

// Shared wrapper for CS laboratory pages — consistent header + scroll container.
export default function LabShell({ icon: Icon, title, description, externalTo, children }) {
  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
      <div className="border-b border-border bg-card/50 px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="grid size-9 place-items-center rounded-lg bg-cyan-j/10 text-cyan-j">
              <Icon className="size-5" />
            </div>
          )}
          <div className="flex-1">
            <h1 className="font-display text-base font-bold">{title}</h1>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          {externalTo && (
            <Link to={externalTo} className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:border-cyan-j/40 hover:text-cyan-j">
              Open full lab <ExternalLink className="size-3" />
            </Link>
          )}
        </div>
      </div>
      <div className="p-4 md:p-6">{children}</div>
    </div>
  );
}