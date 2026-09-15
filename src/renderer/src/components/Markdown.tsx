import { memo, useMemo, useState } from 'react'
import type { ResearchSource } from '../../../shared/types'
import { linkCitations } from '../../../shared/research'
import { openInOrbisBrowser } from '../lib/openInBrowser'
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
import ImageLightbox from './ImageLightbox'

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
  const [previewing, setPreviewing] = useState(false)
  if (typeof src !== 'string' || !src.startsWith('data:image/')) return <img src={src} alt={alt} title={title} {...props} className="markdown-inline-image" />
  const seedMatch = /^seed:(\d+)$/.exec(title ?? '')

  const download = (): void => {
    void window.api.saveImage(src, alt || 'orbis-image').then((ok) => {
      if (!ok) return
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }
  const edit = openEditor
    ? (): void => openEditor({ src, prompt: alt ?? '', seed: seedMatch ? Number(seedMatch[1]) : undefined, alpha: src.startsWith('data:image/png') })
    : undefined

  return (
    <figure className="generated-image">
      <button type="button" className="generated-image-open" title="Open full preview" onClick={() => setPreviewing(true)}>
        <img src={src} alt={alt} {...props} />
      </button>
      <figcaption>
        <span className="truncate" title={alt}>{alt}</span>
        {edit && (
          <button type="button" className="image-download image-edit" title="Edit image" onClick={edit}>
            <Pencil size={14} />
            Edit
          </button>
        )}
        <button type="button" className="image-download" onClick={download} title="Download image">
          {saved ? <CheckIcon size={14} /> : <Download size={14} />}
          {saved ? 'Saved' : 'Download'}
        </button>
      </figcaption>
      {previewing && (
        <ImageLightbox
          src={src}
          alt={alt ?? ''}
          saved={saved}
          onClose={() => setPreviewing(false)}
          onDownload={download}
          onEdit={
            edit &&
            (() => {
              setPreviewing(false)
              edit()
            })
          }
        />
      )}
    </figure>
  )
}

const SOURCE_LINK = '#orbis-source-'

/** Links open in the Orbis browser; a citation like [2] becomes a chip that opens that source's exact page. */
function makeLink(sources: ResearchSource[] | undefined): Components['a'] {
  return function Link({ node: _node, href, children, ...props }) {
    if (href?.startsWith(SOURCE_LINK)) {
      const source = sources?.find((s) => s.n === Number(href.slice(SOURCE_LINK.length)))
      if (!source) return <>{children}</>
      return (
        <button type="button" className="source-cite" title={`${source.title} — ${source.publisher ?? source.domain}. Open in Orbis browser`} onClick={() => openInOrbisBrowser(source.url)}>
          {source.n}
        </button>
      )
    }
    if (href && /^https?:\/\//i.test(href)) {
      return (
        <a
          {...props}
          href={href}
          title={props.title ?? `Open in Orbis browser: ${href}`}
          onClick={(e) => {
            e.preventDefault()
            openInOrbisBrowser(href)
          }}
        >
          {children}
        </a>
      )
    }
    return (
      <a {...props} href={href} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  }
}

const components: Components = {
  pre: CodeBlock,
  img: Image,
  a: makeLink(undefined),
  table: ({ node: _node, ...props }) => (
    <div className="table-wrap">
      <table {...props} />
    </div>
  )
}

// The default transform blanks data: URLs, which is how generated images arrive.
const urlTransform = (url: string): string => (/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(url) ? url : defaultUrlTransform(url))

function Markdown({ text, sources }: { text: string; sources?: ResearchSource[] }): React.JSX.Element {
  const content = useMemo(() => (sources?.length ? linkCitations(normalizeMath(text), sources) : normalizeMath(text)), [text, sources])
  const withSources = useMemo(() => (sources?.length ? { ...components, a: makeLink(sources) } : components), [sources])
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={withSources} urlTransform={urlTransform}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(Markdown)
