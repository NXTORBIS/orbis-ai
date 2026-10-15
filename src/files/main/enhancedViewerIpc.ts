/**
 * IPC handlers for enhanced diff, structured data viewer, and markdown preview.
 * Imported and spread into the main handler map by ipcHandlers.ts.
 */
import type { z } from 'zod';
import type { InvokeSchemas } from '../shared/ipc';
import { requireAbsolute } from './fs/paths';
import { computeDiff } from './tools/diffService';
import { parseStructured } from './tools/structuredService';
import { renderMarkdown } from './tools/markdownService';

type EnhancedChannel = 'diff:compute' | 'structured:parse' | 'markdown:render';

export function enhancedViewerHandlers(): { [C in EnhancedChannel]: (p: z.infer<(typeof InvokeSchemas)[C]>) => unknown } {
  return {
    'diff:compute': (p) => computeDiff(
      requireAbsolute(p.pathA, 'diff.compute'),
      requireAbsolute(p.pathB, 'diff.compute'),
    ),
    'structured:parse': (p) => parseStructured(requireAbsolute(p.path, 'structured.parse')),
    'markdown:render': (p) => renderMarkdown(p.content),
  };
}
