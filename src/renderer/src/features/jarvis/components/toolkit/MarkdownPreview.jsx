import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { FileCode } from 'lucide-react';
import { ToolHeader, Area, CopyBtn, Stat } from './shared';

const SAMPLE = `# Markdown Preview

Write **bold**, _italic_, \`inline code\` and [links](https://base44.com).

- bullet list
- second item

> Blockquote text renders here.

\`\`\`js
const sum = (a, b) => a + b;
\`\`\`
`;

export default function MarkdownPreview() {
  const [text, setText] = useState(SAMPLE);
  const lines = text.split('\n').length;

  return (
    <div className="space-y-4">
      <ToolHeader icon={FileCode} title="Markdown Preview" desc="Type Markdown on the left, see it rendered live on the right." />
      <div className="grid gap-3 lg:grid-cols-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Markdown</span>
            <Stat label="Lines" value={String(lines)} />
          </div>
          <Area value={text} onChange={setText} rows={16} mono placeholder="Write Markdown…" />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Preview</span>
            <CopyBtn value={text} label="Copy source" />
          </div>
          <div className="min-h-64 rounded-md border border-border/70 bg-card/60 p-4 text-sm leading-relaxed
            [&_h1]:font-display [&_h1]:text-xl [&_h1]:font-bold [&_h1]:mb-2
            [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2
            [&_h3]:font-semibold [&_h3]:mt-3
            [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5
            [&_a]:text-cyan-j [&_a]:underline [&_strong]:text-foreground
            [&_code]:rounded [&_code]:bg-secondary [&_code]:px-1 [&_code]:font-mono-j [&_code]:text-cyan-j
            [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-secondary [&_pre]:p-3
            [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-foreground
            [&_blockquote]:border-l-2 [&_blockquote]:border-cyan-j/60 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
            [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:px-2 [&_td]:border [&_td]:border-border [&_td]:px-2
            [&_hr]:my-4 [&_hr]:border-border">
            <ReactMarkdown>{text}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}