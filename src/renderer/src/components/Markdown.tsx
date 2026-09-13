import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components, ExtraProps, Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { copyText, hastText, normalizeMath } from '../lib/utils'
import { CheckIcon, CopyIcon } from './Icons'

const remarkPlugins: Options['remarkPlugins'] = [remarkGfm, remarkMath]
// Auto-detection is skipped: it's slow on streaming text and often wrong for short snippets.
const rehypePlugins: Options['rehypePlugins'] = [rehypeKatex, [rehypeHighlight, { detect: false }]]

function CodeBlock({ node, children, ...rest }: React.ComponentProps<'pre'> & ExtraProps): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const first = node?.children[0]
  const className = first?.type === 'element' ? first.properties.className : undefined
  const language = Array.isArray(className)
    ? className
        .map(String)
        .find((c) => c.startsWith('language-'))
        ?.slice('language-'.length)
    : undefined

  const copy = (): void => {
    void copyText(hastText(node)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="code-block">
      <div className="code-header">
        <span>{language ?? 'code'}</span>
        <button className="code-copy" onClick={copy}>
          {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  )
}

const components: Components = {
  pre: CodeBlock,
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  )
}

function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
