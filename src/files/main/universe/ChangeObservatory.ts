import { watch, type FSWatcher } from 'fs';
import path from 'path';
import type { BrowserWindow } from 'electron';

export interface ChangeEvent {
  path: string;
  root: string;
  kind: 'add' | 'change' | 'remove' | 'rename';
  timestamp: number;
}

export class ChangeObservatory {
  private watchers: FSWatcher[] = [];
  private running = false;
  private events: ChangeEvent[] = [];
  private maxEvents = 10000;

  constructor(private win: BrowserWindow | null) {}

  start(roots: string[]) {
    this.stop();
    this.running = true;
    this.events = [];

    for (const root of roots) {
      try {
        const w = watch(root, { recursive: true }, (eventType, filename) => {
          if (!filename || !this.running) return;
          const fullPath = path.join(root, filename);
          const evt: ChangeEvent = {
            path: fullPath,
            root,
            kind: eventType === 'rename' ? 'rename' : 'change',
            timestamp: Date.now(),
          };
          this.events.push(evt);
          if (this.events.length > this.maxEvents) this.events.shift();
          try {
            for (const f of this.win?.webContents.mainFrame.framesInSubtree ?? []) f.send('files:universe:observatory:event', evt);
          } catch {}
        });
        this.watchers.push(w);
      } catch {}
    }
  }

  stop() {
    this.running = false;
    this.watchers.forEach(w => { try { w.close(); } catch {} });
    this.watchers = [];
  }

  status() {
    return {
      running: this.running,
      watcherCount: this.watchers.length,
      eventCount: this.events.length,
      recentEvents: this.events.slice(-100),
    };
  }
}
