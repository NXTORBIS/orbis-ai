import { memo, useState } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Components, ExtraProps, Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeHighlight from 'rehype-highlight'
import { copyText, hastText, normalizeMath } from '../lib/utils'
import { Download, Pencil } from 'lucide-react'
import { useImageEditor } from '../lib/imageEditor'
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

function Image({ node: _node, src, alt, title, ...props }: React.ComponentProps<'img'> & ExtraProps): React.JSX.Element {
  const openEditor = useImageEditor()
  const [saved, setSaved] = useState(false)
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return <img src={src} alt={alt} title={title} {...props} className="markdown-inline-image" />
  const seedMatch = /^seed:(\d+)$/.exec(title ?? '')

  const download = (): void => {
    void window.api.saveImage(src, alt || 'orbis-image').then((ok) => {
      if (!ok) return
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  return (
    <figure className="generated-image">
      <img src={src} alt={alt} {...props} />
      <figcaption>
        <span className="truncate" title={alt}>{alt}</span>
        {openEditor && (
          <button
            type="button"
            className="image-download image-edit"
            title="Edit image"
            onClick={() => openEditor({ src, prompt: alt ?? '', seed: seedMatch ? Number(seedMatch[1]) : undefined, alpha: src.startsWith('data:image/png') })}
          >
            <Pencil size={14} />
            Edit
          </button>
        )}
        <button type="button" className="image-download" onClick={download} title="Download image">
          {saved ? <CheckIcon size={14} /> : <Download size={14} />}
          {saved ? 'Saved' : 'Download'}
        </button>
      </figcaption>
    </figure>
  )
}

const components: Components = {
  pre: CodeBlock,
  img: Image,
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
  table: ({ node: _node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  )
}

// The default transform blanks data: URLs, which is how generated images arrive.
const urlTransform = (url: string): string => (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url) ? url : defaultUrlTransform(url))

function Markdown({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components} urlTransform={urlTransform}>
        {normalizeMath(text)}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
