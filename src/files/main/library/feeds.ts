import fsp from 'node:fs/promises';
import path from 'node:path';
import { ContentFeedSchema } from '../../shared/integration/host-contract';
import type { ContentItem, ContentProviderInfo } from '../../shared/integration/content-providers';
import type { ContentProvider } from './ContentRegistry';

/**
 * Native content provided by the Orbis app through a JSON feed file it
 * maintains (host contract 1.1, register-content-feed). Orbis Files only
 * reads the feed; items keep their native format and are opened by the Orbis
 * app through an orbis: link, or by their file when they are files.
 */
export interface FeedRegistration {
  providerId: string;
  label: string;
  types: string[];
  feedFile: string;
}

const MAX_FEED_BYTES = 5 * 1024 * 1024;

export class FeedProvider implements ContentProvider {
  private lastError: string | undefined;
  private lastRead: { mtimeMs: number; items: ContentItem[] } | undefined;

  constructor(readonly reg: FeedRegistration) {}

  info(): ContentProviderInfo {
    return {
      id: this.reg.providerId,
      label: this.reg.label,
      types: this.reg.types,
      availability: this.lastError ? 'error' : 'available',
      storage: 'application',
      actions: ['open', 'edit_in_source'],
      removalSemantics: 'Items belong to the Orbis app; remove or edit them there. Orbis Files only lists them.',
      note: this.lastError ? `Feed problem: ${this.lastError}` : `Provided by the Orbis app (feed ${path.basename(this.reg.feedFile)}).`,
      builtIn: false,
    };
  }

  async list(limit: number): Promise<ContentItem[]> {
    try {
      const st = await fsp.stat(this.reg.feedFile);
      if (!st.isFile()) throw new Error('The feed is not a file.');
      if (st.size > MAX_FEED_BYTES) throw new Error('The feed file is larger than 5 MB.');
      if (this.lastRead && this.lastRead.mtimeMs === st.mtimeMs) return this.lastRead.items.slice(0, limit);
      const parsed = ContentFeedSchema.safeParse(JSON.parse(await fsp.readFile(this.reg.feedFile, 'utf8')));
      if (!parsed.success) throw new Error(`The feed does not match the contract: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      if (!parsed.data.contract.startsWith('1.')) throw new Error(`Unsupported feed contract ${parsed.data.contract}.`);
      const items = await Promise.all(parsed.data.items.map(async (it) => {
        const filePath = it.path && path.isAbsolute(it.path) ? it.path : undefined;
        const present = filePath ? !!(await fsp.stat(filePath).catch(() => undefined)) : true;
        return { id: it.id, providerId: this.reg.providerId, type: it.type, title: it.title, path: filePath, modifiedMs: it.modifiedMs, size: it.size, source: this.reg.label, present, editable: !!it.openUri, openUri: it.openUri, description: it.description } as ContentItem;
      }));
      this.lastRead = { mtimeMs: st.mtimeMs, items };
      this.lastError = undefined;
      return items.slice(0, limit);
    } catch (err) {
      this.lastError = (err as Error).message;
      this.lastRead = undefined;
      return [];
    }
  }
}
